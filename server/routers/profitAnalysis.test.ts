import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import "../../shared/profitAnalysis.test";
import "../../shared/profitAnalysisWorkflow.test";
import "../../shared/profitAnalysisWorkflowRead.test";

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../domains/ops/profitAnalysisSnapshotRepository", () => ({ profitAnalysisSnapshotRepository: mock }));
const service = vi.hoisted(() => ({ options: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(), history: vi.fn(), save: vi.fn(), checkSave: vi.fn(), cancelSave: vi.fn() }));
vi.mock("../domains/ops/profitAnalysisService", () => ({ profitAnalysisService: service }));
import { profitAnalysisRouter } from "./profitAnalysis";

const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, month: "2026-09", scope: {
  storeName: "Exact Store", country: "US", parentAsin: "B0TEST0001", currency: "USD", basis: "child_rows" as const,
} };
beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFIT_ANALYSIS_SOURCE_UNAVAILABLE" }));
  for (const handler of Object.values(service)) handler.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFIT_ANALYSIS_EXECUTION_DISABLED" }));
});
describe("profit analysis read-only preparation router", () => {
  it("retains protected preview and adds only the dedicated durable workflow, never model or scheduler routes", () => {
    expect(Object.keys(profitAnalysisRouter._def.procedures)).toEqual(["preview", "options", "start", "check", "cancel", "history", "save", "checkSave", "cancelSave"]);
    expect(profitAnalysisRouter._def.procedures.preview._def.type).toBe("query");
  });
  it("forwards exact two-month source request to the authorized repository", async () => {
    await expect(profitAnalysisRouter.createCaller(ctx).preview(input)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_SOURCE_UNAVAILABLE" });
    expect(mock.get).toHaveBeenCalledOnce(); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
  it("requires login before any source access", async () => {
    await expect(profitAnalysisRouter.createCaller({ ...ctx, user: null }).preview(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { evidence: [] }, { sourceHash: "a".repeat(64) }, { batchId: 1 }, { userId: 3 },
    { ownerIds: [3] }, { modelSlug: "friend-model" }, { skillSlug: "finance.monthly.profit" }, { force: true }, { save: true }])("rejects caller facts, authority or execution options %j", async patch => {
    await expect(profitAnalysisRouter.createCaller(ctx).preview({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ operatorId: 3 }, { currency: "US" }, { basis: "unallocated_rows" }, { parentAsin: "" }, { storeName: "" }])("rejects malformed or caller-authorized scope %j", async patch => {
    await expect(profitAnalysisRouter.createCaller(ctx).preview({ ...input, scope: { ...input.scope, ...patch } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it.each(["2026-13", "2026-00", "1000-01", "not-a-month"])("rejects an unavailable prior-month calendar: %s", async month => {
    await expect(profitAnalysisRouter.createCaller(ctx).preview({ ...input, month })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("accepts unknown currency only for explicit blocked evidence, not automatic USD", async () => {
    const request = { ...input, scope: { ...input.scope, currency: null } };
    await expect(profitAnalysisRouter.createCaller(ctx).preview(request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.get).toHaveBeenCalledOnce(); expect(mock.get).toHaveBeenCalledWith(ctx, request);
  });
  it("refuses malformed repository output at the public boundary", async () => {
    mock.get.mockResolvedValue({ status: "ready", canGenerate: true, privateRaw: "PRIVATE_FINANCIAL_DATA" });
    await expect(profitAnalysisRouter.createCaller(ctx).preview(input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("private durable profit workflow router", () => {
  const operationId = "a0000000-0000-4000-8000-000000000001", saveOperationId = "a0000000-0000-4000-8000-000000000002";
  const requests = {
    options: input, start: { ...input, operationId, expectedReportVersion: 0, expectedSourceHash: "a".repeat(64), regenerateConfirmed: false },
    check: { ...input, operationId }, cancel: { ...input, operationId }, history: { ...input, limit: 10 },
    save: { ...input, saveOperationId, runOperationId: operationId, expectedReportVersion: 2, expectedResultHash: "b".repeat(64), expectedSourceHash: "a".repeat(64) },
    checkSave: { ...input, saveOperationId }, cancelSave: { ...input, saveOperationId },
  };
  const names = Object.keys(requests) as Array<keyof typeof requests>;
  it.each(names)("%s has strict query/mutation classification, login and exact forwarding", async method => {
    expect(profitAnalysisRouter._def.procedures[method]._def.type).toBe(["start", "cancel", "save", "cancelSave"].includes(method) ? "mutation" : "query");
    await expect(profitAnalysisRouter.createCaller({ ...ctx, user: null })[method](requests[method] as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(service[method]).not.toHaveBeenCalled();
    await expect(profitAnalysisRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_EXECUTION_DISABLED" });
    expect(service[method]).toHaveBeenCalledWith(ctx, requests[method]);
  });
  it.each(names)("%s refuses client authority/raw financial payload and malformed output", async method => {
    for (const patch of [{ userId: 99 }, { rows: [] }, { runtime: {} }, { modelSlug: "OTHER" }, { force: true }]) {
      await expect(profitAnalysisRouter.createCaller(ctx)[method]({ ...requests[method], ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(service[method]).not.toHaveBeenCalled();
    service[method].mockResolvedValue({ rawPrivateSnapshot: "SYNTHETIC_MUST_NOT_LEAK" });
    await expect(profitAnalysisRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
