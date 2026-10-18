import { createHash, createHmac, randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import {
  INVENTORY_VENDOR_ORIGIN,
  type InventoryCollectionCredentials,
} from "./inventoryCollectionConfig";
import {
  SAIHU_REPORT_LIMITS,
  saihuReportCanonical,
} from "../../../shared/saihuReportSync";
import {
  saihuReportFail,
  SaihuReportError,
  type SaihuReportContract,
  saihuReportRequestBody,
} from "./saihuReportContract";

export type SaihuReportRead = (
  period: string,
  pageNo: number
) => Promise<{
  body: Record<string, unknown>;
  originalUtf8: string;
  bytesHash: string;
  byteLength: number;
  receivedAt: number;
}>;
export function createSaihuReportTransport(
  credentials: InventoryCollectionCredentials,
  contract: SaihuReportContract,
  signal: AbortSignal,
  overrides: {
    request?: typeof safeHttpRequest;
    now?: () => number;
    pause?: (signal: AbortSignal) => Promise<void>;
    nonce?: () => string;
    beforeRead?: () => Promise<void>;
  } = {}
): SaihuReportRead {
  credentials = { ...credentials };
  contract = structuredClone(contract);
  const request = overrides.request ?? safeHttpRequest,
    now = overrides.now ?? Date.now,
    nonce = overrides.nonce ?? (() => String(randomInt(1, 2147483647))),
    pause =
      overrides.pause ??
      (async signal => {
        await delay(1300, undefined, { signal });
      });
  let token: string | null = null,
    bytes = 0,
    reads = 0,
    busy = false;
  const startedAt = now();
  const check = () => {
    if (signal.aborted) saihuReportFail("CANCELLED");
    if (now() - startedAt > 60 * 60 * 1000) saihuReportFail("CAPTURE_DEADLINE");
  };
  async function read(url: URL, body?: Record<string, unknown>) {
    check();
    try {
      await overrides.beforeRead?.();
      check();
      const response = await request(url.toString(), {
        method: body ? "POST" : "GET",
        ...(body
          ? {
              body: saihuReportCanonical(body),
              headers: { "Content-Type": "application/json" },
            }
          : {}),
        timeoutMs: 60000,
        maxRedirects: 0,
        maxResponseBytes: body ? SAIHU_REPORT_LIMITS.responseBytes : 65536,
        allowedHosts: ["openapi.sellfox.com"],
        allowPrivateNetwork: false,
        signal,
        auditContext: {
          workspaceId: credentials.workspaceId,
          toolSlug: "saihu-report",
          operation: body ? "read" : "authorize",
        },
      });
      check();
      bytes += response.body.byteLength;
      if (bytes > SAIHU_REPORT_LIMITS.sourceBytes || response.status !== 200)
        saihuReportFail("VENDOR_READ_FAILED");
      const originalUtf8 = new TextDecoder("utf-8", { fatal: true }).decode(
          response.body
        ),
        parsed: unknown = JSON.parse(originalUtf8);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as Record<string, unknown>).code !== 0
      )
        saihuReportFail("VENDOR_RESPONSE_REJECTED");
      return {
        body: parsed as Record<string, unknown>,
        originalUtf8,
        bytesHash: createHash("sha256").update(response.body).digest("hex"),
        byteLength: response.body.byteLength,
        receivedAt: now(),
      };
    } catch (error) {
      if (error instanceof SaihuReportError) throw error;
      return saihuReportFail(
        signal.aborted ? "CANCELLED" : "VENDOR_READ_FAILED"
      );
    }
  }
  return async (period, pageNo) => {
    check();
    if (
      busy ||
      !Number.isInteger(pageNo) ||
      pageNo < 1 ||
      pageNo > 500 ||
      ++reads > 500 ||
      !(
        contract.kind === "daily"
          ? /^20\d{2}-\d{2}-\d{2}$/u
          : /^20\d{2}-\d{2}$/u
      ).test(period)
    )
      saihuReportFail("REQUEST_INVALID");
    busy = true;
    try {
      if (!token) {
        const url = new URL(
          "/api/oauth/v2/token.json",
          INVENTORY_VENDOR_ORIGIN
        );
        url.search = new URLSearchParams({
          client_id: credentials.appId,
          client_secret: credentials.secret,
          grant_type: "client_credentials",
        }).toString();
        const value = (await read(url)).body.data as
          | Record<string, unknown>
          | undefined;
        if (
          !value ||
          typeof value.access_token !== "string" ||
          !value.access_token ||
          value.access_token.length > 16384 ||
          /[\u0000-\u001f\u007f]/u.test(value.access_token)
        )
          saihuReportFail("VENDOR_AUTHORIZATION_FAILED");
        token = value.access_token;
      }
      await pause(signal);
      check();
      const params = {
        access_token: token,
        client_id: credentials.appId,
        method: "post",
        nonce: nonce(),
        timestamp: String(now()),
        url: contract.endpoint,
      };
      const sign = createHmac("sha256", credentials.secret)
          .update(
            Object.entries(params)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => `${key}=${value}`)
              .join("&")
          )
          .digest("hex"),
        url = new URL(contract.endpoint, INVENTORY_VENDOR_ORIGIN);
      url.search = new URLSearchParams({
        access_token: token,
        client_id: credentials.appId,
        nonce: params.nonce,
        timestamp: params.timestamp,
        sign,
      }).toString();
      const body = saihuReportRequestBody(contract, period, pageNo);
      return await read(url, body);
    } finally {
      busy = false;
    }
  };
}
