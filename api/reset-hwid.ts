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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const user = String(body.user ?? "").trim();

    if (!user) {
      sendJson(res, 400, { success: false, message: "Enter the KeyAuth username to reset." });
      return;
    }

    const result = await keyAuthSellerRequest({
      type: "resetuser",
      user
    });

    sendJson(res, result.success ? 200 : 400, result);
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Reset failed"
    });
  }
}
