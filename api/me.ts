import crypto from "node:crypto";

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

export default function handler(req: any, res: any) {
  try {
    const session = readSession(req);
    if (!session) {
      json(res, 401, { success: false, message: "Not logged in." });
      return;
    }
    json(res, 200, { success: true, session });
  } catch {
    json(res, 401, { success: false, message: "Invalid session." });
  }
}
