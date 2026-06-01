import https from "node:https";

type KeyAuthResponse = Record<string, unknown>;

const sellerKey = process.env.KEYAUTH_SELLER_KEY;

export function json(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function requireSellerKey() {
  if (!sellerKey) {
    throw new Error("KEYAUTH_SELLER_KEY is not configured");
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

export function keyAuthSellerRequest(params: Record<string, string>): Promise<KeyAuthResponse> {
  const query = new URLSearchParams({
    sellerkey: requireSellerKey(),
    ...params
  });

  const url = `https://keyauth.win/api/seller/?${query.toString()}`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid KeyAuth response"));
          }
        });
      })
      .on("error", reject);
  });
}

export function normalizeLicenseKey(value: unknown) {
  return String(value ?? "").trim();
}

export function maskKey(key: string) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}-${"*".repeat(8)}-${key.slice(-4)}`;
}
