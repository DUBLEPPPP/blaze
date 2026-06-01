import crypto from "node:crypto";

type LicenseToken = {
  app?: string;
  version?: number;
  username?: string;
  authToken?: string;
  discordId?: string;
  discordName?: string;
  avatar?: string;
  issuedAt?: number;
};

type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  banned?: boolean;
  ban?: boolean;
};

type UserDataResponse = {
  success?: boolean;
  subscriptions?: Array<{
    expiry?: number | string;
    timeleft?: number | string;
  }>;
  expires?: number | string;
  expiry?: number | string;
  banned?: boolean;
  ban?: boolean;
  message?: string;
};

function json(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  return new Promise<any>((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 12000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function decryptLicense(token: string): LicenseToken {
  const [prefix, ivRaw, tagRaw, dataRaw] = token.trim().split(".");
  if (prefix !== "BLAZA1" || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error("Invalid license token.");
  }

  const secret = process.env.SESSION_SECRET || "change-this-session-secret";
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(decrypted) as LicenseToken;
}

async function keyAuthSellerRequest(params: Record<string, string>) {
  const sellerKey = process.env.KEYAUTH_SELLER_KEY;
  if (!sellerKey) throw new Error("KEYAUTH_SELLER_KEY is not configured.");

  const query = new URLSearchParams({ sellerkey: sellerKey, ...params });
  const response = await fetch(`https://keyauth.win/api/seller/?${query.toString()}`);
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid KeyAuth response (${response.status})`);
  }
}

function extractKeys(value: unknown): KeyRecord[] {
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  const keys = data.keys;
  if (Array.isArray(keys)) return keys as KeyRecord[];
  if (keys && typeof keys === "object") return Object.values(keys as Record<string, KeyRecord>);
  return [];
}

function normalizeOwner(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeExpiry(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 100000000000 ? numeric : numeric * 1000;
}

function daysFromTimeleft(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.ceil(value / 86400));
  }

  const text = String(value ?? "").toLowerCase();
  const dayMatch = text.match(/(\d+)\s*d/);
  if (dayMatch) return Number(dayMatch[1]);

  const hourMatch = text.match(/(\d+)\s*h/);
  if (hourMatch) return Math.ceil(Number(hourMatch[1]) / 24);

  return null;
}

function normalizeStatus(key: KeyRecord, data: UserDataResponse | null, expires: number | null) {
  const raw = String(key.status ?? data?.message ?? "").toLowerCase();
  if (key.banned || key.ban || data?.banned || data?.ban || raw.includes("ban")) return "BANNED";
  if (expires && expires <= Date.now()) return "EXPIRED";
  if (raw.includes("expire")) return "EXPIRED";
  if (raw.includes("disabled")) return "DISABLED";
  return "ACTIVE";
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    json(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const token = String(body.token || "").trim();
    if (!token) {
      json(res, 400, { success: false, message: "Missing token." });
      return;
    }

    const license = decryptLicense(token);
    if (license.app !== "blaze" || !license.username || !license.authToken) {
      json(res, 403, { success: false, message: "Invalid license payload." });
      return;
    }

    const keysResult = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
    const key = extractKeys(keysResult).find((item) => normalizeOwner(item.usedby) === normalizeOwner(license.username));
    if (!key) {
      json(res, 404, { success: false, message: "License not found." });
      return;
    }

    const data = await keyAuthSellerRequest({ type: "userdata", user: license.username }) as UserDataResponse;
    const firstSub = Array.isArray(data.subscriptions) ? data.subscriptions[0] : undefined;
    const expires = normalizeExpiry(firstSub?.expiry ?? data.expires ?? data.expiry ?? key.expires ?? key.expiry);
    const timeleftDays = daysFromTimeleft(firstSub?.timeleft);
    const days = timeleftDays ?? (expires ? Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) : null);
    const status = normalizeStatus(key, data, expires);

    json(res, status === "ACTIVE" ? 200 : 403, {
      success: status === "ACTIVE",
      status,
      days,
      expires,
      discordId: license.discordId ?? null,
      discordName: license.discordName ?? null,
      avatar: license.avatar ?? null,
      message: status === "ACTIVE" ? "License valid." : `License ${status.toLowerCase()}.`
    });
  } catch (error) {
    json(res, 403, {
      success: false,
      message: error instanceof Error ? error.message : "Validation failed."
    });
  }
}
