import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export type SafeHttpAuditContext = {
  tenantId?: string | number | null;
  workspaceId?: string | number | null;
  toolSlug?: string | null;
  operation?: string | null;
};

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeHttpRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array | URLSearchParams | FormData | Blob;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  allowedHosts?: string[];
  allowedHostSuffixes?: string[];
  allowPrivateNetwork?: boolean;
  signal?: AbortSignal;
  auditContext?: SafeHttpAuditContext;
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
  agent?: http.Agent | https.Agent;
  allowTestNetwork?: boolean;
};

export type SafeHttpHeaders = Record<string, string> & {
  get: (name: string) => string | null;
};

export type SafeHttpResponse = {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  headers: SafeHttpHeaders;
  body: Buffer;
  text: () => string;
  json: <T = unknown>() => T;
  arrayBuffer: () => ArrayBuffer;
};

export type SafeHttpFailureReason =
  | "invalid_url"
  | "unsupported_protocol"
  | "embedded_credentials"
  | "host_not_allowed"
  | "blocked_hostname"
  | "blocked_address"
  | "dns_resolution_failed"
  | "redirect_limit"
  | "response_too_large"
  | "timeout"
  | "aborted"
  | "test_network_blocked"
  | "network";

export class SafeHttpError extends Error {
  readonly code = "SAFE_HTTP_ERROR";

  constructor(
    message: string,
    readonly reason: SafeHttpFailureReason,
    readonly requestHost: string | null,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SafeHttpError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.SAFE_HTTP_MAX_CONCURRENCY || 32));
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function acquireRequestSlot() {
  if (activeRequests >= MAX_GLOBAL_CONCURRENCY) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests += 1;
  return () => {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  };
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function ipv4InCidr(address: string, base: string, prefix: number) {
  const value = ipv4ToInt(address);
  const baseValue = ipv4ToInt(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function ipv6ToBigInt(rawAddress: string): bigint | null {
  let address = rawAddress.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const ipv4Match = address.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = ipv4ToInt(ipv4Match[1]);
    if (ipv4 === null) return null;
    address = `${address.slice(0, address.length - ipv4Match[1].length)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((item) => !/^[0-9a-f]{1,4}$/.test(item))) return null;
  return groups.reduce((value, group) => (value << 16n) + BigInt(`0x${group}`), 0n);
}

function ipv6InCidr(address: string, base: string, prefix: number) {
  const value = ipv6ToBigInt(address);
  const baseValue = ipv6ToBigInt(base);
  if (value === null || baseValue === null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (baseValue >> shift);
}

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const BLOCKED_IPV6_RANGES: Array<[string, number]> = [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["2001:10::", 28],
  ["2001:20::", 28], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];

export function isBlockedIpAddress(address: string) {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return BLOCKED_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  if (family !== 6) return true;
  if (ipv6InCidr(address, "::ffff:0:0", 96) || ipv6InCidr(address, "::", 96)) {
    const value = ipv6ToBigInt(address);
    if (value === null) return true;
    const ipv4 = Number(value & 0xffffffffn);
    const normalized = [24, 16, 8, 0].map((shift) => (ipv4 >>> shift) & 255).join(".");
    return isBlockedIpAddress(normalized);
  }
  return BLOCKED_IPV6_RANGES.some(([base, prefix]) => ipv6InCidr(address, base, prefix));
}

function normalizedHostname(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function hostMatchesSuffix(hostname: string, suffix: string) {
  const normalized = suffix.toLowerCase().replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function recordSecurityRejection(error: SafeHttpError, context?: SafeHttpAuditContext) {
  console.warn("[SafeHttp] request blocked", {
    reason: error.reason,
    requestHost: error.requestHost,
    tenantId: context?.tenantId ?? null,
    workspaceId: context?.workspaceId ?? null,
    toolSlug: context?.toolSlug ?? null,
    operation: context?.operation ?? null,
  });
}

export async function resolveAndValidateTarget(url: URL, options: SafeHttpRequestOptions = {}) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SafeHttpError("Safe HTTP blocked unsupported protocol", "unsupported_protocol", normalizedHostname(url));
  }
  const hostname = normalizedHostname(url);
  if (url.username || url.password) {
    throw new SafeHttpError("Safe HTTP blocked URL credentials", "embedded_credentials", hostname);
  }
  if (!options.allowPrivateNetwork && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))) {
    throw new SafeHttpError("Safe HTTP blocked local hostname", "blocked_hostname", hostname);
  }
  const allowedHosts = (options.allowedHosts || []).map((item) => item.toLowerCase());
  const allowedSuffixes = (options.allowedHostSuffixes || []).map((item) => item.toLowerCase());
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new SafeHttpError("Safe HTTP blocked host outside allowlist", "host_not_allowed", hostname);
  }
  if (allowedSuffixes.length > 0 && !allowedSuffixes.some((suffix) => hostMatchesSuffix(hostname, suffix))) {
    throw new SafeHttpError("Safe HTTP blocked host outside suffix allowlist", "host_not_allowed", hostname);
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await (options.resolver || (async (host) => {
      const results = await dnsLookup(host, { all: true, verbatim: true });
      return results.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
    }))(hostname);
  } catch (error) {
    throw new SafeHttpError("Safe HTTP DNS resolution failed", "dns_resolution_failed", hostname, true, { cause: error });
  }
  if (addresses.length === 0) {
    throw new SafeHttpError("Safe HTTP DNS resolution returned no addresses", "dns_resolution_failed", hostname, true);
  }
  if (!options.allowPrivateNetwork && addresses.some((item) => isBlockedIpAddress(item.address))) {
    throw new SafeHttpError("Safe HTTP blocked private, local, or reserved address", "blocked_address", hostname);
  }
  return { hostname, addresses };
}

function requestOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | Buffer | Uint8Array | undefined,
  addresses: ResolvedAddress[],
  timeoutMs: number,
  maxResponseBytes: number,
  signal?: AbortSignal,
  agent?: http.Agent | https.Agent,
) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: { status: number; headers: Record<string, string>; body: Buffer }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method,
      headers,
      agent: agent || false,
      lookup: ((_hostname: string, lookupOptions: any, callback: any) => {
        const requestedFamily = typeof lookupOptions === "number" ? lookupOptions : Number(lookupOptions?.family || 0);
        const candidates = requestedFamily ? addresses.filter((item) => item.family === requestedFamily) : addresses;
        const selected = candidates[0] || addresses[0];
        if (lookupOptions?.all) callback(null, candidates.length > 0 ? candidates : addresses);
        else callback(null, selected.address, selected.family);
      }) as any,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const declaredSize = Number(response.headers["content-length"] || 0);
      if (declaredSize > maxResponseBytes) {
        const error = new SafeHttpError("Safe HTTP response exceeded size limit", "response_too_large", normalizedHostname(url));
        response.destroy(error);
        request.destroy(error);
        rejectOnce(error);
        return;
      }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          const error = new SafeHttpError("Safe HTTP response exceeded size limit", "response_too_large", normalizedHostname(url));
          response.destroy(error);
          request.destroy(error);
          rejectOnce(error);
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        if (settled) return;
        const normalizedHeaders = Object.fromEntries(
          Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value ?? "")]),
        );
        resolveOnce({ status: response.statusCode || 0, headers: normalizedHeaders, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new SafeHttpError("Safe HTTP request timed out", "timeout", normalizedHostname(url), true));
    });
    const abort = () => request.destroy(new SafeHttpError("Safe HTTP request aborted", "aborted", normalizedHostname(url), true));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      if (error instanceof SafeHttpError) rejectOnce(error);
      else rejectOnce(new SafeHttpError("Safe HTTP network request failed", "network", normalizedHostname(url), true, { cause: error }));
    });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function redirectedMethod(status: number, method: string) {
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) return "GET";
  return method;
}

async function normalizeRequestBody(
  body: SafeHttpRequestOptions["body"],
  headers: Record<string, string>,
): Promise<string | Buffer | Uint8Array | undefined> {
  if (body === undefined || typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) {
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    }
    return body.toString();
  }
  if (body instanceof FormData || body instanceof Blob) {
    const encoded = new Response(body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      const contentType = encoded.headers.get("content-type");
      if (contentType) headers["content-type"] = contentType;
    }
    return Buffer.from(await encoded.arrayBuffer());
  }
  throw new SafeHttpError("Safe HTTP received an unsupported request body", "network", null);
}

function createSafeHeaders(values: Record<string, string>): SafeHttpHeaders {
  return Object.defineProperty(values, "get", {
    enumerable: false,
    value: (name: string) => values[name.toLowerCase()] ?? null,
  }) as SafeHttpHeaders;
}

function isUnitTestEnvironment() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

export async function safeHttpRequest(rawUrl: string | URL, options: SafeHttpRequestOptions = {}): Promise<SafeHttpResponse> {
  const release = await acquireRequestSlot();
  const timeoutMs = Math.min(Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS), 120_000);
  const maxRedirects = Math.min(Math.max(0, options.maxRedirects ?? 3), 10);
  const maxResponseBytes = Math.min(Math.max(1, options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES), 50 * 1024 * 1024);
  const deadline = Date.now() + timeoutMs;
  let method = String(options.method || "GET").toUpperCase();
  const requestHeaders = { ...(options.headers || {}) };
  let body: string | Buffer | Uint8Array | undefined;
  try {
    body = await normalizeRequestBody(options.body, requestHeaders);
  } catch (error) {
    release();
    throw error;
  }
  let currentUrl: URL;
  try {
    currentUrl = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch (error) {
    release();
    const safeError = new SafeHttpError("Safe HTTP blocked invalid URL", "invalid_url", null, false, { cause: error });
    recordSecurityRejection(safeError, options.auditContext);
    throw safeError;
  }

  if (
    isUnitTestEnvironment()
    && process.env.ALLOW_REAL_NETWORK_IN_TESTS !== "1"
    && !options.allowTestNetwork
    && !options.resolver
  ) {
    release();
    const safeError = new SafeHttpError(
      "Safe HTTP blocked a real network request in the test environment",
      "test_network_blocked",
      normalizedHostname(currentUrl),
    );
    recordSecurityRejection(safeError, options.auditContext);
    throw safeError;
  }

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      let target;
      try {
        target = await resolveAndValidateTarget(currentUrl, options);
      } catch (error) {
        if (error instanceof SafeHttpError) recordSecurityRejection(error, options.auditContext);
        throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new SafeHttpError("Safe HTTP request timed out", "timeout", target.hostname, true);
      const response = await requestOnce(
        currentUrl,
        method,
        requestHeaders,
        body,
        target.addresses,
        remainingMs,
        maxResponseBytes,
        options.signal,
        options.agent,
      );
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        if (redirectCount >= maxRedirects) {
          throw new SafeHttpError("Safe HTTP blocked redirect limit", "redirect_limit", target.hostname);
        }
        const nextUrl = new URL(location, currentUrl);
        const nextMethod = redirectedMethod(response.status, method);
        if (normalizedHostname(nextUrl) !== normalizedHostname(currentUrl)) {
          for (const key of Object.keys(requestHeaders)) {
            if (["authorization", "cookie"].includes(key.toLowerCase())) delete requestHeaders[key];
          }
        }
        method = nextMethod;
        if (["GET", "HEAD"].includes(method)) body = undefined;
        currentUrl = nextUrl;
        continue;
      }
      return {
        ...response,
        statusText: http.STATUS_CODES[response.status] || "",
        ok: response.status >= 200 && response.status < 300,
        url: currentUrl.toString(),
        headers: createSafeHeaders(response.headers),
        text: () => response.body.toString("utf8"),
        json: <T = unknown>() => JSON.parse(response.body.toString("utf8")) as T,
        arrayBuffer: () => response.body.buffer.slice(
          response.body.byteOffset,
          response.body.byteOffset + response.body.byteLength,
        ) as ArrayBuffer,
      };
    }
  } finally {
    release();
  }
}
