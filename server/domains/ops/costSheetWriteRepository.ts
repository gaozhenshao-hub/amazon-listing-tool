import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import type { OperationsCostSheetScope } from "../../../shared/operationsCostSheetRead";
import {
  OperationsCostSheetWriteOptionsInputSchema, OperationsCostSheetWriteOptionsResultSchema,
  OperationsCostSheetWriteSaveInputSchema, OperationsCostSheetWriteRecoverInputSchema, OperationsCostSheetWriteResultSchema,
  operationsCostSheetSnapshotKey, operationsCostSheetOperationRequestHash, validateOperationsCostSheetWriteAgainstReadResult, OperationsCostSheetWriteError,
  type OperationsCostSheetWriteOptionsInput, type OperationsCostSheetWriteSaveInput,
  type OperationsCostSheetWriteRecoverInput, type OperationsCostSheetWriteResult,
} from "../../../shared/operationsCostSheetWrite";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  costSheetSql, costSheetRows as rows, costSheetId as id, costSheetScopedWhere, costSheetScopeParams,
  loadCostSheetReadState, type CostSheetReadSession, type CostSheetReadState,
} from "./costSheetReadRepository";
import { createCostSheetOperationJournal, CostSheetJournalError } from "./costSheetOperationJournal";

type Row = Record<string, unknown>;
type Capability = { status: "available" | "unavailable"; reasonCode: string | null };
type Session = CostSheetReadSession & { actor: { id: number; role: string; defaultWorkspaceId: number }; activeOwnerIds: Set<number> };
type Column = { nullable: boolean; dataType: string; columnType: string; extra: string; maxLength: number | null; defaultValue: unknown };
export interface CostSheetWriteDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const writerRoles = ["super_admin", "admin", "ops_manager", "ops_specialist"];
const available = (): Capability => ({ status: "available", reasonCode: null });
const unavailable = (reasonCode: string): Capability => ({ status: "unavailable", reasonCode });
function fail(message: string, code: "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT" | "BAD_REQUEST" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `COST_SHEET_WRITE_${message}` });
}
function safeError(error: unknown): never {
  if (error instanceof OperationsCostSheetWriteError) fail(error.code, /CONFLICT|SCOPE_MISMATCH/u.test(error.code) ? "CONFLICT" : "BAD_REQUEST");
  if (error instanceof CostSheetJournalError) fail(error.code, /CONFLICT|SCOPE_MISMATCH|CANCELLED/u.test(error.code) ? "CONFLICT" : "PRECONDITION_FAILED");
  if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"].includes(error.code)) throw error;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "COST_SHEET_WRITE_UNAVAILABLE" });
}
function errorCode(error: unknown, code: string): boolean {
  let next = error;
  for (let depth = 0; depth < 5 && next && typeof next === "object"; depth++) {
    const row = next as { code?: unknown; errno?: unknown; cause?: unknown };
    if (row.code === code || code === "ER_NO_SUCH_TABLE" && row.errno === 1146 || code === "ER_DUP_ENTRY" && row.errno === 1062) return true;
    next = row.cause;
  }
  return false;
}
const permissionName = z.string().min(1).max(100).refine(value => value === value.trim());
const operationNames = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(values => new Set(values).size === values.length);
const detailSchema = z.array(z.object({ moduleId: permissionName, operations: operationNames, subModules: z.array(z.object({ subModuleId: permissionName, operations: operationNames }).strict()).max(100).refine(values => new Set(values.map(value => value.subModuleId)).size === values.length).optional() }).strict()).max(100).refine(values => new Set(values.map(value => value.moduleId)).size === values.length);
function policyJson(value: unknown): unknown {
  try {
    if (Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8") > 65536) fail("DIRECTORY_INVALID", "FORBIDDEN");
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch { return fail("DIRECTORY_INVALID", "FORBIDDEN"); }
}
/** Both finance read and the actual cost editor directory must remain granted.
 * Strict policy allows never override an explicit directory denial. */
export async function strictCostSheetDirectory(tx: DbExecutor, role: string, workspaceId: number, operation: "read" | "edit" = "read") {
  if (role === "super_admin") return;
  const records = await rows(tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [role, workspaceId]);
  if (records.length > 2 || new Set(records.map(row => row.workspaceId)).size !== records.length || records.some(row => !id(row.id) || row.role !== role || row.workspaceId !== null && row.workspaceId !== workspaceId)) fail("DIRECTORY_INVALID", "FORBIDDEN");
  const record = records.find(row => row.workspaceId === workspaceId) ?? records.find(row => row.workspaceId === null);
  if (!record) { if (!ROLE_MODULE_ACCESS[role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return; }
  const modules = z.array(permissionName).max(100).refine(values => new Set(values).size === values.length).safeParse(policyJson(record.modules));
  const details = record.detailedPermissions === null ? null : detailSchema.safeParse(policyJson(record.detailedPermissions));
  if (!modules.success || details !== null && !details.success) fail("DIRECTORY_INVALID", "FORBIDDEN");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = details?.success ? details.data.find(value => value.moduleId === "ops") : undefined;
  if (!module) return;
  for (const subModuleId of ["ops_dashboard", "ops_data_import"]) {
    const operations = module.subModules?.find(value => value.subModuleId === subModuleId)?.operations ?? module.operations;
    if (!operations.includes("read") || subModuleId === "ops_data_import" && !operations.includes(operation)) fail("DIRECTORY_DENIED", "FORBIDDEN");
  }
}
async function activeMembers(tx: DbExecutor, workspaceId: number) {
  const found = await rows(tx, "SELECT m.id AS membershipId,m.workspaceId,m.userId,m.status AS membershipStatus,u.id,u.status FROM workspace_memberships m JOIN users u ON u.id=m.userId WHERE m.workspaceId=? ORDER BY u.id,m.id LIMIT 5001 FOR SHARE", [workspaceId]);
  if (found.length > 5000 || new Set(found.map(row => row.id)).size !== found.length || found.some(row => !id(row.membershipId) || !id(row.id) || row.id !== row.userId || row.workspaceId !== workspaceId || typeof row.status !== "string" || typeof row.membershipStatus !== "string")) fail("MEMBERS_INVALID");
  return new Set(found.filter(row => row.status === "active" && row.membershipStatus === "active").map(row => row.id as number));
}
async function columns(tx: DbExecutor, table: "ops_cost_sheets" | "security_audit_logs"): Promise<Map<string, Column> | null> {
  const found = await rows(tx, "SELECT COLUMN_NAME AS columnName,IS_NULLABLE AS isNullable,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  if (found.length > 300 || new Set(found.map(row => row.columnName)).size !== found.length || found.some(row => typeof row.columnName !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || typeof row.dataType !== "string" || typeof row.columnType !== "string" || typeof row.extra !== "string" || row.maxLength !== null && (typeof row.maxLength !== "number" || !Number.isSafeInteger(row.maxLength) || row.maxLength < 0))) fail("SCHEMA_INVALID");
  if (found.length) return new Map(found.map(row => [row.columnName as string, { nullable: row.isNullable === "YES", dataType: row.dataType as string, columnType: row.columnType as string, extra: row.extra as string, maxLength: row.maxLength as number | null, defaultValue: row.defaultValue }]));
  try { await rows(tx, `SELECT 1 AS probe FROM ${table} LIMIT 0`); } catch (error) { if (errorCode(error, "ER_NO_SUCH_TABLE")) return null; throw error; }
  return fail("SCHEMA_UNVERIFIABLE");
}
async function schema(tx: DbExecutor) {
  const cost = await columns(tx, "ops_cost_sheets"), audit = await columns(tx, "security_audit_logs");
  const engines = await rows(tx, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_cost_sheets','security_audit_logs','users','workspace_memberships','lingxing_product_weekly','saihu_product_weekly','operator_name_mappings','ops_inventory_owner_assignments','role_permissions','security_access_policies')");
  const indexes = await rows(tx, "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ops_cost_sheets','security_audit_logs') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
  if (engines.length > 10 || new Set(engines.map(row => row.tableName)).size !== engines.length || engines.some(row => typeof row.tableName !== "string" || typeof row.engine !== "string") || indexes.length > 200 || indexes.some(row => typeof row.tableName !== "string" || typeof row.indexName !== "string" || typeof row.columnName !== "string" || ![0, 1].includes(row.nonUnique as number) || !id(row.sequence))) fail("SCHEMA_INVALID");
  const innodb = (table: string) => engines.some(row => row.tableName === table && row.engine === "InnoDB");
  const unique = (table: string, names: string[], primary = false) => indexes.some(row => row.tableName === table && row.sequence === 1 && (!primary || row.indexName === "PRIMARY") && (() => {
    const group = indexes.filter(other => other.tableName === table && other.indexName === row.indexName).sort((left, right) => Number(left.sequence) - Number(right.sequence));
    return group.length === names.length && group.every((entry, index) => entry.sequence === index + 1 && entry.columnName === names[index] && entry.nonUnique === 0 && entry.prefixLength === null);
  })());
  const onlyExpectedUnique = (table: string, allowed: string[][]) => indexes.filter(row => row.tableName === table && row.nonUnique === 0 && row.sequence === 1).every(row => {
    const group = indexes.filter(other => other.tableName === table && other.indexName === row.indexName).sort((left, right) => Number(left.sequence) - Number(right.sequence));
    return allowed.some(names => group.length === names.length && group.every((entry, index) => entry.sequence === index + 1 && entry.columnName === names[index] && entry.prefixLength === null));
  });
  const noRequiredExtra = (table: Map<string, Column> | null, supplied: string[]) => !!table && [...table].every(([name, value]) => supplied.includes(name) || value.nullable || value.defaultValue != null || /auto_increment|generated/iu.test(value.extra));
  const auditSupplied = ["auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"];
  const journalReady = ["security_audit_logs", "users", "workspace_memberships", "role_permissions", "security_access_policies"].every(innodb)
    && unique("security_audit_logs", ["auditId"]) && onlyExpectedUnique("security_audit_logs", [["id"], ["auditId"]]) && auditSupplied.every(field => audit?.has(field) && !/generated/iu.test(audit.get(field)!.extra))
    && audit?.get("auditId")?.dataType === "varchar" && Number(audit.get("auditId")!.maxLength) >= 75 && audit.get("metadata")?.dataType === "json" && noRequiredExtra(audit, auditSupplied);
  const base = journalReady && ["ops_cost_sheets", "lingxing_product_weekly", "saihu_product_weekly", "operator_name_mappings", "ops_inventory_owner_assignments"].every(innodb)
    && ["id", "workspace_id", "parent_asin", "store_name", "country", "payload", "version", "updated_by", "updated_at"].every(field => cost?.has(field))
    && unique("ops_cost_sheets", ["id"], true) && unique("ops_cost_sheets", ["workspace_id", "parent_asin", "store_name", "country"])
    && onlyExpectedUnique("ops_cost_sheets", [["id"], ["workspace_id", "parent_asin", "store_name", "country"]])
    && cost?.get("id")?.extra.toLowerCase() === "auto_increment"
    && ["id", "workspace_id", "version", "updated_by"].every(field => cost?.get(field)?.dataType === "int" && /^int(?:\(\d+\))?$/u.test(cost.get(field)!.columnType) && !cost.get(field)!.nullable)
    && ["workspace_id", "parent_asin", "store_name", "country", "payload", "version", "updated_by"].every(field => cost?.get(field)?.extra === "")
    && !/VIRTUAL GENERATED|STORED GENERATED/iu.test(cost?.get("updated_at")?.extra ?? "")
    && Object.entries({ parent_asin: 500, store_name: 200, country: 20 }).every(([field, length]) => cost?.get(field)?.dataType === "varchar" && Number(cost.get(field)!.maxLength) >= length && !cost.get(field)!.nullable)
    && cost?.get("payload")?.dataType === "json" && !cost.get("payload")!.nullable && ["timestamp", "datetime"].includes(cost.get("updated_at")!.dataType) && !cost.get("updated_at")!.nullable
    && noRequiredExtra(cost, ["workspace_id", "parent_asin", "store_name", "country", "payload", "version", "updated_by", "updated_at"]);
  return { base: Boolean(base), journalReady: Boolean(journalReady) };
}
function scopeMatches(value: Row, scope: OperationsCostSheetScope) {
  return value.workspaceId === scope.workspaceId && value.parentAsin === scope.parentAsin && value.storeName === scope.storeName && typeof value.country === "string" && normalizeMarketplaceCode(value.country) === scope.country;
}
/** Check the physical collation too; a BINARY miss is not proof that a new row
 * can be safely inserted into the legacy case/accent-insensitive unique key. */
async function lockScopeCollisions(current: Session) {
  const found = await rows(current.tx, `SELECT id,workspace_id AS workspaceId,parent_asin AS parentAsin,store_name AS storeName,country FROM ops_cost_sheets WHERE ${costSheetScopedWhere("workspace_id", "country").replaceAll("BINARY ", "")} LIMIT 3 FOR UPDATE`, costSheetScopeParams(current.scope));
  if (found.length > 1 || found.some(row => !id(row.id) || !scopeMatches(row, current.scope))) fail("SCOPE_COLLISION", "CONFLICT");
}

export function createCostSheetWriteRepository(dependencies: {
  database?: () => Promise<CostSheetWriteDatabase | null>; permission?: typeof assertResourceAction;
  directory?: typeof strictCostSheetDirectory; loadState?: typeof loadCostSheetReadState;
  journal?: typeof createCostSheetOperationJournal; enabled?: () => boolean; now?: () => Date;
} = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction,
    directory = dependencies.directory ?? strictCostSheetDirectory, loadState = dependencies.loadState ?? loadCostSheetReadState,
    journal = dependencies.journal ?? createCostSheetOperationJournal,
    enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_COST_WRITES === "true"), now = dependencies.now ?? (() => new Date());
  async function authorize(current: Session, action: "read" | "update") {
    if (action === "update" && !writerRoles.includes(current.role)) fail("ROLE_DENIED", "FORBIDDEN");
    await permission({ actor: current.actor, workspaceId: current.identity.workspaceId, resource: "ops_cost_sheet", action, resourceId: JSON.stringify(current.scope), authorizationRead: { executor: current.tx, strict: true, lock: true } });
    await directory(current.tx, current.role, current.identity.workspaceId, action === "read" ? "read" : "edit");
  }
  async function session<T>(ctx: TrpcContext, input: OperationsCostSheetWriteOptionsInput, body: (current: Session) => Promise<T>) {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "COST_SHEET_WRITE_LOGIN_REQUIRED" });
    const workspaceId = ctx.workspaceId ?? ctx.user.defaultWorkspaceId;
    if (!id(ctx.user.id) || !id(workspaceId) || workspaceId !== input.expectedWorkspaceId || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("WORKSPACE_CHANGED", "FORBIDDEN");
    const clock = now(); if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) fail("CLOCK_INVALID");
    const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [ctx.user!.id]), actor = actors[0];
      if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("ACTOR_CHANGED", "FORBIDDEN");
      const activeOwnerIds = await activeMembers(tx, workspaceId); if (!activeOwnerIds.has(actor.id as number)) fail("MEMBERSHIP_REQUIRED", "FORBIDDEN");
      const current: Session = { tx, identity: { userId: actor.id as number, workspaceId }, actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, role: actor.role as string,
        scope: { workspaceId, parentAsin: input.parentAsin, storeName: input.storeName, country: input.country }, asOfDate: clock.toISOString().slice(0, 10), activeOwnerIds };
      await permission({ actor: current.actor, workspaceId, resource: "ops_data", action: "read", resourceId: JSON.stringify([input.parentAsin, input.storeName, input.country]), authorizationRead: { executor: tx, strict: true, lock: true } });
      await authorize(current, "read"); return body(current);
    });
  }
  async function state(current: Session) { return loadState(current, { lock: "update", activeOwnerIds: current.activeOwnerIds }); }
  function snapshot(value: CostSheetReadState) {
    return ["saved", "not_saved"].includes(value.readResult.status) && value.readResult.sourceStatus === "available" ? operationsCostSheetSnapshotKey(value) : null;
  }
  function operationJournal(current: Session, operationId: string) { return journal(current.tx, { ...current.identity, scope: current.scope, operationId, actorRole: current.role }); }
  function unknown(current: Pick<Session, "identity" | "scope">, operationId: string): OperationsCostSheetWriteResult {
    return OperationsCostSheetWriteResultSchema.parse({ identity: current.identity, scope: current.scope, operationId, status: "unknown", version: null, snapshotKey: null, reasonCode: "outcome_unknown_check_same_operation" });
  }
  async function options(ctx: TrpcContext, raw: OperationsCostSheetWriteOptionsInput) {
    const input = OperationsCostSheetWriteOptionsInputSchema.parse(raw);
    try { return await session(ctx, input, async current => {
      const loaded = await state(current), snapshotKey = snapshot(loaded);
      let capability = unavailable("not_enabled_before_release");
      if (enabled()) {
        const ready = await schema(current.tx);
        capability = !ready.base ? unavailable("schema_not_ready") : snapshotKey === null ? unavailable("source_or_saved_unavailable") : !loaded.readResult.sourceRecordCount || !loaded.readResult.rows.some(row => row.fact !== null) ? unavailable("no_current_facts") : (loaded.readResult.saved?.version ?? 0) >= 2147483647 ? unavailable("version_exhausted") : available();
        if (capability.status === "available") {
          try { await authorize(current, "update"); await lockScopeCollisions(current); }
          catch (error) { if (error instanceof TRPCError && ["FORBIDDEN", "CONFLICT"].includes(error.code)) capability = unavailable(error.code === "FORBIDDEN" ? "permission_denied" : "scope_collision"); else throw error; }
        }
      }
      return OperationsCostSheetWriteOptionsResultSchema.parse({ identity: current.identity, scope: current.scope, readResult: loaded.readResult, snapshotKey, capabilities: { save: capability } });
    }); } catch (error) { return safeError(error); }
  }
  async function save(ctx: TrpcContext, raw: OperationsCostSheetWriteSaveInput): Promise<OperationsCostSheetWriteResult> {
    const input = OperationsCostSheetWriteSaveInputSchema.parse(raw), requestHash = operationsCostSheetOperationRequestHash(input);
    let captured: Pick<Session, "identity" | "scope"> | null = null;
    try { return await session(ctx, input, async current => {
      captured = { identity: current.identity, scope: current.scope };
      if (!enabled()) fail("NOT_ENABLED"); await authorize(current, "update");
      if (!(await schema(current.tx)).base) fail("SCHEMA_NOT_READY");
      const loaded = await state(current), log = operationJournal(current, input.operationId), existing = await log.read();
      if (existing.final) {
        if (existing.final.requestHash !== null && existing.final.requestHash !== requestHash) fail("OPERATION_CONFLICT", "CONFLICT");
        return OperationsCostSheetWriteResultSchema.parse(existing.final.receipt);
      }
      await lockScopeCollisions(current);
      const snapshotKey = snapshot(loaded); if (snapshotKey === null) fail("SOURCE_OR_SAVED_UNAVAILABLE");
      validateOperationsCostSheetWriteAgainstReadResult(input, loaded.readResult, snapshotKey);
      const text = JSON.stringify(input.payload), old = loaded.readResult.saved;
      let result: unknown;
      try {
        result = old ? await current.tx.execute(costSheetSql(`UPDATE ops_cost_sheets SET payload=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${costSheetScopedWhere("workspace_id", "country")} AND version=?`, [text, current.identity.userId, old.id, ...costSheetScopeParams(current.scope), input.expectedVersion]))
          : await current.tx.execute(costSheetSql("INSERT INTO ops_cost_sheets (workspace_id,parent_asin,store_name,country,payload,version,updated_by,updated_at) VALUES (?,?,?,?,?,1,?,CURRENT_TIMESTAMP)", [...costSheetScopeParams(current.scope), text, current.identity.userId]));
      } catch (error) { if (errorCode(error, "ER_DUP_ENTRY")) fail("SCOPE_OR_VERSION_CONFLICT", "CONFLICT"); throw error; }
      const header = Array.isArray(result) ? result[0] : null;
      if (!header || typeof header !== "object" || header.affectedRows !== 1 || !old && !id(header.insertId)) fail("WRITE_CONFLICT", "CONFLICT");
      const verified = await state(current), saved = verified.readResult.saved, nextSnapshotKey = snapshot(verified);
      if (verified.readResult.status !== "saved" || !saved || saved.version !== input.expectedVersion + 1 || saved.updatedBy !== current.identity.userId || saved.id !== (old?.id ?? header.insertId) || JSON.stringify(saved.payload) !== text || nextSnapshotKey === null) fail("WRITE_UNVERIFIABLE");
      return log.finalize(OperationsCostSheetWriteResultSchema.parse({ identity: current.identity, scope: current.scope, operationId: input.operationId, status: "committed", version: saved.version, snapshotKey: nextSnapshotKey, reasonCode: null }), requestHash);
    }); } catch (error) {
      if (error instanceof TRPCError || error instanceof OperationsCostSheetWriteError || error instanceof CostSheetJournalError) return safeError(error);
      if (captured) return unknown(captured, input.operationId);
      return safeError(error);
    }
  }
  async function recover(ctx: TrpcContext, raw: OperationsCostSheetWriteRecoverInput): Promise<OperationsCostSheetWriteResult> {
    const input = OperationsCostSheetWriteRecoverInputSchema.parse(raw); let captured: Pick<Session, "identity" | "scope"> | null = null;
    try { return await session(ctx, input, async current => {
      captured = { identity: current.identity, scope: current.scope };
      // Current scope ownership is checked even for an old successful receipt.
      await state(current);
      if (!(await schema(current.tx)).journalReady) fail("JOURNAL_SCHEMA_NOT_READY");
      const log = operationJournal(current, input.operationId), existing = await log.read();
      if (existing.final) return OperationsCostSheetWriteResultSchema.parse(existing.final.receipt);
      // A deployment rollback stops saves, not a final cancellation fence.
      if (input.decision === "cancel") return log.cancel();
      return unknown(current, input.operationId);
    }); } catch (error) { if (error instanceof TRPCError || error instanceof OperationsCostSheetWriteError || error instanceof CostSheetJournalError) return safeError(error); if (captured) return unknown(captured, input.operationId); return safeError(error); }
  }
  return { options, save, recover };
}
export const costSheetWriteRepository = createCostSheetWriteRepository();
