import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mock = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn(), recover: vi.fn() }));
vi.mock("../domains/ops/inventoryGovernanceWriteRepository", () => ({ inventoryGovernanceWriteRepository: mock }));
import { inventoryGovernanceWriteRouter } from "./inventoryGovernanceWrite";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const read = { expectedWorkspaceId: 7, subject: { kind: "owners" as const } }, target = { parentAsin: "b000000001", storeName: "Store", country: "美国" };
const execute = { ...read, operationId: "11111111-1111-4111-8111-111111111111", expectedSnapshotKey: "a".repeat(64), action: "assign" as const, targets: [target], assigneeUserId: 9, reason: null };
const commands = { read, execute, recover: { ...read, operationId: execute.operationId, decision: "check" as const } };
beforeEach(() => { vi.clearAllMocks(); Object.values(mock).forEach(fn => fn.mockResolvedValue({ status: "unknown" })); });
describe("inventoryGovernanceWrite protected boundary", () => {
  it("exposes read query and only explicit execute/recover mutations", async () => { expect(Object.keys(inventoryGovernanceWriteRouter._def.procedures)).toEqual(Object.keys(commands)); for (const [key, proc] of Object.entries(inventoryGovernanceWriteRouter._def.procedures)) expect(proc._def.type).toBe(key === "read" ? "query" : "mutation"); await inventoryGovernanceWriteRouter.createCaller(ctx).execute(execute); expect(mock.execute).toHaveBeenCalledWith(ctx, execute); });
  it.each(Object.keys(commands) as (keyof typeof commands)[])("rejects anonymous %s", async key => { const caller = inventoryGovernanceWriteRouter.createCaller({ ...ctx, user: null }); await expect((caller[key] as (arg: unknown) => Promise<unknown>)(commands[key])).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock[key]).not.toHaveBeenCalled(); });
  it.each([{ userId: 4 }, { ownerUserId: 4 }, { force: true }, { role: "admin" }, { source: {} }, { expectedWorkspaceId: 0 }, { expectedSnapshotKey: "wrong" }, { assigneeUserId: "9" }, { targets: [] }, { targets: [target, target] }])("rejects injected authority or invalid payload %j", async patch => { await expect(inventoryGovernanceWriteRouter.createCaller(ctx).execute({ ...execute, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.execute).not.toHaveBeenCalled(); });
  it.each(["check", "cancel"] as const)("forwards original UUID %s without execute", async decision => { await inventoryGovernanceWriteRouter.createCaller(ctx).recover({ ...commands.recover, decision }); expect(mock.recover).toHaveBeenCalledWith(ctx, { ...commands.recover, decision }); expect(mock.execute).not.toHaveBeenCalled(); });
});
