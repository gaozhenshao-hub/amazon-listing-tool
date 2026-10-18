import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";

const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const text = (max: number) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
export const DEVELOPMENT_MARKET_LIMITS = Object.freeze({ products: 2000, tags: 20000, sourceBytes: 4 * 1024 * 1024 });
export function developmentMarketCanonical(value: unknown): string {
  const encoded = canonicalCompetitorResearchEvidence(value);
  if (new TextEncoder().encode(encoded).byteLength > DEVELOPMENT_MARKET_LIMITS.sourceBytes) throw new Error("DEVELOPMENT_MARKET_METADATA_LIMIT");
  return encoded;
}
export const developmentMarketHash = (value: unknown) => SHA256(developmentMarketCanonical(value)).toString();
const json = z.unknown().refine(value => { try { developmentMarketCanonical(value); return true; } catch { return false; } });
export const DevelopmentMarketIdentitySchema = z.object({ workspaceId: id, userId: id }).strict();
export const DevelopmentMarketScopeSchema = z.object({ expectedWorkspaceId: id, devProjectId: id }).strict();
export const DevelopmentMarketOperationSchema = DevelopmentMarketScopeSchema.extend({ operationId: uuid }).strict();
export const DevelopmentMarketStartSchema = DevelopmentMarketOperationSchema.extend({ expectedSourceHash: hash, expectedRuntimeHash: hash,
  maxCostCents: z.number().int().min(0).max(1000000000), chargeConfirmed: z.literal(true) }).strict();
export const DevelopmentMarketApplyOperationSchema = DevelopmentMarketOperationSchema.extend({ runOperationId: uuid }).strict();
export const DevelopmentMarketApplySchema = DevelopmentMarketApplyOperationSchema.extend({ expectedSourceHash: hash, expectedResultHash: hash }).strict();
export type DevelopmentMarketIdentity = z.infer<typeof DevelopmentMarketIdentitySchema>;
export type DevelopmentMarketOperation = z.infer<typeof DevelopmentMarketOperationSchema>;
export type DevelopmentMarketStart = z.infer<typeof DevelopmentMarketStartSchema>;
export type DevelopmentMarketApplyOperation = z.infer<typeof DevelopmentMarketApplyOperationSchema>;
export type DevelopmentMarketApply = z.infer<typeof DevelopmentMarketApplySchema>;
/** Complete original market interpretation shape. Null is explicit missing
 * evidence, not invented growth/seasonality. Statistics are server-calculated. */
export const DevelopmentMarketCandidateSchema = z.object({
  maturityLevel: z.enum(["新兴", "成长", "成熟", "衰退"]).nullable(), maturityReason: text(4000),
  growthTrend: z.enum(["快速增长", "稳定增长", "平稳", "缓慢下降", "快速下降"]).nullable(), growthRate: text(1000).nullable(),
  seasonality: z.object({ hasSeasonality: z.boolean().nullable(), peakMonths: z.array(text(50)).max(12), lowMonths: z.array(text(50)).max(12), description: text(4000) }).strict(),
  marketCapacity: z.object({ level: z.enum(["大", "中", "小"]).nullable(), monthlyRevenue: text(2000).nullable(), potential: text(4000) }).strict(),
  entryTiming: z.object({ recommendation: z.enum(["建议进入", "谨慎进入", "不建议进入"]).nullable(), bestEntryTime: text(1000).nullable(), reason: text(4000) }).strict(),
  summary: text(4000), risks: z.array(text(2000)).max(50), opportunities: z.array(text(2000)).max(50),
}).strict();
export type DevelopmentMarketCandidate = z.infer<typeof DevelopmentMarketCandidateSchema>;
const fingerprint = z.object({ id, revisionHash: hash }).strict();
const sourceBody = z.object({ version: z.literal(1), identity: DevelopmentMarketIdentitySchema, devProjectId: id,
  project: z.object({ id, name: text(4000), targetMarket: text(500).nullable(), keywords: text(8000).nullable(), revisionHash: hash }).strict(),
  panorama: z.object({ statusId: id, statusHash: hash, versionId: id, version: id, revisionHash: hash, confirmedAt: text(64), snapshot: json }).strict(),
  products: z.array(fingerprint).min(1).max(DEVELOPMENT_MARKET_LIMITS.products), tags: z.array(fingerprint).min(1).max(DEVELOPMENT_MARKET_LIMITS.tags),
  stage: z.object({ id, rowVersion: z.number().int().nonnegative(), revisionHash: hash }).strict().nullable(),
  downstream: z.array(fingerprint).max(2),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), stats: z.record(z.string(), json),
}).strict();
export const DevelopmentMarketSourceSchema = sourceBody.extend({ sourceHash: hash }).strict().superRefine((value, ctx) => {
  const { sourceHash, ...body } = value;
  if (sourceHash !== developmentMarketHash(body) || value.project.id !== value.devProjectId
    || new Set(value.products.map(item => item.id)).size !== value.products.length || new Set(value.tags.map(item => item.id)).size !== value.tags.length) ctx.addIssue({ code: "custom", message: "Source binding mismatch" });
});
export type DevelopmentMarketSource = z.infer<typeof DevelopmentMarketSourceSchema>;
export const DevelopmentMarketResultSchema = z.object({ stats: z.record(z.string(), json), ai: DevelopmentMarketCandidateSchema }).strict();
export type DevelopmentMarketResult = z.infer<typeof DevelopmentMarketResultSchema>;
export function validateDevelopmentMarketCandidate(value: unknown, source: DevelopmentMarketSource): DevelopmentMarketCandidate {
  const result = DevelopmentMarketCandidateSchema.parse(value), trend = source.stats.monthlyTrend;
  if ((!Array.isArray(trend) || trend.length < 2) && (result.growthTrend !== null || result.growthRate !== null)) throw new Error("DEVELOPMENT_MARKET_TREND_EVIDENCE_MISSING");
  const months = Array.isArray(trend) ? trend.map(row => row && typeof row === "object" && typeof row.month === "string" && /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(row.month)
    ? Number(row.month.slice(0, 4)) * 12 + Number(row.month.slice(5, 7)) - 1 : -1).sort((a, b) => a - b) : [];
  let consecutive = 0, longest = 0;
  for (let index = 0; index < months.length; index++) { consecutive = months[index] >= 0 ? index > 0 && months[index] === months[index - 1] + 1 ? consecutive + 1 : 1 : 0; longest = Math.max(longest, consecutive); }
  if (longest < 12 && (result.seasonality.hasSeasonality !== null || result.seasonality.peakMonths.length || result.seasonality.lowMonths.length)) throw new Error("DEVELOPMENT_MARKET_SEASONAL_EVIDENCE_MISSING");
  return result;
}
const configuration = z.object({ revision: id, hash }).strict();
export const DevelopmentMarketPreviewSchema = z.object({ identity: DevelopmentMarketIdentitySchema, scope: DevelopmentMarketOperationSchema,
  sourceHash: hash, title: text(4000), productCount: id, panoramaVersion: id, asOf: text(64), stats: z.record(z.string(), json),
  configuration: configuration.nullable(), runtimeHash: hash.nullable(), skillSlug: text(128).nullable(), modelSlug: text(128).nullable(),
  maxCostCents: z.number().int().nonnegative().nullable(), available: z.boolean(), reasonCode: text(160).nullable() }).strict();
export const DevelopmentMarketStateSchema = z.enum(["not_found", "queued", "running", "dispatched", "candidate", "applied", "failed", "canceled", "outcome_unknown"]);
export const DevelopmentMarketViewSchema = z.object({ identity: DevelopmentMarketIdentitySchema, scope: DevelopmentMarketOperationSchema,
  runId: text(80).nullable(), state: DevelopmentMarketStateSchema, sourceHash: hash.nullable(), currentSourceHash: hash.nullable(), sourceChanged: z.boolean(),
  runtimeHash: hash.nullable(), configuration: configuration.nullable(), resultHash: hash.nullable(), result: DevelopmentMarketResultSchema.nullable(),
  reasonCode: text(160).nullable(), appliedOperationId: uuid.nullable() }).strict();
export const DevelopmentMarketApplyReceiptSchema = z.object({ identity: DevelopmentMarketIdentitySchema, scope: DevelopmentMarketApplyOperationSchema,
  status: z.enum(["not_found", "committed", "canceled", "outcome_unknown"]), requestHash: hash.nullable(), resultHash: hash.nullable(),
  stageId: id.nullable(), stageRevision: z.number().int().nonnegative().nullable(), reasonCode: text(160).nullable() }).strict();
