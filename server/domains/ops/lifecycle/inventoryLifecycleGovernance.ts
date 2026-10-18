import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "../../../repositories/dbClient";
import { normalizeMarketplaceCode } from "../../../../shared/marketplaceIdentity";
import { buildCompleteCoverageEvidence, type DailyPerformanceEvidenceRow } from "./completeCoverageEvidence";
import { collectCompletedDailyBackfillDates } from "../historicalBackfillCoverage";
import { evaluateThreeMonthZeroDiscontinuation, evaluateThreeMonthZeroWeeklyDiscontinuation, type ZeroValueDiscontinuationResult } from "./zeroValueDiscontinuation";

const TABLE = "ops_asin_lifecycle_statuses", DAILY = "ops_asin_daily_snapshots", WEEKLY = "lingxing_product_weekly", BATCH = "ops_external_sync_batches";
export const INVENTORY_LIFECYCLE_LIMITS = { rows: 100_000, states: 10_000, batches: 10_000, coveredStoreDates: 1_000_000, bytes: 64 * 1024 * 1024, batchBytes: 8 * 1024 * 1024, scopeRows: 1000 } as const;
export class InventoryLifecycleGovernanceError extends Error {
  constructor(readonly code: string) { super(`INVENTORY_LIFECYCLE_${code}`); this.name = "InventoryLifecycleGovernanceError"; }
}
function fail(code: string): never { throw new InventoryLifecycleGovernanceError(code); }
const idSchema = z.number().int().positive().max(2147483647);
const qtySchema = z.number().int().min(0).max(2147483647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) && Buffer.from(value, "utf8").toString("utf8") === value);
const asinSchema = text(20).regex(/^[A-Za-z0-9]+$/u);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const valueDate = new Date(`${value}T00:00:00.000Z`);
  return value >= "1900-01-01" && value <= "9999-12-31" && Number.isFinite(valueDate.getTime()) && valueDate.toISOString().slice(0, 10) === value;
});
const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u).refine(value => dateSchema.safeParse(value.slice(0, 10)).success && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
const moneySchema = z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u);
export const InventoryLifecycleScopeSchema = z.object({ asin: asinSchema, storeName: text(200), country: text(50) }).strict();
export type InventoryLifecycleScope = z.infer<typeof InventoryLifecycleScopeSchema>;
export const InventoryLifecycleRowSchema = z.object({
  id: idSchema, workspaceId: idSchema, userId: idSchema, asin: asinSchema, parentAsin: asinSchema.nullable(), storeName: text(200), country: text(50),
  status: z.enum(["active", "discontinued"]), reason: z.string().max(80).nullable(), evidenceStartDate: dateSchema.nullable(), evidenceEndDate: dateSchema.nullable(),
  evidenceDays: qtySchema, evidenceSalesQty: qtySchema, evidenceProfit: moneySchema, evidenceMaxInventory: qtySchema,
  changedBy: idSchema.nullable(), changedAt: timestampSchema, restoredAt: timestampSchema.nullable(), restoreReason: z.string().max(500).nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().superRefine((row, ctx) => {
  if (row.evidenceStartDate !== null && row.evidenceEndDate !== null && row.evidenceStartDate > row.evidenceEndDate) ctx.addIssue({ code: "custom", message: "Invalid evidence range" });
  if (row.restoredAt !== null && (row.status !== "active" || row.changedBy === null || row.restoreReason === null || row.restoreReason.trim().length < 2)) ctx.addIssue({ code: "custom", message: "Invalid manual restoration" });
});
export type InventoryLifecycleRow = z.infer<typeof InventoryLifecycleRowSchema>;
export type InventoryLifecycleState = { workspaceId: number; scope: InventoryLifecycleScope; row: InventoryLifecycleRow | null; rows: InventoryLifecycleRow[] };
type Row = Record<string, unknown>;
export interface InventoryLifecycleDatabase { transaction?<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> }
function statement(source: string, values: unknown[] = []): SQL {
  const parts = source.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function query(tx: DbExecutor, source: string, values: unknown[] = []): Promise<Row[]> {
  const result = await tx.execute(statement(source, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("DATABASE_RESULT_INVALID");
  return result[0];
}
async function write(tx: DbExecutor, source: string, values: unknown[]): Promise<number | null> {
  const result = await tx.execute(statement(source, values)), header = Array.isArray(result) ? result[0] : null;
  if (!header || header.affectedRows !== 1) fail("WRITE_UNVERIFIABLE");
  return idSchema.safeParse(header.insertId).success ? header.insertId as number : null;
}
/** No toJSON, getters, sparse arrays, native Date or implicit numeric coercion. */
function boundedJson(value: unknown, bytes = INVENTORY_LIFECYCLE_LIMITS.bytes): void {
  let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 4_000_000 || depth > 24) fail("SOURCE_LIMIT");
    if (typeof item === "string") { if (Buffer.from(item, "utf8").toString("utf8") !== item) fail("SOURCE_INVALID"); return; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || item === null || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) fail("SOURCE_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).some(key => typeof key !== "string") || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) fail("SOURCE_INVALID");
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) fail("SOURCE_INVALID");
      for (let index = 0; index < item.length; index++) { if (!Object.hasOwn(item, index)) fail("SOURCE_INVALID"); visit(item[index], depth + 1); }
    } else for (const descriptor of Object.values(descriptors)) visit(descriptor.value, depth + 1);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > bytes) fail("SOURCE_LIMIT");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) fail("SOURCE_INVALID"); return result.data; }
const dateProjection = (column: string, alias: string) => `DATE_FORMAT(${column},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const lifecycleProjection = `id,workspaceId,user_id AS userId,asin,parent_asin AS parentAsin,store_name AS storeName,country,status,reason,evidence_start_date AS evidenceStartDate,evidence_end_date AS evidenceEndDate,evidence_days AS evidenceDays,evidence_sales_qty AS evidenceSalesQty,evidence_profit AS evidenceProfit,evidence_max_inventory AS evidenceMaxInventory,changed_by AS changedBy,${dateProjection("changed_at", "changedAt")},${dateProjection("restored_at", "restoredAt")},restore_reason AS restoreReason,${dateProjection("created_at", "createdAt")},${dateProjection("updated_at", "updatedAt")}`;
const key = (scope: InventoryLifecycleScope) => JSON.stringify([scope.asin, scope.storeName, scope.country]);
function aliasKey(scope: InventoryLifecycleScope): string { return JSON.stringify([scope.asin.normalize("NFKC").toLocaleUpperCase("en-US"), scope.storeName.normalize("NFKC").toLocaleUpperCase("en-US"), normalizeMarketplaceCode(scope.country)]); }
function checkScopes(scopes: InventoryLifecycleScope[]): void {
  const aliases = new Map<string, string>();
  for (const scope of scopes) { const alias = aliasKey(scope), exact = key(scope), previous = aliases.get(alias); if (previous !== undefined && previous !== exact) fail("SCOPE_ALIAS_CONFLICT"); aliases.set(alias, exact); }
}
async function preflight(tx: DbExecutor, table: string, where: string, values: unknown[], columns: string[], limit: number, byteBudget = INVENTORY_LIFECYCLE_LIMITS.bytes): Promise<number[]> {
  const rows = await query(tx, `SELECT id,${columns.map(column => `COALESCE(OCTET_LENGTH(CAST(${column} AS CHAR CHARACTER SET utf8mb4)),0)`).join("+")}+1024 AS bodyBytes FROM ${table} WHERE ${where} ORDER BY id LIMIT ${limit + 1} FOR UPDATE`, values);
  if (rows.length > limit || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !idSchema.safeParse(row.id).success || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0) || rows.reduce((total, row) => total + Number(row.bodyBytes), 0) > byteBudget) fail("SOURCE_LIMIT");
  return rows.map(row => row.id as number);
}
async function collisionCheck(tx: DbExecutor, table: string, where: string, values: unknown[]): Promise<void> {
  const result = await query(tx, `SELECT COUNT(DISTINCT BINARY asin,BINARY store_name,BINARY country) AS identityCount FROM ${table} WHERE ${where} GROUP BY asin,store_name,country HAVING identityCount>1 LIMIT 1 FOR UPDATE`, values);
  if (result.length) fail("COLLATION_SCOPE_CONFLICT");
}
function checkSelection(rows: Row[], selected: number[]): void { if (rows.length !== selected.length || rows.some((row, index) => row.id !== selected[index])) fail("SOURCE_CHANGED"); }
const lifecycleColumns = ["asin", "parent_asin", "store_name", "country", "reason", "restore_reason"];
function parseLifecycleRows(raw: Row[], workspaceId: number): InventoryLifecycleRow[] {
  boundedJson(raw); const rows = raw.map(row => parse(InventoryLifecycleRowSchema, row));
  if (rows.some(row => row.workspaceId !== workspaceId) || new Set(rows.map(row => row.id)).size !== rows.length) fail("SCOPE_MISMATCH");
  checkScopes(rows); if (new Set(rows.map(key)).size !== rows.length) fail("DUPLICATE_LIFECYCLE");
  return rows;
}
/** Admission only, never DDL. Call once in the caller's locked transaction. */
export async function inventoryLifecycleSchemaReady(tx: DbExecutor): Promise<boolean> {
  const engines = await query(tx, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_asin_lifecycle_statuses','workspaces')");
  if (engines.length !== 2 || [TABLE, "workspaces"].some(table => engines.filter(row => row.tableName === table && row.engine === "InnoDB").length !== 1)) return false;
  const cols = await query(tx, "SELECT COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_asin_lifecycle_statuses'");
  if (cols.length > 100 || new Set(cols.map(row => row.columnName)).size !== cols.length) return false;
  const get = (name: string) => cols.find(row => row.columnName === name);
  const nullable = (row: Row | undefined, optional: boolean) => !!row && row.isNullable === (optional ? "YES" : "NO");
  const collations = ["utf8mb4_general_ci", "utf8mb4_unicode_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"];
  const integer = (name: string, optional = false) => { const row = get(name); return nullable(row, optional) && row!.dataType === "int" && /^int(?:\(\d+\))?$/u.test(String(row!.columnType)) && row!.extra === (name === "id" ? "auto_increment" : ""); };
  const varchar = (name: string, length: number, optional = false) => { const row = get(name); return nullable(row, optional) && row!.dataType === "varchar" && row!.maxLength === length && row!.extra === "" && collations.includes(String(row!.collation)); };
  const timestamp = (name: string, optional = false) => { const row = get(name); return nullable(row, optional) && row!.dataType === "timestamp" && !/VIRTUAL GENERATED|STORED GENERATED/iu.test(String(row!.extra)); };
  const status = get("status"), profit = get("evidence_profit");
  const supplied = ["id", "workspaceId", "user_id", "asin", "parent_asin", "store_name", "country", "status", "reason", "evidence_start_date", "evidence_end_date", "evidence_days", "evidence_sales_qty", "evidence_profit", "evidence_max_inventory", "changed_by", "changed_at", "restored_at", "restore_reason", "created_at", "updated_at"];
  if (!["id", "user_id", "evidence_days", "evidence_sales_qty", "evidence_max_inventory"].every(name => integer(name)) || !(integer("workspaceId", true) || integer("workspaceId")) || !integer("changed_by", true)
    || !varchar("asin", 20) || !varchar("parent_asin", 20, true) || !varchar("store_name", 200) || !varchar("country", 50) || !varchar("reason", 80, true) || !varchar("evidence_start_date", 10, true) || !varchar("evidence_end_date", 10, true) || !varchar("restore_reason", 500, true)
    || !["changed_at", "created_at", "updated_at"].every(name => timestamp(name)) || !timestamp("restored_at", true) || ["created_at", "updated_at"].some(name => get(name)!.defaultValue === null)
    || !nullable(status, false) || status!.dataType !== "enum" || status!.columnType !== "enum('active','discontinued')" || status!.extra !== "" || !collations.includes(String(status!.collation))
    || !nullable(profit, false) || profit!.dataType !== "decimal" || profit!.columnType !== "decimal(14,2)" || profit!.extra !== ""
    || cols.some(row => !supplied.includes(String(row.columnName)) && row.isNullable !== "YES" && row.defaultValue === null && !/auto_increment|generated/iu.test(String(row.extra)))) return false;
  const indexes = await query(tx, "SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_asin_lifecycle_statuses' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
  if (indexes.length > 100 || indexes.some(row => typeof row.indexName !== "string" || !idSchema.safeParse(row.sequence).success || ![0, 1].includes(row.nonUnique as number) || row.prefixLength !== null)) return false;
  const groups = [...new Set(indexes.map(row => row.indexName))].map(name => indexes.filter(row => row.indexName === name).sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  return groups.some(group => group[0].indexName === "PRIMARY" && group.length === 1 && group[0].columnName === "id" && group[0].nonUnique === 0)
    && groups.filter(group => group[0].nonUnique === 0).every(group => group[0].indexName === "PRIMARY" && group.length === 1 && group[0].columnName === "id" || group.length === 4 && ["workspaceId", "asin", "store_name", "country"].every((column, index) => group[index].columnName === column && group[index].sequence === index + 1))
    && groups.some(group => ["workspaceId", "asin", "store_name", "country"].every((column, index) => group[index]?.columnName === column && group[index]?.sequence === index + 1));
}
/** Caller owns a real transaction and has already locked workspace, then actor.
 * All country variants in the database's actual collation are inspected. */
export async function loadInventoryLifecycleState(tx: DbExecutor, workspaceId: number, rawScope: InventoryLifecycleScope): Promise<InventoryLifecycleState> {
  parse(idSchema, workspaceId); boundedJson(rawScope); const scope = parse(InventoryLifecycleScopeSchema, rawScope);
  const where = "workspaceId=? AND asin=? AND store_name=?", values = [workspaceId, scope.asin, scope.storeName];
  const selected = await preflight(tx, TABLE, where, values, lifecycleColumns, INVENTORY_LIFECYCLE_LIMITS.scopeRows);
  await collisionCheck(tx, TABLE, where, values);
  const raw = await query(tx, `SELECT ${lifecycleProjection} FROM ${TABLE} WHERE ${where} ORDER BY id LIMIT ${INVENTORY_LIFECYCLE_LIMITS.scopeRows + 1} FOR UPDATE`, values); checkSelection(raw, selected);
  const candidates = parseLifecycleRows(raw, workspaceId); checkScopes([scope, ...candidates]);
  if (candidates.some(row => row.asin !== scope.asin || row.storeName !== scope.storeName)) fail("COLLATION_SCOPE_CONFLICT");
  const rows = candidates.filter(row => row.country === scope.country);
  return { workspaceId, scope, row: rows[0] ?? null, rows };
}
export async function restoreInventoryLifecycleState(tx: DbExecutor, input: { workspaceId: number; actorUserId: number; scope: InventoryLifecycleScope; reason: string; now?: Date }): Promise<InventoryLifecycleState> {
  parse(idSchema, input.actorUserId); const reason = parse(z.string().trim().min(2).max(500), input.reason);
  const now = input.now ?? new Date(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INVALID_TIMESTAMP");
  const state = await loadInventoryLifecycleState(tx, input.workspaceId, input.scope);
  if (!state.row || state.row.status !== "discontinued") fail("NOT_DISCONTINUED");
  await write(tx, `UPDATE ${TABLE} SET status='active',changed_by=?,changed_at=?,restored_at=?,restore_reason=? WHERE id=? AND workspaceId=? AND status='discontinued'`, [input.actorUserId, now, now, reason, state.row.id, input.workspaceId]);
  const result = await loadInventoryLifecycleState(tx, input.workspaceId, input.scope), row = result.row;
  if (!row || row.id !== state.row.id || row.status !== "active" || row.changedBy !== input.actorUserId || row.restoredAt === null || row.changedAt !== row.restoredAt || row.restoreReason !== reason) fail("WRITE_UNVERIFIABLE");
  for (const field of ["id", "workspaceId", "userId", "asin", "parentAsin", "storeName", "country", "reason", "evidenceStartDate", "evidenceEndDate", "evidenceDays", "evidenceSalesQty", "evidenceProfit", "evidenceMaxInventory", "createdAt"] as const) if (row[field] !== state.row[field]) fail("EVIDENCE_CHANGED");
  return result;
}

const dailySchema = z.object({ id: idSchema, workspaceId: idSchema, userId: idSchema, asin: asinSchema, parentAsin: asinSchema, storeName: text(200), country: text(50), reportDate: dateSchema,
  sourceType: z.enum(["lingxing", "lingxing_mcp", "saihu"]), sourceStoreId: text(64).nullable(), salesQty: qtySchema, orderProfit: moneySchema, fbaAvailable: qtySchema, availableStock: qtySchema, fbaInTransit: qtySchema, isValid: z.literal(1), sourceRowHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type Daily = z.infer<typeof dailySchema>;
const weeklySchema = z.object({ id: idSchema, workspaceId: idSchema, asin: text(2000).nullable(), storeName: text(200).nullable(), country: text(50).nullable(), weekStartDate: dateSchema, weekEndDate: dateSchema, salesQty: qtySchema.nullable(), orderProfit: moneySchema.nullable(), fbaAvailable: qtySchema.nullable(), fbaInTransit: qtySchema.nullable() }).strict();
type Weekly = z.infer<typeof weeklySchema>;
const batchSchema = z.object({ id: idSchema, workspaceId: idSchema, source: z.literal("lingxing_mcp"), dataDomain: z.literal("product_performance_daily"), status: text(32), scope: z.record(z.string(), z.unknown()), summary: z.record(z.string(), z.unknown()).nullable(), stores: z.unknown(), rawSource: z.string().nullable(), rawDataDomain: z.string().nullable() }).strict();
type Batch = z.infer<typeof batchSchema>;
function jsonColumn(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return fail("SOURCE_INVALID"); } }
function normalizedBatch(raw: Row): Batch {
  const result = { ...raw, scope: jsonColumn(raw.scope), summary: jsonColumn(raw.summary), stores: jsonColumn(raw.stores) };
  boundedJson(result, INVENTORY_LIFECYCLE_LIMITS.batchBytes); return parse(batchSchema, result);
}
function dayNumber(value: string) { return new Date(`${value}T00:00:00.000Z`).getTime() / 86400000; }
function completeBatchDates(batch: Batch): Set<string> {
  if (batch.status !== "applied") return new Set();
  const start = parse(dateSchema, batch.scope.startDate), end = parse(dateSchema, batch.scope.endDate);
  const days = dayNumber(end) - dayNumber(start) + 1; if (days < 1 || days > 366) fail("BATCH_RANGE_INVALID");
  const summary = batch.summary; if (!summary) fail("COVERAGE_UNKNOWN");
  for (const field of ["storesExpected", "storesRead", "datesRead", "storeDateWindowsExpected", "storeDateWindowsRead", "pageTruncations", "skippedRows"] as const) if (Object.hasOwn(summary, field) && !qtySchema.safeParse(summary[field]).success) fail("COVERAGE_INVALID");
  if (typeof summary.capped !== "boolean" || !Object.hasOwn(summary, "pageTruncations") || !Object.hasOwn(summary, "storesRead")) fail("COVERAGE_UNKNOWN");
  if (summary.capped || summary.pageTruncations !== 0 || Number(summary.skippedRows ?? 0) > 0) return new Set();
  if (days > 1 && (!Object.hasOwn(summary, "datesRead") || Number(summary.datesRead) < days)) return new Set();
  return collectCompletedDailyBackfillDates([{ status: batch.status, scope: batch.scope, summary }], start, end);
}
type StoreCoverage = { byName: Map<string, Set<string>>; bySid: Map<string, Set<string>> };
function buildStoreCoverage(batches: Batch[]): StoreCoverage {
  const byName = new Map<string, Set<string>>(), bySid = new Map<string, Set<string>>(); let windows = 0;
  const add = (map: Map<string, Set<string>>, identity: string, dates: Set<string>) => { const current = map.get(identity) ?? new Set<string>(); for (const date of dates) current.add(date); map.set(identity, current); };
  for (const batch of batches) {
    const dates = completeBatchDates(batch); if (!dates.size) continue;
    // Producer records raw_snapshot.stores as {sid,name,country?}. Missing old
    // store provenance is not permission to zero-fill every workspace market.
    if (batch.stores === null || batch.stores === undefined) continue;
    if (batch.rawSource !== "lingxing_mcp" || batch.rawDataDomain !== "product_performance_daily") fail("STORE_PROVENANCE_INVALID");
    if (!Array.isArray(batch.stores) || batch.stores.length > 1000) fail("STORE_COVERAGE_INVALID");
    const stores = batch.stores.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("STORE_COVERAGE_INVALID");
      const row = value as Row; return { sid: parse(text(64), row.sid), name: row.name === "" ? "" : parse(text(200), row.name), country: row.country === undefined ? null : parse(text(50), row.country) };
    });
    if (new Set(stores.map(store => store.sid)).size !== stores.length || stores.length !== Number(batch.summary?.storesExpected ?? batch.summary?.storesRead)) fail("STORE_COVERAGE_INVALID");
    if (typeof batch.scope.storeId !== "string" || batch.scope.storeId !== "ALL_US" && (stores.length !== 1 || stores[0].sid !== batch.scope.storeId)) fail("STORE_PROVENANCE_INVALID");
    if (batch.scope.storeId === "ALL_US" && stores.some(store => store.country === null || normalizeMarketplaceCode(store.country) !== "US")) fail("STORE_PROVENANCE_INVALID");
    const named = new Set<string>();
    for (const store of stores) {
      if (store.country === null) continue;
      const country = normalizeMarketplaceCode(store.country), nameKey = JSON.stringify([store.name, country]);
      if (store.name && named.has(nameKey)) fail("STORE_COVERAGE_AMBIGUOUS"); named.add(nameKey);
      windows += dates.size; if (windows > INVENTORY_LIFECYCLE_LIMITS.coveredStoreDates) fail("SOURCE_LIMIT");
      if (store.name) add(byName, nameKey, dates);
      add(bySid, JSON.stringify([store.sid, country]), dates);
    }
  }
  return { byName, bySid };
}
function coverageFor(scope: InventoryLifecycleScope, sources: Daily[], coverage: StoreCoverage): Set<string> {
  const country = normalizeMarketplaceCode(scope.country), covered = new Set(coverage.byName.get(JSON.stringify([scope.storeName, country])) ?? []);
  const sids = new Set(sources.flatMap(row => row.sourceStoreId === null ? [] : [row.sourceStoreId]));
  if (sids.size > 1) fail("STORE_COVERAGE_AMBIGUOUS");
  for (const sid of sids) for (const date of coverage.bySid.get(JSON.stringify([sid, country])) ?? []) covered.add(date);
  return covered;
}
type AutoPlan = { scope: InventoryLifecycleScope; parentAsin: string; userId: number; decision: ZeroValueDiscontinuationResult; coverage: "daily" | "weekly" | "insufficient" };
function validateDecision(decision: ZeroValueDiscontinuationResult): void {
  parse(qtySchema, decision.salesQty); parse(qtySchema, decision.maxInventory); parse(qtySchema, decision.evidenceDays);
  if (!Number.isFinite(decision.profit) || Math.abs(decision.profit) >= 1_000_000_000_000) fail("EVIDENCE_AMOUNT_LIMIT");
}
/** Strict admission precedes existing calculation helpers. Unknown present cells
 * never become zero; only missing rows in proven exact-store coverage may do so. */
function buildPlans(workspaceId: number, snapshots: Daily[], weekly: Weekly[], states: InventoryLifecycleRow[], batches: Batch[]): AutoPlan[] {
  if ([...snapshots, ...weekly, ...states, ...batches].some(row => row.workspaceId !== workspaceId)) fail("SCOPE_MISMATCH");
  checkScopes([...snapshots, ...states]);
  checkScopes([...snapshots, ...weekly.filter((row): row is Weekly & InventoryLifecycleScope => InventoryLifecycleScopeSchema.safeParse({ asin: row.asin, storeName: row.storeName, country: row.country }).success)]);
  const sourceKeys = snapshots.map(row => JSON.stringify([key(row), row.reportDate, row.sourceType]));
  if (new Set(sourceKeys).size !== sourceKeys.length) fail("DUPLICATE_DAILY_EVIDENCE");
  const grouped = new Map<string, Daily[]>(); for (const row of snapshots) { const rows = grouped.get(key(row)) ?? []; rows.push(row); grouped.set(key(row), rows); }
  const weeklyByKey = new Map<string, Weekly[]>();
  for (const row of weekly) { const scope = InventoryLifecycleScopeSchema.safeParse({ asin: row.asin, storeName: row.storeName, country: row.country }); if (!scope.success) continue; const identity = key(scope.data), values = weeklyByKey.get(identity) ?? []; values.push(row); weeklyByKey.set(identity, values); }
  const stateByKey = new Map(states.map(row => [key(row), row]));
  for (const state of states) if (state.parentAsin && (state.evidenceStartDate || state.evidenceEndDate) && !grouped.has(key(state))) grouped.set(key(state), []);
  const plans: AutoPlan[] = [], storeCoverage = buildStoreCoverage(batches);
  for (const [identity, sources] of grouped) {
    const previous = stateByKey.get(identity), latest = [...sources].sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.id - b.id).at(-1);
    const scope = parse(InventoryLifecycleScopeSchema, { asin: latest?.asin ?? previous?.asin, storeName: latest?.storeName ?? previous?.storeName, country: latest?.country ?? previous?.country });
    const parentAsin = latest?.parentAsin ?? previous?.parentAsin, userId = latest?.userId ?? previous?.userId; if (!parentAsin || !userId) fail("IDENTITY_UNKNOWN");
    const evidence: DailyPerformanceEvidenceRow[] = sources.map(row => ({ ...row }));
    if (previous?.parentAsin && (previous.evidenceStartDate || previous.evidenceEndDate)) evidence.push({ asin: previous.asin, storeName: previous.storeName, country: previous.country, reportDate: (previous.evidenceStartDate || previous.evidenceEndDate)!, salesQty: 0, orderProfit: "0", fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, sourceType: "lifecycle_identity_seed" });
    const daily = [...buildCompleteCoverageEvidence(evidence, coverageFor(scope, sources, storeCoverage)).values()][0] ?? [];
    let decision: ZeroValueDiscontinuationResult, coverage: AutoPlan["coverage"];
    if (daily.length === 90) { decision = evaluateThreeMonthZeroDiscontinuation(daily); coverage = "daily"; }
    else {
      const candidates = weeklyByKey.get(identity) ?? [];
      const seen = new Set<string>();
      const rows = candidates.map(row => {
        const interval = `${row.weekStartDate}/${row.weekEndDate}`; if (seen.has(interval)) fail("DUPLICATE_WEEKLY_EVIDENCE"); seen.add(interval);
        if (dayNumber(row.weekEndDate) - dayNumber(row.weekStartDate) !== 6 || row.salesQty === null || row.orderProfit === null || row.fbaAvailable === null || row.fbaInTransit === null) fail("WEEKLY_EVIDENCE_UNKNOWN");
        return { weekStartDate: row.weekStartDate, weekEndDate: row.weekEndDate, salesQty: row.salesQty, orderProfit: Number(row.orderProfit), totalInventory: row.fbaAvailable + row.fbaInTransit };
      }).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
      if (rows.some((row, index) => index > 0 && dayNumber(row.weekStartDate) !== dayNumber(rows[index - 1].weekEndDate) + 1)) fail("WEEKLY_COVERAGE_GAP");
      decision = evaluateThreeMonthZeroWeeklyDiscontinuation(rows); coverage = decision.reason === "insufficient_history" ? "insufficient" : "weekly";
    }
    validateDecision(decision); plans.push({ scope, parentAsin, userId, decision, coverage });
  }
  return plans;
}
async function assertAutoSchema(tx: DbExecutor): Promise<void> {
  const tables = [TABLE, DAILY, WEEKLY, BATCH, "workspaces"];
  const engines = await query(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  if (engines.length !== tables.length || tables.some(table => engines.filter(row => row.tableName === table && row.engine === "InnoDB").length !== 1)) fail("TRANSACTION_SCHEMA_REQUIRED");
  if (!await inventoryLifecycleSchemaReady(tx)) fail("LIFECYCLE_SCHEMA_REQUIRED");
}
export async function refreshGovernedZeroValueDiscontinuationStatuses(db: InventoryLifecycleDatabase, workspaceId: number): Promise<{ considered: number; changed: number; protected: number; insufficient: number }> {
  parse(idSchema, workspaceId); if (typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
  return db.transaction(async tx => {
    await assertAutoSchema(tx);
    const workspace = await query(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [workspaceId]); if (workspace.length !== 1 || workspace[0].id !== workspaceId || workspace[0].status !== "active") fail("WORKSPACE_UNAVAILABLE");
    const where = "workspaceId=?", values = [workspaceId];
    const selectedStates = await preflight(tx, TABLE, where, values, lifecycleColumns, INVENTORY_LIFECYCLE_LIMITS.states);
    await collisionCheck(tx, TABLE, where, values);
    const rawStates = await query(tx, `SELECT ${lifecycleProjection} FROM ${TABLE} WHERE ${where} ORDER BY id LIMIT ${INVENTORY_LIFECYCLE_LIMITS.states + 1} FOR UPDATE`, values); checkSelection(rawStates, selectedStates);
    const states = parseLifecycleRows(rawStates, workspaceId);
    const dailyWhere = "workspaceId=? AND source_type<>'lx_inventory_mcp'";
    const selectedDaily = await preflight(tx, DAILY, dailyWhere, values, ["asin", "parent_asin", "store_name", "country", "report_date", "source_row_hash"], INVENTORY_LIFECYCLE_LIMITS.rows);
    await collisionCheck(tx, DAILY, dailyWhere, values);
    const rawDaily = await query(tx, `SELECT id,workspaceId,user_id AS userId,asin,parent_asin AS parentAsin,store_name AS storeName,country,report_date AS reportDate,source_type AS sourceType,source_store_id AS sourceStoreId,sales_qty AS salesQty,order_profit AS orderProfit,fba_available AS fbaAvailable,available_stock AS availableStock,fba_in_transit AS fbaInTransit,is_valid AS isValid,source_row_hash AS sourceRowHash FROM ${DAILY} WHERE ${dailyWhere} ORDER BY id LIMIT ${INVENTORY_LIFECYCLE_LIMITS.rows + 1} FOR UPDATE`, values); checkSelection(rawDaily, selectedDaily);
    const selectedWeekly = await preflight(tx, WEEKLY, where, values, ["asin", "store_name", "country", "week_start_date", "week_end_date"], INVENTORY_LIFECYCLE_LIMITS.rows);
    await collisionCheck(tx, WEEKLY, where, values);
    const rawWeekly = await query(tx, `SELECT id,workspaceId,asin,store_name AS storeName,country,week_start_date AS weekStartDate,week_end_date AS weekEndDate,sales_qty AS salesQty,order_profit AS orderProfit,fba_available AS fbaAvailable,fba_in_transit AS fbaInTransit FROM ${WEEKLY} WHERE ${where} ORDER BY id LIMIT ${INVENTORY_LIFECYCLE_LIMITS.rows + 1} FOR UPDATE`, values); checkSelection(rawWeekly, selectedWeekly);
    const batchWhere = "workspaceId=? AND source='lingxing_mcp' AND data_domain='product_performance_daily'";
    const selectedBatches = await preflight(tx, BATCH, batchWhere, values, ["scope", "summary", "JSON_EXTRACT(raw_snapshot,'$.stores')"], INVENTORY_LIFECYCLE_LIMITS.batches, INVENTORY_LIFECYCLE_LIMITS.batchBytes);
    const rawBatches = await query(tx, `SELECT id,workspaceId,source,data_domain AS dataDomain,status,scope,summary,JSON_EXTRACT(raw_snapshot,'$.stores') AS stores,JSON_UNQUOTE(JSON_EXTRACT(raw_snapshot,'$.source')) AS rawSource,JSON_UNQUOTE(JSON_EXTRACT(raw_snapshot,'$.dataDomain')) AS rawDataDomain FROM ${BATCH} WHERE ${batchWhere} ORDER BY id LIMIT ${INVENTORY_LIFECYCLE_LIMITS.batches + 1} FOR UPDATE`, values); checkSelection(rawBatches, selectedBatches);
    boundedJson({ states, daily: rawDaily, weekly: rawWeekly, batches: rawBatches });
    const daily = rawDaily.map(row => parse(dailySchema, row)), weekly = rawWeekly.map(row => parse(weeklySchema, row)), batches = rawBatches.map(normalizedBatch);
    const plans = buildPlans(workspaceId, daily, weekly, states, batches), result = { considered: plans.length, changed: 0, protected: 0, insufficient: 0 };
    // The whole input is admitted before the first write. Each target is still
    // freshly loaded under the same workspace lock, shared with manual restore.
    for (const plan of plans) {
      const state = await loadInventoryLifecycleState(tx, workspaceId, plan.scope), existing = state.row;
      if (existing?.status === "active" && existing.restoredAt !== null) { result.protected++; continue; }
      // Safety correction: lack of evidence is not proof of active/discontinued.
      if (plan.coverage === "insufficient") { result.insufficient++; continue; }
      const d = plan.decision, now = new Date(), status = d.shouldDiscontinue ? "discontinued" : "active";
      if (!existing && !d.shouldDiscontinue) continue;
      const payload = [status, d.reason, plan.parentAsin, d.evidenceStartDate, d.evidenceEndDate, d.evidenceDays, d.salesQty, d.profit.toFixed(2), d.maxInventory, now];
      const rowId = existing ? (await write(tx, `UPDATE ${TABLE} SET status=?,reason=?,parent_asin=?,evidence_start_date=?,evidence_end_date=?,evidence_days=?,evidence_sales_qty=?,evidence_profit=?,evidence_max_inventory=?,changed_by=NULL,changed_at=?,restored_at=NULL,restore_reason=NULL WHERE id=? AND workspaceId=?`, [...payload, existing.id, workspaceId]), existing.id)
        : await write(tx, `INSERT INTO ${TABLE} (workspaceId,user_id,asin,store_name,country,status,reason,parent_asin,evidence_start_date,evidence_end_date,evidence_days,evidence_sales_qty,evidence_profit,evidence_max_inventory,changed_by,changed_at,restored_at,restore_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,NULL)`, [workspaceId, plan.userId, plan.scope.asin, plan.scope.storeName, plan.scope.country, ...payload]);
      const verified = await loadInventoryLifecycleState(tx, workspaceId, plan.scope);
      const expected = { workspaceId, asin: plan.scope.asin, storeName: plan.scope.storeName, country: plan.scope.country, id: rowId, status, reason: d.reason, parentAsin: plan.parentAsin, evidenceStartDate: d.evidenceStartDate, evidenceEndDate: d.evidenceEndDate, evidenceDays: d.evidenceDays, evidenceSalesQty: d.salesQty, evidenceProfit: d.profit.toFixed(2), evidenceMaxInventory: d.maxInventory, changedBy: null, restoredAt: null, restoreReason: null, userId: existing?.userId ?? plan.userId };
      if (!verified.row || Object.entries(expected).some(([field, value]) => verified.row![field as keyof InventoryLifecycleRow] !== value) || existing && verified.row.createdAt !== existing.createdAt) fail("WRITE_UNVERIFIABLE");
      result.changed++;
    }
    return result;
  });
}
