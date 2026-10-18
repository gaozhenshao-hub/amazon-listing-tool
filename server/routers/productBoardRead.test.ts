import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
// Focused wrapper for shared pure contract tests excluded by root include.
import "../../shared/productBoardRead.test";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../domains/ops/productBoardReadRepository", () => ({ productBoardReadRepository: mock }));
import { productBoardReadRouter } from "./productBoardRead";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, month: "2026-09", storeName: "Exact Store", country: "US", search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 10 };
beforeEach(() => { vi.clearAllMocks(); mock.get.mockResolvedValue({ status: "ready" }); });
describe("productBoardRead protected single source-backed query", () => {
  it("has only get query and forwards exact scope", async () => {
    expect(Object.keys(productBoardReadRouter._def.procedures)).toEqual(["get"]); expect(productBoardReadRouter._def.procedures.get._def.type).toBe("query");
    expect(await productBoardReadRouter.createCaller(ctx).get(input)).toEqual({ status: "ready" }); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
  it("rejects no-login callers before repository", async () => { await expect(productBoardReadRouter.createCaller({ ...ctx, user: null }).get(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock.get).not.toHaveBeenCalled(); });
  it("forwards a numeric operator as a filter without changing the authenticated actor", async () => {
    await productBoardReadRouter.createCaller(ctx).get({ ...input, operatorId: 4 });
    expect(mock.get).toHaveBeenCalledWith(ctx, { ...input, operatorId: 4 });
  });
  it.each([{ operatorId: "3" }, { operatorId: 0 }, { operatorId: 1.5 }, { operatorId: 2147483648 }, { ownerIds: [3] }, { role: "admin" }, { refresh: true }, { editionId: 1 }, { note: "write" }, { payload: [] }, { sourceIds: [1] }, { batchId: 1 }, { userId: 3 }])("rejects caller authority/writes %j", async patch => {
    await expect(productBoardReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: null }, { month: "2026-13" }, { storeName: "" }, { country: "" }, { parentAsin: "" }, { search: "x".repeat(201) }, { allOffset: -1 }, { highReturnsOffset: -1 }, { highProfitOffset: -1 }, { losingOffset: -1 }, { pageSize: 0 }, { pageSize: 21 }])("rejects malformed calendar/scope/page %j", async patch => {
    await expect(productBoardReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it("allows no parent filter and canonicalizes country without authorizing any operator", async () => {
    await productBoardReadRouter.createCaller(ctx).get({ ...input, country: "美国站" }); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
});
