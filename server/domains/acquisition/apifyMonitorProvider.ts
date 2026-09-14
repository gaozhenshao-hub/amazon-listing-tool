import { createHash } from "node:crypto";
import { ENV } from "../../_core/env";
import { resolveToolSecretReference } from "../ai_os/services/toolGateway";
import { requestApifyJsonIPv4 } from "../apiConnections/apifyAccountHealth";
import { classifyProviderFailure } from "./providerContracts";
import {
  AmazonMonitorRequestSchema,
  AmazonMonitorResultSchema,
  type AmazonMonitorRequest,
  type MonitorProviderFetchResult,
} from "./monitorProviderContracts";
import { monitorProviderCandidate } from "./monitorProviderProfileService";

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
type ApifyRun = { id: string; status: string; defaultDatasetId?: string | null; usageTotalUsd?: number | null };
type ApifyEnvelope<T> = { data: T };

export type ApifyMonitorProviderOptions = {
  apiToken?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  actorTimeoutSeconds?: number;
};

function actorId(name: string) { return name.replace("/", "~"); }
function sleep(ms: number) { return ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms)); }
function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function positiveIntOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function nonnegativeIntOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function priceOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : null;
}
function fieldStatus(value: unknown) {
  return value === null || value === undefined || value === "" ? "not_returned" as const : "returned" as const;
}

export class ApifyAmazonMonitorProvider {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | null;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly timeoutSeconds: number;

  constructor(options: ApifyMonitorProviderOptions = {}) {
    this.token = options.apiToken ?? ENV.apifyApiToken;
    this.baseUrl = (options.apiBaseUrl ?? "https://api.apify.com/v2").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? null;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxWaitMs = options.maxWaitMs ?? 180_000;
    this.timeoutSeconds = options.actorTimeoutSeconds ?? 150;
  }

  estimate(request: AmazonMonitorRequest) {
    const parsed = AmazonMonitorRequestSchema.parse(request);
    const estimatedMaxUsd = parsed.kind === "keyword" ? 0.05 + 0.025 * parsed.depth : 0.03;
    return { estimatedMaxUsd, pricingModel: parsed.kind === "keyword" ? "actor_start_plus_keyword_page" : "product_detail_plus_capped_offers" };
  }

  async fetch(request: AmazonMonitorRequest): Promise<MonitorProviderFetchResult> {
    const parsed = AmazonMonitorRequestSchema.parse(request);
    const candidate = monitorProviderCandidate(parsed.kind);
      const estimate = this.estimate(parsed);
      if (parsed.maxChargeUsd < estimate.estimatedMaxUsd) return this.failed(candidate.providerCode, "", "budget_exceeded");
      try {
        const input = parsed.kind === "competitor"
          ? {
          productUrls: [{ url: `https://www.amazon.com/dp/${parsed.asin}` }],
          scrapeOffers: true,
          maxOffers: 10,
          scrapeProductDetails: true,
          scrapeVariants: false,
          scrapeSellers: false,
        }
        : {
          keywords: [parsed.keyword],
          asins: [parsed.asin],
          marketplace: "com",
          postalCode: parsed.postalCode || "10001",
          depth: parsed.depth,
          watchlistId: `ws-${parsed.workspaceId}-${parsed.asin}`.slice(0, 40),
          includeVolume: false,
          bypassRunCache: false,
        };
      const query = new URLSearchParams({ maxTotalChargeUsd: parsed.maxChargeUsd.toFixed(4), memory: "1024", timeout: String(this.timeoutSeconds) });
      const started = await this.request<ApifyEnvelope<ApifyRun>>(`/acts/${actorId(candidate.actorName)}/runs?${query}`, { method: "POST", body: JSON.stringify(input) });
      const run = await this.wait(started.data);
      const chargedUsd = numberOrNull(run.usageTotalUsd);
      if (run.status !== "SUCCEEDED") return this.failed(candidate.providerCode, run.id, run.status === "TIMED-OUT" ? "request_timeout" : "provider_unavailable", chargedUsd);
      if (!run.defaultDatasetId) return this.failed(candidate.providerCode, run.id, "schema_drift", chargedUsd);
      const items = await this.request<unknown[]>(`/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&format=json&limit=10&desc=false`);
      const bytes = new TextEncoder().encode(JSON.stringify(items));
      const rawArtifact = { bytes, contentHash: createHash("sha256").update(bytes).digest("hex"), contentType: "application/json" };
      const normalized = this.normalize(parsed, items);
      return {
        providerCode: candidate.providerCode,
        providerRunId: run.id,
        status: normalized ? "succeeded" : "partial",
        failureCategory: normalized ? null : "partial_result",
        chargedUsd,
        rawArtifact,
        normalized,
      };
    } catch (error) {
      return this.failed(candidate.providerCode, "", classifyProviderFailure(error));
    }
  }

  private normalize(request: AmazonMonitorRequest, items: unknown[]) {
    const records = items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    if (request.kind === "competitor") {
      const item = records.find(row => [row.asin, row.currentAsin, row.originalAsin].some(value => String(value || "").toUpperCase() === request.asin)) ?? records[0];
      if (!item) return null;
      const categories = Array.isArray(item.bestsellerRanks) ? item.bestsellerRanks : [];
      const offers = Array.isArray(item.offers) ? item.offers : [];
      const buyBoxOffer = offers.find((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).isBuyBoxWinner === true);
      const primaryRank = categories.find((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) && positiveIntOrNull((entry as Record<string, unknown>).rank) !== null);
      return AmazonMonitorResultSchema.parse({
        kind: "competitor",
        asin: request.asin,
        marketplace: "US",
        title: textOrNull(item.title),
        price: priceOrNull(item.price),
        currency: null,
        bsrRank: positiveIntOrNull(primaryRank?.rank),
        bsrCategory: textOrNull(primaryRank?.category),
        bsrCategories: categories.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const row = entry as Record<string, unknown>;
          const rank = positiveIntOrNull(row.rank);
          const category = textOrNull(row.category);
          return rank && category ? [{ rank, category }] : [];
        }),
        buyBoxWinner: textOrNull(buyBoxOffer?.sellerName),
        buyBoxSellerName: textOrNull(buyBoxOffer?.sellerName),
        shipsFrom: textOrNull(buyBoxOffer?.shipsFrom),
        offerCount: nonnegativeIntOrNull(item.offersCount),
        snapshotAt: null,
        coverage: {
          price: fieldStatus(item.price),
          bsrRank: fieldStatus(primaryRank?.rank),
          buyBox: fieldStatus(item.hasBuyBox),
          offerCount: fieldStatus(item.offersCount),
          ratings: "provider_unsupported",
          availability: "provider_unsupported",
          coupon: "provider_unsupported",
          deal: "provider_unsupported",
        },
      });
    }
    const item = records.find(row => String(row.keyword || "").trim().toLowerCase() === request.keyword?.toLowerCase()) ?? records[0];
    if (!item) return null;
    const tracked = Array.isArray(item.tracked)
      ? item.tracked.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) && String((entry as Record<string, unknown>).asin || "").toUpperCase() === request.asin)
      : [];
    const organic = tracked.find(row => row.sponsored !== true) ?? tracked[0];
    const sponsored = tracked.find(row => row.sponsored === true);
    const found = tracked.some(row => row.found === true);
    return AmazonMonitorResultSchema.parse({
      kind: "keyword",
      asin: request.asin,
      marketplace: "US",
      keyword: request.keyword,
      found,
      organicRank: positiveIntOrNull(organic?.position_organic),
      adRank: positiveIntOrNull(sponsored?.position_absolute ?? organic?.position_sponsored),
      absoluteRank: positiveIntOrNull(organic?.position_absolute),
      pageNumber: positiveIntOrNull(organic?.page),
      notInTop: positiveIntOrNull(organic?.not_in_top),
      resultsScanned: nonnegativeIntOrNull(item.results_scanned),
      searchVolume: nonnegativeIntOrNull(item.search_volume),
      observedFrom: textOrNull(item.observed_from),
      locationPinned: typeof item.location_pinned === "boolean" ? item.location_pinned : null,
      positionNoise: nonnegativeIntOrNull(item.position_noise),
      runAt: isoOrNull(item.run_at),
      coverage: {
        organicRank: fieldStatus(organic?.position_organic ?? organic?.not_in_top),
        adRank: fieldStatus(sponsored?.position_absolute ?? organic?.position_sponsored),
        location: fieldStatus(item.observed_from),
        searchVolume: fieldStatus(item.search_volume),
      },
    });
  }

  private async wait(initial: ApifyRun) {
    let run = initial;
    const deadline = Date.now() + this.maxWaitMs;
    while (!TERMINAL.has(run.status)) {
      if (Date.now() >= deadline) throw new Error("Apify monitor request timeout");
      await sleep(this.pollIntervalMs);
      run = (await this.request<ApifyEnvelope<ApifyRun>>(`/actor-runs/${encodeURIComponent(run.id)}`)).data;
    }
    return run;
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    if (!this.token) throw new Error("Apify provider not configured: missing API token");
    if (!this.fetchImpl) {
      return requestApifyJsonIPv4<T>({
        path,
        token: this.token,
        method: init.method === "POST" ? "POST" : "GET",
        body: typeof init.body === "string" ? init.body : undefined,
        timeoutMs: 30_000,
      });
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers || {}) },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Apify HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  private failed(providerCode: string, providerRunId: string, failureCategory: string, chargedUsd: number | null = null): MonitorProviderFetchResult {
    return { providerCode, providerRunId, status: "failed", failureCategory, chargedUsd, rawArtifact: null, normalized: null };
  }
}

export async function createConfiguredApifyAmazonMonitorProvider(options: Omit<ApifyMonitorProviderOptions, "apiToken"> = {}) {
  const apiToken = await resolveToolSecretReference("secret://integration.apify.api_token", null).catch(() => ENV.apifyApiToken);
  return new ApifyAmazonMonitorProvider({ ...options, apiToken });
}
