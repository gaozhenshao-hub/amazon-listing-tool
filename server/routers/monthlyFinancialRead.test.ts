import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
// Focused entry for the pure shared tests (the global include omits shared/).
import "../../shared/monthlyFinancialRead.test";
const mock = vi.hoisted(() => ({ listBatches: vi.fn(), getBatch: vi.fn(), getEffectiveSnapshot: vi.fn() }));
vi.mock("../domains/ops/monthlyFinancialReadRepository", () => ({ monthlyFinancialReadRepository: mock }));
import { monthlyFinancialReadRouter } from "./monthlyFinancialRead";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const inputs = {
  listBatches: { expectedWorkspaceId: 7, cursor: null, limit: 20 },
  getBatch: { expectedWorkspaceId: 7, batchId: 11, rowOffset: 0, pageSize: 50 },
  getEffectiveSnapshot: { expectedWorkspaceId: 7, yearMonth: "2026-09", storeName: "Exact", country: "US", rowOffset: 0, pageSize: 50 },
};
beforeEach(() => { vi.clearAllMocks(); for (const fn of Object.values(mock)) fn.mockResolvedValue({ status: "ready" }); });
describe("dedicated monthlyFinancialRead queries", () => {
  it("registers only three protected queries, with no mutations or download endpoints", () => {
    expect(Object.keys(monthlyFinancialReadRouter._def.procedures)).toEqual(Object.keys(inputs));
    for (const procedure of Object.values(monthlyFinancialReadRouter._def.procedures)) expect(procedure._def.type).toBe("query");
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)("%s forwards exact parsed read input only", async method => {
    await expect(monthlyFinancialReadRouter.createCaller(ctx)[method](inputs[method] as never)).resolves.toEqual({ status: "ready" });
    expect(mock[method]).toHaveBeenCalledWith(ctx, inputs[method]);
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)("%s rejects unauthenticated caller before repository", async method => {
    await expect(monthlyFinancialReadRouter.createCaller({ ...ctx, user: null })[method](inputs[method] as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mock[method]).not.toHaveBeenCalled();
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)("%s forbids client actor/role/payload controls", async method => {
    for (const extra of [{ userId: 99 }, { role: "admin" }, { payload: [] }, { ownerId: 3 }, { confirmedAt: "now" }, { fileUrl: "https://secret" }]) {
      await expect(monthlyFinancialReadRouter.createCaller(ctx)[method]({ ...inputs[method], ...extra } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(mock[method]).not.toHaveBeenCalled();
  });
  it.each([{}, { cursor: 0 }, { limit: 51 }, { limit: 0 }, { cursor: "4" }, { expectedWorkspaceId: null }, { expectedWorkspaceId: 0 }])("rejects invalid history pagination/identity %j", async patch => {
    const input = Object.keys(patch).length ? { ...inputs.listBatches, ...patch } : {};
    await expect(monthlyFinancialReadRouter.createCaller(ctx).listBatches(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.listBatches).not.toHaveBeenCalled();
  });
  it.each([{ batchId: 0 }, { rowOffset: -1 }, { pageSize: 101 }, { scope: {} }, { scope: { yearMonth: "2026-09", parentAsin: "", country: "US", storeName: "Exact" } }])("rejects invalid batch detail controls %j", async patch => {
    await expect(monthlyFinancialReadRouter.createCaller(ctx).getBatch({ ...inputs.getBatch, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.getBatch).not.toHaveBeenCalled();
  });
  it.each([{ yearMonth: "2026-13" }, { storeName: "" }, { country: "" }, { parentAsin: "" }, { rowOffset: 10001 }, { pageSize: 0 }])("rejects invalid snapshot controls %j", async patch => {
    await expect(monthlyFinancialReadRouter.createCaller(ctx).getEffectiveSnapshot({ ...inputs.getEffectiveSnapshot, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.getEffectiveSnapshot).not.toHaveBeenCalled();
  });
  it("canonicalizes marketplace labels and forwards exact scope without normalization of store identity", async () => {
    await monthlyFinancialReadRouter.createCaller(ctx).getEffectiveSnapshot({ ...inputs.getEffectiveSnapshot, country: "美国站" });
    expect(mock.getEffectiveSnapshot).toHaveBeenCalledWith(ctx, inputs.getEffectiveSnapshot);
  });
});
