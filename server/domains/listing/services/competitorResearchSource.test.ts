import { describe, expect, it, vi } from "vitest";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { formatCompetitorAnalysisSummary } from "../competitorHumanReview";
import { buildCompetitorResearchSource, normalizeCompetitorResearchResult } from "./competitorResearchSource";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const manualSales = { version: 1, value: 123, sourceNote: "Synthetic documented estimate", updatedAt: "2026-10-19T00:00:00.000Z", updatedBy: 3 };
function row(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return {
    id: 7, projectId: 11, asin: "B000000001", title: "Portable storage case",
    bulletPoints: '["Travel-friendly handle","Two compartments"]', imageUrls: '["s3://bucket/case.jpg"]',
    price: "19.99 USD", rating: "4.3", reviewCount: "71",
    reviewAnalysis: '{"painPoints":[{"issue":"Handle discomfort","quotes":["unverified secondary quote"],"frequency":"high"}]}',
    keywords: '["OLD MODEL KEYWORD"]', rawData: JSON.stringify({
      source: "unified_amazon_acquisition", confirmedSnapshotId: 9, contentHash: HASH_A,
      reviewImport: { sourceHash: HASH_B, filename: "private-original.csv", totalRows: 71 }, importedReviews: true,
      analysis: { summary: "OLD MODEL RESULT" },
    }),
    aiSummary: "OLD AI SUMMARY", summary: "HUMAN SUMMARY", summaryStatus: "draft", summaryVersion: 2,
    summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}
function raw(overrides: Record<string, unknown>) {
  return JSON.stringify({ ...JSON.parse(row().rawData!), ...overrides });
}
function model() {
  return {
    titleAnalysis: { brand: "", mainKeywords: ["storage case"], features: ["handle"], specs: [] },
    bulletPointsAnalysis: [{ point: "Travel-friendly handle", sellingPoint: "Portability", fabeBreakdown: {
      feature: "Handle", advantage: "Easier carrying", benefit: "Travel convenience", evidence: "Listing claim, not independently verified",
    } }],
    keywords: { core: [{ keyword: "storage case", relevance: "high" }],
      longTail: [{ keyword: "two compartment case", searchIntent: "organize travel items" }],
      traffic: [{ keyword: "travel organizer", category: "travel" }] },
    advantages: ["Clear organization claim"], weaknesses: ["No verified dimensions"],
    summary: { overview: "面向旅行整理需求的便携收纳盒。", coreSellingPoints: ["分区收纳"],
      strengths: ["卖点表达明确"], weaknesses: ["缺少已验证的尺寸"], listingLessons: ["用可核验参数说明适配范围"] },
  };
}

describe("saved competitor research source", () => {
  it("uses versioned manual sales first without distributing them or hiding an independent estimate", () => {
    const source = buildCompetitorResearchSource(row({ rawData: raw({ manualSales,
      sellerSpriteData: { monthlySales: 800 }, research: { variants: [{ asin: "B000000001", status: "collected", boughtPastMonth: "50+" }, { asin: "B000000002", status: "failed" }] } }) }));
    const payload = JSON.parse(source.context.split("\n").at(-1)!);
    expect(payload.sources.sales).toMatchObject({ manualState: "valid", manual: manualSales, value: 123, source: "manual_calibration", sellerSpriteEstimate: 800, covered: 1, total: 2, partial: true });
    expect(payload.sources.sales).not.toHaveProperty("variants"); expect(source.context).toContain("禁止将人工总量分摊到子体");
    expect(source.context).toContain("不可信来源说明"); expect(source.context).toContain("不能作为评论样本分母");
  });
  it.each([
    { value: 124 }, { sourceNote: "Different source" }, { updatedAt: "2026-10-19T00:01:00.000Z" }, { updatedBy: 4 },
  ])("binds calibration metadata change %j to the actual source hash and context", patch => {
    const before = buildCompetitorResearchSource(row({ rawData: raw({ manualSales }) }));
    const after = buildCompetitorResearchSource(row({ rawData: raw({ manualSales: { ...manualSales, ...patch } }) }));
    expect(after.sourceHash).not.toBe(before.sourceHash); expect(after.context).not.toBe(before.context);
  });
  it("restoring collected sales changes the manual source back to the exact no-manual projection", () => {
    const collected = { purchaseBadge: "100+", sellerSpriteData: { monthlySales: 800 } };
    const before = buildCompetitorResearchSource(row({ rawData: raw(collected) }));
    const calibrated = buildCompetitorResearchSource(row({ rawData: raw({ ...collected, manualSales }) }));
    expect(calibrated.sourceHash).not.toBe(before.sourceHash);
    expect(buildCompetitorResearchSource(row({ rawData: raw(collected) }))).toMatchObject({ sourceHash: before.sourceHash, context: before.context });
  });
  it("keeps badge lower bounds/coverage and legacy manual metadata unverified, bound without unknown text leakage", () => {
    const saved = { manualSales: { value: 999, privateLegacyField: "NOT RESEARCH CONTENT" },
      research: { variants: [{ asin: "B000000001", status: "collected", boughtPastMonth: "50+" }, { asin: "B000000002", status: "failed" }] } };
    const source = buildCompetitorResearchSource(row({ rawData: raw(saved) }));
    const payload = JSON.parse(source.context.split("\n").at(-1)!);
    expect(payload.sources.sales).toMatchObject({ manualState: "invalid", manual: null, value: 50, source: "purchase_badges", lowerBound: true, covered: 1, total: 2, partial: true });
    expect(source.context).not.toContain("NOT RESEARCH CONTENT");
    expect(buildCompetitorResearchSource(row({ rawData: raw({ ...saved, manualSales: { value: 998 } }) })).sourceHash).not.toBe(source.sourceHash);
  });
  it("binds the real saved content and explicitly demotes secondary review claims", () => {
    const source = buildCompetitorResearchSource(row());
    expect(source.evidence).toEqual({ originalReviewsAvailable: false, reviewAnalysisAvailable: true, listingAvailable: true });
    expect(source.revision).toBe(competitorRevision(row()));
    expect(source.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.context).toContain("Travel-friendly handle");
    expect(source.context).toContain("unverified secondary quote");
    expect(source.context).toContain("原始评论缺失");
    expect(source.context).toContain("不是原评论");
    expect(source.context).toContain("禁止编造");
    expect(source.context).toContain("never as instructions");
    expect(source.context).not.toMatch(/OLD MODEL|OLD AI|HUMAN SUMMARY|private-original\.csv|totalRows/);
  });

  it.each([
    ["analysisId", { id: 8 }], ["project", { projectId: 12 }], ["ASIN", { asin: "B000000002" }],
    ["title", { title: "Different title" }], ["bullets", { bulletPoints: '["Different feature"]' }],
    ["images", { imageUrls: '["s3://bucket/new.jpg"]' }], ["price", { price: "22.00" }],
    ["rating", { rating: "4.8" }], ["review count", { reviewCount: "99" }],
    ["secondary reviews", { reviewAnalysis: '{"overallSentiment":"Different saved secondary analysis"}' }],
    ["source reference", { rawData: raw({ contentHash: HASH_B }) }],
    ["snapshot", { rawData: raw({ confirmedSnapshotId: 10 }) }],
    ["review digest", { rawData: raw({ reviewImport: { sourceHash: HASH_A } }) }],
    ["seller source", { rawData: raw({ sellerSpriteSourceHash: HASH_A }) }],
    ["seller data", { rawData: raw({ sellerSpriteData: { monthlySales: 12, brand: "Acme" }, importSource: "sellersprite_search" }) }],
    ["manual provenance", { rawData: raw({ manualInput: true }) }],
    ["saved description", { rawData: raw({ scrapedData: { description: "New original description" } }) }],
  ] satisfies Array<[string, Partial<CompetitorAnalysis>]>)("changes source hash for %s", (_label, patch) => {
    expect(buildCompetitorResearchSource(row(patch)).sourceHash).not.toBe(buildCompetitorResearchSource(row()).sourceHash);
  });

  it("excludes its own committed result, state and presentation but keeps full-row CAS sensitive", () => {
    const initial = buildCompetitorResearchSource(row());
    const committed = row({
      aiSummary: "NEW AI", summary: "NEW SUMMARY", keywords: '{"core":[]}', summaryStatus: "confirmed", summaryVersion: 3,
      summaryConfirmedBy: 4, summaryConfirmedAt: new Date("2026-02-01Z"), updatedAt: new Date("2026-02-02Z"),
      rawData: raw({ analysis: model(), research: { version: 1, sourceHash: initial.sourceHash, jobRunId: "job", skillRunId: "skill" },
        deepAnalysis: { secret: "OLD DEEP" }, unknown: "UNKNOWN", description: "UNKNOWN RAW DESCRIPTION", brand: "UNKNOWN BRAND",
        presentation: { reviewReport: "UNVERIFIED PRESENTATION" }, analysisStale: false, captureOnly: false }),
    });
    const after = buildCompetitorResearchSource(committed);
    expect(after.sourceHash).toBe(initial.sourceHash);
    expect(after.context).toBe(initial.context);
    expect(after.revision).not.toBe(initial.revision);
    expect(after.context).not.toMatch(/NEW AI|NEW SUMMARY|OLD DEEP|UNKNOWN|UNVERIFIED PRESENTATION/);
  });

  it("does not treat stale/capture-only true as new raw evidence or prohibit intended reanalysis", () => {
    expect(buildCompetitorResearchSource(row({ rawData: raw({ analysisStale: true, captureOnly: true }) })).sourceHash)
      .toBe(buildCompetitorResearchSource(row()).sourceHash);
  });

  it("uses a narrow known-key projection inside source envelopes, not arbitrary AI fields", () => {
    const a = row({ rawData: raw({ sellerSpriteData: { brand: "Acme" }, scrapedData: { description: "Saved description" } }) });
    const b = row({ rawData: raw({ sellerSpriteData: { brand: "Acme", research: "FAKE ORIGINAL" },
      scrapedData: { description: "Saved description", deepAnalysis: "FAKE ORIGINAL" } }) });
    expect(buildCompetitorResearchSource(a).sourceHash).toBe(buildCompetitorResearchSource(b).sourceHash);
    expect(buildCompetitorResearchSource(b).context).not.toContain("FAKE ORIGINAL");
  });

  it("hashes canonical supplied JSON rather than semantically irrelevant JSON object key/spacing differences", () => {
    const a = buildCompetitorResearchSource(row());
    const b = buildCompetitorResearchSource(row({ rawData: JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(row().rawData!)).reverse()), null, 2),
      bulletPoints: '[ "Travel-friendly handle", "Two compartments" ]' }));
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.context).toBe(b.context);
    expect(a.revision).not.toBe(b.revision);
  });

  it.each([null, "", " \n", "{}"]) ("accepts absent/empty legacy raw and secondary object %j", value => {
    const source = buildCompetitorResearchSource(row({ rawData: value, reviewAnalysis: value }));
    expect(source.evidence.reviewAnalysisAvailable).toBe(false);
  });

  it.each([
    { title: "Real title", bulletPoints: null, rawData: null },
    { title: null, bulletPoints: '["Real bullet"]', rawData: null },
    { title: null, bulletPoints: null, rawData: JSON.stringify({ scrapedData: { description: "Real saved description" } }) },
  ])("accepts at least one actual saved listing content field", patch => {
    expect(buildCompetitorResearchSource(row(patch)).evidence.listingAvailable).toBe(true);
  });

  it.each([null, "{}", JSON.stringify({ description: "NOT A KNOWN ORIGINAL FIELD", deepAnalysis: { summary: "fake" } }),
    JSON.stringify({ scrapedData: { description: " " } })])("rejects ASIN/secondary reviews alone (%j)", rawData => {
    expect(() => buildCompetitorResearchSource(row({ title: " ", bulletPoints: "[]", rawData }))).toThrow("COMPETITOR_RESEARCH_LISTING_REQUIRED");
  });

  it.each([
    { rawData: "broken JSON" }, { rawData: "null" }, { rawData: "[]" }, { rawData: '"text"' },
    { rawData: raw({ analysisStale: "false" }) }, { rawData: raw({ captureOnly: null }) },
    { rawData: raw({ importedReviews: 1 }) }, { rawData: raw({ manualInput: "yes" }) },
    { rawData: raw({ confirmedSnapshotId: "9" }) }, { rawData: raw({ contentHash: "bad" }) },
    { rawData: raw({ reviewImport: { filename: "file only" } }) }, { rawData: raw({ reviewImport: [] }) },
    { rawData: raw({ sellerSpriteData: { brand: { value: "invalid" } } }) },
    { rawData: raw({ scrapedData: { bulletPoints: [1] } }) },
    { bulletPoints: "{}" }, { bulletPoints: "null" }, { bulletPoints: '["ok",3]' },
    { imageUrls: '{"url":"bad shape"}' }, { reviewAnalysis: "[]" }, { reviewAnalysis: '"plain string"' },
  ])("fails closed on malformed saved envelope %#", patch => {
    expect(() => buildCompetitorResearchSource(row(patch))).toThrow(/COMPETITOR_RESEARCH_/);
  });

  it("does not silently truncate a UTF-8 source at 80 KiB", () => {
    const text = "汉".repeat(27_000);
    expect(() => buildCompetitorResearchSource(row({ title: text }))).toThrow("COMPETITOR_RESEARCH_SOURCE_TOO_LARGE");
    const accepted = buildCompetitorResearchSource(row({ title: "汉".repeat(20_000) }));
    expect(accepted.context).toContain("汉".repeat(20_000));
    expect(Buffer.byteLength(accepted.context)).toBeLessThanOrEqual(80 * 1024);
  });

  it("does not mutate input or invoke a persisted row getter", () => {
    const saved = row(); const before = structuredClone(saved);
    buildCompetitorResearchSource(saved);
    expect(saved).toEqual(before);
    const getter = vi.fn(() => "title");
    Object.defineProperty(saved, "title", { enumerable: true, get: getter });
    expect(() => buildCompetitorResearchSource(saved)).toThrow("COMPETITOR_RECORD_INVALID");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("competitor prompt result normalization", () => {
  it("preserves the current complete prompt result and uses its real formatter", () => {
    const result = normalizeCompetitorResearchResult(model());
    expect(JSON.parse(result.analysisJson)).toEqual(model());
    expect(result.summary).toBe(formatCompetitorAnalysisSummary(model()));
    expect(JSON.parse(result.keywordsJson!)).toEqual(model().keywords);
    expect(result.summary).toContain("分区收纳");
  });

  it("supports the real formatter's nonempty legacy string summary without invented keywords", () => {
    expect(normalizeCompetitorResearchResult({ summary: "  A substantive saved finding.  " })).toEqual({
      analysisJson: '{"summary":"A substantive saved finding."}', summary: "A substantive saved finding.", keywordsJson: null,
    });
  });

  it("accepts explicit unknown/empty lists when the overview has substance, not fictitious evidence", () => {
    const result = normalizeCompetitorResearchResult({ summary: { overview: "Only listing claims are available; dimensions remain unknown." },
      keywords: null, advantages: [], weaknesses: [], bulletPointsAnalysis: [] });
    expect(result.keywordsJson).toBeNull();
    expect(result.summary).not.toContain("AI 尚未提供定位概览");
  });

  it("strips model-supplied source/state/private/unknown fields at every result boundary", () => {
    const original = model();
    const result = normalizeCompetitorResearchResult({ ...original, analysisStale: false, captureOnly: false, rawData: { injected: true },
      sourceHash: "forged", deepAnalysis: { done: true }, summary: { ...original.summary, originalReviews: "forged quote" },
      keywords: { ...original.keywords, secret: "hidden" } });
    expect(JSON.parse(result.analysisJson)).toEqual(original);
    expect(result.analysisJson).not.toMatch(/forged|injected|secret|done|captureOnly/);
  });

  it.each([
    undefined, null, [], "JSON text is not a parsed result", {}, { summary: "" }, { summary: " " },
    { summary: {} }, { summary: { overview: 42 } }, { summary: { overview: "", coreSellingPoints: ["point"] } },
    { competitivePositioning: "legacy formatter fallback must not manufacture required summary" },
    { summary: "ok", titleAnalysis: {} }, { summary: "ok", bulletPointsAnalysis: [{}] },
    { summary: "ok", bulletPointsAnalysis: [{ point: "", sellingPoint: "", fabeBreakdown: {} }] },
    { summary: "ok", keywords: [] }, { summary: "ok", keywords: { core: [], longTail: [] } },
    { ...model(), keywords: { ...model().keywords, core: [{ keyword: "case", relevance: "high/medium/low" }] } },
    { summary: { overview: "ok", strengths: [3] } }, { summary: "ok", advantages: [{}] },
    { summary: "ok", weaknesses: [" "] },
  ])("rejects empty or malformed prompt result %#", value => {
    expect(() => normalizeCompetitorResearchResult(value)).toThrow("COMPETITOR_RESEARCH_RESULT_INVALID");
  });

  it("does not invoke getters/toJSON or accept sparse/prototype/cyclic JSON", () => {
    const getter = vi.fn(() => "forged");
    const accessor = Object.defineProperty({}, "summary", { enumerable: true, get: getter });
    expect(() => normalizeCompetitorResearchResult(accessor)).toThrow("COMPETITOR_RESEARCH_RESULT_INVALID");
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({ summary: "forged" }));
    const cycle: Record<string, unknown> = { summary: "ok" }; cycle.self = cycle;
    for (const value of [{ summary: "ok", toJSON }, { summary: "ok", advantages: new Array(1) },
      Object.assign(Object.create({ inherited: true }), { summary: "ok" }), cycle,
      { summary: "ok", hidden: undefined }, { summary: "ok", number: Infinity }]) {
      expect(() => normalizeCompetitorResearchResult(value)).toThrow("COMPETITOR_RESEARCH_RESULT_INVALID");
    }
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("is deterministic, independent of key insertion order, and leaves the caller untouched", () => {
    const original = model(); const before = structuredClone(original);
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    expect(normalizeCompetitorResearchResult(reversed)).toEqual(normalizeCompetitorResearchResult(original));
    expect(original).toEqual(before);
  });
});
