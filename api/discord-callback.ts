import crypto from "node:crypto";
import { findDiscordLicense } from "../src/server/license";

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  accent_color?: number | null;
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

async function makeSession(user: DiscordUser) {
  const banner = user.banner
    ? `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.png?size=1024`
    : null;

  const payload = base64url(JSON.stringify({
    discord: {
      id: user.id,
      username: user.username,
      name: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`,
      banner,
      accentColor: user.accent_color ?? null
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
