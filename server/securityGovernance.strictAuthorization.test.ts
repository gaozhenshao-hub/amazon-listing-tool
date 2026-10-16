import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
import { assertResourceAction, hasResourceAction, type ResourceActionCheck } from "./services/securityGovernance";

const queries: { sql: string; params: unknown[] }[] = [];
const execute = vi.fn(async (statement: SQL) => {
  queries.push(new MySqlDialect().sqlToQuery(statement));
  return [[], []] as unknown;
});
const check = (patch: Partial<ResourceActionCheck> = {}): ResourceActionCheck => ({
  actor: { id: 19, role: "ops_specialist", defaultWorkspaceId: 7 },
  resource: "file", action: "import", workspaceId: 7, projectId: 10, resourceId: 10, ownerUserId: 5,
  authorizationRead: { executor: { execute }, strict: true, lock: true }, ...patch,
});
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0;
  execute.mockImplementation(async statement => { queries.push(new MySqlDialect().sqlToQuery(statement)); return [[], []]; });
  mocks.getDb.mockRejectedValue(new Error("Unrelated connection must not be used"));
});

describe("transaction-bound authorization retains policy semantics without fail-open fallback", () => {
  it("uses the caller transaction and locks both policy and role reads", async () => {
    await hasResourceAction(check());
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain("security_access_policies");
    expect(queries[1].sql).toContain("role_permissions");
    for (const query of queries) expect(query.sql).toMatch(/FOR UPDATE$/);
    expect(queries[0].params).toEqual(["file", "import", 7, "10", "19", "ops_specialist"]);
  });
  it.each(["Table doesn't exist", "Unknown column", "Connection lost", "deadlock"])("does not grant default permissions on %s", async message => {
    execute.mockRejectedValueOnce(new Error(message));
    await expect(hasResourceAction(check())).rejects.toThrow(message);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("does not swallow role override read failure", async () => {
    execute.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("missing role schema"));
    await expect(hasResourceAction(check())).rejects.toThrow("missing role schema");
  });
  it("retains explicit authenticated NULL scope instead of falling back to an actor default", async () => {
    await hasResourceAction(check({ workspaceId: null }));
    expect(queries[0].params[2]).toBeNull();
    expect(queries[1].params).toEqual(["ops_specialist", null]);
  });
  it("locks workspace membership when it is needed, and does not fall back after error", async () => {
    execute.mockImplementationOnce(async statement => {
      queries.push(new MySqlDialect().sqlToQuery(statement)); return [[{ id: 4 }], []];
    });
    await hasResourceAction(check({ workspaceId: 8 }));
    expect(queries[0].sql).toContain("workspace_memberships");
    expect(queries[0].sql).toMatch(/FOR UPDATE$/);
    expect(queries[0].params).toEqual([8, 19]);
    execute.mockRejectedValueOnce(new Error("membership unavailable"));
    await expect(hasResourceAction(check({ workspaceId: 8 }))).rejects.toThrow("membership unavailable");
  });
  it("denies a missing workspace membership before any role/policy fallback", async () => {
    expect(await hasResourceAction(check({ workspaceId: 8 }))).toBe(false);
    expect(queries).toHaveLength(1);
  });
  it("honors explicit deny and avoids an independent audit connection under transaction locks", async () => {
    execute.mockResolvedValueOnce([[{ effect: "deny" }], []]);
    await expect(assertResourceAction(check())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("retains an explicit allow, rather than replacing the permission matrix", async () => {
    execute.mockResolvedValueOnce([[{ effect: "allow" }], []]);
    expect(await hasResourceAction(check())).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("preserves owned-resource and super-admin fast paths after validating the executor", async () => {
    expect(await hasResourceAction(check({ ownerUserId: 19 }))).toBe(true);
    expect(await hasResourceAction(check({ actor: { id: 19, role: "super_admin" } }))).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await expect(hasResourceAction(check({ ownerUserId: 19, authorizationRead: { executor: null, strict: true, lock: true } }))).rejects.toThrow("transaction executor");
  });
  it("keeps legacy non-strict missing-schema behavior unchanged", async () => {
    mocks.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(new Error("Table doesn't exist")) });
    await expect(hasResourceAction(check({ authorizationRead: undefined }))).resolves.toEqual(expect.any(Boolean));
    expect(mocks.getDb).toHaveBeenCalledTimes(2);
  });
});
