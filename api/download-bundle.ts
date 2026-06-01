import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

type ZipFile = {
  name: string;
  data: Buffer;
};

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

function json(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function encryptLicense(payload: Record<string, unknown>) {
  const secret = process.env.SESSION_SECRET || "change-this-session-secret";
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    "BLAZA1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function crc32(buffer: Buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function createZip(files: ZipFile[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"));
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function loadExecutable() {
  if (process.env.BLAZA_EXE_URL) {
    const response = await fetch(process.env.BLAZA_EXE_URL);
    if (!response.ok) throw new Error(`Could not download Blaza.exe (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  return readFile(path.join(process.cwd(), "public", "Blaza.exe")).catch(() => null);
}

async function loadPublicFile(name: string) {
  return readFile(path.join(process.cwd(), "public", name)).catch(() => null);
}

export default async function handler(req: any, res: any) {
  try {
    const session = readSession(req);
    const license = session?.license;

    if (!session?.discord?.id) {
      json(res, 401, { success: false, message: "Login with Discord first." });
      return;
    }

    if (!license?.username || !license?.authToken || String(license.status || "").toUpperCase() !== "ACTIVE") {
      json(res, 403, { success: false, message: "Redeem an active license before downloading." });
      return;
    }

    const token = encryptLicense({
      app: "blaze",
      version: 1,
      username: license.username,
      authToken: license.authToken,
      discordId: session.discord.id,
      discordName: session.discord.name,
      avatar: session.discord.avatar,
      issuedAt: Date.now()
    });

    const files: ZipFile[] = [
      { name: "license.dat", data: Buffer.from(token, "utf8") }
    ];
    const exe = await loadExecutable();
    if (exe) {
      files.unshift({ name: process.env.BLAZA_EXE_NAME || "Blaza.exe", data: exe });

      for (const dllName of ["libcurl.dll", "z.dll"]) {
        const dll = await loadPublicFile(dllName);
        if (dll) files.push({ name: dllName, data: dll });
      }
    } else {
      files.push({
        name: "README.txt",
        data: Buffer.from("Blaza.exe is not configured on the server yet. Add public/Blaza.exe or set BLAZA_EXE_URL in Vercel.\r\n", "utf8")
      });
    }

    const zip = createZip(files);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=\"BlazaPVP.zip\"");
    res.setHeader("Cache-Control", "no-store");
    res.end(zip);
  } catch (error) {
    json(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Could not create download."
    });
  }
}
