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

async function getLastResetMs(user: string) {
  const result = await keyAuthSellerRequest({ type: "getvar", user, var: "hwid_last_reset" });
  if (!result.success) return 0;
  return readResetTimestamp(result.response);
}

async function setLastResetMs(user: string, timestamp: number) {
  await keyAuthSellerRequest({
    type: "setvar",
    user,
    var: "hwid_last_reset",
    data: String(timestamp),
    readonly: "false",
    readOnly: "false"
  });
}

async function clearBoundHwid(user: string) {
  await keyAuthSellerRequest({
    type: "setvar",
    user,
    var: "blaza_bound_hwid",
    data: "",
    readonly: "false",
    readOnly: "false"
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const session = readSession(req);
    const user = String(session?.license?.username || "");

    if (!session?.discord?.id) {
      sendJson(res, 401, { success: false, message: "Login with Discord first." });
      return;
    }

    if (!user) {
      sendJson(res, 400, { success: false, message: "Redeem a license before resetting HWID." });
      return;
    }

    const now = Date.now();
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    const lastReset = await getLastResetMs(user);
    const nextResetAt = lastReset > 0 ? lastReset + cooldownMs : 0;

    if (nextResetAt > now) {
      const daysLeft = Math.ceil((nextResetAt - now) / 86400000);
      sendJson(res, 429, {
        success: false,
        cooldown: true,
        daysLeft,
        nextResetAt,
        message: `You must wait ${daysLeft} day${daysLeft === 1 ? "" : "s"} before resetting HWID again.`
      });
      return;
    }

    const result = await keyAuthSellerRequest({ type: "resetuser", user });
    if (result.success) {
      await setLastResetMs(user, now);
      await clearBoundHwid(user);
    }

    sendJson(res, result.success ? 200 : 400, result);
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Reset failed"
    });
  }
}
