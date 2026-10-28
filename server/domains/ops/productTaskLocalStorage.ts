import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { PRODUCT_TASK_ATTACHMENT_MAX_BYTES } from "../../../shared/productTaskWrite";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fail = (): never => { throw new Error("TASK_ATTACHMENT_LOCAL_UNVERIFIED"); };

/** Private mounted volume. Files have no static HTTP route; every download goes
 * through current task authorization. References bind both volume and contents. */
export function createProductTaskLocalStorage(rootSetting = () => process.env.PRODUCT_TASK_LOCAL_ROOT ?? "") {
  function configuration() {
    try {
      const configured = rootSetting();
      if (!configured || !isAbsolute(configured)) return fail();
      const stat = lstatSync(configured), root = realpathSync(configured);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) return fail();
      const marker = join(root, ".storage-id"), info = lstatSync(marker);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 40) return fail();
      const volumeId = readFileSync(marker, "utf8").trim();
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(volumeId)) return fail();
      return { root, domainHash: hash(JSON.stringify({ root, volumeId })) };
    } catch { return fail(); }
  }
  function checked(key: string) {
    const config = configuration();
    const match = /^ops-tasks\/[1-9][0-9]*\/[1-9][0-9]*\/([a-f0-9]{64})-([a-f0-9]{64})-([1-9][0-9]*)-([a-f0-9]{64})\.[a-z0-9]+$/u.exec(key);
    if (!match || match[1] !== config.domainHash) return fail();
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size) || size > PRODUCT_TASK_ATTACHMENT_MAX_BYTES) return fail();
    return { ...config, size, contentHash: match[2], path: join(config.root, `${hash(key)}.attachment`) };
  }
  async function read(key: string) {
    const value = checked(key);
    const handle = await open(value.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size !== value.size) return fail();
      const bytes = Buffer.alloc(value.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const part = await handle.read(bytes, count, bytes.length - count, null);
        if (!part.bytesRead) break;
        count += part.bytesRead;
      }
      const result = bytes.subarray(0, count);
      if (count !== value.size || hash(result) !== value.contentHash) return fail();
      checked(key);
      return result;
    } finally { await handle.close(); }
  }
  async function put(key: string, bytes: Buffer) {
    const value = checked(key);
    if (bytes.length !== value.size || hash(bytes) !== value.contentHash) return fail();
    const handle = await open(value.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    if (process.platform !== "win32") {
      const directory = await open(value.root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    }
    checked(key);
  }
  return { configuration, read, put };
}
