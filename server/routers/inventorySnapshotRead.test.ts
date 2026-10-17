import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
// Focused entry for shared pure tests, omitted by the global shared/ include.
import "../../shared/inventorySnapshotRead.test";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../domains/ops/inventorySnapshotReadRepository", () => ({ inventorySnapshotReadRepository: mock }));
import { inventorySnapshotReadRouter } from "./inventorySnapshotRead";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, search: "", unpaired: false, ageThreshold: 180 as const, groupOffset: 0, groupLimit: 10, agedGroupOffset: 0, agedGroupLimit: 10 };
beforeEach(() => { vi.clearAllMocks(); mock.get.mockResolvedValue({ status: "ready" }); });
describe("inventorySnapshotRead protected get", () => {
  it("only registers a read query and forwards exact input", async () => {
    expect(Object.keys(inventorySnapshotReadRouter._def.procedures)).toEqual(["get"]); expect(inventorySnapshotReadRouter._def.procedures.get._def.type).toBe("query");
    expect(await inventorySnapshotReadRouter.createCaller(ctx).get(input)).toEqual({ status: "ready" }); expect(mock.get).toHaveBeenCalledWith(ctx, input);
  });
  it("rejects no-login callers before repository", async () => {
    await expect(inventorySnapshotReadRouter.createCaller({ ...ctx, user: null }).get(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ userId: 3 }, { ownerIds: [3] }, { operatorId: 3 }, { role: "admin" }, { payload: {} }, { refresh: true }, { runId: 12 }, { capturedAt: 1 }, { rowOffset: 0 }])("rejects client authority/mutation extras %j", async patch => {
    await expect(inventorySnapshotReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: null }, { expectedWorkspaceId: 0 }, { expectedWorkspaceId: "7" }, { groupOffset: -1 }, { groupLimit: 0 }, { groupLimit: 51 }, { agedGroupOffset: -1 }, { agedGroupLimit: 51 }, { ageThreshold: 270 }, { unpaired: "true" }, { exactScope: {} }, { exactScope: { parentAsin: "B000000001", storeName: "Exact", country: "US" } }])("rejects incomplete scope or pagination %j", async patch => {
    await expect(inventorySnapshotReadRouter.createCaller(ctx).get({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.get).not.toHaveBeenCalled();
  });
  it("forwards explicit scope with canonical marketplace but exact account and store", async () => {
    const exactScope = { parentAsin: "B000000001", storeName: "Exact", country: "美国站", accountId: "account-1" };
    await inventorySnapshotReadRouter.createCaller(ctx).get({ ...input, exactScope }); expect(mock.get).toHaveBeenCalledWith(ctx, { ...input, exactScope: { ...exactScope, country: "US" } });
  });
});
