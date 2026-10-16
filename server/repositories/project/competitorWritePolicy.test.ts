import { describe, expect, it, vi } from "vitest";
import type { CompetitorAnalysis, InsertCompetitorAnalysis } from "../../../drizzle/schema/project";
import { competitorRevision, mergeCompetitorUpdate } from "./competitorWritePolicy";

function record(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return {
    id: 3, projectId: 11, asin: "B000000001", title: "Original title", bulletPoints: '["Original bullet"]',
    imageUrls: '["s3://bucket/original.jpg"]', price: "12.50", rating: "4.4", reviewCount: "10",
    reviewAnalysis: '{"painPoints":["old review finding"]}', keywords: '["original keyword"]',
    rawData: JSON.stringify({
      analysis: { preserved: "successful original analysis" }, unknownSource: { custom: [1, true] },
      contentHash: "old-content", source: "unified_amazon_acquisition", confirmedSnapshotId: "snapshot-1",
      reviewImport: { sourceHash: "old-reviews", filename: "old.csv" }, importedReviews: true,
    }),
    aiSummary: "Original AI result", summary: "Human edited draft", summaryStatus: "draft", summaryVersion: 4,
    summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function merged(existing: CompetitorAnalysis, incoming: Partial<InsertCompetitorAnalysis>, kind: "upsert" | "reviews" = "upsert") {
  const update = mergeCompetitorUpdate(existing, incoming, { kind });
  return { update, row: { ...existing, ...update }, raw: JSON.parse(update.rawData ?? existing.rawData ?? "{}") };
}

describe("competitorRevision full persisted row", () => {
  const variants: Partial<CompetitorAnalysis> = {
    id: 4, projectId: 12, asin: "B000000002", title: "Changed", bulletPoints: "[]", imageUrls: "[]",
    price: "13", rating: "4.8", reviewCount: "11", reviewAnalysis: "{}", keywords: "[]", rawData: "{}",
    aiSummary: "Changed AI", summary: "Changed draft", summaryStatus: "confirmed", summaryVersion: 5,
    summaryConfirmedBy: 9, summaryConfirmedAt: new Date("2026-01-03T00:00:00Z"),
    createdAt: new Date("2026-01-04T00:00:00Z"), updatedAt: new Date("2026-01-05T00:00:00Z"),
  };
  it.each(Object.entries(variants))("binds persisted field %s", (field, value) => {
    expect(competitorRevision(record({ [field]: value }))).not.toBe(competitorRevision(record()));
  });

  it("is key-order independent and normalizes actual Date instants to ISO", () => {
    const original = record();
    const reverse = Object.fromEntries(Object.entries(original).reverse()) as CompetitorAnalysis;
    reverse.createdAt = new Date("2026-01-01T08:00:00+08:00");
    expect(competitorRevision(reverse)).toBe(competitorRevision(original));
    expect(competitorRevision(original)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps JSON TEXT byte-exact for CAS rather than equating reformatting", () => {
    expect(competitorRevision(record({ keywords: '[ "original keyword" ]' }))).not.toBe(competitorRevision(record()));
  });

  it.each([
    ["missing", () => { const row = record(); Reflect.deleteProperty(row, "rawData"); return row; }],
    ["extra", () => ({ ...record(), nonPersisted: true })],
    ["invalid Date", () => record({ updatedAt: new Date(NaN) })],
    ["date string", () => ({ ...record(), createdAt: "2026-01-01" })],
    ["invalid version", () => record({ summaryVersion: 0 })],
    ["undefined column", () => ({ ...record(), title: undefined })],
  ] as const)("rejects %s without silently weakening the fingerprint", (_label, make) => {
    expect(() => competitorRevision(make() as CompetitorAnalysis)).toThrow("COMPETITOR_RECORD_INVALID");
  });

  it("never invokes a row getter or a custom Date formatter", () => {
    const getter = vi.fn(() => "hidden");
    const row = record();
    Object.defineProperty(row, "rawData", { enumerable: true, get: getter });
    expect(() => competitorRevision(row)).toThrow("COMPETITOR_RECORD_INVALID");
    expect(getter).not.toHaveBeenCalled();
    const other = record();
    other.updatedAt.toISOString = vi.fn(() => "forged");
    expect(competitorRevision(other)).toBe(competitorRevision(record()));
    expect(other.updatedAt.toISOString).not.toHaveBeenCalled();
  });
});

describe("locked competitor update merge", () => {
  it("preserves confirmed state, original AI and human summary even against a full draft candidate", () => {
    const existing = record({ summaryStatus: "confirmed", summaryConfirmedBy: 7, summaryConfirmedAt: new Date("2026-01-03T00:00:00Z") });
    const result = merged(existing, {
      projectId: 11, asin: existing.asin, title: "New source title", aiSummary: "new", summary: "new", keywords: '["new AI keywords"]',
      summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
    });
    for (const key of ["summary", "aiSummary", "keywords", "summaryStatus", "summaryVersion", "summaryConfirmedBy", "summaryConfirmedAt"] as const) {
      expect(result.row[key]).toEqual(existing[key]);
      expect(result.update).not.toHaveProperty(key);
    }
    expect(result.raw.analysisStale).toBe(true);
  });

  it("does not fill even an empty confirmed summary outside the review protocol", () => {
    expect(mergeCompetitorUpdate(record({ summaryStatus: "confirmed", summary: null, aiSummary: null }),
      { summary: "incoming", aiSummary: "incoming" }, { kind: "upsert" })).toEqual({});
  });

  it("preserves a human-edited draft while accepting a new AI candidate when source changes", () => {
    const existing = record();
    const result = merged(existing, {
      title: "Changed title", summary: "new candidate", aiSummary: "new AI", keywords: '["new"]',
      rawData: JSON.stringify({ analysis: { replaced: true }, unknownSource: "stale overwrite", contentHash: "new-content" }),
    });
    expect(result.row.summary).toBe(existing.summary);
    expect(result.row.aiSummary).toBe("new AI");
    expect(result.row.keywords).toBe('["new"]');
    expect(result.raw.analysis).toEqual({ replaced: true });
    expect(result.raw.unknownSource).toEqual({ custom: [1, true] });
    expect(result.raw.contentHash).toBe("new-content");
    expect(result.raw.analysisStale).toBe(true);
  });

  it("keeps the existing unedited draft reanalysis flow and does not invent staleness", () => {
    const result = merged(record({ summary: "Original AI result" }), {
      title: "Updated source", summary: "new candidate", aiSummary: "new candidate", keywords: "[]",
      rawData: '{"analysis":{"new":true},"titleAnalysis":{"brand":"new"}}',
    });
    expect(result.row.summary).toBe("new candidate");
    expect(result.row.aiSummary).toBe("new candidate");
    expect(result.raw.analysis).toEqual({ new: true });
    expect(result.raw).not.toHaveProperty("analysisStale");
  });

  it("preserves an existing deepAnalysis and marks source changes stale even for an unedited draft", () => {
    const result = merged(record({ summary: "Original AI result", rawData: '{"deepAnalysis":{"old":true}}' }), {
      title: "Updated source", rawData: '{"deepAnalysis":{"new":true},"analysisStale":false}',
    });
    expect(result.raw.deepAnalysis).toEqual({ old: true });
    expect(result.raw.analysisStale).toBe(true);
  });

  it("allows filling missing draft results but never invents full-analysis status", () => {
    const result = merged(record({ summary: null, aiSummary: null, keywords: null, rawData: null }), {
      summary: "new draft", aiSummary: "new candidate", keywords: "[]", rawData: '{"newOutput":{"a":1}}',
    });
    expect(result.update).toMatchObject({ summary: "new draft", aiSummary: "new candidate", keywords: "[]" });
    expect(result.raw).toEqual({ newOutput: { a: 1 } });
    expect(result.update).not.toHaveProperty("summaryStatus");
  });

  it("does not treat AI output, summary review state or timestamps as original-source changes", () => {
    const result = merged(record(), {
      summary: "other", aiSummary: "other", keywords: "[]", reviewAnalysis: "{}",
      summaryStatus: "confirmed", summaryVersion: 100, updatedAt: new Date(),
      rawData: '{"analysis":{"other":true},"displayStatus":"updated","analysisStale":false}',
    });
    expect(result.raw).not.toHaveProperty("analysisStale");
    expect(result.row.reviewAnalysis).toBe(record().reviewAnalysis);
  });

  it("preserves existing source columns and reviews when a SellerSprite candidate sends nulls", () => {
    const existing = record();
    const result = merged(existing, {
      imageUrls: null, title: null, bulletPoints: null, reviewAnalysis: null,
      rawData: '{"sellerSpriteSourceHash":"next","sellerSpriteData":{"monthlySales":12}}',
    });
    expect(result.row.imageUrls).toBe(existing.imageUrls);
    expect(result.row.title).toBe(existing.title);
    expect(result.row.bulletPoints).toBe(existing.bulletPoints);
    expect(result.row.reviewAnalysis).toBe(existing.reviewAnalysis);
    expect(result.raw.reviewImport).toEqual(JSON.parse(existing.rawData!).reviewImport);
    expect(result.raw.analysisStale).toBe(true);
  });

  it("rejects a conflicting review-create upsert instead of silently letting the importer report a new saved source", () => {
    expect(() => merged(record(), { reviewAnalysis: '{"old":true}', rawData: JSON.stringify({
      reviewImport: { sourceHash: "stale-upload" }, importedReviews: false, analysisStale: false,
    }) })).toThrow("COMPETITOR_REVIEW_SOURCE_CHANGED");
  });

  it("reuses the locked review pair for the same source hash, without replacing its result or metadata", () => {
    const result = merged(record(), { reviewAnalysis: '{"old":true}', rawData: JSON.stringify({
      reviewImport: { sourceHash: "old-reviews", filename: "candidate filename.csv" }, importedReviews: false, analysisStale: false,
    }) });
    expect(result.raw.reviewImport.sourceHash).toBe("old-reviews");
    expect(result.raw.importedReviews).toBe(true);
    expect(result.raw).not.toHaveProperty("analysisStale");
    expect(result.update).toEqual({});
  });

  it("does not attach a new upload hash to an old manual review analysis", () => {
    const existing = record({ rawData: '{"manualInput":true}' });
    expect(() => merged(existing, { reviewAnalysis: "new", rawData: '{"reviewImport":{"sourceHash":"new"},"importedReviews":true}' }))
      .toThrow("COMPETITOR_REVIEW_SOURCE_CHANGED");
  });

  it("does not attach new AI to an old review digest when its result is currently null", () => {
    expect(() => merged(record({ reviewAnalysis: null }), {
      reviewAnalysis: "new AI", rawData: '{"reviewImport":{"sourceHash":"new-reviews"},"importedReviews":true}',
    })).toThrow("COMPETITOR_REVIEW_SOURCE_CHANGED");
  });

  it("an ordinary upsert without incoming review provenance preserves the existing pair", () => {
    const existing = record();
    const result = merged(existing, { title: "new title", reviewAnalysis: "new AI", rawData: '{"sellerSpriteSourceHash":"new-file"}' });
    expect(result.row.reviewAnalysis).toBe(existing.reviewAnalysis);
    expect(result.raw.reviewImport).toEqual(JSON.parse(existing.rawData!).reviewImport);
  });

  it("allows first review population on an existing row with no previous review pair", () => {
    const result = merged(record({ reviewAnalysis: null, rawData: "{}" }), {
      reviewAnalysis: '{"new":true}', rawData: '{"reviewImport":{"sourceHash":"new"},"importedReviews":true}',
    });
    expect(result.row.reviewAnalysis).toBe('{"new":true}');
    expect(result.raw.reviewImport).toEqual({ sourceHash: "new" });
    expect(result.raw.analysisStale).toBe(true);
  });

  it("explicit reviews updates only its review envelope and keeps latest source/AI fields", () => {
    const existing = record();
    const result = merged(existing, {
      reviewCount: "12", reviewAnalysis: '{"new":true}',
      rawData: JSON.stringify({ reviewImport: { sourceHash: "new-reviews", filename: "new.csv" }, importedReviews: true,
        contentHash: "stale-source", analysis: { old: true }, removedOldKey: "do not restore" }),
    }, "reviews");
    expect(result.row.reviewCount).toBe("12");
    expect(result.row.reviewAnalysis).toBe('{"new":true}');
    expect(result.raw.reviewImport).toEqual({ sourceHash: "new-reviews", filename: "new.csv" });
    expect(result.raw.contentHash).toBe("old-content");
    expect(result.raw.analysis).toEqual(JSON.parse(existing.rawData!).analysis);
    expect(result.raw).not.toHaveProperty("removedOldKey");
    expect(result.raw.analysisStale).toBe(true);
    expect(result.row.summary).toBe(existing.summary);
  });

  it("does not call review display filename changes a changed review source", () => {
    const result = merged(record(), { rawData: '{"reviewImport":{"sourceHash":"old-reviews","filename":"renamed.csv"}}' }, "reviews");
    expect(result.raw.reviewImport.filename).toBe("renamed.csv");
    expect(result.raw).not.toHaveProperty("analysisStale");
  });

  it.each([undefined, null, "", "   "])("refuses a changed review digest without a nonempty incoming result (%s)", reviewAnalysis => {
    expect(() => merged(record(), {
      reviewAnalysis, rawData: '{"reviewImport":{"sourceHash":"new-reviews"}}',
    }, "reviews")).toThrow("COMPETITOR_REVIEW_RESULT_REQUIRED");
  });

  it.each([{}, { sourceHash: null }, { sourceHash: 23 }, { sourceHash: "" }])("refuses an incomplete incoming review source %j", reviewImport => {
    expect(() => merged(record(), { reviewAnalysis: "new", rawData: JSON.stringify({ reviewImport }) }, "reviews"))
      .toThrow("COMPETITOR_REVIEW_SOURCE_INVALID");
  });

  it.each(["confirmedSnapshotId", "contentHash", "sellerSpriteSourceHash", "sellerSpriteData", "source", "importSource", "manualInput", "scrapedData"])("binds the explicit original-source envelope %s", key => {
    expect(merged(record(), { rawData: JSON.stringify({ [key]: key === "sellerSpriteData" || key === "scrapedData" ? { source: "new" } : "new" }) }).raw.analysisStale).toBe(true);
  });

  it("does not hash unknown AI/presentation keys as original source", () => {
    expect(merged(record(), { rawData: '{"newAiScore":0.8,"newPresentationState":"ready"}' }).raw).not.toHaveProperty("analysisStale");
  });

  it.each(["upsert", "reviews"] as const)("%s cannot clear reviews/raw via null or clear a stale marker", kind => {
    const existing = record({ rawData: '{"analysisStale":true,"captureOnly":true,"custom":[1],"reviewImport":{"sourceHash":"old"}}' });
    const result = merged(existing, { rawData: null, reviewAnalysis: null }, kind);
    expect(result.update).toEqual({});
    expect(result.raw.analysisStale).toBe(true);
    const falseCandidate = merged(existing, { rawData: '{"analysisStale":false,"captureOnly":false}' }, kind);
    expect(falseCandidate.raw.analysisStale).toBe(true);
    expect(falseCandidate.raw.captureOnly).toBe(true);
  });

  it.each(["projectId", "asin", "id"] as const)("rejects foreign %s instead of silently retargeting", key => {
    const value = key === "asin" ? "B000000009" : 999;
    expect(() => merged(record(), { [key]: value })).toThrow("COMPETITOR_IDENTITY_CHANGED");
  });

  it.each(["{", "null", "[]", "3", '"text"'])("refuses malformed/non-object raw JSON: %s", rawData => {
    expect(() => merged(record(), { rawData })).toThrow("COMPETITOR_RAW_DATA_INVALID");
    expect(() => merged(record({ rawData }), {})).toThrow("COMPETITOR_RAW_DATA_INVALID");
  });

  it("does not mutate either input or return writable identity/timestamps/review state", () => {
    const existing = record(), incoming = { projectId: 11, asin: existing.asin, title: "new", summaryVersion: 99 };
    const before = structuredClone({ existing, incoming });
    const { update } = merged(existing, incoming);
    expect({ existing, incoming }).toEqual(before);
    for (const field of ["id", "projectId", "asin", "createdAt", "updatedAt", "summaryVersion", "summaryStatus"]) expect(update).not.toHaveProperty(field);
  });

  it("rejects accessor inputs without evaluating them", () => {
    const getter = vi.fn(() => "{}");
    const incoming = Object.defineProperty({}, "rawData", { get: getter, enumerable: true });
    expect(() => merged(record(), incoming)).toThrow("COMPETITOR_RECORD_INVALID");
    expect(getter).not.toHaveBeenCalled();
  });
});
