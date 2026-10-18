import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import "../../shared/inventorySnapshotRefresh.test";
const mock = vi.hoisted(() => ({ options: vi.fn(), refresh: vi.fn(), readRun: vi.fn(), recover: vi.fn() }));
vi.mock("../domains/ops/inventoryCollectionRepository", () => ({ inventoryCollectionRepository: mock }));
import { inventorySnapshotRefreshRouter } from "./inventorySnapshotRefresh";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const operationId = "11111111-1111-4111-8111-111111111111";
const input = { expectedWorkspaceId: 7, operationId, expectedSnapshotKey: "a".repeat(64), expectedConnectionVersion: "b".repeat(64), expectedMappingVersion: "c".repeat(64) };
const commands = { options: { expectedWorkspaceId: 7 }, refresh: input, readRun: { expectedWorkspaceId: 7, operationId }, recover: { expectedWorkspaceId: 7, operationId, decision: "check" as const } };
beforeEach(() => { vi.clearAllMocks(); Object.values(mock).forEach(fn => fn.mockResolvedValue({ outcome: "unknown" })); });
describe("inventorySnapshotRefresh protected methods", () => {
  it("exposes only options/refresh/readRun/recover, no caller-save or scheduler", async () => { expect(Object.keys(inventorySnapshotRefreshRouter._def.procedures)).toEqual(Object.keys(commands)); for (const [key, proc] of Object.entries(inventorySnapshotRefreshRouter._def.procedures)) expect(proc._def.type).toBe(["options", "readRun"].includes(key) ? "query" : "mutation"); await inventorySnapshotRefreshRouter.createCaller(ctx).refresh(input); expect(mock.refresh).toHaveBeenCalledWith(ctx, input); });
  it.each(Object.keys(commands) as (keyof typeof commands)[])("rejects anonymous %s before repo", async key => { const caller = inventorySnapshotRefreshRouter.createCaller({ ...ctx, user: null }); await expect((caller[key] as (arg: unknown) => Promise<unknown>)(commands[key])).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock[key]).not.toHaveBeenCalled(); });
  it.each([{ userId: 4 }, { role: "admin" }, { payload: {} }, { proof: {} }, { source: "manual_collection" }, { force: true }, { expectedWorkspaceId: 0 }])("rejects caller authority/collection injection %j", async patch => { await expect(inventorySnapshotRefreshRouter.createCaller(ctx).refresh({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.refresh).not.toHaveBeenCalled(); });
  it.each(["check", "cancel"] as const)("forwards explicit recovery %s without retrying refresh", async decision => { await inventorySnapshotRefreshRouter.createCaller(ctx).recover({ ...commands.recover, decision }); expect(mock.recover).toHaveBeenCalledWith(ctx, { ...commands.recover, decision }); expect(mock.refresh).not.toHaveBeenCalled(); });
});
