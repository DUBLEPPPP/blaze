export default function handler(req: any, res: any) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("DISCORD_CLIENT_ID is not configured.");
    return;
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${proto}://${host}/api/discord-callback`;
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state
  });

  res.statusCode = 302;
  res.setHeader("Set-Cookie", `blaze_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.setHeader("Location", `https://discord.com/oauth2/authorize?${params.toString()}`);
  res.end();
}
