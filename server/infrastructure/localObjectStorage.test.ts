import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localObjectPath, putLocalObject, signedLocalObjectUrl, verifiedLocalObjectPath, verifyLocalObjectSignature } from "./localObjectStorage";

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true }); });
describe("restored private local objects", () => {
  it("preserves original bytes and signs bounded read URLs without exposing a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-local-test-")); directories.push(root);
    vi.stubEnv("LOCAL_STORAGE_DIR", root); vi.stubEnv("JWT_SECRET", "synthetic-test-only-secret-000000000000"); vi.stubEnv("APP_PUBLIC_URL", "https://example.test");
    const key = "acquisition/1/snapshots/1/main/test.jpg", bytes = Buffer.from([255, 216, 255, 217]);
    const saved = await putLocalObject(key, bytes);
    expect(saved.storageUri).toBe(`storage://local/${key}`);
    expect(await readFile(await verifiedLocalObjectPath(key))).toEqual(bytes);
    const url = new URL(signedLocalObjectUrl(key, 60)), expires = Number(url.searchParams.get("expires")), signature = url.searchParams.get("signature")!;
    expect(verifyLocalObjectSignature(key, expires, signature)).toBe(true);
    expect(verifyLocalObjectSignature("other.jpg", expires, signature)).toBe(false);
    expect(verifyLocalObjectSignature(key, expires - 7200, signature)).toBe(false);
    expect(() => signedLocalObjectUrl(key, 100000)).toThrow();
  });
  it.each(["../secret", "/etc/passwd", "a/../../secret", "a\\secret", "a//b", "a/./b"])("rejects traversal %s", key => {
    expect(() => localObjectPath(key)).toThrow();
  });
});
