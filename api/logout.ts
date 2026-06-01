export default function handler(req: any, res: any) {
  res.statusCode = 302;
  res.setHeader("Set-Cookie", "blaze_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  res.setHeader("Location", "/");
  res.end();
}
