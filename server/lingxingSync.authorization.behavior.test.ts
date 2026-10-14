import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

// Real tRPC, ops workspace middleware, policy evaluation and route resolvers.
// Only persistence / external-effect boundaries are mocked. This proves caller
// authorization, not persisted membership revocation, HTTP/session auth or all T24.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  rawExecute: vi.fn(), ensureAgentRunTrace: vi.fn(), registerUnifiedArtifact: vi.fn(),
  invokeEmperorTool: vi.fn(), createHeartbeatJob: vi.fn(), updateHeartbeatJob: vi.fn(),
  applyConfirmedAdMcpFacts: vi.fn(), fetch: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./domains/ai_os/routerContext", () => ({ rawExecute: mocks.rawExecute }));
vi.mock("./domains/ai_os/services/runLedger", () => ({ ensureAgentRunTrace: mocks.ensureAgentRunTrace }));
vi.mock("./domains/ai_os/services/artifactLifecycle", () => ({ registerUnifiedArtifact: mocks.registerUnifiedArtifact }));
vi.mock("./domains/ai_os/services/toolGateway/executors", () => ({ invokeEmperorTool: mocks.invokeEmperorTool }));
vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: mocks.createHeartbeatJob, updateHeartbeatJob: mocks.updateHeartbeatJob,
}));
vi.mock("./domains/ops/adMcpApply", () => ({ applyConfirmedAdMcpFacts: mocks.applyConfirmedAdMcpFacts }));

import { router } from "./_core/trpc";
import { currentOpsRequestScope, type OpsRequestScope } from "./domains/ops/workspaceContext";
import { lingxingSyncRouter } from "./routers/lingxingSync";

// Match server/routers.ts. The full path matters: inferOpsSecurityAction uses
// "lingxingSync.*" to classify these mutations as ops_data.sync, not update.
const routes = router({ lingxingSync: lingxingSyncRouter });
type Caller = ReturnType<typeof routes.createCaller>;
type Role = NonNullable<TrpcContext["user"]>["role"];
const operations: Array<{ name: string; invoke: (caller: Caller) => Promise<unknown>; preview?: true }> = [
  { name: "createPreview", preview: true, invoke: caller => caller.lingxingSync.createPreview({
    dataDomain: "fba_inventory", scope: { storeId: "synthetic-store", marketplace: "US" },
  }) },
  { name: "confirm", invoke: caller => caller.lingxingSync.confirm({ batchId: 901, selectedRowIds: [902] }) },
  { name: "applyConfirmedProductInventory", invoke: caller => caller.lingxingSync.applyConfirmedProductInventory({ batchId: 901 }) },
  { name: "setScheduleEnabled(true)", invoke: caller => caller.lingxingSync.setScheduleEnabled({ dataDomain: "fba_inventory", enabled: true }) },
  { name: "setScheduleEnabled(false)", invoke: caller => caller.lingxingSync.setScheduleEnabled({ dataDomain: "fba_inventory", enabled: false }) },
];
const dialect = new MySqlDialect();
const security = { readOnly: false, deny: false };
const securityQueries: Array<{ sql: string; params: unknown[] }> = [];
const unexpectedQueries: string[] = [];
const boundaryScopes: OpsRequestScope[] = [];
const CONTROL_STOP = "Authorized resolver stopped at the synthetic business boundary";

function context(role: Role = "ops_specialist", workspaceId: number | null = 42): TrpcContext {
  return {
    user: {
      id: 7, role, openId: "pwd_7", organizationId: null, defaultWorkspaceId: workspaceId,
      name: "Lingxing authorization fixture", email: "lingxing-permissions@example.test",
      phone: null, password: null, loginMethod: "local", department: null, jobTitle: null,
      status: "active", mustChangePassword: 0, failedLoginAttempts: 0, lockedUntil: null,
      invitedBy: null, lastPasswordChangedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0), lastSignedIn: new Date(0),
    },
    workspaceId,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function expectNoWritesOrExternalWork() {
  for (const spy of [mocks.insert, mocks.update, mocks.delete, mocks.rawExecute,
    mocks.registerUnifiedArtifact, mocks.invokeEmperorTool, mocks.createHeartbeatJob,
    mocks.updateHeartbeatJob, mocks.applyConfirmedAdMcpFacts, mocks.fetch]) {
    expect(spy).not.toHaveBeenCalled();
  }
  expect(unexpectedQueries).toEqual([]);
  // Security-policy reads and denial-audit INSERTs are controlled mock effects,
  // not business DB writes. No real database is opened by this fixture.
  expect(securityQueries.filter(query => /^(INSERT|UPDATE|DELETE)/u.test(query.sql.trim()))
    .every(query => query.sql.includes("INSERT INTO security_audit_logs"))).toBe(true);
}

function expectBeforeBusinessBoundary() {
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.ensureAgentRunTrace).not.toHaveBeenCalled();
  expect(boundaryScopes).toEqual([]);
  expectNoWritesOrExternalWork();
}

function expectScopedPolicy(action: "read" | "sync", role: Role) {
  const policies = securityQueries.filter(query => query.sql.includes("FROM security_access_policies"));
  expect(policies).not.toHaveLength(0);
  expect(policies.every(query => JSON.stringify(query.params)
    === JSON.stringify(["ops_data", action, 42, null, "7", role]))).toBe(true);
  // The context intentionally matches the existing default shared workspace.
  // Its fast path is preserved; this is not a membership-revocation assertion.
  expect(securityQueries.some(query => query.sql.includes("FROM workspace_memberships"))).toBe(false);
}

beforeEach(() => {
  vi.resetAllMocks();
  security.readOnly = false;
  security.deny = false;
  securityQueries.length = 0;
  unexpectedQueries.length = 0;
  boundaryScopes.length = 0;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getDb.mockResolvedValue({
    execute: mocks.execute, select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.delete,
  });
  mocks.execute.mockImplementation(async (statement: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    securityQueries.push({ sql: query.sql, params: query.params });
    if (query.sql.includes("FROM security_access_policies")) return [security.deny ? [{ effect: "deny" }] : []];
    if (query.sql.includes("FROM role_permissions")) return [security.readOnly ? [{
      modules: JSON.stringify(["ops"]),
      detailedPermissions: JSON.stringify([{ moduleId: "ops", operations: ["read"],
        subModules: [{ subModuleId: "ops_dashboard", operations: ["read"] }] }]),
    }] : []];
    if (query.sql.includes("INSERT INTO security_audit_logs")) return [[]];
    unexpectedQueries.push(query.sql);
    throw new Error("Unexpected persistence call in controlled authorization fixture");
  });
  const stopAtBusinessBoundary = () => {
    boundaryScopes.push(currentOpsRequestScope());
    // Synchronous throw also stops createPreview before its trace .catch can
    // swallow a rejected promise. This is a reachability control, not success.
    throw new Error(CONTROL_STOP);
  };
  mocks.select.mockImplementation(stopAtBusinessBoundary);
  mocks.ensureAgentRunTrace.mockImplementation(stopAtBusinessBoundary);
  for (const spy of [mocks.insert, mocks.update, mocks.delete, mocks.rawExecute,
    mocks.registerUnifiedArtifact, mocks.invokeEmperorTool, mocks.createHeartbeatJob,
    mocks.updateHeartbeatJob, mocks.applyConfirmedAdMcpFacts, mocks.fetch]) {
    spy.mockImplementation(() => { throw new Error("Business writes and external work are forbidden in this fixture"); });
  }
});

afterEach(() => { vi.unstubAllGlobals(); });

describe.each(operations)("T24 controlled Lingxing caller: $name", operation => {
  it("rejects anonymous access before any persistence or external effect", async () => {
    await expect(operation.invoke(routes.createCaller({ ...context(), user: null })))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expectBeforeBusinessBoundary();
  });

  it.each<Role>(["ops_specialist", "finance", "designer"])("denies the built-in %s role without sync permission", async role => {
    await expect(operation.invoke(routes.createCaller(context(role))))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "没有权限执行 ops_data.sync" });
    expectScopedPolicy("sync", role);
    expectBeforeBusinessBoundary();
  });

  it.each<Role>(["admin", "ops_manager"])("honors a workspace read-only override for %s", async role => {
    security.readOnly = true;
    await expect(operation.invoke(routes.createCaller(context(role))))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "没有权限执行 ops_data.sync" });
    expectScopedPolicy("sync", role);
    const overrides = securityQueries.filter(query => query.sql.includes("FROM role_permissions"));
    expect(overrides.map(query => query.params)).toEqual([[role, 42]]);
    expectBeforeBusinessBoundary();
  });

  it("honors an explicit deny policy even for an administrator in the default workspace", async () => {
    security.deny = true;
    await expect(operation.invoke(routes.createCaller(context("admin"))))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expectScopedPolicy("sync", "admin");
    expect(securityQueries.some(query => query.sql.includes("FROM role_permissions"))).toBe(false);
    expectBeforeBusinessBoundary();
  });

  it("requires a bound workspace even for a super administrator", async () => {
    await expect(operation.invoke(routes.createCaller(context("super_admin", null))))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expectBeforeBusinessBoundary();
  });

  it.each<Role>(["admin", "ops_manager", "super_admin"])("permits %s through authorization but stops before real business work", async role => {
    await expect(operation.invoke(routes.createCaller(context(role))))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: CONTROL_STOP });
    expect(boundaryScopes).toEqual([{ workspaceId: 42, tenantId: "workspace-42", userId: 7 }]);
    expect(operation.preview ? mocks.ensureAgentRunTrace : mocks.select).toHaveBeenCalledOnce();
    expect(operation.preview ? mocks.select : mocks.ensureAgentRunTrace).not.toHaveBeenCalled();
    if (role !== "super_admin") expectScopedPolicy("sync", role);
    expectNoWritesOrExternalWork();
  });
});

describe("T24 controlled Lingxing read-only semantics", () => {
  it.each<Role>(["ops_specialist", "admin", "ops_manager"])("keeps schedule reads available to read-only %s", async role => {
    security.readOnly = role !== "ops_specialist";
    const orderBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    mocks.select.mockReturnValue({ from });
    await expect(routes.createCaller(context(role)).lingxingSync.listSchedules()).resolves.toEqual([]);
    expectScopedPolicy("read", role);
    expect(where).toHaveBeenCalledOnce();
    const predicate = dialect.sqlToQuery(where.mock.calls[0][0]);
    expect(predicate.params).toEqual([42]);
    expect(predicate.sql).toContain("`ops_lingxing_sync_schedules`.`workspaceId`");
    expect(mocks.ensureAgentRunTrace).not.toHaveBeenCalled();
    expectNoWritesOrExternalWork();
  });

  it("re-evaluates a read-only role override on the same caller before a later mutation", async () => {
    const caller = routes.createCaller(context("ops_manager"));
    const operation = operations.find(item => item.name === "confirm")!;
    await expect(operation.invoke(caller)).rejects.toThrow(CONTROL_STOP);
    mocks.select.mockClear();
    boundaryScopes.length = 0;
    securityQueries.length = 0;
    security.readOnly = true;
    await expect(operation.invoke(caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectScopedPolicy("sync", "ops_manager");
    expectBeforeBusinessBoundary();
  });
});
