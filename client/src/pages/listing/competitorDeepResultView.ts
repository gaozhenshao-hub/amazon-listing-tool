import { z } from "zod";
import { canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";

/** Browser display boundary only. Authorization and raw-journal replay belong to
 * the read endpoint. Matching IDs/digests here do NOT prove model execution,
 * source authenticity or current Skill approval. Never pass legacy raw.deepAnalysis.
 * This projection has no network, model, confirmation or publication operation. */
export const COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES = 512 * 1024;
export class CompetitorDeepResultViewError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CompetitorDeepResultViewError"; }
}
function fail(code = "DEEP_VIEW_INCONSISTENT"): never { throw new CompetitorDeepResultViewError(code); }
const text = z.string().min(1).refine(value => value.trim().length > 0);
const count = z.number().int().nonnegative().safe(), id = count.positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/u), reviewId = z.string().regex(/^review_[a-f0-9]{64}$/u);
const scopeSchema = z.object({ userId: id, workspaceId: id.nullable(), projectId: id, analysisId: id,
  asin: z.string().regex(/^[A-Z0-9]{10}$/u), revision: hash }).strict();
const identitySchema = scopeSchema.omit({ revision: true }).extend({ sourceWorkspaceId: id.nullable() }).strict();
const sourceIdentitySchema = identitySchema.extend({ revision: hash }).strict();
const missingReason = z.enum(["title_unavailable", "listing_unavailable", "reviews_unavailable", "no_matching_reviews", "no_supported_claims"]);
const state = { status: z.enum(["succeeded", "missing"]), missingReason: missingReason.nullable() };
const citationSchema = z.object({ sourceId: text, start: count, end: id, quote: text }).strict();
const termSchema = z.object({ entryId: text, text, zh: text, citation: citationSchema }).strict();
const translationSchema = z.object({ entryId: text, sourceId: text, zh: text, citation: citationSchema }).strict();
const titleDataSchema = z.object({ keywords: z.array(termSchema).min(1), modifiers: z.array(termSchema), scenarios: z.array(termSchema),
  titleZh: text, translation: z.object({ entryId: text, citation: citationSchema }).strict() }).strict();
const sellingPoint = { entryId: text, name: text, description: text, strength: z.enum(["极高", "高", "中", "低"]),
  occurrences: z.array(citationSchema).min(1), frequency: id, sourceFrequency: id };
const sellingDataSchema = z.object({ points: z.array(z.object({ ...sellingPoint, goldenQuote: citationSchema.nullable() }).strict()).min(1),
  bulletTranslations: z.array(translationSchema), imageEvidence: z.literal("not_included_no_ocr") }).strict();
const buyerGroup = { entryId: text, name: text, sentiment: z.enum(["positive", "negative"]), themeIds: z.array(text).min(1),
  count: id, percentage: z.number().min(0).max(100) };
const concernSchema = z.object({ entryId: text, question: text, status: z.enum(["已满足", "未满足", "评价不一", "证据不足"]),
  explanation: text, themeIds: z.array(text).min(1), origin: z.literal("derived_from_review_themes") }).strict();
const buyersDataSchema = z.object({ groups: z.array(z.object(buyerGroup).strict()), concerns: z.array(concernSchema).max(8),
  sampleCount: id.max(20000), accountedReviewCount: id.max(20000), noThemeReviewCount: count.max(20000),
  scope: z.literal("complete_file_not_market_total"), questions: z.literal("unavailable_no_question_evidence") }).strict();
const claimSchema = z.object({ text, basis: z.enum(["seller_claim", "review_feedback", "inference"]), references: z.array(text).min(1) }).strict();
const summaryDataSchema = z.object({ positioning: claimSchema, advantages: z.array(claimSchema).max(5), weaknesses: z.array(claimSchema).max(5),
  learnings: z.array(claimSchema).max(5), opportunities: z.array(claimSchema).max(5),
  incompleteSources: z.array(z.enum(["title", "selling", "reviews", "images", "questions"])),
  scope: z.literal("listing_text_and_imported_review_sample") }).strict();
const receipt = <S extends string, D extends z.ZodType>(stage: S, data: D) =>
  z.object({ version: z.literal(1), stage: z.literal(stage), evidenceHash: hash, outputHash: hash, data }).strict();
const listingSchema = z.object({ sourceId: text, kind: z.enum(["title", "bullet"]), ordinal: count, text,
  span: z.object({ start: z.literal(0), end: count, unit: z.literal("utf16_code_units") }).strict() }).strict();
const reviewSourceSchema = z.object({ parserVersion: z.literal("competitor-review-corpus/1"), parserCorpusHash: hash, authorizedCorpusHash: hash,
  source: z.object({ runId: text.max(255), fileName: text.max(500), fileHash: hash }).strict() }).strict();
const exampleSchema = z.object({ id: reviewId, reviewId, sourceReviewId: text.nullable(), title: text.nullable(), body: text.max(32000),
  rating: z.number().min(0).max(5).nullable(), locations: z.array(z.object({ sheet: text, row: id.min(2) }).strict()).min(1) }).strict();
const groupSchema = z.object({ ...buyerGroup, denominator: id.max(20000), reviewIds: z.array(reviewId).min(1),
  evidence: z.array(exampleSchema).min(1).max(3), evidenceSelection: z.object({ strategy: z.literal("first_three_in_original_order"),
    limit: z.literal(3), shownCount: count.max(3), matchingReviewCount: id, omittedCount: count }).strict() }).strict();
const stageName = z.string().regex(/^(?:title|selling|buyers:(?:0|[1-9]\d*)|buyers_synthesis|summary)$/u);
const shortHash = z.string().regex(/^[a-f0-9]{16}$/u);
const modelSchema = z.object({ runId: text.max(80), skillSlug: text.max(128), skillVersion: text.max(128),
  skillPromptHash: shortHash, skillManifestHash: shortHash, modelSlug: text.max(128) }).strict();
const stageTraceSchema = z.object({ stage: stageName, ...state, requestHash: hash.nullable(), dispatchId: hash.nullable(),
  outputHash: hash.nullable(), modelReceipt: modelSchema.nullable() }).strict();
const batchSchema = z.object({ stage: stageName, batchIndex: count, batchId: text, batchHash: hash, outputHash: hash,
  accountedReviewCount: id.max(60), modelRunId: text.max(80), requestHash: hash, dispatchId: hash }).strict();
const deepSchema = z.object({ version: z.literal(1), kind: z.literal("competitor_deep_research"),
  generatedAt: text.refine(value => { try { return new Date(value).toISOString() === value; } catch { return false; } }),
  status: z.literal("ready_for_review"), deepResearchComplete: z.literal(false),
  source: z.object({ identity: sourceIdentitySchema, jobRunId: text.max(80), evidenceHash: hash, skillPlanHash: hash, journalHash: hash }).strict(),
  coverage: z.object({ researchScope: z.literal("listing_text_and_imported_review_sample"),
    missingStages: z.array(z.object({ stage: stageName, reason: missingReason }).strict()),
    reviews: z.object({ status: z.enum(["available", "unavailable"]), total: count.max(20000).nullable(), accountedReviewCount: count.max(20000).nullable(),
      scope: z.literal("complete_file_not_market_total").nullable(), missingReason: missingReason.nullable(), sourceUnavailableReason: text.nullable(),
      batchCount: count.max(20000), validatedBatchCount: count.max(20000), noThemeReviewCount: count.max(20000).nullable() }).strict(),
    images: z.object({ status: z.literal("unavailable"), reason: z.literal("not_included_no_ocr"), analyzedCount: z.literal(0) }).strict(),
    questions: z.object({ status: z.literal("unavailable"), reason: z.literal("unavailable_no_question_evidence") }).strict(),
    subtitle: z.object({ status: z.literal("unavailable"), reason: z.literal("not_included_in_evidence") }).strict() }).strict(),
  title: z.object({ ...state, keywords: z.array(termSchema), modifiers: z.array(termSchema), scenarios: z.array(termSchema),
    titleZh: text.nullable(), subtitleZh: z.null() }).strict(),
  selling: z.object({ ...state, points: z.array(z.object({ ...sellingPoint, goldenQuote: z.string() }).strict()), bulletTranslations: z.array(text),
    imageCount: z.literal(0), imageEvidence: z.literal("not_included_no_ocr"), frequencyScope: z.literal("exact_non_overlapping_listing_text_positions_only") }).strict(),
  buyers: z.object({ ...state, sampleCount: count.max(20000).nullable(), accountedReviewCount: count.max(20000).nullable(),
    scope: z.literal("complete_file_not_market_total").nullable(), groups: z.array(groupSchema), concerns: z.array(concernSchema).max(8),
    noThemeReviewIds: z.array(reviewId), questions: z.literal("unavailable_no_question_evidence") }).strict(),
  summary: z.object({ status: z.literal("succeeded"), missingReason: z.null(), positioning: text, advantages: z.array(text).max(5),
    weaknesses: z.array(text).max(5), learnings: z.array(text).max(5), opportunities: z.array(text).max(5) }).strict(),
  trace: z.object({ originalEvidenceLocation: z.literal("ai_jobs.input.evidence"), batchRawOutputLocation: z.literal("ai_jobs.input.journal.steps"),
    independentPermanentOriginalStore: z.literal(false), listingSources: z.array(listingSchema), reviewSource: reviewSourceSchema.nullable(),
    validated: z.object({ title: receipt("title", titleDataSchema).nullable(), selling: receipt("selling", sellingDataSchema).nullable(),
      buyers: receipt("buyers_synthesis", buyersDataSchema).nullable(), summary: receipt("summary", summaryDataSchema) }).strict(),
    stages: z.array(stageTraceSchema).min(4).max(20004), batches: z.array(batchSchema).max(20000) }).strict(),
}).strict();
const resultSchema = z.object({ deepAnalysis: deepSchema, summaryText: text.max(20000), resultHash: hash }).strict();
const envelopeFields = { identity: identitySchema, currentRevision: hash, reviewRequired: z.literal(true) };
const envelopeSchema = z.discriminatedUnion("status", [
  z.object({ ...envelopeFields, status: z.literal("not_available"), sourceChanged: z.literal(false) }).strict(),
  z.object({ ...envelopeFields, status: z.literal("available"), sourceChanged: z.boolean(), result: resultSchema }).strict(),
]);
type Deep = z.infer<typeof deepSchema>;
export type CompetitorDeepResultViewScope = z.infer<typeof scopeSchema>;
export type CompetitorDeepSummaryClaim = z.infer<typeof claimSchema>;
export type CompetitorDeepDisplayResult = {
  generatedAt: string; resultHash: string; status: "ready_for_review"; deepResearchComplete: false;
  source: Deep["source"]; coverage: Deep["coverage"]; listingSources: Deep["trace"]["listingSources"];
  reviewSource: Deep["trace"]["reviewSource"]; title: Deep["title"];
  selling: Omit<Deep["selling"], "points" | "bulletTranslations"> & {
    points: Array<Deep["selling"]["points"][number] & { goldenCitation: z.infer<typeof citationSchema> | null }>;
    bulletTranslations: z.infer<typeof translationSchema>[];
  };
  buyers: Deep["buyers"];
  summary: z.infer<typeof summaryDataSchema> & { status: "succeeded"; missingReason: null };
  summaryText: string;
};
export type CompetitorDeepResultView = { identity: z.infer<typeof identitySchema>; currentRevision: string; reviewRequired: true } &
  ({ status: "not_available"; sourceChanged: false } | { status: "available"; sourceChanged: boolean; result: CompetitorDeepDisplayResult });

function unicode(value: unknown): void {
  if (typeof value === "string" && new TextDecoder().decode(new TextEncoder().encode(value)) !== value) fail("DEEP_VIEW_JSON_INVALID");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { unicode(key); unicode(child); }
}
function bounded(value: unknown, maximum: number): string {
  let wire: string;
  try { wire = canonical(value); } catch { return fail("DEEP_VIEW_JSON_INVALID"); }
  if (new TextEncoder().encode(wire).byteLength > maximum) fail("DEEP_VIEW_TOO_LARGE");
  unicode(JSON.parse(wire)); return wire;
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
function unique(values: string[]) { if (new Set(values).size !== values.length) fail(); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function checkDeep(deep: Deep) {
  const { trace, coverage, title, selling, buyers, summary, source } = deep, validated = trace.validated;
  const listings = new Map(trace.listingSources.map(item => [item.sourceId, item]));
  if (listings.size !== trace.listingSources.length) fail();
  const titles = trace.listingSources.filter(item => item.kind === "title"), bullets = trace.listingSources.filter(item => item.kind === "bullet");
  if (titles.length > 1 || !same(trace.listingSources, [...titles, ...bullets])) fail();
  trace.listingSources.forEach(item => {
    if (item.span.end !== item.text.length || item.sourceId !== `analysis:${source.identity.analysisId}:${item.kind === "title" ? "title" : `bullet:${item.ordinal}`}`
      || (item.kind === "title" && item.ordinal !== 0)) fail();
  });
  if (bullets.some((item, i) => item.ordinal !== i + 1)) fail();
  const exact = (citation: z.infer<typeof citationSchema>, kind?: "title") => {
    const item = listings.get(citation.sourceId), split = (at: number) => item && /[\uD800-\uDBFF]/u.test(item.text.charAt(at - 1)) && /[\uDC00-\uDFFF]/u.test(item.text.charAt(at));
    if (!item || (kind && item.kind !== kind) || citation.end <= citation.start || citation.end > item.text.length
      || split(citation.start) || split(citation.end) || item.text.slice(citation.start, citation.end) !== citation.quote) fail();
  };
  const entries = new Map<string, "seller_claim" | "review_feedback">();
  const add = (entryId: string, expected: string, basis: "seller_claim" | "review_feedback") => {
    if (entryId !== expected || entries.has(entryId)) fail(); entries.set(entryId, basis);
  };
  const expectedState = (value: { status: string; missingReason: string | null }, reason: string | null) => {
    if (value.status !== (reason ? "missing" : "succeeded") || value.missingReason !== reason) fail();
  };
  expectedState(title, titles.length ? null : "title_unavailable");
  expectedState(selling, listings.size ? null : "listing_unavailable");
  if (validated.title) {
    const data = validated.title.data, { translation, ...visible } = data;
    if (!titles.length) fail();
    if (!same({ keywords: title.keywords, modifiers: title.modifiers, scenarios: title.scenarios, titleZh: title.titleZh }, visible)) fail();
    for (const [key, prefix] of [["keywords", "keyword"], ["modifiers", "modifier"], ["scenarios", "scenario"]] as const)
      data[key].forEach((term, i) => { exact(term.citation, "title"); if (term.text !== term.citation.quote) fail(); add(term.entryId, `title:${prefix}:${i + 1}`, "seller_claim"); });
    exact(translation.citation, "title");
    if (translation.citation.start !== 0 || translation.citation.end !== titles[0]?.text.length) fail();
    add(translation.entryId, "title:translation", "seller_claim");
  } else if (titles.length || title.titleZh !== null || title.keywords.length || title.modifiers.length || title.scenarios.length) fail();
  if (validated.selling) {
    const data = validated.selling.data;
    if (!listings.size || !same(selling.points, data.points.map(point => ({ ...point, goldenQuote: point.goldenQuote?.quote ?? "" })))
      || !same(selling.bulletTranslations, data.bulletTranslations.map(item => item.zh)) || data.bulletTranslations.length !== bullets.length) fail();
    data.points.forEach((point, i) => {
      add(point.entryId, `selling:point:${i + 1}`, "seller_claim");
      const positions = new Map<string, z.infer<typeof citationSchema>[]>();
      point.occurrences.forEach(citation => { exact(citation); const seen = positions.get(citation.sourceId) ?? [];
        if (seen.some(other => citation.start < other.end && citation.end > other.start)) fail(); seen.push(citation); positions.set(citation.sourceId, seen); });
      if (point.frequency !== point.occurrences.length || point.sourceFrequency !== positions.size) fail();
      if (point.goldenQuote) { exact(point.goldenQuote); if (!point.occurrences.some(item => same(item, point.goldenQuote))) fail(); }
    });
    data.bulletTranslations.forEach((item, i) => { exact(item.citation);
      if (item.sourceId !== bullets[i].sourceId || item.citation.sourceId !== item.sourceId || item.citation.start !== 0 || item.citation.end !== bullets[i].text.length) fail();
      add(item.entryId, `selling:translation:${i + 1}`, "seller_claim"); });
  } else if (listings.size || selling.points.length || selling.bulletTranslations.length) fail();
  const reviews = coverage.reviews, available = reviews.status === "available", total = reviews.total;
  const buyerMissing = !available ? "reviews_unavailable" : total === 0 ? "no_matching_reviews" : null;
  expectedState(buyers, buyerMissing);
  if ((available ? total === null || trace.reviewSource === null || reviews.sourceUnavailableReason !== null
    : total !== null || trace.reviewSource !== null || !reviews.sourceUnavailableReason)
    || reviews.accountedReviewCount !== total || buyers.sampleCount !== total || buyers.accountedReviewCount !== total
    || buyers.scope !== (available ? "complete_file_not_market_total" : null) || reviews.scope !== buyers.scope
    || reviews.missingReason !== buyerMissing || reviews.batchCount !== trace.batches.length || reviews.validatedBatchCount !== trace.batches.length
    || reviews.noThemeReviewCount !== (available ? buyers.noThemeReviewIds.length : null)) fail();
  unique(buyers.noThemeReviewIds);
  const themed = new Set<string>(), themes = new Set<string>(), examples = new Map<string, string>();
  buyers.groups.forEach((group, i) => {
    add(group.entryId, `buyers:group:${i + 1}`, "review_feedback"); unique(group.reviewIds); unique(group.themeIds);
    if (!available || !total || group.count !== group.reviewIds.length || group.denominator !== total || group.count > total
      || group.percentage !== Math.round(group.count / total * 1000) / 10) fail();
    for (const theme of group.themeIds) { if (themes.has(theme) || !/^buyers:batch:(?:0|[1-9]\d*):theme:[1-9]\d*$/u.test(theme)) fail(); themes.add(theme); }
    for (const member of group.reviewIds) themed.add(member);
    const selection = group.evidenceSelection, shown = Math.min(3, group.count);
    if (group.evidence.length !== shown || selection.shownCount !== shown || selection.matchingReviewCount !== group.count
      || selection.omittedCount !== group.count - shown || !same(group.evidence.map(item => item.reviewId), group.reviewIds.slice(0, shown))) fail();
    group.evidence.forEach(item => { if (item.id !== item.reviewId) fail(); unique(item.locations.map(location => canonical(location)));
      const prior = examples.get(item.reviewId), encoded = canonical(item); if (prior && prior !== encoded) fail(); examples.set(item.reviewId, encoded); });
  });
  buyers.concerns.forEach((concern, i) => { add(concern.entryId, `buyers:concern:${i + 1}`, "review_feedback"); unique(concern.themeIds);
    if (concern.themeIds.some(theme => !themes.has(theme))) fail(); });
  if (buyers.noThemeReviewIds.some(member => themed.has(member)) || (available && themed.size + buyers.noThemeReviewIds.length !== total)) fail();
  if (validated.buyers) {
    const data = validated.buyers.data;
    if (buyerMissing || !same(data.groups, buyers.groups.map(({ entryId, name, sentiment, themeIds, count, percentage }) => ({ entryId, name, sentiment, themeIds, count, percentage })))
      || !same(data.concerns, buyers.concerns) || data.sampleCount !== total || data.accountedReviewCount !== total || data.noThemeReviewCount !== buyers.noThemeReviewIds.length) fail();
  } else if (!buyerMissing || buyers.groups.length || buyers.concerns.length || buyers.noThemeReviewIds.length) fail();
  const expectedStages = ["title", "selling", ...trace.batches.map((_, i) => `buyers:${i}`), "buyers_synthesis", "summary"];
  if (!same(trace.stages.map(item => item.stage), expectedStages)) fail();
  const runs = new Set<string>();
  trace.stages.forEach(item => {
    const reason = item.stage === "title" ? title.missingReason : item.stage === "selling" ? selling.missingReason : item.stage === "buyers_synthesis" ? buyerMissing : null;
    expectedState(item, reason);
    if (reason) { if (item.requestHash !== null || item.dispatchId !== null || item.outputHash !== null || item.modelReceipt !== null) fail(); }
    else { if (!item.requestHash || !item.dispatchId || !item.outputHash || !item.modelReceipt || runs.has(item.modelReceipt.runId)) fail(); runs.add(item.modelReceipt.runId); }
  });
  if (!same(coverage.missingStages, trace.stages.filter(item => item.status === "missing").map(item => ({ stage: item.stage, reason: item.missingReason })))) fail();
  let accounted = 0;
  trace.batches.forEach((batch, i) => { const stage = trace.stages[i + 2]; accounted += batch.accountedReviewCount;
    if (batch.batchIndex !== i || batch.stage !== `buyers:${i}` || batch.batchId !== `analysis:${source.identity.analysisId}:reviews:${i + 1}`
      || batch.outputHash !== stage.outputHash || batch.requestHash !== stage.requestHash || batch.dispatchId !== stage.dispatchId || batch.modelRunId !== stage.modelReceipt?.runId) fail(); });
  if (accounted !== (total ?? 0) || (!available && trace.batches.length)) fail();
  for (const theme of themes) if (Number(theme.split(":")[2]) >= trace.batches.length) fail();
  for (const value of Object.values(validated)) if (value) {
    bounded(value, 64 * 1024);
    if (value.evidenceHash !== source.evidenceHash || value.outputHash !== trace.stages.find(item => item.stage === value.stage)?.outputHash) fail();
  }
  const claims = validated.summary.data;
  const incomplete = [...(!validated.title ? ["title"] : []), ...(!validated.selling ? ["selling"] : []), ...(!validated.buyers ? ["reviews"] : []), "images", "questions"];
  if (!same(claims.incompleteSources, incomplete) || summary.positioning !== claims.positioning.text) fail();
  for (const key of ["advantages", "weaknesses", "learnings", "opportunities"] as const) if (!same(summary[key], claims[key].map(item => item.text))) fail();
  for (const claim of [claims.positioning, ...claims.advantages, ...claims.weaknesses, ...claims.learnings, ...claims.opportunities]) {
    unique(claim.references); if (claim.references.some(reference => !entries.has(reference) || (claim.basis !== "inference" && entries.get(reference) !== claim.basis))) fail();
  }
}

export function parseCompetitorDeepResultView(value: unknown, currentScope: CompetitorDeepResultViewScope): CompetitorDeepResultView {
  const scopeResult = scopeSchema.safeParse(JSON.parse(bounded(currentScope, 4096)));
  if (!scopeResult.success) fail("DEEP_VIEW_SCOPE_INVALID");
  const candidate: unknown = JSON.parse(bounded(value, COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES + 4096));
  // Inspect only the inert canonical clone, never a caller getter. Artifact
  // bytes have their own cap; envelope headroom cannot enlarge that allowance.
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && Object.hasOwn(candidate, "result"))
    bounded((candidate as Record<string, unknown>).result, COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES);
  const parsed = envelopeSchema.safeParse(candidate);
  if (!parsed.success) fail("DEEP_VIEW_SCHEMA_INVALID");
  const envelope = parsed.data, scope = scopeResult.data, { revision, ...identity } = scope;
  const { sourceWorkspaceId, ...outer } = envelope.identity;
  if (!same(outer, identity) || envelope.currentRevision !== revision || (sourceWorkspaceId !== null && sourceWorkspaceId !== scope.workspaceId)) fail("DEEP_VIEW_SCOPE_MISMATCH");
  if (envelope.status === "not_available") return freeze(envelope);
  bounded(envelope.result, COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES);
  const deep = envelope.result.deepAnalysis, { revision: _sourceRevision, ...inner } = deep.source.identity;
  // The stored source revision precedes publication and differs even for a
  // current candidate. Only the server can compare committedRevision; preserve
  // its sourceChanged flag rather than inventing staleness from source.revision.
  if (!same(inner, envelope.identity)) fail("DEEP_VIEW_SCOPE_MISMATCH");
  checkDeep(deep);
  const display: CompetitorDeepDisplayResult = { generatedAt: deep.generatedAt, resultHash: envelope.result.resultHash,
    status: deep.status, deepResearchComplete: false, source: deep.source, coverage: deep.coverage,
    listingSources: deep.trace.listingSources, reviewSource: deep.trace.reviewSource, title: deep.title,
    selling: { ...deep.selling, points: deep.selling.points.map((point, i) => ({ ...point,
      goldenCitation: deep.trace.validated.selling?.data.points[i].goldenQuote ?? null })),
      bulletTranslations: deep.trace.validated.selling?.data.bulletTranslations ?? [] }, buyers: deep.buyers,
    summary: { status: "succeeded", missingReason: null, ...deep.trace.validated.summary.data }, summaryText: envelope.result.summaryText };
  return freeze({ status: "available", identity: envelope.identity, currentRevision: revision,
    sourceChanged: envelope.sourceChanged, reviewRequired: true, result: display });
}
