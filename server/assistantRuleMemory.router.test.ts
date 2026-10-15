import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { AGENT_LIBRARY_KEYS } from "../shared/agentLibraryContracts";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getRules: vi.fn(), saveRules: vi.fn(), restoreRules: vi.fn() }));
vi.mock("./services/securityGovernance", async original => ({
  ...await original<typeof import("./services/securityGovernance")>(), assertResourceAction: mocks.authorize,
}));
vi.mock("./domains/ai_os/services/assistantConfigurations", () => ({ assistantConfigurationService: mocks }));
import { assistantConfigurationsRouter } from "./domains/ai_os/routers/assistantConfigurations";

function context(role: string | null = "admin", workspaceId: number | null | undefined = 7): TrpcContext {
  return { user: role === null ? null : { id: 19, role, defaultWorkspaceId: 7 } as TrpcContext["user"], workspaceId, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], requestId: "synthetic-rules-request" };
}
const scope = { expectedWorkspaceId: 7, agentKey: "listing" } as const;
const procedures = [
  ["getRules", scope], ["saveRules", { ...scope, expectedRevision: 1, rules: ["one\ntwo"] }],
  ["restoreRules", { ...scope, expectedRevision: 2, targetRevision: 1 }],
] as const;
const output = { status: "configured", agentKey: "listing", revision: 3, rules: ["one\ntwo"], updatedAt: "2026-10-15T00:00:00.000Z" } as const;
beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.authorize.mockResolvedValue(undefined);
  for (const [method] of procedures) mocks[method].mockResolvedValue(output);
});

describe("rules-only APIs: real tRPC input, authentication and workspace policy", () => {
  it.each(procedures)("%s requires authenticated admin AND agent.update", async (method, input) => {
    for (const role of [null, "readonly", "ops_specialist", "designer"]) {
      const call = assistantConfigurationsRouter.createCaller(context(role))[method] as (value: unknown) => Promise<unknown>;
      // Existing adminProcedure returns FORBIDDEN for both anonymous and
      // non-admin callers; this facade must not invent a new error contract.
      await expect(call(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks[method]).not.toHaveBeenCalled();
    mocks.authorize.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "policy denied" }));
    for (const role of ["admin", "super_admin"]) {
      const call = assistantConfigurationsRouter.createCaller(context(role))[method] as (value: unknown) => Promise<unknown>;
      await expect(call(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks[method]).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "agent", action: "update", resourceId: "listing", workspaceId: 7 }), expect.anything());
  });
  it.each(procedures)("%s rejects workspace drift before policy or service", async (method, input) => {
    const call = assistantConfigurationsRouter.createCaller(context("admin", 11))[method] as (value: unknown) => Promise<unknown>;
    await expect(call({ ...input, expectedWorkspaceId: 10 })).rejects.toMatchObject({ message: "ASSISTANT_WORKSPACE_CHANGED" });
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(procedures)("%s requires a strict, non-guessed workspace precondition", async (method, input) => {
    const { expectedWorkspaceId: _ignored, ...missing } = input;
    const call = assistantConfigurationsRouter.createCaller(context())[method] as (value: unknown) => Promise<unknown>;
    for (const request of [missing, { ...input, expectedWorkspaceId: "7" }, { ...input, expectedWorkspaceId: 0 }, { ...input, workspaceId: 7 }, { ...input, proposalId: 1 }, { ...input, state: "enabled" }]) {
      await expect(call(request)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(procedures)("%s scopes from context and sends only the minimal request to the service", async (method, input) => {
    const call = assistantConfigurationsRouter.createCaller(context("super_admin"))[method] as (value: unknown) => Promise<unknown>;
    await expect(call(input)).resolves.toEqual(output);
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "agent", action: "update", workspaceId: 7, resourceId: "listing" }), expect.anything());
    const { expectedWorkspaceId: _ignored, ...request } = input;
    expect(mocks[method]).toHaveBeenCalledTimes(1);
    if (method === "getRules") expect(mocks[method]).toHaveBeenCalledWith(7, "listing");
    else expect(mocks[method]).toHaveBeenCalledWith(7, 19, request);
  });
  it.each(AGENT_LIBRARY_KEYS)("all three APIs use the exact authorized role key %s", async agentKey => {
    const caller = assistantConfigurationsRouter.createCaller(context());
    await caller.getRules({ ...scope, agentKey });
    await caller.saveRules({ ...scope, agentKey, expectedRevision: 0, rules: [] });
    await caller.restoreRules({ ...scope, agentKey, expectedRevision: 2, targetRevision: 1 });
    expect(mocks.authorize.mock.calls.map(([input]) => input.resourceId)).toEqual([agentKey, agentKey, agentKey]);
    expect(mocks.getRules).toHaveBeenCalledWith(7, agentKey);
    expect(mocks.saveRules).toHaveBeenCalledWith(7, 19, { agentKey, expectedRevision: 0, rules: [] });
    expect(mocks.restoreRules).toHaveBeenCalledWith(7, 19, { agentKey, expectedRevision: 2, targetRevision: 1 });
  });
  it.each(procedures)("%s refuses absent/invalid authenticated workspace, not global scope", async (method, input) => {
    for (const id of [null, 0, -1, 1.5, NaN, 2_147_483_648]) {
      const ctx = context("admin", id); ctx.user!.defaultWorkspaceId = null;
      const call = assistantConfigurationsRouter.createCaller(ctx)[method] as (value: unknown) => Promise<unknown>;
      await expect(call(input)).rejects.toMatchObject({ message: "ASSISTANT_WORKSPACE_REQUIRED" });
    }
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it("authenticated default workspace is used only when supplied by the context", async () => {
    const ctx = context("admin");
    ctx.workspaceId = undefined;
    expect(ctx.workspaceId).toBeUndefined();
    expect(ctx.user!.defaultWorkspaceId).toBe(7);
    await assistantConfigurationsRouter.createCaller(ctx).getRules(scope);
    expect(mocks.getRules).toHaveBeenCalledWith(7, "listing");
  });
  it("read projects unconfigured status and does not invoke write APIs", async () => {
    mocks.getRules.mockResolvedValue({ status: "not-configured", agentKey: "listing" });
    expect(await assistantConfigurationsRouter.createCaller(context()).getRules(scope)).toEqual({ status: "not-configured", agentKey: "listing" });
    expect(mocks.saveRules).not.toHaveBeenCalled(); expect(mocks.restoreRules).not.toHaveBeenCalled();
  });
  it("save preserves multiline rule boundaries and an explicit empty clear", async () => {
    const caller = assistantConfigurationsRouter.createCaller(context());
    await caller.saveRules({ ...scope, expectedRevision: 1, rules: ["one\ntwo"] });
    await caller.saveRules({ ...scope, expectedRevision: 2, rules: [] });
    expect(mocks.saveRules.mock.calls.map(([, , input]) => input.rules)).toEqual([["one\ntwo"], []]);
  });
  it("invalid rules, role, revisions and extra configuration cannot reach policy/service", async () => {
    const caller = assistantConfigurationsRouter.createCaller(context());
    await expect(caller.getRules({ ...scope, agentKey: "unknown" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const patch of [{ rules: [""] }, { rules: ["r".repeat(501)] }, { rules: Array(31).fill("rule") }, { expectedRevision: -1 }, { modelSlug: "secret-model" }, { config: {} }, { targetRevision: 1 }]) {
      await expect(caller.saveRules({ ...scope, expectedRevision: 1, rules: [], ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(caller.restoreRules({ ...scope, expectedRevision: 1, targetRevision: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.restoreRules({ ...scope, expectedRevision: 1, targetRevision: 1, rules: [] } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(procedures)("%s preserves explicit schema/disabled/conflict failures without retry", async (method, input) => {
    const call = assistantConfigurationsRouter.createCaller(context())[method] as (value: unknown) => Promise<unknown>;
    for (const [code, message] of [["PRECONDITION_FAILED", "ASSISTANT_SCHEMA_UNAVAILABLE"], ["PRECONDITION_FAILED", "ASSISTANT_WRITES_DISABLED"], ["CONFLICT", "ASSISTANT_REVISION_CONFLICT"]] as const) {
      mocks[method].mockRejectedValue(new TRPCError({ code, message }));
      await expect(call(input)).rejects.toMatchObject({ code, message });
    }
    expect(mocks[method]).toHaveBeenCalledTimes(3);
  });
});
