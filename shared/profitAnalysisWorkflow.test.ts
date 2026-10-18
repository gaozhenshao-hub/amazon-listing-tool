import { describe, expect, it } from "vitest";
import {
  PROFIT_ANALYSIS_WORKFLOW_STATES, ProfitAnalysisHistoryInputSchema, ProfitAnalysisOperationInputSchema,
  ProfitAnalysisSaveInputSchema, ProfitAnalysisSaveOperationInputSchema, ProfitAnalysisStartInputSchema,
  ProfitAnalysisWorkflowStateSchema, canTransitionProfitAnalysisWorkflow, profitAnalysisLeaseRecovery,
  type ProfitAnalysisWorkflowState,
} from "./profitAnalysisWorkflow";

const operationId = "a7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const saveOperationId = "b8e30af9-3d64-4d45-8af8-dcf45d213236";
const scope = { storeName: "SYNTHETIC Store", country: "US", parentAsin: "SYNTHETIC-PARENT", currency: "USD", basis: "child_rows" as const };
const context = { expectedWorkspaceId: 7, scope, month: "2026-09" };
const start = { ...context, operationId, expectedReportVersion: 0, expectedSourceHash: "a".repeat(64), regenerateConfirmed: false };
const save = { ...context, saveOperationId, runOperationId: operationId, expectedReportVersion: 3, expectedResultHash: "b".repeat(64), expectedSourceHash: "a".repeat(64) };
const requests = [
  { name: "start", schema: ProfitAnalysisStartInputSchema, input: start },
  { name: "operation", schema: ProfitAnalysisOperationInputSchema, input: { ...context, operationId } },
  { name: "save", schema: ProfitAnalysisSaveInputSchema, input: save },
  { name: "save operation", schema: ProfitAnalysisSaveOperationInputSchema, input: { ...context, saveOperationId } },
  { name: "history", schema: ProfitAnalysisHistoryInputSchema, input: { ...context, limit: 10 } },
];

describe("private profit workflow input contracts", () => {
  it.each(requests)("accepts the exact $name request without mutating its scope", ({ schema, input }) => {
    const original = JSON.stringify(input);
    expect(schema.parse(input)).toEqual(input);
    expect(JSON.stringify(input)).toBe(original);
  });
  it.each(requests)("rejects caller financial facts, owner and execution authority on $name", ({ schema, input }) => {
    for (const extra of [
      { rows: [] }, { raw: {} }, { evidence: [] }, { result: {} }, { resultHash: "c".repeat(64) },
      { source: {} }, { sourceHash: "c".repeat(64) }, { selectedBatchId: 4 }, { userId: 3 },
      { ownerId: 3 }, { operatorId: 3 }, { workspaceId: 8 }, { modelSlug: "listing-model" },
      { modelOverride: "other" }, { skillSlug: "finance.monthly.profit" }, { manifest: {} },
      { configuration: {} }, { force: true }, { state: "succeeded" }, { canGenerate: true },
    ]) expect(schema.safeParse({ ...input, ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(schema.safeParse({ ...input, scope: { ...scope, userId: 3 } }).success).toBe(false);
  });
  it.each(requests)("requires the complete exact $name business range and real comparison calendar", ({ schema, input }) => {
    for (const key of ["expectedWorkspaceId", "scope", "month"] as const) {
      const broken: Record<string, unknown> = { ...input }; delete broken[key];
      expect(schema.safeParse(broken).success).toBe(false);
    }
    for (const patch of [{ storeName: "" }, { country: "" }, { parentAsin: "" }, { currency: "US" }, { basis: "unallocated_rows" }, { storeName: " other " }]) {
      expect(schema.safeParse({ ...input, scope: { ...scope, ...patch } }).success).toBe(false);
    }
    for (const month of ["1000-01", "2026-00", "2026-13", "2026-09-01", "2026-9", " 2026-09 "]) expect(schema.safeParse({ ...input, month }).success).toBe(false);
    for (const expectedWorkspaceId of [0, -1, 1.5, "7", 2_147_483_648]) expect(schema.safeParse({ ...input, expectedWorkspaceId }).success).toBe(false);
  });
  it("inherits country normalization and preserves explicit unknown currency without inventing USD", () => {
    expect(ProfitAnalysisStartInputSchema.parse({ ...start, scope: { ...scope, country: "美国", currency: null } }).scope)
      .toEqual({ ...scope, country: "US", currency: null });
    expect(ProfitAnalysisOperationInputSchema.parse({ ...context, operationId, scope: { ...scope, basis: "reported_parent_row" } }).scope.basis).toBe("reported_parent_row");
  });
  it("requires explicit regeneration intent and never treats a false flag as force", () => {
    expect(ProfitAnalysisStartInputSchema.parse(start).regenerateConfirmed).toBe(false);
    expect(ProfitAnalysisStartInputSchema.parse({ ...start, regenerateConfirmed: true }).regenerateConfirmed).toBe(true);
    const { regenerateConfirmed: _omitted, ...missing } = start;
    expect(ProfitAnalysisStartInputSchema.safeParse(missing).success).toBe(false);
    for (const regenerateConfirmed of [0, 1, "true", null]) expect(ProfitAnalysisStartInputSchema.safeParse({ ...start, regenerateConfirmed }).success).toBe(false);
  });
  it.each(["", "not-a-uuid", operationId.toUpperCase(), ` ${operationId}`, `${operationId} `])("rejects noncanonical operation UUID %j without silently rewriting it", value => {
    expect(ProfitAnalysisStartInputSchema.safeParse({ ...start, operationId: value }).success).toBe(false);
    expect(ProfitAnalysisOperationInputSchema.safeParse({ ...context, operationId: value }).success).toBe(false);
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, saveOperationId: value }).success).toBe(false);
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, runOperationId: value }).success).toBe(false);
    expect(ProfitAnalysisSaveOperationInputSchema.safeParse({ ...context, saveOperationId: value }).success).toBe(false);
  });
  it("separates save identity from the generation operation", () => {
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, saveOperationId: operationId }).success).toBe(false);
    expect(ProfitAnalysisSaveOperationInputSchema.safeParse({ ...context, operationId }).success).toBe(false);
    expect(ProfitAnalysisOperationInputSchema.safeParse({ ...context, saveOperationId }).success).toBe(false);
  });
  it.each([-1, 0.5, "0", null, NaN, Infinity, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])("rejects invalid report version %s", expectedReportVersion => {
    expect(ProfitAnalysisStartInputSchema.safeParse({ ...start, expectedReportVersion }).success).toBe(false);
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, expectedReportVersion }).success).toBe(false);
  });
  it("keeps zero and the supported maximum report version exact", () => {
    for (const expectedReportVersion of [0, 2_147_483_647]) {
      expect(ProfitAnalysisStartInputSchema.parse({ ...start, expectedReportVersion }).expectedReportVersion).toBe(expectedReportVersion);
      expect(ProfitAnalysisSaveInputSchema.parse({ ...save, expectedReportVersion }).expectedReportVersion).toBe(expectedReportVersion);
    }
  });
  it.each(["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), null])("rejects malformed source/result digest %j", digest => {
    expect(ProfitAnalysisStartInputSchema.safeParse({ ...start, expectedSourceHash: digest }).success).toBe(false);
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, expectedSourceHash: digest }).success).toBe(false);
    expect(ProfitAnalysisSaveInputSchema.safeParse({ ...save, expectedResultHash: digest }).success).toBe(false);
  });
  it("does not require hashes or a fresh result to check or cancel an unknown operation", () => {
    expect(ProfitAnalysisOperationInputSchema.parse({ ...context, operationId })).toEqual({ ...context, operationId });
    expect(ProfitAnalysisSaveOperationInputSchema.parse({ ...context, saveOperationId })).toEqual({ ...context, saveOperationId });
  });
  it("bounds exact-month history with an optional positive cursor and explicit continuation-sized limit", () => {
    expect(ProfitAnalysisHistoryInputSchema.parse(context)).toEqual({ ...context, limit: 10 });
    expect(ProfitAnalysisHistoryInputSchema.parse({ ...context, beforeId: 2_147_483_647, limit: 20 })).toEqual({ ...context, beforeId: 2_147_483_647, limit: 20 });
    for (const limit of [0, -1, 21, 1.5, "10", null]) expect(ProfitAnalysisHistoryInputSchema.safeParse({ ...context, limit }).success).toBe(false);
    for (const beforeId of [0, -1, 0.5, 2_147_483_648, "10", null]) expect(ProfitAnalysisHistoryInputSchema.safeParse({ ...context, beforeId }).success).toBe(false);
  });
});

describe("profit workflow durable transition and recovery plan", () => {
  const expectedEdges = new Set([
    "queued:dispatched", "queued:result_ready", "queued:failed", "queued:canceled",
    "dispatched:result_ready", "dispatched:canceled", "dispatched:unknown",
    "result_ready:succeeded", "result_ready:canceled", "unknown:canceled",
  ]);
  it.each(PROFIT_ANALYSIS_WORKFLOW_STATES)("restricts every transition out of %s", from => {
    for (const to of PROFIT_ANALYSIS_WORKFLOW_STATES) {
      expect(canTransitionProfitAnalysisWorkflow(from, to), `${from} -> ${to}`).toBe(expectedEdges.has(`${from}:${to}`));
    }
  });
  it("permits a validated deterministic result without inventing dispatch, but never direct success", () => {
    expect(canTransitionProfitAnalysisWorkflow("queued", "result_ready")).toBe(true);
    expect(canTransitionProfitAnalysisWorkflow("queued", "succeeded")).toBe(false);
  });
  it("cannot retry dispatched or unknown work, or destroy a durable result after local failure", () => {
    expect(profitAnalysisLeaseRecovery("dispatched")).toBe("mark_unknown");
    expect(profitAnalysisLeaseRecovery("unknown")).toBe("none");
    expect(profitAnalysisLeaseRecovery("result_ready")).toBe("finish_locally");
    for (const state of ["dispatched", "result_ready", "unknown"] as const) {
      expect(canTransitionProfitAnalysisWorkflow(state, "queued")).toBe(false);
      expect(canTransitionProfitAnalysisWorkflow(state, "failed")).toBe(false);
    }
  });
  it("reclaims only pre-dispatch work and leaves every terminal outcome alone", () => {
    expect(profitAnalysisLeaseRecovery("queued")).toBe("reclaim");
    for (const state of ["succeeded", "failed", "canceled", "unknown"] as const) expect(profitAnalysisLeaseRecovery(state)).toBe("none");
  });
  it.each(["running", "draft", "saved", "cancelled", "constructor", "__proto__", "", null])("rejects an unsupported state at runtime: %j", state => {
    expect(ProfitAnalysisWorkflowStateSchema.safeParse(state).success).toBe(false);
    expect(() => profitAnalysisLeaseRecovery(state as ProfitAnalysisWorkflowState)).toThrow();
    expect(() => canTransitionProfitAnalysisWorkflow(state as ProfitAnalysisWorkflowState, "queued")).toThrow();
    expect(() => canTransitionProfitAnalysisWorkflow("queued", state as ProfitAnalysisWorkflowState)).toThrow();
  });
});
