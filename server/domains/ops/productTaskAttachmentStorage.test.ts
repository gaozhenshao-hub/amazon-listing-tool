import { describe, expect, it, vi } from "vitest";
import { createProductTaskAttachmentStorage } from "./productTaskAttachmentStorage";
import type { SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
const identity = { userId: 3, workspaceId: 7 }, operationId = "11ad21b6-18f1-4d4f-8ddf-000000000001";
const command = { expectedWorkspaceId: 7, operationId, action: "upload" as const, taskId: 11, expectedVersion: "a".repeat(64), name: "中文证据.pdf", base64: Buffer.from("private content").toString("base64") };
function fixture() {
  const body = Buffer.from("private content"), put = vi.fn(async (key: string) => ({ key, storageUri: `storage://oss/${key}`, url: "https://objects.example.test/private?signature=secret" })), get = vi.fn(async (key: string) => ({ key, url: "https://objects.example.test/private?signature=secret" })), request = vi.fn(async () => ({ ok: true, status: 200, body }) as SafeHttpResponse);
  const deps = { assertPrivate: vi.fn(), provider: () => "oss" as const, configured: () => true, put, get, request }, storage = createProductTaskAttachmentStorage(deps);
  return { deps, storage, body, put, get, request, ...storage.plan(identity, command) };
}
describe("private task attachment bounded storage adapter", () => {
  it("plans a provider/scoped deterministic object without any network", () => { const f = fixture(); expect(f.prepared.objectKey).toMatch(/^ops-tasks\/7\/11\/[a-f0-9]{64}\.pdf$/u); expect(f.put).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.storage.plan(identity, command).prepared).toEqual(f.prepared); });
  it("performs exactly one PUT with binary content and no public URL exposure", async () => { const f = fixture(); expect(await f.storage.putOnce(f.prepared, f.bytes)).toBeUndefined(); expect(f.put).toHaveBeenCalledTimes(1); expect(f.put).toHaveBeenCalledWith(f.prepared.objectKey, f.bytes, "application/octet-stream"); });
  it("never retries a PUT with unknown outcome", async () => { const f = fixture(); f.put.mockRejectedValue(new Error("signature=secret")); await expect(f.storage.putOnce(f.prepared, f.bytes)).rejects.toThrow("PUT_UNCONFIRMED"); expect(f.put).toHaveBeenCalledTimes(1); });
  it("checks upload bytes against the durable prepared content", async () => { const f = fixture(); await expect(f.storage.putOnce(f.prepared, Buffer.from("different bytes"))).rejects.toThrow("CONTENT_MISMATCH"); expect(f.put).not.toHaveBeenCalled(); });
  it("recovers by private GET+size+SHA with no second PUT", async () => { const f = fixture(); await f.storage.verify(f.prepared); expect(f.put).not.toHaveBeenCalled(); expect(f.get).toHaveBeenCalledWith(f.prepared.objectKey, { expectedProvider: "oss", expiresSeconds: 60 }); expect(f.request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ maxRedirects: 0, maxResponseBytes: f.bytes.length, timeoutMs: 30000, method: "GET" })); });
  it.each(["size", "hash", "missing", "partial", "redirect", "network"])("refuses unverified recovery object: %s", async kind => {
    const f = fixture(); const response = { ok: true, status: 200, body: f.bytes } as SafeHttpResponse;
    if (kind === "size") response.body = Buffer.from("x"); if (kind === "hash") response.body = Buffer.alloc(f.bytes.length); if (kind === "missing") { response.ok = false; response.status = 404; } if (kind === "partial") response.status = 206; if (kind === "redirect") response.status = 302;
    if (kind === "network") f.request.mockRejectedValue(new Error("private signed URL")); else f.request.mockResolvedValue(response);
    await expect(f.storage.verify(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED"); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["public", "forge", "unconfigured"])("declares %s storage unavailable without attempting a call", kind => {
    const f = fixture(), storage = createProductTaskAttachmentStorage({ ...f.deps, ...(kind === "public" ? { assertPrivate: () => { throw new Error("public"); } } : {}), ...(kind === "forge" ? { provider: () => "forge" as const } : {}), ...(kind === "unconfigured" ? { configured: () => false } : {}) });
    expect(storage.capability().status).toBe("unavailable"); expect(() => storage.plan(identity, command)).toThrow("STORAGE_UNAVAILABLE"); expect(f.put).not.toHaveBeenCalled();
  });
  it("rejects provider rebinding before PUT or GET", async () => { const f = fixture(), storage = createProductTaskAttachmentStorage({ ...f.deps, provider: () => "s3" }); await expect(storage.verify(f.prepared)).rejects.toThrow("PROVIDER_CHANGED"); await expect(storage.putOnce(f.prepared, f.bytes)).rejects.toThrow("PROVIDER_CHANGED"); expect(f.get).not.toHaveBeenCalled(); });
  it("returns a 60-second HTTPS link for an already authorized scoped attachment", async () => { const f = fixture(); expect(await f.storage.download({ workspaceId: 7, taskId: 11, storageUri: f.prepared.storageUri })).toEqual({ url: "https://objects.example.test/private?signature=secret", expiresSeconds: 60 }); expect(f.get).toHaveBeenCalledWith(f.prepared.objectKey, { expectedProvider: "oss", expiresSeconds: 60 }); });
  it.each(["storage://s3/ops-tasks/7/11/a.pdf", "storage://oss/ops-tasks/8/11/a.pdf", "storage://oss/ops-tasks/7/12/a.pdf", "storage://oss/ops-tasks/7/11/../a.pdf", "https://example.test/public.pdf", "storage://oss/ops-tasks/7/11/a.exe"])("refuses uncontrolled object reference %s", async storageUri => { const f = fixture(); await expect(f.storage.download({ workspaceId: 7, taskId: 11, storageUri })).rejects.toThrow(); expect(f.get).not.toHaveBeenCalled(); });
  it.each(["http://objects.example.test/a", "https://user:pass@objects.example.test/a", "https://objects.example.test/a#x"])("rejects unsafe signed transport %s", async url => { const f = fixture(); f.get.mockImplementation(async key => ({ key, url })); await expect(f.storage.download({ workspaceId: 7, taskId: 11, storageUri: f.prepared.storageUri })).rejects.toThrow("DOWNLOAD_UNAVAILABLE"); });
});
