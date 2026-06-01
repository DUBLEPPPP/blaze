import crypto from "node:crypto";

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

function readResetTimestamp(value: unknown) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const data = value as Record<string, unknown>;
    return readResetTimestamp(data.response ?? data.value ?? data.data);
  }
  return 0;
}

export default async function handler(req: any, res: any) {
  try {
    const session = readSession(req);
    const user = String(session?.license?.username || "");

    if (!session?.discord?.id) {
      sendJson(res, 401, { success: false, message: "Login with Discord first." });
      return;
    }

    if (!user) {
      sendJson(res, 200, { success: true, available: false, message: "Redeem a license first." });
      return;
    }

    const result = await keyAuthSellerRequest({ type: "getvar", user, var: "hwid_last_reset" });
    const lastReset = result.success ? readResetTimestamp(result.response) : 0;
    const now = Date.now();
    const nextResetAt = lastReset > 0 ? lastReset + (30 * 24 * 60 * 60 * 1000) : 0;
    const available = !nextResetAt || nextResetAt <= now;
    const daysLeft = available ? 0 : Math.ceil((nextResetAt - now) / 86400000);

    sendJson(res, 200, {
      success: true,
      available,
      pending: !available,
      lastReset,
      nextResetAt,
      daysLeft,
      message: available ? "HWID reset is available." : `Wait ${daysLeft} day${daysLeft === 1 ? "" : "s"} before resetting again.`
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Could not load reset status"
    });
  }
}
