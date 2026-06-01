type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  level?: number | string;
};

function sendJson(res: any, status: number, body: unknown) {
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const license = String(body.license ?? "").trim();

    if (!license) {
      sendJson(res, 400, { success: false, message: "Enter a license key." });
      return;
    }

    const result = await keyAuthSellerRequest({
      type: "fetchallkeys",
      format: "JSON"
    });

    if (!result.success) {
      sendJson(res, 400, result);
      return;
    }

    const match = extractKeys(result).find((item) => String(item.key ?? "").trim() === license);
    if (!match) {
      sendJson(res, 404, { success: false, message: "License was not found." });
      return;
    }

    sendJson(res, 200, {
      success: true,
      message: "License found.",
      license: {
        key: maskKey(license),
        status: match.status ?? "unknown",
        user: match.usedby ?? "",
        level: match.level ?? 1,
        expires: match.expires ?? match.expiry ?? null
      }
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Redeem failed"
    });
  }
}
