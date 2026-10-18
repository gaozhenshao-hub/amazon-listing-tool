import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import {
  InventoryPlanningReadInputSchema, InventoryPlanningExecuteInputSchema, InventoryPlanningRecoverInputSchema, InventoryPlanningReadResultSchema, InventoryPlanningWriteResultSchema,
  InventoryPlanningWriteError, canonicalInventoryPlanningScope, inventoryPlanningScopeKey, inventoryPlanningSnapshotKey, inventoryPlanningOperationRequestHash, inventoryPlanningWriteCanonical,
  parseInventoryPlanningParameterRows, parseInventoryPlanningLocalRows, resolveInventoryPlanningState, applyInventoryPlanningPatch, validateInventoryPlanningWriteAgainstReadResult,
  type InventoryPlanningReadInput, type InventoryPlanningExecuteInput, type InventoryPlanningRecoverInput, type InventoryPlanningReadResult, type InventoryPlanningWriteResult, type InventoryPlanningScope, type InventoryPlanningValues,
} from "../../../shared/inventoryPlanningWrite";
import { createInventoryPlanningOperationJournal, InventoryPlanningJournalError } from "./inventoryPlanningOperationJournal";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";

type Row = Record<string, unknown>;
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; actor: { id: number; role: string; defaultWorkspaceId: number } };
export interface InventoryPlanningWriteDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const PARAMETERS = "ops_inventory_planning_parameters", LOCALS = "ops_local_inventory_adjustments", SOURCE = "ops_asin_daily_snapshots", AUDIT = "security_audit_logs";
const LIMIT = 10000, MAX_BYTES = 8 * 1024 * 1024;
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const manager = (value: unknown): value is string => ["super_admin", "admin", "ops_manager"].includes(String(value));
function fail(reason: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT" | "BAD_REQUEST" = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message: `INVENTORY_PLANNING_${reason}` }); }
function statement(text: string, values: unknown[] = []): SQL { const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID"); return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); }
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> { const result = await tx.execute(statement(text, values)); if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("SOURCE_INVALID"); return result[0]; }
async function mutate(tx: DbExecutor, text: string, values: unknown[], expected = 1): Promise<number | null> { const raw = await tx.execute(statement(text, values)), result = Array.isArray(raw) ? raw[0] : null; if (!result || result.affectedRows !== expected) fail("WRITE_UNVERIFIABLE"); return id(result.insertId) ? result.insertId : null; }
function safeError(error: unknown): never { if (error instanceof InventoryPlanningWriteError || error instanceof InventoryPlanningJournalError) fail(error.code, /CONFLICT|MISMATCH|CANCELLED/u.test(error.code) ? "CONFLICT" : "BAD_REQUEST"); if (error instanceof TRPCError && /^INVENTORY_PLANNING_[A-Z_]+$/u.test(error.message)) throw error; if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN"); fail("UNAVAILABLE"); }
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(value => new Set(value).size === value.length);
const name = z.string().min(1).max(100).refine(value => value === value.trim());
const detailsSchema = z.array(z.object({ moduleId: name, operations, subModules: z.array(z.object({ subModuleId: name, operations }).strict()).max(100).refine(value => new Set(value.map(item => item.subModuleId)).size === value.length).optional() }).strict()).max(100).refine(value => new Set(value.map(item => item.moduleId)).size === value.length);
function permissionJson(value: unknown) { try { const wire = typeof value === "string" ? value : JSON.stringify(value); if (!wire || Buffer.byteLength(wire) > 65536) fail("DIRECTORY_INVALID", "FORBIDDEN"); return JSON.parse(wire); } catch { return fail("DIRECTORY_INVALID", "FORBIDDEN"); } }
async function directory(current: Session, operation: "read" | "edit") {
  if (current.actor.role === "super_admin") return;
  const selected = await rows(current.tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [current.actor.role, current.identity.workspaceId]);
  if (selected.length > 2 || new Set(selected.map(row => row.workspaceId)).size !== selected.length || selected.some(row => !id(row.id) || row.role !== current.actor.role || row.workspaceId !== null && row.workspaceId !== current.identity.workspaceId)) fail("DIRECTORY_INVALID", "FORBIDDEN");
  const record = selected.find(row => row.workspaceId === current.identity.workspaceId) ?? selected.find(row => row.workspaceId === null);
  if (!record) { if (!ROLE_MODULE_ACCESS[current.actor.role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return; }
  const modules = z.array(name).max(100).refine(value => new Set(value).size === value.length).safeParse(permissionJson(record.modules)), details = record.detailedPermissions === null ? null : detailsSchema.safeParse(permissionJson(record.detailedPermissions));
  if (!modules.success || details && !details.success) fail("DIRECTORY_INVALID", "FORBIDDEN");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = details?.success ? details.data.find(item => item.moduleId === "ops") : undefined;
  if (!module) return;
  for (const subModuleId of ["ops_dashboard", "ops_inventory"]) { const granted = module.subModules?.find(item => item.subModuleId === subModuleId)?.operations ?? module.operations; if (!granted.includes("read") || subModuleId === "ops_inventory" && !granted.includes(operation)) fail("DIRECTORY_DENIED", "FORBIDDEN"); }
}

const collations = ["utf8mb4_general_ci", "utf8mb4_unicode_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"];
const parameterFields = {
  productionDays: "production_days", shippingDays: "shipping_days", bufferDays: "buffer_days", targetCoverDays: "target_cover_days", moq: "moq", packSize: "pack_size",
  productCost: "product_cost", estimatedFirstLegCost: "estimated_first_leg_cost", actualFirstLegCost: "actual_first_leg_cost", estimatedFbaFee: "estimated_fba_fee", actualFbaFee: "actual_fba_fee", sellingPrice: "selling_price",
  estimatedDimensions: "estimated_dimensions", actualDimensions: "actual_dimensions", estimatedWeight: "estimated_weight", actualWeight: "actual_weight", dimensionUnit: "dimension_unit", weightUnit: "weight_unit", currency: "currency",
} as const;
const sourceStrings = { source_type: 20, report_date: 10, asin: 20, parent_asin: 20, store_name: 200, country: 50, msku: 200, sku: 200, title: 1000, product_name: 500, operator: 200, source_row_hash: 64 };
const sourceIntegers = ["id", "workspaceId", "import_id", "user_id", "sales_qty", "fba_available", "fba_in_transit", "available_stock", "is_valid"];
/** Admission only. No DDL, ledger registration, backfill, or default creation. */
export async function inventoryPlanningSchemaReady(tx: DbExecutor): Promise<{ read: boolean; write: boolean; journal: boolean }> {
  const tables = [PARAMETERS, LOCALS, SOURCE, AUDIT, "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  if (engines.length > tables.length || new Set(engines.map(row => row.tableName)).size !== engines.length || engines.some(row => !tables.includes(String(row.tableName)))) fail("SCHEMA_INVALID");
  const engine = (table: string) => engines.some(row => row.tableName === table && row.engine === "InnoDB");
  const cols = await rows(tx, "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_inventory_planning_parameters','ops_local_inventory_adjustments','ops_asin_daily_snapshots','security_audit_logs')");
  if (cols.length > 400 || new Set(cols.map(row => `${row.tableName}:${row.columnName}`)).size !== cols.length || cols.some(row => ![PARAMETERS, LOCALS, SOURCE, AUDIT].includes(String(row.tableName)) || typeof row.columnName !== "string" || typeof row.extra !== "string" || typeof row.dataType !== "string" || typeof row.columnType !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || !(row.defaultValue === null || typeof row.defaultValue === "string" || typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue)))) fail("SCHEMA_INVALID");
  const get = (table: string, column: string) => cols.find(row => row.tableName === table && row.columnName === column);
  const regular = (row: Row | undefined) => !!row && !/VIRTUAL GENERATED|STORED GENERATED/iu.test(String(row.extra));
  const nullableMatches = (table: string, column: string, row: Row, nullable: boolean) => [PARAMETERS, LOCALS].includes(table) && column !== "workspaceId" ? row.isNullable === (nullable ? "YES" : "NO") : nullable || row.isNullable === "NO";
  const integer = (table: string, column: string, nullable = false) => { const row = get(table, column), flag = ["is_active", "is_valid"].includes(column); return regular(row) && (row!.dataType === "int" || flag && row!.dataType === "tinyint") && (flag ? /^(?:tinyint|int)(?:\(\d+\))?$/u : /^int(?:\(\d+\))?$/u).test(String(row!.columnType)) && nullableMatches(table, column, row!, nullable) && (column === "id" ? row!.extra === "auto_increment" : row!.extra === ""); };
  const text = (table: string, column: string, length: number, nullable = false) => { const row = get(table, column); return regular(row) && row!.dataType === "varchar" && typeof row!.maxLength === "number" && row!.maxLength >= length && row!.maxLength <= Math.max(length, 1000) && nullableMatches(table, column, row!, nullable) && collations.includes(String(row!.collation)) && row!.extra === ""; };
  const date = (table: string, column: string, nullable = false) => { const row = get(table, column); return regular(row) && ([PARAMETERS, LOCALS].includes(table) ? row!.dataType === "timestamp" : ["timestamp", "datetime"].includes(String(row!.dataType))) && nullableMatches(table, column, row!, nullable); };
  const decimal = (column: string, scale: number) => { const row = get(PARAMETERS, column); return regular(row) && row!.dataType === "decimal" && row!.columnType === `decimal(10,${scale})` && row!.isNullable === "YES" && row!.extra === ""; };
  const enumerated = (table: string, column: string, type: string) => { const row = get(table, column); return regular(row) && row!.dataType === "enum" && row!.columnType === type && row!.isNullable === "NO" && row!.extra === "" && collations.includes(String(row!.collation)); };
  const sourceReady = engine(SOURCE) && sourceIntegers.every(column => integer(SOURCE, column, column === "workspaceId")) && Object.entries(sourceStrings).every(([column, length]) => text(SOURCE, column, length, ["msku", "sku", "title", "product_name", "operator"].includes(column))) && ["created_at", "updated_at"].every(column => date(SOURCE, column));
  const parameterReady = engine(PARAMETERS) && ["id", "user_id", ...Object.values(parameterFields).slice(0, 6), "is_active"].every(column => integer(PARAMETERS, column)) && integer(PARAMETERS, "workspaceId", true)
    && enumerated(PARAMETERS, "scope_type", "enum('workspace','store_country','parent_asin','asin')") && Object.entries({ asin: 20, parent_asin: 20, store_name: 200, country: 50 }).every(([column, length]) => text(PARAMETERS, column, length, true))
    && Object.values(parameterFields).slice(6, 12).every(column => decimal(column, 2)) && ["estimated_weight", "actual_weight"].every(column => decimal(column, 3)) && ["estimated_dimensions", "actual_dimensions"].every(column => text(PARAMETERS, column, 120, true))
    && text(PARAMETERS, "dimension_unit", 12) && text(PARAMETERS, "weight_unit", 12) && text(PARAMETERS, "currency", 8) && ["created_at", "updated_at"].every(column => date(PARAMETERS, column));
  const localReady = engine(LOCALS) && ["id", "user_id", "local_qty"].every(column => integer(LOCALS, column)) && ["workspaceId", "confirmed_by", "superseded_by_id"].every(column => integer(LOCALS, column, true)) && Object.entries({ asin: 20, store_name: 200, country: 50, effective_date: 10 }).every(([column, length]) => text(LOCALS, column, length)) && text(LOCALS, "reason", 500, true) && enumerated(LOCALS, "status", "enum('draft','confirmed','superseded')") && date(LOCALS, "confirmed_at", true) && ["created_at", "updated_at"].every(column => date(LOCALS, column));
  const indexes = await rows(tx, "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_inventory_planning_parameters','ops_local_inventory_adjustments','ops_asin_daily_snapshots','security_audit_logs') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
  if (indexes.length > 300 || indexes.some(row => ![PARAMETERS, LOCALS, SOURCE, AUDIT].includes(String(row.tableName)) || typeof row.indexName !== "string" || typeof row.columnName !== "string" || !id(row.sequence) || ![0, 1].includes(row.nonUnique as number))) fail("SCHEMA_INVALID");
  const groups = [...new Set(indexes.map(row => `${row.tableName}:${row.indexName}`))].map(key => indexes.filter(row => `${row.tableName}:${row.indexName}` === key).sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  const has = (table: string, columns: string[], unique: boolean | null = null, exact = false) => groups.some(group => group[0].tableName === table && (exact ? group.length === columns.length : group.length >= columns.length) && columns.every((column, i) => group[i].columnName === column && group[i].sequence === i + 1 && group[i].prefixLength === null && (unique === null || group[i].nonUnique === (unique ? 0 : 1))));
  const primary = (table: string) => groups.some(group => group.length === 1 && group[0].tableName === table && group[0].indexName === "PRIMARY" && group[0].columnName === "id" && group[0].nonUnique === 0 && group[0].prefixLength === null);
  const securityReady = [AUDIT, "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"].every(engine);
  const auditSupplied = ["auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"];
  const auditChoice = (column: string, value: string) => { const row = get(AUDIT, column); return !!row && row.extra === "" && collations.includes(String(row.collation)) && (row.dataType === "varchar" && Number(row.maxLength) >= value.length || row.dataType === "enum" && String(row.columnType).includes(`'${value}'`)); };
  const journal = securityReady && text(AUDIT, "auditId", 79) && get(AUDIT, "metadata")?.dataType === "json" && auditSupplied.every(column => regular(get(AUDIT, column))) && has(AUDIT, ["auditId"], true, true) && groups.filter(group => group[0].tableName === AUDIT && group[0].nonUnique === 0).every(group => group.length === 1 && ["id", "auditId"].includes(String(group[0].columnName)) && group[0].prefixLength === null)
    && integer(AUDIT, "workspaceId", true) && integer(AUDIT, "actorUserId", true) && text(AUDIT, "actorRole", 64, true) && text(AUDIT, "action", 40) && text(AUDIT, "resourceType", 40) && text(AUDIT, "resourceId", 36, true) && auditChoice("status", "success") && auditChoice("riskLevel", "medium")
    && cols.filter(row => row.tableName === AUDIT).every(row => auditSupplied.includes(String(row.columnName)) || row.isNullable === "YES" || row.defaultValue !== null || /auto_increment|generated/iu.test(String(row.extra)));
  const noUnexpectedUnique = [PARAMETERS, LOCALS].every(table => groups.filter(group => group[0].tableName === table && group[0].nonUnique === 0).every(group => group.length === 1 && group[0].columnName === "id" && group[0].prefixLength === null));
  const indexed = [PARAMETERS, LOCALS, SOURCE].every(primary) && has(LOCALS, ["workspaceId", "user_id", "asin", "store_name", "country", "status", "effective_date"]) && has(PARAMETERS, ["workspaceId", "user_id", "scope_type", "asin", "store_name", "country", "is_active"]) && has(PARAMETERS, ["workspaceId", "user_id", "scope_type", "parent_asin", "store_name", "country", "is_active"]) && has(SOURCE, ["workspaceId", "source_type", "report_date"]);
  const noExtraRequired = (table: string, supplied: string[]) => cols.filter(row => row.tableName === table).every(row => supplied.includes(String(row.columnName)) || row.isNullable === "YES" || row.defaultValue !== null || /auto_increment|generated/iu.test(String(row.extra)));
  const supplied = ["workspaceId", "user_id", "asin", "store_name", "country", "created_at", "updated_at"];
  const writableColumns = noExtraRequired(PARAMETERS, [...supplied, "scope_type", "parent_asin", "is_active", ...Object.values(parameterFields)]) && noExtraRequired(LOCALS, [...supplied, "effective_date", "local_qty", "reason", "status", "confirmed_by", "confirmed_at", "superseded_by_id"]);
  const readable = sourceReady && parameterReady && localReady && [PARAMETERS, LOCALS].every(table => engines.some(row => row.tableName === table && collations.includes(String(row.collation))));
  return { read: Boolean(readable), write: Boolean(readable && journal && indexed && noUnexpectedUnique && writableColumns), journal: Boolean(journal) };
}

const dateProjection = (column: string, alias: string) => `DATE_FORMAT(${column},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const parameterProjection = `id,workspaceId,user_id AS userId,scope_type AS scopeType,asin,parent_asin AS parentAsin,store_name AS storeName,country,${Object.entries(parameterFields).map(([alias, column]) => `${column} AS ${alias}`).join(",")},is_active AS isActive,${dateProjection("created_at", "createdAt")},${dateProjection("updated_at", "updatedAt")}`;
const localProjection = `id,workspaceId,user_id AS userId,asin,store_name AS storeName,country,effective_date AS effectiveDate,local_qty AS localQty,reason,status,confirmed_by AS confirmedBy,${dateProjection("confirmed_at", "confirmedAt")},superseded_by_id AS supersededById,${dateProjection("created_at", "createdAt")},${dateProjection("updated_at", "updatedAt")}`;
const sourceProjection = `id,workspaceId,import_id AS importId,user_id AS userId,source_type AS sourceType,report_date AS reportDate,asin,parent_asin AS parentAsin,store_name AS storeName,country,msku,sku,title,product_name AS productName,operator,sales_qty AS salesQty,fba_available AS fbaAvailable,fba_in_transit AS fbaInTransit,available_stock AS availableStock,source_row_hash AS sourceRowHash,is_valid AS isValid,${dateProjection("created_at", "createdAt")},${dateProjection("updated_at", "updatedAt")}`;
function bounded<T>(value: T[], limit = LIMIT): T[] { if (value.length > limit || Buffer.byteLength(inventoryPlanningWriteCanonical(value), "utf8") > MAX_BYTES) fail("SOURCE_LIMIT"); return value; }
function matchesMarketplace(row: { country: string; storeName: string }, requested: string) { return requested === "ALL" || normalizeMarketplaceCode(row.country) === requested || row.storeName.toUpperCase().includes(`-${requested}`); }
function physicalScope(scope: InventoryPlanningScope): { where: string; params: unknown[] } {
  if (scope.scopeType === "workspace") return { where: "", params: [] };
  return { where: ` AND store_name=?${scope.scopeType === "asin" ? " AND asin=?" : scope.scopeType === "parent_asin" ? " AND parent_asin=?" : ""}`, params: [scope.storeName, ...(scope.scopeType === "asin" ? [scope.asin] : scope.scopeType === "parent_asin" ? [scope.parentAsin] : [])] };
}
function exactSource(row: Row, scope: InventoryPlanningScope): boolean {
  if (scope.scopeType === "workspace") return true;
  if (row.storeName !== scope.storeName || scope.scopeType === "asin" && row.asin !== scope.asin || scope.scopeType === "parent_asin" && row.parentAsin !== scope.parentAsin) fail("SOURCE_SCOPE_COLLISION", "CONFLICT");
  if (normalizeMarketplaceCode(String(row.country)) === normalizeMarketplaceCode(scope.country) && row.country !== scope.country) fail("SOURCE_COUNTRY_ALIAS", "CONFLICT");
  return row.country === scope.country;
}
async function preflight(tx: DbExecutor, table: string, columns: string[], where: string, values: unknown[], limit: number) {
  const sizes = await rows(tx, `SELECT id,${columns.map(column => `COALESCE(OCTET_LENGTH(CAST(${column} AS CHAR CHARACTER SET utf8mb4)),0)`).join("+")}+2048 AS bodyBytes FROM ${table} WHERE ${where} ORDER BY id LIMIT ${limit + 1} FOR UPDATE`, values);
  if (sizes.length > limit || new Set(sizes.map(row => row.id)).size !== sizes.length || sizes.some(row => !id(row.id) || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0) || sizes.reduce((sum, row) => sum + Number(row.bodyBytes), 0) > MAX_BYTES) fail("SOURCE_LIMIT");
  return sizes.map(row => row.id);
}
async function collisions(tx: DbExecutor, table: string, where: string, values: unknown[], parameter = false) {
  const identity = parameter ? "scope_type,asin,CASE WHEN scope_type='parent_asin' THEN parent_asin ELSE NULL END,store_name,country" : "asin,store_name,country";
  const distinct = parameter ? "COUNT(*)" : "COUNT(DISTINCT BINARY asin,BINARY store_name,BINARY country)";
  const found = await rows(tx, `SELECT ${distinct} AS identityCount FROM ${table} WHERE ${where} GROUP BY ${identity} HAVING identityCount>1 LIMIT 1 FOR UPDATE`, values);
  if (found.length) fail("COLLATION_SCOPE_COLLISION", "CONFLICT");
}
/** The source selector intentionally runs across the whole marketplace before
 * exact child filtering. A child without dedicated stock must not fall back. */
async function loadSources(current: Session, input: InventoryPlanningReadInput): Promise<Row[]> {
  const directoryRows = bounded(await rows(current.tx, `SELECT source_type AS sourceType,country,store_name AS storeName,MAX(report_date) AS reportDate FROM ${SOURCE} WHERE workspaceId=? GROUP BY source_type,country,store_name ORDER BY source_type,country,store_name LIMIT ${LIMIT + 1} FOR SHARE`, [current.identity.workspaceId]));
  if (directoryRows.some(row => !["lingxing", "lingxing_mcp", "saihu", "lx_inventory_mcp"].includes(String(row.sourceType)) || typeof row.country !== "string" || typeof row.storeName !== "string" || typeof row.reportDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(row.reportDate))) fail("SOURCE_INVALID");
  const scoped = directoryRows.filter(row => matchesMarketplace(row as { country: string; storeName: string }, input.marketplace));
  const dedicated = scoped.some(row => row.sourceType === "lx_inventory_mcp"), selected = scoped.filter(row => dedicated ? row.sourceType === "lx_inventory_mcp" : row.sourceType !== "lx_inventory_mcp");
  const latest = selected.reduce((last, row) => String(row.reportDate) > last ? String(row.reportDate) : last, "");
  if (!latest) fail("SOURCE_MISSING"); if (latest !== input.asOfDate) fail("SOURCE_DATE_CHANGED", "CONFLICT");
  const filter = physicalScope(input.scope);
  const where = `workspaceId=? AND report_date=? AND source_type ${dedicated ? "='lx_inventory_mcp'" : "IN ('lingxing','lingxing_mcp','saihu')"}${filter.where}`, params = [current.identity.workspaceId, input.asOfDate, ...filter.params];
  const ids = await preflight(current.tx, SOURCE, Object.keys(sourceStrings), where, params, LIMIT - 1);
  await collisions(current.tx, SOURCE, where, params);
  const found = bounded(await rows(current.tx, `SELECT ${sourceProjection} FROM ${SOURCE} WHERE ${where} ORDER BY id LIMIT ${LIMIT + 1} FOR UPDATE`, params));
  if (JSON.stringify(found.map(row => row.id)) !== JSON.stringify(ids)) fail("SOURCE_CHANGED", "CONFLICT");
  const facts = found.filter(row => {
    if (!id(row.id) || row.workspaceId !== current.identity.workspaceId || !id(row.importId) || !id(row.userId) || row.reportDate !== latest || typeof row.asin !== "string" || !/^[A-Z0-9]{1,20}$/u.test(row.asin) || typeof row.parentAsin !== "string" || !/^[A-Z0-9]{1,20}$/u.test(row.parentAsin) || typeof row.storeName !== "string" || !row.storeName.trim() || typeof row.country !== "string" || !normalizeMarketplaceCode(row.country) || row.isValid !== 1 || typeof row.sourceRowHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.sourceRowHash) || !["salesQty", "fbaAvailable", "fbaInTransit", "availableStock"].every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)) fail("SOURCE_INVALID");
    return matchesMarketplace(row as { country: string; storeName: string }, input.marketplace) && exactSource(row, input.scope);
  });
  const keys = new Set<string>(), aliases = new Set<string>();
  for (const row of facts) { const key = JSON.stringify([row.asin, row.storeName, normalizeMarketplaceCode(String(row.country))]), alias = key.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase(); if (keys.has(key) || aliases.has(alias)) fail("SOURCE_SCOPE_COLLISION", "CONFLICT"); keys.add(key); aliases.add(alias); }
  if (!facts.length) fail("SOURCE_MISSING");
  return bounded([{ kind: "selection", marketplace: input.marketplace, sourceMode: dedicated ? "lx_inventory_mcp" : "legacy_daily", asOfDate: latest, directory: scoped }, ...facts], LIMIT);
}
async function loadManual(current: Session, input: InventoryPlanningReadInput) {
  const scope = canonicalInventoryPlanningScope(input.scope), values: unknown[] = [current.identity.workspaceId, current.identity.userId];
  const parameterWhere = scope.scopeType === "workspace" ? "" : " AND (scope_type='workspace' OR store_name=?)";
  if (scope.scopeType !== "workspace") values.push(scope.storeName);
  const parameterIds = await preflight(current.tx, PARAMETERS, ["asin", "parent_asin", "store_name", "country", ...Object.values(parameterFields)], `workspaceId=? AND user_id=?${parameterWhere}`, values, 5000);
  await collisions(current.tx, PARAMETERS, `workspaceId=? AND user_id=?${parameterWhere}`, values, true);
  const parameterRows = bounded(await rows(current.tx, `SELECT ${parameterProjection} FROM ${PARAMETERS} WHERE workspaceId=? AND user_id=?${parameterWhere} ORDER BY id LIMIT 5001 FOR UPDATE`, values), 5000);
  if (JSON.stringify(parameterRows.map(row => row.id)) !== JSON.stringify(parameterIds)) fail("SOURCE_CHANGED", "CONFLICT");
  const parameters = parseInventoryPlanningParameterRows(parameterRows, current.identity);
  if (scope.scopeType !== "workspace" && parameters.some(row => row.scopeType !== "workspace" && row.storeName !== scope.storeName)) fail("PARAMETER_SCOPE_COLLISION", "CONFLICT");
  let locals = [] as ReturnType<typeof parseInventoryPlanningLocalRows>;
  if (scope.scopeType === "asin") {
    const localIds = await preflight(current.tx, LOCALS, ["asin", "store_name", "country", "effective_date", "reason"], "workspaceId=? AND user_id=? AND asin=? AND store_name=?", [current.identity.workspaceId, current.identity.userId, scope.asin, scope.storeName], LIMIT);
    await collisions(current.tx, LOCALS, "workspaceId=? AND user_id=? AND asin=? AND store_name=?", [current.identity.workspaceId, current.identity.userId, scope.asin, scope.storeName]);
    const localRows = bounded(await rows(current.tx, `SELECT ${localProjection} FROM ${LOCALS} WHERE workspaceId=? AND user_id=? AND asin=? AND store_name=? ORDER BY id LIMIT ${LIMIT + 1} FOR UPDATE`, [current.identity.workspaceId, current.identity.userId, scope.asin, scope.storeName]));
    if (JSON.stringify(localRows.map(row => row.id)) !== JSON.stringify(localIds)) fail("SOURCE_CHANGED", "CONFLICT");
    locals = parseInventoryPlanningLocalRows(localRows, current.identity);
    if (locals.some(row => row.asin !== scope.asin || row.storeName !== scope.storeName)) fail("LOCAL_SCOPE_COLLISION", "CONFLICT");
  }
  return { parameters, locals };
}

export function createInventoryPlanningWriteRepository(dependencies: { database?: () => Promise<InventoryPlanningWriteDatabase | null>; permission?: typeof assertResourceAction; enabled?: () => boolean; now?: () => Date; journal?: typeof createInventoryPlanningOperationJournal } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction, enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_INVENTORY_PLANNING_WRITES === "true"), now = dependencies.now ?? (() => new Date()), journal = dependencies.journal ?? createInventoryPlanningOperationJournal;
  async function authorize(current: Session, action: "read" | "update" | "cancel") { await permission({ actor: current.actor, resource: "ops_inventory_planning", action, workspaceId: current.identity.workspaceId, authorizationRead: { executor: current.tx, strict: true, lock: true } }); await directory(current, action === "update" ? "edit" : "read"); }
  async function session<T>(ctx: TrpcContext, input: InventoryPlanningReadInput, body: (current: Session) => Promise<T>) {
    if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED"); const workspaceId = ctx.workspaceId ?? ctx.user.defaultWorkspaceId;
    if (!id(ctx.user.id) || !id(workspaceId) || workspaceId !== input.expectedWorkspaceId || !manager(ctx.user.role)) fail("ACTOR_INVALID", "FORBIDDEN");
    const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      const workspaces = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [workspaceId]); if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].status !== "active") fail("WORKSPACE_CHANGED", "FORBIDDEN");
      const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [ctx.user!.id]), actor = actors[0];
      if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || !manager(actor.role) || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("ACTOR_CHANGED", "FORBIDDEN");
      const memberships = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [workspaceId, actor.id]);
      if (memberships.length !== 1 || !id(memberships[0].id) || memberships[0].workspaceId !== workspaceId || memberships[0].userId !== actor.id || memberships[0].status !== "active") fail("MEMBERSHIP_CHANGED", "FORBIDDEN");
      const current: Session = { tx, identity: { userId: actor.id as number, workspaceId }, actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId } };
      await permission({ actor: current.actor, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } }); await authorize(current, "read"); return body(current);
    });
  }
  const unavailable = (reasonCode: string) => ({ status: "unavailable" as const, reasonCode });
  const available = () => ({ status: "available" as const, reasonCode: null });
  async function state(current: Session, input: InventoryPlanningReadInput, ready: Awaited<ReturnType<typeof inventoryPlanningSchemaReady>>) {
    if (!ready.read) fail("SCHEMA_NOT_READY");
    const sources = await loadSources(current, input), manual = await loadManual(current, input), resolved = resolveInventoryPlanningState({ identity: current.identity, scope: input.scope, asOfDate: input.asOfDate, ...manual });
    const snapshotKey = inventoryPlanningSnapshotKey({ identity: current.identity, scope: input.scope, marketplace: input.marketplace, asOfDate: input.asOfDate, sources, ...manual });
    let reason = !enabled() ? "not_enabled_before_release" : !ready.write ? "schema_not_ready" : null;
    try { await authorize(current, "update"); } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") reason ??= "update_denied"; else throw error; }
    const readResult = InventoryPlanningReadResultSchema.parse({ identity: current.identity, scope: canonicalInventoryPlanningScope(input.scope), marketplace: input.marketplace, asOfDate: input.asOfDate, status: "ready", reasonCode: null, snapshotKey, source: { status: "available", recordCount: sources.length - 1, asOfDate: input.asOfDate }, ...resolved,
      capabilities: { saveParameters: reason ? unavailable(reason) : available(), confirmLocal: input.scope.scopeType !== "asin" ? unavailable("child_scope_required") : reason ? unavailable(reason) : available() } });
    return { readResult, sources, ...manual };
  }
  function failedRead(current: Session, input: InventoryPlanningReadInput, error: unknown): InventoryPlanningReadResult {
    const conflict = error instanceof TRPCError && error.code === "CONFLICT" || error instanceof InventoryPlanningWriteError && /CONFLICT|ALIAS/u.test(error.code);
    const reason = error instanceof TRPCError && /^INVENTORY_PLANNING_[A-Z_]+$/u.test(error.message) ? error.message : error instanceof InventoryPlanningWriteError ? error.code : "source_or_saved_unavailable";
    return InventoryPlanningReadResultSchema.parse({ identity: current.identity, scope: canonicalInventoryPlanningScope(input.scope), marketplace: input.marketplace, asOfDate: input.asOfDate, status: conflict ? "conflict" : "unavailable", reasonCode: reason, snapshotKey: null, source: { status: "unavailable", recordCount: 0, asOfDate: null }, parameters: null, local: null, capabilities: { saveParameters: unavailable(reason), confirmLocal: unavailable(reason) } });
  }
  function operation(current: Session, input: InventoryPlanningRecoverInput | InventoryPlanningExecuteInput) { return journal(current.tx, { ...current.identity, scope: canonicalInventoryPlanningScope(input.scope), marketplace: input.marketplace, asOfDate: input.asOfDate, operationId: input.operationId, actorRole: current.actor.role }); }
  function unknown(identity: Identity, input: InventoryPlanningRecoverInput | InventoryPlanningExecuteInput): InventoryPlanningWriteResult { return InventoryPlanningWriteResultSchema.parse({ identity, scope: canonicalInventoryPlanningScope(input.scope), marketplace: input.marketplace, asOfDate: input.asOfDate, operationId: input.operationId, action: "action" in input ? input.action : null, status: "unknown", recordId: null, snapshotKey: null, reasonCode: "outcome_unknown_check_same_operation" }); }
  async function read(ctx: TrpcContext, raw: InventoryPlanningReadInput) {
    const input = InventoryPlanningReadInputSchema.parse(raw);
    try { return await session(ctx, input, async current => { try { return (await state(current, input, await inventoryPlanningSchemaReady(current.tx))).readResult; } catch (error) { if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) throw error; return failedRead(current, input, error); } }); } catch (error) { return safeError(error); }
  }
  async function execute(ctx: TrpcContext, raw: InventoryPlanningExecuteInput): Promise<InventoryPlanningWriteResult> {
    const input = InventoryPlanningExecuteInputSchema.parse(raw); let captured: Identity | null = null;
    try { return await session(ctx, input, async current => {
      captured = current.identity; const ready = await inventoryPlanningSchemaReady(current.tx); if (!ready.journal) fail("JOURNAL_NOT_READY");
      await authorize(current, "update"); const log = operation(current, input), previous = await log.read(), requestHash = inventoryPlanningOperationRequestHash(input);
      if (previous.final) { if (previous.final.requestHash !== null && previous.final.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT"); return previous.final.receipt; }
      if (!enabled()) fail("NOT_ENABLED"); if (!ready.write) fail("SCHEMA_NOT_READY");
      const loaded = await state(current, input, ready); validateInventoryPlanningWriteAgainstReadResult(input, loaded.readResult);
      const clock = now(); if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) fail("CLOCK_INVALID"); const seconds = clock.getTime() / 1000;
      const scope = canonicalInventoryPlanningScope(input.scope); let recordId: number | null;
      if (input.action === "saveParameters") {
        const next = applyInventoryPlanningPatch(loaded.readResult.parameters!.effective, input.patch), currentRow = loaded.parameters.find(row => inventoryPlanningScopeKey(row.scopeType === "workspace" ? { scopeType: "workspace" } : row.scopeType === "store_country" ? { scopeType: row.scopeType, storeName: row.storeName!, country: row.country! } : row.scopeType === "parent_asin" ? { scopeType: row.scopeType, parentAsin: row.parentAsin!, storeName: row.storeName!, country: row.country! } : { scopeType: row.scopeType, asin: row.asin!, storeName: row.storeName!, country: row.country! }) === inventoryPlanningScopeKey(scope));
        const values = Object.keys(parameterFields).map(key => next[key as keyof InventoryPlanningValues]);
        if (currentRow) { recordId = currentRow.id; await mutate(current.tx, `UPDATE ${PARAMETERS} SET ${Object.values(parameterFields).map(column => `${column}=?`).join(",")},is_active=1,updated_at=FROM_UNIXTIME(?) WHERE id=? AND workspaceId=? AND user_id=?`, [...values, seconds, recordId, current.identity.workspaceId, current.identity.userId]); }
        else { recordId = await mutate(current.tx, `INSERT INTO ${PARAMETERS} (workspaceId,user_id,scope_type,asin,parent_asin,store_name,country,${Object.values(parameterFields).join(",")},is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,${values.map(() => "?").join(",")},1,FROM_UNIXTIME(?),FROM_UNIXTIME(?))`, [current.identity.workspaceId, current.identity.userId, scope.scopeType, scope.scopeType === "asin" ? scope.asin : null, scope.scopeType === "parent_asin" ? scope.parentAsin : null, scope.scopeType !== "workspace" ? scope.storeName : null, scope.scopeType !== "workspace" ? scope.country : null, ...values, seconds, seconds]); }
      } else {
        if (scope.scopeType !== "asin") fail("CHILD_SCOPE_REQUIRED", "BAD_REQUEST");
        recordId = await mutate(current.tx, `INSERT INTO ${LOCALS} (workspaceId,user_id,asin,store_name,country,effective_date,local_qty,reason,status,confirmed_by,confirmed_at,superseded_by_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'confirmed',?,FROM_UNIXTIME(?),NULL,FROM_UNIXTIME(?),FROM_UNIXTIME(?))`, [current.identity.workspaceId, current.identity.userId, scope.asin, scope.storeName, scope.country, input.effectiveDate, input.localQty, input.reason, current.identity.userId, seconds, seconds, seconds]);
        if (!recordId) fail("WRITE_UNVERIFIABLE");
        const prior = loaded.locals.filter(row => row.asin === scope.asin && row.storeName === scope.storeName && row.country === scope.country && row.effectiveDate === input.effectiveDate && row.status === "confirmed");
        if (prior.length) await mutate(current.tx, `UPDATE ${LOCALS} SET status='superseded',superseded_by_id=?,updated_at=FROM_UNIXTIME(?) WHERE workspaceId=? AND user_id=? AND status='confirmed' AND id IN (${prior.map(() => "?").join(",")})`, [recordId, seconds, current.identity.workspaceId, current.identity.userId, ...prior.map(row => row.id)], prior.length);
      }
      if (!recordId) fail("WRITE_UNVERIFIABLE");
      const after = await state(current, input, ready); if (inventoryPlanningWriteCanonical(loaded.sources) !== inventoryPlanningWriteCanonical(after.sources)) fail("SOURCE_CHANGED", "CONFLICT");
      const savedLocal = after.readResult.local?.history.find(row => row.id === recordId);
      if (input.action === "saveParameters" ? after.readResult.parameters?.current?.id !== recordId || inventoryPlanningWriteCanonical(after.readResult.parameters.effective) !== inventoryPlanningWriteCanonical(applyInventoryPlanningPatch(loaded.readResult.parameters!.effective, input.patch)) : !savedLocal || savedLocal.localQty !== input.localQty || savedLocal.reason !== input.reason || savedLocal.effectiveDate !== input.effectiveDate || savedLocal.status !== "confirmed" || savedLocal.confirmedBy !== current.identity.userId) fail("WRITE_UNVERIFIABLE");
      return log.finalize(InventoryPlanningWriteResultSchema.parse({ identity: current.identity, scope, marketplace: input.marketplace, asOfDate: input.asOfDate, operationId: input.operationId, action: input.action, status: "committed", recordId, snapshotKey: after.readResult.snapshotKey, reasonCode: null }), requestHash);
    }); } catch (error) { if (error instanceof TRPCError || error instanceof InventoryPlanningWriteError || error instanceof InventoryPlanningJournalError || error instanceof z.ZodError) return safeError(error); if (captured) return unknown(captured, input); return safeError(error); }
  }
  async function recover(ctx: TrpcContext, raw: InventoryPlanningRecoverInput): Promise<InventoryPlanningWriteResult> {
    const input = InventoryPlanningRecoverInputSchema.parse(raw); let captured: Identity | null = null;
    try { return await session(ctx, input, async current => { captured = current.identity; if (!(await inventoryPlanningSchemaReady(current.tx)).journal) fail("JOURNAL_NOT_READY"); if (input.decision === "cancel") await authorize(current, "cancel"); const log = operation(current, input), previous = await log.read(); if (previous.final) return previous.final.receipt; return input.decision === "cancel" ? log.cancel() : unknown(current.identity, input); }); }
    catch (error) { if (error instanceof TRPCError || error instanceof InventoryPlanningWriteError || error instanceof InventoryPlanningJournalError || error instanceof z.ZodError) return safeError(error); if (captured) return unknown(captured, input); return safeError(error); }
  }
  return { read, execute, recover };
}
export const inventoryPlanningWriteRepository = createInventoryPlanningWriteRepository();
