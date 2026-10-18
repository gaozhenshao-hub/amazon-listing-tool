import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInventoryCollectionTransport } from "./inventoryCollectionTransport";
import { inventoryCollectionPageRequest, inventoryCollectionShippingRequest, inventoryCollectionDetailRequest, INVENTORY_COLLECTION_LIMITS } from "../../../shared/inventorySnapshotCollection";
import type { SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
const credentials = { workspaceId: 7, appId: "synthetic-app", secret: "synthetic-secret", connectionVersion: "a".repeat(64) };
function response(value: unknown, status = 200, bytes?: number): SafeHttpResponse {
  const body = Buffer.from(JSON.stringify(value));
  return { status, body: bytes === undefined ? body : Buffer.concat([body, Buffer.alloc(Math.max(0, bytes - body.byteLength), 32)]), json: () => value } as SafeHttpResponse;
}
const success = () => response({ code: 0, data: { rows: [], totalSize: 0, pageNo: "1" } });
function setup() {
  const request = vi.fn().mockResolvedValue(success()); request.mockResolvedValueOnce(response({ code: 0, data: { access_token: "synthetic-token", expires_in: 1000 } }));
  const controller = new AbortController(), pause = vi.fn(async () => {}); let now = 1000;
  return { request, controller, pause, setNow: (value: number) => { now = value; }, read: createInventoryCollectionTransport(credentials, controller.signal, { request, pause, now: () => now, nonce: () => "42" }) };
}
describe("bounded signed inventory transport", () => {
  it("uses one token and exact legacy signature; fixed host, budgets, no redirects/retries", async () => {
    const t = setup(), req = inventoryCollectionPageRequest("fba", 1); await t.read(req); await t.read(inventoryCollectionPageRequest("fba", 2));
    expect(t.request).toHaveBeenCalledTimes(3); expect(t.pause).toHaveBeenCalledTimes(2);
    const auth = new URL(t.request.mock.calls[0][0]); expect(auth.origin).toBe("https://openapi.sellfox.com"); expect(auth.pathname).toBe("/api/oauth/v2/token.json");
    const [raw, options] = t.request.mock.calls[1], url = new URL(raw);
    const params = { access_token: "synthetic-token", client_id: credentials.appId, method: "post", nonce: "42", timestamp: "1000", url: req.endpoint };
    expect(url.searchParams.get("sign")).toBe(createHmac("sha256", credentials.secret).update(Object.keys(params).sort().map(key => `${key}=${params[key as keyof typeof params]}`).join("&")).digest("hex"));
    expect(options).toMatchObject({ method: "POST", body: JSON.stringify(req.body), allowedHosts: ["openapi.sellfox.com"], maxRedirects: 0, allowPrivateNetwork: false, maxResponseBytes: 4194304, timeoutMs: 60000 });
    expect(JSON.stringify(options.auditContext)).not.toMatch(/synthetic/);
  });
  it("returns whole vendor body and actual wire byte length", async () => {
    const t = setup(); const result = await t.read(inventoryCollectionPageRequest("catalogStart", 1));
    expect(result).toEqual({ httpStatus: 200, body: success().json(), wireByteLength: success().body.byteLength, receivedAt: 1000 });
  });
  it.each(["warehouses", "warehouse", "fba", "commodities", "aux", "auxParents", "listings", "shipping", "catalogStart", "catalogEnd"] as const)("supports complete %s request contract", async source => {
    const t = setup(); await t.read(inventoryCollectionPageRequest(source, 1)); expect(t.request).toHaveBeenCalledTimes(2);
  });
  it("supports exact shipping/detail requests", async () => { const t = setup(); await t.read(inventoryCollectionShippingRequest(["synthetic-ship"])); await t.read(inventoryCollectionDetailRequest("1")); expect(t.request).toHaveBeenCalledTimes(3); });
  it.each([301, 400, 401, 429, 500, 503])("does not retry or expose HTTP %i body", async status => {
    const t = setup();
    t.request.mockReset().mockResolvedValueOnce(response({ code: 0, data: { access_token: "synthetic-token" } })).mockResolvedValue(response({ code: 0, message: "secret" }, status));
    await expect(t.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow(/^INVENTORY_COLLECTION_VENDOR_HTTP_FAILED$/); expect(t.request).toHaveBeenCalledTimes(2);
  });
  it.each([40001, 40019, 40021, 9999, "0", null])("does not retry vendor code %s or refresh tokens", async code => {
    const t = setup(); t.request.mockReset().mockResolvedValueOnce(response({ code: 0, data: { access_token: "synthetic-token" } })).mockResolvedValue(response({ code, message: "private vendor response" }));
    await expect(t.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow(/^INVENTORY_COLLECTION_VENDOR_/); expect(t.request).toHaveBeenCalledTimes(2);
  });
  it("does not reflect network errors/URLs/cause", async () => { const t = setup(); t.request.mockReset().mockRejectedValue(new Error("https://host?client_secret=private")); const error = await t.read(inventoryCollectionPageRequest("fba", 1)).catch(e => e); expect(error.message).toBe("INVENTORY_COLLECTION_VENDOR_CONNECTION_FAILED"); expect(error.cause).toBeUndefined(); expect(t.request).toHaveBeenCalledTimes(1); });
  it.each([
    { ...inventoryCollectionPageRequest("fba", 1), endpoint: "https://evil.example" },
    { ...inventoryCollectionPageRequest("fba", 1), body: { ...inventoryCollectionPageRequest("fba", 1).body, hideZero: "true" } },
    { ...inventoryCollectionPageRequest("fba", 1), body: { ...inventoryCollectionPageRequest("fba", 1).body, pageSize: "5" } },
  ])("rejects altered request before credentials leave process", async req => { const t = setup(); await expect(t.read(req)).rejects.toThrow("REQUEST_INVALID"); expect(t.request).not.toHaveBeenCalled(); });
  it("aborted or exceeded deadline never calls vendor", async () => { const a = setup(); a.controller.abort(); await expect(a.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow("ABORTED"); expect(a.request).not.toHaveBeenCalled(); const b = setup(); b.setNow(3601001); await expect(b.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow("DEADLINE"); expect(b.request).not.toHaveBeenCalled(); });
  it("checks post-response abort and oversized body", async () => { const a = setup(); a.request.mockReset().mockImplementation(async () => { a.controller.abort(); return success(); }); await expect(a.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow("ABORTED"); const b = setup(); b.request.mockReset().mockResolvedValue(response({}, 200, 65537)); await expect(b.read(inventoryCollectionPageRequest("fba", 1))).rejects.toThrow("BUDGET"); });
  it("enforces cumulative actual wire bytes", async () => { const t = setup(); t.request.mockReset().mockResolvedValueOnce(response({ code: 0, data: { access_token: "synthetic-token" } })).mockResolvedValue(response(success().json(), 200, INVENTORY_COLLECTION_LIMITS.responseBytes)); for (let n = 1; n <= 4; n++) await t.read(inventoryCollectionPageRequest("fba", n)); await expect(t.read(inventoryCollectionPageRequest("fba", 5))).rejects.toThrow("BUDGET"); });
});
