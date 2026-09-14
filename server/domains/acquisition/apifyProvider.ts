import { createHash } from "node:crypto";
import { ENV } from "../../_core/env";
import { resolveToolSecretReference } from "../ai_os/services/toolGateway";
import {
  AmazonAcquisitionRequestSchema,
  assertProviderSupportsRequest,
  type AmazonAcquisitionProvider,
  type AmazonAcquisitionRequest,
  type ProviderCostEstimate,
  type ProviderFetchResult,
} from "./contracts";
import { classifyProviderFailure } from "./providerContracts";

const TERMINAL_RUN_STATUSES = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
const BASE_RESULT_PRICE_USD = 0.005;

type ApifyRun = {
  id: string;
  status: string;
  defaultDatasetId?: string | null;
  usageTotalUsd?: number | null;
};

type ApifyEnvelope<T> = { data: T };

export type ApifyAmazonProviderOptions = {
  apiToken?: string;
  actorName?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  memoryMbytes?: number;
  actorTimeoutSeconds?: number;
};

function actorIdForPath(actorName: string): string {
  return actorName.trim().replace("/", "~");
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function marketplaceProductUrl(marketplace: AmazonAcquisitionRequest["marketplace"], asin: string): string {
  const domains: Record<AmazonAcquisitionRequest["marketplace"], string> = {
    US: "www.amazon.com",
    CA: "www.amazon.ca",
    MX: "www.amazon.com.mx",
    UK: "www.amazon.co.uk",
    DE: "www.amazon.de",
    FR: "www.amazon.fr",
    IT: "www.amazon.it",
    ES: "www.amazon.es",
    JP: "www.amazon.co.jp",
    AU: "www.amazon.com.au",
  };
  return `https://${domains[marketplace]}/dp/${asin}`;
}

export class ApifyAmazonProvider implements AmazonAcquisitionProvider {
  readonly providerCode = "apify.junglee.amazon_crawler";
  readonly supportedMarketplaces = ["US"] as const;
  readonly capabilities = [
    "catalog_basic",
    "image_gallery",
    "aplus",
    "brand_story",
    "listing_content",
    "ratings",
  ] as const;

  private readonly apiToken: string;
  private readonly actorName: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly memoryMbytes: number;
  private readonly actorTimeoutSeconds: number;

  constructor(options: ApifyAmazonProviderOptions = {}) {
    this.apiToken = options.apiToken ?? ENV.apifyApiToken;
    this.actorName = options.actorName ?? "junglee/Amazon-crawler";
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.apify.com/v2").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxWaitMs = options.maxWaitMs ?? 180_000;
    this.memoryMbytes = options.memoryMbytes ?? 1_024;
    this.actorTimeoutSeconds = options.actorTimeoutSeconds ?? 120;
  }

  async estimate(request: AmazonAcquisitionRequest): Promise<ProviderCostEstimate> {
    const parsed = AmazonAcquisitionRequestSchema.parse(request);
    assertProviderSupportsRequest(this, parsed);
    return {
      estimatedMaxUsd: BASE_RESULT_PRICE_USD,
      pricingModel: "pay_per_result",
      cacheEligible: true,
    };
  }

  async fetch(request: AmazonAcquisitionRequest): Promise<ProviderFetchResult> {
    const parsed = AmazonAcquisitionRequestSchema.parse(request);
    assertProviderSupportsRequest(this, parsed);
    const estimate = await this.estimate(parsed);
    if (parsed.maxChargeUsd < estimate.estimatedMaxUsd) {
      return this.failed("", "budget_exceeded");
    }

    try {
      const actorInput = {
        categoryOrProductUrls: [{ url: marketplaceProductUrl(parsed.marketplace, parsed.asin) }],
        maxItemsPerStartUrl: 1,
        maxProductVariantsAsSeparateResults: 0,
        maxOffers: 0,
        scrapeSellers: false,
        useCaptchaSolver: false,
        scrapeProductVariantPrices: false,
        scrapeProductDetails: true,
        proxyCountry: parsed.marketplace,
      };
      const query = new URLSearchParams({
        maxItems: "1",
        maxTotalChargeUsd: parsed.maxChargeUsd.toFixed(4),
        memory: String(this.memoryMbytes),
        timeout: String(this.actorTimeoutSeconds),
      });
      const started = await this.requestJson<ApifyEnvelope<ApifyRun>>(
        `/acts/${actorIdForPath(this.actorName)}/runs?${query.toString()}`,
        { method: "POST", body: JSON.stringify(actorInput) },
      );
      const run = await this.waitForTerminalRun(started.data);
      const chargedUsd = typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null;

      if (run.status !== "SUCCEEDED") {
        const category = run.status === "TIMED-OUT" ? "request_timeout" : "provider_unavailable";
        return this.failed(run.id, category, chargedUsd);
      }
      if (!run.defaultDatasetId) {
        return this.failed(run.id, "schema_drift", chargedUsd);
      }

      const items = await this.requestJson<unknown[]>(
        `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&format=json&limit=1&desc=false`,
      );
      const bytes = new TextEncoder().encode(JSON.stringify(items));
      const contentHash = createHash("sha256").update(bytes).digest("hex");

      return {
        providerCode: this.providerCode,
        providerRunId: run.id,
        status: items.length === 1 ? "succeeded" : "partial",
        failureCategory: items.length === 1 ? null : "partial_result",
        chargedUsd,
        rawArtifact: {
          contentType: "application/json",
          bytes,
          contentHash,
          providerRunId: run.id,
        },
      };
    } catch (error) {
      return this.failed("", classifyProviderFailure(error));
    }
  }

  private async waitForTerminalRun(initial: ApifyRun): Promise<ApifyRun> {
    let run = initial;
    const deadline = Date.now() + this.maxWaitMs;
    while (!TERMINAL_RUN_STATUSES.has(run.status)) {
      if (Date.now() >= deadline) throw new Error("Apify request timeout");
      await sleep(this.pollIntervalMs);
      const response = await this.requestJson<ApifyEnvelope<ApifyRun>>(
        `/actor-runs/${encodeURIComponent(run.id)}`,
      );
      run = response.data;
    }
    return run;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.apiToken) throw new Error("Apify provider not configured: missing API token");
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Apify HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  private failed(
    providerRunId: string,
    failureCategory: NonNullable<ProviderFetchResult["failureCategory"]>,
    chargedUsd: number | null = null,
  ): ProviderFetchResult {
    return {
      providerCode: this.providerCode,
      providerRunId,
      status: "failed",
      failureCategory,
      chargedUsd,
      rawArtifact: null,
    };
  }
}

export async function createConfiguredApifyAmazonProvider(options: Omit<ApifyAmazonProviderOptions, "apiToken"> = {}) {
  const apiToken = await resolveToolSecretReference("secret://integration.apify.api_token", null).catch(() => ENV.apifyApiToken);
  return new ApifyAmazonProvider({ ...options, apiToken });
}
