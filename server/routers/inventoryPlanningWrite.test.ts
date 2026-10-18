import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mock = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn(), recover: vi.fn() }));
vi.mock("../domains/ops/inventoryPlanningWriteRepository", () => ({ inventoryPlanningWriteRepository: mock }));
import { inventoryPlanningWriteRouter } from "./inventoryPlanningWrite";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const read = { expectedWorkspaceId: 7, scope: { scopeType: "asin" as const, asin: "B000000001", storeName: "Store", country: "美国" }, asOfDate: "2026-10-18", marketplace: "US" };
const execute = { ...read, operationId: "11111111-1111-4111-8111-111111111111", expectedSnapshotKey: "a".repeat(64), action: "saveParameters" as const, patch: { productionDays: 45 } };
const commands = { read, execute, recover: { ...read, operationId: execute.operationId, decision: "check" as const } };
beforeEach(() => { vi.clearAllMocks(); Object.values(mock).forEach(fn => fn.mockResolvedValue({ status: "unknown" })); });
describe("inventoryPlanningWrite protected boundary", () => {
  it("exposes only one read and two explicit mutations", async () => { expect(Object.keys(inventoryPlanningWriteRouter._def.procedures)).toEqual(Object.keys(commands)); for (const [key, proc] of Object.entries(inventoryPlanningWriteRouter._def.procedures)) expect(proc._def.type).toBe(key === "read" ? "query" : "mutation"); await inventoryPlanningWriteRouter.createCaller(ctx).execute(execute); expect(mock.execute).toHaveBeenCalledWith(ctx, execute); });
  it.each(Object.keys(commands) as (keyof typeof commands)[])("rejects anonymous %s", async key => { const caller = inventoryPlanningWriteRouter.createCaller({ ...ctx, user: null }); await expect((caller[key] as (arg: unknown) => Promise<unknown>)(commands[key])).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock[key]).not.toHaveBeenCalled(); });
  it.each([{ userId: 4 }, { ownerUserId: 4 }, { force: true }, { role: "admin" }, { source: {} }, { expectedWorkspaceId: 0 }, { expectedSnapshotKey: "wrong" }, { patch: {} }, { patch: { productCost: -1 } }])("rejects authority or unsafe patch %j", async patch => { await expect(inventoryPlanningWriteRouter.createCaller(ctx).execute({ ...execute, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.execute).not.toHaveBeenCalled(); });
  it.each(["check", "cancel"] as const)("forwards %s without re-executing business mutation", async decision => { await inventoryPlanningWriteRouter.createCaller(ctx).recover({ ...commands.recover, decision }); expect(mock.recover).toHaveBeenCalledWith(ctx, { ...commands.recover, decision }); expect(mock.execute).not.toHaveBeenCalled(); });
});
