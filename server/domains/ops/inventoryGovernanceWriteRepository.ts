import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { InventoryGovernanceReadInputSchema, InventoryGovernanceExecuteInputSchema, InventoryGovernanceRecoverInputSchema, InventoryGovernanceReadResultSchema, InventoryGovernanceWriteResultSchema, InventoryGovernanceRuleSchema, InventoryGovernanceMemberSchema, InventoryGovernanceCandidateSchema, InventoryGovernanceLifecycleRowSchema, InventoryGovernanceOwnerScopeSchema, inventoryGovernanceCanonical, inventoryGovernanceScopeKey, inventoryGovernanceAliasKey, inventoryGovernanceSnapshotKey, inventoryGovernanceOperationRequestHash, type InventoryGovernanceIdentity, type InventoryGovernanceReadInput, type InventoryGovernanceReadResult, type InventoryGovernanceExecuteInput, type InventoryGovernanceRecoverInput, type InventoryGovernanceWriteResult, type InventoryGovernanceCandidate, type InventoryGovernanceRule } from "../../../shared/inventoryGovernanceWrite";
import { createInventoryGovernanceOperationJournal, InventoryGovernanceJournalError } from "./inventoryGovernanceOperationJournal";
import { inventoryLifecycleSchemaReady, InventoryLifecycleGovernanceError, loadInventoryLifecycleState, restoreInventoryLifecycleState } from "./lifecycle/inventoryLifecycleGovernance";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";

type Row = Record<string, unknown>;
type Session = { tx: DbExecutor; identity: InventoryGovernanceIdentity; actor: { id: number; role: string; defaultWorkspaceId: number } };
export interface InventoryGovernanceDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const RULES = "ops_inventory_owner_assignments", AUDITS = "ops_inventory_owner_assignment_audits", DAILY = "ops_asin_daily_snapshots", WEEKLY = "lingxing_product_weekly", JOURNAL = "security_audit_logs";
const MAX_ROWS = 10000, MAX_BYTES = 8 * 1024 * 1024;
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const manager = (value: unknown): value is string => ["super_admin", "admin", "ops_manager"].includes(String(value));
function fail(reason: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT" | "BAD_REQUEST" = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message: `INVENTORY_GOVERNANCE_${reason}` }); }
function statement(text: string, values: unknown[] = []): SQL { const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID"); return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); }
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> { const raw = await tx.execute(statement(text, values)); if (!Array.isArray(raw) || !Array.isArray(raw[0]) || raw[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID"); return raw[0]; }
async function mutate(tx: DbExecutor, text: string, values: unknown[]): Promise<number | null> { const raw = await tx.execute(statement(text, values)), result = Array.isArray(raw) ? raw[0] : null; if (!result || result.affectedRows !== 1) fail("WRITE_UNVERIFIABLE"); return id(result.insertId) ? result.insertId : null; }
function safeError(error: unknown): never { if (error instanceof InventoryGovernanceJournalError || error instanceof InventoryLifecycleGovernanceError) fail(error.code, /CONFLICT|MISMATCH|CANCELLED|DUPLICATE/u.test(error.code) ? "CONFLICT" : "BAD_REQUEST"); if (error instanceof TRPCError && /^(INVENTORY_GOVERNANCE_|INVENTORY_LIFECYCLE_)/u.test(error.message)) throw error; if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN"); fail("UNAVAILABLE"); }
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(value => new Set(value).size === value.length), name = z.string().min(1).max(100).refine(value => value.trim() === value);
const details = z.array(z.object({ moduleId: name, operations, subModules: z.array(z.object({ subModuleId: name, operations }).strict()).max(100).refine(value => new Set(value.map(item => item.subModuleId)).size === value.length).optional() }).strict()).max(100).refine(value => new Set(value.map(item => item.moduleId)).size === value.length);
function permissionJson(value: unknown) { try { const wire = typeof value === "string" ? value : JSON.stringify(value); if (!wire || Buffer.byteLength(wire) > 65536) fail("DIRECTORY_INVALID", "FORBIDDEN"); return JSON.parse(wire); } catch { return fail("DIRECTORY_INVALID", "FORBIDDEN"); } }
async function directory(current: Session, operation: "read" | "edit") {
  if (current.actor.role === "super_admin") return;
  const selected = await rows(current.tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [current.actor.role, current.identity.workspaceId]);
  if (selected.length > 2 || new Set(selected.map(row => row.workspaceId)).size !== selected.length || selected.some(row => !id(row.id) || row.role !== current.actor.role || row.workspaceId !== null && row.workspaceId !== current.identity.workspaceId)) fail("DIRECTORY_INVALID", "FORBIDDEN");
  const record = selected.find(row => row.workspaceId === current.identity.workspaceId) ?? selected.find(row => row.workspaceId === null);
  if (!record) { if (!ROLE_MODULE_ACCESS[current.actor.role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return; }
  const modules = z.array(name).max(100).refine(value => new Set(value).size === value.length).safeParse(permissionJson(record.modules)), detail = record.detailedPermissions === null ? null : details.safeParse(permissionJson(record.detailedPermissions));
  if (!modules.success || detail && !detail.success || !modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = detail?.success ? detail.data.find(item => item.moduleId === "ops") : undefined; if (!module) return;
  for (const subModuleId of ["ops_dashboard", "ops_inventory"]) { const granted = module.subModules?.find(item => item.subModuleId === subModuleId)?.operations ?? module.operations; if (!granted.includes("read") || subModuleId === "ops_inventory" && !granted.includes(operation)) fail("DIRECTORY_DENIED", "FORBIDDEN"); }
}
const allowedCollations = ["utf8mb4_unicode_ci", "utf8mb4_general_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"];
/** Capability admission only. Historical migrations and production are untouched. */
export async function inventoryGovernanceSchemaReady(tx: DbExecutor) {
  const tables = [RULES, AUDITS, DAILY, WEEKLY, JOURNAL, "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  const columns = await rows(tx, `SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${[RULES, AUDITS, DAILY, WEEKLY, JOURNAL].map(() => "?").join(",")})`, [RULES, AUDITS, DAILY, WEEKLY, JOURNAL]);
  const indexes = await rows(tx, `SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence,NON_UNIQUE AS nonUnique,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${[RULES, AUDITS, DAILY, WEEKLY, JOURNAL].map(() => "?").join(",")})`, [RULES, AUDITS, DAILY, WEEKLY, JOURNAL]);
  if (engines.length > tables.length || new Set(engines.map(row => row.tableName)).size !== engines.length || columns.length > 600 || new Set(columns.map(row => `${row.tableName}:${row.columnName}`)).size !== columns.length || indexes.length > 300 || columns.some(row => typeof row.extra !== "string" || typeof row.columnType !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || row.defaultValue !== null && typeof row.defaultValue !== "string" && !(typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue)))) fail("SCHEMA_INVALID");
  const engine = (table: string) => engines.some(row => row.tableName === table && row.engine === "InnoDB");
  const column = (table: string, key: string) => columns.find(row => row.tableName === table && row.columnName === key);
  function compatible(table: string, key: string, kind: "int" | "text" | "time" | "json" | "enum", nullable: boolean | "either" = false, length = 0) {
    const row = column(table, key); if (!row || /(?:virtual|stored) generated|unsigned/iu.test(`${row.extra} ${row.columnType}`) || nullable !== "either" && row.isNullable !== (nullable ? "YES" : "NO")) return false;
    if (kind === "int") return ["int", "tinyint"].includes(String(row.dataType)) && (key !== "id" || row.extra === "auto_increment");
    if (kind === "text") return row.dataType === "varchar" && Number(row.maxLength) >= length && Number(row.maxLength) <= 2000 && allowedCollations.includes(String(row.collation));
    if (kind === "time") return ["timestamp", "datetime"].includes(String(row.dataType));
    if (kind === "enum") return row.dataType === "enum" && allowedCollations.includes(String(row.collation));
    return row.dataType === "json";
  }
  const byIndex = new Map<string, Row[]>(); for (const row of indexes) { if (!tables.includes(String(row.tableName)) || ![0, 1].includes(Number(row.nonUnique)) || !id(Number(row.sequence))) fail("SCHEMA_INVALID"); const key = `${row.tableName}:${row.indexName}`; byIndex.set(key, [...(byIndex.get(key) ?? []), row]); }
  const indexList = [...byIndex.values()].map(group => group.sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  const hasIndex = (table: string, keys: string[], unique = false, exact = unique) => indexList.some(group => group[0].tableName === table && (!unique || Number(group[0].nonUnique) === 0) && (exact ? group.length === keys.length : group.length >= keys.length) && group.every((row, i) => Number(row.sequence) === i + 1 && row.prefixLength === null && row.nonUnique === group[0].nonUnique) && keys.every((key, i) => group[i].columnName === key));
  const base = tables.slice(5).every(engine);
  const ids = (table: string, keys: string[]) => keys.every(key => compatible(table, key, "int", key === "workspaceId" ? "either" : false));
  const strings = (table: string, values: Record<string, number>, nullable = false) => Object.entries(values).every(([key, length]) => compatible(table, key, "text", nullable, length));
  const time = (table: string, keys: string[]) => keys.every(key => compatible(table, key, "time"));
  const owner = engine(RULES) && ids(RULES, ["id", "workspaceId", "assignee_user_id", "is_active", "created_by_user_id", "updated_by_user_id"]) && strings(RULES, { parent_asin: 20, store_name: 200, country: 50, assignee_name: 200 }) && time(RULES, ["created_at", "updated_at"]) && hasIndex(RULES, ["id"], true) && hasIndex(RULES, ["workspaceId", "parent_asin", "store_name", "country"], true) && indexList.filter(group => group[0].tableName === RULES && Number(group[0].nonUnique) === 0).every(group => ["id", "workspaceId,parent_asin,store_name,country"].includes(group.map(row => row.columnName).join(",")));
  const daily = engine(DAILY) && ids(DAILY, ["id", "workspaceId", "import_id", "user_id", "is_valid"]) && strings(DAILY, { source_type: 20, report_date: 10, asin: 20, parent_asin: 20, store_name: 200, country: 50, source_row_hash: 64 }) && strings(DAILY, { product_name: 500, title: 1000, operator: 200 }, true) && time(DAILY, ["created_at", "updated_at"]) && hasIndex(DAILY, ["id"], true) && hasIndex(DAILY, ["workspaceId"], false);
  const weekly = engine(WEEKLY) && ids(WEEKLY, ["id", "workspaceId", "import_id", "user_id"]) && strings(WEEKLY, { source_kind: 48, week_start_date: 10, week_end_date: 10 }) && strings(WEEKLY, { asin: 2000, parent_asin: 500, store_name: 200, country: 50, product_name: 500, title: 1000, operator: 200 }, true) && hasIndex(WEEKLY, ["id"], true) && hasIndex(WEEKLY, ["workspaceId"], false);
  const business = engine(AUDITS) && ids(AUDITS, ["id", "workspaceId", "assignment_id", "changed_by_user_id"]) && ["previous_assignee_user_id", "next_assignee_user_id"].every(key => compatible(AUDITS, key, "int", true)) && strings(AUDITS, { previous_assignee_name: 200, next_assignee_name: 200, reason: 500 }, true) && compatible(AUDITS, "action", "enum") && column(AUDITS, "action")?.columnType === "enum('created','replaced','revoked')" && time(AUDITS, ["created_at"]) && hasIndex(AUDITS, ["id"], true) && hasIndex(AUDITS, ["workspaceId", "assignment_id", "created_at"], false);
  const journal = base && engine(JOURNAL) && ids(JOURNAL, ["id", "workspaceId"]) && compatible(JOURNAL, "actorUserId", "int", "either") && strings(JOURNAL, { auditId: 80, action: 80, resourceType: 64 }) && compatible(JOURNAL, "actorRole", "text", "either", 64) && compatible(JOURNAL, "resourceId", "text", "either", 128) && compatible(JOURNAL, "status", "enum") && column(JOURNAL, "status")?.columnType === "enum('success','denied','failed')" && compatible(JOURNAL, "riskLevel", "enum") && column(JOURNAL, "riskLevel")?.columnType === "enum('low','medium','high','critical')" && compatible(JOURNAL, "metadata", "json", "either") && hasIndex(JOURNAL, ["auditId"], true);
  const supplied: Record<string, string[]> = {
    [RULES]: ["id", "workspaceId", "parent_asin", "store_name", "country", "assignee_user_id", "assignee_name", "is_active", "created_by_user_id", "updated_by_user_id", "created_at", "updated_at"],
    [AUDITS]: ["id", "workspaceId", "assignment_id", "action", "previous_assignee_user_id", "previous_assignee_name", "next_assignee_user_id", "next_assignee_name", "reason", "changed_by_user_id", "created_at"],
    [JOURNAL]: ["id", "auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"],
  };
  const noRequiredExtra = (table: string) => columns.filter(row => row.tableName === table).every(row => supplied[table].includes(String(row.columnName)) || row.isNullable === "YES" || row.defaultValue !== null || /auto_increment|(?:virtual|stored) generated/iu.test(String(row.extra)));
  const noExtraUnique = (table: string) => indexList.filter(group => group[0].tableName === table && Number(group[0].nonUnique) === 0).every(group => group.length === 1 && group[0].prefixLength === null && (group[0].columnName === "id" || table === JOURNAL && group[0].columnName === "auditId"));
  const journalReady = journal && noRequiredExtra(JOURNAL) && noExtraUnique(JOURNAL);
  const scopeCollations = { parentAsin: column(RULES, "parent_asin")?.collation, storeName: column(RULES, "store_name")?.collation, country: column(RULES, "country")?.collation };
  return { read: base && owner && daily && weekly, write: base && owner && daily && weekly && business && journalReady && noRequiredExtra(RULES) && noRequiredExtra(AUDITS) && noExtraUnique(AUDITS), journal: journalReady, scopeCollations };
}
function bounded<T>(value: T[], max = MAX_ROWS): T[] { if (value.length > max || Buffer.byteLength(inventoryGovernanceCanonical(value)) > MAX_BYTES) fail("SOURCE_LIMIT"); return value; }
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => { const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; });
const sourceSchema = z.object({ id: z.number().int().positive(), workspaceId: z.number().int().positive(), importId: z.number().int().positive(), userId: z.number().int().positive(), sourceKind: z.string(), asin: z.string().nullable(), parentAsin: z.string().nullable(), storeName: z.string().nullable(), country: z.string().nullable(), startDate: dateSchema, endDate: dateSchema, isValid: z.number().int(), sourceRowHash: z.string().nullable(), productName: z.string().nullable(), title: z.string().nullable(), operator: z.string().nullable() }).strict();
const ruleProjection = "id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,assignee_name AS assigneeName,is_active AS isActive,created_by_user_id AS createdByUserId,updated_by_user_id AS updatedByUserId,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt";
async function checkedProjection(tx: DbExecutor, from: string, projection: string, byteExpressions: string[], params: unknown[], max = MAX_ROWS): Promise<Row[]> {
  const sizes = await rows(tx, `SELECT f.id,OCTET_LENGTH(CAST(JSON_ARRAY(${byteExpressions.join(",")}) AS CHAR CHARACTER SET utf8mb4)) AS bodyBytes ${from} ORDER BY f.id LIMIT ${max + 1} FOR UPDATE`, params);
  if (sizes.length > max || new Set(sizes.map(row => row.id)).size !== sizes.length || sizes.some(row => !id(row.id) || !Number.isSafeInteger(Number(row.bodyBytes)) || Number(row.bodyBytes) < 0) || sizes.reduce((sum, row) => sum + Number(row.bodyBytes), 0) > MAX_BYTES) fail("SOURCE_LIMIT");
  const result = bounded(await rows(tx, `SELECT ${projection} ${from} ORDER BY f.id LIMIT ${max + 1} FOR UPDATE`, params), max);
  if (inventoryGovernanceCanonical(result.map(row => row.id)) !== inventoryGovernanceCanonical(sizes.map(row => row.id))) fail("SOURCE_CHANGED", "CONFLICT"); return result;
}
async function loadOwnerSources(current: Session) {
  const workspace = current.identity.workspaceId;
  const dailyGroup = `FROM ${DAILY} WHERE workspaceId=? GROUP BY BINARY source_type,BINARY asin,BINARY store_name,BINARY country`;
  const weeklyGroup = `FROM ${WEEKLY} WHERE workspaceId=? AND source_kind='lingxing_mcp_parent_asin_weekly' GROUP BY BINARY source_kind,BINARY parent_asin,BINARY store_name,BINARY country`;
  const directory = bounded(await rows(current.tx, `SELECT MIN(source_type) AS sourceKind,MIN(asin) AS subject,MIN(store_name) AS storeName,MIN(country) AS country,MAX(report_date) AS latestDate,COUNT(*) AS historyCount ${dailyGroup} ORDER BY BINARY source_type,BINARY asin,BINARY store_name,BINARY country LIMIT ${MAX_ROWS + 1} FOR SHARE`, [workspace]));
  const weeklyDirectory = bounded(await rows(current.tx, `SELECT MIN(source_kind) AS sourceKind,MIN(parent_asin) AS subject,MIN(store_name) AS storeName,MIN(country) AS country,MAX(week_end_date) AS latestDate,COUNT(*) AS historyCount ${weeklyGroup} ORDER BY BINARY source_kind,BINARY parent_asin,BINARY store_name,BINARY country LIMIT ${MAX_ROWS + 1} FOR SHARE`, [workspace]));
  bounded([...directory, ...weeklyDirectory]);
  for (const row of [...directory, ...weeklyDirectory]) {
    if (!["lingxing", "lingxing_mcp", "saihu", "lx_inventory_mcp", "lingxing_mcp_parent_asin_weekly"].includes(String(row.sourceKind)) || typeof row.subject !== "string" || !row.subject || typeof row.storeName !== "string" || !row.storeName || typeof row.country !== "string" || !row.country || !Number.isSafeInteger(Number(row.historyCount)) || Number(row.historyCount) <= 0) fail("SOURCE_INVALID"); dateSchema.parse(row.latestDate);
  }
  // Latest groups are complete, not a truncated historical-row sample. Old daily
  // history cannot keep a child attached to a superseded parent identity.
  const dailyFrom = `FROM ${DAILY} f INNER JOIN (SELECT MIN(source_type) AS source_type,MIN(asin) AS asin,MIN(store_name) AS store_name,MIN(country) AS country,MAX(report_date) AS latestDate ${dailyGroup}) d ON BINARY f.source_type=BINARY d.source_type AND BINARY f.asin=BINARY d.asin AND BINARY f.store_name=BINARY d.store_name AND BINARY f.country=BINARY d.country AND BINARY f.report_date=BINARY d.latestDate WHERE f.workspaceId=?`;
  const weeklyFrom = `FROM ${WEEKLY} f INNER JOIN (SELECT MIN(source_kind) AS source_kind,MIN(parent_asin) AS parent_asin,MIN(store_name) AS store_name,MIN(country) AS country,MAX(week_end_date) AS latestDate ${weeklyGroup}) d ON BINARY f.source_kind=BINARY d.source_kind AND BINARY f.parent_asin=BINARY d.parent_asin AND BINARY f.store_name=BINARY d.store_name AND BINARY f.country=BINARY d.country AND BINARY f.week_end_date=BINARY d.latestDate WHERE f.workspaceId=?`;
  const common = "f.id,f.workspaceId,f.import_id AS importId,f.user_id AS userId,f.asin,f.parent_asin AS parentAsin,f.store_name AS storeName,f.country,f.product_name AS productName,f.title,f.operator";
  const bytes = ["f.id", "f.asin", "f.parent_asin", "f.store_name", "f.country", "f.product_name", "f.title", "f.operator"];
  const daily = await checkedProjection(current.tx, dailyFrom, `${common},f.source_type AS sourceKind,f.report_date AS startDate,f.report_date AS endDate,f.is_valid AS isValid,f.source_row_hash AS sourceRowHash`, [...bytes, "f.source_type", "f.report_date", "f.source_row_hash"], [workspace, workspace]);
  const weekly = await checkedProjection(current.tx, weeklyFrom, `${common},f.source_kind AS sourceKind,f.week_start_date AS startDate,f.week_end_date AS endDate,1 AS isValid,NULL AS sourceRowHash`, [...bytes, "f.source_kind", "f.week_start_date", "f.week_end_date"], [workspace, workspace]);
  const sources = bounded([...daily, ...weekly]).map(row => sourceSchema.parse(row));
  if (sources.some(row => row.workspaceId !== workspace || row.isValid !== 1 || row.startDate > row.endDate || row.sourceKind !== "lingxing_mcp_parent_asin_weekly" && (typeof row.sourceRowHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.sourceRowHash)))) fail("SOURCE_INVALID");
  const sourceKey = (kind: string, subject: string | null, store: string | null, country: string | null, date: string) => inventoryGovernanceCanonical([kind, subject, store, country, date]);
  const expectedGroups = new Set([...directory, ...weeklyDirectory].map(row => sourceKey(String(row.sourceKind), String(row.subject), String(row.storeName), String(row.country), String(row.latestDate))));
  if (expectedGroups.size !== directory.length + weeklyDirectory.length) fail("SOURCE_INVALID");
  const actualGroups = new Set<string>(), latestParents = new Map<string, string | null>();
  for (const row of sources) {
    const key = sourceKey(row.sourceKind, row.sourceKind === "lingxing_mcp_parent_asin_weekly" ? row.parentAsin : row.asin, row.storeName, row.country, row.endDate);
    if (!expectedGroups.has(key) || latestParents.has(key) && latestParents.get(key) !== row.parentAsin) fail("SOURCE_CHANGED", "CONFLICT");
    actualGroups.add(key); latestParents.set(key, row.parentAsin);
  }
  if (actualGroups.size !== expectedGroups.size) fail("SOURCE_CHANGED", "CONFLICT");
  return { directory, weeklyDirectory, sources };
}
async function loadMembers(current: Session) {
  const raw = bounded(await rows(current.tx, "SELECT m.id AS membershipId,m.workspaceId,m.userId,m.status AS membershipStatus,u.id,IF(OCTET_LENGTH(u.name)<=800,u.name,NULL) AS name,OCTET_LENGTH(u.name) AS nameBytes,u.role,u.status AS userStatus FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId WHERE m.workspaceId=? ORDER BY m.id LIMIT 5001 FOR SHARE", [current.identity.workspaceId]), 5000);
  const seen = new Set<number>(); const members: z.infer<typeof InventoryGovernanceMemberSchema>[] = [];
  for (const row of raw) {
    if (!id(row.membershipId) || row.workspaceId !== current.identity.workspaceId || !id(row.userId) || !["active", "disabled", "invited"].includes(String(row.membershipStatus))) fail("MEMBER_INVALID");
    if (seen.has(row.userId)) fail("MEMBER_DUPLICATE", "CONFLICT"); seen.add(row.userId);
    if (row.id !== row.userId || !["active", "pending", "disabled"].includes(String(row.userStatus))) fail("MEMBER_INVALID");
    if (row.membershipStatus !== "active" || row.userStatus !== "active") continue;
    if (row.nameBytes !== null && (!Number.isSafeInteger(Number(row.nameBytes)) || Number(row.nameBytes) > 800) || row.name !== null && (typeof row.name !== "string" || row.name.length > 200)) fail("MEMBER_INVALID");
    members.push(InventoryGovernanceMemberSchema.parse({ userId: row.userId, displayName: typeof row.name === "string" && row.name ? row.name : `成员 #${row.userId}`, role: row.role }));
  }
  return { raw, members };
}
function buildCandidates(sources: Awaited<ReturnType<typeof loadOwnerSources>>["sources"]): InventoryGovernanceCandidate[] {
  const candidates = new Map<string, InventoryGovernanceCandidate>();
  for (const row of sources) {
    const scope = InventoryGovernanceOwnerScopeSchema.parse({ parentAsin: row.parentAsin, storeName: row.storeName, country: row.country }), key = inventoryGovernanceScopeKey(scope), sourceKind = row.sourceKind === "lingxing_mcp_parent_asin_weekly" ? "parent_weekly" : "daily";
    const item = candidates.get(key) ?? { scope, childAsins: [], productNames: [], externalOperators: [], sourceKinds: [], sourceCount: 0, latestDate: row.endDate };
    // A weekly comma-joined child field is display-only; exact parent scope is
    // still the authority. It never creates per-child assignment permissions.
    if (row.asin) for (const child of row.asin.split(/[,，\s]+/u).filter(Boolean)) { if (!/^[A-Za-z0-9]{1,20}$/u.test(child)) fail("SOURCE_INVALID"); if (!item.childAsins.includes(child)) item.childAsins.push(child); }
    const productName = (row.productName || row.title)?.trim(), operator = row.operator?.trim();
    if (productName && !item.productNames.includes(productName)) item.productNames.push(productName);
    if (operator && !item.externalOperators.includes(operator)) item.externalOperators.push(operator);
    if (!item.sourceKinds.includes(sourceKind)) item.sourceKinds.push(sourceKind);
    item.sourceCount++; if (row.endDate > item.latestDate) item.latestDate = row.endDate; candidates.set(key, item);
  }
  return [...candidates.values()].sort((a, b) => inventoryGovernanceScopeKey(a.scope).localeCompare(inventoryGovernanceScopeKey(b.scope))).map(value => InventoryGovernanceCandidateSchema.parse(value));
}
async function ownerState(current: Session, ready: Awaited<ReturnType<typeof inventoryGovernanceSchemaReady>>) {
  if (!ready.read) fail("SCHEMA_NOT_READY");
  const source = await loadOwnerSources(current), member = await loadMembers(current);
  const rawRules = await checkedProjection(current.tx, `FROM ${RULES} f WHERE f.workspaceId=?`, ruleProjection.replace(/(?<![A-Za-z_])(?:id|workspaceId|parent_asin|store_name|country|assignee_user_id|assignee_name|is_active|created_by_user_id|updated_by_user_id|created_at|updated_at)(?![A-Za-z_])/gu, match => `f.${match}`), ["f.id", "f.parent_asin", "f.store_name", "f.country", "f.assignee_name"], [current.identity.workspaceId]);
  const rules = rawRules.map(row => InventoryGovernanceRuleSchema.parse(row));
  if (rules.some(row => row.workspaceId !== current.identity.workspaceId) || new Set(rules.map(inventoryGovernanceScopeKey)).size !== rules.length) fail("RULE_CONFLICT", "CONFLICT");
  const candidates = buildCandidates(source.sources), scopes = [...candidates.map(item => item.scope), ...rules.map(rule => ({ parentAsin: rule.parentAsin, storeName: rule.storeName, country: rule.country }))];
  const aliases = new Map<string, string>(); for (const scope of scopes) { const key = inventoryGovernanceScopeKey(scope), alias = inventoryGovernanceAliasKey(scope); if (aliases.has(alias) && aliases.get(alias) !== key) fail("SCOPE_ALIAS_CONFLICT", "CONFLICT"); aliases.set(alias, key); }
  // Compare the complete directory under the actual admitted rule-column
  // collations, including cross-source differences (not only JS case folding).
  const collations = ready.scopeCollations;
  if (Object.values(collations).some(value => !allowedCollations.includes(String(value)))) fail("SCHEMA_NOT_READY");
  if (scopes.length) {
    const collision = await rows(current.tx, `SELECT COUNT(DISTINCT BINARY JSON_ARRAY(parentAsin,storeName,country)) AS identityCount FROM JSON_TABLE(?, '$[*]' COLUMNS(parentAsin VARCHAR(20) PATH '$.parentAsin',storeName VARCHAR(200) PATH '$.storeName',country VARCHAR(50) PATH '$.country')) scope_rows GROUP BY CONVERT(parentAsin USING utf8mb4) COLLATE ${collations.parentAsin},CONVERT(storeName USING utf8mb4) COLLATE ${collations.storeName},CONVERT(country USING utf8mb4) COLLATE ${collations.country} HAVING identityCount>1 LIMIT 1`, [JSON.stringify(scopes)]);
    if (collision.length) fail("SCOPE_COLLATION_CONFLICT", "CONFLICT");
  }
  return { source, member, rules, candidates };
}
export function createInventoryGovernanceWriteRepository(dependencies: { database?: () => Promise<InventoryGovernanceDatabase | null>; permission?: typeof assertResourceAction; enabled?: () => boolean; now?: () => Date; journal?: typeof createInventoryGovernanceOperationJournal; lifecycleSchema?: typeof inventoryLifecycleSchemaReady; lifecycleLoad?: typeof loadInventoryLifecycleState; lifecycleRestore?: typeof restoreInventoryLifecycleState } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction, enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES === "true"), now = dependencies.now ?? (() => new Date()), journal = dependencies.journal ?? createInventoryGovernanceOperationJournal, lifecycleLoad = dependencies.lifecycleLoad ?? loadInventoryLifecycleState, lifecycleRestore = dependencies.lifecycleRestore ?? restoreInventoryLifecycleState;
  const sourceClosures = new WeakMap<InventoryGovernanceReadResult, string>();
  async function authorize(current: Session, action: "read" | "update" | "cancel") { await permission({ actor: current.actor, resource: "ops_inventory_governance", action, workspaceId: current.identity.workspaceId, authorizationRead: { executor: current.tx, strict: true, lock: true } }); await directory(current, action === "update" ? "edit" : "read"); }
  async function session<T>(ctx: TrpcContext, input: InventoryGovernanceReadInput, body: (current: Session) => Promise<T>): Promise<T> {
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
  const unavailable = (reasonCode: string) => ({ status: "unavailable" as const, reasonCode }), available = () => ({ status: "available" as const, reasonCode: null });
  async function load(current: Session, input: InventoryGovernanceReadInput, ready: Awaited<ReturnType<typeof inventoryGovernanceSchemaReady>>) {
    let reason = !enabled() ? "not_enabled_before_release" : !ready.journal ? "journal_not_ready" : null;
    try { await authorize(current, "update"); } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") reason ??= "update_denied"; else throw error; }
    let owners: InventoryGovernanceReadResult["owners"] = null, lifecycle: InventoryGovernanceReadResult["lifecycle"] = null, sources: unknown = null, members: unknown = null, rules: unknown = null;
    if (input.subject.kind === "owners") { const state = await ownerState(current, ready); owners = { candidates: state.candidates, rules: state.rules, members: state.member.members }; sources = state.source; members = state.member.raw; rules = state.rules; if (!ready.write) reason ??= "schema_not_ready"; }
    else { if (!await (dependencies.lifecycleSchema ?? inventoryLifecycleSchemaReady)(current.tx)) fail("LIFECYCLE_SCHEMA_NOT_READY"); const state = await lifecycleLoad(current.tx, current.identity.workspaceId, input.subject.scope); lifecycle = { row: state.row ? InventoryGovernanceLifecycleRowSchema.parse(state.row) : null, rows: state.rows.map(row => InventoryGovernanceLifecycleRowSchema.parse(row)) }; sources = state; }
    const snapshotKey = inventoryGovernanceSnapshotKey({ identity: current.identity, subject: input.subject, sources, rules, members, lifecycle });
    const result = InventoryGovernanceReadResultSchema.parse({ identity: current.identity, subject: input.subject, status: "ready", reasonCode: null, snapshotKey, owners, lifecycle, capabilities: { assign: owners ? reason ? unavailable(reason) : !owners.candidates.length || !owners.members.length ? unavailable("no_eligible_targets_or_members") : available() : unavailable("owner_subject_required"), revoke: owners ? reason ? unavailable(reason) : available() : unavailable("owner_subject_required"), restore: lifecycle ? reason ? unavailable(reason) : lifecycle.row?.status !== "discontinued" ? unavailable("not_discontinued") : available() : unavailable("lifecycle_subject_required") } });
    if (input.subject.kind === "owners") sourceClosures.set(result, inventoryGovernanceCanonical({ sources, members }));
    return result;
  }
  function failure(current: Session, input: InventoryGovernanceReadInput, error: unknown) { const conflict = error instanceof TRPCError && error.code === "CONFLICT" || error instanceof InventoryLifecycleGovernanceError && /CONFLICT|DUPLICATE|MISMATCH/u.test(error.code), reasonCode = error instanceof TRPCError && /^(INVENTORY_GOVERNANCE_|INVENTORY_LIFECYCLE_)/u.test(error.message) ? error.message : error instanceof InventoryLifecycleGovernanceError ? error.message : "source_or_saved_unavailable"; return InventoryGovernanceReadResultSchema.parse({ identity: current.identity, subject: input.subject, status: conflict ? "conflict" : "unavailable", reasonCode, snapshotKey: null, owners: null, lifecycle: null, capabilities: { assign: unavailable(reasonCode), revoke: unavailable(reasonCode), restore: unavailable(reasonCode) } }); }
  function operation(current: Session, input: InventoryGovernanceExecuteInput | InventoryGovernanceRecoverInput) { return journal(current.tx, { ...current.identity, subject: input.subject, operationId: input.operationId, actorRole: current.actor.role }); }
  function unknown(identity: InventoryGovernanceIdentity, input: InventoryGovernanceExecuteInput | InventoryGovernanceRecoverInput) { return InventoryGovernanceWriteResultSchema.parse({ identity, subject: input.subject, operationId: input.operationId, action: "action" in input ? input.action : null, status: "unknown", snapshotKey: null, recordIds: [], counts: null, reasonCode: "outcome_unknown_check_same_operation" }); }
  async function audit(current: Session, ruleId: number, action: "created" | "replaced" | "revoked", previous: InventoryGovernanceRule | null, next: { userId: number; displayName: string } | null, reason: string | null, seconds: number) {
    const values = [current.identity.workspaceId, ruleId, action, previous?.assigneeUserId ?? null, previous?.assigneeName ?? null, next?.userId ?? null, next?.displayName ?? null, reason, current.identity.userId];
    const auditId = await mutate(current.tx, `INSERT INTO ${AUDITS} (workspaceId,assignment_id,action,previous_assignee_user_id,previous_assignee_name,next_assignee_user_id,next_assignee_name,reason,changed_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,FROM_UNIXTIME(?))`, [...values, seconds]);
    if (!auditId) fail("AUDIT_UNVERIFIABLE");
    const readback = await rows(current.tx, `SELECT id,workspaceId,assignment_id AS assignmentId,action,previous_assignee_user_id AS previousAssigneeUserId,previous_assignee_name AS previousAssigneeName,next_assignee_user_id AS nextAssigneeUserId,next_assignee_name AS nextAssigneeName,reason,changed_by_user_id AS changedByUserId FROM ${AUDITS} WHERE id=? AND workspaceId=? LIMIT 2 FOR SHARE`, [auditId, current.identity.workspaceId]);
    if (readback.length !== 1 || inventoryGovernanceCanonical(readback[0]) !== inventoryGovernanceCanonical({ id: auditId, workspaceId: values[0], assignmentId: values[1], action: values[2], previousAssigneeUserId: values[3], previousAssigneeName: values[4], nextAssigneeUserId: values[5], nextAssigneeName: values[6], reason: values[7], changedByUserId: values[8] })) fail("AUDIT_UNVERIFIABLE");
  }
  async function read(ctx: TrpcContext, raw: InventoryGovernanceReadInput) { const input = InventoryGovernanceReadInputSchema.parse(raw); try { return await session(ctx, input, async current => { try { return await load(current, input, await inventoryGovernanceSchemaReady(current.tx)); } catch (error) { if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) throw error; return failure(current, input, error); } }); } catch (error) { return safeError(error); } }
  async function execute(ctx: TrpcContext, raw: InventoryGovernanceExecuteInput): Promise<InventoryGovernanceWriteResult> {
    const input = InventoryGovernanceExecuteInputSchema.parse(raw); let captured: InventoryGovernanceIdentity | null = null;
    try { return await session(ctx, input, async current => {
      captured = current.identity; const ready = await inventoryGovernanceSchemaReady(current.tx); if (!ready.journal) fail("JOURNAL_NOT_READY"); await authorize(current, "update");
      const log = operation(current, input), previous = await log.read(), requestHash = inventoryGovernanceOperationRequestHash(input);
      if (previous.final) { if (previous.final.requestHash !== null && previous.final.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT"); return previous.final.receipt; }
      if (!enabled()) fail("NOT_ENABLED"); const before = await load(current, input, ready); if (before.capabilities[input.action].status !== "available") fail("WRITE_UNAVAILABLE"); if (before.snapshotKey !== input.expectedSnapshotKey) fail("SNAPSHOT_CONFLICT", "CONFLICT");
      const clock = now(); if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) fail("CLOCK_INVALID"); const seconds = clock.getTime() / 1000;
      const counts = { created: 0, replaced: 0, reactivated: 0, unchanged: 0, revoked: 0, restored: 0 }, recordIds: number[] = [];
      if (input.action === "assign") {
        const owners = before.owners!, assignee = owners.members.find(member => member.userId === input.assigneeUserId); if (!assignee) fail("ASSIGNEE_NOT_ELIGIBLE", "BAD_REQUEST");
        const targets = new Set(owners.candidates.map(candidate => inventoryGovernanceScopeKey(candidate.scope))); if (input.targets.some(target => !targets.has(inventoryGovernanceScopeKey(target)))) fail("TARGET_NOT_VERIFIED", "BAD_REQUEST");
        for (const target of input.targets) {
          const rule = owners.rules.find(row => inventoryGovernanceScopeKey(row) === inventoryGovernanceScopeKey(target));
          if (rule) {
            recordIds.push(rule.id); if (rule.isActive === 1 && rule.assigneeUserId === assignee.userId && rule.assigneeName === assignee.displayName) { counts.unchanged++; continue; }
            await mutate(current.tx, `UPDATE ${RULES} SET assignee_user_id=?,assignee_name=?,is_active=1,updated_by_user_id=?,updated_at=FROM_UNIXTIME(?) WHERE id=? AND workspaceId=?`, [assignee.userId, assignee.displayName, current.identity.userId, seconds, rule.id, current.identity.workspaceId]);
            await audit(current, rule.id, "replaced", rule, assignee, input.reason, seconds); counts.replaced++; if (rule.isActive === 0) counts.reactivated++;
          } else {
            const createdId = await mutate(current.tx, `INSERT INTO ${RULES} (workspaceId,parent_asin,store_name,country,assignee_user_id,assignee_name,is_active,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,FROM_UNIXTIME(?),FROM_UNIXTIME(?))`, [current.identity.workspaceId, target.parentAsin, target.storeName, target.country, assignee.userId, assignee.displayName, current.identity.userId, current.identity.userId, seconds, seconds]);
            if (!createdId) fail("WRITE_UNVERIFIABLE"); recordIds.push(createdId); await audit(current, createdId, "created", null, assignee, input.reason, seconds); counts.created++;
          }
        }
      } else if (input.action === "revoke") {
        const rule = before.owners!.rules.find(row => row.id === input.ruleId); if (!rule || rule.isActive !== 1) fail("RULE_NOT_ACTIVE", "CONFLICT");
        await mutate(current.tx, `UPDATE ${RULES} SET is_active=0,updated_by_user_id=?,updated_at=FROM_UNIXTIME(?) WHERE id=? AND workspaceId=?`, [current.identity.userId, seconds, rule.id, current.identity.workspaceId]);
        await audit(current, rule.id, "revoked", rule, null, input.reason, seconds); recordIds.push(rule.id); counts.revoked = 1;
      } else {
        const restored = await lifecycleRestore(current.tx, { workspaceId: current.identity.workspaceId, actorUserId: current.identity.userId, scope: input.subject.scope, reason: input.reason, now: clock });
        if (!restored.row || restored.row.status !== "active" || restored.row.id !== before.lifecycle!.row?.id || restored.row.restoreReason !== input.reason || restored.row.restoredAt === null) fail("WRITE_UNVERIFIABLE"); recordIds.push(restored.row.id); counts.restored = 1;
      }
      const after = await load(current, input, ready);
      if (input.subject.kind === "owners" && sourceClosures.get(before) !== sourceClosures.get(after)) fail("SOURCE_CHANGED", "CONFLICT");
      if (before.owners && after.owners) {
        if (after.owners.rules.length !== before.owners.rules.length + counts.created) fail("WRITE_UNVERIFIABLE");
        for (const old of before.owners.rules.filter(rule => !recordIds.includes(rule.id))) if (inventoryGovernanceCanonical(after.owners.rules.find(rule => rule.id === old.id) ?? null) !== inventoryGovernanceCanonical(old)) fail("WRITE_UNVERIFIABLE");
      }
      if (input.action === "assign") {
        const assignee = before.owners!.members.find(member => member.userId === input.assigneeUserId)!;
        for (let index = 0; index < input.targets.length; index++) {
          const row = after.owners!.rules.find(rule => rule.id === recordIds[index]), old = before.owners!.rules.find(rule => rule.id === recordIds[index]);
          const changed = !old || old.isActive === 0 || old.assigneeUserId !== assignee.userId || old.assigneeName !== assignee.displayName;
          if (!row || row.isActive !== 1 || row.assigneeUserId !== input.assigneeUserId || row.assigneeName !== assignee.displayName || inventoryGovernanceScopeKey(row) !== inventoryGovernanceScopeKey(input.targets[index]) || row.workspaceId !== current.identity.workspaceId || old && (row.createdAt !== old.createdAt || row.createdByUserId !== old.createdByUserId) || !old && row.createdByUserId !== current.identity.userId || changed && row.updatedByUserId !== current.identity.userId || !changed && inventoryGovernanceCanonical(row) !== inventoryGovernanceCanonical(old)) fail("WRITE_UNVERIFIABLE");
        }
      } else if (input.action === "revoke") {
        const row = after.owners!.rules.find(rule => rule.id === input.ruleId), old = before.owners!.rules.find(rule => rule.id === input.ruleId)!;
        if (!row || inventoryGovernanceCanonical({ ...row, updatedAt: old.updatedAt }) !== inventoryGovernanceCanonical({ ...old, isActive: 0, updatedByUserId: current.identity.userId })) fail("WRITE_UNVERIFIABLE");
      }
      return log.finalize(InventoryGovernanceWriteResultSchema.parse({ identity: current.identity, subject: input.subject, operationId: input.operationId, action: input.action, status: "committed", snapshotKey: after.snapshotKey, recordIds, counts, reasonCode: null }), requestHash);
    }); } catch (error) { if (captured && !(error instanceof TRPCError) && !(error instanceof InventoryGovernanceJournalError) && !(error instanceof InventoryLifecycleGovernanceError) && !(error instanceof z.ZodError)) return unknown(captured, input); return safeError(error); }
  }
  async function recover(ctx: TrpcContext, raw: InventoryGovernanceRecoverInput): Promise<InventoryGovernanceWriteResult> {
    const input = InventoryGovernanceRecoverInputSchema.parse(raw); let captured: InventoryGovernanceIdentity | null = null;
    try { return await session(ctx, input, async current => { captured = current.identity; const ready = await inventoryGovernanceSchemaReady(current.tx); if (!ready.journal) fail("JOURNAL_NOT_READY"); if (input.decision === "cancel") await authorize(current, "cancel"); const log = operation(current, input), state = await log.read(); if (state.final) return state.final.receipt; return input.decision === "cancel" ? log.cancel() : unknown(current.identity, input); }); } catch (error) { if (captured && !(error instanceof TRPCError) && !(error instanceof InventoryGovernanceJournalError) && !(error instanceof z.ZodError)) return unknown(captured, input); return safeError(error); }
  }
  return { read, execute, recover };
}
export const inventoryGovernanceWriteRepository = createInventoryGovernanceWriteRepository();
