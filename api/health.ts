export default function handler(req: any, res: any) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    success: true,
    message: "API online",
    hasSellerKey: Boolean(process.env.KEYAUTH_SELLER_KEY),
    app: process.env.KEYAUTH_APP_NAME ?? "blaze",
    ownerId: process.env.KEYAUTH_OWNER_ID ?? "EXhIuzzp52",
    version: process.env.KEYAUTH_VERSION ?? "1.0"
  }));
}
