import { json, keyAuthSellerRequest, maskKey, normalizeLicenseKey, readBody } from "../src/server/keyauth";

type KeyRecord = {
  key?: string;
  status?: string;
  usedby?: string;
  expires?: number | string;
  expiry?: number | string;
  level?: number | string;
};

function extractKeys(value: unknown): KeyRecord[] {
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  const keys = data.keys;
  if (Array.isArray(keys)) return keys as KeyRecord[];
  if (keys && typeof keys === "object") return Object.values(keys as Record<string, KeyRecord>);
  return [];
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    json(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const license = normalizeLicenseKey(body.license);

    if (!license) {
      json(res, 400, { success: false, message: "Enter a license key." });
      return;
    }

    const result = await keyAuthSellerRequest({
      type: "fetchallkeys",
      format: "JSON"
    });

    if (!result.success) {
      json(res, 400, result);
      return;
    }

    const match = extractKeys(result).find((item) => String(item.key ?? "").trim() === license);
    if (!match) {
      json(res, 404, { success: false, message: "License was not found." });
      return;
    }

    json(res, 200, {
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
    json(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Redeem failed"
    });
  }
}
