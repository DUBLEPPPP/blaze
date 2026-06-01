type KeyAuthResponse = Record<string, unknown>;

export function json(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function requireSellerKey() {
  const sellerKey = process.env.KEYAUTH_SELLER_KEY;
  if (!sellerKey) {
    throw new Error("KEYAUTH_SELLER_KEY is not configured in Vercel.");
  }
  return sellerKey;
}

export function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 10000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export async function keyAuthSellerRequest(params: Record<string, string>): Promise<KeyAuthResponse> {
  const query = new URLSearchParams({
    sellerkey: requireSellerKey(),
    ...params
  });

  const response = await fetch(`https://keyauth.win/api/seller/?${query.toString()}`, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as KeyAuthResponse;
  } catch {
    throw new Error(`Invalid KeyAuth response (${response.status}): ${text.slice(0, 160)}`);
  }
}

export function normalizeLicenseKey(value: unknown) {
  return String(value ?? "").trim();
}

export function maskKey(key: string) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}-${"*".repeat(8)}-${key.slice(-4)}`;
}
