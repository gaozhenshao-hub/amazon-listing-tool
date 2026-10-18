import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMonthlyFinancialImportStorage } from "./monthlyFinancialImportStorage";
import type { SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
import { monthlyFinancialWriteHash } from "../../../shared/monthlyFinancialWrite";

const identity = { userId: 3, workspaceId: 7 }, operationId = "11ad21b6-18f1-4d4f-8ddf-000000000001";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const body = Buffer.from("月份,店铺,站点,毛利润\n2026-09,合成店铺,US,1.25\n");
  const put = vi.fn(async (key: string) => ({ key, storageUri: `storage://oss/${key}`, url: "https://objects.example.test/private?signature=secret" }));
  const get = vi.fn(async (key: string) => ({ key, url: "https://objects.example.test/private?signature=secret" }));
  const request = vi.fn(async () => ({ ok: true, status: 200, body }) as SafeHttpResponse);
  const deps = { assertPrivate: vi.fn(), provider: () => "oss" as const, configured: () => true, put, get, request };
  const storage = createMonthlyFinancialImportStorage(deps);
  const file = { fileName: "完整月报.csv", format: "csv" as const, fileHash: hash(body), byteSize: body.length };
  const metadata = { ...file, requestHash: monthlyFinancialWriteHash({ action: "upload", expectedWorkspaceId: identity.workspaceId, operationId, ...file }) };
  return { storage, deps, body, put, get, request, metadata, prepared: storage.prepare(identity, operationId, metadata) };
}

describe("private monthly original-file storage", () => {
  it("plans deterministic scoped metadata without network or exposing a URL", () => {
    const f = fixture();
    expect(f.prepared.objectKey).toMatch(/^monthly-financial\/7\/[a-f0-9]{64}\.csv$/u);
    expect(f.storage.prepare(identity, operationId, f.metadata)).toEqual(f.prepared);
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    expect(f.prepared).not.toHaveProperty("url");
  });
  it("retains UTF-8 original bytes and performs exactly one private PUT", async () => {
    const f = fixture(); await f.storage.putOnce(f.prepared, f.body);
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.put).toHaveBeenCalledWith(f.prepared.objectKey, f.body, "text/csv; charset=utf-8", { maxAttempts: 1 });
  });
  it("retains XLSX format and MIME without conversion", async () => {
    const f = fixture(); const file = { fileName: "月报.xlsx", format: "xlsx" as const, fileHash: hash(f.body), byteSize: f.body.length };
    const prepared = f.storage.prepare(identity, operationId, { ...file, requestHash: monthlyFinancialWriteHash({ action: "upload", expectedWorkspaceId: identity.workspaceId, operationId, ...file }) });
    await f.storage.putOnce(prepared, f.body);
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.put).toHaveBeenCalledWith(prepared.objectKey, f.body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { maxAttempts: 1 });
  });
  it("never retries an unknown PUT or exposes the underlying signed error", async () => {
    const f = fixture(); f.put.mockRejectedValue(new Error("secret signature"));
    await expect(f.storage.putOnce(f.prepared, f.body)).rejects.toThrow("MONTHLY_STORAGE_PUT_UNCONFIRMED");
    expect(f.put).toHaveBeenCalledTimes(1);
  });
  it("rejects bytes different from durable prepare before I/O", async () => {
    const f = fixture(); await expect(f.storage.putOnce(f.prepared, Buffer.alloc(f.body.length))).rejects.toThrow("CONTENT_MISMATCH");
    expect(f.put).not.toHaveBeenCalled();
  });
  it("recovers exact original bytes with bounded HTTPS GET, never a second PUT", async () => {
    const f = fixture(); const restored = await f.storage.readVerified(f.prepared);
    expect(Buffer.from(restored)).toEqual(f.body); expect(restored).not.toBe(f.body);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.get).toHaveBeenCalledWith(f.prepared.objectKey, { expectedProvider: "oss", expiresSeconds: 60 });
    expect(f.request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "GET", maxRedirects: 0, maxResponseBytes: f.body.length, timeoutMs: 30000, allowedHosts: ["objects.example.test"] }));
  });
  it.each(["size", "hash", "missing", "partial", "redirect", "network"])("refuses unverifiable original: %s", async kind => {
    const f = fixture(), response = { ok: true, status: 200, body: f.body } as SafeHttpResponse;
    if (kind === "size") response.body = Buffer.from("x");
    if (kind === "hash") response.body = Buffer.alloc(f.body.length);
    if (kind === "missing") { response.ok = false; response.status = 404; }
    if (kind === "partial") response.status = 206;
    if (kind === "redirect") response.status = 302;
    if (kind === "network") f.request.mockRejectedValue(new Error("private signed URL")); else f.request.mockResolvedValue(response);
    await expect(f.storage.readVerified(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED"); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["public", "forge", "unconfigured"])("makes %s storage unavailable without I/O", kind => {
    const f = fixture(), storage = createMonthlyFinancialImportStorage({ ...f.deps,
      ...(kind === "public" ? { assertPrivate: () => { throw new Error("public"); } } : {}),
      ...(kind === "forge" ? { provider: () => "forge" as const } : {}),
      ...(kind === "unconfigured" ? { configured: () => false } : {}) });
    expect(storage.capability().status).toBe("unavailable");
    expect(() => storage.prepare(identity, operationId, f.metadata)).toThrow("STORAGE_UNAVAILABLE");
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });
  it("rejects provider rebinding before network", async () => {
    const f = fixture(), storage = createMonthlyFinancialImportStorage({ ...f.deps, provider: () => "s3" });
    await expect(storage.readVerified(f.prepared)).rejects.toThrow("PROVIDER_CHANGED");
    await expect(storage.putOnce(f.prepared, f.body)).rejects.toThrow("PROVIDER_CHANGED");
    await expect(storage.download(f.prepared)).rejects.toThrow("PROVIDER_CHANGED"); expect(f.get).not.toHaveBeenCalled();
  });
  it("provides a 60-second private HTTPS link from a trusted scoped record", async () => {
    const f = fixture();
    expect(await f.storage.download(f.prepared)).toEqual({ url: "https://objects.example.test/private?signature=secret", expiresSeconds: 60 });
    expect(f.put).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["http://objects.example.test/a", "https://user:pass@objects.example.test/a", "https://objects.example.test/a#fragment", "https://objects.example.test:8443/a"])("rejects unsafe signed transport %s", async url => {
    const f = fixture(); f.get.mockImplementation(async key => ({ key, url }));
    await expect(f.storage.download(f.prepared)).rejects.toThrow("DOWNLOAD_UNAVAILABLE");
    await expect(f.storage.readVerified(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED"); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["other_workspace", "key_traversal", "other_provider", "public_url", "key_digest"])("rejects forged prepared reference: %s", async kind => {
    const f = fixture(), prepared = { ...f.prepared };
    if (kind === "other_workspace") prepared.identity = { ...prepared.identity, workspaceId: 8 };
    if (kind === "key_traversal") prepared.objectKey = "monthly-financial/7/../a.csv";
    if (kind === "other_provider") prepared.storageUri = prepared.storageUri.replace("oss", "s3");
    if (kind === "public_url") prepared.storageUri = "https://example.test/public.csv";
    if (kind === "key_digest") { prepared.objectKey = `monthly-financial/7/${"b".repeat(64)}.csv`; prepared.storageUri = `storage://oss/${prepared.objectKey}`; }
    await expect(f.storage.download(prepared)).rejects.toThrow(); expect(f.get).not.toHaveBeenCalled();
  });
  it("checks PUT acknowledgement key/provider rather than trusting the returned URL", async () => {
    const f = fixture(); f.put.mockImplementation(async key => ({ key, storageUri: `storage://s3/${key}`, url: "https://example.test/public" }));
    await expect(f.storage.putOnce(f.prepared, f.body)).rejects.toThrow("PUT_UNCONFIRMED"); expect(f.put).toHaveBeenCalledTimes(1);
  });
});
