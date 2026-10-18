import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { InventorySnapshotRefreshOptionsInputSchema, InventorySnapshotRefreshStartInputSchema, InventorySnapshotRefreshReadRunInputSchema, InventorySnapshotRefreshRecoverInputSchema, InventorySnapshotRefreshOptionsResultSchema, InventorySnapshotRefreshResultSchema, InventoryCollectionProgressSchema, inventoryRefreshHash, inventorySnapshotKey, inventoryCollectionInitialProgress,
  type InventorySnapshotRefreshOptionsInput, type InventorySnapshotRefreshStartInput, type InventorySnapshotRefreshReadRunInput, type InventorySnapshotRefreshRecoverInput, type InventorySnapshotRefreshResult, type InventoryCollectionProgress } from "../../../shared/inventorySnapshotRefresh";
import { INVENTORY_READ_LIMITS, parseInventorySnapshot, type InventorySnapshotRecord, type InventoryScopeBinding, type InventoryMappingOptions } from "../../../shared/inventorySnapshotRead";
import { validateInventorySnapshotCollection, buildCollectedInventorySnapshot, inventoryCollectionHash, type InventorySnapshotCollection, type InventoryCollectionContext } from "../../../shared/inventorySnapshotCollection";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import type { TrpcContext } from "../../_core/context";
import { assertResourceAction } from "../../services/securityGovernance";

type Row = Record<string, unknown>;
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; actor: { id: number; role: string; defaultWorkspaceId: number } };
export interface InventoryCollectionDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
export type InventoryCollectionConfig = { connectionVersion: string; mappingVersion: string; scopeBindings?: InventoryScopeBinding[]; mappingOptions?: InventoryMappingOptions };
export type InventoryCollectionClaim = { jobId: number; identity: Identity; operationId: string; leaseToken: string; leaseExpiresAt: number; context: InventoryCollectionContext };
type Job = { id: number; workspaceId: number; actorUserId: number; operationId: string; requestHash: string | null; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; expectedSnapshotKey: string | null; connectionVersion: string | null; mappingVersion: string | null; leaseToken: string | null; leaseExpiresAt: number | null; heartbeatAt: number | null; progress: InventoryCollectionProgress; failureCode: string | null; resultSnapshotId: number | null; resultSnapshotKey: string | null; proofBytes: number | null; createdAt: number; updatedAt: number };
const JOBS = "ops_inventory_collection_jobs", SNAPSHOTS = "ops_inventory_snapshots";
const LEASE_MS = 120_000, PROOF_WIRE_MAX = 64 * 1024 * 1024;
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const manager = (role: unknown): role is string => ["super_admin", "admin", "ops_manager"].includes(String(role));
function fail(reason: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT" | "BAD_REQUEST" = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message: `INVENTORY_COLLECTION_${reason}` }); }
function statement(text: string, values: unknown[]): SQL { const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID"); return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); }
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> { const result = await tx.execute(statement(text, values)); if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("SOURCE_INVALID"); return result[0]; }
async function mutate(tx: DbExecutor, text: string, values: unknown[]): Promise<number | null> { const raw = await tx.execute(statement(text, values)), result = Array.isArray(raw) ? raw[0] : null; if (!result || result.affectedRows !== 1) fail("WRITE_UNVERIFIABLE"); return id(result.insertId) ? result.insertId : null; }
function integer(value: unknown): number { const parsed = typeof value === "string" && /^(?:0|[1-9]\d{0,14})$/u.test(value) ? Number(value) : value; if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 253_402_300_799_999) fail("SOURCE_INVALID"); return parsed; }
function boundedJson(value: unknown, bytes: unknown, max: number): unknown { if (typeof value !== "string" || !Number.isSafeInteger(bytes) || Number(bytes) > max || Number(bytes) < 0 || Buffer.byteLength(value) !== bytes) fail("SOURCE_INVALID"); try { return JSON.parse(value); } catch { return fail("SOURCE_INVALID"); } }
function sanitized(error: unknown): never { if (error instanceof TRPCError && /^INVENTORY_COLLECTION_[A-Z_]+$/u.test(error.message)) throw error; if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN"); return fail("UNAVAILABLE"); }
function missingTable(error: unknown): boolean { let item = error; for (let i = 0; i < 5 && item && typeof item === "object"; i++) { const value = item as Row; if (value.code === "ER_NO_SUCH_TABLE" || value.errno === 1146) return true; item = value.cause; } return false; }
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
/** Read-only schema admission; no initializer, scheduler, or DDL. */
export async function inventoryCollectionSchemaReady(tx: DbExecutor): Promise<boolean> {
  const tables = [JOBS, SNAPSHOTS, "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  if (engines.length !== tables.length || new Set(engines.map(row => row.tableName)).size !== engines.length || tables.some(table => !engines.some(row => row.tableName === table && row.engine === "InnoDB"))) return false;
  if ([JOBS, SNAPSHOTS].some(table => !engines.some(row => row.tableName === table && row.collation === "utf8mb4_unicode_ci"))) return false;
  const cols = await rows(tx, "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_inventory_collection_jobs','ops_inventory_snapshots')", []);
  if (cols.length > 100 || new Set(cols.map(row => `${row.tableName}:${row.columnName}`)).size !== cols.length || cols.some(row => ![JOBS, SNAPSHOTS].includes(String(row.tableName)) || typeof row.columnName !== "string" || typeof row.extra !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || !(row.defaultValue === null || typeof row.defaultValue === "string" || typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue)))) return false;
  const field = (table: string, column: string, type: string, nullable = false, length?: number) => { const row = cols.find(row => row.tableName === table && row.columnName === column); return !!row && row.dataType === type && row.isNullable === (nullable ? "YES" : "NO") && row.extra === (column === "id" ? "auto_increment" : "") && row.defaultValue === (column === "run_source" ? "saihu_sync" : null) && (length === undefined || row.maxLength === length) && (!["int", "bigint"].includes(type) || new RegExp(`^${type}(?:\\(\\d+\\))?$`, "u").test(String(row.columnType))) && (!["char", "varchar", "longtext", "enum"].includes(type) || row.collation === "utf8mb4_unicode_ci"); };
  const jobFields = ["id", "workspace_id", "actor_user_id", "operation_id", "request_hash", "status", "expected_snapshot_key", "connection_version", "mapping_version", "lease_token", "lease_expires_at", "heartbeat_at", "progress", "failure_code", "result_snapshot_id", "result_snapshot_key", "collection_proof", "created_at", "updated_at"];
  const snapshotFields = ["id", "workspace_id", "run_id", "run_source", "captured_at", "payload"];
  if (cols.some(row => !(row.tableName === JOBS ? jobFields : snapshotFields).includes(String(row.columnName)) && row.isNullable === "NO" && row.defaultValue === null && !/generated|auto_increment/iu.test(String(row.extra)))) return false;
  const scalar = ["id", "workspace_id", "actor_user_id"].every(column => field(JOBS, column, "int")) && field(JOBS, "operation_id", "char", false, 36) && field(JOBS, "status", "enum") && cols.find(row => row.tableName === JOBS && row.columnName === "status")?.columnType === "enum('queued','running','succeeded','failed','cancelled')"
    && ["request_hash", "expected_snapshot_key", "connection_version", "mapping_version", "lease_token", "result_snapshot_key"].every(column => field(JOBS, column, "char", true, 64)) && ["lease_expires_at", "heartbeat_at"].every(column => field(JOBS, column, "bigint", true)) && ["created_at", "updated_at"].every(column => field(JOBS, column, "bigint")) && field(JOBS, "failure_code", "varchar", true, 100) && field(JOBS, "result_snapshot_id", "int", true) && field(JOBS, "progress", "json") && field(JOBS, "collection_proof", "json", true)
    && ["id", "workspace_id", "run_id"].every(column => field(SNAPSHOTS, column, "int")) && field(SNAPSHOTS, "captured_at", "bigint") && field(SNAPSHOTS, "payload", "longtext") && field(SNAPSHOTS, "run_source", "enum") && cols.find(row => row.tableName === SNAPSHOTS && row.columnName === "run_source")?.columnType === "enum('saihu_sync','manual_collection')";
  if (!scalar) return false;
  const indexes = await rows(tx, "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_inventory_collection_jobs','ops_inventory_snapshots') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX", []);
  if (indexes.length > 100 || indexes.some(row => ![JOBS, SNAPSHOTS].includes(String(row.tableName)) || typeof row.indexName !== "string" || !id(row.sequence) || ![0, 1].includes(Number(row.nonUnique)))) return false;
  const groups = [...new Set(indexes.map(row => `${row.tableName}:${row.indexName}`))].map(key => indexes.filter(row => `${row.tableName}:${row.indexName}` === key).sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  const match = (group: Row[], table: string, fields: string[], unique: boolean, primary = false) => group.length === fields.length && group.every((row, i) => row.tableName === table && row.columnName === fields[i] && row.sequence === i + 1 && row.nonUnique === (unique ? 0 : 1) && row.prefixLength === null && (!primary || row.indexName === "PRIMARY"));
  const required: [string, string[], boolean, boolean?][] = [[JOBS, ["id"], true, true], [JOBS, ["workspace_id", "operation_id"], true], [JOBS, ["status", "id"], false], [JOBS, ["workspace_id", "status", "id"], false], [JOBS, ["workspace_id", "actor_user_id", "id"], false], [SNAPSHOTS, ["id"], true, true], [SNAPSHOTS, ["run_source", "run_id"], true], [SNAPSHOTS, ["workspace_id", "id"], false]];
  return required.every(([table, fields, unique, primary]) => groups.some(group => match(group, table, fields, unique, primary))) && groups.filter(group => group[0].nonUnique === 0).every(group => required.some(([table, fields, unique, primary]) => unique && match(group, table, fields, unique, primary)));
}
const jobProjection = `id,workspace_id AS workspaceId,actor_user_id AS actorUserId,operation_id AS operationId,request_hash AS requestHash,status,expected_snapshot_key AS expectedSnapshotKey,connection_version AS connectionVersion,mapping_version AS mappingVersion,lease_token AS leaseToken,lease_expires_at AS leaseExpiresAt,heartbeat_at AS heartbeatAt,IF(OCTET_LENGTH(CAST(progress AS CHAR CHARACTER SET utf8mb4))<=4096,CAST(progress AS CHAR CHARACTER SET utf8mb4),NULL) AS progress,OCTET_LENGTH(CAST(progress AS CHAR CHARACTER SET utf8mb4)) AS progressBytes,failure_code AS failureCode,result_snapshot_id AS resultSnapshotId,result_snapshot_key AS resultSnapshotKey,OCTET_LENGTH(CAST(collection_proof AS CHAR CHARACTER SET utf8mb4)) AS proofBytes,created_at AS createdAt,updated_at AS updatedAt`;
function parseJob(row: Row): Job {
  if (!id(row.id) || !id(row.workspaceId) || !id(row.actorUserId) || !z.string().uuid().safeParse(row.operationId).success || typeof row.operationId !== "string" || row.operationId !== row.operationId.toLowerCase() || !["queued", "running", "succeeded", "failed", "cancelled"].includes(String(row.status))) fail("JOB_INVALID");
  for (const key of ["requestHash", "expectedSnapshotKey", "connectionVersion", "mappingVersion", "leaseToken", "resultSnapshotKey"]) if (row[key] !== null && !hash(row[key])) fail("JOB_INVALID");
  if (row.resultSnapshotId !== null && !id(row.resultSnapshotId) || row.failureCode !== null && (typeof row.failureCode !== "string" || !/^[a-z0-9_]{1,100}$/u.test(row.failureCode))) fail("JOB_INVALID");
  const progress = InventoryCollectionProgressSchema.parse(boundedJson(row.progress, row.progressBytes, 4096));
  const job = { ...row, progress, createdAt: integer(row.createdAt), updatedAt: integer(row.updatedAt), leaseExpiresAt: row.leaseExpiresAt === null ? null : integer(row.leaseExpiresAt), heartbeatAt: row.heartbeatAt === null ? null : integer(row.heartbeatAt), proofBytes: row.proofBytes === null ? null : integer(row.proofBytes) } as Job;
  if (job.createdAt > job.updatedAt || job.proofBytes !== null && job.proofBytes > PROOF_WIRE_MAX || job.requestHash === null && (job.status !== "cancelled" || [job.expectedSnapshotKey, job.connectionVersion, job.mappingVersion].some(value => value !== null))) fail("JOB_INVALID");
  if (job.requestHash !== null && (![job.expectedSnapshotKey, job.connectionVersion, job.mappingVersion].every(hash) || inventoryRefreshHash({ expectedWorkspaceId: job.workspaceId, operationId: job.operationId, expectedSnapshotKey: job.expectedSnapshotKey, expectedConnectionVersion: job.connectionVersion, expectedMappingVersion: job.mappingVersion }) !== job.requestHash)) fail("JOB_INVALID");
  if (job.status === "running" ? !job.leaseToken || job.leaseExpiresAt === null || job.heartbeatAt === null : job.leaseToken !== null || job.leaseExpiresAt !== null) fail("JOB_INVALID");
  if (job.status === "succeeded" ? !job.resultSnapshotId || !job.resultSnapshotKey || job.proofBytes === null || job.failureCode !== null || progress.completedSources !== 10 : job.resultSnapshotId !== null || job.resultSnapshotKey !== null || job.proofBytes !== null) fail("JOB_INVALID");
  if (["failed", "cancelled"].includes(job.status) ? job.failureCode === null : job.failureCode !== null) fail("JOB_INVALID");
  return job;
}
function receipt(identity: Identity, operationId: string, job: Job | null): InventorySnapshotRefreshResult {
  return InventorySnapshotRefreshResultSchema.parse({ identity, operationId, outcome: !job ? "unknown" : job.status === "succeeded" ? "committed" : job.status === "cancelled" ? "cancelled" : job.status === "failed" ? "failed" : "accepted", jobId: job?.id ?? null, state: job?.status ?? null, snapshotId: job?.resultSnapshotId ?? null, snapshotKey: job?.resultSnapshotKey ?? null, progress: job?.progress ?? inventoryCollectionInitialProgress(), reasonCode: job ? job.failureCode : "outcome_unknown" });
}
async function getJob(tx: DbExecutor, workspaceId: number, operationId: string): Promise<Job | null> { const found = await rows(tx, `SELECT ${jobProjection} FROM ${JOBS} WHERE workspace_id=? AND operation_id=? LIMIT 2 FOR UPDATE`, [workspaceId, operationId]); if (found.length > 1) fail("JOB_INVALID"); const job = found.length ? parseJob(found[0]) : null; if (job && (job.workspaceId !== workspaceId || job.operationId !== operationId)) fail("JOB_INVALID"); return job; }
async function latest(tx: DbExecutor, workspaceId: number, namespaced = true): Promise<InventorySnapshotRecord | null> {
  const found = await rows(tx, `SELECT id,workspace_id AS workspaceId,run_id AS runId,${namespaced ? "run_source" : "'saihu_sync'"} AS runSource,captured_at AS capturedAt,IF(OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=${INVENTORY_READ_LIMITS.wireBytes},CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload,OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes FROM ${SNAPSHOTS} WHERE workspace_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`, [workspaceId]);
  if (!found.length) return null;
  const row = found[0]; if (found.length !== 1 || !id(row.id) || !id(row.runId) || row.workspaceId !== workspaceId || !["saihu_sync", "manual_collection"].includes(String(row.runSource))) fail("SNAPSHOT_INVALID");
  const payload = boundedJson(row.payload, row.payloadBytes, INVENTORY_READ_LIMITS.wireBytes), capturedAt = integer(row.capturedAt); if (parseInventorySnapshot(payload).capturedAt !== capturedAt) fail("SNAPSHOT_INVALID");
  return { id: row.id, workspaceId, runId: row.runId, runSource: row.runSource as InventorySnapshotRecord["runSource"], capturedAt, payload };
}

export function createInventoryCollectionRepository(dependencies: { database?: () => Promise<InventoryCollectionDatabase | null>; permission?: typeof assertResourceAction; config?: (tx: DbExecutor, workspaceId: number) => Promise<InventoryCollectionConfig | null>; enabled?: () => boolean; now?: () => number; token?: () => string } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction, enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_INVENTORY_COLLECTION === "true"), now = dependencies.now ?? Date.now, token = dependencies.token ?? (() => randomBytes(32).toString("hex"));
  const config = dependencies.config ?? (async (tx: DbExecutor, workspaceId: number) => { const adapter = await import("./inventoryCollectionConfig"); return adapter.inventoryCollectionConfig(tx, workspaceId); });
  async function db() { const value = await database(); if (!value || typeof value.transaction !== "function") fail("TRANSACTION_REQUIRED"); return value as Required<InventoryCollectionDatabase>; }
  async function authorize(current: Session, action: "read" | "create" | "cancel") { await permission({ actor: current.actor, resource: "ops_inventory_collection", action, workspaceId: current.identity.workspaceId, authorizationRead: { executor: current.tx, strict: true, lock: true } }); await directory(current, action === "create" ? "edit" : "read"); }
  async function actor(tx: DbExecutor, identity: Identity, expectedRole?: string): Promise<Session> {
    const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [identity.userId]), value = actors[0];
    if (actors.length !== 1 || value.id !== identity.userId || !manager(value.role) || expectedRole !== undefined && value.role !== expectedRole || value.status !== "active" || value.defaultWorkspaceId !== identity.workspaceId) fail("ACTOR_CHANGED", "FORBIDDEN");
    const memberships = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId]);
    if (memberships.length !== 1 || !id(memberships[0].id) || memberships[0].workspaceId !== identity.workspaceId || memberships[0].userId !== identity.userId || memberships[0].status !== "active") fail("MEMBERSHIP_CHANGED", "FORBIDDEN");
    const current: Session = { tx, identity, actor: { id: identity.userId, role: value.role, defaultWorkspaceId: identity.workspaceId } };
    await permission({ actor: current.actor, resource: "ops_data", action: "read", workspaceId: identity.workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } }); await authorize(current, "read"); return current;
  }
  async function workspace(tx: DbExecutor, workspaceId: number) { const found = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [workspaceId]); if (found.length !== 1 || found[0].id !== workspaceId || found[0].status !== "active") fail("WORKSPACE_CHANGED", "FORBIDDEN"); }
  async function session<T>(ctx: TrpcContext, expectedWorkspaceId: number, body: (current: Session) => Promise<T>) {
    if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED"); const workspaceId = ctx.workspaceId ?? ctx.user.defaultWorkspaceId;
    if (!id(ctx.user.id) || !id(workspaceId) || workspaceId !== expectedWorkspaceId || !manager(ctx.user.role)) fail("ACTOR_INVALID", "FORBIDDEN");
    return (await db()).transaction(async tx => { await workspace(tx, workspaceId); return body(await actor(tx, { userId: ctx.user!.id, workspaceId }, ctx.user!.role)); });
  }
  async function configuration(current: Session, job?: Job) { const result = await config(current.tx, current.identity.workspaceId); if (!result || !hash(result.connectionVersion) || !hash(result.mappingVersion)) fail("CONFIG_UNVERIFIABLE"); if (job && (result.connectionVersion !== job.connectionVersion || result.mappingVersion !== job.mappingVersion)) fail("CONFIG_CHANGED", "CONFLICT"); return result; }
  async function requireSchema(tx: DbExecutor) { if (!await inventoryCollectionSchemaReady(tx)) fail("SCHEMA_NOT_READY"); }
  function own(current: Session, job: Job | null) { if (job && job.actorUserId !== current.identity.userId) fail("OPERATION_ACTOR_MISMATCH", "FORBIDDEN"); }
  async function options(ctx: TrpcContext, raw: InventorySnapshotRefreshOptionsInput) {
    const input = InventorySnapshotRefreshOptionsInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      const ready = await inventoryCollectionSchemaReady(current.tx); let reason: string | null = !enabled() ? "not_enabled" : ready ? null : "schema_not_ready";
      let versions: InventoryCollectionConfig | null = null; try { versions = await configuration(current); } catch { reason ??= "config_unavailable"; }
      try { await authorize(current, "create"); } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") reason ??= "create_denied"; else throw error; }
      let snapshot: { status: "ready" | "not_found" | "missing" | "invalid"; id: number | null; key: string | null; runSource: "saihu_sync" | "manual_collection" | null };
      try { const names = await rows(current.tx, "SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_inventory_snapshots' AND COLUMN_NAME='run_source'", []); if (names.length > 1 || names.some(row => row.columnName !== "run_source")) fail("SCHEMA_INVALID"); const saved = await latest(current.tx, current.identity.workspaceId, names.length === 1); snapshot = { status: saved ? "ready" : "not_found", id: saved?.id ?? null, key: inventorySnapshotKey(current.identity.workspaceId, saved), runSource: saved?.runSource ?? null }; }
      catch (error) { snapshot = { status: missingTable(error) ? "missing" : "invalid", id: null, key: null, runSource: null }; reason ??= "snapshot_unavailable"; }
      return InventorySnapshotRefreshOptionsResultSchema.parse({ identity: current.identity, capabilities: { refresh: { status: reason ? "unavailable" : "available", reasonCode: reason } }, snapshot, connectionVersion: versions?.connectionVersion ?? null, mappingVersion: versions?.mappingVersion ?? null });
    }); } catch (error) { return sanitized(error); }
  }
  async function refresh(ctx: TrpcContext, raw: InventorySnapshotRefreshStartInput): Promise<InventorySnapshotRefreshResult> {
    const input = InventorySnapshotRefreshStartInputSchema.parse(raw); let captured: Identity | null = null;
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      captured = current.identity; await requireSchema(current.tx); const existing = await getJob(current.tx, current.identity.workspaceId, input.operationId); own(current, existing);
      const requestHash = inventoryRefreshHash(input); if (existing) { if (existing.requestHash !== null && existing.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT"); return receipt(current.identity, input.operationId, existing); }
      if (!enabled()) fail("NOT_ENABLED"); await authorize(current, "create"); const versions = await configuration(current);
      if (versions.connectionVersion !== input.expectedConnectionVersion || versions.mappingVersion !== input.expectedMappingVersion || inventorySnapshotKey(current.identity.workspaceId, await latest(current.tx, current.identity.workspaceId)) !== input.expectedSnapshotKey) fail("SOURCE_CHANGED", "CONFLICT");
      const pending = await rows(current.tx, `SELECT id FROM ${JOBS} WHERE workspace_id=? AND status IN ('queued','running') ORDER BY id LIMIT 2 FOR UPDATE`, [current.identity.workspaceId]); if (pending.length) fail("WORKSPACE_BUSY", "CONFLICT");
      const time = now(); integer(time);
      await mutate(current.tx, `INSERT INTO ${JOBS} (workspace_id,actor_user_id,operation_id,request_hash,status,expected_snapshot_key,connection_version,mapping_version,lease_token,lease_expires_at,heartbeat_at,progress,failure_code,result_snapshot_id,result_snapshot_key,collection_proof,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,?,?)`, [current.identity.workspaceId, current.identity.userId, input.operationId, requestHash, input.expectedSnapshotKey, input.expectedConnectionVersion, input.expectedMappingVersion, JSON.stringify(inventoryCollectionInitialProgress()), time, time]);
      const saved = await getJob(current.tx, current.identity.workspaceId, input.operationId); if (!saved || saved.requestHash !== requestHash || saved.status !== "queued") fail("WRITE_UNVERIFIABLE"); return receipt(current.identity, input.operationId, saved);
    }); } catch (error) { if (error instanceof TRPCError) return sanitized(error); if (captured) return receipt(captured, input.operationId, null); return sanitized(error); }
  }
  async function recover(ctx: TrpcContext, raw: InventorySnapshotRefreshRecoverInput): Promise<InventorySnapshotRefreshResult> {
    const input = InventorySnapshotRefreshRecoverInputSchema.parse(raw); let captured: Identity | null = null;
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      captured = current.identity; await requireSchema(current.tx); let saved = await getJob(current.tx, current.identity.workspaceId, input.operationId); own(current, saved);
      if (input.decision === "check" || saved && ["succeeded", "failed", "cancelled"].includes(saved.status)) return receipt(current.identity, input.operationId, saved);
      // Cancellation is a current-authorized recovery fence, never a new data write.
      // It stays available after deployment rollback or create permission removal.
      await authorize(current, "cancel"); const time = now(); integer(time);
      if (saved) await mutate(current.tx, `UPDATE ${JOBS} SET status='cancelled',failure_code='cancelled_by_actor',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE workspace_id=? AND id=? AND status IN ('queued','running')`, [time, current.identity.workspaceId, saved.id]);
      else await mutate(current.tx, `INSERT INTO ${JOBS} (workspace_id,actor_user_id,operation_id,request_hash,status,expected_snapshot_key,connection_version,mapping_version,lease_token,lease_expires_at,heartbeat_at,progress,failure_code,result_snapshot_id,result_snapshot_key,collection_proof,created_at,updated_at) VALUES (?,?,?,NULL,'cancelled',NULL,NULL,NULL,NULL,NULL,NULL,?,'cancelled_by_actor',NULL,NULL,NULL,?,?)`, [current.identity.workspaceId, current.identity.userId, input.operationId, JSON.stringify(inventoryCollectionInitialProgress()), time, time]);
      saved = await getJob(current.tx, current.identity.workspaceId, input.operationId); if (!saved || saved.status !== "cancelled") fail("WRITE_UNVERIFIABLE"); return receipt(current.identity, input.operationId, saved);
    }); } catch (error) { if (error instanceof TRPCError) return sanitized(error); if (captured) return receipt(captured, input.operationId, null); return sanitized(error); }
  }
  async function readRun(ctx: TrpcContext, raw: InventorySnapshotRefreshReadRunInput) { const input = InventorySnapshotRefreshReadRunInputSchema.parse(raw); return recover(ctx, { ...input, decision: "check" }); }
  async function hint(jobId?: number) { const value = await db(); return value.transaction(async tx => { const found = await rows(tx, `SELECT id,workspace_id AS workspaceId,actor_user_id AS actorUserId,operation_id AS operationId FROM ${JOBS} WHERE ${jobId === undefined ? "(status='queued' OR (status='running' AND lease_expires_at<=?)) ORDER BY id LIMIT 1" : "id=? LIMIT 1"}`, jobId === undefined ? [now()] : [jobId]); if (!found.length) return null; if (found.length !== 1 || !id(found[0].id) || !id(found[0].workspaceId) || !id(found[0].actorUserId) || !z.string().uuid().safeParse(found[0].operationId).success) fail("JOB_INVALID"); return found[0] as { id: number; workspaceId: number; actorUserId: number; operationId: string }; }); }
  async function worker<T>(jobId: number | undefined, body: (tx: DbExecutor, job: Job, current: Session | null) => Promise<T>): Promise<T | null> {
    const selected = await hint(jobId); if (!selected) return null;
    return (await db()).transaction(async tx => {
      // A disabled/deleted workspace may close its own obsolete job, but must
      // never publish or hold the global queue head ahead of other workspaces.
      const spaces = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [selected.workspaceId]);
      if (spaces.length > 1 || spaces.some(row => row.id !== selected.workspaceId || typeof row.status !== "string")) fail("WORKSPACE_INVALID");
      let current: Session | null = null;
      if (spaces.length === 1 && spaces[0].status === "active") try { current = await actor(tx, { userId: selected.actorUserId, workspaceId: selected.workspaceId }); } catch (error) { if (!(error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code))) throw error; }
      await requireSchema(tx); const job = await getJob(tx, selected.workspaceId, selected.operationId); if (!job || job.id !== selected.id || job.actorUserId !== selected.actorUserId) fail("JOB_INVALID"); return body(tx, job, current);
    });
  }
  async function terminal(tx: DbExecutor, job: Job, reasonCode: string) { await mutate(tx, `UPDATE ${JOBS} SET status='failed',failure_code=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE workspace_id=? AND id=? AND status IN ('queued','running')`, [reasonCode, now(), job.workspaceId, job.id]); const saved = await getJob(tx, job.workspaceId, job.operationId); if (!saved || saved.status !== "failed") fail("WRITE_UNVERIFIABLE"); return saved; }
  async function claimNext(): Promise<InventoryCollectionClaim | null> {
    if (!enabled()) return null;
    return worker(undefined, async (tx, job, current) => {
      if (!enabled()) return null; if (job.status === "running") { if (job.leaseExpiresAt! <= now()) await terminal(tx, job, "lease_expired"); return null; } if (job.status !== "queued") return null;
      if (!current) { await terminal(tx, job, "actor_authority_changed"); return null; }
      try { await authorize(current, "create"); await configuration(current, job); } catch { await terminal(tx, job, "configuration_or_authority_changed"); return null; }
      if (inventorySnapshotKey(job.workspaceId, await latest(tx, job.workspaceId)) !== job.expectedSnapshotKey) { await terminal(tx, job, "snapshot_changed"); return null; }
      const leaseToken = token(), time = now(); if (!hash(leaseToken)) fail("LEASE_INVALID"); const leaseExpiresAt = time + LEASE_MS;
      await mutate(tx, `UPDATE ${JOBS} SET status='running',lease_token=?,lease_expires_at=?,heartbeat_at=?,updated_at=? WHERE workspace_id=? AND id=? AND status='queued'`, [leaseToken, leaseExpiresAt, time, time, job.workspaceId, job.id]);
      const saved = await getJob(tx, job.workspaceId, job.operationId); if (!saved || saved.leaseToken !== leaseToken || saved.status !== "running") fail("WRITE_UNVERIFIABLE");
      return { jobId: job.id, identity: current.identity, operationId: job.operationId, leaseToken, leaseExpiresAt, context: { workspaceId: job.workspaceId, connectionVersion: job.connectionVersion!, mappingVersion: job.mappingVersion! } };
    });
  }
  const hasLease = (job: Job, leaseToken: string) => job.status === "running" && job.leaseToken === leaseToken && job.leaseExpiresAt !== null && job.leaseExpiresAt > now();
  async function heartbeat(input: { jobId: number; leaseToken: string; progress?: InventoryCollectionProgress }): Promise<boolean> {
    if (!id(input.jobId) || !hash(input.leaseToken)) fail("LEASE_INVALID");
    return await worker(input.jobId, async (tx, job, current) => {
      if (!enabled() || !current || !hasLease(job, input.leaseToken)) return false;
      try { await authorize(current, "create"); await configuration(current, job); } catch { return false; }
      const progress = input.progress ? InventoryCollectionProgressSchema.parse(input.progress) : job.progress; if (progress.completedSources < job.progress.completedSources) fail("PROGRESS_INVALID");
      const time = now(); await mutate(tx, `UPDATE ${JOBS} SET lease_expires_at=?,heartbeat_at=?,progress=?,updated_at=? WHERE workspace_id=? AND id=? AND status='running' AND lease_token=?`, [time + LEASE_MS, time, JSON.stringify(progress), time, job.workspaceId, job.id, input.leaseToken]); return true;
    }) ?? false;
  }
  async function complete(input: { jobId: number; leaseToken: string; sources: InventorySnapshotCollection["sources"]; proof: InventorySnapshotCollection["proof"] }): Promise<InventorySnapshotRefreshResult | null> {
    if (!id(input.jobId) || !hash(input.leaseToken)) fail("LEASE_INVALID");
    const collection = validateInventorySnapshotCollection({ sources: input.sources, proof: input.proof });
    return worker(input.jobId, async (tx, job, current) => {
      const identity = { userId: job.actorUserId, workspaceId: job.workspaceId };
      if (["succeeded", "failed", "cancelled"].includes(job.status)) return receipt(identity, job.operationId, job);
      if (!enabled()) fail("NOT_ENABLED"); if (!current) fail("ACTOR_CHANGED", "FORBIDDEN"); if (!hasLease(job, input.leaseToken)) fail("LEASE_INVALID", "CONFLICT"); await authorize(current, "create"); const configured = await configuration(current, job);
      if (inventoryRefreshHash(collection.proof.context) !== inventoryRefreshHash({ workspaceId: job.workspaceId, connectionVersion: job.connectionVersion, mappingVersion: job.mappingVersion })) fail("PROOF_CONTEXT_CHANGED", "CONFLICT");
      if (inventorySnapshotKey(job.workspaceId, await latest(tx, job.workspaceId)) !== job.expectedSnapshotKey) fail("SNAPSHOT_CHANGED", "CONFLICT");
      const built = buildCollectedInventorySnapshot({ collection, scopeBindings: configured.scopeBindings ?? [], options: configured.mappingOptions });
      const payload = JSON.stringify(built.snapshot); if (Buffer.byteLength(payload) > INVENTORY_READ_LIMITS.payloadBytes) fail("SNAPSHOT_BUDGET"); parseInventorySnapshot(built.snapshot);
      const snapshotId = await mutate(tx, `INSERT INTO ${SNAPSHOTS} (workspace_id,run_id,run_source,captured_at,payload) VALUES (?,?,'manual_collection',?,?)`, [job.workspaceId, job.id, built.snapshot.capturedAt, payload]); if (!snapshotId) fail("WRITE_UNVERIFIABLE");
      const saved = await latest(tx, job.workspaceId); if (!saved || saved.id !== snapshotId || saved.runId !== job.id || saved.runSource !== "manual_collection" || inventoryRefreshHash(saved.payload) !== inventoryRefreshHash(built.snapshot)) fail("WRITE_UNVERIFIABLE"); const key = inventorySnapshotKey(job.workspaceId, saved);
      await mutate(tx, `UPDATE ${JOBS} SET status='succeeded',lease_token=NULL,lease_expires_at=NULL,progress=?,result_snapshot_id=?,result_snapshot_key=?,collection_proof=?,updated_at=? WHERE workspace_id=? AND id=? AND status='running' AND lease_token=?`, [JSON.stringify({ source: "details", completedSources: 10, totalSources: 10 }), snapshotId, key, JSON.stringify(collection.proof), now(), job.workspaceId, job.id, input.leaseToken]);
      const result = await getJob(tx, job.workspaceId, job.operationId); if (!result || result.status !== "succeeded" || result.resultSnapshotId !== snapshotId || result.resultSnapshotKey !== key) fail("WRITE_UNVERIFIABLE");
      const proofRows = await rows(tx, `SELECT IF(OCTET_LENGTH(CAST(collection_proof AS CHAR CHARACTER SET utf8mb4))<=${PROOF_WIRE_MAX},CAST(collection_proof AS CHAR CHARACTER SET utf8mb4),NULL) AS proof,OCTET_LENGTH(CAST(collection_proof AS CHAR CHARACTER SET utf8mb4)) AS proofBytes FROM ${JOBS} WHERE workspace_id=? AND id=? LIMIT 1 FOR UPDATE`, [job.workspaceId, job.id]);
      if (proofRows.length !== 1 || inventoryCollectionHash(boundedJson(proofRows[0].proof, proofRows[0].proofBytes, PROOF_WIRE_MAX)) !== inventoryCollectionHash(collection.proof)) fail("WRITE_UNVERIFIABLE");
      return receipt(identity, job.operationId, result);
    });
  }
  async function failRun(input: { jobId: number; leaseToken: string; reasonCode: string }): Promise<InventorySnapshotRefreshResult | null> {
    if (!id(input.jobId) || !hash(input.leaseToken) || !/^[a-z0-9_]{1,100}$/u.test(input.reasonCode)) fail("LEASE_INVALID");
    return worker(input.jobId, async (tx, job) => { if (["succeeded", "failed", "cancelled"].includes(job.status)) return receipt({ userId: job.actorUserId, workspaceId: job.workspaceId }, job.operationId, job); if (job.status !== "running" || job.leaseToken !== input.leaseToken) fail("LEASE_INVALID", "CONFLICT"); const saved = await terminal(tx, job, input.reasonCode); return receipt({ userId: job.actorUserId, workspaceId: job.workspaceId }, job.operationId, saved); });
  }
  return { options, refresh, readRun, recover, claimNext, heartbeat, complete, fail: failRun };
}
export const inventoryCollectionRepository = createInventoryCollectionRepository();
