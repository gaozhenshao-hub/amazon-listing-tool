import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTaskLocalStorage } from "./productTaskLocalStorage";
import { createProductTaskAttachmentStorage } from "./productTaskAttachmentStorage";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "task-private-storage-"));
  roots.push(root);
  await chmod(root, 0o700);
  await writeFile(join(root, ".storage-id"), randomUUID(), { mode: 0o600 });
  const local = createProductTaskLocalStorage(() => root);
  const storage = createProductTaskAttachmentStorage({ provider: () => "local", local });
  const identity = { userId: 3, workspaceId: 7 };
  const command = { expectedWorkspaceId: 7, operationId: randomUUID(), action: "upload" as const, taskId: 11, expectedVersion: "a".repeat(64), name: "proof.pdf", base64: Buffer.from("private proof").toString("base64") };
  const { prepared, bytes } = storage.plan(identity, command);
  return { root, local, storage, prepared, bytes, input: { workspaceId: 7, taskId: 11, storageUri: prepared.storageUri } };
}
describe("private local task attachments", () => {
  it("persists and recovers original bytes; downloads have no public file URL", async () => {
    const f = await fixture();
    expect(f.storage.capability().status).toBe("available");
    await f.storage.putOnce(f.prepared, f.bytes);
    await f.storage.verify(f.prepared);
    expect(await f.storage.download(f.input)).toEqual({ base64: f.bytes.toString("base64"), byteSize: f.bytes.length, contentHash: createHash("sha256").update(f.bytes).digest("hex") });
    await expect(f.storage.putOnce(f.prepared, f.bytes)).rejects.toThrow("PUT_UNCONFIRMED");
    await f.storage.verify(f.prepared);
  });
  it("refuses cross-task/workspace references and changed mounted volume", async () => {
    const f = await fixture();
    await f.storage.putOnce(f.prepared, f.bytes);
    await expect(f.storage.download({ ...f.input, taskId: 12 })).rejects.toThrow("REFERENCE_INVALID");
    await expect(f.storage.download({ ...f.input, workspaceId: 8 })).rejects.toThrow("REFERENCE_INVALID");
    await writeFile(join(f.root, ".storage-id"), randomUUID());
    await expect(f.storage.verify(f.prepared)).rejects.toThrow("PROVIDER_CHANGED");
    await expect(f.storage.download(f.input)).rejects.toThrow("DOWNLOAD_UNAVAILABLE");
  });
  it("refuses changed bytes even with the same size", async () => {
    const f = await fixture();
    await f.storage.putOnce(f.prepared, f.bytes);
    const filename = (await readdir(f.root)).find(name => name.endsWith(".attachment"))!;
    await writeFile(join(f.root, filename), Buffer.alloc(f.bytes.length));
    await expect(f.storage.verify(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED");
    await expect(f.storage.download(f.input)).rejects.toThrow("DOWNLOAD_UNAVAILABLE");
  });
  it("does not enable local storage without a private mounted root", () => {
    const storage = createProductTaskAttachmentStorage({ provider: () => "local", local: createProductTaskLocalStorage(() => "") });
    expect(storage.capability().status).toBe("unavailable");
  });
});
