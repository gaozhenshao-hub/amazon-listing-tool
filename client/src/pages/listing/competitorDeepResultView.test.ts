import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalCompetitorResearchEvidence as canonical, buildCompetitorResearchEvidencePlan } from "../../../../shared/competitorResearchEvidence";
import { buildCompetitorReviewCorpus } from "../../../../server/domains/listing/services/competitorReviewCorpus";
import { buildCompetitorDeepResult } from "../../../../server/domains/listing/services/competitorDeepResult";
import { createCompetitorDeepExecution, type DeepSkillPlan } from "../../../../server/domains/listing/services/competitorDeepExecution";
import { COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES, parseCompetitorDeepResultView, type CompetitorDeepResultViewScope } from "./competitorDeepResultView";

// Server modules are fixture generators in this test ONLY. The browser module
// imports no server implementation, Node crypto or model/transport adapter.
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const scope: CompetitorDeepResultViewScope = { userId: 3, workspaceId: 7, projectId: 11, analysisId: 21, asin: "B000000001", revision: "c".repeat(64) };
const binding = { skillSlug: "synthetic-only", version: "1", status: "Released" as const, systemPromptHash: "a".repeat(16),
  userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "synthetic-not-approved",
  title: binding, selling: binding, buyers_batch: binding, buyers_synthesis: binding, summary: binding };
type Options = { reviews?: number | null; listing?: boolean | "titleOnly" | "bulletOnly"; overlap?: boolean; noTheme?: boolean;
  allNeutral?: boolean; csv?: string };
const fullBody = (i: number) => `Original review ${i}: 原文 punctuation & exact casing.\n${"Complete paragraph. ".repeat(30)}`;
const quote = (sourceId: string, text: string) => ({ sourceId, start: 0, end: text.length, quote: text });
async function fixture(options: Options = {}) {
  const total = options.reviews === undefined ? 6 : options.reviews;
  const rows = Array.from({ length: total ?? 0 }, (_, i) => `${scope.asin},platform-${i},"${fullBody(i)}",${i % 2 ? 1 : 5}`);
  const bytes = Buffer.from(options.csv ?? `ASIN,Review ID,Content,Rating\n${rows.length ? rows.join("\n") : "B000000002,other,Other,3"}`), fileName = `${scope.asin}.csv`;
  const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin: scope.asin, projectId: scope.projectId, analysisId: scope.analysisId, sourceFileHash: digest(bytes) });
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { ...scope, sourceWorkspaceId: 7, revision: "d".repeat(64) },
    title: options.listing === false || options.listing === "bulletOnly" ? null : "Light for camps",
    bullets: options.listing === false || options.listing === "titleOnly" ? [] : ["Long runtime"],
    reviews: total === null ? { status: "unavailable", reason: "Original unavailable" } : { status: "available", corpus,
      source: { runId: "synthetic-import", fileName, fileHash: digest(bytes) }, authorizedCorpusHash: "e".repeat(64) } }, digest);
  const kernel = createCompetitorDeepExecution(evidence, skills); let journal = kernel.initial();
  for (let i = 0; i < journal.steps.length; i++) await kernel.runNext({ read: async () => journal,
    compareAndSwap: async (_old, value) => journal = value, assertCurrent: async () => undefined }, async call => {
    const input = call.input as { items: Array<{ reviewId: string; body: string }>; batches: Array<{ data: { themes: Array<{ themeId: string }> } }>;
      selling: unknown; listing: Array<{ sourceId: string; kind: string; text: string }> };
    let raw: unknown;
    if (call.stage === "title") raw = { keywords: [{ text: "Light", zh: "灯", citation: quote("analysis:21:title", "Light") }], modifiers: [], scenarios: [], titleZh: "露营灯" };
    else if (call.stage === "selling") {
      const source = input.listing.find(item => item.kind === "bullet") ?? input.listing[0];
      raw = { points: [{ name: "Runtime", description: "Seller runtime claim", strength: "高",
        occurrences: [quote(source.sourceId, source.text)], goldenQuote: quote(source.sourceId, source.text) }],
        bulletTranslations: input.listing.filter(item => item.kind === "bullet").map(item => ({ sourceId: item.sourceId, zh: "续航长" })) };
    }
    else if (call.stage.startsWith("buyers:")) {
      const themed = options.allNeutral ? [] : options.noTheme === false ? input.items : input.items.slice(0, -1);
      const neutral = options.allNeutral ? input.items : options.noTheme === false ? [] : input.items.slice(-1);
      const themes = themed.map((item, index) => ({ name: `Theme ${index}`, sentiment: "positive", reviewIds: [item.reviewId], citations: [quote(`${item.reviewId}:body`, item.body)] }));
      if (options.overlap && themed.length) themes.push({ ...themes[0], name: "Another theme" });
      raw = { themes, noThemeReviewIds: neutral.map(item => item.reviewId) };
    } else if (call.stage === "buyers_synthesis") {
      const ids = input.batches.flatMap(batch => batch.data.themes.map(theme => theme.themeId));
      raw = { groups: ids.length ? options.overlap ? [{ name: "First", sentiment: "positive", themeIds: ids.slice(0, -1) },
        { name: "Overlap", sentiment: "positive", themeIds: ids.slice(-1) }] : [{ name: "Combined", sentiment: "positive", themeIds: ids }] : [],
      concerns: ids.length ? [{ question: "Does runtime meet needs?", status: "证据不足", explanation: "Derived from review themes", themeIds: [ids[0]] }] : [] };
    } else raw = { positioning: { text: "Runtime positioning", basis: input.selling ? "seller_claim" : "review_feedback",
      references: [input.selling ? "selling:point:1" : "buyers:group:1"] }, advantages: [{ text: "Interpretation", basis: "inference",
      references: [input.selling ? "selling:point:1" : "buyers:group:1"] }], weaknesses: [], learnings: [], opportunities: [] };
    return { raw, receipt: { runId: `synthetic-${call.stage}`, skillSlug: binding.skillSlug, skillVersion: binding.version,
      skillPromptHash: binding.systemPromptHash, skillManifestHash: binding.manifestHash, modelSlug: "synthetic-model" } };
  }, new AbortController().signal);
  const result = buildCompetitorDeepResult({ evidence, skills, journal, jobRunId: "synthetic-job", generatedAt: "2026-10-17T08:00:00.000Z" });
  const { revision: _revision, ...identity } = scope;
  return { status: "available" as const, identity: { ...identity, sourceWorkspaceId: 7 as number | null },
    currentRevision: scope.revision, sourceChanged: false, reviewRequired: true as const, result: structuredClone(result) };
}
type Envelope = Awaited<ReturnType<typeof fixture>>;
function available(value: unknown, current = scope) {
  const parsed = parseCompetitorDeepResultView(value, current);
  if (parsed.status !== "available") throw new Error("Expected available fixture"); return parsed;
}

describe("browser-only source-aware deep result projection", () => {
  it("accepts a real offline server artifact and preserves four columns with citations, translations and claim basis", async () => {
    const raw = await fixture(), view = available(raw), result = view.result;
    expect(view).toMatchObject({ identity: raw.identity, currentRevision: scope.revision, reviewRequired: true, sourceChanged: false });
    expect(result).toMatchObject({ status: "ready_for_review", deepResearchComplete: false, source: raw.result.deepAnalysis.source });
    expect(result.title.keywords[0]).toMatchObject({ entryId: "title:keyword:1", text: "Light", zh: "灯", citation: quote("analysis:21:title", "Light") });
    expect(result.selling.points[0]).toMatchObject({ goldenQuote: "Long runtime", goldenCitation: quote("analysis:21:bullet:1", "Long runtime"), frequency: 1 });
    expect(result.selling.bulletTranslations[0]).toMatchObject({ sourceId: "analysis:21:bullet:1", zh: "续航长", citation: quote("analysis:21:bullet:1", "Long runtime") });
    expect(result.summary.positioning).toEqual({ text: "Runtime positioning", basis: "seller_claim", references: ["selling:point:1"] });
    expect(result.summary.advantages[0].basis).toBe("inference");
    expect(result).not.toHaveProperty("trace"); expect(result).not.toHaveProperty("modelReceipt");
  });
  it("retains complete sample originals, canonical IDs, platform IDs, row locations and sample omissions", async () => {
    const result = available(await fixture()).result, group = result.buyers.groups[0];
    expect(group).toMatchObject({ count: 5, denominator: 6, percentage: 83.3,
      evidenceSelection: { strategy: "first_three_in_original_order", limit: 3, shownCount: 3, matchingReviewCount: 5, omittedCount: 2 } });
    expect(group.reviewIds).toHaveLength(5); expect(group.evidence.map(item => item.body)).toEqual([fullBody(0).trim(), fullBody(1).trim(), fullBody(2).trim()]);
    expect(group.evidence[0]).toMatchObject({ sourceReviewId: "platform-0", locations: [{ sheet: "CSV", row: 2 }] });
    expect(group.evidence[0].reviewId).toMatch(/^review_[a-f0-9]{64}$/u);
    expect(result.buyers.noThemeReviewIds).toHaveLength(1);
    expect(result.reviewSource?.source.fileName).toBe("B000000001.csv");
    expect(result.buyers.concerns[0].origin).toBe("derived_from_review_themes");
  });
  it.each([0, null])("keeps zero and unavailable review samples distinct: %s", async reviews => {
    const result = available(await fixture({ reviews })).result;
    expect(result.buyers.sampleCount).toBe(reviews); expect(result.coverage.reviews.total).toBe(reviews);
    expect(result.buyers).toMatchObject({ status: "missing", missingReason: reviews === 0 ? "no_matching_reviews" : "reviews_unavailable", groups: [] });
    expect(result.coverage.reviews.status).toBe(reviews === 0 ? "available" : "unavailable");
    expect(result.coverage.reviews.sourceUnavailableReason).toBe(reviews === null ? "Original unavailable" : null);
    expect(result.summary.incompleteSources).toContain("reviews");
  });
  it("preserves review-only missing title/listing without inventing translations or source text", async () => {
    const result = available(await fixture({ listing: false, reviews: 2, noTheme: false })).result;
    expect(result.title).toMatchObject({ status: "missing", missingReason: "title_unavailable", titleZh: null, keywords: [] });
    expect(result.selling).toMatchObject({ status: "missing", missingReason: "listing_unavailable", points: [], bulletTranslations: [] });
    expect(result.listingSources).toEqual([]); expect(result.summary.positioning.basis).toBe("review_feedback");
  });
  it("allows a review to count in multiple distinct themes but retains a unique denominator", async () => {
    const result = available(await fixture({ overlap: true, noTheme: false })).result;
    expect(result.buyers.groups.map(group => group.count)).toEqual([6, 1]);
    expect(result.buyers.groups.map(group => group.denominator)).toEqual([6, 6]);
    expect(result.coverage.reviews.accountedReviewCount).toBe(6);
  });
  it.each(["titleOnly", "bulletOnly"] as const)("accepts real %s server results without requiring absent sources", async listing => {
    const result = available(await fixture({ listing, reviews: null })).result;
    expect(result.selling.status).toBe("succeeded");
    expect(result.title.status).toBe(listing === "titleOnly" ? "succeeded" : "missing");
    expect(result.selling.bulletTranslations).toHaveLength(listing === "titleOnly" ? 0 : 1);
    expect(result.listingSources.map(item => item.kind)).toEqual([listing === "titleOnly" ? "title" : "bullet"]);
  });
  it("accounts for a complete positive-size sample with no themes without marking reviews unavailable", async () => {
    const result = available(await fixture({ allNeutral: true })).result;
    expect(result.buyers).toMatchObject({ status: "succeeded", missingReason: null, sampleCount: 6, accountedReviewCount: 6, groups: [], concerns: [] });
    expect(result.buyers.noThemeReviewIds).toHaveLength(6); expect(result.coverage.reviews.noThemeReviewCount).toBe(6);
    expect(result.summary.incompleteSources).not.toContain("reviews");
  });
  it.each(["0", ""])("retains missing title/platform ID and rating %s from a real normalized review corpus", async rating => {
    const result = available(await fixture({ reviews: 1, noTheme: false,
      csv: `ASIN,Review ID,Content,Title,Rating\n${scope.asin},,Original full body,,${rating}` })).result;
    expect(result.buyers.groups[0].evidence[0]).toMatchObject({ body: "Original full body", title: null, sourceReviewId: null, rating: rating ? 0 : null });
  });
  it("does not invent review evidence from a title-only empty-body row", async () => {
    const result = available(await fixture({ reviews: 1,
      csv: `ASIN,Review ID,Content,Title,Rating\n${scope.asin},platform-0,,Only title,5` })).result;
    expect(result.coverage.reviews).toMatchObject({ status: "available", total: 0, accountedReviewCount: 0 });
    expect(result.buyers).toMatchObject({ status: "missing", missingReason: "no_matching_reviews", groups: [] });
  });
  it.each([null, 7])("permits explicitly pinned legacy NULL source workspace within workspace %s", async workspaceId => {
    const raw = await fixture(); raw.identity.workspaceId = workspaceId; raw.identity.sourceWorkspaceId = null;
    raw.result.deepAnalysis.source.identity.workspaceId = workspaceId; raw.result.deepAnalysis.source.identity.sourceWorkspaceId = null;
    expect(available(raw, { ...scope, workspaceId }).identity.sourceWorkspaceId).toBeNull();
  });
  it("preserves server staleness without comparing pre-publication source revision to current row revision", async () => {
    const raw = await fixture(); expect(raw.result.deepAnalysis.source.identity.revision).not.toBe(scope.revision);
    expect(available(raw).sourceChanged).toBe(false); raw.sourceChanged = true; expect(available(raw).sourceChanged).toBe(true);
  });
  it("supports an explicit not-available response without treating legacy truthy analysis as success", async () => {
    const raw = await fixture(), { result: _result, ...outer } = raw;
    const absent = { ...outer, status: "not_available" };
    expect(parseCompetitorDeepResultView(absent, scope)).toEqual(absent);
    expect(() => parseCompetitorDeepResultView({ ...absent, result: raw.result }, scope)).toThrow("DEEP_VIEW_SCHEMA_INVALID");
    expect(() => parseCompetitorDeepResultView({ rawData: { deepAnalysis: raw.result.deepAnalysis } }, scope)).toThrow("DEEP_VIEW_SCHEMA_INVALID");
  });
  it("clones and freezes the display without mutating or aliasing the response", async () => {
    const raw = await fixture(), view = available(raw), before = view.result.buyers.groups[0].evidence[0].body;
    raw.result.deepAnalysis.buyers.groups[0].evidence[0].body = "changed";
    expect(view.result.buyers.groups[0].evidence[0].body).toBe(before);
    expect(Object.isFrozen(view.result.summary.positioning.references)).toBe(true);
  });
});

describe("strict response identity, shape and display semantics", () => {
  it.each(["userId", "workspaceId", "projectId", "analysisId", "asin", "revision"])("rejects response for another current %s", async key => {
    const raw = await fixture(); const changed = { ...scope, [key]: key === "asin" ? "B000000002" : key === "revision" ? "f".repeat(64) : 99 };
    expect(() => parseCompetitorDeepResultView(raw, changed)).toThrow("DEEP_VIEW_SCOPE_MISMATCH");
  });
  it.each(["userId", "workspaceId", "sourceWorkspaceId", "projectId", "analysisId", "asin"])("rejects mismatched inner %s", async key => {
    const raw = await fixture(); Object.assign(raw.result.deepAnalysis.source.identity, { [key]: key === "asin" ? "B000000002" : 99 });
    expect(() => available(raw)).toThrow("DEEP_VIEW_SCOPE_MISMATCH");
  });
  it("rejects a foreign non-NULL source workspace even when both envelopes agree", async () => {
    const raw = await fixture(); raw.identity.sourceWorkspaceId = 8; raw.result.deepAnalysis.source.identity.sourceWorkspaceId = 8;
    expect(() => available(raw)).toThrow("DEEP_VIEW_SCOPE_MISMATCH");
  });
  const corruptions: Array<[string, (raw: Envelope) => void]> = [
    ["false complete", raw => Object.assign(raw.result.deepAnalysis, { deepResearchComplete: true })],
    ["confirmed", raw => Object.assign(raw, { reviewRequired: false })],
    ["hidden envelope field", raw => Object.assign(raw, { modelApproved: true })],
    ["hidden result field", raw => Object.assign(raw.result, { currentSkillApproved: true })],
    ["images read claim", raw => Object.assign(raw.result.deepAnalysis.coverage.images, { status: "available", analyzedCount: 1 })],
    ["real questions claim", raw => Object.assign(raw.result.deepAnalysis.buyers.concerns[0], { origin: "actual_questions" })],
    ["changed title translation", raw => { raw.result.deepAnalysis.title.titleZh = "different"; }],
    ["changed original quote", raw => { raw.result.deepAnalysis.title.keywords[0].citation.quote = "forged"; }],
    ["unknown listing reference", raw => { raw.result.deepAnalysis.trace.validated.selling!.data.points[0].occurrences[0].sourceId = "image:1"; }],
    ["inflated frequency", raw => { raw.result.deepAnalysis.selling.points[0].frequency = 99; }],
    ["changed translation", raw => { raw.result.deepAnalysis.selling.bulletTranslations[0] = "different"; }],
    ["changed summary string", raw => { raw.result.deepAnalysis.summary.positioning = "forged"; }],
    ["unknown summary reference", raw => { raw.result.deepAnalysis.trace.validated.summary!.data.positioning.references = ["unknown"]; }],
    ["wrong summary basis", raw => { raw.result.deepAnalysis.trace.validated.summary!.data.positioning.basis = "review_feedback"; }],
    ["missing required scope warning", raw => { raw.result.deepAnalysis.trace.validated.summary!.data.incompleteSources = []; }],
    ["wrong denominator", raw => { raw.result.deepAnalysis.buyers.groups[0].denominator = 7; }],
    ["wrong count", raw => { raw.result.deepAnalysis.buyers.groups[0].count = 6; }],
    ["wrong percentage", raw => { raw.result.deepAnalysis.buyers.groups[0].percentage = 100; }],
    ["wrong omitted count", raw => { raw.result.deepAnalysis.buyers.groups[0].evidenceSelection.omittedCount = 0; }],
    ["wrong shown count", raw => { raw.result.deepAnalysis.buyers.groups[0].evidenceSelection.shownCount = 1; }],
    ["wrong matched count", raw => { raw.result.deepAnalysis.buyers.groups[0].evidenceSelection.matchingReviewCount = 1; }],
    ["truncated member IDs", raw => { raw.result.deepAnalysis.buyers.groups[0].reviewIds.pop(); }],
    ["duplicate member IDs", raw => { const group = raw.result.deepAnalysis.buyers.groups[0]; group.reviewIds[1] = group.reviewIds[0]; }],
    ["platform ID masquerades as canonical", raw => { raw.result.deepAnalysis.buyers.groups[0].reviewIds[0] = "platform-0"; }],
    ["example order mismatch", raw => { raw.result.deepAnalysis.buyers.groups[0].evidence.reverse(); }],
    ["example id mismatch", raw => { raw.result.deepAnalysis.buyers.groups[0].evidence[0].id = `review_${"0".repeat(64)}`; }],
    ["duplicate row location", raw => { const example = raw.result.deepAnalysis.buyers.groups[0].evidence[0]; example.locations.push(example.locations[0]); }],
    ["no-theme double counting", raw => { raw.result.deepAnalysis.buyers.noThemeReviewIds[0] = raw.result.deepAnalysis.buyers.groups[0].reviewIds[0]; }],
    ["coverage total mismatch", raw => { raw.result.deepAnalysis.coverage.reviews.total = 7; }],
    ["sample count mismatch", raw => { raw.result.deepAnalysis.buyers.sampleCount = 7; }],
    ["missing batch", raw => { raw.result.deepAnalysis.trace.batches.pop(); }],
    ["batch model mismatch", raw => { raw.result.deepAnalysis.trace.batches[0].modelRunId = "another"; }],
    ["stage model reused", raw => { raw.result.deepAnalysis.trace.stages[1].modelReceipt!.runId = raw.result.deepAnalysis.trace.stages[0].modelReceipt!.runId; }],
    ["receipt evidence mismatch", raw => { raw.result.deepAnalysis.trace.validated.title!.evidenceHash = "0".repeat(64); }],
  ];
  it.each(corruptions)("rejects %s", async (_name, corrupt) => {
    const raw = await fixture(); corrupt(raw); expect(() => available(raw)).toThrow(/^DEEP_VIEW_/u);
  });
  it.each([0, null])("rejects %s reviews disguised as a completed sample", async reviews => {
    const raw = await fixture({ reviews }); raw.result.deepAnalysis.buyers.status = "succeeded"; raw.result.deepAnalysis.buyers.missingReason = null;
    expect(() => available(raw)).toThrow("DEEP_VIEW_INCONSISTENT");
  });
  it("rejects duplicate/overlapping occurrences even if both visible and receipt copies agree", async () => {
    const raw = await fixture(), point = raw.result.deepAnalysis.trace.validated.selling!.data.points[0];
    point.occurrences.push(point.occurrences[0]); point.frequency++;
    raw.result.deepAnalysis.selling.points[0] = { ...point, goldenQuote: point.goldenQuote?.quote ?? "" };
    expect(() => available(raw)).toThrow("DEEP_VIEW_INCONSISTENT");
  });
  it("rejects mismatched copies of the same review in overlapping groups", async () => {
    const raw = await fixture({ overlap: true, noTheme: false }); raw.result.deepAnalysis.buyers.groups[1].evidence[0].body = "changed";
    expect(() => available(raw)).toThrow("DEEP_VIEW_INCONSISTENT");
  });
  it("does not evaluate getters, custom toJSON, or malformed Unicode", async () => {
    const raw = await fixture(), getter = vi.fn(); Object.defineProperty(raw, "result", { enumerable: true, get: getter });
    expect(() => available(raw)).toThrow("DEEP_VIEW_JSON_INVALID"); expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(); expect(() => available({ toJSON })).toThrow("DEEP_VIEW_JSON_INVALID"); expect(toJSON).not.toHaveBeenCalled();
    const unicode = await fixture(); unicode.result.summaryText = "\ud800"; expect(() => available(unicode)).toThrow("DEEP_VIEW_JSON_INVALID");
  });
  it("enforces exact 512 KiB artifact bytes independently of envelope headroom, with no silent slicing", async () => {
    const raw = await fixture(), existing = canonical(raw.result), excess = COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES - new TextEncoder().encode(existing).byteLength + 1;
    raw.result.deepAnalysis.buyers.groups[0].evidence[0].body += "x".repeat(excess);
    expect(new TextEncoder().encode(canonical(raw.result)).byteLength).toBe(COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES + 1);
    const before = raw.result.deepAnalysis.buyers.groups[0].evidence[0].body;
    expect(() => available(raw)).toThrow("DEEP_VIEW_TOO_LARGE");
    expect(raw.result.deepAnalysis.buyers.groups[0].evidence[0].body).toBe(before);
  });
  it("rejects an oversized envelope before inspecting or projecting results", async () => {
    const raw = await fixture(); raw.result.summaryText = "中".repeat(COMPETITOR_DEEP_VIEW_RESULT_MAX_BYTES);
    expect(() => available(raw)).toThrow("DEEP_VIEW_TOO_LARGE");
  });
});
