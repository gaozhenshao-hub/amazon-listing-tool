import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createCostSheetWriteRepository } from "./costSheetWriteRepository";
import { operationsCostSheetWriteCanonical } from "../../../shared/operationsCostSheetWrite";

type Row = Record<string, unknown>;
const input = { expectedWorkspaceId: 7, parentAsin: "B000000001", storeName: "Exact store", country: "US" };
const scope = { workspaceId: 7, parentAsin: input.parentAsin, storeName: input.storeName, country: "US" };
const uuid = "11111111-1111-4111-8111-111111111111", uuid2 = "22222222-2222-4222-8222-222222222222";
const ctx = (role = "ops_manager") => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7 }, workspaceId: 7 }) as TrpcContext;
const payload = () => ({ settings: { cnyPerCurrency: 7.2, freightRate: 9, standardGoodsConfirmed: false }, rows: [
  { key: "SKU-A", productCost: 12.345, packagingCost: 2, actualFreight: null, actualFba: null, weightKg: 0.5, lengthCm: 20, widthCm: 10, heightCm: 5 },
  { key: "historic-only", productCost: 9.87, packagingCost: null, actualFreight: 4, actualFba: 2, weightKg: null, lengthCm: null, widthCm: null, heightCm: null },
] });
const source = (patch: Row = {}): Row => ({ id: 11, ...scope, importId: 30, date: "2026-10-16", sku: "SKU-A", msku: "MSKU-A", asin: "B000000002", name: "Original product", sourceKind: "lingxing_mcp_parent_asin_weekly", sourceBatchId: 17, sourceTraceId: "trace-original", sourceSchemaVersion: "v1", currency: "USD", price: "24.99", priceField: "avgPrice", actualFbaUnitFee: "-3.50", actualFbaTotalFee: null, fbaSalesQty: "10", operator: "Alice", ...patch });
const saved = (patch: Row = {}): Row => ({ id: 81, ...scope, version: 12, updatedBy: 5, updatedAtEpochMs: "1792033445000", payload: JSON.stringify(payload()), ...patch });
const member = (patch: Row = {}): Row => ({ membershipId: 31, workspaceId: 7, userId: 3, membershipStatus: "active", id: 3, status: "active", ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 91, workspaceId: 7, externalName: "Alice", sourceType: "lingxing", systemUserId: 3, isConfirmed: 1, ...patch });
const owner = (patch: Row = {}): Row => ({ id: 22, ...scope, assigneeUserId: 3, isActive: 1, ...patch });
const column = (columnName: string, dataType: string, patch: Row = {}): Row => ({ columnName, isNullable: "NO", dataType, columnType: dataType, extra: "", maxLength: null, defaultValue: null, ...patch });
const sourceColumns = ["id", "workspaceId", "parent_asin", "store_name", "country", "site", "week_end_date", "operator", "import_id", "sku", "msku", "asin", "currency", "avg_price", "price", "title", "product_name", "report_date", "actual_fba_unit_fee", "actual_fba_total_fee", "fba_sales_qty", "source_kind", "source_batch_id", "source_trace_id", "source_schema_version"];
const makeCostColumns = () => [column("id", "int", { extra: "auto_increment" }), ...["workspace_id", "version", "updated_by"].map(name => column(name, "int")), ...Object.entries({ parent_asin: 500, store_name: 200, country: 20 }).map(([name, maxLength]) => column(name, "varchar", { maxLength })), column("payload", "json"), column("updated_at", "timestamp", { defaultValue: "CURRENT_TIMESTAMP", extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" })];
const makeAuditColumns = () => [column("id", "int", { extra: "auto_increment" }), ...["workspaceId", "actorUserId"].map(name => column(name, "int")), ...["auditId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel"].map(name => column(name, "varchar", { maxLength: name === "auditId" ? 80 : 128 })), column("metadata", "json")];
const index = (tableName: string, indexName: string, names: string[]) => names.map((columnName, i) => ({ tableName, indexName, columnName, sequence: i + 1, nonUnique: 0, prefixLength: null }));
let actors: Row[], members: Row[], assignments: Row[], mappings: Row[], lingxing: Row[], saihu: Row[], costs: Row[], audits: Row[], directory: Row[];
let costColumns: Row[], auditColumns: Row[], indexes: Row[], engines: Row[], queries: { sql: string; params: unknown[] }[], failures: Record<string, unknown>;
let enabled: boolean, commitLost: boolean, bodyBytes: number, writes: number, journalWrites: number, tail: Promise<unknown>;
const permission = vi.fn(async (_request: unknown) => {});
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement), text = query.sql, values = query.params; queries.push(query);
  if (text.includes("information_schema.COLUMNS")) {
    if (failures.catalog) throw failures.catalog;
    const table = String(values[0]);
    const found = table === "ops_cost_sheets" ? costColumns : table === "security_audit_logs" ? auditColumns : sourceColumns.map(columnName => ({ columnName }));
    return [found, []];
  }
  if (text.includes("information_schema.TABLES")) return [engines, []];
  if (text.includes("information_schema.STATISTICS")) return [indexes, []];
  if (text.includes("FROM users")) return [actors, []];
  if (text.includes("FROM workspace_memberships")) return [members, []];
  if (text.includes("FROM role_permissions")) { if (failures.directory) throw failures.directory; return [directory, []]; }
  if (text.includes("FROM ops_inventory_owner_assignments")) return [assignments, []];
  if (text.includes("FROM operator_name_mappings")) return [mappings, []];
  if (text.includes("FROM lingxing_product_weekly") || text.includes("FROM saihu_product_weekly")) {
    if (failures.source) throw failures.source;
    const data = text.includes("lingxing_product_weekly") ? lingxing : saihu;
    return [text.includes("AS bodyBytes") ? data.map(row => ({ id: row.id, bodyBytes })) : structuredClone(data), []];
  }
  if (text.startsWith("SELECT") && text.includes("FROM ops_cost_sheets")) {
    if (failures.cost) throw failures.cost;
    const found = text.includes("BINARY parent_asin") ? costs.filter(row => row.workspaceId === values[0] && row.parentAsin === values[1] && row.storeName === values[2] && (row.country === values[3] || ["美国", "美国站"].includes(String(row.country)) && values[3] === "US")) : costs;
    return [structuredClone(found).map(row => ({ ...row, payloadBytes: typeof row.payload === "string" ? Buffer.byteLength(row.payload) : 0 })), []];
  }
  if (text.startsWith("SELECT") && text.includes("FROM security_audit_logs")) return [audits.filter(row => row.auditId === values[0]), []];
  if (text.startsWith("INSERT INTO security_audit_logs")) {
    if (failures.journal) throw failures.journal;
    journalWrites++;
    audits.push({ auditId: values[0], workspaceId: values[1], actorUserId: values[2], action: "ops_cost.final", resourceType: "ops_cost_operation", resourceId: values[4], status: "success", metadataText: values[5] });
    return [{ affectedRows: 1, insertId: 900 }, []];
  }
  if (/^(INSERT INTO|UPDATE) ops_cost_sheets/u.test(text)) {
    writes++; if (failures.write) throw failures.write;
    if (text.startsWith("INSERT")) {
      costs.push(saved({ id: 82, workspaceId: values[0], parentAsin: values[1], storeName: values[2], country: values[3], payload: values[4], version: 1, updatedBy: values[5], updatedAtEpochMs: "1792209600000" }));
      return [{ affectedRows: 1, insertId: 82 }, []];
    }
    const record = costs.find(row => row.id === values[2] && row.version === values[7]);
    if (!record) return [{ affectedRows: 0 }, []];
    Object.assign(record, { payload: values[0], version: Number(record.version) + 1, updatedBy: values[1], updatedAtEpochMs: "1792209600000" });
    if (failures.readback) record.updatedBy = 99;
    return [{ affectedRows: 1 }, []];
  }
  if (text.includes("LIMIT 0")) return [[], []];
  throw new Error(`Unexpected SQL ${text}`);
});
const transaction = vi.fn(<T>(body: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
  const run = tail.then(async () => {
    const before = structuredClone({ costs, audits }); let value: T;
    try { value = await body({ execute }); }
    catch (error) { costs = before.costs; audits = before.audits; throw error; }
    if (commitLost) { commitLost = false; throw new Error("commit acknowledgement lost"); }
    return value;
  });
  tail = run.catch(() => {}); return run;
});
const database = vi.fn(async () => ({ transaction }));
const repo = createCostSheetWriteRepository({ database, permission, enabled: () => enabled, now: () => new Date("2026-10-18T12:00:00Z") });
const command = async (context = ctx()) => {
  const options = await repo.options(context, input);
  return { ...input, operationId: uuid, expectedVersion: options.readResult.saved?.version ?? 0, expectedSnapshotKey: options.snapshotKey!, payload: options.readResult.saved?.payload ?? { settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [] } };
};
function regular() { actors[0].role = "ops_specialist"; mappings = [mapping()]; directory = [policy()]; return ctx("ops_specialist"); }
function policy(operations: string[] = ["read", "edit"], workspaceId: number | null = 7): Row {
  return { id: workspaceId === null ? 80 : 81, workspaceId, role: String(actors[0].role), modules: ["ops"], detailedPermissions: [{ moduleId: "ops", operations: ["read", "edit"], subModules: [{ subModuleId: "ops_data_import", operations }] }] };
}
beforeEach(() => {
  vi.clearAllMocks(); permission.mockReset(); permission.mockResolvedValue(undefined);
  actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; members = [member()]; assignments = []; mappings = [];
  lingxing = [source()]; saihu = []; costs = [saved()]; audits = []; directory = []; queries = []; failures = {};
  costColumns = makeCostColumns(); auditColumns = makeAuditColumns();
  indexes = [...index("ops_cost_sheets", "PRIMARY", ["id"]), ...index("ops_cost_sheets", "uk_scope", ["workspace_id", "parent_asin", "store_name", "country"]), ...index("security_audit_logs", "PRIMARY", ["id"]), ...index("security_audit_logs", "uk_audit", ["auditId"])];
  engines = ["ops_cost_sheets", "security_audit_logs", "users", "workspace_memberships", "lingxing_product_weekly", "saihu_product_weekly", "operator_name_mappings", "ops_inventory_owner_assignments", "role_permissions", "security_access_policies"].map(tableName => ({ tableName, engine: "InnoDB" }));
  enabled = true; commitLost = false; bodyBytes = 1000; writes = 0; journalWrites = 0; tail = Promise.resolve();
});
describe("complete cost sheet transaction/CAS/recovery repository", () => {
  it("returns full readonly options without mutation or seeding", async () => {
    const result = await repo.options(ctx(), input);
    expect(result.capabilities.save.status).toBe("available"); expect(result.snapshotKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.readResult.saved?.payload).toEqual(payload()); expect(writes).toBe(0); expect(journalWrites).toBe(0);
    expect(queries[0].sql).toMatch(/FROM users .*FOR UPDATE$/u);
    for (const table of ["lingxing_product_weekly", "saihu_product_weekly", "ops_cost_sheets"]) expect(queries.filter(query => query.sql.includes(`FROM ${table}`)).every(query => query.sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(permission.mock.calls.map(([call]) => [((call as Row).resource), ((call as Row).action)])).toEqual([["ops_data", "read"], ["ops_cost_sheet", "read"], ["ops_cost_sheet", "update"]]);
    for (const [call] of permission.mock.calls) { expect(call).not.toHaveProperty("ownerUserId"); expect((call as Row).authorizationRead).toMatchObject({ strict: true, lock: true }); }
  });
  it("atomically saves all fields, preserves orphan, returns current verified version and one receipt", async () => {
    const request = await command(); request.payload.rows[0].productCost = 16.12345;
    const result = await repo.save(ctx(), request);
    expect(result).toMatchObject({ status: "committed", version: 13, operationId: uuid }); expect(result.snapshotKey).not.toBe(request.expectedSnapshotKey);
    expect(writes).toBe(1); expect(journalWrites).toBe(1); expect(JSON.parse(String(costs[0].payload))).toEqual(request.payload);
    expect(String(audits[0].metadataText)).not.toContain("productCost");
    const refreshed = await repo.options(ctx(), input); expect(refreshed.snapshotKey).toBe(result.snapshotKey);
  });
  it("creates only a genuinely not_saved exact scope at version one", async () => {
    costs = []; const request = await command();
    expect(request.expectedVersion).toBe(0); expect(writes).toBe(0);
    expect(await repo.save(ctx(), request)).toMatchObject({ status: "committed", version: 1 });
    expect(costs[0]).toMatchObject({ id: 82, ...scope, updatedBy: 3, version: 1 });
  });
  it("same UUID replay is idempotent but a different request is a conflict", async () => {
    const request = await command(), first = await repo.save(ctx(), request);
    expect(await repo.save(ctx(), request)).toEqual(first); expect(writes).toBe(1); expect(journalWrites).toBe(1);
    request.payload.settings.freightRate = 12;
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "CONFLICT" }); expect(writes).toBe(1);
  });
  it("two writers on the same old version cannot both succeed", async () => {
    const request = await command();
    const results = await Promise.allSettled([repo.save(ctx(), request), repo.save(ctx(), { ...request, operationId: uuid2 })]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]); expect(writes).toBe(1);
    expect(results[1]).toMatchObject({ reason: { code: "CONFLICT" } });
  });
  it.each(["version", "payload", "source", "operator"])("detects %s changes, including legacy writers not increasing version", async change => {
    const request = await command();
    if (change === "version") costs[0].version = 13;
    if (change === "payload") { const changed = payload(); changed.settings.freightRate = 11; costs[0].payload = JSON.stringify(changed); }
    if (change === "source") lingxing[0].price = "34.99";
    if (change === "operator") lingxing[0].operator = "Changed ownership evidence";
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "CONFLICT" }); expect(writes).toBe(0);
  });
  it.each(["orphan_changed", "orphan_removed", "saved_removed", "unknown_key"])("rejects destructive/mismatched full payload %s", async mode => {
    const request = await command();
    if (mode === "orphan_changed") request.payload.rows[1].productCost = 10;
    if (mode === "orphan_removed") request.payload.rows.pop();
    if (mode === "saved_removed") request.payload.rows.shift();
    if (mode === "unknown_key") request.payload.rows.push({ ...request.payload.rows[0], key: "other-store-sku" });
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(writes).toBe(0);
  });
  it("unknown commit retains UUID; check returns committed without second save", async () => {
    const request = await command(); commitLost = true;
    expect(await repo.save(ctx(), request)).toMatchObject({ status: "unknown", operationId: uuid });
    expect(costs[0].version).toBe(13);
    expect(await repo.recover(ctx(), { ...input, operationId: uuid, decision: "check" })).toMatchObject({ status: "committed", version: 13 });
    expect(writes).toBe(1);
  });
  it("absent receipt remains unknown; disabled cancel fence prevents a late save", async () => {
    const request = await command(); enabled = false;
    expect(await repo.recover(ctx(), { ...input, operationId: uuid, decision: "check" })).toMatchObject({ status: "unknown" });
    expect(await repo.recover(ctx(), { ...input, operationId: uuid, decision: "cancel" })).toMatchObject({ status: "cancelled" });
    enabled = true; expect(await repo.save(ctx(), request)).toMatchObject({ status: "cancelled" }); expect(writes).toBe(0); expect(journalWrites).toBe(1);
  });
  it("disabled recover can read an existing success without write permission", async () => {
    const request = await command(); await repo.save(ctx(), request); enabled = false; directory = [policy(["read"])];
    expect(await repo.recover(ctx(), { ...input, operationId: uuid, decision: "cancel" })).toMatchObject({ status: "committed" });
    expect(writes).toBe(1); expect(journalWrites).toBe(1);
  });
  it("journal failure rolls back business data; failed readback never commits", async () => {
    const request = await command(); failures.journal = new Error("database connection interrupted");
    expect(await repo.save(ctx(), request)).toMatchObject({ status: "unknown" }); expect(costs[0].version).toBe(12); expect(audits).toEqual([]);
    delete failures.journal; failures.readback = true;
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COST_SHEET_WRITE_WRITE_UNVERIFIABLE" });
    expect(costs[0].version).toBe(12); expect(audits).toEqual([]);
  });
  it("same UUID cannot be replayed across a different product scope", async () => {
    const request = await command(); await repo.save(ctx(), request);
    lingxing[0].parentAsin = "B000000099"; costs = [];
    await expect(repo.recover(ctx(), { ...input, parentAsin: "B000000099", operationId: uuid, decision: "check" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("canonical country aliases preserve original saved scope and do not insert another row", async () => {
    costs[0].country = "美国"; lingxing[0].country = "美国站";
    const request = await command(); expect(await repo.save(ctx(), request)).toMatchObject({ status: "committed" });
    expect(costs).toHaveLength(1); expect(costs[0].country).toBe("美国");
  });
  it("collation-equivalent hidden rows block new exact insert", async () => {
    costs = []; const request = await command(); costs = [saved({ storeName: "exact store" })];
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "CONFLICT", message: "COST_SHEET_WRITE_SCOPE_COLLISION" }); expect(writes).toBe(0);
    expect((await repo.options(ctx(), input)).capabilities.save.reasonCode).toBe("scope_collision");
  });
  it("database duplicate key is a known conflict, never unknown/retry", async () => {
    costs = []; const request = await command(); failures.write = { cause: { code: "ER_DUP_ENTRY" } };
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "CONFLICT" }); expect(audits).toEqual([]);
  });
  it.each(["ops_manager", "admin", "super_admin"])("retains %s cost scope role instead of task-only manager rules", async role => {
    actors[0].role = role; const request = await command(ctx(role));
    expect(await repo.save(ctx(role), request)).toMatchObject({ status: "committed" });
  });
  it("assigned specialist is allowed by numeric live ownership, no names shortcut", async () => {
    const context = regular(), request = await command(context); expect(await repo.save(context, request)).toMatchObject({ status: "committed" });
    expect(queries.filter(query => query.sql.includes("FROM operator_name_mappings")).every(query => query.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it("active manual owner overrides mappings but other manual owner denies", async () => {
    const context = regular(); assignments = [owner()]; mappings = []; const request = await command(context);
    assignments = [owner({ assigneeUserId: 4 })];
    await expect(repo.save(context, request)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(writes).toBe(0);
  });
  it.each(["inactive", "foreign", "ambiguous", "unconfirmed"])("rejects %s compound numeric owner mapping before a write", async mode => {
    const context = regular(); lingxing[0].operator = "Alice/Bob"; mappings.push(mapping({ id: 92, externalName: "Bob", systemUserId: 4 }));
    members.push(member({ membershipId: 32, id: 4, userId: 4 }));
    const request = await command(context);
    if (mode === "inactive") members[1].membershipStatus = "inactive";
    if (mode === "foreign") members.pop();
    if (mode === "ambiguous") mappings.push(mapping({ id: 93, externalName: "Bob", systemUserId: 3 }));
    if (mode === "unconfirmed") mappings[1].isConfirmed = 0;
    await expect(repo.save(context, request)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(writes).toBe(0);
  });
  it("revoked membership or owner cannot read an old successful receipt", async () => {
    const context = regular(), request = await command(context); await repo.save(context, request);
    mappings[0].systemUserId = 4;
    await expect(repo.recover(context, { ...input, operationId: uuid, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mappings = [mapping()]; members[0].membershipStatus = "inactive";
    await expect(repo.recover(context, { ...input, operationId: uuid, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("default-disabled option is explicit and save cannot mutate", async () => {
    const request = await command(); enabled = false;
    expect((await repo.options(ctx(), input)).capabilities.save).toMatchObject({ status: "unavailable", reasonCode: "not_enabled_before_release" });
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(writes).toBe(0);
  });
  it("known empty sources never allow orphan-only saving but permit authorized recovery", async () => {
    const request = await command(); lingxing = [];
    const options = await repo.options(ctx(), input); expect(options.snapshotKey).not.toBeNull(); expect(options.capabilities.save.reasonCode).toBe("no_current_facts");
    await expect(repo.save(ctx(), { ...request, expectedSnapshotKey: options.snapshotKey! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repo.recover(ctx(), { ...input, operationId: uuid, decision: "cancel" })).toMatchObject({ status: "cancelled" }); expect(writes).toBe(0);
  });
  it("corrupt storage cannot be edited or silently repaired", async () => {
    costs[0].payload = '{"bad":true}'; const result = await repo.options(ctx(), input);
    expect(result.readResult.status).toBe("corrupt"); expect(result.snapshotKey).toBeNull(); expect(result.capabilities.save.status).toBe("unavailable"); expect(writes).toBe(0);
  });
  it("missing real cost table is explicitly unavailable, not default new", async () => {
    costColumns = []; failures.cost = { code: "ER_NO_SUCH_TABLE" };
    const result = await repo.options(ctx(), input); expect(result.readResult.status).toBe("not_connected"); expect(result.capabilities.save.status).toBe("unavailable"); expect(writes).toBe(0);
  });
  it.each(["actor", "workspace", "role", "member_duplicate", "member_foreign"])("rejects invalid current identity %s", async mode => {
    const request = await command();
    if (mode === "actor") actors[0].status = "inactive";
    if (mode === "workspace") actors[0].defaultWorkspaceId = 8;
    if (mode === "role") actors[0].role = "admin";
    if (mode === "member_duplicate") members.push(member({ membershipId: 99 }));
    if (mode === "member_foreign") members[0].workspaceId = 8;
    await expect(repo.save(ctx(), request)).rejects.toBeDefined(); expect(writes).toBe(0);
  });
  it("forbids other roles even with custom resource policy allow", async () => {
    actors[0].role = "ops_assistant"; assignments = [owner()]; directory = [policy()];
    const context = ctx("ops_assistant"), request = await command(context);
    await expect(repo.save(context, request)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(writes).toBe(0);
  });
  it.each(["partial_unique", "extra_unique", "myisam", "unsigned", "generated", "short_title", "nullable", "audit_unique", "required_column"])("schema capability rejects %s, no optimistic fake availability", async mode => {
    if (mode === "partial_unique") indexes.find(row => row.indexName === "uk_scope")!.prefixLength = 100;
    if (mode === "extra_unique") indexes.push(...index("ops_cost_sheets", "wrong_unique", ["parent_asin"]));
    if (mode === "myisam") engines.find(row => row.tableName === "ops_cost_sheets")!.engine = "MyISAM";
    if (mode === "unsigned") costColumns.find(row => row.columnName === "version")!.columnType = "int unsigned";
    if (mode === "generated") costColumns.find(row => row.columnName === "payload")!.extra = "STORED GENERATED";
    if (mode === "short_title") costColumns.find(row => row.columnName === "parent_asin")!.maxLength = 20;
    if (mode === "nullable") costColumns.find(row => row.columnName === "version")!.isNullable = "YES";
    if (mode === "audit_unique") indexes = indexes.filter(row => row.indexName !== "uk_audit");
    if (mode === "required_column") costColumns.push(column("unexpected", "varchar", { maxLength: 255 }));
    const result = await repo.options(ctx(), input); expect(result.capabilities.save.reasonCode).toBe("schema_not_ready");
    await expect(repo.save(ctx(), { ...input, operationId: uuid, expectedVersion: 12, expectedSnapshotKey: result.snapshotKey!, payload: payload() })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(writes).toBe(0);
  });
  it("source bytes are checked before transferring full text; oversize source is never truncated", async () => {
    bodyBytes = 65537;
    await expect(repo.options(ctx(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queries.some(query => query.sql.includes("AS priceField") && query.sql.includes("FROM lingxing_product_weekly"))).toBe(false);
  });
  it("numeric version exhaustion never advertises save", async () => {
    costs[0].version = 2147483647;
    expect((await repo.options(ctx(), input)).capabilities.save.reasonCode).toBe("version_exhausted");
  });
  it("global grants do not override workspace directory denies, including admin", async () => {
    actors[0].role = "admin"; directory = [policy([], 7), policy(["read", "edit"], null)];
    await expect(repo.options(ctx("admin"), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(writes).toBe(0);
  });
  it("workspace grant takes precedence and explicit edit revoke applies on next save", async () => {
    directory = [policy(["read", "edit"], 7), policy([], null)]; const request = await command();
    directory[0] = policy(["read"]);
    await expect(repo.save(ctx(), request)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(writes).toBe(0);
  });
  it.each(["bad_json", "duplicate", "missing_ops", "huge_native_json", "read_error"])("directory fails closed for %s instead of default fallback", async mode => {
    directory = [policy()];
    if (mode === "bad_json") directory[0].modules = "{bad";
    if (mode === "duplicate") directory.push(policy());
    if (mode === "missing_ops") directory[0].modules = [];
    if (mode === "huge_native_json") directory[0].modules = ["x".repeat(70000)];
    if (mode === "read_error") failures.directory = new Error("missing directory table");
    await expect(repo.options(ctx(), input)).rejects.toBeDefined(); expect(writes).toBe(0);
  });
  it("full payload canonical equality remains lossless for decimal/null/zero", () => {
    expect(operationsCostSheetWriteCanonical(payload())).toContain("12.345"); expect(operationsCostSheetWriteCanonical(payload())).toContain("null");
  });
});
