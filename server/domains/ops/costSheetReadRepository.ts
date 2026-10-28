import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES, OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS, OperationsCostSheetReadInputSchema, buildOperationsCostSheetReadResult,
  type OperationsCostSheetReadInput, type OperationsCostSheetReadResult, type OperationsCostSheetScope,
  type OperationsCostSheetSourceRow } from "../../../shared/operationsCostSheetRead";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { splitExternalOperatorNames } from "./operatorNameResolution";

type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
type SourceKind = "lingxing" | "saihu";
export type CostSheetAuthorizedSource = { fact: OperationsCostSheetSourceRow; operator: string | null };
type AuthorizedSource = CostSheetAuthorizedSource;
export type CostSheetStorage = Parameters<typeof buildOperationsCostSheetReadResult>[0]["storage"];
type Storage = CostSheetStorage;
type Lock = "share" | "update";
export interface CostSheetReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
const tableNames = ["lingxing_product_weekly", "saihu_product_weekly", "ops_cost_sheets"] as const;
type Table = typeof tableNames[number];
class CostTableMissing extends Error {}
function noSuchTable(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (item.code === "ER_NO_SUCH_TABLE" || item.errno === 1146) return true;
    current = item.cause;
  }
  return false;
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) fail("COST_SHEET_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> {
  const value = await tx.execute(statement(text, values));
  if (!Array.isArray(value) || !Array.isArray(value[0]) || value[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("COST_SHEET_READ_RESPONSE_INVALID");
  return value[0] as Row[];
}
async function tableRows(tx: DbExecutor, table: Table, text: string, values: unknown[] = []) {
  try { return await rows(tx, text, values); }
  catch (error) {
    if (!noSuchTable(error)) throw error;
    if (table === "ops_cost_sheets") throw new CostTableMissing();
    return fail("COST_SHEET_READ_WEEKLY_SOURCE_NOT_CONNECTED");
  }
}
async function columns(tx: DbExecutor, table: Table, required: string[]): Promise<Set<string>> {
  const metadata = await rows(tx, "SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  if (metadata.some(row => typeof row.columnName !== "string") || new Set(metadata.map(row => row.columnName)).size !== metadata.length) fail("COST_SHEET_READ_SCHEMA_INVALID");
  if (!metadata.length) {
    // Empty metadata is not proof of absence: only the actual table error may
    // produce not_connected. A hidden/denied catalog must not look like no data.
    await tableRows(tx, table, `SELECT 1 AS probe FROM ${table} LIMIT 0`);
    fail("COST_SHEET_READ_SCHEMA_UNAVAILABLE");
  }
  const found = new Set(metadata.map(row => row.columnName as string));
  if (required.some(column => !found.has(column))) fail("COST_SHEET_READ_SCHEMA_UNAVAILABLE");
  return found;
}
const countryAliases: Record<string, string> = {
  "美国": "US", "美国站": "US", "亚马逊美国站": "US", "AMAZON.COM": "US", "加拿大": "CA", "加拿大站": "CA",
  GB: "UK", "英国": "UK", "英国站": "UK", "德国": "DE", "德国站": "DE", "法国": "FR", "法国站": "FR",
  "意大利": "IT", "意大利站": "IT", "西班牙": "ES", "西班牙站": "ES", "日本": "JP", "日本站": "JP",
  "澳大利亚": "AU", "澳洲": "AU", "澳大利亚站": "AU", "墨西哥": "MX", "墨西哥站": "MX",
  "巴西": "BR", "巴西站": "BR", "阿联酋": "AE", "阿联酋站": "AE", "沙特": "SA", "沙特站": "SA", "新加坡": "SG", "新加坡站": "SG",
};
function countrySql(column: "country" | "site") {
  return `CASE UPPER(TRIM(${column})) ${Object.entries(countryAliases).map(([alias, code]) => `WHEN '${alias}' THEN '${code}'`).join(" ")} ELSE UPPER(TRIM(${column})) END`;
}
const scopedWhere = (workspaceColumn: "workspaceId" | "workspace_id", countryColumn: "country" | "site") => `${workspaceColumn}=? AND BINARY parent_asin=BINARY ? AND BINARY store_name=BINARY ? AND ${countrySql(countryColumn)}=?`;
const scopeParams = (scope: OperationsCostSheetScope) => [scope.workspaceId, scope.parentAsin, scope.storeName, scope.country];
function scopeMatches(row: Row, scope: OperationsCostSheetScope) {
  return row.workspaceId === scope.workspaceId && row.parentAsin === scope.parentAsin && row.storeName === scope.storeName
    && typeof row.country === "string" && normalizeMarketplaceCode(row.country) === scope.country;
}
function nullableText(value: unknown, max: number): string | null {
  if (value === null || (typeof value === "string" && value.length <= max)) return value;
  return fail("COST_SHEET_READ_SOURCE_INVALID");
}
function numeric(value: unknown): number | string | null {
  if (value === null || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 200)) return value;
  return fail("COST_SHEET_READ_SOURCE_INVALID");
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail("COST_SHEET_READ_SOURCE_INVALID");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("COST_SHEET_READ_SOURCE_INVALID");
  return value;
}
async function loadSources(tx: DbExecutor, kind: SourceKind, scope: OperationsCostSheetScope, asOfDate: string, lock: Lock = "share"): Promise<AuthorizedSource[]> {
  const table = kind === "lingxing" ? "lingxing_product_weekly" : "saihu_product_weekly", countryColumn = kind === "lingxing" ? "country" : "site";
  const known = await columns(tx, table, ["id", "workspaceId", "parent_asin", "store_name", countryColumn, "week_end_date", "operator"]);
  const optional = { importId: "import_id", sku: "sku", msku: "msku", asin: "asin", currency: "currency", actualFbaUnitFee: "actual_fba_unit_fee", actualFbaTotalFee: "actual_fba_total_fee", fbaSalesQty: "fba_sales_qty",
    sourceKind: "source_kind", sourceBatchId: "source_batch_id", sourceTraceId: "source_trace_id", sourceSchemaVersion: "source_schema_version" } as const;
  const missingColumns = Object.entries(optional).filter(([, column]) => !known.has(column)).map(([field]) => field);
  const field = (column: string, alias: string) => known.has(column) ? `${column} AS ${alias}` : `NULL AS ${alias}`;
  const price = known.has("avg_price") && known.has("price") ? "COALESCE(avg_price,price)" : known.has("avg_price") ? "avg_price" : known.has("price") ? "price" : "NULL";
  const priceField = known.has("avg_price") && known.has("price") ? "IF(avg_price IS NOT NULL,'avgPrice','price')" : known.has("avg_price") ? "'avgPrice'" : known.has("price") ? "'price'" : "NULL";
  const name = known.has("product_name") && known.has("title") ? "COALESCE(NULLIF(product_name,''),title)" : known.has("product_name") ? "product_name" : known.has("title") ? "title" : "NULL";
  const reportDate = known.has("report_date") ? "COALESCE(report_date,week_end_date)" : "week_end_date";
  if (!known.has("avg_price") && !known.has("price")) missingColumns.push("price");
  if (!known.has("product_name") && !known.has("title")) missingColumns.push("name");
  if (!known.has("report_date")) missingColumns.push("reportDate");
  let lockedIds: number[] | undefined;
  if (lock === "update") {
    const boundedFields = ["parent_asin", "store_name", countryColumn, "operator", "week_end_date", ...Object.values(optional), "avg_price", "price", "product_name", "title", "report_date"].filter(column => known.has(column));
    const bytes = boundedFields.map(column => `COALESCE(OCTET_LENGTH(CAST(${column} AS CHAR CHARACTER SET utf8mb4)),0)`).join("+");
    const candidates = await tableRows(tx, table, `SELECT id,${bytes} AS bodyBytes FROM ${table} WHERE ${scopedWhere("workspaceId", countryColumn)} ORDER BY id DESC LIMIT ${OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS + 1} FOR UPDATE`, scopeParams(scope));
    if (candidates.length > OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS || new Set(candidates.map(row => row.id)).size !== candidates.length || candidates.some(row => !id(row.id) || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0 || row.bodyBytes > 65536)
      || candidates.reduce((total, row) => total + Number(row.bodyBytes), 0) > 4 * 1024 * 1024) fail("COST_SHEET_READ_SOURCE_LIMIT");
    lockedIds = candidates.map(row => row.id as number);
  }
  const selected = await tableRows(tx, table, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,${countryColumn} AS country,operator,
    ${reportDate} AS date,${name} AS name,${price} AS price,${priceField} AS priceField,
    ${Object.entries(optional).map(([alias, column]) => field(column, alias)).join(",")}
    FROM ${table} WHERE ${scopedWhere("workspaceId", countryColumn)} ORDER BY id DESC LIMIT ${OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS + 1} FOR ${lock === "update" ? "UPDATE" : "SHARE"}`, scopeParams(scope));
  if (selected.length > OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS || new Set(selected.map(row => row.id)).size !== selected.length) fail("COST_SHEET_READ_SOURCE_LIMIT");
  if (lockedIds && (selected.length !== lockedIds.length || selected.some((row, index) => row.id !== lockedIds[index]))) fail("COST_SHEET_READ_SOURCE_INVALID");
  return selected.map(row => {
    if (!id(row.id) || !scopeMatches(row, scope) || (row.importId !== null && !id(row.importId)) || (row.sourceBatchId !== null && !id(row.sourceBatchId))) fail("COST_SHEET_READ_SOURCE_INVALID");
    const report = date(row.date);
    if (report !== null && report > asOfDate) fail("COST_SHEET_READ_SOURCE_INVALID");
    const fact: OperationsCostSheetSourceRow = { kind, id: row.id, importId: row.importId as number | null, date: report, scope,
      sourceKind: nullableText(row.sourceKind, 48), sourceBatchId: row.sourceBatchId as number | null,
      sourceTraceId: nullableText(row.sourceTraceId, 128), sourceSchemaVersion: nullableText(row.sourceSchemaVersion, 32),
      sku: nullableText(row.sku, 500), msku: nullableText(row.msku, 500), asin: nullableText(row.asin, 2000), name: nullableText(row.name, 1000),
      currency: nullableText(row.currency, 10), price: numeric(row.price), actualFbaUnitFee: numeric(row.actualFbaUnitFee), actualFbaTotalFee: numeric(row.actualFbaTotalFee),
      fbaSalesQty: numeric(row.fbaSalesQty), missingColumns, ...(row.priceField === null ? {} : { priceField: row.priceField as "avgPrice" | "price" }) };
    return { fact, operator: nullableText(row.operator, 200) };
  });
}
async function assignment(tx: DbExecutor, scope: OperationsCostSheetScope, userId: number): Promise<boolean> {
  const selected = await rows(tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
    FROM ops_inventory_owner_assignments WHERE ${scopedWhere("workspaceId", "country")} AND is_active=1 LIMIT 2 FOR SHARE`, scopeParams(scope));
  if (selected.length > 1 || selected.some(row => !id(row.id) || !scopeMatches(row, scope) || !id(row.assigneeUserId) || row.isActive !== 1)) fail("COST_SHEET_READ_OWNER_INVALID", "FORBIDDEN");
  if (!selected.length) return false;
  if (selected[0].assigneeUserId !== userId) fail("COST_SHEET_READ_OWNER_DENIED", "FORBIDDEN");
  return true;
}
async function confirmedSourceOwner(tx: DbExecutor, scope: OperationsCostSheetScope, sources: AuthorizedSource[], userId: number, activeOwnerIds?: ReadonlySet<number>) {
  if (!sources.length || sources.some(source => source.fact.date === null)) fail("COST_SHEET_READ_OWNER_UNVERIFIED", "FORBIDDEN");
  const latestDate = sources.map(source => source.fact.date!).sort().at(-1)!;
  const latest = sources.filter(source => source.fact.date === latestDate), userSets: string[] = [];
  for (const kind of ["lingxing", "saihu"] as const) {
    const matching = latest.filter(source => source.fact.kind === kind);
    if (!matching.length) continue;
    const names = [...new Set(matching.flatMap(source => splitExternalOperatorNames(source.operator)))];
    if (!names.length || names.length > 500 || matching.some(source => !splitExternalOperatorNames(source.operator).length)) fail("COST_SHEET_READ_OWNER_UNVERIFIED", "FORBIDDEN");
    const mappings = await rows(tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
      FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND source_type IN (?,'all')
      AND BINARY external_name IN (${names.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [scope.workspaceId, kind, ...names]);
    if (mappings.length > 1000 || mappings.some(row => !id(row.id) || row.workspaceId !== scope.workspaceId || row.isConfirmed !== 1 || !id(row.systemUserId)
      || typeof row.externalName !== "string" || !names.includes(row.externalName) || ![kind, "all"].includes(String(row.sourceType)))) fail("COST_SHEET_READ_OWNER_UNVERIFIED", "FORBIDDEN");
    const owners = new Map<string, number>();
    for (const name of names) {
      const ids = new Set(mappings.filter(row => row.externalName === name).map(row => row.systemUserId as number));
      if (ids.size !== 1 || activeOwnerIds && [...ids].some(value => !activeOwnerIds.has(value))) fail("COST_SHEET_READ_OWNER_UNVERIFIED", "FORBIDDEN");
      owners.set(name, [...ids][0]);
    }
    for (const source of matching) {
      const ownerIds = [...new Set(splitExternalOperatorNames(source.operator).map(name => owners.get(name)!))].sort((a, b) => a - b);
      if (!ownerIds.includes(userId)) fail("COST_SHEET_READ_OWNER_DENIED", "FORBIDDEN");
      userSets.push(ownerIds.join(","));
    }
  }
  if (!userSets.length || new Set(userSets).size !== 1) fail("COST_SHEET_READ_OWNER_CONFLICT", "FORBIDDEN");
}
function savedTimestamp(epochMs: unknown): string {
  // Raw Drizzle/mysql2 TIMESTAMP fields are strings. Project UNIX_TIMESTAMP in
  // SQL instead of interpreting a timezone-free datetime in the Node process.
  // mysql2 may return the multiplication as an integer or DECIMAL text.
  const value = typeof epochMs === "number" ? epochMs : typeof epochMs === "string" && epochMs.length <= 32
    && /^(?:0|[1-9][0-9]*)(?:\.0+)?$/u.test(epochMs) ? Number(epochMs) : NaN;
  // Keep both arithmetic and the shared four-digit-year ISO contract valid.
  if (!Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799_999) fail("COST_SHEET_READ_SAVED_INVALID");
  return new Date(value).toISOString();
}
async function saved(tx: DbExecutor, scope: OperationsCostSheetScope, lock: Lock = "share"): Promise<Storage> {
  try {
    await columns(tx, "ops_cost_sheets", ["id", "workspace_id", "parent_asin", "store_name", "country", "version", "updated_by", "updated_at", "payload"]);
    const selected = await tableRows(tx, "ops_cost_sheets", `SELECT id,workspace_id AS workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,
      version,updated_by AS updatedBy,UNIX_TIMESTAMP(updated_at)*1000 AS updatedAtEpochMs,IF(OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=${OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES},CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload,
      OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes
      FROM ops_cost_sheets WHERE ${scopedWhere("workspace_id", "country")} LIMIT 2 FOR ${lock === "update" ? "UPDATE" : "SHARE"}`, scopeParams(scope));
    if (!selected.length) return { status: "not_saved" };
    const record = selected[0];
    if (selected.length !== 1 || !id(record.id) || !scopeMatches(record, scope) || !id(record.version) || !id(record.updatedBy)) fail("COST_SHEET_READ_SAVED_INVALID");
    const updatedAt = savedTimestamp(record.updatedAtEpochMs);
    // The same 1 MiB budget applies to the database's textual JSON transport;
    // MySQL formatting whitespace counts too. Never fetch or slice over-budget data.
    if (typeof record.payload !== "string" || !Number.isSafeInteger(record.payloadBytes) || Number(record.payloadBytes) > OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES
      || Buffer.byteLength(record.payload, "utf8") !== record.payloadBytes) return { status: "corrupt", reasonCode: "invalid_payload" };
    return { status: "saved", record: { id: record.id, version: record.version, updatedBy: record.updatedBy, updatedAt, payload: record.payload } };
  } catch (error) {
    if (error instanceof CostTableMissing) return { status: "not_connected", reasonCode: "table_missing" };
    throw error;
  }
}
export interface CostSheetReadSession {
  tx: DbExecutor;
  identity: { userId: number; workspaceId: number };
  role: string;
  scope: OperationsCostSheetScope;
  asOfDate: string;
}
/** Already-authorized transaction only. Write callers hold the actor lock,
 * request update locks and supply current active numeric workspace members.
 * The original read path retains its existing authorization and source rules. */
export async function loadCostSheetReadState(session: CostSheetReadSession, options: { lock?: Lock; activeOwnerIds?: ReadonlySet<number> } = {}) {
  const { tx, identity, role, scope, asOfDate } = session;
  if (identity.workspaceId !== scope.workspaceId) fail("COST_SHEET_READ_WORKSPACE_CHANGED", "FORBIDDEN");
  const manager = ["super_admin", "admin", "ops_manager"].includes(role);
  const assigned = manager ? false : await assignment(tx, scope, identity.userId);
  const sources = [...await loadSources(tx, "lingxing", scope, asOfDate, options.lock), ...await loadSources(tx, "saihu", scope, asOfDate, options.lock)];
  if (sources.length > OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS) fail("COST_SHEET_READ_SOURCE_LIMIT");
  if (!manager && !assigned) await confirmedSourceOwner(tx, scope, sources, identity.userId, options.activeOwnerIds);
  const storage = await saved(tx, scope, options.lock);
  const readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate, storage, sources: sources.map(source => source.fact) });
  return { readResult, sources, storage };
}
export type CostSheetReadState = Awaited<ReturnType<typeof loadCostSheetReadState>>;
// Narrow SQL primitives permit the write path to use identical scope matching
// and current-source projections without opening a second transaction.
export { statement as costSheetSql, rows as costSheetRows, id as costSheetId, scopedWhere as costSheetScopedWhere, scopeParams as costSheetScopeParams };
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^COST_SHEET_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("COST_SHEET_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("COST_SHEET_READ_FAILED", "INTERNAL_SERVER_ERROR");
}

/** The friend's complete saved sheet plus real report observations. This
 * repository never creates schema/defaults, substitutes legacy parameters,
 * mutates reports, or represents the current saved version as history. */
export function createCostSheetReadRepository(dependencies: { database?: () => Promise<CostSheetReadDatabase | null>; permission?: typeof assertResourceAction; now?: () => Date } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction, now = dependencies.now ?? (() => new Date());
  async function read(ctx: TrpcContext, raw: OperationsCostSheetReadInput): Promise<OperationsCostSheetReadResult> {
    try {
      if (!ctx.user) fail("COST_SHEET_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = OperationsCostSheetReadInputSchema.safeParse(raw);
      if (!parsed.success) fail("COST_SHEET_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!id(ctx.user.id) || !id(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("COST_SHEET_READ_ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("COST_SHEET_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const scope: OperationsCostSheetScope = { workspaceId, parentAsin: input.parentAsin, storeName: input.storeName, country: input.country };
      const clock = now();
      if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) fail("COST_SHEET_READ_CLOCK_INVALID");
      const asOfDate = clock.toISOString().slice(0, 10), db = await database();
      if (!db || typeof db.transaction !== "function") fail("COST_SHEET_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("COST_SHEET_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read",
          workspaceId, resourceId: JSON.stringify([scope.parentAsin, scope.storeName, scope.country]), authorizationRead: { executor: tx, strict: true, lock: true } });
        return (await loadCostSheetReadState({ tx, identity: { userId: actor.id as number, workspaceId }, role: actor.role as string, scope, asOfDate })).readResult;
      });
    } catch (error) { return sanitized(error); }
  }
  return { read };
}
export const costSheetReadRepository = createCostSheetReadRepository();
