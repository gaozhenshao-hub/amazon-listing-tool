import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import "../../shared/profitAnalysis.test";

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../domains/ops/profitAnalysisSnapshotRepository", () => ({ profitAnalysisSnapshotRepository: mock }));
import { profitAnalysisRouter } from "./profitAnalysis";

const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, month: "2026-09", scope: {
  storeName: "Exact Store", country: "US", parentAsin: "B0TEST0001", currency: "USD", basis: "child_rows" as const,
} };
beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFIT_ANALYSIS_SOURCE_UNAVAILABLE" }));
});
describe("profit analysis read-only preparation router", () => {
  it("exposes only a protected preview query, without generation, save or scheduler routes", () => {
    expect(Object.keys(profitAnalysisRouter._def.procedures)).toEqual(["preview"]);
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
