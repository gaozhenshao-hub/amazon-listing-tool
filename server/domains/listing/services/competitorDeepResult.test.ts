import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCompetitorReviewCorpus } from "./competitorReviewCorpus";
import { buildCompetitorResearchEvidencePlan, canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";
import { createCompetitorDeepExecution, type DeepExecutionRequest, type DeepSkillPlan } from "./competitorDeepExecution";
import { buildCompetitorDeepResult, COMPETITOR_DEEP_RESULT_MAX_BYTES, type CompetitorDeepResultInput } from "./competitorDeepResult";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const binding = { skillSlug: "synthetic-user-contract", version: "1", status: "Released" as const,
  systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "synthetic-only-not-approved",
  title: binding, selling: binding, buyers_batch: binding, buyers_synthesis: binding, summary: binding };
type Options = { reviews?: number | null; listing?: boolean; separateGroups?: boolean; bodyPadding?: number; neutralLast?: boolean };
function evidence(options: Options = {}) {
  const count = options.reviews === undefined ? 70 : options.reviews, asin = "B000000001", fileName = `${asin}.csv`;
  const bodies = Array.from({ length: count ?? 0 }, (_, i) => `Original review ${i}${" x".repeat(options.bodyPadding ?? 0)}`);
  const bytes = Buffer.from("ASIN,Review ID,Content,Rating\n" + (count ? bodies.map((body, i) => `${asin},platform-${i},${body},${i % 2 ? 1 : 5}`).join("\n") : "B000000002,other,Other,3"));
  const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin, projectId: 11, analysisId: 21, sourceFileHash: sha256(bytes) });
  return buildCompetitorResearchEvidencePlan({ identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: 7,
    projectId: 11, analysisId: 21, asin, revision: "d".repeat(64) },
    title: options.listing === false ? null : "Light for camps", bullets: options.listing === false ? [] : ["Long runtime"],
    reviews: count === null ? { status: "unavailable", reason: "Original unavailable" } : { status: "available", corpus,
      source: { runId: "synthetic-original", fileName, fileHash: sha256(bytes) }, authorizedCorpusHash: "e".repeat(64) },
  }, sha256);
}
const quote = (sourceId: string, text: string) => ({ sourceId, start: 0, end: text.length, quote: text });
function response(call: DeepExecutionRequest, options: Options): unknown {
  const input = call.input as Record<string, any>;
  if (call.stage === "title") return { keywords: [{ text: "Light", zh: "灯", citation: { sourceId: "analysis:21:title", start: 0, end: 5, quote: "Light" } }], modifiers: [], scenarios: [], titleZh: "露营灯" };
  if (call.stage === "selling") return { points: [{ name: "Runtime", description: "Seller runtime claim", strength: "高", occurrences: [quote("analysis:21:bullet:1", "Long runtime")], goldenQuote: quote("analysis:21:bullet:1", "Long runtime") }], bulletTranslations: [{ sourceId: "analysis:21:bullet:1", zh: "续航长" }] };
  if (call.stage.startsWith("buyers:")) {
    const items = input.items as Array<{ reviewId: string; body: string }>;
    const neutral = options.neutralLast ? items.slice(-1) : [], themed = options.neutralLast ? items.slice(0, -1) : items;
    return { themes: themed.map((review, i) => ({ name: `Theme ${i}`, sentiment: "positive", reviewIds: [review.reviewId],
      citations: [quote(`${review.reviewId}:body`, review.body.split(" x")[0])] })), noThemeReviewIds: neutral.map(review => review.reviewId) };
  }
  if (call.stage === "buyers_synthesis") {
    const ids = input.batches.flatMap((batch: any) => batch.data.themes.map((theme: any) => theme.themeId)) as string[];
    return { groups: options.separateGroups ? ids.map((id, index) => ({ name: `Group ${index}`, sentiment: "positive", themeIds: [id] }))
      : ids.length ? [{ name: "Combined theme", sentiment: "positive", themeIds: ids }] : [],
    concerns: ids.length ? [{ question: "Does the runtime meet needs?", status: "证据不足", explanation: "Concern inferred from review themes", themeIds: [ids[0]] }] : [] };
  }
  return { positioning: { text: "Runtime positioning", basis: input.selling ? "seller_claim" : "review_feedback",
    references: [input.selling ? "selling:point:1" : "buyers:group:1"] },
  advantages: [{ text: "A supported interpretation", basis: "inference", references: [input.selling ? "selling:point:1" : "buyers:group:1"] }],
  weaknesses: [], learnings: [], opportunities: [] };
}
async function settled(options: Options = {}): Promise<CompetitorDeepResultInput> {
  const source = evidence(options), kernel = createCompetitorDeepExecution(source, skills);
  let journal = kernel.initial();
  const store = { read: async () => journal, compareAndSwap: async (expected: string, next: typeof journal) => {
    if (journal.journalHash !== expected) throw new Error("CAS"); journal = next; return next;
  }, assertCurrent: async () => undefined };
  for (let i = 0; i < journal.steps.length; i++) await kernel.runNext(store, async call => ({ raw: response(call, options),
    receipt: { runId: `synthetic-${call.stage}`, skillSlug: binding.skillSlug, skillVersion: binding.version,
      skillPromptHash: binding.systemPromptHash, skillManifestHash: binding.manifestHash, modelSlug: "synthetic-model" } }), new AbortController().signal);
  return { evidence: source, skills: structuredClone(skills), journal, jobRunId: "synthetic-job", generatedAt: "2026-10-17T08:00:00.000Z" };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("replayed four-column artifact candidate, not a publication receipt", () => {
  it("projects friend-compatible strings while retaining exact validated citations and claims", async () => {
    const source = await settled({ reviews: 2 }), result = buildCompetitorDeepResult(source), deep = result.deepAnalysis;
    expect(deep).toMatchObject({ version: 1, status: "ready_for_review", deepResearchComplete: false });
    expect(deep.title.titleZh).toBe("露营灯");
    expect(deep.selling.points[0]).toMatchObject({ goldenQuote: "Long runtime", frequency: 1, sourceFrequency: 1 });
    expect(deep.selling.bulletTranslations).toEqual(["续航长"]);
    expect(deep.summary).toMatchObject({ positioning: "Runtime positioning", advantages: ["A supported interpretation"] });
    expect(deep.trace.validated.selling?.data.points[0].goldenQuote).toEqual(quote("analysis:21:bullet:1", "Long runtime"));
    expect(deep.trace.validated.summary?.data.positioning).toMatchObject({ basis: "seller_claim", references: ["selling:point:1"] });
    expect(deep.trace.validated.title?.data.keywords[0].citation).toMatchObject({ start: 0, end: 5, quote: "Light" });
    expect(result.summaryText).toContain("商家宣称；依据：selling:point:1");
    expect(result.summaryText).toContain("分析推断；依据：selling:point:1");
    expect(result.summaryText).toContain("未确认");
  });
  it("keeps every member ID and denominator while explicitly sampling at most three complete originals", async () => {
    const source = await settled(), result = buildCompetitorDeepResult(source), deep = result.deepAnalysis;
    const group = deep.buyers.groups[0];
    expect(group).toMatchObject({ count: 70, denominator: 70, percentage: 100,
      evidenceSelection: { strategy: "first_three_in_original_order", limit: 3, shownCount: 3, matchingReviewCount: 70, omittedCount: 67 } });
    expect(group.reviewIds).toHaveLength(70); expect(new Set(group.reviewIds).size).toBe(70);
    expect(group.evidence.map(review => review.body)).toEqual(["Original review 0", "Original review 1", "Original review 2"]);
    expect(group.evidence[0].id).toMatch(/^review_[a-f0-9]{64}$/u);
    expect(group.evidence[0].sourceReviewId).toBe("platform-0");
    expect(group.evidence[0].sourceReviewId).not.toBe(group.evidence[0].reviewId);
    expect(group.evidence[0].locations).toEqual([{ sheet: "CSV", row: 2 }]);
    expect(deep.coverage.reviews).toMatchObject({ total: 70, accountedReviewCount: 70, scope: "complete_file_not_market_total" });
    expect(deep.trace.batches.length).toBeGreaterThan(1);
    expect(deep.trace.batches.every(batch => !Object.hasOwn(batch, "themes"))).toBe(true);
    expect(deep.trace.batches[0]).toMatchObject({ stage: "buyers:0", batchIndex: 0, modelRunId: "synthetic-buyers:0" });
    expect(deep.trace.batches[0].requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("does not truncate representative original text or mix platform and canonical identities", async () => {
    const result = buildCompetitorDeepResult(await settled({ reviews: 1, bodyPadding: 200 }));
    expect(result.deepAnalysis.buyers.groups[0].evidence[0].body).toBe(`Original review 0${" x".repeat(200)}`);
    expect(result.deepAnalysis.trace.reviewSource).toMatchObject({ parserVersion: "competitor-review-corpus/1",
      authorizedCorpusHash: "e".repeat(64), source: { runId: "synthetic-original", fileName: "B000000001.csv" } });
  });
  it("preserves explicit no-theme accounting rather than treating neutral items as missing", async () => {
    const result = buildCompetitorDeepResult(await settled({ reviews: 5, neutralLast: true }));
    expect(result.deepAnalysis.buyers).toMatchObject({ sampleCount: 5, accountedReviewCount: 5 });
    expect(result.deepAnalysis.buyers.noThemeReviewIds).toHaveLength(1);
    expect(result.deepAnalysis.buyers.groups[0]).toMatchObject({ count: 4, denominator: 5, percentage: 80 });
    expect(result.deepAnalysis.coverage.reviews.noThemeReviewCount).toBe(1);
  });
  it.each([0, null])("preserves zero versus unknown original sample %s", async reviews => {
    const deep = buildCompetitorDeepResult(await settled({ reviews })).deepAnalysis;
    expect(deep.buyers.sampleCount).toBe(reviews);
    expect(deep.buyers.accountedReviewCount).toBe(reviews);
    expect(deep.buyers.missingReason).toBe(reviews === 0 ? "no_matching_reviews" : "reviews_unavailable");
    expect(deep.coverage.reviews.status).toBe(reviews === 0 ? "available" : "unavailable");
    expect(deep.buyers.scope).toBe(reviews === 0 ? "complete_file_not_market_total" : null);
    expect(deep.buyers.groups).toEqual([]);
  });
  it("does not claim images, subtitle or real questions were read", async () => {
    const deep = buildCompetitorDeepResult(await settled({ reviews: 2 })).deepAnalysis;
    expect(deep.coverage.images).toEqual({ status: "unavailable", reason: "not_included_no_ocr", analyzedCount: 0 });
    expect(deep.coverage.questions.status).toBe("unavailable");
    expect(deep.coverage.subtitle.status).toBe("unavailable");
    expect(deep.selling.imageCount).toBe(0);
    expect(deep.buyers.concerns[0].origin).toBe("derived_from_review_themes");
    expect(deep.deepResearchComplete).toBe(false);
  });
  it("returns an explicit source-incomplete artifact without inventing summary text", async () => {
    const result = buildCompetitorDeepResult(await settled({ reviews: null, listing: false }));
    expect(result.summaryText).toBeNull();
    expect(result.deepAnalysis).toMatchObject({ status: "incomplete_sources", deepResearchComplete: false,
      title: { status: "missing", titleZh: null }, summary: { status: "missing", missingReason: "no_supported_claims", positioning: null } });
    expect(result.deepAnalysis.trace.validated.summary).toBeNull();
    expect(result.deepAnalysis.coverage.missingStages).toHaveLength(4);
  });
  it("can retain review-only results without inventing title or bullet content", async () => {
    const deep = buildCompetitorDeepResult(await settled({ reviews: 2, listing: false })).deepAnalysis;
    expect(deep.title).toMatchObject({ status: "missing", missingReason: "title_unavailable", keywords: [] });
    expect(deep.selling).toMatchObject({ status: "missing", missingReason: "listing_unavailable", points: [] });
    expect(deep.summary.status).toBe("succeeded");
    expect(deep.trace.validated.summary?.data.positioning.basis).toBe("review_feedback");
  });
  it("includes complete stage-level request/model traces but makes no independent permanent-store claim", async () => {
    const deep = buildCompetitorDeepResult(await settled({ reviews: 2 })).deepAnalysis;
    expect(deep.trace.originalEvidenceLocation).toBe("ai_jobs.input.evidence");
    expect(deep.trace.batchRawOutputLocation).toBe("ai_jobs.input.journal.steps");
    expect(deep.trace.independentPermanentOriginalStore).toBe(false);
    for (const stage of deep.trace.stages) {
      expect(stage.requestHash).toMatch(/^[a-f0-9]{64}$/u); expect(stage.dispatchId).toMatch(/^[a-f0-9]{64}$/u);
      expect(stage.outputHash).toMatch(/^[a-f0-9]{64}$/u); expect(stage.modelReceipt?.runId).toBe(`synthetic-${stage.stage}`);
    }
    expect(deep.source).toMatchObject({ jobRunId: "synthetic-job", identity: { projectId: 11, analysisId: 21, userId: 3, workspaceId: 7 } });
  });
});

describe("result revalidation, immutability and strict bounds", () => {
  it("is deterministic and binds the full candidate to resultHash", async () => {
    const input = await settled({ reviews: 2 }), result = buildCompetitorDeepResult(input), { resultHash, ...body } = result;
    expect(resultHash).toBe(sha256(canonical(body)));
    expect(buildCompetitorDeepResult(clone(input))).toEqual(result);
    expect(Object.isFrozen(result.deepAnalysis.buyers.groups[0].evidence)).toBe(true);
    expect(Buffer.byteLength(canonical(result), "utf8")).toBeLessThan(COMPETITOR_DEEP_RESULT_MAX_BYTES);
  });
  it("does not alias mutable input metadata or journal originals", async () => {
    const input = await settled({ reviews: 2 }), result = buildCompetitorDeepResult(input);
    const oldHash = result.resultHash; input.jobRunId = "changed";
    (input.journal as any).steps[0].raw.titleZh = "changed";
    expect(result.resultHash).toBe(oldHash); expect(result.deepAnalysis.source.jobRunId).toBe("synthetic-job");
    expect(result.deepAnalysis.title.titleZh).toBe("露营灯");
  });
  it("rejects non-settled and unknown-outcome journals without offering a publishable candidate", async () => {
    const source = evidence({ reviews: 1 }), kernel = createCompetitorDeepExecution(source, skills), journal = kernel.initial();
    const input = { evidence: source, skills, journal, jobRunId: "synthetic-job", generatedAt: "2026-10-17T08:00:00.000Z" };
    expect(() => buildCompetitorDeepResult(input)).toThrow("DEEP_RESULT_JOURNAL_NOT_SETTLED");
    let dispatched = journal;
    await kernel.runNext({ read: async () => journal, compareAndSwap: async (_hash, next) => { dispatched = next; return next; }, assertCurrent: async () => undefined },
      async () => { throw new Error("synthetic unknown outcome"); }, new AbortController().signal).catch(() => undefined);
    expect(dispatched.steps[0].status).toBe("dispatched");
    expect(() => buildCompetitorDeepResult({ ...input, journal: dispatched })).toThrow("DEEP_RESULT_JOURNAL_NOT_SETTLED");
  });
  it.each(["raw", "evidence", "skill", "hash", "derived"])("does not trust forged %s or serialized derived receipts", async mutation => {
    const input = await settled({ reviews: 1 });
    if (mutation === "raw") {
      const journal = input.journal as any; journal.steps[0].raw.titleZh = "changed";
      const { journalHash: _old, ...body } = journal; journal.journalHash = sha256(canonical(body));
    }
    if (mutation === "evidence") (input.evidence as any).identity.userId = 4;
    if (mutation === "skill") (input.skills as any).summary.version = "2";
    if (mutation === "hash") (input.journal as any).journalHash = "f".repeat(64);
    if (mutation === "derived") (input as any).results = { summary: { data: { positioning: "forged" } } };
    expect(() => buildCompetitorDeepResult(input)).toThrow();
  });
  it.each(["2026-02-31T08:00:00.000Z", "2026-10-17", "2026-10-17T08:00:00Z", "not a date"])("rejects noncanonical commit timestamp %s", async generatedAt => {
    const input = await settled({ reviews: 0 });
    expect(() => buildCompetitorDeepResult({ ...input, generatedAt })).toThrow("DEEP_RESULT_INPUT_INVALID");
  });
  it("rejects getters, malformed Unicode and extra fields without executing custom code", async () => {
    const input = await settled({ reviews: 0 }); let reads = 0;
    Object.defineProperty(input, "journal", { enumerable: true, get: () => { reads++; return {}; } });
    expect(() => buildCompetitorDeepResult(input)).toThrow("DEEP_RESULT_INVALID_JSON"); expect(reads).toBe(0);
    const valid = await settled({ reviews: 0 });
    expect(() => buildCompetitorDeepResult({ ...valid, jobRunId: "\ud800" })).toThrow("DEEP_RESULT_INVALID_JSON");
    expect(() => buildCompetitorDeepResult({ ...valid, jobRunId: " wrong " })).toThrow("DEEP_RESULT_INPUT_INVALID");
  });
  it("refuses oversized full result instead of dropping group membership or clipping original bodies", async () => {
    const input = await settled({ reviews: 180, bodyPadding: 1100, separateGroups: true });
    expect(() => buildCompetitorDeepResult(input)).toThrow("DEEP_RESULT_TOO_LARGE");
  }, 30_000);
});
