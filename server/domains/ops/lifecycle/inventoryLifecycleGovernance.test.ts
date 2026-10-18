import { beforeEach, describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql, type SQL } from "drizzle-orm";
import { INVENTORY_LIFECYCLE_LIMITS, inventoryLifecycleSchemaReady, loadInventoryLifecycleState, restoreInventoryLifecycleState, refreshGovernedZeroValueDiscontinuationStatuses } from "./inventoryLifecycleGovernance";

type Row = Record<string, unknown>;
const TABLE = "ops_asin_lifecycle_statuses", DAILY = "ops_asin_daily_snapshots", WEEKLY = "lingxing_product_weekly", BATCH = "ops_external_sync_batches";
const workspaceId = 11, actorUserId = 7, scope = { asin: "B000000001", storeName: "Exact Store", country: "美国" }, stamp = "2026-10-18 10:00:00.000000", nextStamp = "2026-10-18 12:00:00.000000";
const lifecycle = (patch: Row = {}): Row => ({ id: 21, workspaceId, userId: 4, ...scope, parentAsin: "B000000009", status: "discontinued", reason: "three_months_zero", evidenceStartDate: "2026-07-01", evidenceEndDate: "2026-09-28", evidenceDays: 90, evidenceSalesQty: 0, evidenceProfit: "0.00", evidenceMaxInventory: 0, changedBy: null, changedAt: stamp, restoredAt: null, restoreReason: null, createdAt: stamp, updatedAt: stamp, ...patch });
const daily = (patch: Row = {}): Row => ({ id: 1, workspaceId, userId: 4, ...scope, parentAsin: "B000000009", sourceType: "lingxing_mcp", sourceStoreId: "1", reportDate: "2026-07-01", salesQty: 0, orderProfit: "0.00", fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, isValid: 1, sourceRowHash: "a".repeat(64), ...patch });
const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const batch = (patch: Row = {}): Row => ({ id: 31, workspaceId, source: "lingxing_mcp", dataDomain: "product_performance_daily", status: "applied", scope: { storeId: "ALL_US", startDate: "2026-07-01", endDate: "2026-09-28" }, summary: { storesExpected: 1, storesRead: 1, datesRead: 90, storeDateWindowsExpected: 90, storeDateWindowsRead: 90, capped: false, pageTruncations: 0, skippedRows: 0 }, stores: [{ sid: "1", name: scope.storeName, country: "US" }], rawSource: "lingxing_mcp", rawDataDomain: "product_performance_daily", ...patch });
const weeks = () => Array.from({ length: 13 }, (_, i) => ({ id: i + 1, workspaceId, ...scope, weekStartDate: addDays("2026-06-29", i * 7), weekEndDate: addDays("2026-06-29", i * 7 + 6), salesQty: 0, orderProfit: "0.00", fbaAvailable: 0, fbaInTransit: 0 }));
const column = (columnName: string, dataType: string, patch: Row = {}) => ({ columnName, dataType, columnType: dataType, isNullable: "NO", extra: columnName === "id" ? "auto_increment" : "", defaultValue: null, maxLength: null, collation: ["varchar", "enum"].includes(dataType) ? "utf8mb4_unicode_ci" : null, ...patch });
function metadata(): Row[] {
  return [...["id", "user_id", "evidence_days", "evidence_sales_qty", "evidence_max_inventory"].map(name => column(name, "int")), ...["workspaceId", "changed_by"].map(name => column(name, "int", { isNullable: "YES" })),
    ...Object.entries({ asin: 20, store_name: 200, country: 50 }).map(([name, maxLength]) => column(name, "varchar", { maxLength })), ...Object.entries({ parent_asin: 20, reason: 80, evidence_start_date: 10, evidence_end_date: 10, restore_reason: 500 }).map(([name, maxLength]) => column(name, "varchar", { maxLength, isNullable: "YES" })),
    column("status", "enum", { columnType: "enum('active','discontinued')" }), column("evidence_profit", "decimal", { columnType: "decimal(14,2)" }),
    ...["changed_at", "created_at", "updated_at"].map(name => column(name, "timestamp", { defaultValue: "CURRENT_TIMESTAMP", extra: name === "updated_at" ? "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" : "DEFAULT_GENERATED" })), column("restored_at", "timestamp", { isNullable: "YES" })];
}
const indexesFor = (name: string, fields: string[], unique = false) => fields.map((columnName, i) => ({ indexName: name, columnName, sequence: i + 1, nonUnique: unique ? 0 : 1, prefixLength: null }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
let states: Row[], dailyRows: Row[], weeklyRows: Row[], batches: Row[], columns: Row[], indexes: Row[], engines: Row[], queries: { sql: string; params: unknown[] }[], writes: number, bodyBytes: number, collision: string | null, corruption: string | null, workspaceStatus: string, commitLost: boolean;
let beforeQuery: ((sql: string) => Promise<void>) | null, queue: Promise<void>;
function chosen(text: string, values: unknown[], all: Row[]): Row[] {
  return all.filter(row => row.workspaceId === values[0] && (!text.includes("AND asin=?") || String(row.asin).toLowerCase() === String(values[1]).toLowerCase()) && (!text.includes("AND store_name=?") || String(row.storeName).toLowerCase() === String(values[2]).toLowerCase()) && (!text.includes("source_type<>'lx_inventory_mcp'") || row.sourceType !== "lx_inventory_mcp"));
}
async function execute(statement: SQL): Promise<unknown> {
  const parsed = new MySqlDialect().sqlToQuery(statement), text = parsed.sql, v = parsed.params; queries.push(parsed); if (beforeQuery) await beforeQuery(text);
  if (text.includes("information_schema.TABLES")) return [text.includes("TABLE_NAME IN ('ops_asin_lifecycle_statuses','workspaces')") ? engines.filter(row => [TABLE, "workspaces"].includes(String(row.tableName))) : engines, []];
  if (text.includes("information_schema.COLUMNS")) return [columns, []];
  if (text.includes("information_schema.STATISTICS")) return [indexes, []];
  if (text.includes("FROM workspaces")) return [[{ id: workspaceId, status: workspaceStatus }], []];
  const table = [TABLE, DAILY, WEEKLY, BATCH].find(name => text.includes(`FROM ${name}`));
  if (table) {
    if (text.includes("AS identityCount")) return [collision === table ? [{ identityCount: 2 }] : [], []];
    const all = table === TABLE ? states : table === DAILY ? dailyRows : table === WEEKLY ? weeklyRows : batches, rows = chosen(text, v, all).sort((a, b) => Number(a.id) - Number(b.id));
    return [text.includes("AS bodyBytes") ? rows.map(row => ({ id: row.id, bodyBytes })) : structuredClone(rows), []];
  }
  if (text.startsWith(`UPDATE ${TABLE}`)) {
    writes++; const manual = text.includes("status='active'"), row = states.find(row => row.id === v[manual ? 4 : 10]); if (!row || manual && row.status !== "discontinued") return [{ affectedRows: 0 }, []];
    if (manual) Object.assign(row, { status: "active", changedBy: v[0], changedAt: nextStamp, restoredAt: nextStamp, restoreReason: v[3], updatedAt: nextStamp });
    else Object.assign(row, Object.fromEntries(["status", "reason", "parentAsin", "evidenceStartDate", "evidenceEndDate", "evidenceDays", "evidenceSalesQty", "evidenceProfit", "evidenceMaxInventory"].map((name, i) => [name, v[i]])), { changedBy: null, changedAt: nextStamp, restoredAt: null, restoreReason: null, updatedAt: nextStamp });
    if (corruption) row[corruption] = corruption.includes("Qty") || corruption === "evidenceMaxInventory" ? 999 : "corrupted"; return [{ affectedRows: 1 }, []];
  }
  if (text.startsWith(`INSERT INTO ${TABLE}`)) {
    writes++; const row = lifecycle({ id: 22, workspaceId: v[0], userId: v[1], asin: v[2], storeName: v[3], country: v[4], createdAt: nextStamp, updatedAt: nextStamp, changedAt: nextStamp });
    ["status", "reason", "parentAsin", "evidenceStartDate", "evidenceEndDate", "evidenceDays", "evidenceSalesQty", "evidenceProfit", "evidenceMaxInventory"].forEach((name, i) => { row[name] = v[i + 5]; }); states.push(row); if (corruption) row[corruption] = "corrupted"; return [{ affectedRows: 1, insertId: 22 }, []];
  }
  throw new Error(`Unexpected SQL ${text}`);
}
// The deterministic fixture acquires its shared lock only when production SQL
// actually executes workspace FOR UPDATE, not merely on entering transaction().
const db = { transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
  let release: (() => void) | null = null, original: Row[] | null = null;
  const tx = { execute: async (statement: SQL) => {
    const text = new MySqlDialect().sqlToQuery(statement).sql;
    if (text.includes("FROM workspaces") && text.endsWith("FOR UPDATE") && !release) { const previous = queue, unlocked = deferred(); queue = previous.then(() => unlocked.promise); await previous; release = unlocked.resolve; original = structuredClone(states); }
    return execute(statement);
  } };
  try { const result = await callback(tx); if (commitLost) { commitLost = false; original = null; throw new Error("ACK lost"); } return result; }
  catch (error) { if (original) states = original; throw error; }
  finally { if (release) (release as () => void)(); }
} };
const restore = () => db.transaction(async tx => { await tx.execute(sql`SELECT id,status FROM workspaces WHERE id=${workspaceId} FOR UPDATE`); return restoreInventoryLifecycleState(tx, { workspaceId, actorUserId, scope, reason: "人工经营决定：继续销售", now: new Date("2026-10-18T12:00:00Z") }); });
beforeEach(() => {
  states = [lifecycle()]; dailyRows = [daily()]; weeklyRows = []; batches = [batch()]; columns = metadata(); indexes = [...indexesFor("PRIMARY", ["id"], true), ...indexesFor("scope", ["workspaceId", "asin", "store_name", "country"])]; engines = [TABLE, DAILY, WEEKLY, BATCH, "workspaces"].map(tableName => ({ tableName, engine: "InnoDB" }));
  queries = []; writes = 0; bodyBytes = 1024; collision = null; corruption = null; workspaceStatus = "active"; commitLost = false; beforeQuery = null; queue = Promise.resolve();
});

describe("complete exact lifecycle state and manual restore", () => {
  it("preserves all evidence and original identity while restoring with the numeric actor", async () => { const before = structuredClone(states[0]), value = await restore(); expect(value.row).toMatchObject({ ...before, status: "active", changedBy: actorUserId, changedAt: nextStamp, restoredAt: nextStamp, restoreReason: "人工经营决定：继续销售", updatedAt: nextStamp }); expect(value.rows).toEqual([value.row]); expect(queries.filter(q => q.sql.includes(`FROM ${TABLE}`) && !q.sql.includes("identityCount")).every(q => !q.sql.includes("LIMIT 1 FOR"))).toBe(true); });
  it.each(["duplicate", "country", "case", "db_collation", "malformed"])("rejects %s historical state without changing it", async kind => { if (kind === "duplicate") states.push(lifecycle({ id: 22 })); if (kind === "country") states.push(lifecycle({ id: 22, country: "US" })); if (kind === "case") states[0].storeName = "exact store"; if (kind === "db_collation") collision = TABLE; if (kind === "malformed") states[0].evidenceProfit = null; await expect(restore()).rejects.toThrow(); expect(writes).toBe(0); });
  it("does not normalize a sole raw country spelling or merge another market", async () => { states.push(lifecycle({ id: 22, country: "CA" })); const value = await restore(); expect(value.row?.country).toBe("美国"); expect(value.rows).toHaveLength(1); expect(states[1].status).toBe("discontinued"); });
  it.each(["", "x", "x".repeat(501)])("rejects invalid reason before writing", async reason => { await expect(restoreInventoryLifecycleState({ execute }, { workspaceId, actorUserId, scope, reason })).rejects.toThrow(); expect(writes).toBe(0); });
  it("cannot restore a missing or already active state", async () => { states = []; await expect(restore()).rejects.toThrow("NOT_DISCONTINUED"); states = [lifecycle({ status: "active" })]; await expect(restore()).rejects.toThrow("NOT_DISCONTINUED"); expect(writes).toBe(0); });
  it("rejects read-budget excess before full evidence payload loading", async () => { bodyBytes = INVENTORY_LIFECYCLE_LIMITS.bytes + 1; await expect(restore()).rejects.toThrow("SOURCE_LIMIT"); expect(queries.some(q => q.sql.startsWith("SELECT id,workspaceId"))).toBe(false); });
  it("keeps full raw timestamps and evidence even when they are historical", async () => { states[0].changedAt = "2025-01-01 03:04:05.123456"; expect((await loadInventoryLifecycleState({ execute }, workspaceId, scope)).row?.changedAt).toBe("2025-01-01 03:04:05.123456"); });
  it.each(["reason", "evidenceSalesQty", "evidenceMaxInventory", "parentAsin", "createdAt"])("rolls back manual restoration if readback corrupts preserved %s", async field => { corruption = field; const before = structuredClone(states); await expect(restore()).rejects.toThrow(); expect(states).toEqual(before); });
});

describe("governed auto-discontinuation admission and exact coverage", () => {
  it("requires real transactions and an active workspace", async () => { await expect(refreshGovernedZeroValueDiscontinuationStatuses({}, workspaceId)).rejects.toThrow("TRANSACTION_REQUIRED"); workspaceStatus = "inactive"; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow("WORKSPACE_UNAVAILABLE"); expect(writes).toBe(0); });
  it("derives daily evidence only for 90 proved dates and preserves raw old source", async () => { states = []; const before = structuredClone({ dailyRows, batches }); expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ considered: 1, changed: 1 }); expect(states[0]).toMatchObject({ status: "discontinued", evidenceDays: 90, evidenceStartDate: "2026-07-01", evidenceEndDate: "2026-09-28", evidenceProfit: "0.00" }); expect({ dailyRows, batches }).toEqual(before); });
  it("complete daily evidence takes priority over disagreeing weekly evidence", async () => { dailyRows.push(daily({ id: 2, reportDate: "2026-09-28", salesQty: 1 })); weeklyRows = weeks(); await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId); expect(states[0]).toMatchObject({ status: "active", reason: "non_zero_evidence", evidenceSalesQty: 1, evidenceDays: 90 }); });
  it("uses complete valid 13-week fallback when daily store proof is absent", async () => { batches = []; weeklyRows = weeks(); await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId); expect(states[0]).toMatchObject({ status: "discontinued", evidenceDays: 91, evidenceStartDate: "2026-06-29" }); });
  it("never turns insufficient history into automatic active status", async () => { batches = []; const before = structuredClone(states); expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ insufficient: 1, changed: 0 }); expect(states).toEqual(before); });
  it("excludes dedicated inventory facts entirely", async () => { states = []; dailyRows = [daily({ sourceType: "lx_inventory_mcp", salesQty: null, orderProfit: null })]; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ considered: 0, changed: 0 }); expect(states).toEqual([]); });
  it("single-store complete collection cannot zero-fill another exact store", async () => { states = [lifecycle({ storeName: "Other Store" })]; dailyRows = [daily({ storeName: "Other Store", sourceStoreId: "2" })]; batches[0].scope = { storeId: "1", startDate: "2026-07-01", endDate: "2026-09-28" }; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ insufficient: 1, changed: 0 }); expect(states[0].status).toBe("discontinued"); });
  it("US complete collection cannot zero-fill Canada even when names/sid coincide", async () => { states[0].country = "CA"; dailyRows[0].country = "CA"; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ insufficient: 1, changed: 0 }); });
  it.each([null, undefined])("missing old store proof %s does not assert workspace coverage", async stores => { batches[0].stores = stores ?? null; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ insufficient: 1, changed: 0 }); });
  it("rejects ambiguous store mappings rather than choosing the first", async () => { (batches[0].stores as Row[]).push({ sid: "2", name: scope.storeName, country: "US" }); Object.assign(batches[0].summary as Row, { storesExpected: 2, storesRead: 2, storeDateWindowsExpected: 180, storeDateWindowsRead: 180 }); await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow("STORE_COVERAGE_AMBIGUOUS"); expect(writes).toBe(0); });
  it.each(["rawSource", "rawDataDomain", "scopeStore"])("rejects forged producer %s", async field => { if (field === "scopeStore") (batches[0].scope as Row).storeId = "unrelated"; else batches[0][field] = "wrong"; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow("STORE_PROVENANCE_INVALID"); expect(writes).toBe(0); });
  it("never reads unassigned-workspace weekly facts as write authority", async () => { batches = []; weeklyRows = weeks().map(row => ({ ...row, workspaceId: null })); expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ insufficient: 1, changed: 0 }); expect(queries.filter(q => q.sql.includes(`FROM ${WEEKLY}`)).every(q => q.sql.includes("workspaceId=?") && !q.sql.includes("IS NULL"))).toBe(true); });
  it.each(["salesQty", "orderProfit", "fbaAvailable", "fbaInTransit", "availableStock", "isValid", "reportDate"])("does not turn malformed/unknown daily %s into zero", async field => { dailyRows[0][field] = field === "reportDate" ? "2026-02-30" : null; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow("SOURCE_INVALID"); expect(writes).toBe(0); });
  it.each(["duplicateDaily", "duplicateWeek", "weekGap", "weekUnknown", "countryAlias", "collation", "badSummary", "oversize"])("rejects complete-source %s before any write", async kind => { if (kind === "duplicateDaily") dailyRows.push(daily({ id: 2 })); if (kind === "duplicateWeek") { batches = []; weeklyRows = [...weeks(), { ...weeks()[0], id: 99 }]; } if (kind === "weekGap") { batches = []; weeklyRows = weeks(); weeklyRows[3].weekStartDate = "2026-07-21"; } if (kind === "weekUnknown") { batches = []; weeklyRows = weeks(); weeklyRows[0].orderProfit = null; } if (kind === "countryAlias") dailyRows.push(daily({ id: 2, country: "US" })); if (kind === "collation") collision = DAILY; if (kind === "badSummary") (batches[0].summary as Row).pageTruncations = null; if (kind === "oversize") bodyBytes = INVENTORY_LIFECYCLE_LIMITS.bytes + 1; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow(); expect(writes).toBe(0); });
  it.each(["capped", "skipped", "windowGap"])("does not synthesize zeros from %s applied coverage", async kind => { if (kind === "capped") (batches[0].summary as Row).capped = true; if (kind === "skipped") (batches[0].summary as Row).skippedRows = 1; if (kind === "windowGap") (batches[0].summary as Row).storeDateWindowsRead = 89; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ changed: 0, insufficient: 1 }); });
  it.each(["reason", "evidenceSalesQty", "evidenceMaxInventory", "parentAsin", "createdAt"])("rolls back auto readback corruption of %s", async field => { corruption = field; const before = structuredClone(states); await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow(); expect(states).toEqual(before); });
});

describe("actual shared workspace lock SQL closes manual/auto races", () => {
  it("auto reads, manual waits, auto writes, then manual wins permanently", async () => {
    const reached = deferred(), release = deferred(); let once = true;
    beforeQuery = async text => { if (once && text.startsWith("SELECT id,workspaceId") && text.includes(`FROM ${TABLE}`)) { once = false; reached.resolve(); await release.promise; } };
    const auto = refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId); await reached.promise; const manual = restore(); await Promise.resolve(); expect(writes).toBe(0); release.resolve(); await auto; await manual;
    const restored = structuredClone(states); expect(restored[0]).toMatchObject({ status: "active", restoredAt: nextStamp });
    beforeQuery = null; expect(await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).toMatchObject({ protected: 1, changed: 0 }); expect(states).toEqual(restored);
  });
  it("manual reads, auto waits, manual restores, then auto sees and preserves the fresh decision", async () => {
    const reached = deferred(), release = deferred(); let once = true;
    beforeQuery = async text => { if (once && text.startsWith("SELECT id,workspaceId") && text.includes(`FROM ${TABLE}`)) { once = false; reached.resolve(); await release.promise; } };
    const manual = restore(); await reached.promise; const auto = refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId); release.resolve(); await manual; expect(await auto).toMatchObject({ protected: 1, changed: 0 }); expect(states[0]).toMatchObject({ status: "active", restoredAt: nextStamp }); expect(writes).toBe(1);
  });
  it("two missing-row refreshes cannot insert two lifecycle rows", async () => { states = []; await Promise.all([refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId), refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)]); expect(states).toHaveLength(1); expect(queries.filter(q => q.sql.startsWith(`INSERT INTO ${TABLE}`))).toHaveLength(1); expect(queries.filter(q => q.sql.includes("FROM workspaces")).every(q => q.sql.endsWith("FOR UPDATE"))).toBe(true); });
  it("an uncertain transaction commit is not reported as success or automatically retried", async () => { commitLost = true; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow("ACK lost"); expect(writes).toBe(1); });
});

describe("lifecycle native schema admission without DDL", () => {
  it("accepts native generated timestamps and optional exact complete unique scope", async () => { expect(await inventoryLifecycleSchemaReady({ execute })).toBe(true); indexes.push(...indexesFor("exact_unique", ["workspaceId", "asin", "store_name", "country"], true)); expect(await inventoryLifecycleSchemaReady({ execute })).toBe(true); });
  it.each(["engine", "missingColumn", "badDecimal", "generated", "requiredColumn", "prefix", "unique", "nullClear", "wrongEnum", "inactiveWorkspace"])("fails closed for %s", async kind => { if (kind === "engine") engines[0].engine = "MyISAM"; if (kind === "missingColumn") columns = columns.filter(row => row.columnName !== "restore_reason"); if (kind === "badDecimal") columns.find(row => row.columnName === "evidence_profit")!.columnType = "decimal(10,2)"; if (kind === "generated") columns.find(row => row.columnName === "changed_at")!.extra = "STORED GENERATED"; if (kind === "requiredColumn") columns.push(column("new_required", "int")); if (kind === "prefix") indexes[1].prefixLength = 3; if (kind === "unique") indexes.push(...indexesFor("wrong_unique", ["asin"], true)); if (kind === "nullClear") columns.find(row => row.columnName === "restored_at")!.isNullable = "NO"; if (kind === "wrongEnum") columns.find(row => row.columnName === "status")!.columnType = "enum('active','discontinued','other')"; if (kind === "inactiveWorkspace") workspaceStatus = "inactive"; await expect(refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)).rejects.toThrow(); expect(writes).toBe(0); expect(queries.some(q => /^(ALTER|CREATE|DROP)/u.test(q.sql))).toBe(false); });
});
