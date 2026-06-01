import crypto from "node:crypto";

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  level?: number | string;
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
};

function parseCookies(req: any) {
  const raw = String(req.headers.cookie || "");
  return Object.fromEntries(raw.split(";").map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("=") || "")];
  }).filter(([key]) => key));
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET || "change-this-session-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
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

async function findDiscordLicense(discordId: string) {
  const username = `discord_${discordId}`;
  const keysResult = await keyAuthSellerRequest({ type: "fetchallkeys", format: "JSON" });
  const key = extractKeys(keysResult).find((item) => normalizeOwner(item.usedby) === normalizeOwner(username));
  const rawKey = String(key?.key ?? "").trim();
  if (!key || !rawKey) return null;

  const data = await keyAuthSellerRequest({ type: "userdata", user: username }) as UserDataResponse | null;
  const firstSub = Array.isArray(data?.subscriptions) ? data?.subscriptions[0] : undefined;
  const expires = normalizeExpiry(firstSub?.expiry ?? data?.expires ?? data?.expiry ?? key.expires ?? key.expiry);
  const timeleftDays = daysFromTimeleft(firstSub?.timeleft);
  const days = timeleftDays ?? (expires ? Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) : null);

  return {
    key: maskKey(rawKey),
    status: "ACTIVE",
    username,
    authToken: createAppPassword(rawKey, discordId),
    level: key.level ?? 1,
    expires,
    days,
    subscription: firstSub?.subscription ?? null
  };
}

async function makeSession(user: DiscordUser) {
  const payload = base64url(JSON.stringify({
    discord: {
      id: user.id,
      username: user.username,
      name: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`
    },
    license: await findDiscordLicense(user.id),
    createdAt: Date.now()
  }));
  return `${payload}.${sign(payload)}`;
}

export default async function handler(req: any, res: any) {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(req);

    if (!code || !state || state !== cookies.blaze_oauth_state) {
      throw new Error("Invalid Discord login state.");
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Discord OAuth is not configured in Vercel.");
    }

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const redirectUri = process.env.DISCORD_REDIRECT_URI || `${proto}://${host}/api/discord-callback`;

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });

    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(token.error_description || "Discord token request failed.");
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const user = await userResponse.json() as DiscordUser;
    if (!userResponse.ok || !user.id) {
      throw new Error("Discord profile request failed.");
    }

    res.statusCode = 302;
    res.setHeader("Set-Cookie", [
      `blaze_session=${await makeSession(user)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
      "blaze_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    ]);
    res.setHeader("Location", "/");
    res.end();
  } catch (error) {
    res.statusCode = 302;
    res.setHeader("Location", `/?auth_error=${encodeURIComponent(error instanceof Error ? error.message : "Discord login failed")}`);
    res.end();
  }
}
