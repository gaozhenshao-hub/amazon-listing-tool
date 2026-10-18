import { createHmac, randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  INVENTORY_COLLECTION_LIMITS, inventoryCollectionCanonical, inventoryCollectionPageRequest,
  inventoryCollectionShippingRequest, inventoryCollectionDetailRequest,
  type InventoryCollectionRead, type InventoryCollectionRequest,
} from "../../../shared/inventorySnapshotCollection";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { INVENTORY_VENDOR_ORIGIN, type InventoryCollectionCredentials } from "./inventoryCollectionConfig";

export class InventoryCollectionTransportError extends Error {
  constructor(public readonly reasonCode: string) { super(`INVENTORY_COLLECTION_${reasonCode.toUpperCase()}`); this.name = "InventoryCollectionTransportError"; }
}
const fail = (code: string): never => { throw new InventoryCollectionTransportError(code); };
function validateRequest(value: InventoryCollectionRequest) {
  let expected: InventoryCollectionRequest;
  try {
    if (value.source === "shippingItems") expected = inventoryCollectionShippingRequest(value.body.shipSnList as string[]);
    else if (value.source === "details") expected = inventoryCollectionDetailRequest(value.body.id as string);
    else expected = inventoryCollectionPageRequest(value.source, Number(value.body.pageNo));
    if (inventoryCollectionCanonical(value) !== inventoryCollectionCanonical(expected)) return fail("request_invalid");
  } catch { return fail("request_invalid"); }
}
type Dependencies = { request: typeof safeHttpRequest; now: () => number; nonce: () => string; pause: (ms: number, signal: AbortSignal) => Promise<void> };
const defaults: Dependencies = {
  request: safeHttpRequest, now: Date.now, nonce: () => String(randomInt(1, 2147483647)),
  pause: async (ms, signal) => { await delay(ms, undefined, { signal }); },
};

/** Exactly one transport attempt per read; no hidden token refresh, HTTP retry
 * or redirect. All URLs, vendor messages and credentials stay out of errors. */
export function createInventoryCollectionTransport(credentials: InventoryCollectionCredentials, signal: AbortSignal, overrides: Partial<Dependencies> = {}): InventoryCollectionRead {
  credentials = { ...credentials };
  const deps = { ...defaults, ...overrides };
  let token: string | null = null, wireBytes = 0, reads = 0, busy = false;
  const startedAt = deps.now();
  const check = () => {
    if (signal.aborted) return fail("aborted");
    if (deps.now() - startedAt > 60 * 60 * 1000) return fail("collection_deadline");
  };
  async function request(url: URL, body?: string, tokenRequest = false) {
    check();
    try {
      const response = await deps.request(url.toString(), {
        method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body, headers: { "Content-Type": "application/json" } }),
        timeoutMs: 60_000, maxRedirects: 0, maxResponseBytes: tokenRequest ? 65536 : INVENTORY_COLLECTION_LIMITS.responseBytes,
        allowedHosts: ["openapi.sellfox.com"], allowPrivateNetwork: false, signal,
        auditContext: { workspaceId: credentials.workspaceId, toolSlug: "saihu-inventory", operation: tokenRequest ? "authorize" : "read" },
      });
      check();
      const bytes = response.body.byteLength;
      if (bytes < 1 || bytes > (tokenRequest ? 65536 : INVENTORY_COLLECTION_LIMITS.responseBytes)) return fail("response_budget");
      wireBytes += bytes;
      if (wireBytes > INVENTORY_COLLECTION_LIMITS.totalResponseBytes + 65536) return fail("response_budget");
      if (response.status !== 200) return fail("vendor_http_failed");
      let envelope: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("vendor_response_invalid");
        envelope = parsed as Record<string, unknown>;
      } catch { return fail("vendor_response_invalid"); }
      if (envelope.code !== 0) return fail(envelope.code === 40019 ? "vendor_rate_limited" : [40001, 40004, 40005, 40011, 40021, 40022, 40025].includes(envelope.code as number) ? "vendor_authorization_failed" : "vendor_response_invalid");
      return { httpStatus: response.status, body: envelope, receivedAt: deps.now(), wireByteLength: bytes };
    } catch (error) {
      if (error instanceof InventoryCollectionTransportError) throw error;
      return fail(signal.aborted ? "aborted" : "vendor_connection_failed");
    }
  }
  return async input => {
    validateRequest(input); check();
    input = structuredClone(input);
    if (busy) return fail("concurrent_read_rejected");
    if (++reads > INVENTORY_COLLECTION_LIMITS.receipts) return fail("request_budget");
    busy = true;
    try {
      if (!token) {
        const url = new URL("/api/oauth/v2/token.json", INVENTORY_VENDOR_ORIGIN);
        url.search = new URLSearchParams({ client_id: credentials.appId, client_secret: credentials.secret, grant_type: "client_credentials" }).toString();
        const response = await request(url, undefined, true);
        const data = response.body.data as Record<string, unknown> | undefined;
        if (!data || typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 16384 || /[\u0000-\u001f\u007f]/u.test(data.access_token)) return fail("vendor_authorization_failed");
        token = data.access_token;
      }
      try { await deps.pause(1300, signal); } catch { return fail(signal.aborted ? "aborted" : "vendor_connection_failed"); }
      check();
      const params = { access_token: token, client_id: credentials.appId, method: "post", nonce: deps.nonce(), timestamp: String(deps.now()), url: input.endpoint };
      const sign = createHmac("sha256", credentials.secret).update(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")).digest("hex");
      const url = new URL(input.endpoint, INVENTORY_VENDOR_ORIGIN);
      url.search = new URLSearchParams({ access_token: token, client_id: credentials.appId, nonce: params.nonce, timestamp: params.timestamp, sign }).toString();
      return await request(url, JSON.stringify(input.body));
    } finally { busy = false; }
  };
}
