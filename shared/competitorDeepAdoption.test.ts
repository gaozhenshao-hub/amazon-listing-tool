import { describe, expect, it } from "vitest";
import { CompetitorDeepAdoptionInputSchema, CompetitorDeepAdoptionRefSchema, CompetitorDeepAdoptionReceiptSchema,
  competitorDeepAdoptionArtifactId, competitorDeepAdoptionHash as hash, competitorDeepAdoptionSourceFingerprint as fingerprint,
  matchesCurrentCompetitorDeepAdoptionReview } from "./competitorDeepAdoption";

const op = "a0000000-0000-4000-8000-000000000001";
const input = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, jobRunId: "deep-synthetic", operationId: op,
  expectedRevision: "a".repeat(64), expectedResultHash: "b".repeat(64), expectedEvidenceHash: "c".repeat(64), summary: "Reviewed", confirmLimitations: true };
const source = () => ({ id: 21, projectId: 11, asin: "B000000001", title: "Lamp", summary: "before", summaryStatus: "draft", summaryVersion: 1,
  summaryConfirmedBy: null, summaryConfirmedAt: null, aiSummary: "original AI", updatedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2025-01-01T00:00:00Z"), rawData: JSON.stringify({ unknown: 1, manualSales: { value: 0 }, deepAnalysis: { old: true } }) });
describe("strict human deep adoption contracts", () => {
  it("shares the exact nested-identity operation artifact ID factory", () => {
    expect(competitorDeepAdoptionArtifactId({ userId: 3, workspaceId: 7, operationId: op }))
      .toBe(`deep_adopt_${hash({ identity: { userId: 3, workspaceId: 7 }, operationId: op })}`);
    expect(competitorDeepAdoptionArtifactId({ userId: 4, workspaceId: 7, operationId: op }))
      .not.toBe(competitorDeepAdoptionArtifactId({ userId: 3, workspaceId: 7, operationId: op }));
  });
  it("requires explicit review of limitations and rejects extra/case-forged request fields", () => {
    expect(CompetitorDeepAdoptionInputSchema.parse(input)).toEqual(input);
    for (const patch of [{ confirmLimitations: false }, { confirmLimitations: undefined }, { operationId: op.toUpperCase() },
      { expectedWorkspaceId: undefined }, { summary: " " }, { result: {} }, { expectedResultHash: "b".repeat(63) }]) {
      expect(CompetitorDeepAdoptionInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it("enforces TEXT UTF8 bytes separately from character limit", () => {
    expect(CompetitorDeepAdoptionInputSchema.safeParse({ ...input, summary: "a".repeat(20_000) }).success).toBe(true);
    // Astral pairs take two UTF16 units; lone surrogate input is not an honest UTF8 summary.
    expect(CompetitorDeepAdoptionInputSchema.safeParse({ ...input, summary: "灯".repeat(20_001) }).success).toBe(false);
    expect(CompetitorDeepAdoptionInputSchema.safeParse({ ...input, summary: "broken\ud800" }).success).toBe(false);
  });
  it("omits only summary review fields, updatedAt and the server raw adoption pointer from source binding", () => {
    const row = source(), after = { ...row, summary: "edited", summaryStatus: "confirmed", summaryVersion: 2, summaryConfirmedBy: 3,
      summaryConfirmedAt: new Date(), updatedAt: new Date(), rawData: JSON.stringify({ ...JSON.parse(row.rawData), deepAdoptionRef: { pointer: true } }) };
    expect(fingerprint(after)).toBe(fingerprint(row));
    for (const patch of [{ aiSummary: "changed" }, { title: "new" }, { unknownPersistedField: 1 }, { rawData: JSON.stringify({ unknown: 2 }) }]) {
      expect(fingerprint({ ...row, ...patch })).not.toBe(fingerprint(row));
    }
  });
  it("rejects lossy/untrusted source records without invoking accessors", () => {
    let invoked = false; const row = source(); Object.defineProperty(row, "getter", { enumerable: true, get() { invoked = true; return 1; } });
    expect(() => fingerprint(row)).toThrow(); expect(invoked).toBe(false);
    for (const value of [null, [], { ...source(), rawData: "{broken" }, { ...source(), rawData: "[]" }, { ...source(), extra: undefined }]) expect(() => fingerprint(value)).toThrow();
  });
  it("committed receipts require exact op/job/actor linkage and no fabricated active fields", () => {
    const ref = CompetitorDeepAdoptionRefSchema.parse({ version: 1, kind: "competitor_deep_adoption", artifactId: competitorDeepAdoptionArtifactId({ userId: 3, workspaceId: 7, operationId: op }),
      operationId: op, jobRunId: input.jobRunId, resultHash: "a".repeat(64), evidenceHash: "b".repeat(64), sourceFingerprint: "c".repeat(64), projectionHash: "d".repeat(64),
      summaryHash: hash(input.summary), summaryVersion: 2, adoptedBy: 3, adoptedAt: "2026-10-19T00:00:00.000Z" });
    const receipt = { version: 1, identity: { userId: 3, workspaceId: 7 }, projectId: 11, analysisId: 21, jobRunId: input.jobRunId,
      operationId: op, status: "committed", requestHash: "e".repeat(64), ref, committedRevision: "f".repeat(64), reasonCode: null };
    expect(CompetitorDeepAdoptionReceiptSchema.safeParse(receipt).success).toBe(true);
    const reviewed = { summary: input.summary, summaryStatus: "confirmed", summaryVersion: 2, summaryConfirmedBy: 3, summaryConfirmedAt: new Date(ref.adoptedAt) };
    expect(matchesCurrentCompetitorDeepAdoptionReview(reviewed, ref)).toBe(true);
    for (const patch of [{ summary: "edited" }, { summaryStatus: "draft" }, { summaryVersion: 3 }, { summaryConfirmedBy: 4 },
      { summaryConfirmedAt: new Date("2026-10-20T00:00:00Z") }, { summaryConfirmedAt: new Date(NaN) }, { summaryConfirmedAt: ref.adoptedAt }]) {
      expect(matchesCurrentCompetitorDeepAdoptionReview({ ...reviewed, ...patch }, ref)).toBe(false);
    }
    for (const patch of [{ ref: null }, { committedRevision: null }, { requestHash: null }, { reasonCode: "UNKNOWN" },
      { identity: { userId: 4, workspaceId: 7 } }, { jobRunId: "other" }, { currentActive: true }]) expect(CompetitorDeepAdoptionReceiptSchema.safeParse({ ...receipt, ...patch }).success).toBe(false);
  });
});
