import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { parseMonthlyFinancialBatch, MonthlyFinancialReadError, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import {
  MonthlyFinancialWriteOptionsInputSchema, MonthlyFinancialWriteOptionsResultSchema, MonthlyFinancialWriteUploadInputSchema,
  MonthlyFinancialWriteInspectInputSchema, MonthlyFinancialWriteConfirmInputSchema, MonthlyFinancialWriteRevokeInputSchema,
  MonthlyFinancialWriteRecoverInputSchema, MonthlyFinancialWriteDownloadInputSchema, MonthlyFinancialWriteDownloadResultSchema,
  MonthlyFinancialWriteResultSchema, MONTHLY_FINANCIAL_WRITE_PUBLIC_LIMITS, MonthlyFinancialWriteError,
  monthlyFinancialBatchVersion, buildMonthlyFinancialWriteImpact, buildMonthlyFinancialWriteInspectResult,
  type MonthlyFinancialWriteOptionsInput, type MonthlyFinancialWriteUploadInput, type MonthlyFinancialWriteInspectInput,
  type MonthlyFinancialWriteConfirmInput, type MonthlyFinancialWriteRevokeInput, type MonthlyFinancialWriteRecoverInput,
  type MonthlyFinancialWriteDownloadInput, type MonthlyFinancialWriteResult, type MonthlyFinancialWriteOptionsResult,
} from "../../../shared/monthlyFinancialWrite";
import {
  parseMonthlyFinancialImport, MonthlyFinancialImportManifestSchema, MonthlyFinancialImportError,
  monthlyFinancialImportHash, MONTHLY_FINANCIAL_IMPORT_LIMITS, type MonthlyFinancialImport,
} from "../../../shared/monthlyFinancialImport";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { projection, positiveId as id, query as rows, noSuchTable, SCAN_BATCHES_MAX, SCAN_BYTES_MAX, PAYLOAD_WIRE_MAX, MONTHS_WIRE_MAX } from "./monthlyBoardReadCore";
import { monthlyFinancialImportStorage, MonthlyFinancialImportStorageError } from "./monthlyFinancialImportStorage";
import {
  createMonthlyFinancialOperationJournal, MonthlyFinancialPreparedUploadSchema, MonthlyFinancialJournalError,
  monthlyFinancialOperationRequestHash, type MonthlyFinancialPreparedUpload,
} from "./monthlyFinancialOperationJournal";

type Row = Record<string, unknown>;
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; actor: { id: number; role: string; defaultWorkspaceId: number }; role: string };
type Capability = { status: "available" | "unavailable"; reasonCode: string | null };
type Column = { nullable: boolean; dataType: string; columnType: string; extra: string; maxLength: number | null; defaultValue: unknown; collation: string | null };
export interface MonthlyFinancialWriteDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const managerRoles = ["super_admin", "admin", "ops_manager"];
const MANIFEST_WIRE_MAX = 64 * 1024 * 1024, PREPARED_WIRE_MAX = 32 * 1024;
const available = (): Capability => ({ status: "available", reasonCode: null });
const unavailable = (reasonCode: string): Capability => ({ status: "unavailable", reasonCode });
function fail(message: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT" | "BAD_REQUEST" | "NOT_FOUND" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `MONTHLY_FINANCIAL_WRITE_${message}` });
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function wire(value: unknown, bytes: unknown, limit: number): string {
  if (typeof value !== "string" || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit || Buffer.byteLength(value, "utf8") !== bytes) fail("SOURCE_INVALID");
  return value;
}
const permissionName = z.string().min(1).max(100).refine(value => value === value.trim());
const permissionOperations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(values => new Set(values).size === values.length);
const permissionDetails = z.array(z.object({ moduleId: permissionName, operations: permissionOperations, subModules: z.array(z.object({ subModuleId: permissionName, operations: permissionOperations }).strict()).max(100).refine(values => new Set(values.map(value => value.subModuleId)).size === values.length).optional() }).strict()).max(100).refine(values => new Set(values.map(value => value.moduleId)).size === values.length);
function permissionJson(value: unknown): unknown {
  try {
    if (Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8") > 65536) fail("DIRECTORY_INVALID", "FORBIDDEN");
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch { return fail("DIRECTORY_INVALID", "FORBIDDEN"); }
}
/** A financial policy allow does not bypass either real navigation directory. */
export async function strictMonthlyFinancialDirectory(tx: DbExecutor, role: string, workspaceId: number, operation: "read" | "edit" | "delete" = "read") {
  if (role === "super_admin") return;
  const found = await rows(tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [role, workspaceId]);
  if (found.length > 2 || new Set(found.map(row => row.workspaceId)).size !== found.length || found.some(row => !id(row.id) || row.role !== role || row.workspaceId !== null && row.workspaceId !== workspaceId)) fail("DIRECTORY_INVALID", "FORBIDDEN");
  const record = found.find(row => row.workspaceId === workspaceId) ?? found.find(row => row.workspaceId === null);
  if (!record) { if (!ROLE_MODULE_ACCESS[role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return; }
  const modules = z.array(permissionName).max(100).refine(values => new Set(values).size === values.length).safeParse(permissionJson(record.modules));
  const details = record.detailedPermissions === null ? null : permissionDetails.safeParse(permissionJson(record.detailedPermissions));
  if (!modules.success || details !== null && !details.success) fail("DIRECTORY_INVALID", "FORBIDDEN");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = details?.success ? details.data.find(value => value.moduleId === "ops") : undefined;
  if (!module) return;
  for (const subModuleId of ["ops_dashboard", "ops_data_import"]) {
    const granted = module.subModules?.find(value => value.subModuleId === subModuleId)?.operations ?? module.operations;
    if (!granted.includes("read") || subModuleId === "ops_data_import" && !granted.includes(operation)) fail("DIRECTORY_DENIED", "FORBIDDEN");
  }
}
async function columns(tx: DbExecutor, table: string): Promise<Map<string, Column> | null> {
  const found = await rows(tx, "SELECT COLUMN_NAME AS columnName,IS_NULLABLE AS isNullable,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  if (found.length > 300 || new Set(found.map(row => row.columnName)).size !== found.length || found.some(row => typeof row.columnName !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || typeof row.dataType !== "string" || typeof row.columnType !== "string" || typeof row.extra !== "string" || row.maxLength !== null && (typeof row.maxLength !== "number" || !Number.isSafeInteger(row.maxLength) || row.maxLength < 0)
    || !(row.defaultValue === null || typeof row.defaultValue === "string" || typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue)) || row.collation !== null && typeof row.collation !== "string")) fail("SCHEMA_INVALID");
  if (found.length) return new Map(found.map(row => [row.columnName as string, { nullable: row.isNullable === "YES", dataType: row.dataType as string, columnType: row.columnType as string, extra: row.extra as string, maxLength: row.maxLength as number | null, defaultValue: row.defaultValue, collation: row.collation as string | null }]));
  try { await rows(tx, `SELECT 1 AS probe FROM ${table} LIMIT 0`, []); } catch (error) { if (noSuchTable(error)) return null; throw error; }
  return fail("SCHEMA_UNVERIFIABLE");
}
/** Introspection is read-only. No legacy table initialization or implicit DDL. */
async function schema(tx: DbExecutor) {
  const batch = await columns(tx, "ops_monthly_profit_imports"), artifact = await columns(tx, "ops_monthly_import_artifacts"), audit = await columns(tx, "security_audit_logs");
  const tables = ["ops_monthly_profit_imports", "ops_monthly_import_artifacts", "security_audit_logs", "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  const indexes = await rows(tx, "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_monthly_profit_imports','ops_monthly_import_artifacts','security_audit_logs') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX", []);
  if (engines.length > tables.length || new Set(engines.map(row => row.tableName)).size !== engines.length || engines.some(row => !tables.includes(String(row.tableName)) || typeof row.engine !== "string") || indexes.length > 200 || indexes.some(row => typeof row.tableName !== "string" || typeof row.indexName !== "string" || typeof row.columnName !== "string" || ![0, 1].includes(row.nonUnique as number) || !id(row.sequence))) fail("SCHEMA_INVALID");
  const innodb = (table: string) => engines.some(row => row.tableName === table && row.engine === "InnoDB");
  const utf8Table = (table: string) => engines.some(row => row.tableName === table && row.collation === "utf8mb4_unicode_ci");
  const utf8Columns = (table: Map<string, Column> | null, fields: string[]) => fields.every(field => table?.get(field)?.collation === "utf8mb4_unicode_ci");
  const groups = (table: string) => indexes.filter(row => row.tableName === table && row.nonUnique === 0 && row.sequence === 1).map(row => ({ name: row.indexName, rows: indexes.filter(other => other.tableName === table && other.indexName === row.indexName).sort((a, b) => Number(a.sequence) - Number(b.sequence)) }));
  const matching = (group: ReturnType<typeof groups>[number], fields: string[]) => group.rows.length === fields.length && group.rows.every((row, i) => row.sequence === i + 1 && row.columnName === fields[i] && row.nonUnique === 0 && row.prefixLength === null);
  const unique = (table: string, fields: string[], primary = false) => groups(table).some(group => (!primary || group.name === "PRIMARY") && matching(group, fields));
  const onlyUnique = (table: string, allowed: string[][]) => groups(table).every(group => allowed.some(fields => matching(group, fields)));
  const index = (table: string, fields: string[]) => indexes.some(row => row.tableName === table && row.sequence === 1 && (() => {
    const group = indexes.filter(other => other.tableName === table && other.indexName === row.indexName).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    return group.length === fields.length && group.every((entry, i) => entry.sequence === i + 1 && entry.columnName === fields[i] && entry.nonUnique === 1 && entry.prefixLength === null);
  })());
  const noRequiredExtra = (table: Map<string, Column> | null, supplied: string[]) => !!table && [...table].every(([field, value]) => supplied.includes(field) || value.nullable || value.defaultValue !== null || /auto_increment|generated/iu.test(value.extra));
  const ordinary = (table: Map<string, Column> | null, fields: string[]) => fields.every(field => table?.has(field) && table.get(field)!.extra === "");
  const integer = (table: Map<string, Column> | null, fields: string[]) => fields.every(field => table?.get(field)?.dataType === "int" && /^int(?:\(\d+\))?$/u.test(table.get(field)!.columnType) && !table.get(field)!.nullable);
  const chars = (table: Map<string, Column> | null, field: string, type: string, length: number) => table?.get(field)?.dataType === type && Number(table.get(field)!.maxLength) >= length && !table.get(field)!.nullable;
  const json = (table: Map<string, Column> | null, fields: string[]) => fields.every(field => table?.get(field)?.dataType === "json" && !table.get(field)!.nullable);
  const date = (table: Map<string, Column> | null, field: string, nullable: boolean) => table?.get(field)?.dataType === "datetime" && /^datetime\([3-6]\)$/u.test(table.get(field)!.columnType) && table.get(field)!.nullable === nullable && !/VIRTUAL GENERATED|STORED GENERATED|on update/iu.test(table.get(field)!.extra);
  const auditFields = ["auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"];
  const journalReady = tables.filter(table => !["ops_monthly_profit_imports", "ops_monthly_import_artifacts"].includes(table)).every(innodb)
    && unique("security_audit_logs", ["auditId"]) && onlyUnique("security_audit_logs", [["id"], ["auditId"]])
    && auditFields.every(field => audit?.has(field) && !/VIRTUAL GENERATED|STORED GENERATED/iu.test(audit.get(field)!.extra)) && chars(audit, "auditId", "varchar", 80) && audit?.get("metadata")?.dataType === "json" && noRequiredExtra(audit, auditFields);
  const batchFields = ["workspaceId", "userId", "fileName", "fileHash", "fileUrl", "status", "totalRows", "skippedRows", "unallocatedRows", "months", "payload", "createdAt", "confirmedAt"];
  const batchReady = innodb("ops_monthly_profit_imports") && utf8Table("ops_monthly_profit_imports") && utf8Columns(batch, ["fileName", "fileHash", "fileUrl", "status"])
    && unique("ops_monthly_profit_imports", ["id"], true) && onlyUnique("ops_monthly_profit_imports", [["id"]])
    && index("ops_monthly_profit_imports", ["workspaceId", "status", "id"]) && index("ops_monthly_profit_imports", ["workspaceId", "userId", "id"])
    && batch?.get("id")?.extra === "auto_increment" && integer(batch, ["id", "workspaceId", "userId", "totalRows", "skippedRows", "unallocatedRows"])
    && ordinary(batch, batchFields.filter(field => !["createdAt", "confirmedAt"].includes(field)))
    && chars(batch, "fileName", "varchar", 512) && chars(batch, "fileHash", "char", 64) && chars(batch, "status", "varchar", 20)
    && batch.get("fileUrl")?.dataType === "text" && !batch.get("fileUrl")!.nullable && json(batch, ["months", "payload"])
    && date(batch, "createdAt", false) && date(batch, "confirmedAt", true) && noRequiredExtra(batch, batchFields);
  const artifactFields = ["batch_id", "workspace_id", "prepared", "payload_hash", "manifest", "created_at"];
  const artifactReady = innodb("ops_monthly_import_artifacts") && utf8Table("ops_monthly_import_artifacts") && utf8Columns(artifact, ["payload_hash"])
    && unique("ops_monthly_import_artifacts", ["batch_id"], true) && onlyUnique("ops_monthly_import_artifacts", [["batch_id"]])
    && index("ops_monthly_import_artifacts", ["workspace_id", "batch_id"])
    && integer(artifact, ["batch_id", "workspace_id"]) && ordinary(artifact, artifactFields.filter(field => field !== "created_at"))
    && chars(artifact, "payload_hash", "char", 64) && json(artifact, ["prepared", "manifest"]) && date(artifact, "created_at", false) && noRequiredExtra(artifact, artifactFields);
  return { journalReady: Boolean(journalReady), batchReady: Boolean(batchReady), artifactReady: Boolean(artifactReady), base: Boolean(journalReady && batchReady && artifactReady) };
}
function sourceRecord(row: Row, workspaceId: number): MonthlyFinancialBatchRecord {
  const sourceRunId = typeof row.sourceRunId === "string" && /^[1-9][0-9]{0,9}$/u.test(row.sourceRunId) ? Number(row.sourceRunId) : row.sourceRunId;
  if (row.workspaceId !== workspaceId || !id(row.id) || !id(row.userId) || !["previewing", "completed", "deleted"].includes(String(row.status)) || !["saihu_sync_run", "storage", "unknown"].includes(String(row.fileReferenceKind)) || sourceRunId !== null && !id(sourceRunId)) fail("SOURCE_INVALID");
  const record: MonthlyFinancialBatchRecord = { id: row.id, workspaceId, userId: row.userId, fileName: row.fileName as string, fileHash: row.fileHash as string,
    status: row.status as MonthlyFinancialBatchRecord["status"], totalRows: row.totalRows as number, skippedRows: row.skippedRows as number, unallocatedRows: row.unallocatedRows as number,
    months: wire(row.months, row.monthsBytes, MONTHS_WIRE_MAX), payload: wire(row.payload, row.payloadBytes, PAYLOAD_WIRE_MAX), createdAt: row.createdAt as string, confirmedAt: row.confirmedAt as string | null,
    fileReferenceKind: row.fileReferenceKind as MonthlyFinancialBatchRecord["fileReferenceKind"], sourceRunId };
  parseMonthlyFinancialBatch(record); return record;
}
async function batchById(current: Session, batchId: number) {
  const found = await rows(current.tx, `SELECT ${projection(PAYLOAD_WIRE_MAX)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR UPDATE`, [current.identity.workspaceId, batchId]);
  if (found.length !== 1 || found[0].id !== batchId) fail("BATCH_NOT_FOUND", "NOT_FOUND");
  return sourceRecord(found[0], current.identity.workspaceId);
}
/** Fix all candidate identities before loading bodies. Newest whole-scope
 * winners are selected in shared code; old parent rows never backfill gaps. */
async function completedCandidates(current: Session) {
  const found = await rows(current.tx, "SELECT id,workspaceId,status,OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes,OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 201 FOR UPDATE", [current.identity.workspaceId]);
  if (found.length > SCAN_BATCHES_MAX) fail("CONSUMER_BATCH_BUDGET");
  let bytes = 0, previous = Number.MAX_SAFE_INTEGER;
  for (const row of found) {
    if (!id(row.id) || row.id >= previous || row.workspaceId !== current.identity.workspaceId || row.status !== "completed" || typeof row.payloadBytes !== "number" || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0 || row.payloadBytes > PAYLOAD_WIRE_MAX || typeof row.monthsBytes !== "number" || !Number.isSafeInteger(row.monthsBytes) || row.monthsBytes < 0 || row.monthsBytes > MONTHS_WIRE_MAX) fail("CANDIDATES_INVALID");
    previous = row.id; bytes += row.payloadBytes + row.monthsBytes;
  }
  if (bytes > SCAN_BYTES_MAX) fail("CONSUMER_SCAN_BUDGET");
  const records: MonthlyFinancialBatchRecord[] = [];
  for (const row of found) {
    const record = await batchById(current, row.id as number);
    if (record.status !== "completed" || Buffer.byteLength(record.payload as string, "utf8") !== row.payloadBytes || Buffer.byteLength(record.months as string, "utf8") !== row.monthsBytes) fail("CANDIDATES_CHANGED", "CONFLICT");
    records.push(record);
  }
  return records;
}

async function artifactByBatch(current: Session, record: MonthlyFinancialBatchRecord) {
  const found = await rows(current.tx, `SELECT a.batch_id AS batchId,a.workspace_id AS workspaceId,a.payload_hash AS payloadHash,
    IF(OCTET_LENGTH(CAST(a.prepared AS CHAR CHARACTER SET utf8mb4))<=${PREPARED_WIRE_MAX},CAST(a.prepared AS CHAR CHARACTER SET utf8mb4),NULL) AS prepared,
    OCTET_LENGTH(CAST(a.prepared AS CHAR CHARACTER SET utf8mb4)) AS preparedBytes,
    IF(OCTET_LENGTH(CAST(a.manifest AS CHAR CHARACTER SET utf8mb4))<=${MANIFEST_WIRE_MAX},CAST(a.manifest AS CHAR CHARACTER SET utf8mb4),NULL) AS manifest,
    OCTET_LENGTH(CAST(a.manifest AS CHAR CHARACTER SET utf8mb4)) AS manifestBytes,
    IF(OCTET_LENGTH(b.fileUrl)<=2048,b.fileUrl,NULL) AS storageReference
    FROM ops_monthly_import_artifacts a JOIN ops_monthly_profit_imports b ON b.id=a.batch_id AND b.workspaceId=a.workspace_id
    WHERE a.workspace_id=? AND a.batch_id=? LIMIT 2 FOR UPDATE`, [current.identity.workspaceId, record.id]);
  if (found.length > 1) fail("ARTIFACT_INVALID");
  if (!found.length) return null;
  const row = found[0];
  if (row.batchId !== record.id || row.workspaceId !== current.identity.workspaceId || typeof row.payloadHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.payloadHash)) fail("ARTIFACT_INVALID");
  let prepared: MonthlyFinancialPreparedUpload, manifest: MonthlyFinancialImport["manifest"];
  try {
    prepared = MonthlyFinancialPreparedUploadSchema.parse(JSON.parse(wire(row.prepared, row.preparedBytes, PREPARED_WIRE_MAX)));
    manifest = MonthlyFinancialImportManifestSchema.parse(JSON.parse(wire(row.manifest, row.manifestBytes, MANIFEST_WIRE_MAX)));
  } catch { return fail("ARTIFACT_INVALID"); }
  if (prepared.identity.workspaceId !== record.workspaceId || prepared.identity.userId !== record.userId || prepared.fileName !== record.fileName || prepared.fileHash !== record.fileHash || row.storageReference !== prepared.storageUri
    || manifest.fileName !== prepared.fileName || manifest.format !== prepared.format || manifest.byteLength !== prepared.byteSize || manifest.parserVersion !== prepared.parserVersion) fail("ARTIFACT_MISMATCH");
  const artifact = { prepared, manifest, payloadHash: row.payloadHash };
  // Version construction also verifies the complete canonical stored payload.
  monthlyFinancialBatchVersion(record, artifact);
  return artifact;
}
function knownError(error: unknown) {
  return error instanceof TRPCError || error instanceof MonthlyFinancialWriteError || error instanceof MonthlyFinancialImportError || error instanceof MonthlyFinancialReadError || error instanceof MonthlyFinancialJournalError || error instanceof z.ZodError;
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "NOT_FOUND"].includes(error.code)) throw error;
  if (error instanceof MonthlyFinancialWriteError || error instanceof MonthlyFinancialImportError || error instanceof MonthlyFinancialJournalError) fail(error.code, /CONFLICT|CANCELLED|MISMATCH/u.test(error.code) ? "CONFLICT" : "PRECONDITION_FAILED");
  if (error instanceof z.ZodError) fail("INVALID_DATA", "BAD_REQUEST");
  if (error instanceof MonthlyFinancialReadError) fail("SOURCE_INVALID");
  if (error instanceof MonthlyFinancialImportStorageError) fail(error.code);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "MONTHLY_FINANCIAL_WRITE_UNAVAILABLE" });
}
function affected(result: unknown) {
  const header = Array.isArray(result) ? result[0] : null;
  if (!header || typeof header !== "object" || header.affectedRows !== 1) fail("WRITE_CONFLICT", "CONFLICT");
  return header as { affectedRows: number; insertId?: number };
}

export function createMonthlyFinancialWriteRepository(dependencies: {
  database?: () => Promise<MonthlyFinancialWriteDatabase | null>; permission?: typeof assertResourceAction;
  directory?: typeof strictMonthlyFinancialDirectory; journal?: typeof createMonthlyFinancialOperationJournal;
  storage?: typeof monthlyFinancialImportStorage; parseImport?: typeof parseMonthlyFinancialImport; enabled?: () => boolean;
} = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction,
    directory = dependencies.directory ?? strictMonthlyFinancialDirectory, journal = dependencies.journal ?? createMonthlyFinancialOperationJournal,
    storage = dependencies.storage ?? monthlyFinancialImportStorage, parseImport = dependencies.parseImport ?? parseMonthlyFinancialImport,
    enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_MONTHLY_WRITES === "true");
  async function authorize(current: Session, action: "read" | "create" | "update" | "delete") {
    await permission({ actor: current.actor, workspaceId: current.identity.workspaceId, resource: "ops_monthly_import", action, authorizationRead: { executor: current.tx, strict: true, lock: true } });
    await directory(current.tx, current.role, current.identity.workspaceId, action === "read" ? "read" : action === "delete" ? "delete" : "edit");
  }
  async function session<T>(ctx: TrpcContext, expectedWorkspaceId: number, body: (current: Session) => Promise<T>) {
    if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED");
    const workspaceId = ctx.workspaceId ?? ctx.user.defaultWorkspaceId;
    if (!id(ctx.user.id) || !id(workspaceId) || workspaceId !== expectedWorkspaceId || !managerRoles.includes(ctx.user.role)) fail("WORKSPACE_OR_ROLE_DENIED", "FORBIDDEN");
    const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      // A workspace lock (before actor locks) serializes overlapping scopes
      // even when two different managers confirm/revoke concurrently.
      const workspaces = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [workspaceId]);
      if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].status !== "active") fail("WORKSPACE_INACTIVE", "FORBIDDEN");
      const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [ctx.user!.id]), actor = actors[0];
      if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId || !managerRoles.includes(String(actor.role))) fail("ACTOR_CHANGED", "FORBIDDEN");
      const memberships = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [workspaceId, actor.id]);
      if (memberships.length !== 1 || !id(memberships[0].id) || memberships[0].workspaceId !== workspaceId || memberships[0].userId !== actor.id || memberships[0].status !== "active") fail("MEMBERSHIP_REQUIRED", "FORBIDDEN");
      const current: Session = { tx, identity: { userId: actor.id as number, workspaceId }, actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, role: actor.role as string };
      await permission({ actor: current.actor, workspaceId, resource: "ops_data", action: "read", authorizationRead: { executor: tx, strict: true, lock: true } });
      await authorize(current, "read"); return body(current);
    });
  }
  function log(current: Session, operationId: string) { return journal(current.tx, { ...current.identity, operationId, actorRole: current.role }); }
  function unknown(identity: Identity, operationId: string): MonthlyFinancialWriteResult { return MonthlyFinancialWriteResultSchema.parse({ identity, operationId, action: null, status: "unknown", batchId: null, batchStatus: null, batchVersion: null, reasonCode: "outcome_unknown_check_same_operation" }); }
  function receipt(current: Session, operationId: string, action: "upload" | "confirm" | "revoke", record: MonthlyFinancialBatchRecord, artifact: Awaited<ReturnType<typeof artifactByBatch>>) {
    return MonthlyFinancialWriteResultSchema.parse({ identity: current.identity, operationId, action, status: "committed", batchId: record.id, batchStatus: record.status, batchVersion: monthlyFinancialBatchVersion(record, artifact), reasonCode: null });
  }
  async function capabilities(current: Session, ready: Awaited<ReturnType<typeof schema>>): Promise<MonthlyFinancialWriteOptionsResult["capabilities"]> {
    const check = async (action: "create" | "update" | "delete", needsStorage = false) => {
      if (!enabled()) return unavailable("not_enabled_before_release");
      if (!ready.base) return unavailable("schema_not_ready");
      try { await authorize(current, action); } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") return unavailable("permission_denied"); throw error; }
      return needsStorage ? storage.capability() : available();
    };
    return { upload: await check("create", true), confirm: await check("update"), revoke: await check("delete"),
      inspect: ready.batchReady ? available() : unavailable("schema_not_ready"), recover: ready.journalReady ? available() : unavailable("journal_schema_not_ready"), download: ready.base ? storage.capability() : unavailable("schema_not_ready") };
  }
  async function loaded(current: Session, batchId: number, ready: Awaited<ReturnType<typeof schema>>) {
    if (!ready.batchReady) fail("SCHEMA_NOT_READY");
    const record = await batchById(current, batchId), artifact = ready.artifactReady ? await artifactByBatch(current, record) : null;
    const completed = await completedCandidates(current);
    const impact = buildMonthlyFinancialWriteImpact({ target: record, completed, complete: true, blockingReasons: artifact?.manifest.blockingReasons });
    return { record, artifact, impact };
  }
  async function options(ctx: TrpcContext, raw: MonthlyFinancialWriteOptionsInput) {
    const input = MonthlyFinancialWriteOptionsInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => MonthlyFinancialWriteOptionsResultSchema.parse({ identity: current.identity, capabilities: await capabilities(current, await schema(current.tx)), limits: MONTHLY_FINANCIAL_WRITE_PUBLIC_LIMITS })); }
    catch (error) { return sanitized(error); }
  }
  async function inspect(ctx: TrpcContext, raw: MonthlyFinancialWriteInspectInput) {
    const input = MonthlyFinancialWriteInspectInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      const ready = await schema(current.tx), state = await loaded(current, input.batchId, ready), caps = await capabilities(current, ready);
      if (!state.artifact) { caps.confirm = unavailable("original_manifest_unavailable"); caps.download = unavailable("original_manifest_unavailable"); }
      if (state.record.status !== "previewing") caps.confirm = unavailable("batch_not_previewing");
      if (state.impact.blockingReasons.length || state.impact.scopes.some(scope => scope.confirmWinnerId !== state.record.id)) caps.confirm = unavailable("impact_blocked");
      if (state.record.status === "deleted") caps.revoke = unavailable("batch_already_deleted");
      return buildMonthlyFinancialWriteInspectResult({ identity: current.identity, input, ...state, capabilities: { confirm: caps.confirm, revoke: caps.revoke, download: caps.download } });
    }); } catch (error) { return sanitized(error); }
  }
  async function finishUpload(ctx: TrpcContext, prepared: MonthlyFinancialPreparedUpload, parsed: MonthlyFinancialImport): Promise<MonthlyFinancialWriteResult> {
    return session(ctx, prepared.identity.workspaceId, async current => {
      if (!enabled()) fail("NOT_ENABLED"); await authorize(current, "create");
      if (!(await schema(current.tx)).base) fail("SCHEMA_NOT_READY");
      const operation = log(current, prepared.operationId), state = await operation.read();
      if (state.final) {
        if (state.final.requestHash !== null && state.final.requestHash !== prepared.requestHash) fail("OPERATION_CONFLICT", "CONFLICT");
        return state.final.receipt;
      }
      if (!state.prepared || monthlyFinancialImportHash(state.prepared) !== monthlyFinancialImportHash(prepared) || prepared.identity.userId !== current.identity.userId
        || parsed.fileHash !== prepared.fileHash || parsed.manifest.byteLength !== prepared.byteSize || parsed.manifest.format !== prepared.format || parsed.manifest.fileName !== prepared.fileName) fail("PREPARE_CONFLICT", "CONFLICT");
      const result = affected(await current.tx.execute(statement("INSERT INTO ops_monthly_profit_imports (workspaceId,userId,fileName,fileHash,fileUrl,status,totalRows,skippedRows,unallocatedRows,months,payload,createdAt,confirmedAt) VALUES (?,?,?,?,?,'previewing',?,?,?,?,?,CURRENT_TIMESTAMP(3),NULL)", [current.identity.workspaceId, current.identity.userId, prepared.fileName, prepared.fileHash, prepared.storageUri, parsed.totalRows, parsed.skippedRows, parsed.unallocatedRows, JSON.stringify(parsed.months), JSON.stringify(parsed.rows)])));
      if (!id(result.insertId)) fail("INSERT_UNVERIFIABLE");
      affected(await current.tx.execute(statement("INSERT INTO ops_monthly_import_artifacts (batch_id,workspace_id,prepared,payload_hash,manifest,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP(3))", [result.insertId, current.identity.workspaceId, JSON.stringify(prepared), parsed.payloadHash, JSON.stringify(parsed.manifest)])));
      const record = await batchById(current, result.insertId), artifact = await artifactByBatch(current, record);
      if (!artifact || record.status !== "previewing" || artifact.payloadHash !== parsed.payloadHash || monthlyFinancialImportHash(artifact.manifest) !== parsed.manifestHash) fail("INSERT_UNVERIFIABLE");
      return operation.finalize(receipt(current, prepared.operationId, "upload", record, artifact), prepared.requestHash);
    });
  }
  async function upload(ctx: TrpcContext, raw: MonthlyFinancialWriteUploadInput): Promise<MonthlyFinancialWriteResult> {
    const input = MonthlyFinancialWriteUploadInputSchema.parse(raw), bytes = Uint8Array.from(Buffer.from(input.base64, "base64"));
    if (!bytes.length || bytes.length > MONTHLY_FINANCIAL_IMPORT_LIMITS.fileBytes || Buffer.from(bytes).toString("base64") !== input.base64) fail("FILE_INVALID", "BAD_REQUEST");
    let captured: Identity | null = null;
    try {
      const parsed = await parseImport(bytes, input.fileName);
      const requestHash = monthlyFinancialOperationRequestHash("upload", input);
      const preparation = await session(ctx, input.expectedWorkspaceId, async current => {
        captured = current.identity;
        if (!enabled()) fail("NOT_ENABLED"); await authorize(current, "create");
        if (!(await schema(current.tx)).base) fail("SCHEMA_NOT_READY");
        const operation = log(current, input.operationId), existing = await operation.read();
        if (existing.final) {
          if (existing.final.requestHash !== null && existing.final.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT");
          return { final: existing.final.receipt, created: false, prepared: null };
        }
        const prepared = storage.prepare(current.identity, input.operationId, { fileName: input.fileName, format: input.format, fileHash: parsed.fileHash, byteSize: bytes.length, requestHash });
        const result = await operation.prepare(prepared); return { final: null, ...result };
      });
      if (preparation.final) return preparation.final;
      // Only an acknowledged newly-created prepare may perform this one PUT.
      // A replay or lost prepare commit must recover using GET, not retry PUT.
      if (!preparation.created || !preparation.prepared) return unknown(captured!, input.operationId);
      await storage.putOnce(preparation.prepared, bytes);
      await storage.readVerified(preparation.prepared);
      return await finishUpload(ctx, preparation.prepared, parsed);
    } catch (error) {
      if (knownError(error)) return sanitized(error);
      if (captured) return unknown(captured, input.operationId);
      return sanitized(error);
    }
  }
  async function transition(ctx: TrpcContext, raw: MonthlyFinancialWriteConfirmInput | MonthlyFinancialWriteRevokeInput, action: "confirm" | "revoke"): Promise<MonthlyFinancialWriteResult> {
    const input = (action === "confirm" ? MonthlyFinancialWriteConfirmInputSchema : MonthlyFinancialWriteRevokeInputSchema).parse(raw);
    const requestHash = monthlyFinancialOperationRequestHash(action, input); let captured: Identity | null = null;
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      captured = current.identity;
      if (!enabled()) fail("NOT_ENABLED"); await authorize(current, action === "confirm" ? "update" : "delete");
      const ready = await schema(current.tx); if (!ready.base) fail("SCHEMA_NOT_READY");
      const operation = log(current, input.operationId), existing = await operation.read();
      if (existing.final) {
        if (existing.final.requestHash !== null && existing.final.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT");
        return existing.final.receipt;
      }
      if (existing.prepared) fail("OPERATION_CONFLICT", "CONFLICT");
      const state = await loaded(current, input.batchId, ready);
      if (monthlyFinancialBatchVersion(state.record, state.artifact) !== input.expectedBatchVersion || state.impact.key !== input.expectedImpactKey) fail("VERSION_OR_IMPACT_CONFLICT", "CONFLICT");
      if (action === "confirm" && (!state.artifact || state.record.status !== "previewing" || state.impact.blockingReasons.length || !state.impact.scopes.length || state.impact.scopes.some(scope => scope.confirmWinnerId !== state.record.id))) fail("CONFIRM_BLOCKED", "CONFLICT");
      if (action === "revoke" && state.record.status === "deleted") fail("ALREADY_DELETED", "CONFLICT");
      affected(await current.tx.execute(statement(action === "confirm"
        ? "UPDATE ops_monthly_profit_imports SET status='completed',confirmedAt=CURRENT_TIMESTAMP(3) WHERE workspaceId=? AND id=? AND status='previewing'"
        : "UPDATE ops_monthly_profit_imports SET status='deleted' WHERE workspaceId=? AND id=? AND status=?", [current.identity.workspaceId, input.batchId, ...(action === "revoke" ? [state.record.status] : [])])));
      // Admission uses actual MySQL JSON wire sizes after the prospective
      // update. Exceeding any existing consumer budget rolls back the status.
      await completedCandidates(current);
      const record = await batchById(current, input.batchId), artifact = await artifactByBatch(current, record);
      if (record.status !== (action === "confirm" ? "completed" : "deleted")) fail("TRANSITION_UNVERIFIABLE");
      return operation.finalize(receipt(current, input.operationId, action, record, artifact), requestHash);
    }); } catch (error) { if (knownError(error)) return sanitized(error); if (captured) return unknown(captured, input.operationId); return sanitized(error); }
  }
  async function recover(ctx: TrpcContext, raw: MonthlyFinancialWriteRecoverInput): Promise<MonthlyFinancialWriteResult> {
    const input = MonthlyFinancialWriteRecoverInputSchema.parse(raw); let captured: Identity | null = null;
    try {
      const result = await session(ctx, input.expectedWorkspaceId, async current => {
        captured = current.identity;
        const ready = await schema(current.tx); if (!ready.journalReady) fail("JOURNAL_SCHEMA_NOT_READY");
        const operation = log(current, input.operationId), state = await operation.read();
        if (state.final) return { receipt: state.final.receipt, prepared: null };
        // A final cancel fence must still work following deployment rollback.
        if (input.decision === "cancel") return { receipt: await operation.cancel(), prepared: null };
        if (input.decision === "check" || !state.prepared) return { receipt: unknown(current.identity, input.operationId), prepared: null };
        if (!enabled()) fail("NOT_ENABLED"); await authorize(current, "create");
        if (!ready.base) fail("SCHEMA_NOT_READY");
        return { receipt: null, prepared: state.prepared };
      });
      if (result.receipt) return result.receipt;
      if (!result.prepared) return unknown(captured!, input.operationId);
      const bytes = await storage.readVerified(result.prepared), parsed = await parseImport(bytes, result.prepared.fileName);
      return await finishUpload(ctx, result.prepared, parsed);
    } catch (error) { if (knownError(error)) return sanitized(error); if (captured) return unknown(captured, input.operationId); return sanitized(error); }
  }
  async function download(ctx: TrpcContext, raw: MonthlyFinancialWriteDownloadInput) {
    const input = MonthlyFinancialWriteDownloadInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      const ready = await schema(current.tx); if (!ready.base) fail("SCHEMA_NOT_READY");
      const record = await batchById(current, input.batchId), artifact = await artifactByBatch(current, record);
      if (!artifact) fail("ORIGINAL_UNAVAILABLE");
      const batchVersion = monthlyFinancialBatchVersion(record, artifact); if (batchVersion !== input.expectedBatchVersion) fail("VERSION_CONFLICT", "CONFLICT");
      const result = await storage.download(artifact.prepared);
      return MonthlyFinancialWriteDownloadResultSchema.parse({ ...result, identity: current.identity, batchId: record.id, batchVersion, fileName: record.fileName, fileHash: record.fileHash, byteSize: artifact.prepared.byteSize });
    }); } catch (error) { return sanitized(error); }
  }
  return { options, upload, inspect, confirm: (ctx: TrpcContext, input: MonthlyFinancialWriteConfirmInput) => transition(ctx, input, "confirm"), revoke: (ctx: TrpcContext, input: MonthlyFinancialWriteRevokeInput) => transition(ctx, input, "revoke"), recover, download };
}
export const monthlyFinancialWriteRepository = createMonthlyFinancialWriteRepository();
