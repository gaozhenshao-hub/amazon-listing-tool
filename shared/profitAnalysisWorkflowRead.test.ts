import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch } from "./monthlyFinancialRead";
import { buildProfitAnalysisEvidence, finishProfitAnalysis, type ProfitAnalysisScope, type ProfitAnalysisSource } from "./profitAnalysis";
import {
  ProfitAnalysisGenerationCapabilitySchema, ProfitAnalysisPublicRunSchema, ProfitAnalysisReportSchema,
  ProfitAnalysisWorkflowCancelResultSchema, ProfitAnalysisWorkflowHistoryResultSchema,
  ProfitAnalysisWorkflowSaveResultSchema, ProfitAnalysisWorkflowViewResultSchema,
  type ProfitAnalysisPublicRun, type ProfitAnalysisWorkflowViewResult,
} from "./profitAnalysisWorkflowRead";
import { PROFIT_ANALYSIS_WORKFLOW_STATES } from "./profitAnalysisWorkflow";

const operationId = "a7d29fe8-2c53-4c34-bfe7-cbe34c102125", saveOperationId = "b8e30af9-3d64-4d45-8af8-dcf45d213236";
const otherId = "c9f41ba0-4e75-4e56-9ba9-edf56e324347";
const identity = { userId: 7, workspaceId: 11 };
const scope: ProfitAnalysisScope = { storeName: "SYNTHETIC Store", country: "US", parentAsin: "SYNTHETIC-PARENT", currency: "USD", basis: "child_rows" };
const request = { expectedWorkspaceId: 11, scope, month: "2026-09" };
const sourceHash = "a".repeat(64), resultHash = "b".repeat(64), time = "2026-10-18 01:02:03.123456";
const clone = <T>(value: T): T => structuredClone(value);
function result(overrides: { identity?: typeof identity; scope?: ProfitAnalysisScope; month?: string } = {}) {
  const owner = overrides.identity ?? identity, target = overrides.scope ?? scope, month = overrides.month ?? "2026-09";
  const previousMonth = month === "2026-09" ? "2026-08" : "2026-07";
  const source: ProfitAnalysisSource = { version: 1, identity: owner, scope: target, month, previousMonth,
    sourceHash, selectionHash: "c".repeat(64), authorizationHash: "d".repeat(64),
    periods: [previousMonth, month].map((period, index) => {
      const batchId = index + 1;
      const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), financialProfit: 20 + index * 5,
        salesQty: 10, salesAmount: 100, yearMonth: period, parentAsin: target.parentAsin,
        asin: target.basis === "reported_parent_row" ? "" : "SYNTHETIC-CHILD", sku: "SYNTHETIC-SKU", title: "SYNTHETIC TITLE",
        storeName: target.storeName, site: target.country, operator: null, raw: { currency: target.currency } }];
      const parsed = parseMonthlyFinancialBatch({ id: batchId, workspaceId: owner.workspaceId, userId: owner.userId,
        fileName: "SYNTHETIC.xlsx", fileHash: "e".repeat(64), status: "completed", totalRows: 1, skippedRows: 0,
        unallocatedRows: 0, months: [period], payload, createdAt: time, confirmedAt: time, fileReferenceKind: "storage", sourceRunId: null });
      return { month: period, rows: parsed.rows, selection: { complete: true, rule: "latest_completed_batch_per_month_store_site",
        selectedBatchId: batchId, recordHash: "f".repeat(64), scopeRowCount: 1, authorizedRowCount: 1 } };
    }),
  };
  const evidence = buildProfitAnalysisEvidence(source);
  return finishProfitAnalysis(evidence, { severity: "需关注", reasons: [{ evidenceId: evidence.evidence[0].id, explanation: "SYNTHETIC 说明" }] });
}
const success: ProfitAnalysisPublicRun = { operationId, state: "succeeded", errorCode: null, sourceHash, resultHash,
  result: result(), stale: false, createdAt: time, updatedAt: time, completedAt: time };
const report = { version: 3, activeOperationId: null, latestOperationId: operationId, savedOperationId: operationId, updatedAt: time, savedAt: time };
const view: ProfitAnalysisWorkflowViewResult = { version: 1, identity, request, report, currentSourceHash: sourceHash, sourceStatus: "ready",
  generation: { available: false, reasonCode: "EXECUTION_DISABLED", modelRequired: true, configuration: null },
  run: success, draft: success, saved: success };
const history = { version: 1, identity, request, items: [success], nextBeforeId: null };
const save = { version: 1, identity, request: { ...request, saveOperationId }, status: "committed",
  receipt: { saveId: saveOperationId, operationId, requestHash: "c".repeat(64), resultHash, sourceHash, reportVersion: 4, savedAt: time } };
const cancellation = { version: 1, identity, request: { ...request, operationId }, operationId, state: "canceled", errorCode: "CANCELED_BY_USER" };

describe("public profit run and report projections", () => {
  it("keeps complete successful evidence with the exact source hash and no raw snapshot", () => {
    expect(ProfitAnalysisPublicRunSchema.parse(success)).toEqual(success);
    for (const patch of [{ snapshot: {} }, { request: {} }, { runtime: {} }, { dispatchReceipt: {} }, { leaseToken: operationId }, { raw: [] }, { configuration: {} }]) {
      expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, ...patch }).success).toBe(false);
    }
  });
  it.each(PROFIT_ANALYSIS_WORKFLOW_STATES.filter(state => state !== "succeeded"))("never discloses result content in %s", state => {
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, state }).success).toBe(false);
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, state, result: null }).success).toBe(true);
  });
  it("keeps result-ready metadata without exposing a paid result before local finalization", () => {
    expect(ProfitAnalysisPublicRunSchema.parse({ ...success, state: "result_ready", result: null, completedAt: null })).toMatchObject({ result: null, resultHash });
  });
  it.each(["result", "resultHash", "sourceHash", "completedAt"])("requires successful %s", field => {
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, [field]: null }).success).toBe(false);
  });
  it("rejects mismatched source binding, false unknown-source freshness and success errors", () => {
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, sourceHash: "f".repeat(64) }).success).toBe(false);
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, errorCode: "PROVIDER_FAILED" }).success).toBe(false);
    const unknownSource = { ...success, state: "canceled", result: null, resultHash: null, sourceHash: null, stale: null };
    expect(ProfitAnalysisPublicRunSchema.safeParse(unknownSource).success).toBe(true);
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...unknownSource, stale: false }).success).toBe(false);
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...unknownSource, resultHash }).success).toBe(false);
  });
  it.each(["private provider error", "https://secret.invalid", "", "lower_case", "ERROR\nSECRET", "X".repeat(101)])("rejects raw or invalid error text %j", errorCode => {
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, state: "failed", result: null, errorCode }).success).toBe(false);
    expect(ProfitAnalysisWorkflowCancelResultSchema.safeParse({ ...cancellation, errorCode }).success).toBe(false);
  });
  it.each(["2026-02-29 00:00:00.000000", "2026-04-31 00:00:00.000000", "2026-10-18 24:00:00.000000", "2026-10-18T01:02:03.123Z", "2026-10-18 01:02:03.123", "0000-00-00 00:00:00.000000"])("rejects non-source database time %j", createdAt => {
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, createdAt }).success).toBe(false);
  });
  it("accepts exact leap-day database timestamps without timezone reinterpretation", () => {
    const createdAt = "2024-02-29 23:59:59.999999";
    expect(ProfitAnalysisPublicRunSchema.parse({ ...success, createdAt }).createdAt).toBe(createdAt);
  });
  it("requires saved report identity and timestamp together", () => {
    expect(ProfitAnalysisReportSchema.parse(report)).toEqual(report);
    expect(ProfitAnalysisReportSchema.parse({ ...report, version: 0, savedOperationId: null, savedAt: null }).version).toBe(0);
    expect(ProfitAnalysisReportSchema.safeParse({ ...report, savedAt: null }).success).toBe(false);
    expect(ProfitAnalysisReportSchema.safeParse({ ...report, savedOperationId: null }).success).toBe(false);
    expect(ProfitAnalysisReportSchema.safeParse({ ...report, version: -1 }).success).toBe(false);
  });
});

describe("private exact-scope workflow view and history", () => {
  it("accepts separate draft/saved slots and the existing shared result", () => {
    expect(ProfitAnalysisWorkflowViewResultSchema.parse(view)).toEqual(view);
    expect(ProfitAnalysisWorkflowHistoryResultSchema.parse(history)).toEqual(history);
  });
  it.each(["run", "draft", "saved"] as const)("binds every %s result to the response's private identity and exact scope", field => {
    for (const changed of [
      result({ identity: { ...identity, userId: 8 } }), result({ identity: { ...identity, workspaceId: 12 } }),
      result({ scope: { ...scope, storeName: "OTHER STORE" } }), result({ scope: { ...scope, country: "CA" } }),
      result({ scope: { ...scope, parentAsin: "OTHER PARENT" } }), result({ scope: { ...scope, currency: "EUR" } }),
      result({ scope: { ...scope, basis: "reported_parent_row" } }), result({ month: "2026-08" }),
    ]) {
      const run = { ...success, result: changed };
      expect(ProfitAnalysisPublicRunSchema.safeParse(run).success).toBe(true);
      expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, [field]: run }).success).toBe(false);
      expect(ProfitAnalysisWorkflowHistoryResultSchema.safeParse({ ...history, items: [run] }).success).toBe(false);
    }
  });
  it("requires response workspace to match the freshness request", () => {
    for (const [schema, value] of [[ProfitAnalysisWorkflowViewResultSchema, view], [ProfitAnalysisWorkflowHistoryResultSchema, history], [ProfitAnalysisWorkflowSaveResultSchema, save], [ProfitAnalysisWorkflowCancelResultSchema, cancellation]] as const) {
      expect(schema.safeParse({ ...value, identity: { ...identity, workspaceId: 12 } }).success).toBe(false);
    }
  });
  it("rejects incomplete source availability and makes unavailable generation explicit", () => {
    for (const sourceStatus of ["ready", "blocked"]) expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, sourceStatus, currentSourceHash: null }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, sourceStatus: "unavailable", currentSourceHash: null,
      run: { ...success, stale: true }, draft: { ...success, stale: true }, saved: { ...success, stale: true } }).success).toBe(true);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, generation: { ...view.generation, reasonCode: null } }).success).toBe(false);
  });
  it("retains old saved results but cannot present a changed or unavailable source as fresh", () => {
    for (const field of ["run", "draft", "saved"]) expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, [field]: { ...success, stale: true } }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, currentSourceHash: "f".repeat(64) }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, sourceStatus: "unavailable", currentSourceHash: null }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.parse({ ...view, currentSourceHash: "f".repeat(64),
      run: { ...success, stale: true }, draft: { ...success, stale: true }, saved: { ...success, stale: true } }).saved?.result).toEqual(success.result);
  });
  it("does not equate draft or saved with queued/result-ready/running state", () => {
    for (const field of ["draft", "saved"]) for (const state of ["queued", "result_ready", "unknown", "failed", "canceled"]) {
      expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, [field]: { ...success, state, result: null } }).success).toBe(false);
    }
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, report: { ...report, savedOperationId: otherId } }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, report: { ...report, latestOperationId: otherId } }).success).toBe(false);
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, report: null }).success).toBe(false);
  });
  it("bounds complete run-history pages, rejects duplicates, and preserves a real continuation cursor", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ ...success, operationId: `a7d29fe8-2c53-4c34-bfe7-${String(index).padStart(12, "0")}` }));
    expect(ProfitAnalysisWorkflowHistoryResultSchema.parse({ ...history, items, nextBeforeId: 42 }).items).toHaveLength(20);
    expect(ProfitAnalysisWorkflowHistoryResultSchema.safeParse({ ...history, items: [...items, { ...success, operationId: otherId }] }).success).toBe(false);
    expect(ProfitAnalysisWorkflowHistoryResultSchema.safeParse({ ...history, items: [success, clone(success)] }).success).toBe(false);
    expect(ProfitAnalysisWorkflowHistoryResultSchema.safeParse({ ...history, items: [], nextBeforeId: 42 }).success).toBe(false);
    expect(ProfitAnalysisWorkflowHistoryResultSchema.safeParse({ ...history, nextBeforeId: 0 }).success).toBe(false);
  });
  it("forbids response raw data, private context and extra request authority", () => {
    for (const [schema, value] of [[ProfitAnalysisWorkflowViewResultSchema, view], [ProfitAnalysisWorkflowHistoryResultSchema, history]] as const) {
      for (const patch of [{ rows: [] }, { raw: {} }, { snapshot: {} }, { configuration: { prompt: "PRIVATE" } }, { executionPin: {} }]) expect(schema.safeParse({ ...value, ...patch }).success).toBe(false);
      expect(schema.safeParse({ ...value, request: { ...request, userId: 99 } }).success).toBe(false);
    }
  });
});

describe("generation capability and metadata-only receipts", () => {
  const enabled = { available: true, reasonCode: null, modelRequired: true, configuration: { revision: 3, hash: sourceHash } };
  it("requires a ready source and explicit configuration for an available model run", () => {
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, generation: enabled }).success).toBe(true);
    for (const sourceStatus of ["blocked", "unavailable"]) expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, sourceStatus, generation: enabled }).success).toBe(false);
    expect(ProfitAnalysisGenerationCapabilitySchema.safeParse({ ...enabled, configuration: null }).success).toBe(false);
    expect(ProfitAnalysisGenerationCapabilitySchema.safeParse({ ...enabled, modelRequired: null }).success).toBe(false);
    expect(ProfitAnalysisGenerationCapabilitySchema.safeParse({ ...enabled, reasonCode: "NOT_ENABLED" }).success).toBe(false);
  });
  it("allows a source-ready deterministic result without borrowing a model or manifest", () => {
    expect(ProfitAnalysisWorkflowViewResultSchema.safeParse({ ...view, generation: { ...enabled, modelRequired: false, configuration: null } }).success).toBe(true);
    expect(ProfitAnalysisGenerationCapabilitySchema.safeParse({ ...enabled, configuration: { ...enabled.configuration, prompt: "PRIVATE" } }).success).toBe(false);
  });
  it("binds a committed save UUID and retains independent run/result/source hashes", () => {
    expect(ProfitAnalysisWorkflowSaveResultSchema.parse(save)).toEqual(save);
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: { ...save.receipt, saveId: otherId } }).success).toBe(false);
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: { ...save.receipt, operationId: saveOperationId } }).success).toBe(false);
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: { ...save.receipt, reportVersion: 0 } }).success).toBe(false);
  });
  it("does not invent a commit receipt for absent or canceled saves", () => {
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: null }).success).toBe(false);
    for (const status of ["absent", "canceled"]) {
      expect(ProfitAnalysisWorkflowSaveResultSchema.parse({ ...save, status, receipt: null }).receipt).toBeNull();
      expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, status }).success).toBe(false);
    }
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: { ...save.receipt, result: success.result } }).success).toBe(false);
  });
  it("returns cancellation metadata only and does not promise that an already-finished run was canceled", () => {
    expect(ProfitAnalysisWorkflowCancelResultSchema.parse(cancellation)).toEqual(cancellation);
    expect(ProfitAnalysisWorkflowCancelResultSchema.parse({ ...cancellation, state: "succeeded", errorCode: null }).state).toBe("succeeded");
    expect(ProfitAnalysisWorkflowCancelResultSchema.safeParse({ ...cancellation, operationId: otherId }).success).toBe(false);
    for (const patch of [{ sourceHash }, { draft: success }, { saved: success }, { result: success.result }, { currentSource: {} }]) expect(ProfitAnalysisWorkflowCancelResultSchema.safeParse({ ...cancellation, ...patch }).success).toBe(false);
  });
  it("rejects invalid versions, private identities and noncanonical UUIDs at all output boundaries", () => {
    for (const [schema, value] of [[ProfitAnalysisWorkflowViewResultSchema, view], [ProfitAnalysisWorkflowHistoryResultSchema, history], [ProfitAnalysisWorkflowSaveResultSchema, save], [ProfitAnalysisWorkflowCancelResultSchema, cancellation]] as const) {
      expect(schema.safeParse({ ...value, version: 2 }).success).toBe(false);
      expect(schema.safeParse({ ...value, identity: { ...identity, userId: 0 } }).success).toBe(false);
      expect(schema.safeParse({ ...value, identity: { ...identity, email: "PRIVATE" } }).success).toBe(false);
    }
    expect(ProfitAnalysisPublicRunSchema.safeParse({ ...success, operationId: operationId.toUpperCase() }).success).toBe(false);
    expect(ProfitAnalysisWorkflowCancelResultSchema.safeParse({ ...cancellation, operationId: operationId.toUpperCase() }).success).toBe(false);
    expect(ProfitAnalysisWorkflowSaveResultSchema.safeParse({ ...save, receipt: { ...save.receipt, saveId: saveOperationId.toUpperCase() } }).success).toBe(false);
  });
});
