import crypto from "node:crypto";

type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  level?: number | string;
  duration?: number | string;
};

type UserDataResponse = {
  success?: boolean;
  subscriptions?: Array<{
    subscription?: string;
    expiry?: number | string;
    timeleft?: number | string;
  }>;
  expires?: number | string;
  expiry?: number | string;
  message?: string;
};

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function parseCookies(req: any) {
  const raw = String(req.headers.cookie || "");
  return Object.fromEntries(raw.split(";").map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("=") || "")];
  }).filter(([key]) => key));
}

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET || "change-this-session-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function readSession(req: any) {
  const token = parseCookies(req).blaze_session;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function setSession(res: any, session: any) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  res.setHeader("Set-Cookie", `blaze_session=${payload}.${sign(payload)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
}

async function readBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  return new Promise<any>((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 10000) reject(new Error("Request body too large"));
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

async function keyAuthSellerRequest(params: Record<string, string>) {
  const sellerKey = process.env.KEYAUTH_SELLER_KEY;
  if (!sellerKey) throw new Error("KEYAUTH_SELLER_KEY is not configured in Vercel.");

  const query = new URLSearchParams({ sellerkey: sellerKey, ...params });
  const response = await fetch(`https://keyauth.win/api/seller/?${query.toString()}`);
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid KeyAuth response (${response.status}): ${text.slice(0, 160)}`);
  }
}

async function keyAuthAppRequest(params: Record<string, string>) {
  const name = process.env.KEYAUTH_APP_NAME || "blaze";
  const ownerid = process.env.KEYAUTH_OWNER_ID || "EXhIuzzp52";
  const ver = process.env.KEYAUTH_VERSION || "1.0";
  const query = new URLSearchParams({ name, ownerid, ver, ...params });
  const response = await fetch(`https://keyauth.win/api/1.3/?${query.toString()}`);
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`Invalid KeyAuth app response (${response.status}): ${text.slice(0, 160)}`);
  }
}

function createAppPassword(license: string, discordId: string) {
  return crypto.createHash("sha256").update(`${discordId}:${license}`).digest("hex").slice(0, 32);
}

async function registerLicenseToDiscord(license: string, discordId: string) {
  const username = `discord_${discordId}`;
  const password = createAppPassword(license, discordId);
  const init = await keyAuthAppRequest({ type: "init" });

  if (!init.success || !init.sessionid) {
    return { success: false, username, password, message: String(init.message || "KeyAuth init failed") };
  }

  const result = await keyAuthAppRequest({
    type: "register",
    sessionid: String(init.sessionid),
    username,
    pass: password,
    key: license,
    hwid: `DISCORD-${discordId}`
  });

  return { success: Boolean(result.success), username, password, message: String(result.message || "License registered") };
}

function extractKeys(value: unknown): KeyRecord[] {
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  const keys = data.keys;
  if (Array.isArray(keys)) return keys as KeyRecord[];
  if (keys && typeof keys === "object") return Object.values(keys as Record<string, KeyRecord>);
  return [];
}

function maskKey(key: string) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}-${"*".repeat(8)}-${key.slice(-4)}`;
}

function normalizeExpiry(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 100000000000 ? numeric : numeric * 1000;
}

function normalizeUsedBy(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "-" || text === "n/a" || text === "none" || text === "unused") return "";
  return text;
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

async function getUserLicenseInfo(username: string, key: string, authToken: string, fallbackKey?: KeyRecord) {
  const data = await keyAuthSellerRequest({ type: "userdata", user: username }) as UserDataResponse;
  const firstSub = Array.isArray(data.subscriptions) ? data.subscriptions[0] : undefined;
  const expires = normalizeExpiry(firstSub?.expiry ?? data.expires ?? data.expiry ?? fallbackKey?.expires ?? fallbackKey?.expiry);
  const timeleftDays = daysFromTimeleft(firstSub?.timeleft);
  const days = timeleftDays ?? (expires ? Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) : null);

  return {
    key: maskKey(key),
    status: "ACTIVE",
    username,
    authToken,
    level: fallbackKey?.level ?? 1,
    expires,
    days,
    subscription: firstSub?.subscription ?? null
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const session = readSession(req);
    if (!session?.discord?.id) {
      sendJson(res, 401, { success: false, message: "Login with Discord first." });
      return;
    }

    const body = await readBody(req);
    const license = String(body.license ?? "").trim();

    if (!license) {
      sendJson(res, 400, { success: false, message: "Enter a license key." });
      return;
    }

    const username = `discord_${session.discord.id}`;
    const authToken = createAppPassword(license, String(session.discord.id));
    const keysBefore = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
    const keyBefore = extractKeys(keysBefore).find((item) => String(item.key ?? "").trim() === license);

    if (!keyBefore) {
      sendJson(res, 404, { success: false, message: "License was not found." });
      return;
    }

    const currentOwner = normalizeUsedBy(keyBefore.usedby);
    if (currentOwner && currentOwner !== normalizeUsedBy(username)) {
      sendJson(res, 403, { success: false, message: "This license is already linked to another Discord account." });
      return;
    }

    if (!currentOwner) {
      const register = await registerLicenseToDiscord(license, String(session.discord.id));
      if (!register.success) {
        const keysAfterFailure = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
        const keyAfterFailure = extractKeys(keysAfterFailure).find((item) => String(item.key ?? "").trim() === license);
        const failedOwner = normalizeUsedBy(keyAfterFailure?.usedby);

        if (failedOwner !== normalizeUsedBy(username)) {
          sendJson(res, 400, { success: false, message: register.message });
          return;
        }
      }
    }

    const keysAfter = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
    const keyAfter = extractKeys(keysAfter).find((item) => String(item.key ?? "").trim() === license) ?? keyBefore;
    const finalOwner = normalizeUsedBy(keyAfter.usedby);

    if (finalOwner && finalOwner !== normalizeUsedBy(username)) {
      sendJson(res, 403, { success: false, message: "This license is already linked to another Discord account." });
      return;
    }

    const licenseInfo = await getUserLicenseInfo(username, license, authToken, keyAfter);

    session.license = licenseInfo;
    setSession(res, session);
    sendJson(res, 200, {
      success: true,
      message: "License linked to Discord.",
      license: licenseInfo
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Redeem failed"
    });
  }
}
