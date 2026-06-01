import crypto from "node:crypto";

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

export default function handler(req: any, res: any) {
  const session = readSession(req);
  const license = session?.license;

  if (!session?.discord?.id) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, message: "Login with Discord first." }));
    return;
  }

  if (!license?.username || !license?.authToken) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, message: "Redeem your license again before downloading config." }));
    return;
  }

  const config = {
    app: "blaze",
    version: 1,
    auth: {
      mode: "keyauth-login",
      username: license.username,
      token: license.authToken
    },
    discord: {
      id: session.discord.id,
      name: session.discord.name
    },
    license: {
      status: license.status || "ACTIVE",
      days: license.days ?? null,
      expires: license.expires ?? null
    }
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=\"blaze-license.json\"");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(config, null, 2));
}
