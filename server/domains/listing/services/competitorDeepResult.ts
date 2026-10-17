import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalCompetitorResearchEvidence as canonical, verifyCompetitorResearchEvidencePlan } from "../../../../shared/competitorResearchEvidence";
import type { CompetitorDeepSummaryResult } from "../../../../shared/competitorDeepResearch";
import { createCompetitorDeepExecution } from "./competitorDeepExecution";

export const COMPETITOR_DEEP_RESULT_MAX_BYTES = 512 * 1024;
export const COMPETITOR_DEEP_RESULT_SAMPLE_LIMIT = 3;
const INPUT_MAX_BYTES = 16 * 1024 * 1024;
export class CompetitorDeepResultError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CompetitorDeepResultError"; }
}
function fail(code: string): never { throw new CompetitorDeepResultError(code); }
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const inputSchema = z.object({ evidence: z.unknown(), skills: z.unknown(), journal: z.unknown(),
  jobRunId: z.string().min(1).max(80).refine(value => value.trim() === value),
  generatedAt: z.string().refine(value => {
    try { return new Date(value).toISOString() === value; } catch { return false; }
  }),
}).strict();
export type CompetitorDeepResultInput = z.infer<typeof inputSchema>;

function validUnicode(value: unknown): void {
  if (typeof value === "string" && Buffer.from(value, "utf8").toString("utf8") !== value) fail("DEEP_RESULT_INVALID_JSON");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { validUnicode(key); validUnicode(child); }
}
function json(value: unknown, maximum: number, code: string) {
  let encoded: string;
  try { encoded = canonical(value); } catch { return fail("DEEP_RESULT_INVALID_JSON"); }
  if (Buffer.byteLength(encoded, "utf8") > maximum) fail(code);
  // Canonical encoding rejects getters and custom objects before this inert walk.
  validUnicode(JSON.parse(encoded));
  return encoded;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function summaryText(summary: CompetitorDeepSummaryResult | null, reviews: { status: "available" | "unavailable"; total: number | null }): string | null {
  if (!summary) return null;
  const labels = { seller_claim: "商家宣称", review_feedback: "评论反馈", inference: "分析推断" };
  const claim = (value: CompetitorDeepSummaryResult["data"]["positioning"]) =>
    `${value.text}（${labels[value.basis]}；依据：${value.references.join("、")}）`;
  const sections = [["优势", summary.data.advantages], ["劣势", summary.data.weaknesses],
    ["值得借鉴的点", summary.data.learnings], ["可超越的点", summary.data.opportunities]] as const;
  const missingLabels = { title: "标题", selling: "五点/卖点资料", reviews: "评论分析", images: "图片", questions: "真实问答" };
  const text = ["竞品研究候选摘要（未确认）", "范围：已保存标题、五点及可用的导入评论样本；不代表市场全部评论。图片与真实问答未分析。",
    reviews.status === "available" ? `导入原评论样本：${reviews.total} 条。` : "导入原评论不可用，样本总数未知。",
    `未完成分析的来源：${summary.data.incompleteSources.map(source => missingLabels[source]).join("、")}。`,
    `产品定位：${claim(summary.data.positioning)}`,
    ...sections.flatMap(([label, values]) => values.length ? [label, ...values.map(value => `- ${claim(value)}`)] : []),
  ].join("\n");
  if (text.length > 20_000 || Buffer.byteLength(text, "utf8") > 65_535) fail("DEEP_RESULT_SUMMARY_TOO_LARGE");
  return text;
}

/** Build an artifact candidate, never authorize/publish it. The caller must load
 * the real job and hold its authorization/source/lease locks when committing.
 * jobRunId and generatedAt are validated metadata, NOT proof of that authority.
 * All derived receipts are replayed from evidence + approved-plan shape + raw
 * journal outputs. No stored derived results or caller-supplied counts are used.
 *
 * Friend-compatible display strings coexist with exact trace data and explicit
 * missing states. This is not a drop-in replacement for the friend's unsafe
 * `if (deepAnalysis) => complete` confirmation check. Full originals/batch raw
 * outputs remain in job input; this is NOT an independent permanent review store.
 * Persist the full candidate in ai_artifacts JSON, not competitor rawData TEXT. */
export function buildCompetitorDeepResult(input: CompetitorDeepResultInput) {
  const decoded = inputSchema.safeParse(JSON.parse(json(input, INPUT_MAX_BYTES, "DEEP_RESULT_INPUT_TOO_LARGE")));
  if (!decoded.success) fail("DEEP_RESULT_INPUT_INVALID");
  const value = decoded.data, evidence = verifyCompetitorResearchEvidencePlan(value.evidence, digest);
  const { journal, results } = createCompetitorDeepExecution(evidence, value.skills).inspect(value.journal);
  if (journal.steps.some(step => step.status !== "succeeded" && step.status !== "missing")) fail("DEEP_RESULT_JOURNAL_NOT_SETTLED");
  const step = (stage: string) => {
    const found = journal.steps.find(item => item.stage === stage);
    if (!found) return fail("DEEP_RESULT_STAGE_MISSING");
    return { status: found.status as "succeeded" | "missing", missingReason: found.missingReason };
  };
  const reviewState = evidence.reviews;
  const originals = reviewState.batches.flatMap(batch => batch.items);
  const byReviewId = new Map(originals.map((review, index) => [review.reviewId, { review, index }]));
  const themeIds = new Map(results.batches.flatMap(batch => batch.data.themes).map(theme => [theme.themeId, theme.reviewIds]));
  const groups = (results.buyers?.data.groups ?? []).map(group => {
    const ids = new Set<string>();
    for (const themeId of group.themeIds) {
      const theme = themeIds.get(themeId);
      if (!theme) fail("DEEP_RESULT_TRACE_INCONSISTENT");
      for (const id of theme) ids.add(id);
    }
    const members = [...ids].map(id => {
      const item = byReviewId.get(id);
      if (!item) return fail("DEEP_RESULT_TRACE_INCONSISTENT");
      return item;
    }).sort((a, b) => a.index - b.index);
    if (members.length !== group.count || reviewState.status !== "available" || results.buyers?.data.sampleCount !== reviewState.total) fail("DEEP_RESULT_TRACE_INCONSISTENT");
    const examples = members.slice(0, COMPETITOR_DEEP_RESULT_SAMPLE_LIMIT).map(({ review }) => ({
      id: review.reviewId, reviewId: review.reviewId, sourceReviewId: review.sourceReviewId,
      title: review.title, body: review.body, rating: review.rating,
      locations: review.occurrences.map(occurrence => ({ sheet: occurrence.sheet, row: occurrence.row })),
    }));
    return { ...group, denominator: reviewState.total, reviewIds: members.map(({ review }) => review.reviewId), evidence: examples,
      evidenceSelection: { strategy: "first_three_in_original_order" as const, limit: COMPETITOR_DEEP_RESULT_SAMPLE_LIMIT,
        shownCount: examples.length, matchingReviewCount: group.count, omittedCount: group.count - examples.length } };
  });
  const noThemeReviewIds = results.batches.flatMap(batch => batch.data.noThemeReviewIds);
  const accountedReviewCount = reviewState.status === "available" ? results.batches.reduce((sum, batch) => sum + batch.data.accountedReviewCount, 0) : null;
  if (reviewState.status === "available" && (accountedReviewCount !== reviewState.total || results.batches.length !== reviewState.batches.length)) fail("DEEP_RESULT_TRACE_INCONSISTENT");
  const missingStages = journal.steps.filter(item => item.status === "missing").map(item => ({ stage: item.stage, reason: item.missingReason }));
  const summary = results.summary?.data;
  const deepAnalysis = {
    version: 1 as const, kind: "competitor_deep_research" as const, generatedAt: value.generatedAt,
    status: results.summary ? "ready_for_review" as const : "incomplete_sources" as const,
    deepResearchComplete: false as const,
    source: { identity: evidence.identity, jobRunId: value.jobRunId, evidenceHash: evidence.evidenceHash,
      skillPlanHash: journal.skillPlanHash, journalHash: journal.journalHash },
    coverage: {
      researchScope: "listing_text_and_imported_review_sample" as const, missingStages,
      reviews: { status: reviewState.status, total: reviewState.total, accountedReviewCount,
        scope: reviewState.status === "available" ? reviewState.coverage.scope : null,
        missingReason: step("buyers_synthesis").missingReason,
        sourceUnavailableReason: reviewState.status === "unavailable" ? reviewState.reason : null,
        batchCount: reviewState.batches.length, validatedBatchCount: results.batches.length,
        noThemeReviewCount: reviewState.status === "available" ? noThemeReviewIds.length : null },
      images: { status: "unavailable" as const, reason: "not_included_no_ocr" as const, analyzedCount: 0 },
      questions: { status: "unavailable" as const, reason: "unavailable_no_question_evidence" as const },
      subtitle: { status: "unavailable" as const, reason: "not_included_in_evidence" as const },
    },
    title: { ...step("title"), keywords: results.title?.data.keywords ?? [], modifiers: results.title?.data.modifiers ?? [],
      scenarios: results.title?.data.scenarios ?? [], titleZh: results.title?.data.titleZh ?? null, subtitleZh: null },
    selling: { ...step("selling"), points: (results.selling?.data.points ?? []).map(point => ({ ...point,
      goldenQuote: point.goldenQuote?.quote ?? "" })),
      bulletTranslations: (results.selling?.data.bulletTranslations ?? []).map(translation => translation.zh),
      imageCount: 0, imageEvidence: "not_included_no_ocr" as const,
      frequencyScope: "exact_non_overlapping_listing_text_positions_only" as const },
    buyers: { ...step("buyers_synthesis"), sampleCount: reviewState.total, accountedReviewCount,
      scope: reviewState.status === "available" ? reviewState.coverage.scope : null,
      groups, concerns: results.buyers?.data.concerns ?? [], noThemeReviewIds,
      questions: "unavailable_no_question_evidence" as const },
    summary: { ...step("summary"), positioning: summary?.positioning.text ?? null,
      advantages: summary?.advantages.map(claim => claim.text) ?? [], weaknesses: summary?.weaknesses.map(claim => claim.text) ?? [],
      learnings: summary?.learnings.map(claim => claim.text) ?? [], opportunities: summary?.opportunities.map(claim => claim.text) ?? [] },
    trace: {
      originalEvidenceLocation: "ai_jobs.input.evidence" as const,
      batchRawOutputLocation: "ai_jobs.input.journal.steps" as const,
      independentPermanentOriginalStore: false as const,
      listingSources: evidence.listingSources,
      reviewSource: reviewState.status === "available" ? { parserVersion: reviewState.parserVersion,
        parserCorpusHash: reviewState.parserCorpusHash, authorizedCorpusHash: reviewState.authorizedCorpusHash, source: reviewState.source } : null,
      validated: { title: results.title, selling: results.selling, buyers: results.buyers, summary: results.summary },
      stages: journal.steps.map(item => ({ stage: item.stage, status: item.status, missingReason: item.missingReason,
        requestHash: item.requestHash, dispatchId: item.dispatchId, outputHash: item.outputHash, modelReceipt: item.modelReceipt })),
      batches: results.batches.map(batch => {
        const checkpoint = journal.steps.find(item => item.stage === batch.stage);
        if (!checkpoint?.modelReceipt || checkpoint.status !== "succeeded") return fail("DEEP_RESULT_TRACE_INCONSISTENT");
        return { stage: batch.stage, batchIndex: batch.data.batchIndex, batchId: batch.data.batchId,
          batchHash: batch.data.batchHash, outputHash: batch.outputHash, accountedReviewCount: batch.data.accountedReviewCount,
          modelRunId: checkpoint.modelReceipt.runId, requestHash: checkpoint.requestHash, dispatchId: checkpoint.dispatchId };
      }),
    },
  };
  const body = { deepAnalysis, summaryText: summaryText(results.summary, reviewState) };
  const resultHash = digest(json(body, COMPETITOR_DEEP_RESULT_MAX_BYTES, "DEEP_RESULT_TOO_LARGE"));
  const result = { ...body, resultHash };
  json(result, COMPETITOR_DEEP_RESULT_MAX_BYTES, "DEEP_RESULT_TOO_LARGE");
  return freeze(result);
}
export type CompetitorDeepResult = ReturnType<typeof buildCompetitorDeepResult>;
