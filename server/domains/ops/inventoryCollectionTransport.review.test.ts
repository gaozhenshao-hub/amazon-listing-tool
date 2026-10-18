import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SafeHttpRequestOptions, SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
import { inventoryCollectionPageRequest } from "../../../shared/inventorySnapshotCollection";
vi.mock("../ai_os/services/toolGateway/governanceCore", () => ({ decryptToolSecretValue: () => "unused" }));
import { createInventoryCollectionTransport } from "./inventoryCollectionTransport";

const credentials = { workspaceId: 7, appId: "example-app", secret: "example-secret", connectionVersion: "a".repeat(64) };
function response(body: unknown, raw?: Buffer): SafeHttpResponse {
  const bytes = raw ?? Buffer.from(JSON.stringify(body));
  return { status: 200, statusText: "OK", ok: true, url: "https://openapi.sellfox.com", headers: { get: () => null } as never,
    body: bytes, text: () => bytes.toString("utf8"), json: <T>() => JSON.parse(bytes.toString("utf8")) as T,
    arrayBuffer: () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}
const token = () => response({ code: 0, data: { access_token: "example-token", expires_in: 3600000 } });
const page = () => response({ code: 0, data: { pageNo: 1, totalSize: 1, rows: [{ id: 7, name: "店铺", region: "NA" }] } });
function fixture() {
  const controller = new AbortController();
  const request = vi.fn(async (url: string | URL, _options?: SafeHttpRequestOptions): Promise<SafeHttpResponse> => new URL(String(url)).pathname.includes("token.json") ? token() : page());
  const pause = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const read = createInventoryCollectionTransport({ ...credentials }, controller.signal, { request, pause, now: () => 2000, nonce: () => "123" });
  return { controller, request, pause, read };
}

describe("independent inventory transport adversarial review", () => {
  it.each(["source", "token"])("rejects illegal original UTF8 in %s without silently replacing source bytes", async kind => {
    const f = fixture(), raw = kind === "source"
      ? Buffer.concat([Buffer.from('{"code":0,"data":{"pageNo":1,"totalSize":1,"rows":[{"id":7,"name":"'), Buffer.from([0xff]), Buffer.from('"}]}}')])
      : Buffer.concat([Buffer.from('{"code":0,"data":{"access_token":"'), Buffer.from([0xff]), Buffer.from('","expires_in":3600000}}')]);
    f.request.mockImplementation(async url => {
      const isToken = new URL(String(url)).pathname.includes("token.json");
      return (kind === "token") === isToken ? response(null, raw) : isToken ? token() : page();
    });
    await expect(f.read(inventoryCollectionPageRequest("catalogStart", 1))).rejects.toThrow("INVENTORY_COLLECTION_VENDOR_RESPONSE_INVALID");
  });
  it("freezes the validated endpoint/body before awaiting token and rate limiter", async () => {
    const f = fixture(); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.request.mockImplementation(async url => { if (new URL(String(url)).pathname.includes("token.json")) { await held; return token(); } return page(); });
    const input = inventoryCollectionPageRequest("catalogStart", 1), expectedBody = JSON.stringify(input.body), operation = f.read(input);
    input.endpoint = "/api/unapproved-write.json"; input.body = { arbitraryMutation: true }; release();
    await operation;
    expect(f.request.mock.calls).toHaveLength(2);
    expect(new URL(String(f.request.mock.calls[1][0])).pathname).toBe("/api/shop/pageList.json");
    expect(f.request.mock.calls[1][1]?.body).toBe(expectedBody);
  });
  it("does not leak upstream errors, signed URL, app secret or token into surfaced errors", async () => {
    const f = fixture(); f.request.mockImplementation(async url => { if (new URL(String(url)).pathname.includes("token.json")) return token(); throw new Error(`network secret ${credentials.secret} ${url}`); });
    try { await f.read(inventoryCollectionPageRequest("fba", 1)); throw new Error("must reject"); }
    catch (error) { expect(String(error)).toContain("INVENTORY_COLLECTION_VENDOR_CONNECTION_FAILED"); expect(JSON.stringify(error)).not.toContain(credentials.secret); expect(String(error)).not.toContain("access_token"); expect((error as Error).cause).toBeUndefined(); }
  });
  it("matches the fixed friend's HMAC parameters without signing an altered URL/body", async () => {
    const f = fixture(); await f.read(inventoryCollectionPageRequest("fba", 1));
    const url = new URL(String(f.request.mock.calls[1][0]));
    const canonical = "access_token=example-token&client_id=example-app&method=post&nonce=123&timestamp=2000&url=/api/inventoryManage/fba/pageList.json";
    expect(url.searchParams.get("sign")).toBe(createHmac("sha256", credentials.secret).update(canonical).digest("hex"));
    expect(f.request.mock.calls[1][1]).toMatchObject({ allowedHosts: ["openapi.sellfox.com"], allowPrivateNetwork: false, maxRedirects: 0, timeoutMs: 60000, method: "POST", maxResponseBytes: 4 * 1024 * 1024 });
  });
  it.each([40019, 40001, 123456, "40019", null])("fails safely on vendor code %j and never retries", async code => {
    const f = fixture(); f.request.mockImplementation(async url => new URL(String(url)).pathname.includes("token.json") ? token() : response({ code, message: `${credentials.secret}: unsafe vendor text` }));
    await expect(f.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow(/^INVENTORY_COLLECTION_VENDOR_/u); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("aborts after token retrieval without sending the subsequent inventory POST", async () => {
    const f = fixture(); f.request.mockImplementation(async () => { f.controller.abort(); return token(); });
    await expect(f.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow("ABORTED"); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("rejects a caller-added store filter before token or inventory network access", async () => {
    const f = fixture(), input = inventoryCollectionPageRequest("fba", 1); input.body.storeId = "OTHER";
    await expect(f.read(input)).rejects.toThrow("REQUEST_INVALID"); expect(f.request).not.toHaveBeenCalled();
  });
  it("enforces the separate one-hour wall-time budget before another source POST", async () => {
    let now = 1; const controller = new AbortController();
    const request = vi.fn(async () => token());
    const read = createInventoryCollectionTransport({ ...credentials }, controller.signal, { request, now: () => now, nonce: () => "123", pause: async () => { now += 3600001; } });
    await expect(read(inventoryCollectionPageRequest("catalogStart", 1))).rejects.toThrow("INVENTORY_COLLECTION_COLLECTION_DEADLINE");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
