import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
// Focused wrapper for shared pure contract tests excluded by root include.
import "../../shared/profitBoardRead.test";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../domains/ops/profitBoardReadRepository", () => ({ profitBoardReadRepository: mock }));
import { profitBoardReadRouter } from "./profitBoardRead";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, month: "2026-09", storeName: "Exact Store", country: "US", search: "", groupOffset: 0, groupLimit: 10 };
beforeEach(() => { vi.clearAllMocks(); mock.get.mockResolvedValue({ status: "ready" }); });
describe("profitBoardRead protected single source-backed query", () => {
  it("has only get query and forwards exact scope", async () => {
    expect(Object.keys(profitBoardReadRouter._def.procedures)).toEqual(["get"]); expect(profitBoardReadRouter._def.procedures.get._def.type).toBe("query");
    expect(await profitBoardReadRouter.createCaller(ctx).get(input)).toEqual({ status: "ready" }); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
  it("rejects no-login callers before repository", async () => { await expect(profitBoardReadRouter.createCaller({ ...ctx, user: null }).get(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock.get).not.toHaveBeenCalled(); });
  it("forwards a numeric operator as a filter without changing the authenticated actor", async () => {
    await profitBoardReadRouter.createCaller(ctx).get({ ...input, operatorId: 4 });
    expect(mock.get).toHaveBeenCalledWith(ctx, { ...input, operatorId: 4 });
  });
  it.each([{ operatorId: "3" }, { operatorId: 0 }, { operatorId: 1.5 }, { operatorId: 2147483648 }, { ownerIds: [3] }, { role: "admin" }, { refresh: true }, { editionId: 1 }, { note: "write" }, { payload: [] }, { sourceIds: [1] }, { batchId: 1 }, { userId: 3 }])("rejects caller authority/writes %j", async patch => {
    await expect(profitBoardReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: null }, { month: "2026-13" }, { month: "1000-05" }, { storeName: "" }, { country: "" }, { parentAsin: "" }, { search: "x".repeat(201) }, { groupOffset: -1 }, { groupLimit: 0 }, { groupLimit: 51 }])("rejects malformed calendar/scope/page %j", async patch => {
    await expect(profitBoardReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it("allows no parent filter and canonicalizes country without authorizing any operator", async () => {
    await profitBoardReadRouter.createCaller(ctx).get({ ...input, country: "美国站" }); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
});
