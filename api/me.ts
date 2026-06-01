import crypto from "node:crypto";

type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  level?: number | string;
  banned?: boolean;
  ban?: boolean;
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

function normalizeDiscordMediaUrl(value: unknown) {
  if (typeof value !== "string") return value;
  if (!value.includes("cdn.discordapp.com/")) return value;
  if (!value.match(/\/a_[^/.?]+\.png/i)) return value;
  return value.replace(/\.png(\?size=\d+)?$/i, ".gif$1");
}

function normalizeDiscordMedia(session: any) {
  if (!session?.discord) return;
  session.discord.avatar = normalizeDiscordMediaUrl(session.discord.avatar);
  session.discord.banner = normalizeDiscordMediaUrl(session.discord.banner);
}

async function keyAuthSellerRequest(params: Record<string, string>) {
  const sellerKey = process.env.KEYAUTH_SELLER_KEY;
  if (!sellerKey) return null;

  const query = new URLSearchParams({ sellerkey: sellerKey, ...params });
  const response = await fetch(`https://keyauth.win/api/seller/?${query.toString()}`);
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
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

function maskKey(key: string) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}-${"*".repeat(8)}-${key.slice(-4)}`;
}

function createAppPassword(license: string, discordId: string) {
  return crypto.createHash("sha256").update(`${discordId}:${license}`).digest("hex").slice(0, 32);
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

async function findDiscordLicense(discordId: string) {
  const username = `discord_${discordId}`;
  const keysResult = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
  const key = extractKeys(keysResult).find((item) => normalizeOwner(item.usedby) === normalizeOwner(username));
  const rawKey = String(key?.key ?? "").trim();
  if (!key || !rawKey) return null;

  const data = await keyAuthSellerRequest({ type: "userdata", user: username }) as UserDataResponse | null;
  const firstSub = Array.isArray(data?.subscriptions) ? data.subscriptions[0] : undefined;
  const expires = normalizeExpiry(firstSub?.expiry ?? data?.expires ?? data?.expiry ?? key.expires ?? key.expiry);
  const timeleftDays = daysFromTimeleft(firstSub?.timeleft);
  const days = timeleftDays ?? (expires ? Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) : null);

  return {
    key: maskKey(rawKey),
    status: normalizeStatus(key, data, expires),
    username,
    authToken: createAppPassword(rawKey, discordId),
    level: key.level ?? 1,
    expires,
    days,
    subscription: firstSub?.subscription ?? null
  };
}

export default async function handler(req: any, res: any) {
  try {
    const session = readSession(req);
    if (!session) {
      json(res, 401, { success: false, message: "Not logged in." });
      return;
    }

    if (session.discord?.id) {
      normalizeDiscordMedia(session);
      session.license = await findDiscordLicense(String(session.discord.id));
      setSession(res, session);
    }

    json(res, 200, { success: true, session });
  } catch (error) {
    json(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Could not refresh session"
    });
  }
}
