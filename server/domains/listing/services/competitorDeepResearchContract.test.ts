import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createCompetitorDeepResearchValidator as create,
  COMPETITOR_DEEP_RESEARCH_OUTPUT_LIMIT,
  type CompetitorDeepBuyerBatchOutput,
  type CompetitorDeepBuyerBatchResult,
  type CompetitorDeepCitation,
  type CompetitorDeepPreviousResults,
} from "../../../../shared/competitorDeepResearch";
import {
  buildCompetitorResearchEvidencePlan as build,
  canonicalCompetitorResearchEvidence as canonical,
  competitorReviewEvidenceSourceId,
  type CompetitorResearchEvidencePlan,
} from "../../../../shared/competitorResearchEvidence";
import type { CompetitorReviewCorpus, CompetitorReviewItem } from "../../../../shared/competitorReviewCorpus";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const identity = { userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11,
  analysisId: 13, asin: "B000000001", revision: sha256("revision") };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fileHash = sha256("synthetic source file, no production data");
function corpus(bodies: string[]): CompetitorReviewCorpus {
  const items: CompetitorReviewItem[] = bodies.map((body, i) => ({ reviewId: `review_${sha256(`review ${i}`)}`,
    asin: identity.asin, sourceReviewId: `amazon-${i}`, title: null, body, rating: i % 2 ? 1 : 5,
    date: null, author: null, verifiedPurchase: null, variant: null, helpfulVotes: null,
    occurrences: [{ sheet: "Reviews", row: i + 2, assignment: "row_asin",
      fields: [{ column: 1, header: "body", value: body }], mapping: { body: 1 }, warnings: [] }] }));
  const data = { parserVersion: "competitor-review-corpus/1" as const, projectId: identity.projectId,
    analysisId: identity.analysisId, asin: identity.asin, items,
    coverage: { scope: "complete_file_not_market_total" as const, format: "csv" as const,
      sourceFileHash: fileHash, sourceBytes: 100, sourceFileName: "sample.csv",
      sheets: [{ name: "Reviews", headerRow: 1 as const, dataRows: bodies.length }],
      totalRows: bodies.length, blankRows: 0, emptyBodyRows: 0, unassignedRows: 0, otherAsinRows: 0,
      matchedRows: bodies.length, duplicateRows: 0, uniqueReviews: bodies.length,
      filenameFallbackRows: 0, excluded: [], normalization: "LF_then_trim_no_internal_whitespace_collapse" as const } };
  return { ...data, corpusHash: sha256(canonical(data)) };
}
function evidence(bodies: string[] | null = ["Excellent  light 😀", "Weak clip", "Neutral observation"]) {
  return build({ identity, title: "Bright  Lamp 😀 for Camping", bullets: ["Flexible neck", "Warm light"],
    reviews: bodies === null ? { status: "unavailable", reason: "original_import_missing" } : {
      status: "available", corpus: corpus(bodies), source: { runId: "import-1", fileName: "sample.csv", fileHash },
      authorizedCorpusHash: sha256("authorized corpus") } }, sha256);
}
const span = (sourceId: string, quote: string, start = 0): CompetitorDeepCitation => ({ sourceId, quote, start, end: start + quote.length });
function titleRaw(plan = evidence()) {
  const source = plan.listingSources[0];
  return { keywords: [{ text: "Lamp", zh: "灯", citation: span(source.sourceId, "Lamp", 8) }],
    modifiers: [{ text: "Bright", zh: "明亮", citation: span(source.sourceId, "Bright") }],
    scenarios: [{ text: "Camping", zh: "露营", citation: span(source.sourceId, "Camping", source.text.indexOf("Camping")) }],
    titleZh: "明亮的露营灯" };
}
function sellingRaw(plan = evidence()) {
  const citation = span(plan.listingSources[1].sourceId, "Flexible neck");
  return { points: [{ name: "Flexible neck", description: "Seller describes a flexible neck", strength: "高" as const,
    occurrences: [citation], goldenQuote: copy(citation) }],
    bulletTranslations: plan.listingSources.filter(source => source.kind === "bullet").map(source => ({ sourceId: source.sourceId, zh: `翻译 ${source.ordinal}` })) };
}
function batchRaw(plan: CompetitorResearchEvidencePlan, index = 0): CompetitorDeepBuyerBatchOutput {
  if (plan.reviews.status !== "available") throw new Error("fixture");
  const items = plan.reviews.batches[index].items;
  return { themes: items.map((review, i) => ({ name: `Theme ${i}`, sentiment: i % 2 ? "negative" : "positive",
    reviewIds: [review.reviewId], citations: [span(competitorReviewEvidenceSourceId(review.reviewId, "body"), review.body)] })), noThemeReviewIds: [] };
}
function synthesisRaw(batches: CompetitorDeepBuyerBatchResult[]) {
  return { groups: batches.flatMap(batch => batch.data.themes).map(theme => ({ name: theme.name,
    sentiment: theme.sentiment, themeIds: [theme.themeId] })), concerns: [] };
}
function summaryRaw(reference = "selling:point:1") {
  return { positioning: { text: "A lamp positioned around flexible adjustment", basis: "seller_claim" as const, references: [reference] },
    advantages: [], weaknesses: [], learnings: [], opportunities: [] };
}

describe("pending-review deep research contract: exact listing evidence", () => {
  it("returns deterministic stage/evidence-bound, frozen replayable receipts without Skill changes", () => {
    const plan = evidence(), validator = create(plan, sha256), title = validator.validateTitle(titleRaw(plan));
    expect(title).toMatchObject({ version: 1, stage: "title", evidenceHash: plan.evidenceHash });
    expect(title.data.keywords[0].entryId).toBe("title:keyword:1");
    const { outputHash, ...body } = title;
    expect(outputHash).toBe(sha256(canonical(body)));
    expect(create(plan, sha256).validateTitle(copy(titleRaw(plan)))).toEqual(title);
    expect(Object.isFrozen(title.data.keywords[0].citation)).toBe(true);
    expect(title).not.toHaveProperty("modelRead");
    expect(title).not.toHaveProperty("skillSlug");
    expect(title).not.toHaveProperty("complete");
  });
  it("verifies evidence once and does not rehash the entire corpus for each citation", () => {
    let hashes = 0;
    const plan = evidence(), validator = create(plan, text => { hashes++; return sha256(text); });
    hashes = 0;
    validator.validateTitle(titleRaw(plan)); validator.validateSelling(sellingRaw(plan));
    expect(hashes).toBe(2);
  });
  it("rejects tampered evidence before any output validation", () => {
    const plan = evidence(); plan.listingSources[0].text = "tampered";
    expect(() => create(plan, sha256)).toThrow("EVIDENCE_PLAN_CHANGED");
  });
  it("preserves input isolation", () => {
    const plan = evidence(), validator = create(plan, sha256), raw = titleRaw(plan);
    const receipt = validator.validateTitle(raw);
    raw.keywords[0].zh = "changed"; plan.listingSources[0].text = "changed";
    expect(receipt.data.keywords[0].zh).toBe("灯");
    expect(validator.validateTitle(titleRaw())).toEqual(receipt);
  });
  it.each(["case", "whitespace", "offset", "source", "term"])("rejects altered title attribution: %s", mutation => {
    const raw = titleRaw(), validator = create(evidence(), sha256);
    if (mutation === "case") raw.keywords[0].citation.quote = "lamp";
    if (mutation === "whitespace") raw.keywords[0].citation.quote = " Lamp";
    if (mutation === "offset") raw.keywords[0].citation.start++;
    if (mutation === "source") raw.keywords[0].citation.sourceId = "image:1";
    if (mutation === "term") raw.keywords[0].text = "Invented product";
    expect(() => validator.validateTitle(raw)).toThrow(/DEEP_(CITATION_MISMATCH|TITLE_CITATION_INVALID)/u);
  });
  it("does not allow bullets to masquerade as title keywords", () => {
    const raw = titleRaw(); raw.keywords[0] = { text: "Flexible neck", zh: "软管", citation: span("analysis:13:bullet:1", "Flexible neck") };
    expect(() => create(evidence(), sha256).validateTitle(raw)).toThrow("DEEP_TITLE_CITATION_INVALID");
  });
  it("rejects a UTF-16 offset splitting an emoji pair", () => {
    const plan = evidence(), raw = titleRaw(plan), source = plan.listingSources[0], start = source.text.indexOf("😀");
    raw.keywords[0] = { text: "\ud83d", zh: "错误", citation: { sourceId: source.sourceId, start, end: start + 1, quote: "\ud83d" } };
    expect(() => create(plan, sha256).validateTitle(raw)).toThrow("DEEP_CITATION_MISMATCH");
  });
  it("rejects absent sources explicitly", () => {
    const plan = build({ identity, title: null, bullets: [], reviews: { status: "unavailable", reason: "missing" } }, sha256);
    const validator = create(plan, sha256);
    expect(() => validator.validateTitle(titleRaw())).toThrow("DEEP_TITLE_SOURCE_UNAVAILABLE");
    expect(() => validator.validateSelling(sellingRaw())).toThrow("DEEP_SELLING_SOURCE_UNAVAILABLE");
  });
  it("counts exact selling positions separately from distinct sources and excludes images", () => {
    const plan = evidence(), result = create(plan, sha256).validateSelling(sellingRaw(plan));
    expect(result.data.points[0]).toMatchObject({ frequency: 1, sourceFrequency: 1, entryId: "selling:point:1" });
    expect(result.data.imageEvidence).toBe("not_included_no_ocr");
    expect(result.data.bulletTranslations.map(item => item.citation.quote)).toEqual(["Flexible neck", "Warm light"]);
  });
  it("rejects duplicated or overlapping occurrences, including identical text at one position", () => {
    const raw = sellingRaw(); raw.points[0].occurrences.push(copy(raw.points[0].occurrences[0]));
    expect(() => create(evidence(), sha256).validateSelling(raw)).toThrow("DEEP_OCCURRENCE_DUPLICATE");
    raw.points[0].occurrences[1] = span("analysis:13:bullet:1", "neck", 9);
    expect(() => create(evidence(), sha256).validateSelling(raw)).toThrow("DEEP_OCCURRENCE_DUPLICATE");
  });
  it("requires a golden quote to be linked to that point's verified occurrences", () => {
    const raw = sellingRaw(); raw.points[0].goldenQuote = span("analysis:13:bullet:2", "Warm light");
    expect(() => create(evidence(), sha256).validateSelling(raw)).toThrow("DEEP_GOLDEN_QUOTE_UNLINKED");
  });
  it.each(["missing", "duplicate", "order"])("requires exact ordered bullet translation coverage: %s", mutation => {
    const raw = sellingRaw();
    if (mutation === "missing") raw.bulletTranslations.pop();
    if (mutation === "duplicate") raw.bulletTranslations[1] = raw.bulletTranslations[0];
    if (mutation === "order") raw.bulletTranslations.reverse();
    expect(() => create(evidence(), sha256).validateSelling(raw)).toThrow("DEEP_BULLET_TRANSLATION_COVERAGE");
  });
});

describe("complete original-review accounting and separate synthesis", () => {
  it("retains canonical review IDs, exact citations and fixed batch identity", () => {
    const plan = evidence(), result = create(plan, sha256).validateBuyerBatch(0, batchRaw(plan));
    expect(result.stage).toBe("buyers:0");
    expect(result.data.accountedReviewCount).toBe(3);
    expect(result.data.themes[0].themeId).toBe("buyers:batch:0:theme:1");
    expect(result.data.themes[0].reviewIds[0]).toMatch(/^review_[a-f0-9]{64}$/u);
    expect(result.data.batchHash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("supports multiple themes per review while using a unique original-review denominator", () => {
    const plan = evidence(), validator = create(plan, sha256), raw = batchRaw(plan);
    raw.themes.push({ ...copy(raw.themes[0]), name: "Another theme" });
    const batch = validator.validateBuyerBatch(0, raw);
    const result = validator.validateBuyers({ groups: [{ name: "Combined positive", sentiment: "positive",
      themeIds: [batch.data.themes[0].themeId, batch.data.themes[2].themeId, batch.data.themes[3].themeId] },
    { name: "Negative", sentiment: "negative", themeIds: [batch.data.themes[1].themeId] }], concerns: [] }, [batch]);
    expect(result.data).toMatchObject({ sampleCount: 3, accountedReviewCount: 3, scope: "complete_file_not_market_total" });
    expect(result.data.groups.map(group => [group.count, group.percentage])).toEqual([[2, 66.7], [1, 33.3]]);
    expect(result.data.groups[0]).not.toHaveProperty("reviewIds");
    expect(result.data).not.toHaveProperty("marketTotal");
  });
  it("accounts for neutral/no-theme originals explicitly without inferring their sentiment", () => {
    const plan = evidence(), validator = create(plan, sha256), raw = batchRaw(plan), removed = raw.themes.pop()!;
    raw.noThemeReviewIds.push(removed.reviewIds[0]);
    const batch = validator.validateBuyerBatch(0, raw);
    expect(validator.validateBuyers(synthesisRaw([batch]), [batch]).data).toMatchObject({ sampleCount: 3, noThemeReviewCount: 1 });
  });
  it.each(["omitted", "overlap", "duplicate_no_theme", "platform_id", "wrong_batch", "missing_quote", "unrelated_quote", "duplicate_review"])("rejects invalid per-batch original accounting: %s", mutation => {
    const plan = evidence(), raw = batchRaw(plan), validator = create(plan, sha256);
    if (mutation === "omitted") raw.themes.pop();
    if (mutation === "overlap") raw.noThemeReviewIds.push(raw.themes[0].reviewIds[0]);
    if (mutation === "duplicate_no_theme") { const item = raw.themes.pop()!; raw.noThemeReviewIds.push(item.reviewIds[0], item.reviewIds[0]); }
    if (mutation === "platform_id") raw.themes[0].reviewIds = ["amazon-0"];
    if (mutation === "wrong_batch") raw.themes[0].reviewIds = [`review_${sha256("not here")}`];
    if (mutation === "missing_quote") { raw.themes[0].reviewIds.push(raw.themes[1].reviewIds[0]); }
    if (mutation === "unrelated_quote") raw.themes[0].citations = copy(raw.themes[1].citations);
    if (mutation === "duplicate_review") raw.themes[0].reviewIds.push(raw.themes[0].reviewIds[0]);
    expect(() => validator.validateBuyerBatch(0, raw)).toThrow(/DEEP_/u);
  });
  it("rejects nonexistent, negative and noninteger batch indices", () => {
    const plan = evidence(), validator = create(plan, sha256);
    for (const index of [-1, 0.5, 1, NaN]) expect(() => validator.validateBuyerBatch(index, batchRaw(plan))).toThrow("DEEP_BATCH_UNKNOWN");
  });
  it("requires every batch in source order and every theme once, with unchanged sentiment", () => {
    const plan = evidence(Array.from({ length: 61 }, (_, i) => `Review ${i}`)), validator = create(plan, sha256);
    const batches = plan.reviews.batches.map((_, i) => validator.validateBuyerBatch(i, batchRaw(plan, i)));
    expect(batches.length).toBeGreaterThan(1);
    expect(() => validator.validateBuyers(synthesisRaw(batches), batches.slice(1))).toThrow("DEEP_BATCH_COVERAGE_INCOMPLETE");
    expect(() => validator.validateBuyers(synthesisRaw(batches), [...batches].reverse())).toThrow("DEEP_PREVIOUS_NOT_VALIDATED");
    const omitted = synthesisRaw(batches); omitted.groups.pop();
    expect(() => validator.validateBuyers(omitted, batches)).toThrow("DEEP_THEME_GROUP_COVERAGE");
    const duplicate = synthesisRaw(batches); duplicate.groups.push(copy(duplicate.groups[0]));
    expect(() => validator.validateBuyers(duplicate, batches)).toThrow("DEEP_THEME_GROUP_DUPLICATE");
    const wrong = synthesisRaw(batches); wrong.groups[0].sentiment = "negative";
    expect(() => validator.validateBuyers(wrong, batches)).toThrow("DEEP_THEME_SENTIMENT_MISMATCH");
    expect(validator.validateBuyers(synthesisRaw(batches), batches).data.sampleCount).toBe(61);
  });
  it("cannot forge a previous receipt or reuse one from a different validator instance", () => {
    const plan = evidence(), first = create(plan, sha256), second = create(plan, sha256);
    const batch = first.validateBuyerBatch(0, batchRaw(plan)), raw = synthesisRaw([batch]);
    expect(() => first.validateBuyers(raw, [copy(batch)])).toThrow("DEEP_PREVIOUS_NOT_VALIDATED");
    expect(() => second.validateBuyers(raw, [batch])).toThrow("DEEP_PREVIOUS_NOT_VALIDATED");
    const restored = second.validateBuyerBatch(0, batchRaw(plan));
    expect(second.validateBuyers(raw, [restored])).toEqual(first.validateBuyers(raw, [batch]));
  });
  it("labels inferred concerns as derived themes, not imported questions or Q&A", () => {
    const plan = evidence(), validator = create(plan, sha256), batch = validator.validateBuyerBatch(0, batchRaw(plan));
    const raw = { ...synthesisRaw([batch]), concerns: [{ question: "Is the clip reliable?", status: "评价不一" as const,
      explanation: "A concern synthesized from the sample", themeIds: [batch.data.themes[1].themeId] }] };
    const result = validator.validateBuyers(raw, [batch]);
    expect(result.data.concerns[0].origin).toBe("derived_from_review_themes");
    expect(result.data.questions).toBe("unavailable_no_question_evidence");
    raw.concerns[0].themeIds = ["Q1"];
    expect(() => validator.validateBuyers(raw, [batch])).toThrow("DEEP_THEME_UNKNOWN");
  });
  it("distinguishes complete empty imported sample from unavailable originals", () => {
    const zero = create(evidence([]), sha256).validateBuyers({ groups: [], concerns: [] }, []);
    expect(zero.data).toMatchObject({ sampleCount: 0, accountedReviewCount: 0, noThemeReviewCount: 0, groups: [], scope: "complete_file_not_market_total" });
    const absent = create(evidence(null), sha256);
    expect(() => absent.validateBuyers({ groups: [], concerns: [] }, [])).toThrow("DEEP_REVIEW_SOURCE_UNAVAILABLE");
    expect(() => absent.validateBuyerBatch(0, {})).toThrow("DEEP_REVIEW_SOURCE_UNAVAILABLE");
  });
});

describe("summary requires accepted prior-stage evidence, not invented source claims", () => {
  function setup() {
    const plan = evidence(), validator = create(plan, sha256), batch = validator.validateBuyerBatch(0, batchRaw(plan));
    const previous: CompetitorDeepPreviousResults = { title: validator.validateTitle(titleRaw(plan)),
      selling: validator.validateSelling(sellingRaw(plan)), buyers: validator.validateBuyers(synthesisRaw([batch]), [batch]) };
    return { plan, validator, previous };
  }
  it("only references stable validated entries and records unsupported images/questions", () => {
    const { validator, previous } = setup(), result = validator.validateSummary(summaryRaw(), previous);
    expect(result.data).toMatchObject({ incompleteSources: ["images", "questions"], scope: "listing_text_and_imported_review_sample" });
    expect(result).not.toHaveProperty("complete");
    expect(result.data.positioning.references).toEqual(["selling:point:1"]);
  });
  it("does not hide missing stages behind a four-stage completion claim", () => {
    const { validator, previous } = setup();
    const result = validator.validateSummary(summaryRaw(), { ...previous, title: null, buyers: null });
    expect(result.data.incompleteSources).toEqual(["title", "reviews", "images", "questions"]);
    expect(() => validator.validateSummary(summaryRaw(), { title: null, selling: null, buyers: null })).toThrow("DEEP_SUMMARY_SOURCE_UNAVAILABLE");
  });
  it.each(["unknown", "empty", "duplicate", "basis", "raw_source"])("rejects unsupported summary attribution: %s", mutation => {
    const { validator, previous } = setup(), raw = summaryRaw();
    if (mutation === "unknown") raw.positioning.references = ["selling:point:99"];
    if (mutation === "empty") raw.positioning.references = [];
    if (mutation === "duplicate") raw.positioning.references.push(raw.positioning.references[0]);
    if (mutation === "basis") raw.positioning.references = ["buyers:group:1"];
    if (mutation === "raw_source") raw.positioning.references = ["analysis:13:title"];
    expect(() => validator.validateSummary(raw, previous)).toThrow(/DEEP_/u);
  });
  it("supports explicitly marked inference from both seller claims and review feedback", () => {
    const { validator, previous } = setup(), raw = { ...summaryRaw(), positioning: {
      text: "A hypothesis requiring validation", basis: "inference", references: ["title:keyword:1", "buyers:group:1"] } };
    expect(validator.validateSummary(raw, previous).data.positioning.basis).toBe("inference");
  });
  it("rejects copied or mutated prior-stage receipts even with an apparently valid hash", () => {
    const { validator, previous } = setup();
    expect(() => validator.validateSummary(summaryRaw(), { ...previous, selling: copy(previous.selling) })).toThrow("DEEP_PREVIOUS_NOT_VALIDATED");
  });
});

describe("strict bounded JSON and no silent coercion or truncation", () => {
  it("bounds actual UTF-8 bytes, not JavaScript character length", () => {
    const raw = titleRaw(); raw.titleZh = "中".repeat(Math.ceil(COMPETITOR_DEEP_RESEARCH_OUTPUT_LIMIT / 3));
    expect(JSON.stringify(raw).length).toBeLessThan(COMPETITOR_DEEP_RESEARCH_OUTPUT_LIMIT);
    expect(() => create(evidence(), sha256).validateTitle(raw)).toThrow("DEEP_OUTPUT_TOO_LARGE");
  });
  it("rejects unknown fields rather than silently stripping unsupported model claims", () => {
    expect(() => create(evidence(), sha256).validateTitle({ ...titleRaw(), complete: true })).toThrow("DEEP_OUTPUT_SCHEMA_INVALID");
    expect(() => create(evidence(), sha256).validateBuyerBatch(0, { ...batchRaw(evidence()), percentage: 100 })).toThrow("DEEP_OUTPUT_SCHEMA_INVALID");
  });
  it("rejects getters and toJSON without executing them", () => {
    let reads = 0;
    const raw = { ...titleRaw(), get leaked() { reads++; return "secret"; } };
    expect(() => create(evidence(), sha256).validateTitle(raw)).toThrow("DEEP_OUTPUT_JSON_INVALID");
    expect(reads).toBe(0);
    expect(() => create(evidence(), sha256).validateTitle({ toJSON() { reads++; return titleRaw(); } })).toThrow("DEEP_OUTPUT_JSON_INVALID");
    expect(reads).toBe(0);
  });
  it("rejects invalid digest-provider output at receipt time", () => {
    let initialized = false;
    const validator = create(evidence(), text => initialized ? "broken" : sha256(text));
    initialized = true;
    expect(() => validator.validateTitle(titleRaw())).toThrow("DEEP_HASH_PROVIDER_INVALID");
  });
});
