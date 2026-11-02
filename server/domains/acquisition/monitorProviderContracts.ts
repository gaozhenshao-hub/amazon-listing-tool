import { createHash } from "node:crypto";
import { z } from "zod";

export const AmazonMonitorKindSchema = z.enum(["competitor", "keyword"]);
export type AmazonMonitorKind = z.infer<typeof AmazonMonitorKindSchema>;

export const MonitorTriggerTypeSchema = z.enum(["manual", "schedule", "qualification"]);
export type MonitorTriggerType = z.infer<typeof MonitorTriggerTypeSchema>;

export const AmazonMonitorRequestSchema = z.object({
  workspaceId: z.number().int().positive(),
  kind: AmazonMonitorKindSchema,
  marketplace: z.literal("US"),
  asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
  keyword: z.string().trim().min(1).max(500).nullable().default(null),
  postalCode: z.string().trim().min(5).max(20).nullable().default("10001"),
  depth: z.number().int().min(1).max(3).default(1),
  maxChargeUsd: z.number().positive().max(100),
  idempotencyKey: z.string().min(16).max(128),
}).superRefine((value, ctx) => {
  if (value.kind === "keyword" && !value.keyword) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keyword"], message: "关键词排名监控必须提供关键词" });
  }
});
export type AmazonMonitorRequest = z.infer<typeof AmazonMonitorRequestSchema>;

export const CompetitorMonitorResultSchema = z.object({
  kind: z.literal("competitor"),
  asin: z.string(),
  marketplace: z.literal("US"),
  title: z.string().nullable(),
  price: z.string().nullable(),
  currency: z.string().nullable(),
  bsrRank: z.number().int().positive().nullable(),
  bsrCategory: z.string().nullable(),
  bsrCategories: z.array(z.object({ rank: z.number().int().positive(), category: z.string() })).default([]),
  buyBoxWinner: z.string().nullable(),
  buyBoxSellerName: z.string().nullable(),
  shipsFrom: z.string().nullable(),
  offerCount: z.number().int().nonnegative().nullable(),
  snapshotAt: z.string().datetime().nullable(),
  coverage: z.record(z.string(), z.enum(["returned", "not_returned", "provider_unsupported", "invalid"])),
});

export const KeywordMonitorResultSchema = z.object({
  kind: z.literal("keyword"),
  asin: z.string(),
  marketplace: z.literal("US"),
  keyword: z.string(),
  found: z.boolean(),
  organicRank: z.number().int().positive().nullable(),
  adRank: z.number().int().positive().nullable(),
  absoluteRank: z.number().int().positive().nullable(),
  pageNumber: z.number().int().positive().nullable(),
  notInTop: z.number().int().positive().nullable(),
  resultsScanned: z.number().int().nonnegative().nullable(),
  searchVolume: z.number().int().nonnegative().nullable(),
  observedFrom: z.string().nullable(),
  locationPinned: z.boolean().nullable(),
  positionNoise: z.number().int().nonnegative().nullable(),
  runAt: z.string().datetime().nullable(),
  coverage: z.record(z.string(), z.enum(["returned", "not_returned", "provider_unsupported", "invalid"])),
});

export const AmazonMonitorResultSchema = z.discriminatedUnion("kind", [
  CompetitorMonitorResultSchema,
  KeywordMonitorResultSchema,
]);
export type AmazonMonitorResult = z.infer<typeof AmazonMonitorResultSchema>;

export type MonitorProviderFetchResult = {
  providerCode: string;
  providerRunId: string;
  status: "succeeded" | "partial" | "failed";
  failureCategory: string | null;
  chargedUsd: number | null;
  rawArtifact: { bytes: Uint8Array; contentHash: string; contentType: string } | null;
  normalized: AmazonMonitorResult | null;
};

export function monitorRequestHash(input: AmazonMonitorRequest) {
  return createHash("sha256").update(JSON.stringify({
    kind: input.kind,
    marketplace: input.marketplace,
    asin: input.asin,
    keyword: input.keyword,
    postalCode: input.postalCode,
    depth: input.depth,
  })).digest("hex");
}

export function requiredMonitorCapabilities(kind: AmazonMonitorKind) {
  return kind === "competitor" ? ["offers", "rankings"] as const : ["search_rank"] as const;
}

export function hasRequiredMonitorEvidence(result: AmazonMonitorResult): boolean {
  if (result.kind === "competitor") {
    const hasOfferEvidence = result.coverage.offerCount === "returned" || result.coverage.buyBox === "returned";
    return result.coverage.price === "returned" && result.coverage.bsrRank === "returned" && hasOfferEvidence;
  }
  return result.coverage.organicRank === "returned" && result.locationPinned === true;
}
