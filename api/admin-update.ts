import crypto from "node:crypto";

const ADMIN_DISCORD_ID = "1147035957175009321";

function json(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function parseCookies(req: any) {
  const raw = String(req.headers.cookie || "");
  return Object.fromEntries(raw.split(";").map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("=") || "")];
  }).filter(([key]) => key));
}

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET || "change-this-session-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function readSession(req: any) {
  const token = parseCookies(req).blaze_session;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function readBody(req: any, limit = 5_000_000) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > limit) {
        reject(new Error("Upload too large for this endpoint."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function requireAdmin(req: any) {
  const session = readSession(req);
  if (!session?.discord?.id || String(session.discord.id) !== ADMIN_DISCORD_ID) return null;
  return session;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

async function getGithubFile(owner: string, repo: string, path: string, branch: string, token: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blaze-admin-updater"
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub read failed: ${response.status}`);
  return await response.json() as { sha?: string };
}

async function putGithubFile(owner: string, repo: string, path: string, branch: string, token: string, contentBase64: string, message: string) {
  const current = await getGithubFile(owner, repo, path, branch, token);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blaze-admin-updater"
    },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch,
      ...(current?.sha ? { sha: current.sha } : {})
    })
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch {}
    throw new Error(`GitHub update failed: ${detail}`);
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      json(res, 405, { success: false, message: "Method not allowed." });
      return;
    }

    const session = requireAdmin(req);
    if (!session) {
      json(res, 403, { success: false, message: "Admin access denied." });
      return;
    }

    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const version = String(body.version || "").trim();
    const notes = String(body.notes || "").trim().slice(0, 500);
    const fileBase64 = String(body.fileBase64 || "").replace(/^data:.*?;base64,/, "");

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      json(res, 400, { success: false, message: "Use version format like 1.0.1." });
      return;
    }

    const exe = Buffer.from(fileBase64, "base64");
    if (exe.length < 1024 || exe.slice(0, 2).toString("ascii") !== "MZ") {
      json(res, 400, { success: false, message: "Upload a valid Windows .exe file." });
      return;
    }

    const token = requireEnv("GITHUB_TOKEN");
    const owner = process.env.GITHUB_REPO_OWNER || "DUBLEPPPP";
    const repo = process.env.GITHUB_REPO_NAME || "blaze";
    const branch = process.env.GITHUB_BRANCH || "main";
    const updatedAt = new Date().toISOString();

    const versionJson = {
      version,
      updatedAt,
      downloadPath: "/api/download-bundle",
      fileName: "Blaze.exe",
      notes,
      updatedBy: String(session.discord.id)
    };

    await putGithubFile(owner, repo, "public/Blaza.exe", branch, token, exe.toString("base64"), `Update Blaze exe to ${version}`);
    await putGithubFile(owner, repo, "public/version.json", branch, token, Buffer.from(JSON.stringify(versionJson, null, 2), "utf8").toString("base64"), `Update Blaze version to ${version}`);

    json(res, 200, { success: true, version: versionJson, message: "Update uploaded. Vercel will redeploy from GitHub." });
  } catch (error) {
    json(res, 500, { success: false, message: error instanceof Error ? error.message : "Admin update failed." });
  }
}
