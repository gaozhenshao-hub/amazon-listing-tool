import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";

export function localObjectPath(key: string): string {
  if (!key || key.length > 1024 || key.includes("\\") || key.includes("\0") || key.startsWith("/") || key.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error("Invalid local storage key");
  }
  const root = path.resolve(process.env.LOCAL_STORAGE_DIR || "data/objects");
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid local storage path");
  return file;
}

function signature(key: string, expires: number): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("Local storage requires a configured signing secret");
  return createHmac("sha256", secret).update(`local-object-v1\n${key}\n${expires}`).digest("hex");
}

export function signedLocalObjectUrl(key: string, ttl = 3600): string {
  localObjectPath(key);
  const origin = process.env.APP_PUBLIC_URL;
  if (!origin) throw new Error("APP_PUBLIC_URL is required for local storage");
  const url = new URL("/api/local-objects", origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Local storage requires HTTPS");
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new Error("Invalid local object expiry");
  const expires = Math.floor(Date.now() / 1000) + ttl;
  url.search = new URLSearchParams({ key, expires: String(expires), signature: signature(key, expires) }).toString();
  return url.href;
}

export function verifyLocalObjectSignature(key: string, expires: number, supplied: string): boolean {
  try {
    localObjectPath(key);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires < now || expires > now + 3600 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(key, expires), "hex"));
  } catch { return false; }
}

export async function putLocalObject(key: string, data: Buffer | Uint8Array | string) {
  const file = localObjectPath(key);
  const url = signedLocalObjectUrl(key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const root = await realpath(path.resolve(process.env.LOCAL_STORAGE_DIR || "data/objects"));
  const parent = await realpath(path.dirname(file));
  if (parent !== root && !parent.startsWith(root + path.sep)) throw new Error("Invalid local storage directory");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, file);
  return { key, url, storageUri: `storage://local/${key}` };
}

export function registerLocalObjectRoutes(app: Express) {
  app.get("/api/local-objects", async (req, res) => {
    const { key, expires, signature: supplied } = req.query;
    if (typeof key !== "string" || typeof expires !== "string" || typeof supplied !== "string" || !verifyLocalObjectSignature(key, Number(expires), supplied)) {
      res.status(403).end(); return;
    }
    let file: string;
    try { file = await verifiedLocalObjectPath(key); } catch { res.status(404).end(); return; }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=60");
    const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".json": "application/json" };
    types[".mp4"]="video/mp4";
    types[".flac"]="audio/flac";
    res.type(types[path.extname(key).toLowerCase()] || "application/octet-stream");
    res.sendFile(file, { dotfiles: "deny" }, error => {
      if (error && !res.headersSent) res.status(404).end();
    });
  });
}

/** Resolve existing objects inside the mounted root; never follow an escaping symlink. */
export async function verifiedLocalObjectPath(key: string): Promise<string> {
  const file = localObjectPath(key);
  const root = await realpath(path.resolve(process.env.LOCAL_STORAGE_DIR || "data/objects"));
  const resolved = await realpath(file);
  if (!resolved.startsWith(root + path.sep) || !(await lstat(resolved)).isFile()) throw new Error("Invalid local object");
  return resolved;
}
