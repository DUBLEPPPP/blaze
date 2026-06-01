import { json, keyAuthSellerRequest, normalizeLicenseKey, readBody } from "./_keyauth";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    json(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const user = normalizeLicenseKey(body.user);

    if (!user) {
      json(res, 400, { success: false, message: "Enter the KeyAuth username to reset." });
      return;
    }

    const result = await keyAuthSellerRequest({
      type: "resetuser",
      user
    });

    json(res, result.success ? 200 : 400, result);
  } catch (error) {
    json(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Reset failed"
    });
  }
}
