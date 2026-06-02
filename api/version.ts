import { readFile } from "node:fs/promises";
import path from "node:path";

const fallback = {
  version: "1.0.0",
  updatedAt: null,
  downloadPath: "/api/download-bundle",
  fileName: "Blaze.exe",
  notes: ""
};

export default async function handler(_req: any, res: any) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    const raw = await readFile(path.join(process.cwd(), "public", "version.json"), "utf8");
    res.end(raw);
  } catch {
    res.end(JSON.stringify(fallback));
  }
}
