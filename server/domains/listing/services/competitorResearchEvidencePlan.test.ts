import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CompetitorReviewCorpus, CompetitorReviewItem } from "../../../../shared/competitorReviewCorpus";
import {
  assertCompetitorResearchEvidenceQuote as quote,
  buildCompetitorResearchEvidencePlan as build,
  canonicalCompetitorResearchEvidence as canonical,
  COMPETITOR_RESEARCH_BATCH_LIMITS as limits,
  competitorReviewEvidenceSourceId,
  encodeCompetitorResearchBatch,
  summarizeCompetitorResearchEvidencePlan as summarize,
  verifyCompetitorResearchEvidencePlan as verify,
  type CompetitorResearchEvidenceInput,
  type CompetitorResearchEvidencePlan,
} from "../../../../shared/competitorResearchEvidence";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ASIN = "B000000001", fileHash = sha256("synthetic original file — not an authenticated file");
const identity = { userId: 3, workspaceId: 7, sourceWorkspaceId: null, projectId: 11, analysisId: 13, asin: ASIN, revision: sha256("row") };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function corpus(bodies = ["Full  body\n原评论 😀"]): CompetitorReviewCorpus {
  const items: CompetitorReviewItem[] = bodies.map((body, i) => {
    const data = { asin: ASIN, sourceReviewId: `vendor-${i}`, title: `Original title ${i}`, body, rating: 0, date: null,
      author: null, verifiedPurchase: false, variant: null, helpfulVotes: 0 };
    return { ...data, reviewId: `review_${sha256(canonical({ ...data, unknown: {} }))}`,
      occurrences: [{ sheet: "Reviews", row: i + 2, assignment: "row_asin", fields: [
        { column: 1, header: "ASIN", value: ASIN }, { column: 2, header: "body", value: body },
      ], mapping: { asin: 1, body: 2 }, warnings: [] }] };
  });
  const payload = { parserVersion: "competitor-review-corpus/1" as const, projectId: 11, analysisId: 13, asin: ASIN, items,
    coverage: { scope: "complete_file_not_market_total" as const, format: "csv" as const, sourceFileHash: fileHash,
      sourceBytes: 100, sourceFileName: "original.csv", sheets: [{ name: "Reviews", headerRow: 1 as const, dataRows: bodies.length || 1 }],
      totalRows: bodies.length || 1, blankRows: 0, emptyBodyRows: bodies.length ? 0 : 1, unassignedRows: 0, otherAsinRows: 0,
      matchedRows: bodies.length, duplicateRows: 0, uniqueReviews: bodies.length, filenameFallbackRows: 0,
      excluded: bodies.length ? [] : [{ sheet: "Reviews", row: 2, reason: "empty_body" as const }],
      normalization: "LF_then_trim_no_internal_whitespace_collapse" as const } };
  return { ...payload, corpusHash: sha256(canonical(payload)) };
}
function input(bodies?: string[]): CompetitorResearchEvidenceInput {
  return { identity: { ...identity }, title: " Exact  Title 😀 ", bullets: ["Original bullet one", "原文第二点"],
    reviews: { status: "available", corpus: corpus(bodies), source: { runId: "review-import-1", fileName: "original.csv", fileHash }, authorizedCorpusHash: sha256("authorized reader hash") } };
}
function available(value: CompetitorResearchEvidenceInput) {
  if (value.reviews.status !== "available") throw new Error("fixture"); return value.reviews;
}
function reviews(value: CompetitorResearchEvidencePlan) {
  if (value.reviews.status !== "available") throw new Error("fixture"); return value.reviews;
}
function repin(value: CompetitorReviewCorpus) {
  const { corpusHash: _old, ...body } = value; value.corpusHash = sha256(canonical(body)); return value;
}
function repinPlan(value: CompetitorResearchEvidencePlan) {
  const { evidenceHash: _old, ...body } = value; value.evidenceHash = sha256(canonical(body)); return value;
}

describe("pure competitor research evidence — not model or authorization proof", () => {
  it("preserves exact listing text, complete original reviews and two distinct ID kinds", () => {
    const source = input(), plan = build(source, sha256), r = reviews(plan);
    expect(plan.listingSources.map(s => s.text)).toEqual([source.title, ...source.bullets]);
    expect(plan.listingSources[0]).toEqual({ sourceId: "analysis:13:title", kind: "title", ordinal: 0,
      text: source.title, span: { start: 0, end: source.title!.length, unit: "utf16_code_units" } });
    expect(r.batches.flatMap(b => b.items)).toEqual(available(source).corpus.items);
    expect(r.batches[0].items[0]).toMatchObject({ sourceReviewId: "vendor-0", verifiedPurchase: false, rating: 0, helpfulVotes: 0 });
    expect(r.batches[0].items[0].reviewId).not.toBe("vendor-0");
    expect(r.parserCorpusHash).toBe(available(source).corpus.corpusHash);
    expect(r.authorizedCorpusHash).not.toBe(r.parserCorpusHash);
    expect(r.source).toEqual(available(source).source);
    expect(plan.modelRead).toBe(false);
    expect(verify(JSON.parse(JSON.stringify(plan)), sha256)).toEqual(plan);
  });
  it("is stable across object key order and does not alias mutable caller data", () => {
    const source = input(), baseline = build(source, sha256);
    expect(canonical({ a: 1, b: [2] })).toBe(canonical({ b: [2], a: 1 }));
    expect(build({ reviews: source.reviews, bullets: source.bullets, title: source.title, identity: source.identity }, sha256)).toEqual(baseline);
    available(source).corpus.items[0].body = "caller mutated";
    source.identity.userId = 99; source.bullets[0] = "changed";
    expect(verify(baseline, sha256)).toEqual(baseline);
  });
  it("distinguishes authenticated empty sample from unavailable unknown", () => {
    const zero = build(input([]), sha256), absent = build({ identity, title: null, bullets: [], reviews: { status: "unavailable", reason: "No authorized original" } }, sha256);
    expect(summarize(zero, sha256).reviews).toMatchObject({ status: "available", total: 0, batchCount: 0, scope: "complete_file_not_market_total" });
    expect(summarize(absent, sha256).reviews).toMatchObject({ status: "unavailable", total: null, batchCount: 0, scope: null, sourceFileHash: null, parserCorpusHash: null, authorizedCorpusHash: null });
    expect(absent).not.toHaveProperty("complete");
    expect(absent.evidenceHash).not.toBe(zero.evidenceHash);
  });
  it("UI summary never contains full text, raw cells, original IDs, names or filename", () => {
    const plan = build(input(), sha256), safe = JSON.stringify(summarize(plan, sha256));
    for (const secret of ["Full  body", "Original title", "Exact  Title", "vendor-0", "original.csv", "review-import-1", '"fields"', '"items"', '"occurrences"']) expect(safe).not.toContain(secret);
    expect(summarize(plan, sha256).listing).toEqual({ titleAvailable: true, bulletCount: 2, sourceCount: 3 });
    expect(summarize(plan, sha256)).not.toHaveProperty("sentiment");
    expect(summarize(plan, sha256)).not.toHaveProperty("percentage");
  });
  it.each(["userId", "workspaceId", "sourceWorkspaceId", "revision"] as const)("binds actor/scope/revision: %s", key => {
    const source = input(), baseline = build(source, sha256);
    if (key === "revision") source.identity[key] = sha256("new row");
    else source.identity[key] = 21;
    expect(build(source, sha256).evidenceHash).not.toBe(baseline.evidenceHash);
  });
  it.each(["projectId", "analysisId", "asin"] as const)("rejects corpus scope mismatch: %s", key => {
    const source = input();
    if (key === "asin") source.identity[key] = "B000000002"; else source.identity[key] = 21;
    expect(() => build(source, sha256)).toThrow("EVIDENCE_CORPUS_SCOPE");
  });
  it("binds reader source identity separately from unchanged parser content", () => {
    const a = input(), b = input(); available(b).source.runId = "review-import-2";
    available(b).authorizedCorpusHash = sha256("new authorization binding");
    expect(build(a, sha256).evidenceHash).not.toBe(build(b, sha256).evidenceHash);
    expect(reviews(build(a, sha256)).parserCorpusHash).toBe(reviews(build(b, sha256)).parserCorpusHash);
  });
  it.each(["fileName", "fileHash"] as const)("refuses mismatched authorized source %s", key => {
    const value = input(); available(value).source[key] = key === "fileName" ? "different.csv" : sha256("different");
    expect(() => build(value, sha256)).toThrow("EVIDENCE_SOURCE_CHANGED");
  });
  it("requires trusted SHA output to be a lowercase full SHA-256", () => {
    for (const provider of [() => "", () => "F".repeat(64), () => "123", (() => Promise.resolve("a".repeat(64))) as unknown as typeof sha256])
      expect(() => build(input(), provider)).toThrow("EVIDENCE_HASH_PROVIDER_INVALID");
  });
});

describe("strict bounded complete review batches", () => {
  it("partitions each review exactly once, in source order, with full canonical byte/hash verification", () => {
    const source = input(Array.from({ length: 61 }, (_, i) => `Body ${i}`)), plan = build(source, sha256), r = reviews(plan);
    expect(r.batches.length).toBeGreaterThan(1);
    expect(r.batches.flatMap(b => b.items)).toEqual(available(source).corpus.items);
    expect(new Set(r.batches.flatMap(b => b.items.map(item => item.reviewId))).size).toBe(61);
    for (const [i, batch] of r.batches.entries()) {
      const encoded = encodeCompetitorResearchBatch(plan, i, sha256);
      expect(batch.items.length).toBeLessThanOrEqual(limits.reviews);
      expect(batch.utf8Bytes).toBe(Buffer.byteLength(encoded, "utf8"));
      expect(batch.utf8Bytes).toBeLessThanOrEqual(limits.utf8Bytes);
      expect(batch.sha256).toBe(sha256(encoded));
    }
  });
  it("counts multibyte UTF-8 and JSON escaping, never JS character count", () => {
    const plan = build(input(["中😀\n\"".repeat(800), "中😀\n\"".repeat(800) + " second"]), sha256), r = reviews(plan);
    expect(r.batches).toHaveLength(2);
    expect(r.batches[0].utf8Bytes).toBeGreaterThan(encodeCompetitorResearchBatch(plan, 0, sha256).length);
    expect(r.batches[0].items[0].body).toBe("中😀\n\"".repeat(800));
  });
  it("accepts the exact 24 KiB boundary and rejects one-byte-over without slicing", () => {
    // Only a single small item; size changes linearly in the body and its source
    // cell. An independent raw field can supply the final one-byte difference.
    const source = input(["x"]), initial = build(source, sha256), overhead = reviews(initial).batches[0].utf8Bytes;
    const item = available(source).corpus.items[0];
    const added = Math.floor((limits.utf8Bytes - overhead) / 2);
    item.body += "x".repeat(added); item.occurrences[0].fields[1].value = item.body;
    if ((limits.utf8Bytes - overhead) % 2) item.occurrences[0].fields[0].header += "x";
    repin(available(source).corpus);
    const plan = build(source, sha256);
    expect(reviews(plan).batches[0].utf8Bytes).toBe(limits.utf8Bytes);
    item.occurrences[0].fields[0].header += "x"; repin(available(source).corpus);
    expect(() => build(source, sha256)).toThrow("EVIDENCE_REVIEW_TOO_LARGE");
  });
  it("refuses a parser-valid 32000-character single original rather than silently truncating", () => {
    expect(() => build(input(["x".repeat(32000)]), sha256)).toThrow("EVIDENCE_REVIEW_TOO_LARGE");
  });
  it("counts occurrence source metadata in the budget too", () => {
    const source = input(["small"]), item = available(source).corpus.items[0];
    item.occurrences[0].fields[0].header = "h".repeat(25000); repin(available(source).corpus);
    expect(() => build(source, sha256)).toThrow("EVIDENCE_REVIEW_TOO_LARGE");
  });
  it("retains repeated physical rows once in canonical items and all occurrence locations", () => {
    const source = input(), c = available(source).corpus, duplicate = copy(c.items[0].occurrences[0]); duplicate.row = 3;
    c.items[0].occurrences.push(duplicate); c.coverage.matchedRows = 2; c.coverage.duplicateRows = 1; c.coverage.totalRows = 2; c.coverage.sheets[0].dataRows = 2; repin(c);
    const r = reviews(build(source, sha256));
    expect(r.total).toBe(1); expect(r.batches[0].items[0].occurrences.map(o => o.row)).toEqual([2, 3]);
  });
  it.each(["duplicateId", "missingOccurrence", "duplicateLocation", "badMapping", "fakeCount", "missingRow", "foreignItem"])("refuses inconsistent corpus even when caller recomputes its hash: %s", kind => {
    const source = input(["one", "two"]), c = available(source).corpus;
    if (kind === "duplicateId") c.items[1].reviewId = c.items[0].reviewId;
    if (kind === "missingOccurrence") c.items[0].occurrences = [];
    if (kind === "duplicateLocation") c.items[1].occurrences[0].row = 2;
    if (kind === "badMapping") c.items[0].occurrences[0].mapping.body = 9;
    if (kind === "fakeCount") c.coverage.uniqueReviews = 1;
    if (kind === "missingRow") { c.coverage.totalRows++; c.coverage.sheets[0].dataRows++; }
    if (kind === "foreignItem") c.items[0].asin = "B000000002";
    repin(c); expect(() => build(source, sha256)).toThrow();
  });
  it.each(["body", "hash"])("rejects unpinned corpus changes: %s", kind => {
    const source = input(), c = available(source).corpus;
    if (kind === "body") c.items[0].body += "changed"; else c.corpusHash = sha256("different");
    expect(() => build(source, sha256)).toThrow("EVIDENCE_CORPUS_HASH");
  });
  it.each(["omit", "repeat", "reverse", "bytes", "batchHash", "overallHash", "span", "sourceId", "limits", "modelRead", "extra"])("rejects plan tampering: %s", kind => {
    const plan = copy(build(input(["one", "two"]), sha256)), r = reviews(plan);
    if (kind === "omit") r.batches[0].items.pop();
    if (kind === "repeat") r.batches[0].items.push(copy(r.batches[0].items[0]));
    if (kind === "reverse") r.batches[0].items.reverse();
    if (kind === "bytes") r.batches[0].utf8Bytes++;
    if (kind === "batchHash") r.batches[0].sha256 = sha256("wrong");
    if (kind === "overallHash") plan.evidenceHash = sha256("wrong");
    if (kind === "span") plan.listingSources[0].span.end--;
    if (kind === "sourceId") plan.listingSources[0].sourceId = "foreign:title";
    if (kind === "limits") Object.assign(plan.batchLimits, { reviews: 61 });
    if (kind === "modelRead") Object.assign(plan, { modelRead: true });
    if (kind === "extra") Object.assign(plan, { modelResult: "not authorized" });
    if (kind !== "overallHash") repinPlan(plan);
    expect(() => verify(plan, sha256)).toThrow();
    expect(() => summarize(plan, sha256)).toThrow();
  });
  it("rejects a self-rehashed alternate batch split", () => {
    const plan = build(input(["one", "two"]), sha256), r = reviews(plan);
    const second = r.batches[0].items.pop()!;
    r.batches.push({ batchId: "analysis:13:reviews:2", items: [second], utf8Bytes: 1, sha256: sha256("wrong") });
    repinPlan(plan); expect(() => verify(plan, sha256)).toThrow("EVIDENCE_PLAN_CHANGED");
  });
});

describe("strict plain data and exact source spans", () => {
  it.each(["extra", "missingScope", "badId", "sparse", "getter", "customArray", "symbol", "date", "undefined", "cycle", "negativeZero"])("rejects unsafe input shape: %s", kind => {
    const source = input(); let calls = 0;
    if (kind === "extra") Object.assign(source, { aiAnalysis: {} });
    if (kind === "missingScope") Reflect.deleteProperty(source.identity, "sourceWorkspaceId");
    if (kind === "badId") source.identity.userId = 0;
    if (kind === "sparse") source.bullets = new Array(1);
    if (kind === "getter") Object.defineProperty(source, "title", { enumerable: true, get() { calls++; return "unsafe"; } });
    if (kind === "customArray") Object.defineProperty(source.bullets, "map", { enumerable: true, value: () => [] });
    if (kind === "symbol") Object.assign(source, { [Symbol("private")]: 1 });
    if (kind === "date") Object.assign(source, { title: new Date() });
    if (kind === "undefined") Object.assign(source, { title: undefined });
    if (kind === "cycle") Object.assign(source, { cycle: source });
    if (kind === "negativeZero") source.identity.userId = -0;
    expect(() => build(source, sha256)).toThrow(); expect(calls).toBe(0);
  });
  it("allows actual NULL actor/source workspace independently, but not implicit undefined", () => {
    const source = input(); source.identity.workspaceId = null;
    expect(build(source, sha256).identity).toMatchObject({ workspaceId: null, sourceWorkspaceId: null });
    Object.assign(source.identity, { workspaceId: undefined }); expect(() => build(source, sha256)).toThrow();
  });
  it("verifies precise title, bullet and review-title/body citations without fuzzy matching", () => {
    const plan = build(input(), sha256), item = reviews(plan).batches[0].items[0];
    quote(plan, { sourceId: "analysis:13:title", start: 1, end: 6, quote: "Exact" }, sha256);
    quote(plan, { sourceId: "analysis:13:bullet:2", start: 0, end: 2, quote: "原文" }, sha256);
    quote(plan, { sourceId: competitorReviewEvidenceSourceId(item.reviewId, "body"), start: 0, end: item.body.length, quote: item.body }, sha256);
    quote(plan, { sourceId: competitorReviewEvidenceSourceId(item.reviewId, "title"), start: 0, end: item.title!.length, quote: item.title! }, sha256);
    for (const value of ["exact", "Exact ", " Exact"]) expect(() => quote(plan, { sourceId: "analysis:13:title", start: 1, end: 6, quote: value }, sha256)).toThrow("EVIDENCE_QUOTE_MISMATCH");
    expect(() => quote(plan, { sourceId: "vendor-0:body", start: 0, end: item.body.length, quote: item.body }, sha256)).toThrow("EVIDENCE_QUOTE_MISMATCH");
  });
  it("rejects half a surrogate pair, cross-source spans and absent source IDs", () => {
    const plan = build(input(), sha256), title = plan.listingSources[0].text, start = title.indexOf("😀");
    quote(plan, { sourceId: "analysis:13:title", start, end: start + 2, quote: "😀" }, sha256);
    expect(() => quote(plan, { sourceId: "analysis:13:title", start, end: start + 1, quote: title[start] }, sha256)).toThrow();
    expect(() => quote(plan, { sourceId: "analysis:13:title", start: 0, end: title.length + 1, quote: title + "x" }, sha256)).toThrow();
    expect(() => quote(plan, { sourceId: "analysis:14:title", start: 1, end: 6, quote: "Exact" }, sha256)).toThrow();
    expect(() => competitorReviewEvidenceSourceId("vendor-0", "body")).toThrow();
  });
});
