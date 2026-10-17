import { z } from "zod";
import {
  canonicalCompetitorResearchEvidence as canonical,
  competitorReviewEvidenceSourceId,
  verifyCompetitorResearchEvidencePlan,
  type CompetitorEvidenceSha256,
  type CompetitorResearchEvidencePlan,
} from "./competitorResearchEvidence";

/** Source-only, pending-review compatibility contract. This does not publish a
 * Skill, supply prompts, prove model execution, authorize data, or replace the
 * user's Listing/seven-direction Skills. Citations prove exact attribution,
 * not the semantic truth of a model's interpretation or translation. */
export const COMPETITOR_DEEP_RESEARCH_CONTRACT_VERSION = 1 as const;
export const COMPETITOR_DEEP_RESEARCH_OUTPUT_LIMIT = 64 * 1024;
export class CompetitorDeepResearchContractError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CompetitorDeepResearchContractError"; }
}
function fail(code: string): never { throw new CompetitorDeepResearchContractError(code); }
const text = z.string().min(1).refine(value => value.trim().length > 0);
const ordinal = z.number().int().nonnegative().safe();
const citationSchema = z.object({ sourceId: text, start: ordinal, end: ordinal, quote: text }).strict();
export type CompetitorDeepCitation = z.infer<typeof citationSchema>;
const termSchema = z.object({ text, zh: text, citation: citationSchema }).strict();
const titleSchema = z.object({ keywords: z.array(termSchema).min(1), modifiers: z.array(termSchema),
  scenarios: z.array(termSchema), titleZh: text }).strict();
const sellingSchema = z.object({ points: z.array(z.object({ name: text, description: text,
  strength: z.enum(["极高", "高", "中", "低"]), occurrences: z.array(citationSchema).min(1),
  goldenQuote: citationSchema.nullable() }).strict()).min(1),
  bulletTranslations: z.array(z.object({ sourceId: text, zh: text }).strict()) }).strict();
const sentiment = z.enum(["positive", "negative"]);
const buyerBatchSchema = z.object({ themes: z.array(z.object({ name: text, sentiment,
  reviewIds: z.array(text).min(1), citations: z.array(citationSchema).min(1) }).strict()),
  noThemeReviewIds: z.array(text) }).strict();
const buyersSchema = z.object({ groups: z.array(z.object({ name: text, sentiment, themeIds: z.array(text).min(1) }).strict()),
  concerns: z.array(z.object({ question: text, status: z.enum(["已满足", "未满足", "评价不一", "证据不足"]),
    explanation: text, themeIds: z.array(text).min(1) }).strict()).max(8) }).strict();
const claimSchema = z.object({ text, basis: z.enum(["seller_claim", "review_feedback", "inference"]),
  references: z.array(text).min(1) }).strict();
const summarySchema = z.object({ positioning: claimSchema, advantages: z.array(claimSchema).max(5),
  weaknesses: z.array(claimSchema).max(5), learnings: z.array(claimSchema).max(5),
  opportunities: z.array(claimSchema).max(5) }).strict();

export type CompetitorDeepTitleOutput = z.infer<typeof titleSchema>;
export type CompetitorDeepSellingOutput = z.infer<typeof sellingSchema>;
export type CompetitorDeepBuyerBatchOutput = z.infer<typeof buyerBatchSchema>;
export type CompetitorDeepBuyersOutput = z.infer<typeof buyersSchema>;
export type CompetitorDeepSummaryOutput = z.infer<typeof summarySchema>;
export type CompetitorDeepStage = "title" | "selling" | `buyers:${number}` | "buyers_synthesis" | "summary";
export type CompetitorDeepValidatedResult<S extends CompetitorDeepStage, D> = {
  version: 1; stage: S; evidenceHash: string; outputHash: string; data: D;
};
type Entry<T> = T & { entryId: string };
export type CompetitorDeepTitleResult = CompetitorDeepValidatedResult<"title", {
  keywords: Array<Entry<CompetitorDeepTitleOutput["keywords"][number]>>;
  modifiers: Array<Entry<CompetitorDeepTitleOutput["modifiers"][number]>>;
  scenarios: Array<Entry<CompetitorDeepTitleOutput["scenarios"][number]>>;
  titleZh: string; translation: { entryId: string; citation: CompetitorDeepCitation };
}>;
export type CompetitorDeepSellingResult = CompetitorDeepValidatedResult<"selling", {
  points: Array<Entry<CompetitorDeepSellingOutput["points"][number]> & { frequency: number; sourceFrequency: number }>;
  bulletTranslations: Array<Entry<CompetitorDeepSellingOutput["bulletTranslations"][number]> & { citation: CompetitorDeepCitation }>;
  imageEvidence: "not_included_no_ocr";
}>;
export type CompetitorDeepBuyerBatchResult = CompetitorDeepValidatedResult<`buyers:${number}`, {
  batchIndex: number; batchId: string; batchHash: string; accountedReviewCount: number;
  themes: Array<CompetitorDeepBuyerBatchOutput["themes"][number] & { themeId: string }>;
  noThemeReviewIds: string[];
}>;
export type CompetitorDeepBuyersResult = CompetitorDeepValidatedResult<"buyers_synthesis", {
  groups: Array<Entry<CompetitorDeepBuyersOutput["groups"][number]> & { count: number; percentage: number }>;
  concerns: Array<Entry<CompetitorDeepBuyersOutput["concerns"][number]> & { origin: "derived_from_review_themes" }>;
  sampleCount: number; accountedReviewCount: number; noThemeReviewCount: number;
  scope: "complete_file_not_market_total"; questions: "unavailable_no_question_evidence";
}>;
export type CompetitorDeepSummaryResult = CompetitorDeepValidatedResult<"summary", CompetitorDeepSummaryOutput & {
  incompleteSources: Array<"title" | "selling" | "reviews" | "images" | "questions">;
  scope: "listing_text_and_imported_review_sample";
}>;
export type CompetitorDeepPreviousResults = {
  title: CompetitorDeepTitleResult | null;
  selling: CompetitorDeepSellingResult | null;
  buyers: CompetitorDeepBuyersResult | null;
};

function boundedJson(value: unknown): string {
  let encoded: string;
  try { encoded = canonical(value); } catch { fail("DEEP_OUTPUT_JSON_INVALID"); }
  if (new TextEncoder().encode(encoded).byteLength > COMPETITOR_DEEP_RESEARCH_OUTPUT_LIMIT) fail("DEEP_OUTPUT_TOO_LARGE");
  return encoded;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(JSON.parse(boundedJson(value)));
  if (!result.success) fail("DEEP_OUTPUT_SCHEMA_INVALID");
  return result.data;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function unique(values: string[], code: string) {
  if (new Set(values).size !== values.length) fail(code);
}
type IndexedSource = { text: string; kind: "title" | "bullet" | "review"; reviewId?: string };
function exactCitation(citation: CompetitorDeepCitation, sources: Map<string, IndexedSource>): IndexedSource {
  const source = sources.get(citation.sourceId), s = source?.text;
  const splitPair = (at: number) => s !== undefined && /[\uD800-\uDBFF]/u.test(s.charAt(at - 1)) && /[\uDC00-\uDFFF]/u.test(s.charAt(at));
  if (!source || s === undefined || citation.end <= citation.start || citation.end > s.length
    || splitPair(citation.start) || splitPair(citation.end) || s.slice(citation.start, citation.end) !== citation.quote) fail("DEEP_CITATION_MISMATCH");
  return source;
}
const fullCitation = (source: CompetitorResearchEvidencePlan["listingSources"][number]): CompetitorDeepCitation =>
  ({ sourceId: source.sourceId, start: 0, end: source.text.length, quote: source.text });

/** Verify the complete input once, then use indexed exact-span checks. Receipts
 * are frozen and instance-bound. To restore durable checkpoints, revalidate the
 * stored raw outputs in dependency order with the same evidence snapshot; a
 * serialized receipt or its self-reported digest is not execution evidence. */
export function createCompetitorDeepResearchValidator(evidence: unknown, sha256: CompetitorEvidenceSha256) {
  const plan = verifyCompetitorResearchEvidencePlan(evidence, sha256);
  const accepted = new WeakSet<object>();
  const listing = new Map(plan.listingSources.map(source => [source.sourceId, { text: source.text, kind: source.kind } satisfies IndexedSource]));
  const titleSource = plan.listingSources.find(source => source.kind === "title");
  const bulletSources = plan.listingSources.filter(source => source.kind === "bullet");
  const batches = plan.reviews.batches.map(batch => {
    const sources = new Map<string, IndexedSource>();
    for (const item of batch.items) {
      sources.set(competitorReviewEvidenceSourceId(item.reviewId, "body"), { text: item.body, kind: "review", reviewId: item.reviewId });
      if (item.title !== null) sources.set(competitorReviewEvidenceSourceId(item.reviewId, "title"), { text: item.title, kind: "review", reviewId: item.reviewId });
    }
    return { sources, ids: new Set(batch.items.map(item => item.reviewId)), batch };
  });
  function receipt<S extends CompetitorDeepStage, D>(stage: S, data: D): CompetitorDeepValidatedResult<S, D> {
    const body = { version: 1 as const, stage, evidenceHash: plan.evidenceHash, data };
    const outputHash = sha256(boundedJson(body));
    if (!/^[a-f0-9]{64}$/u.test(outputHash)) fail("DEEP_HASH_PROVIDER_INVALID");
    const result = { ...body, outputHash };
    boundedJson(result); freeze(result); accepted.add(result);
    return result;
  }
  function previous(value: object | null, stage: CompetitorDeepStage) {
    if (!value || !accepted.has(value) || (value as { stage?: unknown }).stage !== stage) fail("DEEP_PREVIOUS_NOT_VALIDATED");
  }
  function validateTitle(raw: unknown): CompetitorDeepTitleResult {
    if (!titleSource) fail("DEEP_TITLE_SOURCE_UNAVAILABLE");
    const data = parse(titleSchema, raw);
    const terms = (key: "keywords" | "modifiers" | "scenarios", prefix: string) => data[key].map((term, i) => {
      if (exactCitation(term.citation, listing).kind !== "title" || term.text !== term.citation.quote) fail("DEEP_TITLE_CITATION_INVALID");
      return { ...term, entryId: `title:${prefix}:${i + 1}` };
    });
    return receipt("title", { keywords: terms("keywords", "keyword"), modifiers: terms("modifiers", "modifier"),
      scenarios: terms("scenarios", "scenario"), titleZh: data.titleZh,
      translation: { entryId: "title:translation", citation: fullCitation(titleSource) } });
  }
  function validateSelling(raw: unknown): CompetitorDeepSellingResult {
    if (!listing.size) fail("DEEP_SELLING_SOURCE_UNAVAILABLE");
    const data = parse(sellingSchema, raw);
    const points = data.points.map((point, index) => {
      const spans = new Map<string, Array<{ start: number; end: number }>>();
      for (const citation of point.occurrences) {
        exactCitation(citation, listing);
        const seen = spans.get(citation.sourceId) ?? [];
        if (seen.some(span => citation.start < span.end && citation.end > span.start)) fail("DEEP_OCCURRENCE_DUPLICATE");
        seen.push(citation); spans.set(citation.sourceId, seen);
      }
      if (point.goldenQuote !== null) {
        exactCitation(point.goldenQuote, listing);
        if (!point.occurrences.some(citation => canonical(citation) === canonical(point.goldenQuote))) fail("DEEP_GOLDEN_QUOTE_UNLINKED");
      }
      return { ...point, entryId: `selling:point:${index + 1}`, frequency: point.occurrences.length, sourceFrequency: spans.size };
    });
    if (data.bulletTranslations.length !== bulletSources.length || data.bulletTranslations.some((translation, i) => translation.sourceId !== bulletSources[i].sourceId)) fail("DEEP_BULLET_TRANSLATION_COVERAGE");
    const translations = data.bulletTranslations.map((translation, i) => ({ ...translation,
      entryId: `selling:translation:${i + 1}`, citation: fullCitation(bulletSources[i]) }));
    return receipt("selling", { points, bulletTranslations: translations, imageEvidence: "not_included_no_ocr" as const });
  }
  function validateBuyerBatch(batchIndex: number, raw: unknown): CompetitorDeepBuyerBatchResult {
    if (plan.reviews.status !== "available") fail("DEEP_REVIEW_SOURCE_UNAVAILABLE");
    if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || !batches[batchIndex]) fail("DEEP_BATCH_UNKNOWN");
    const { sources, ids, batch } = batches[batchIndex], data = parse(buyerBatchSchema, raw);
    const themed = new Set<string>();
    const themes = data.themes.map((theme, index) => {
      unique(theme.reviewIds, "DEEP_THEME_DUPLICATE_REVIEW");
      if (theme.reviewIds.some(id => !ids.has(id))) fail("DEEP_REVIEW_UNKNOWN");
      const cited = new Set<string>(), citations = new Set<string>();
      for (const citation of theme.citations) {
        const source = exactCitation(citation, sources);
        if (!source.reviewId || !theme.reviewIds.includes(source.reviewId)) fail("DEEP_THEME_CITATION_SCOPE");
        const encoded = canonical(citation);
        if (citations.has(encoded)) fail("DEEP_THEME_DUPLICATE_CITATION");
        citations.add(encoded); cited.add(source.reviewId);
      }
      if (cited.size !== theme.reviewIds.length) fail("DEEP_THEME_CITATION_COVERAGE");
      for (const id of theme.reviewIds) themed.add(id);
      return { ...theme, themeId: `buyers:batch:${batchIndex}:theme:${index + 1}` };
    });
    unique(data.noThemeReviewIds, "DEEP_NO_THEME_DUPLICATE");
    if (data.noThemeReviewIds.some(id => !ids.has(id))) fail("DEEP_REVIEW_UNKNOWN");
    if (data.noThemeReviewIds.some(id => themed.has(id))) fail("DEEP_REVIEW_ACCOUNTED_TWICE");
    if (themed.size + data.noThemeReviewIds.length !== ids.size) fail("DEEP_REVIEW_COVERAGE_INCOMPLETE");
    return receipt(`buyers:${batchIndex}`, { batchIndex, batchId: batch.batchId, batchHash: batch.sha256,
      accountedReviewCount: ids.size, themes, noThemeReviewIds: data.noThemeReviewIds });
  }
  function validateBuyers(raw: unknown, batchResults: CompetitorDeepBuyerBatchResult[]): CompetitorDeepBuyersResult {
    if (plan.reviews.status !== "available") fail("DEEP_REVIEW_SOURCE_UNAVAILABLE");
    if (batchResults.length !== batches.length) fail("DEEP_BATCH_COVERAGE_INCOMPLETE");
    const themeMap = new Map<string, CompetitorDeepBuyerBatchResult["data"]["themes"][number]>();
    batchResults.forEach((result, i) => {
      previous(result, `buyers:${i}`);
      for (const theme of result.data.themes) themeMap.set(theme.themeId, theme);
    });
    const data = parse(buyersSchema, raw), used = new Set<string>(), sampleCount = plan.reviews.total;
    const groups = data.groups.map((group, index) => {
      unique(group.themeIds, "DEEP_THEME_GROUP_DUPLICATE");
      const reviewIds = new Set<string>();
      for (const id of group.themeIds) {
        const theme = themeMap.get(id);
        if (!theme) fail("DEEP_THEME_UNKNOWN");
        if (used.has(id)) fail("DEEP_THEME_GROUP_DUPLICATE");
        if (theme.sentiment !== group.sentiment) fail("DEEP_THEME_SENTIMENT_MISMATCH");
        used.add(id); for (const reviewId of theme.reviewIds) reviewIds.add(reviewId);
      }
      return { ...group, entryId: `buyers:group:${index + 1}`, count: reviewIds.size,
        percentage: sampleCount === 0 ? 0 : Math.round(reviewIds.size / sampleCount * 1000) / 10 };
    });
    if (used.size !== themeMap.size) fail("DEEP_THEME_GROUP_COVERAGE");
    const concerns = data.concerns.map((concern, index) => {
      unique(concern.themeIds, "DEEP_CONCERN_DUPLICATE_THEME");
      if (concern.themeIds.some(id => !themeMap.has(id))) fail("DEEP_THEME_UNKNOWN");
      return { ...concern, entryId: `buyers:concern:${index + 1}`, origin: "derived_from_review_themes" as const };
    });
    return receipt("buyers_synthesis", { groups, concerns, sampleCount, accountedReviewCount: sampleCount,
      noThemeReviewCount: batchResults.reduce((sum, result) => sum + result.data.noThemeReviewIds.length, 0),
      scope: "complete_file_not_market_total" as const, questions: "unavailable_no_question_evidence" as const });
  }
  function validateSummary(raw: unknown, prior: CompetitorDeepPreviousResults): CompetitorDeepSummaryResult {
    const entries = new Map<string, "seller_claim" | "review_feedback">();
    if (prior.title !== null) {
      previous(prior.title, "title");
      for (const item of [...prior.title.data.keywords, ...prior.title.data.modifiers, ...prior.title.data.scenarios, prior.title.data.translation]) entries.set(item.entryId, "seller_claim");
    }
    if (prior.selling !== null) {
      previous(prior.selling, "selling");
      for (const item of [...prior.selling.data.points, ...prior.selling.data.bulletTranslations]) entries.set(item.entryId, "seller_claim");
    }
    if (prior.buyers !== null) {
      previous(prior.buyers, "buyers_synthesis");
      for (const item of [...prior.buyers.data.groups, ...prior.buyers.data.concerns]) entries.set(item.entryId, "review_feedback");
    }
    if (entries.size === 0) fail("DEEP_SUMMARY_SOURCE_UNAVAILABLE");
    const data = parse(summarySchema, raw);
    for (const claim of [data.positioning, ...data.advantages, ...data.weaknesses, ...data.learnings, ...data.opportunities]) {
      unique(claim.references, "DEEP_SUMMARY_DUPLICATE_REFERENCE");
      for (const id of claim.references) {
        const basis = entries.get(id);
        if (!basis) fail("DEEP_SUMMARY_REFERENCE_UNKNOWN");
        if (claim.basis !== "inference" && claim.basis !== basis) fail("DEEP_SUMMARY_BASIS_MISMATCH");
      }
    }
    const incompleteSources: CompetitorDeepSummaryResult["data"]["incompleteSources"] = [];
    if (prior.title === null) incompleteSources.push("title");
    if (prior.selling === null) incompleteSources.push("selling");
    if (prior.buyers === null) incompleteSources.push("reviews");
    incompleteSources.push("images", "questions");
    return receipt("summary", { ...data, incompleteSources, scope: "listing_text_and_imported_review_sample" as const });
  }
  return { validateTitle, validateSelling, validateBuyerBatch, validateBuyers, validateSummary };
}
export type CompetitorDeepResearchValidator = ReturnType<typeof createCompetitorDeepResearchValidator>;
