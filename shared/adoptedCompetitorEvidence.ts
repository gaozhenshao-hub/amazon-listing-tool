import { z } from "zod";
import { SupplementAdoptedSetSchema, type SupplementAdoptedSet, type SupplementAdoptedEntry } from "./listingSupplementAdoption";
import { supplementHash } from "./listingSupplementSources";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.number().int().positive().safe();
const count = z.number().int().nonnegative().max(20_000);
const text = z.string().min(1);
export const AdoptedOriginSchema = z.object({ sourceId: z.string().uuid(), manifestHash: hash, recordId: hash,
  fileName: text.max(255), contentHash: hash, locator: z.object({ part: text.max(255), row: id }).strict() }).strict();
export const AdoptedReviewSourceSchema = z.object({ kind: z.literal("adopted_supplements"), operationId: z.string().uuid(), setHash: hash }).strict();
export const AdoptedReviewItemSchema = z.object({ reviewId: z.string().regex(/^review_[a-f0-9]{64}$/u),
  asin: z.string().regex(/^[A-Z0-9]{10}$/u), sourceReviewId: text.nullable(), title: text.nullable(), body: text.max(32000),
  rating: z.number().min(0).max(5).nullable(), date: text.nullable(), author: text.nullable(),
  verifiedPurchase: z.boolean().nullable(), variant: text.nullable(), helpfulVotes: z.null(),
  occurrences: z.tuple([]), origins: z.array(AdoptedOriginSchema).min(1).max(20_000),
}).strict();
export const AdoptedReviewCoverageSchema = z.object({ scope: z.literal("complete_adopted_sources_not_market_total"),
  setHash: hash, sources: z.array(z.object({ sourceId: z.string().uuid(), manifestHash: hash, contentHash: hash, fileName: text.max(255) }).strict()).min(1).max(20_000),
  matchedRows: z.number().int().nonnegative().safe(), duplicateRows: z.number().int().nonnegative().safe(), uniqueReviews: count,
  normalization: z.literal("LF_then_trim_no_internal_whitespace_collapse"),
}).strict();
export const AdoptedReviewCorpusSchema = z.object({ parserVersion: z.literal("competitor-review-adopted/1"), corpusHash: hash,
  projectId: id, analysisId: id, asin: z.string().regex(/^[A-Z0-9]{10}$/u),
  items: z.array(AdoptedReviewItemSchema).min(1).max(20_000), coverage: AdoptedReviewCoverageSchema }).strict();
export type AdoptedReviewCorpus = z.infer<typeof AdoptedReviewCorpusSchema>;
export type AdoptedReviewItem = z.infer<typeof AdoptedReviewItemSchema>;
export type AdoptedReviewSource = z.infer<typeof AdoptedReviewSourceSchema>;
export const AdoptedQuestionEvidenceSchema = z.object({ operationId: z.string().uuid(), setHash: hash,
  items: z.array(z.object({ questionId: z.string().regex(/^question_[a-f0-9]{64}$/u), question: text,
    questionCn: text.nullable(), answer: text.nullable(), answerCn: text.nullable(), parentQuestion: text.nullable(),
    type: z.enum(["alexa", "follow_up"]), origins: z.array(AdoptedOriginSchema).min(1).max(20_000) }).strict()).min(1).max(20_000),
}).strict();
export type AdoptedQuestionEvidence = z.infer<typeof AdoptedQuestionEvidenceSchema>;
function targeted(raw: SupplementAdoptedSet, analysisId: number, asin: string): SupplementAdoptedEntry[] {
  const set = SupplementAdoptedSetSchema.parse(raw);
  return set.entries.filter(entry => entry.target.type === "competitor" && entry.target.analysisId === analysisId && entry.target.asin === asin);
}
export function buildAdoptedReviewCorpus(set: SupplementAdoptedSet, analysisId: number, asin: string): AdoptedReviewCorpus {
  if (set.kind !== "reviews") throw new Error("ADOPTED_REVIEW_KIND");
  const entries = targeted(set, analysisId, asin);
  const items = entries.map(entry => {
    if (entry.record.kind !== "reviews") throw new Error("ADOPTED_REVIEW_KIND");
    return { reviewId: `review_${entry.key}`, asin, ...entry.record.value, helpfulVotes: null, occurrences: [] as [], origins: entry.origins };
  });
  const sources = new Map<string, z.infer<typeof AdoptedReviewCoverageSchema>["sources"][number]>();
  for (const item of items) for (const origin of item.origins) {
    const source = { sourceId: origin.sourceId, manifestHash: origin.manifestHash, contentHash: origin.contentHash, fileName: origin.fileName };
    const existing = sources.get(source.sourceId);
    if (existing && supplementHash(existing) !== supplementHash(source)) throw new Error("ADOPTED_REVIEW_SOURCE_CHANGED");
    sources.set(source.sourceId, source);
  }
  const matchedRows = items.reduce((sum, item) => sum + item.origins.length, 0);
  const body = { parserVersion: "competitor-review-adopted/1" as const, projectId: set.scope.projectId, analysisId, asin, items,
    coverage: { scope: "complete_adopted_sources_not_market_total" as const, setHash: set.setHash,
      sources: [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)), matchedRows,
      duplicateRows: matchedRows - items.length, uniqueReviews: items.length,
      normalization: "LF_then_trim_no_internal_whitespace_collapse" as const } };
  return AdoptedReviewCorpusSchema.parse({ ...body, corpusHash: supplementHash(body) });
}
export function buildAdoptedQuestionEvidence(set: SupplementAdoptedSet, operationId: string, analysisId: number, asin: string) {
  if (set.kind !== "questions") throw new Error("ADOPTED_QUESTION_KIND");
  return AdoptedQuestionEvidenceSchema.parse({ operationId, setHash: set.setHash,
    items: targeted(set, analysisId, asin).map(entry => {
      if (entry.record.kind !== "questions") throw new Error("ADOPTED_QUESTION_KIND");
      return { questionId: `question_${entry.key}`, ...entry.record.value, origins: entry.origins };
    }) });
}
