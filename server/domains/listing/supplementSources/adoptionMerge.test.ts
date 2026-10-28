import { describe, expect, it } from "vitest";
import { mergeSupplementAdoption, SupplementAdoptedSetSchema } from "../../../../shared/listingSupplementAdoption";
import { SupplementManifestSchema, supplementHash, type SupplementRecord } from "../../../../shared/listingSupplementSources";

const scope = { expectedWorkspaceId: 7, projectId: 11 };
const target = { type: "competitor" as const, analysisId: 21, asin: "B000000021", revisionHash: "a".repeat(64) };
function record(kind: "reviews" | "questions" | "attributes", patch: Record<string, unknown> = {}): SupplementRecord {
  const value = kind === "reviews" ? { body: "Comfortable suit", title: null, rating: 5, date: null, author: null,
    verifiedPurchase: null, variant: null, sourceReviewId: "R1", ...patch }
    : kind === "questions" ? { question: "Does it include gloves?", questionCn: null, answer: "Yes", answerCn: null,
      parentQuestion: null, type: "alexa", ...patch } : { name: "Material", value: "cotton", ...patch };
  return { kind, value, recordId: supplementHash({ kind, value }), locator: { part: "Sheet1", row: 2 }, declaredAsin: null, sourceFields: [] } as SupplementRecord;
}
function manifest(sequence: number, records = [record("reviews")], selectedTarget = target) {
  const kind = records[0].kind;
  const body = {
    version: 1, manifestVersion: 1, sourceId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    identity: { workspaceId: 7, userId: 3 }, scope, kind,
    original: { originalType: "file", fileName: `${sequence}.csv`, contentType: "text/csv", byteSize: 100, contentHash: supplementHash(records) },
    parserVersion: "listing-supplement-parser/1", previewHash: "b".repeat(64), previewStatus: "ready", reasonCode: null,
    records: records.map(source => ({ source, target: kind === "attributes" ? { type: "product", projectId: 11, revisionHash: "a".repeat(64) } : selectedTarget })),
    coverage: { scope: "complete_supplied_original_not_market_total", totalRows: records.length, acceptedRows: records.length,
      excluded: [], normalization: "LF_then_trim_no_internal_whitespace_collapse" },
    previousManifestHash: null, createdAt: "2026-10-19T00:00:00Z",
  };
  return SupplementManifestSchema.parse({ ...body, manifestHash: supplementHash(body) });
}
const merge = (manifests: ReturnType<typeof manifest>[], extra: Partial<Parameters<typeof mergeSupplementAdoption>[0]> = {}) =>
  mergeSupplementAdoption({ scope, kind: manifests[0].kind, mode: "append", manifests, current: null, ...extra });

describe("complete supplement adoption merge", () => {
  it("deduplicates repeated reviews across files while retaining both original locations", () => {
    const sources = [manifest(1), manifest(2)], result = merge(sources);
    expect(result.proposed!.entries).toHaveLength(1);
    expect(result.proposed!.entries[0].origins).toHaveLength(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.modelInvoked).toBe(false);
    expect(result.previewHash).toBe(merge([...sources].reverse()).previewHash);
  });
  it("append keeps previous records and detects material changes to the same review ID", () => {
    const current = merge([manifest(1)]).proposed;
    const input = manifest(2, [record("reviews", { body: "Broken zipper", rating: 1 })]);
    const conflict = merge([input], { current });
    expect(conflict.proposed).toBeNull();
    expect(conflict.conflicts).toHaveLength(1);
    const chosen = conflict.conflicts[0].candidates.find(item => item.record.kind === "reviews" && item.record.value.rating === 1)!;
    const resolved = merge([input], { current, resolutions: [{ key: chosen.key, valueHash: chosen.valueHash }] });
    expect(resolved.proposed!.entries[0].record).toEqual(chosen.record);
    expect(resolved.resolved[0].candidates).toHaveLength(2);
    expect(current!.entries[0].record).toEqual(record("reviews"));
  });
  it("does not collapse conflicting answers or invent question frequencies", () => {
    const result = merge([manifest(1, [record("questions")]), manifest(2, [record("questions", { answer: "No" })])]);
    expect(result.proposed).toBeNull();
    expect(result.conflicts[0].candidates).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("frequency");
  });
  it("keeps follow-up questions and parent question relationships distinct", () => {
    const result = merge([manifest(1, [record("questions"), record("questions", { type: "follow_up", parentQuestion: "What is included?" })])]);
    expect(result.proposed!.entries).toHaveLength(2);
  });
  it("same attribute key with a changed value requires a choice and subsequent fact review", () => {
    const result = merge([manifest(1, [record("attributes")]), manifest(2, [record("attributes", { value: "polyester" })])]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.proposed).toBeNull();
    expect(result.factReviewRequired).toBe(true);
  });
  it("replace changes only the explicitly affected product, retaining other ASINs", () => {
    const other = { ...target, analysisId: 22, asin: "B000000022" };
    const current = merge([manifest(1), manifest(2, [record("reviews")], other)]).proposed;
    const result = merge([manifest(3, [record("reviews", { body: "New review", sourceReviewId: "R2" })])], { current, mode: "replace" });
    expect(result.proposed!.entries).toHaveLength(2);
    expect(result.proposed!.entries.filter(item => item.target.type === "competitor" && item.target.asin === other.asin)[0])
      .toEqual(current!.entries.find(item => item.target.type === "competitor" && item.target.asin === other.asin));
    expect(current!.entries).toHaveLength(2);
  });
  it("a repeated adoption is idempotent and retains content after original storage is removed", () => {
    const original = manifest(1), current = merge([original]).proposed;
    const next = merge([original], { current });
    expect(next.proposed).toEqual(current);
    original.records.length = 0;
    expect(next.proposed!.entries[0].record).toEqual(record("reviews"));
  });
  it("rejects different project/workspace and modified immutable manifests", () => {
    expect(() => merge([manifest(1)], { scope: { ...scope, projectId: 99 } })).toThrow("SOURCE_SCOPE_MISMATCH");
    expect(() => merge([manifest(1)], { scope: { ...scope, expectedWorkspaceId: 99 } })).toThrow("SOURCE_SCOPE_MISMATCH");
    const changed = manifest(1); changed.records[0].source.locator.row = 999;
    expect(() => merge([changed])).toThrow();
  });
  it("rejects duplicate source selection and stale/irrelevant conflict choices", () => {
    expect(() => merge([manifest(1), manifest(1)])).toThrow("DUPLICATE_SOURCE_SELECTION");
    expect(() => merge([manifest(1)], { resolutions: [{ key: "a".repeat(64), valueHash: "b".repeat(64) }] })).toThrow("UNKNOWN_RESOLUTION");
    const current = merge([manifest(1)]).proposed!;
    current.entries[0].valueHash = "f".repeat(64);
    expect(() => SupplementAdoptedSetSchema.parse(current)).toThrow();
  });
  it("does not treat matching review IDs from different ASINs as one review", () => {
    expect(merge([manifest(1), manifest(2, [record("reviews")], { ...target, analysisId: 22, asin: "B000000022" })]).proposed!.entries).toHaveLength(2);
  });
});
