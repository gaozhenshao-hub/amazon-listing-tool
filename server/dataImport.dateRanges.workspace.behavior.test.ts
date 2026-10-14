import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

// Real tRPC, policy, ALS workspace context, schema and SQL predicate construction.
// Only the DB boundary is replaced. No database/HTTP/provider is used: these are
// predicate regression tests, not persisted row visibility or full T24 proof.
const boundary = vi.hoisted(() => ({ getDb: vi.fn(), execute: vi.fn(), writes: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: boundary.getDb }));

import { router } from "./_core/trpc";
import { dataImportRouter } from "./routers/dataImport";

const app = router({ dataImport: dataImportRouter });
const dialect = new MySqlDialect();
const selections: Array<{ table: string; sql: string; params: unknown[] }> = [];
const fixture = {
  actor: 7, workspace: 42,
  // Legal NOT NULL user_id for both current fresh weekly tables. The same
  // actor can have imported historical facts in more than one workspace.
  own: { workspaceId: 42, userId: 7, weekStartDate: "2026-10-05" },
  foreign: { workspaceId: 43, userId: 7, weekStartDate: "2026-09-28" },
  legacy: { workspaceId: null, userId: 7, weekStartDate: "2026-09-21" },
  legacyOtherUser: { workspaceId: null, userId: 8, weekStartDate: "2026-09-14" },
};
const fixtureRows = [fixture.own, fixture.foreign, fixture.legacy, fixture.legacyOtherUser]
  .map(row => ({ ...row, weekEndDate: new Date(Date.parse(`${row.weekStartDate}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10) }));
const rows = fixtureRows.filter(row => row.weekStartDate === fixture.own.weekStartDate || row.weekStartDate === fixture.legacy.weekStartDate)
  .map(({ weekStartDate, weekEndDate }) => ({ weekStartDate, weekEndDate }));

// Narrow DB substitute recognizes only the old/new exact emitted predicates.
// This is a synthetic predicate model, explicitly not MySQL evaluation. The
// independent exact SQL+params assertions below remain the primary evidence.
function controlledRangeRows(query: (typeof selections)[number]) {
  const column = (name: string) => `\`${query.table}\`.\`${name}\``;
  const user = `(${column("user_id")} is null or ${column("user_id")} = ?)`;
  const scoped = `((${column("workspaceId")} is null or ${column("workspaceId")} = ?) and ${user})`;
  if (query.sql !== user && query.sql !== scoped) throw new Error("Unrecognized range SQL");
  const hasScope = query.sql === scoped;
  const actorId = query.params[hasScope ? 1 : 0];
  return fixtureRows.filter(row => row.userId === actorId && (!hasScope || row.workspaceId === null || row.workspaceId === query.params[0]))
    .map(({ weekStartDate, weekEndDate }) => ({ weekStartDate, weekEndDate }));
}

function context(role: "admin" | "ops_specialist" = "admin", workspaceId: number | null = 42): TrpcContext {
  return {
    user: { id: 7, role, status: "active", openId: "pwd_7", name: "Synthetic range reader",
      organizationId: 3, defaultWorkspaceId: workspaceId } as NonNullable<TrpcContext["user"]>,
    workspaceId, requestId: "synthetic-date-range",
    req: { headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function record(table: Parameters<typeof getTableName>[0], condition: SQL) {
  const query = dialect.sqlToQuery(condition);
  selections.push({ table: getTableName(table), sql: query.sql, params: query.params });
}

beforeEach(() => {
  vi.resetAllMocks();
  selections.length = 0;
  boundary.execute.mockImplementation(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes("FROM security_access_policies") || query.sql.includes("FROM role_permissions")) return [[], []];
    throw new Error("Unexpected security SQL in read-only range test");
  });
  boundary.getDb.mockResolvedValue({
    execute: boundary.execute,
    selectDistinct: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: (condition: SQL) => {
      record(table, condition);
      return { orderBy: () => ({
        then: (resolve: (value: typeof rows) => unknown) => Promise.resolve(controlledRangeRows(selections.at(-1)!)).then(resolve),
        // getWeeklySummary ends early at an empty range list, so it cannot
        // accidentally exercise a second unrelated fact query in this test.
        limit: async () => [],
      }) };
    } }) }),
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: async (condition: SQL) => {
      record(table, condition);
      if (getTableName(table) !== "data_imports") throw new Error("Unexpected owner lookup");
      return [{ count: 1 }];
    } }) }),
    insert: boundary.writes, update: boundary.writes, delete: boundary.writes,
  });
});

describe.each(["lingxing", "saihu"] as const)("dataImport range isolation: %s", sourceType => {
  const table = `${sourceType}_product_weekly`;
  const column = (name: string) => `\`${table}\`.\`${name}\``;

  it.each(["admin", "ops_specialist"] as const)("binds %s date ranges to the current workspace without losing legacy/user predicates", async role => {
    const response = await app.createCaller(context(role)).dataImport.getAvailableDateRanges({ sourceType });
    expect(response).toEqual(rows); // controlled DB return, not a SQL-engine result
    const predicate = selections.find(item => item.table === table)!;
    expect(predicate).toBeDefined();
    expect(predicate.sql).toBe(`((${column("workspaceId")} is null or ${column("workspaceId")} = ?) and (${column("user_id")} is null or ${column("user_id")} = ?))`);
    expect(predicate.params).toEqual([fixture.workspace, fixture.actor]);
    expect(predicate.params).not.toContain(fixture.foreign.workspaceId);
    expect(fixture.own.userId).toBe(fixture.foreign.userId);
    expect(fixture.legacy.workspaceId).toBeNull();
    expect(response.map(row => row.weekStartDate)).toEqual([fixture.own.weekStartDate, fixture.legacy.weekStartDate]);
    expect(response.map(row => row.weekStartDate)).not.toContain(fixture.foreign.weekStartDate);
    expect(response.map(row => row.weekStartDate)).not.toContain(fixture.legacyOtherUser.weekStartDate);
    expect(boundary.writes).not.toHaveBeenCalled();
    if (role === "ops_specialist") {
      const ownerLookup = selections.find(item => item.table === "data_imports")!;
      expect(ownerLookup.params).toEqual([fixture.actor, fixture.workspace]);
    }
  });

  it("keeps the existing weekly-summary legacy/workspace and user scope unchanged", async () => {
    await expect(app.createCaller(context()).dataImport.getWeeklySummary({ sourceType, weeks: 4 }))
      .resolves.toEqual({ weeks: [], data: [] });
    const predicate = selections.find(item => item.table === table)!;
    expect(predicate.sql).toBe(`(${column("workspaceId")} is null or (${column("workspaceId")} = ? and (${column("user_id")} = ? or ${column("user_id")} is null)))`);
    expect(predicate.params).toEqual([fixture.workspace, fixture.actor]);
    expect(boundary.writes).not.toHaveBeenCalled();
  });
});

describe("date range authorization is unchanged", () => {
  it("rejects anonymous callers before DB access", async () => {
    await expect(app.createCaller({ ...context(), user: null }).dataImport.getAvailableDateRanges({ sourceType: "lingxing" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(selections).toEqual([]);
  });
  it("rejects an authenticated caller without a workspace before DB access", async () => {
    await expect(app.createCaller(context("admin", null)).dataImport.getAvailableDateRanges({ sourceType: "saihu" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(selections).toEqual([]);
  });
});
