import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), listMetadata: vi.fn(), get: vi.fn(), options: vi.fn(), history: vi.fn(), getVersion: vi.fn(), save: vi.fn(), rollback: vi.fn() }));
vi.mock("./services/securityGovernance", async original => ({
  ...await original<typeof import("./services/securityGovernance")>(), assertResourceAction: mocks.authorize,
}));
vi.mock("./domains/ai_os/services/assistantConfigurations", () => ({ assistantConfigurationService: mocks }));
import { assistantConfigurationsRouter } from "./domains/ai_os/routers/assistantConfigurations";
import { TRPCError } from "@trpc/server";

function context(role: string | null = "admin", workspaceId: number | null | undefined = 7): TrpcContext {
  return { user: role === null ? null : { id: 19, role, defaultWorkspaceId: 7 } as TrpcContext["user"], workspaceId, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], requestId: "synthetic-config-request" };
}
const config = { name: "Synthetic", description: "", enabled: true, modelSlug: "", instructions: "private", rules: [], skills: [] };
const scope = { expectedWorkspaceId: 7 };
beforeEach(() => { for (const fn of Object.values(mocks)) fn.mockReset(); mocks.authorize.mockResolvedValue(undefined); });

describe("assistant configurations: real tRPC authentication and explicit authorization", () => {
  it("metadata uses agent.read with context workspace, never owner shortcut", async () => {
    mocks.listMetadata.mockResolvedValue({ items: [] });
    await expect(assistantConfigurationsRouter.createCaller(context("readonly")).listMetadata(scope)).resolves.toEqual({ items: [] });
    expect(mocks.authorize).toHaveBeenCalledWith({ actor: { id: 19, role: "readonly", defaultWorkspaceId: 7 }, resource: "agent", action: "read", workspaceId: 7, resourceId: undefined }, expect.objectContaining({ requestId: "synthetic-config-request" }));
    expect(mocks.listMetadata).toHaveBeenCalledWith(7);
    expect(mocks.authorize).toHaveBeenCalledTimes(8);
    expect(mocks.authorize.mock.calls.slice(1).map(([input]) => input.resourceId)).toEqual(["tagger", "listing", "images", "knowledge", "development", "video", "finance"]);
  });
  it("one per-key read denial rejects the whole directory before any configuration repository read", async () => {
    mocks.authorize.mockImplementation(async input => {
      if (input.resourceId === "listing") throw new TRPCError({ code: "FORBIDDEN", message: "synthetic per-agent denial" });
    });
    await expect(assistantConfigurationsRouter.createCaller(context()).listMetadata(scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listMetadata).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("anonymous metadata cannot reach service or authorization", async () => {
    await expect(assistantConfigurationsRouter.createCaller(context(null)).listMetadata(scope)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.listMetadata).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  const sensitive = [
    ["get", { ...scope, agentKey: "listing" }], ["options", scope], ["history", { ...scope, agentKey: "listing" }],
    ["getVersion", { ...scope, agentKey: "listing", revision: 1 }],
    ["save", { ...scope, agentKey: "listing", expectedRevision: 0, config }],
    ["rollback", { ...scope, agentKey: "listing", expectedRevision: 2, targetRevision: 1 }],
  ] as const;
  const allProcedures = [["listMetadata", scope], ...sensitive] as const;
  it.each(allProcedures)("%s refuses stale workspace before permission/service/repository I/O", async (method, input) => {
    const call = assistantConfigurationsRouter.createCaller(context("admin", 11))[method] as (value: unknown) => Promise<unknown>;
    await expect(call({ ...input, expectedWorkspaceId: 10 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ASSISTANT_WORKSPACE_CHANGED" });
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(allProcedures)("%s requires the workspace precondition rather than guessing it", async (method, input) => {
    const { expectedWorkspaceId: _expected, ...missing } = input;
    const call = assistantConfigurationsRouter.createCaller(context())[method] as (value: unknown) => Promise<unknown>;
    await expect(call(missing)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(sensitive)("non-admin cannot access %s even if resource permission would allow", async (method, input) => {
    const caller = assistantConfigurationsRouter.createCaller(context("ops_manager"));
    // The table intentionally covers procedure signatures with different inputs.
    const call = caller[method] as (value: unknown) => Promise<unknown>;
    await expect(call(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks[method]).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each(sensitive)("admin %s still requires agent.update before service", async (method, input) => {
    mocks.authorize.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "denied synthetic permission" }));
    const call = assistantConfigurationsRouter.createCaller(context())[method] as (value: unknown) => Promise<unknown>;
    await expect(call(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "agent", action: "update", workspaceId: 7 }), expect.anything());
    expect(mocks[method]).not.toHaveBeenCalled();
  });
  it("authenticated default-workspace context is accepted, but no null/global scope", async () => {
    const defaultContext = context(); defaultContext.workspaceId = undefined;
    await assistantConfigurationsRouter.createCaller(defaultContext).get({ ...scope, agentKey: "listing" });
    expect(mocks.get).toHaveBeenCalledWith(7, "listing"); mocks.get.mockClear();
    const ctx = context(); ctx.workspaceId = null; ctx.user!.defaultWorkspaceId = null;
    await expect(assistantConfigurationsRouter.createCaller(ctx).get({ ...scope, agentKey: "listing" })).rejects.toMatchObject({ message: "ASSISTANT_WORKSPACE_REQUIRED" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN])("invalid context workspace %s cannot reach metadata", async workspaceId => {
    await expect(assistantConfigurationsRouter.createCaller(context("admin", workspaceId)).listMetadata(scope)).rejects.toMatchObject({ message: "ASSISTANT_WORKSPACE_REQUIRED" });
    expect(mocks.listMetadata).not.toHaveBeenCalled();
  });
  it("save is exactly scoped to authenticated workspace and actor, with no execution side effects", async () => {
    mocks.save.mockResolvedValue({ revision: 1 });
    await expect(assistantConfigurationsRouter.createCaller(context()).save({ ...scope, agentKey: "listing", expectedRevision: 0, config })).resolves.toEqual({ revision: 1 });
    expect(mocks.save).toHaveBeenCalledWith(7, 19, { agentKey: "listing", expectedRevision: 0, config });
  });
  it("rejects input scope override and invalid revision before service", async () => {
    const caller = assistantConfigurationsRouter.createCaller(context());
    await expect(caller.get({ ...scope, agentKey: "listing", workspaceId: 8 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.save({ ...scope, agentKey: "listing", expectedRevision: -1, config })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.save({ ...scope, agentKey: "listing", expectedRevision: 0, config: { ...config, skills: [{ slug: "s", enabled: true, trigger: "", instructions: "" }] } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("history default is bounded and saved schema-unavailable failure stays explicit", async () => {
    mocks.history.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_SCHEMA_UNAVAILABLE" }));
    await expect(assistantConfigurationsRouter.createCaller(context()).history({ ...scope, agentKey: "listing" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
    expect(mocks.history).toHaveBeenCalledWith(7, { agentKey: "listing", limit: 10 });
  });
});
