import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const dependencies = vi.hoisted(() => ({ database: vi.fn(), transaction: vi.fn(), audit: vi.fn(), permission: vi.fn() }));
vi.mock("../repositories/dbClient", () => ({ getDb: dependencies.database, withDbTransaction: dependencies.transaction }));
vi.mock("../services/securityGovernance", () => ({
  assertResourceAction: dependencies.permission,
  recordSecurityAuditLog: dependencies.audit,
  workspaceIdFromContext: (ctx: TrpcContext) => ctx.workspaceId ?? ctx.user?.defaultWorkspaceId,
  actorFromContext: (ctx: TrpcContext) => ctx.user,
}));
import { inventoryOwnerAssignmentsRouter } from "./inventoryOwnerAssignments";

const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const inputs = {
  assignBatch: { assigneeUserId: 4, targets: [{ parentAsin: "B000000001", storeName: "Store", country: "美国" }] },
  revoke: { id: 9, reason: "人工撤销" },
};
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.permission.mockResolvedValue(undefined);
  dependencies.audit.mockResolvedValue(undefined);
  dependencies.database.mockRejectedValue(new Error("LEGACY_DATABASE_REACHED"));
  dependencies.transaction.mockRejectedValue(new Error("LEGACY_TRANSACTION_REACHED"));
});
afterEach(() => vi.unstubAllEnvs());

describe("legacy owner writers cannot bypass governed shared-state writes", () => {
  it.each(["listEligibleUsers", "listRules"] as const)("cuts off legacy %s so old candidate scope and extra fields cannot remain in use", async name => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", "true");
    await expect(inventoryOwnerAssignmentsRouter.createCaller(ctx)[name]()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dependencies.database).not.toHaveBeenCalled();
    expect(dependencies.transaction).not.toHaveBeenCalled();
  });
  it.each(["assignBatch", "revoke"] as const)("cuts off %s before business reads or writes", async name => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", "true");
    const caller = inventoryOwnerAssignmentsRouter.createCaller(ctx);
    await expect((caller[name] as (input: unknown) => Promise<unknown>)(inputs[name])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dependencies.permission).toHaveBeenCalled();
    expect(dependencies.database).not.toHaveBeenCalled();
    expect(dependencies.transaction).not.toHaveBeenCalled();
  });
  it.each([undefined, "false", "TRUE", "1", ""])("does not implicitly activate with %s", async flag => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", flag);
    await expect(inventoryOwnerAssignmentsRouter.createCaller(ctx).revoke(inputs.revoke)).rejects.toThrow("LEGACY_TRANSACTION_REACHED");
    expect(dependencies.transaction).toHaveBeenCalledOnce();
  });
  it("continues to reject non-manager legacy writes while disabled", async () => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", "false");
    const caller = inventoryOwnerAssignmentsRouter.createCaller({ ...ctx, user: { ...ctx.user!, role: "ops_specialist" } });
    await expect(caller.revoke(inputs.revoke)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dependencies.transaction).not.toHaveBeenCalled();
  });
  it("does not grant anonymous access through the rollout switch", async () => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", "true");
    await expect(inventoryOwnerAssignmentsRouter.createCaller({ ...ctx, user: null }).revoke(inputs.revoke)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dependencies.permission).not.toHaveBeenCalled();
    expect(dependencies.transaction).not.toHaveBeenCalled();
  });
});
