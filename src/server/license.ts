import crypto from "node:crypto";

export type LicenseInfo = {
  key: string;
  status: string;
  username: string;
  authToken: string;
  level: number | string;
  expires: number | null;
  days: number | null;
  subscription: string | null;
};

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

export async function findDiscordLicense(discordId: string): Promise<LicenseInfo | null> {
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
