import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

// Real tRPC, all three production middleware, policy evaluation and audit writer.
// Only the DB boundary is replaced. The small resolver bodies below are test
// routes, not mocked production repositories. No HTTP/session/DB persistence is
// proven here; asynchronous audits are explicitly drained before assertions.
const db = vi.hoisted(() => ({ getDb: vi.fn(), execute: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: db.getDb }));

import { router } from "./_core/trpc";
import { workspaceScopedProcedure } from "./domains/ai_os/workspaceScopedProcedure";
import { protectedProcedure as opsProcedure } from "./domains/ops/workspaceProcedure";
import { protectedProcedure as adsProcedure } from "./domains/ads/procedure";
import { assertResourceAction } from "./services/securityGovernance";

const gateways = [
  { name: "knowledge", procedure: workspaceScopedProcedure("knowledge"), action: "knowledge.update", resource: "knowledge", policy: true },
  { name: "ops", procedure: opsProcedure, action: "ops_data.update", resource: "ops_data", policy: true },
  // Ads currently requires login but has no assertResourceAction policy gate.
  // Do not invent one or expand its access policy as part of an audit fix.
  { name: "ads", procedure: adsProcedure, action: "ads.invoke", resource: "ops_data", policy: false },
] as const;
type Gateway = typeof gateways[number];
const dialect = new MySqlDialect();
const queries: Array<{ sql: string; params: unknown[] }> = [];
const audits: Array<Record<string, unknown>> = [];
let deny = false;
let failAudit = false;
let resolverCalls = 0;

function context(): TrpcContext {
  return {
    user: {
      id: 7, role: "admin", openId: "pwd_7", organizationId: null, defaultWorkspaceId: 42,
      name: "Synthetic audit fixture", email: "audit@example.test", phone: null, password: null,
      loginMethod: "local", department: null, jobTitle: null, status: "active", mustChangePassword: 0,
      failedLoginAttempts: 0, lockedUntil: null, invitedBy: null, lastPasswordChangedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0), lastSignedIn: new Date(0),
    },
    workspaceId: 42, requestId: "t24-canonical-request-1234",
    req: { ip: "192.0.2.24", socket: { remoteAddress: "192.0.2.25" }, headers: {
      "x-request-id": "t24-header-request-5678", "user-agent": "SyntheticAudit/1", cookie: "app_session_id=synthetic-only",
    } } as unknown as TrpcContext["req"],
    res: { locals: { requestId: "t24-canonical-request-1234" } } as unknown as TrpcContext["res"],
  };
}
function invoke(gateway: Gateway, operation: () => unknown, ctx = context(), query = false) {
  const resolve = () => { resolverCalls++; return operation(); };
  const target = query ? gateway.procedure.query(resolve) : gateway.procedure.mutation(resolve);
  return router({ target }).createCaller(ctx).target();
}
async function drainedAudits(count: number) {
  await vi.waitFor(() => expect(audits).toHaveLength(count));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(audits).toHaveLength(count);
  return audits;
}
async function expectMutationAudit(gateway: Gateway, status: "success" | "failed", reason: string | null) {
  await drainedAudits(1);
  expect(audits[0]).toMatchObject({ actorUserId: 7, actorRole: "admin", workspaceId: 42,
    action: gateway.action, resourceType: gateway.resource, status, reason,
    requestId: "t24-canonical-request-1234", ipAddress: "192.0.2.24", userAgent: "SyntheticAudit/1" });
  expect(JSON.parse(audits[0].metadata as string)).toEqual({ path: "target" });
  expect(JSON.stringify(audits)).not.toContain("app_session_id");
}

beforeEach(() => {
  vi.clearAllMocks(); deny = false; failAudit = false; resolverCalls = 0; queries.length = 0; audits.length = 0;
  db.getDb.mockResolvedValue({ execute: db.execute });
  db.execute.mockImplementation(async (statement: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
    const q = dialect.sqlToQuery(statement); queries.push({ sql: q.sql, params: q.params });
    if (q.sql.includes("FROM security_access_policies")) return [deny ? [{ effect: "deny" }] : []];
    if (q.sql.includes("FROM role_permissions")) return [[]];
    const insert = /INSERT INTO security_audit_logs\s*\(([^)]+)\)/u.exec(q.sql);
    if (insert) {
      const columns = insert[1].split(",").map(name => name.trim());
      expect(columns).toHaveLength(q.params.length);
      audits.push(Object.fromEntries(columns.map((column, i) => [column, q.params[i]])));
      if (failAudit) throw new Error("Synthetic audit DB failure");
      return [[]];
    }
    throw new Error("Unexpected DB effect in audit-only fixture");
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(gateways)("mutation audit: $name gateway", gateway => {
  it("logs exactly one success and preserves canonical request context", async () => {
    await expect(invoke(gateway, () => ({ updated: true }))).resolves.toEqual({ updated: true });
    expect(resolverCalls).toBe(1); await expectMutationAudit(gateway, "success", null);
  });
  it("treats resolver data containing ok:false as successful data, not a middleware failure", async () => {
    await expect(invoke(gateway, () => ({ ok: false, reason: "business data" }))).resolves.toEqual({ ok: false, reason: "business data" });
    await expectMutationAudit(gateway, "success", null);
  });
  it("logs NOT_FOUND exactly once as failed, never success, and preserves the original TRPC error", async () => {
    const error = new TRPCError({ code: "NOT_FOUND", message: "Synthetic owned child not found" });
    await expect(invoke(gateway, () => { throw error; })).rejects.toBe(error);
    expect(resolverCalls).toBe(1); await expectMutationAudit(gateway, "failed", error.message);
  });
  it("logs an ordinary resolver error as failed without changing its cause", async () => {
    const cause = new Error("Synthetic resolver failure");
    await expect(invoke(gateway, () => { throw cause; })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause });
    await expectMutationAudit(gateway, "failed", cause.message);
  });
  it("handles a nested middleware failure before the resolver without a false success", async () => {
    const error = new TRPCError({ code: "NOT_FOUND", message: "Synthetic nested resource not found" });
    const target = gateway.procedure.use(async () => { throw error; }).mutation(() => { resolverCalls++; return true; });
    await expect(router({ target }).createCaller(context()).target()).rejects.toBe(error);
    expect(resolverCalls).toBe(0); await expectMutationAudit(gateway, "failed", error.message);
  });
  it("retains query behavior: successful and failed queries do not add mutation audits", async () => {
    await expect(invoke(gateway, () => "query result", context(), true)).resolves.toBe("query result");
    const error = new TRPCError({ code: "NOT_FOUND", message: "Synthetic query missing" });
    await expect(invoke(gateway, () => { throw error; }, context(), true)).rejects.toBe(error);
    await drainedAudits(0); expect(resolverCalls).toBe(2);
  });
  it("does not mask the original failure if the asynchronous failed-audit INSERT rejects", async () => {
    failAudit = true; const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new TRPCError({ code: "NOT_FOUND", message: "Original missing child" });
    await expect(invoke(gateway, () => { throw error; })).rejects.toBe(error);
    await expectMutationAudit(gateway, "failed", error.message);
    expect(warning).toHaveBeenCalledOnce();
  });
  it("keeps anonymous denial before policy, resolver and audit", async () => {
    await expect(invoke(gateway, () => true, { ...context(), user: null })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(resolverCalls).toBe(0); expect(queries).toEqual([]); await drainedAudits(0);
  });
});

describe.each(gateways.filter(g => g.policy))("denial audit: $name policy gateway", gateway => {
  it("records only denied with requestId/IP/userAgent and never runs the resolver or records failed", async () => {
    deny = true;
    await expect(invoke(gateway, () => true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolverCalls).toBe(0); await drainedAudits(1);
    expect(audits[0]).toMatchObject({ status: "denied", action: gateway.action, resourceType: gateway.resource,
      actorUserId: 7, actorRole: "admin", workspaceId: 42, requestId: "t24-canonical-request-1234",
      ipAddress: "192.0.2.24", userAgent: "SyntheticAudit/1" });
    expect(queries.some(q => q.sql.includes("FROM role_permissions"))).toBe(false);
    expect(JSON.stringify(audits)).not.toContain("app_session_id");
  });
  it("keeps FORBIDDEN if the awaited denial-audit INSERT fails", async () => {
    deny = true; failAudit = true; const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(invoke(gateway, () => true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolverCalls).toBe(0); await drainedAudits(1);
    expect(audits[0]).toMatchObject({ status: "denied", requestId: "t24-canonical-request-1234" });
    expect(warning).toHaveBeenCalledOnce();
  });
  it("retains missing-workspace rejection without changing policy or audit behavior", async () => {
    const ctx = context(); ctx.workspaceId = null; ctx.user!.defaultWorkspaceId = null;
    await expect(invoke(gateway, () => true, ctx)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(resolverCalls).toBe(0); expect(queries).toEqual([]); await drainedAudits(0);
  });
});

describe("audit context compatibility, without widening access", () => {
  it("keeps legacy direct assertResourceAction callers valid when no context is supplied", async () => {
    deny = true;
    await expect(assertResourceAction({ actor: { id: 7, role: "admin", defaultWorkspaceId: 42 },
      workspaceId: 42, resource: "knowledge", action: "delete" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await drainedAudits(1);
    expect(audits[0]).toMatchObject({ status: "denied", actorUserId: 7, actorRole: "admin", workspaceId: 42,
      requestId: null, ipAddress: null, userAgent: null });
  });
  it("uses the existing header fallback only when context requestId is absent", async () => {
    deny = true; const ctx = context(); delete ctx.requestId;
    await expect(invoke(gateways[0], () => true, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await drainedAudits(1); expect(audits[0].requestId).toBe("t24-header-request-5678");
  });
  it("retains default-workspace shortcut and super-admin bypass without extra membership reads", async () => {
    await invoke(gateways[0], () => true); await drainedAudits(1);
    expect(queries.some(q => q.sql.includes("FROM workspace_memberships"))).toBe(false);
    queries.length = 0; audits.length = 0; deny = true;
    const ctx = context(); ctx.user!.role = "super_admin";
    await expect(invoke(gateways[0], () => true, ctx)).resolves.toBe(true); await drainedAudits(1);
    expect(queries.every(q => q.sql.includes("INSERT INTO security_audit_logs"))).toBe(true);
    expect(audits[0]).toMatchObject({ status: "success", actorRole: "super_admin" });
  });
  it("does not add a policy gate to the existing ads login-only wrapper", async () => {
    deny = true; await expect(invoke(gateways[2], () => true)).resolves.toBe(true); await drainedAudits(1);
    expect(queries.every(q => q.sql.includes("INSERT INTO security_audit_logs"))).toBe(true);
  });
});
