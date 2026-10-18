import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
import { assertResourceAction, hasResourceAction, type ResourceActionCheck } from "./services/securityGovernance";

const queries: { sql: string; params: unknown[] }[] = [];
const execute = vi.fn(async (statement: SQL): Promise<unknown> => {
  queries.push(new MySqlDialect().sqlToQuery(statement)); return [[], []];
});
const check = (mode: "share" | "update" | undefined = "share", patch: Partial<ResourceActionCheck> = {}): ResourceActionCheck => ({
  actor: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7, resource: "ops_board", action: "read",
  authorizationRead: { executor: { execute }, strict: true, lock: true, ...(mode === undefined ? {} : { lockMode: mode }) }, ...patch,
});
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0;
  execute.mockImplementation(async statement => { queries.push(new MySqlDialect().sqlToQuery(statement)); return [[], []]; });
  mocks.getDb.mockRejectedValue(new Error("Unrelated connection forbidden"));
});

describe("opt-in shared strict authorization", () => {
  it("uses SHARE for both policy and role reads without taking another connection", async () => {
    await expect(assertResourceAction(check())).resolves.toBeUndefined();
    expect(queries).toHaveLength(2); expect(queries[0].sql).toContain("security_access_policies"); expect(queries[1].sql).toContain("role_permissions");
    expect(queries.every(query => query.sql.endsWith("FOR SHARE") && !query.sql.includes("FOR UPDATE"))).toBe(true);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["update", "omitted"] as const)("preserves UPDATE for %s lock mode", async mode => {
    const input = check("update"); if (mode === "omitted") delete input.authorizationRead!.lockMode;
    await hasResourceAction(input); expect(queries).toHaveLength(2); expect(queries.every(query => query.sql.endsWith("FOR UPDATE"))).toBe(true);
  });
  it("also uses SHARE for a required membership lookup", async () => {
    execute.mockImplementationOnce(async statement => { queries.push(new MySqlDialect().sqlToQuery(statement)); return [[{ id: 9 }], []]; });
    await hasResourceAction(check("share", { workspaceId: 8 }));
    expect(queries).toHaveLength(3); expect(queries[0].sql).toContain("workspace_memberships"); expect(queries.every(query => query.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it.each(["Share", "UPDATE", "none", "", null, 0, false, {}])("rejects unknown lock mode %j before any grant or query", async lockMode => {
    for (const patch of [{}, { ownerUserId: 3 }, { actor: { id: 3, role: "super_admin" } }]) {
      const input = check("share", patch); Object.assign(input.authorizationRead!, { lockMode });
      await expect(hasResourceAction(input)).rejects.toThrow("valid lock mode");
    }
    expect(execute).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("retains explicit policy denial on SHARE without audit writes", async () => {
    execute.mockResolvedValueOnce([[{ effect: "deny" }], []]);
    await expect(assertResourceAction(check())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(execute).toHaveBeenCalledTimes(1); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["policy", "role", "membership"])("does not convert %s read failure to a fallback grant", async target => {
    if (target === "role") execute.mockResolvedValueOnce([[], []]);
    execute.mockRejectedValueOnce(new Error(`${target} unavailable`));
    await expect(hasResourceAction(check("share", target === "membership" ? { workspaceId: 8 } : {}))).rejects.toThrow(`${target} unavailable`);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("does not introduce role UPDATE locks when reciprocal partners authorize in reverse order", async () => {
    for (const roles of [["ops_specialist", "ops_manager"], ["ops_manager", "ops_specialist"]]) {
      for (const [index, role] of roles.entries()) await hasResourceAction(check("share", { actor: { id: index + 3, role, defaultWorkspaceId: 7 } }));
    }
    expect(queries).toHaveLength(8); expect(queries.every(query => query.sql.endsWith("FOR SHARE"))).toBe(true);
  });
});
