import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createCostSheetReadRepository, loadCostSheetReadState } from "./costSheetReadRepository";

type Row = Record<string, unknown>;
const input = { parentAsin: "B000000001", storeName: "Store Exact", country: "US", expectedWorkspaceId: 7 };
const context = (role = "ops_manager", patch: Record<string, unknown> = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7, name: "" }, workspaceId: 7, ...patch }) as TrpcContext;
const scope = { workspaceId: 7, parentAsin: input.parentAsin, storeName: input.storeName, country: "US" };
const owner = (patch: Row = {}): Row => ({ id: 4, ...scope, assigneeUserId: 3, isActive: 1, ...patch });
const source = (patch: Row = {}): Row => ({ id: 11, ...scope, importId: 30, date: "2026-10-16", sku: "SKU-A", msku: "MSKU-A", asin: "B000000002", name: "Original product",
  sourceKind: "lingxing_mcp_parent_asin_weekly", sourceBatchId: 17, sourceTraceId: "trace-original", sourceSchemaVersion: "v1",
  currency: "USD", price: "24.99", priceField: "avgPrice", actualFbaUnitFee: "-3.50", actualFbaTotalFee: null, fbaSalesQty: "10", operator: "Alice", ...patch });
const payload = () => ({ settings: { cnyPerCurrency: 7.2, freightRate: 9, standardGoodsConfirmed: false }, rows: [
  { key: "SKU-A", productCost: 12.345, packagingCost: 2, actualFreight: null, actualFba: null, weightKg: 0.5, lengthCm: 20, widthCm: 10, heightCm: 5 },
  { key: "orphan-original", productCost: 9.87, packagingCost: null, actualFreight: 4, actualFba: 2, weightKg: null, lengthCm: null, widthCm: null, heightCm: null },
] });
const saved = (patch: Row = {}): Row => {
  const text = JSON.stringify(payload());
  // Actual raw-query numeric/DECIMAL projection shape, not a Drizzle Date mapper.
  return { id: 81, ...scope, version: 12, updatedBy: 5, updatedAtEpochMs: String(Date.UTC(2026, 9, 15, 3, 4, 5)), payload: text, payloadBytes: Buffer.byteLength(text), ...patch };
};
const weeklyColumns = ["id", "workspaceId", "parent_asin", "store_name", "country", "site", "week_end_date", "operator", "import_id", "sku", "msku", "asin", "currency", "avg_price", "price", "title", "product_name", "report_date", "actual_fba_unit_fee", "actual_fba_total_fee", "fba_sales_qty", "source_kind", "source_batch_id", "source_trace_id", "source_schema_version"];
const costColumns = ["id", "workspace_id", "parent_asin", "store_name", "country", "payload", "version", "updated_by", "updated_at"];
let actors: Row[], assignments: Row[], mappings: Row[], lingxing: Row[], saihu: Row[], costs: Row[], policies: Row[];
let metadata: Record<string, string[]>, failures: Record<string, unknown>, queries: { sql: string; params: unknown[] }[];
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  if (query.sql.includes("information_schema.COLUMNS")) {
    if (failures.catalog) throw failures.catalog;
    return [(metadata[String(query.params[0])] ?? []).map(columnName => ({ columnName })), []];
  }
  for (const table of ["ops_cost_sheets", "lingxing_product_weekly", "saihu_product_weekly", "ops_inventory_owner_assignments", "operator_name_mappings", "security_access_policies"]) {
    if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  }
  if (query.sql.includes("LIMIT 0")) return [[], []];
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [[], []];
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) return [assignments, []];
  if (query.sql.includes("FROM operator_name_mappings")) return [mappings, []];
  if (query.sql.includes("FROM lingxing_product_weekly")) return [query.sql.includes("AS bodyBytes") ? lingxing.map(row => ({ id: row.id, bodyBytes: 1000 })) : lingxing, []];
  if (query.sql.includes("FROM saihu_product_weekly")) return [query.sql.includes("AS bodyBytes") ? saihu.map(row => ({ id: row.id, bodyBytes: 1000 })) : saihu, []];
  if (query.sql.includes("FROM ops_cost_sheets")) return [costs, []];
  throw new Error(`Unexpected query ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => body({ execute }));
const database = vi.fn(async () => ({ transaction }));
const read = createCostSheetReadRepository({ database, now: () => new Date("2026-10-17T12:30:00.000Z") }).read;
function regular() { actors[0].role = "ops_specialist"; return context("ops_specialist"); }
function mapping(patch: Row = {}): Row { return { id: 91, workspaceId: 7, externalName: "Alice", sourceType: "lingxing", systemUserId: 3, isConfirmed: 1, ...patch }; }
beforeEach(() => {
  vi.clearAllMocks(); queries = []; failures = {};
  actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; assignments = []; mappings = []; policies = [];
  lingxing = [source()]; saihu = []; costs = [saved()];
  metadata = { lingxing_product_weekly: [...weeklyColumns], saihu_product_weekly: [...weeklyColumns], ops_cost_sheets: [...costColumns] };
});
describe("complete friend cost sheet read-only repository", () => {
  it("returns complete payload, orphan rows and real current-version metadata, without fake history", async () => {
    const output = await read(context(), input), text = JSON.stringify(output);
    expect(output.status).toBe("saved");
    expect(output.identity).toEqual({ userId: 3, workspaceId: 7 }); expect(output.scope).toEqual(scope);
    expect(text).toContain('"version":12'); expect(text).toContain("2026-10-15T03:04:05.000Z");
    expect(text).toContain("12.345"); expect(text).toContain("orphan-original"); expect(text).toContain("SKU-A");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|INSERT|CREATE TABLE|ALTER TABLE|UPDATE .* SET|ops_inventory_planning_parameters|product_basic_info/u);
  });
  it("enforces canonical country plus exact parent/store/workspace in both reports and saved table", async () => {
    await read(context(), input);
    for (const table of ["lingxing_product_weekly", "saihu_product_weekly", "ops_cost_sheets"]) {
      const query = queries.find(item => item.sql.includes(`FROM ${table}`))!;
      expect(query.params).toEqual([7, input.parentAsin, input.storeName, "US"]);
      expect(query.sql).toContain("BINARY parent_asin=BINARY ?"); expect(query.sql).toContain("BINARY store_name=BINARY ?");
      expect(query.sql).toContain("WHEN '美国' THEN 'US'"); expect(query.sql).toMatch(/FOR SHARE$/u);
      expect(query.sql).toContain(table === "ops_cost_sheets" ? "workspace_id=?" : "workspaceId=?");
    }
    expect(queries.find(query => query.sql.includes("security_access_policies"))?.params.slice(0, 3)).toEqual(["ops_data", "read", 7]);
  });
  it("can read canonical aliases in stored source rows without crossing country", async () => {
    lingxing[0].country = "美国站"; costs[0].country = "美国";
    await expect(read(context(), input)).resolves.toHaveProperty("status", "saved");
  });
  it("uses live column detection and marks missing actual-FBA extensions instead of selecting absent columns", async () => {
    const removed = ["actual_fba_unit_fee", "actual_fba_total_fee", "report_date"];
    metadata.lingxing_product_weekly = weeklyColumns.filter(column => !removed.includes(column));
    lingxing[0].actualFbaUnitFee = null; lingxing[0].actualFbaTotalFee = null;
    const output = await read(context(), input), query = queries.find(item => item.sql.includes("FROM lingxing_product_weekly"))!;
    for (const absent of removed) expect(query.sql).not.toContain(absent);
    expect(query.sql).toContain("NULL AS actualFbaUnitFee"); expect(query.sql).toContain("week_end_date AS date");
    expect(JSON.stringify(output)).toContain("actualFbaUnitFee"); expect(JSON.stringify(output)).toContain("missingColumns");
    expect(output.status).toBe("saved");
  });
  it("retains Qingdao weekly provenance without treating imported, aggregate and MCP facts as one lineage", async () => {
    lingxing.push(source({ id: 12, sourceKind: "uploaded_parent_asin_weekly", sourceBatchId: null, sourceTraceId: null, sourceSchemaVersion: null }));
    const output = await read(context(), input), text = JSON.stringify(output);
    expect(text).toContain("lingxing_mcp_parent_asin_weekly"); expect(text).toContain("uploaded_parent_asin_weekly");
    expect(text).toContain("trace-original"); expect(text).toContain('"sourceBatchId":17');
  });
  it("marks absent legacy lineage columns instead of inventing sourceKind", async () => {
    metadata.lingxing_product_weekly = weeklyColumns.filter(column => !column.startsWith("source_"));
    Object.assign(lingxing[0], { sourceKind: null, sourceBatchId: null, sourceTraceId: null, sourceSchemaVersion: null });
    const output = await read(context(), input), query = queries.find(item => item.sql.includes("FROM lingxing_product_weekly"))!;
    expect(query.sql).not.toContain("source_kind"); expect(query.sql).toContain("NULL AS sourceKind");
    expect(JSON.stringify(output)).toContain('"sourceKind":null'); expect(JSON.stringify(output)).not.toContain("lingxing_mcp_parent_asin_weekly");
  });
  it("not_saved does not seed default cost/rate values or fabricate saved metadata", async () => {
    costs = []; const output = await read(context(), input); expect(output.status).toBe("not_saved");
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
  });
  it.each([{ code: "ER_NO_SUCH_TABLE" }, { cause: { errno: 1146 } }])("only actual missing cost table yields not_connected %j", async error => {
    metadata.ops_cost_sheets = []; failures.ops_cost_sheets = error;
    expect((await read(context(), input)).status).toBe("not_connected");
    expect(queries.some(query => query.sql === "SELECT 1 AS probe FROM ops_cost_sheets LIMIT 0")).toBe(true);
  });
  it.each(["lingxing_product_weekly", "saihu_product_weekly"])("missing %s is unavailable source structure, never an empty source or not_connected cost sheet", async table => {
    metadata[table] = []; failures[table] = { code: "ER_NO_SUCH_TABLE" };
    await expect(read(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COST_SHEET_READ_WEEKLY_SOURCE_NOT_CONNECTED" });
    expect(queries.some(query => query.sql.includes("FROM ops_cost_sheets"))).toBe(false);
  });
  it.each([{ code: "ER_BAD_FIELD_ERROR" }, { code: "ER_ACCESS_DENIED_ERROR" }, { errno: 1213 }, new Error("table doesn't exist password secret")])("does not turn other SQL errors into not_connected %j", async error => {
    failures.ops_cost_sheets = error;
    await expect(read(context(), input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "COST_SHEET_READ_FAILED" });
  });
  it("empty metadata without an actual table-missing error is not proof of absence", async () => {
    metadata.ops_cost_sheets = [];
    await expect(read(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COST_SHEET_READ_SCHEMA_UNAVAILABLE" });
  });
  it.each(["workspaceId", "parent_asin", "store_name", "country", "week_end_date", "operator"])("missing required source identity/ownership column %s fails closed", async column => {
    metadata.lingxing_product_weekly = weeklyColumns.filter(value => value !== column);
    await expect(read(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queries.some(query => query.sql.includes("FROM lingxing_product_weekly"))).toBe(false);
  });
  it("catalog access errors cannot be interpreted as missing columns", async () => {
    failures.catalog = { code: "ER_TABLEACCESS_DENIED_ERROR" };
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_FAILED" });
  });
  it("requires current active user/role/workspace and checks expected workspace before DB", async () => {
    await expect(read(context("ops_manager", { user: null }), input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(read(context(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database).not.toHaveBeenCalled();
    actors[0].role = "admin";
    await expect(read(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toHaveLength(1);
  });
  it.each([null, 3, "", "  "])("rejects malformed role %j before database access", async role => {
    const ctx = context("ops_manager", { user: { ...context().user, role } });
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database).not.toHaveBeenCalled();
  });
  it.each([{ status: "disabled" }, { defaultWorkspaceId: 8 }, { id: 99 }])("rejects stale actor %j", async patch => {
    Object.assign(actors[0], patch); await expect(read(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("manager role does not bypass explicit policy denial", async () => {
    policies = [{ effect: "deny" }];
    await expect(read(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(query => query.sql.includes("information_schema"))).toBe(false);
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("regular operator can use an exact confirmed assignee ID without username matching", async () => {
    const ctx = regular(); assignments = [owner()];
    await expect(read(ctx, input)).resolves.toHaveProperty("status", "saved");
    expect(queries.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("explicit other-owner assignment blocks mapping fallback", async () => {
    const ctx = regular(); assignments = [owner({ assigneeUserId: 4 })]; mappings = [mapping()];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it.each([{ workspaceId: 8 }, { parentAsin: "B000000099" }, { storeName: "Other" }, { country: "CA" }, { isActive: 0 }, { assigneeUserId: null }])("rejects invalid/foreign assignment %j", async patch => {
    const ctx = regular(); assignments = [owner(patch)]; await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("ambiguous canonical-country owner rules fail closed", async () => {
    const ctx = regular(); assignments = [owner(), owner({ id: 5, country: "美国" })];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("no username/empty operator/absent mapping ever grants ordinary access", async () => {
    const ctx = regular();
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    lingxing[0].operator = ""; mappings = [mapping()];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    lingxing = [];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("confirmed mapping uses numeric ID, exact external name and correct source type", async () => {
    const ctx = regular(); mappings = [mapping()];
    await expect(read(ctx, input)).resolves.toHaveProperty("status", "saved");
    const query = queries.find(item => item.sql.includes("FROM operator_name_mappings"))!;
    expect(query.params).toEqual([7, "lingxing", "Alice"]); expect(query.sql).toContain("BINARY external_name IN (?)");
    expect(query.sql).toMatch(/FOR SHARE$/u);
  });
  it.each([{ sourceType: "saihu" }, { workspaceId: 8 }, { isConfirmed: 0 }, { externalName: "Ali" }, { systemUserId: null }, { systemUserId: 4 }])("rejects stale/wrong mapping %j", async patch => {
    const ctx = regular(); mappings = [mapping(patch)]; await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("conflicting all/source mapping does not select a convenient match", async () => {
    const ctx = regular(); mappings = [mapping(), mapping({ id: 92, sourceType: "all", systemUserId: 4 })];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("every member of a composite operator needs a confirmed mapping", async () => {
    const ctx = regular(); lingxing[0].operator = "Alice/Unknown"; mappings = [mapping()];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("latest same-day differing owners are denied to ordinary operators, not hidden by later import IDs", async () => {
    const ctx = regular(); lingxing.push(source({ id: 12, importId: 99, sku: "SKU-B", operator: "Bob" }));
    mappings = [mapping(), mapping({ id: 92, externalName: "Bob", systemUserId: 4 })];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    actors[0].role = "ops_manager";
    await expect(read(context(), input)).resolves.toHaveProperty("status", "saved");
  });
  it("missing source date prohibits inferred ownership despite an otherwise matching mapping", async () => {
    const ctx = regular(); lingxing[0].date = null; mappings = [mapping()];
    await expect(read(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([{ workspaceId: 8 }, { parentAsin: "B000000099" }, { storeName: "Other" }, { country: "CA" }, { date: "2026-02-30" }, { date: "2026-10-18" }, { importId: -1 }])("rejects untrusted report identity/date %j", async patch => {
    lingxing = [source(patch)]; await expect(read(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("does not slice an oversized source set or choose duplicate IDs", async () => {
    lingxing = Array.from({ length: 2001 }, (_, index) => source({ id: index + 1 }));
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SOURCE_LIMIT" });
    lingxing = [source(), source()];
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SOURCE_LIMIT" });
  });
  it("applies the total source budget across both reports", async () => {
    lingxing = Array.from({ length: 1800 }, (_, index) => source({ id: index + 1 }));
    saihu = Array.from({ length: 201 }, (_, index) => source({ id: index + 1 }));
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SOURCE_LIMIT" });
  });
  it.each([{ workspaceId: 8 }, { country: "CA" }, { version: 0 }, { updatedBy: null }, { updatedAtEpochMs: "bad" }])("rejects invalid saved-version identity %j", async patch => {
    costs = [saved(patch)]; await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SAVED_INVALID" });
  });
  it.each([Date.UTC(2026, 9, 15, 3, 4, 5), String(Date.UTC(2026, 9, 15, 3, 4, 5)), `${Date.UTC(2026, 9, 15, 3, 4, 5)}.000000`])("uses explicit UTC epoch milliseconds returned as integer/DECIMAL %j", async updatedAtEpochMs => {
    costs = [saved({ updatedAtEpochMs, updatedAt: "2026-10-15 11:04:05" })];
    const result = await read(context(), input);
    expect(result.saved?.updatedAt).toBe("2026-10-15T03:04:05.000Z");
    const query = queries.find(item => item.sql.includes("FROM ops_cost_sheets"))!;
    expect(query.sql).toContain("UNIX_TIMESTAMP(updated_at)*1000 AS updatedAtEpochMs");
    expect(query.sql).not.toContain("updated_at AS updatedAt");
  });
  it.each([[0, "1970-01-01T00:00:00.000Z"], ["0.000", "1970-01-01T00:00:00.000Z"], [253_402_300_799_999, "9999-12-31T23:59:59.999Z"]])("retains valid UTC integer boundary %j", async (updatedAtEpochMs, iso) => {
    costs = [saved({ updatedAtEpochMs })];
    expect((await read(context(), input)).saved?.updatedAt).toBe(iso);
  });
  it.each([null, undefined, NaN, Infinity, -1, 1.5, "1.5", "1.0001", "01", " 1", "1 ", "+1", "1e12", "", "2026-10-15 03:04:05", new Date("2026-10-15T03:04:05Z"),
    Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1), 253_402_300_800_000, "253402300800000", "9".repeat(33)])("rejects ambiguous/nonintegral/unsafe/out-of-range saved timestamp %j", async updatedAtEpochMs => {
    costs = [saved({ updatedAtEpochMs })];
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SAVED_INVALID", code: "PRECONDITION_FAILED" });
  });
  it("does not choose among duplicate saved rows", async () => {
    costs.push(saved({ id: 82 })); await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_SAVED_INVALID" });
  });
  it.each(["{bad", '{"settings":{},"rows":[]}', '{"settings":{},"apiKey":"private"}'])("invalid full payload returns corrupt without leaking raw payload %s", async text => {
    costs = [saved({ payload: text, payloadBytes: Buffer.byteLength(text) })];
    const result = await read(context(), input); expect(result.status).toBe("corrupt"); expect(JSON.stringify(result)).not.toContain("private");
  });
  it("refuses oversized/truncated wire payload without returning partial saved content", async () => {
    costs = [saved({ payload: null, payloadBytes: 1048577 })];
    await expect(read(context(), input)).resolves.toHaveProperty("status", "corrupt");
    expect(queries.find(query => query.sql.includes("FROM ops_cost_sheets"))?.sql).toContain("<=1048576");
  });
  it("strict policy/owner/mapping failures and commit failures are never swallowed", async () => {
    failures.security_access_policies = { code: "ER_NO_SUCH_TABLE" };
    await expect(read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_FAILED" });
    failures = {};
    const repository = createCostSheetReadRepository({ database: async () => ({ transaction: async body => { await body({ execute }); throw new Error("commit secret"); } }) });
    await expect(repository.read(context(), input)).rejects.toMatchObject({ message: "COST_SHEET_READ_FAILED" });
  });
  it("requires a transaction; client cannot select another date/user/table", async () => {
    await expect(createCostSheetReadRepository({ database: async () => ({}) }).read(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    for (const extra of [{ asOfDate: "2020-01-01" }, { userId: 5 }, { table: "other" }]) await expect(read(context(), { ...input, ...extra })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("reusable write loader keeps complete sources/payload and uses update locks without a nested transaction", async () => {
    const loaded = await loadCostSheetReadState({ tx: { execute }, identity: { userId: 3, workspaceId: 7 }, role: "ops_manager", scope, asOfDate: "2026-10-17" }, { lock: "update", activeOwnerIds: new Set([3]) });
    expect(loaded.readResult.saved?.payload).toEqual(payload()); expect(loaded.sources[0].operator).toBe("Alice");
    expect(transaction).not.toHaveBeenCalled();
    for (const table of ["lingxing_product_weekly", "saihu_product_weekly", "ops_cost_sheets"]) {
      const selected = queries.filter(query => query.sql.includes(`FROM ${table}`));
      expect(selected.length).toBeGreaterThan(0); expect(selected.every(query => query.sql.endsWith("FOR UPDATE"))).toBe(true);
    }
  });
  it.each([{ active: [3] }, { active: [4] }, { active: [] }])("write loader rejects incomplete current active numeric owner set %j", async ({ active }) => {
    lingxing[0].operator = "Alice/Bob"; mappings = [mapping(), mapping({ id: 92, externalName: "Bob", systemUserId: 4 })];
    await expect(loadCostSheetReadState({ tx: { execute }, identity: { userId: 3, workspaceId: 7 }, role: "ops_specialist", scope, asOfDate: "2026-10-17" }, { lock: "update", activeOwnerIds: new Set(active) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("write loader accepts only fully resolved active compound owners, and prevents foreign scope sessions", async () => {
    lingxing[0].operator = "Alice/Bob"; mappings = [mapping(), mapping({ id: 92, externalName: "Bob", systemUserId: 4 })];
    const session = { tx: { execute }, identity: { userId: 3, workspaceId: 7 }, role: "ops_specialist", scope, asOfDate: "2026-10-17" };
    expect((await loadCostSheetReadState(session, { lock: "update", activeOwnerIds: new Set([3, 4]) })).readResult.status).toBe("saved");
    await expect(loadCostSheetReadState({ ...session, identity: { userId: 3, workspaceId: 8 } }, { lock: "update" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
