import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction, type SecurityAction } from "../../services/securityGovernance";
import { buildProductTaskDetailResult, type ProductTaskReadItem } from "../../../shared/productTaskRead";
import {
  ProductTaskWriteOptionsInputSchema, ProductTaskWriteOptionsResultSchema, ProductTaskWriteProductsInputSchema, ProductTaskWriteProductsResultSchema,
  ProductTaskWriteExecuteInputSchema, ProductTaskWriteRecoverInputSchema, ProductTaskWriteDownloadInputSchema, ProductTaskWriteDownloadResultSchema, ProductTaskWriteResultSchema,
  productTaskWriteHash,
  type ProductTaskWriteOptionsInput, type ProductTaskWriteProductsInput, type ProductTaskWriteExecuteInput, type ProductTaskWriteRecoverInput, type ProductTaskWriteDownloadInput,
  type ProductTaskWriteResult, type ProductTaskWriteCapabilities, type ProductTaskWriteCapability, type ProductTaskWriteProduct,
} from "../../../shared/productTaskWrite";
import { loadProductTaskReadSource, strictTaskDirectory, type ProductTaskReadSession } from "./productTaskReadRepository";
import { loadTaskWriteCandidates, taskWriteColumns, taskWriteMembers, taskWriteRows, taskWriteSql, taskWriteFail, taskWriteId } from "./productTaskWriteCandidates";
import { createProductTaskOperationJournal, productTaskOperationRequestHash, type ProductTaskPreparedUpload } from "./productTaskOperationJournal";
import { createProductTaskAttachmentStorage } from "./productTaskAttachmentStorage";

type Session = ProductTaskReadSession & { actor: { id: number; role: string; defaultWorkspaceId: number } };
export interface ProductTaskWriteDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const available = (): ProductTaskWriteCapability => ({ status: "available", reasonCode: null });
const unavailable = (reasonCode: string): ProductTaskWriteCapability => ({ status: "unavailable", reasonCode });
const actionPermission = (action: ProductTaskWriteExecuteInput["action"]): SecurityAction => action === "deleteAttachment" ? "delete" : action;
function safeError(error: unknown): never {
  if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"].includes(error.code)) throw error;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PRODUCT_TASK_WRITE_UNAVAILABLE" });
}
export function createProductTaskWriteRepository(deps: {
  database?: () => Promise<ProductTaskWriteDatabase | null>;
  permission?: typeof assertResourceAction;
  directory?: typeof strictTaskDirectory;
  loadSource?: typeof loadProductTaskReadSource;
  candidates?: typeof loadTaskWriteCandidates;
  journal?: typeof createProductTaskOperationJournal;
  storage?: ReturnType<typeof createProductTaskAttachmentStorage>;
  enabled?: () => boolean;
} = {}) {
  const database = deps.database ?? getDb, permission = deps.permission ?? assertResourceAction, directory = deps.directory ?? strictTaskDirectory,
    loadSource = deps.loadSource ?? loadProductTaskReadSource, candidates = deps.candidates ?? loadTaskWriteCandidates,
    journal = deps.journal ?? createProductTaskOperationJournal, storage = deps.storage ?? createProductTaskAttachmentStorage(),
    enabled = deps.enabled ?? (() => process.env.ENABLE_MERGED_OPS_TASK_WRITES === "true");

  async function session<T>(ctx: TrpcContext, expectedWorkspaceId: number, body: (value: Session) => Promise<T>): Promise<T> {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "PRODUCT_TASK_WRITE_LOGIN_REQUIRED" });
    const workspaceId = ctx.workspaceId ?? ctx.user.defaultWorkspaceId;
    if (!taskWriteId(ctx.user.id) || !taskWriteId(workspaceId) || workspaceId !== expectedWorkspaceId) taskWriteFail("WORKSPACE_CHANGED", "FORBIDDEN");
    const db = await database(); if (!db || typeof db.transaction !== "function") taskWriteFail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      // Serializes every execute/recover for this actor, including cancellation
      // fences racing a request whose original connection had an unknown result.
      const actors = await taskWriteRows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [ctx.user!.id]), actor = actors[0];
      if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) taskWriteFail("ACTOR_CHANGED", "FORBIDDEN");
      if (!(await taskWriteMembers(tx, workspaceId, [actor.id as number])).some(member => member.id === actor.id)) taskWriteFail("MEMBERSHIP_REQUIRED", "FORBIDDEN");
      const current: Session = { tx, actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, identity: { userId: actor.id as number, workspaceId }, all: ["admin", "super_admin"].includes(actor.role as string), assigneeIds: [actor.id as number] };
      await permission({ actor: current.actor, workspaceId, resource: "ops_data", action: "read", authorizationRead: { executor: tx, strict: true, lock: true } });
      await directory(tx, current.actor.role, workspaceId);
      await authorize(current, "read");
      return body(current);
    });
  }
  async function authorize(current: Session, action: SecurityAction) {
    await permission({ actor: current.actor, workspaceId: current.identity.workspaceId, resource: "ops_task", action, authorizationRead: { executor: current.tx, strict: true, lock: true } });
    await directory(current.tx, current.actor.role, current.identity.workspaceId, ["read", "export"].includes(action) ? "read" : action === "delete" ? "delete" : "edit");
  }
  function deployment() { if (!enabled()) taskWriteFail("NOT_ENABLED"); }
  async function capability(current: Session, action: SecurityAction): Promise<ProductTaskWriteCapability> {
    try { await authorize(current, action); return available(); } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") return unavailable("permission_denied"); throw error; }
  }
  async function schema(current: Session) {
    const [task, attachments, audit] = await Promise.all([taskWriteColumns(current.tx, "team_tasks"), taskWriteColumns(current.tx, "ops_task_attachments"), taskWriteColumns(current.tx, "security_audit_logs")]);
    const engines = await taskWriteRows(current.tx, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('team_tasks','ops_task_attachments','security_audit_logs')");
    const indexes = await taskWriteRows(current.tx, "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('team_tasks','ops_task_attachments','security_audit_logs') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
    if (engines.length > 3 || new Set(engines.map(row => row.tableName)).size !== engines.length || indexes.length > 200 || indexes.some(row => typeof row.tableName !== "string" || typeof row.indexName !== "string" || typeof row.columnName !== "string" || ![0, 1].includes(row.nonUnique as number) || !taskWriteId(row.sequence))) taskWriteFail("SCHEMA_INVALID");
    const innodb = (table: string) => engines.some(row => row.tableName === table && row.engine === "InnoDB");
    const unique = (table: string, column: string, primary = false) => indexes.some(row => row.tableName === table && row.columnName === column && row.nonUnique === 0 && row.sequence === 1 && row.prefixLength === null && (!primary || row.indexName === "PRIMARY") && indexes.filter(other => other.tableName === table && other.indexName === row.indexName).length === 1);
    const noExtraRequired = (columns: typeof task, supplied: string[]) => !!columns && [...columns].every(([name, value]) => supplied.includes(name) || value.nullable || value.defaultValue != null || value.extra.toLowerCase().includes("auto_increment") || value.extra.toLowerCase().includes("generated"));
    const taskSupplied = ["workspaceId", "product_profile_id", "user_id", "title", "task_status", "task_priority_team", "category", "assignee_id", "assignee_name", "due_date", "completed_at", "reminder_enabled", "board_product", "completion_notes"];
    const attachmentSupplied = ["workspace_id", "task_id", "file_name", "byte_size", "storage_ref", "uploaded_by"];
    const base = innodb("team_tasks") && unique("team_tasks", "id", true) && task?.get("id")?.extra.toLowerCase() === "auto_increment"
      && ["id", "workspaceId", "user_id", "title", "task_status", "task_priority_team", "category", "assignee_id", "assignee_name", "due_date", "completed_at", "createdAt", "updatedAt", "completion_notes", "board_product", "product_profile_id", "reminder_enabled"].every(field => task?.has(field))
      && task.get("title")!.dataType === "varchar" && Number(task.get("title")!.maxLength) >= 200
      && task.get("task_status")!.columnType === "enum('backlog','todo','in_progress','review','done')"
      && task.get("board_product")!.dataType === "json" && task.get("board_product")!.nullable
      && ["text", "mediumtext", "longtext"].includes(task.get("completion_notes")!.dataType) && task.get("completion_notes")!.nullable
      && ["id", "workspaceId", "user_id", "assignee_id", "product_profile_id", "reminder_enabled"].every(name => task.get(name)!.dataType === "int")
      && noExtraRequired(task, taskSupplied);
    const attachment = innodb("ops_task_attachments") && unique("ops_task_attachments", "id", true) && attachments?.get("id")?.extra.toLowerCase() === "auto_increment"
      && ["id", "workspace_id", "task_id", "file_name", "byte_size", "storage_ref", "uploaded_by", "created_at"].every(field => attachments?.has(field))
      && attachments.get("file_name")!.dataType === "varchar" && Number(attachments.get("file_name")!.maxLength) >= 200
      && ["id", "workspace_id", "task_id", "byte_size", "uploaded_by"].every(name => attachments.get(name)!.dataType === "int") && noExtraRequired(attachments, attachmentSupplied);
    const auditSupplied = ["auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"];
    const journalReady = innodb("security_audit_logs") && unique("security_audit_logs", "auditId") && auditSupplied.every(field => audit?.has(field)) && Number(audit?.get("auditId")?.maxLength) >= 78 && noExtraRequired(audit, auditSupplied);
    return { base: Boolean(base && journalReady), unlinked: Boolean(base && journalReady && task!.get("product_profile_id")!.nullable), attachment: Boolean(attachment), journalReady };
  }
  async function writable(current: Session, action: ProductTaskWriteExecuteInput["action"]) {
    deployment(); await authorize(current, actionPermission(action));
    const state = await schema(current); if (!state.base || action === "create" && !state.unlinked || ["upload", "deleteAttachment"].includes(action) && !state.attachment) taskWriteFail("SCHEMA_NOT_READY");
  }
  async function assignee(current: Session, id: number) {
    if (id !== current.identity.userId) await authorize(current, "assign");
    const members = await taskWriteMembers(current.tx, current.identity.workspaceId, [id]); if (members.length !== 1) taskWriteFail("ASSIGNEE_UNAVAILABLE", "BAD_REQUEST"); return members[0];
  }
  async function lockTask(current: Session, taskId: number, createdReceipt = false) {
    const rows = await taskWriteRows(current.tx, "SELECT id,workspaceId,user_id AS creatorId,assignee_id AS assigneeId FROM team_tasks WHERE workspaceId=? AND id=? FOR UPDATE", [current.identity.workspaceId, taskId]), row = rows[0];
    if (rows.length !== 1 || row.id !== taskId || row.workspaceId !== current.identity.workspaceId || !current.all && row.assigneeId !== current.identity.userId && !(createdReceipt && row.creatorId === current.identity.userId)) taskWriteFail("TASK_NOT_FOUND", "NOT_FOUND");
    if (createdReceipt && row.assigneeId !== current.identity.userId) { if (!taskWriteId(row.assigneeId)) taskWriteFail("TASK_NOT_FOUND", "NOT_FOUND"); await assignee(current, row.assigneeId); }
    return row;
  }
  async function item(current: Session, taskId: number, ownCreation = false): Promise<ProductTaskReadItem> {
    const source = await loadSource(ownCreation ? { ...current, all: true } : current, taskId);
    const result = buildProductTaskDetailResult({ ...source, input: { expectedWorkspaceId: current.identity.workspaceId, taskId, attachmentCursor: null, attachmentLimit: 1 } });
    if (result.status !== "ready" || !result.task) taskWriteFail("TASK_SOURCE_INVALID"); return result.task;
  }
  async function currentVersion(current: Session, taskId: number, expectedVersion: string) {
    await lockTask(current, taskId); const value = await item(current, taskId); if (value.versionKey !== expectedVersion) taskWriteFail("VERSION_CONFLICT", "CONFLICT"); return value;
  }
  async function checkUpdatedBody(current: Session, taskId: number, patch: Extract<ProductTaskWriteExecuteInput, { action: "update" }>["patch"]) {
    const source = await loadSource(current, taskId), record = source.tasks.find(task => task.id === taskId);
    if (!record || !source.complete) taskWriteFail("TASK_SOURCE_INVALID");
    const next = { ...record, ...patch };
    const values = [next.title, next.description, next.status, next.priority, next.category, next.assigneeName, next.startDate, next.dueDate, next.estimatedHours, next.actualHours, next.tags, next.completionNotes, typeof next.boardProduct === "string" || next.boardProduct === null ? next.boardProduct : JSON.stringify(next.boardProduct)];
    const bytes = values.reduce<number>((sum, value) => sum + (value == null ? 0 : Buffer.byteLength(String(value), "utf8")), 0);
    if (bytes > 128 * 1024) taskWriteFail("TASK_BODY_TOO_LARGE", "BAD_REQUEST");
  }
  function operationJournal(current: Session, operationId: string) { return journal(current.tx, { ...current.identity, operationId, actorRole: current.actor.role }); }
  function unknown(identity: Session["identity"], operationId: string, reasonCode: string, action: ProductTaskWriteResult["action"] = null, taskId: number | null = null): ProductTaskWriteResult {
    return ProductTaskWriteResultSchema.parse({ identity, operationId, action, status: "unknown", taskId, attachmentId: null, taskVersion: null, reasonCode });
  }
  async function replay(current: Session, receipt: ProductTaskWriteResult, requireWritePermission = true) {
    if (receipt.status === "committed") {
      if (requireWritePermission) await authorize(current, actionPermission(receipt.action!));
      await lockTask(current, receipt.taskId!, receipt.action === "create");
    }
    return ProductTaskWriteResultSchema.parse(receipt);
  }
  async function insertId(current: Session, text: string, params: unknown[]) {
    const result = await current.tx.execute(taskWriteSql(text, params)), header = Array.isArray(result) ? result[0] : null;
    if (!header || typeof header !== "object" || !taskWriteId(header.insertId) || header.affectedRows !== 1) taskWriteFail("INSERT_UNVERIFIABLE"); return header.insertId as number;
  }
  async function change(current: Session, text: string, params: unknown[], allowNoop = false) {
    const result = await current.tx.execute(taskWriteSql(text, params)), header = Array.isArray(result) ? result[0] : null;
    if (!header || typeof header !== "object" || header.affectedRows !== 1 && !(allowNoop && header.affectedRows === 0)) taskWriteFail("WRITE_CONFLICT", "CONFLICT");
  }
  async function attachment(current: Session, taskId: number, attachmentId: number) {
    const rows = await taskWriteRows(current.tx, "SELECT id,workspace_id AS workspaceId,task_id AS taskId,file_name AS name,byte_size AS byteSize,IF(OCTET_LENGTH(storage_ref)<=4000,storage_ref,NULL) AS storageUri FROM ops_task_attachments WHERE workspace_id=? AND task_id=? AND id=? FOR UPDATE", [current.identity.workspaceId, taskId, attachmentId]), row = rows[0];
    if (rows.length !== 1 || row.id !== attachmentId || row.workspaceId !== current.identity.workspaceId || row.taskId !== taskId || typeof row.name !== "string" || typeof row.storageUri !== "string") taskWriteFail("ATTACHMENT_NOT_FOUND", "NOT_FOUND"); return row;
  }
  async function finalizeUpload(ctx: TrpcContext, prepared: ProductTaskPreparedUpload) {
    return session(ctx, prepared.identity.workspaceId, async current => {
      await writable(current, "upload"); const log = operationJournal(current, prepared.operationId), state = await log.read();
      if (state.final) { if (state.final.requestHash !== null && state.final.requestHash !== prepared.requestHash) taskWriteFail("OPERATION_CONFLICT", "CONFLICT"); return replay(current, state.final.receipt); }
      if (!state.prepared || productTaskWriteHash(state.prepared) !== productTaskWriteHash(prepared)) taskWriteFail("UPLOAD_PREPARE_CHANGED", "CONFLICT");
      await currentVersion(current, prepared.taskId, prepared.expectedVersion);
      const attachmentId = await insertId(current, "INSERT INTO ops_task_attachments (workspace_id,task_id,file_name,byte_size,storage_ref,uploaded_by) VALUES (?,?,?,?,?,?)", [current.identity.workspaceId, prepared.taskId, prepared.name, prepared.byteSize, prepared.storageUri, current.identity.userId]);
      const updated = await item(current, prepared.taskId);
      return log.finalize({ identity: current.identity, operationId: prepared.operationId, action: "upload", status: "committed", taskId: prepared.taskId, attachmentId, taskVersion: updated.versionKey, reasonCode: null }, prepared.requestHash);
    });
  }
  async function options(ctx: TrpcContext, raw: ProductTaskWriteOptionsInput) {
    const input = ProductTaskWriteOptionsInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      const keys = ["create", "update", "upload", "deleteAttachment", "download", "partners"] as const;
      if (!enabled()) return ProductTaskWriteOptionsResultSchema.parse({ identity: current.identity, members: [], capabilities: Object.fromEntries(keys.map(key => [key, unavailable("not_enabled_before_release")])) });
      const state = await schema(current), capabilities: ProductTaskWriteCapabilities = { create: state.base && state.unlinked ? await capability(current, "create") : unavailable("schema_not_ready"), update: state.base ? await capability(current, "update") : unavailable("schema_not_ready"), upload: state.base && state.attachment ? await capability(current, "upload") : unavailable("schema_not_ready"), deleteAttachment: state.base && state.attachment ? await capability(current, "delete") : unavailable("schema_not_ready"), download: state.base && state.attachment ? await capability(current, "export") : unavailable("schema_not_ready"), partners: unavailable("numeric_partner_source_unavailable") };
      try { storage.assertAvailable(); } catch { capabilities.upload = unavailable("private_storage_unavailable"); capabilities.download = unavailable("private_storage_unavailable"); }
      const mayAssign = await capability(current, "assign"), members = await taskWriteMembers(current.tx, current.identity.workspaceId, mayAssign.status === "available" ? undefined : [current.identity.userId]);
      return ProductTaskWriteOptionsResultSchema.parse({ identity: current.identity, members, capabilities });
    }); } catch (error) { return safeError(error); }
  }
  async function products(ctx: TrpcContext, raw: ProductTaskWriteProductsInput) {
    const input = ProductTaskWriteProductsInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      deployment(); await authorize(current, "create"); await assignee(current, input.assigneeId);
      const source = await candidates(current.tx, current.identity.workspaceId, input.assigneeId);
      const candidateCapability = (value: string, reason: string) => value === "available" ? available() : unavailable(reason);
      const capabilities = { profiles: candidateCapability(source.capabilities.profiles, "profile_source_unavailable"), saihuLatest: candidateCapability(source.capabilities.saihu, "saihu_source_unavailable"), numericMappings: candidateCapability(source.capabilities.mappings, "numeric_mapping_source_unavailable"), manualOwners: candidateCapability(source.capabilities.manualOwners, "manual_owner_source_unavailable"), members: available() };
      const usable = capabilities.manualOwners.status === "available" && (capabilities.profiles.status === "available" || capabilities.saihuLatest.status === "available");
      const search = input.search.trim().toLocaleLowerCase(), filtered = source.items.filter(value => !search || [value.title, value.chineseName, value.identity.parentAsin, value.identity.storeName, value.identity.country].some(field => field?.toLocaleLowerCase().includes(search)));
      const items = usable ? filtered.slice(input.offset, input.offset + input.limit) : [], total = usable ? filtered.length : null, hasMore = total !== null && input.offset + items.length < total;
      return ProductTaskWriteProductsResultSchema.parse({ identity: current.identity, request: input, availability: usable ? available() : unavailable("candidate_sources_unavailable"), capabilities, coverage: !usable ? "unavailable" : source.complete ? "complete" : "partial", viewKey: usable ? productTaskWriteHash({ identity: current.identity, assigneeId: input.assigneeId, source, search }) : null, items, page: { offset: input.offset, limit: input.limit, total, hasMore, nextOffset: hasMore ? input.offset + items.length : null } });
    }); } catch (error) { return safeError(error); }
  }
  async function execute(ctx: TrpcContext, raw: ProductTaskWriteExecuteInput): Promise<ProductTaskWriteResult> {
    const input = ProductTaskWriteExecuteInputSchema.parse(raw), requestHash = productTaskOperationRequestHash(input);
    let captured: Session["identity"] | null = null;
    try {
      const result = await session(ctx, input.expectedWorkspaceId, async current => {
        captured = current.identity; await writable(current, input.action);
        const log = operationJournal(current, input.operationId), state = await log.read();
        if (state.final) { if (state.final.requestHash !== null && state.final.requestHash !== requestHash) taskWriteFail("OPERATION_CONFLICT", "CONFLICT"); return { receipt: await replay(current, state.final.receipt) }; }
        if (state.prepared) {
          if (input.action !== "upload" || state.prepared.requestHash !== requestHash) taskWriteFail("OPERATION_CONFLICT", "CONFLICT");
          await lockTask(current, state.prepared.taskId);
          return { receipt: unknown(current.identity, input.operationId, "upload_prepared_explicit_recovery_required", "upload", state.prepared.taskId) };
        }
        if (input.action === "upload") {
          await currentVersion(current, input.taskId, input.expectedVersion);
          const planned = storage.plan(current.identity, input), prepared = await log.prepare(planned.prepared);
          return prepared.created ? { upload: planned } : { receipt: unknown(current.identity, input.operationId, "upload_prepared_explicit_recovery_required", "upload", input.taskId) };
        }
        let taskId: number, attachmentId: number | null = null;
        if (input.action === "create") {
          const member = await assignee(current, input.assigneeId); let product: ProductTaskWriteProduct | null = null;
          if (input.productKey) { const source = await candidates(current.tx, current.identity.workspaceId, input.assigneeId); product = source.items.find(value => value.key === input.productKey) ?? null; if (!product) taskWriteFail("PRODUCT_CHANGED", "CONFLICT"); }
          const snapshot = product ? JSON.stringify({ workspaceId: current.identity.workspaceId, key: product.key, id: product.profileId, parentAsin: product.identity.parentAsin, storeName: product.identity.storeName, site: product.identity.country, title: product.title, chineseName: product.chineseName, imageUrl: product.imageUrl, source: product.source, sourceId: product.sourceId, sourceMode: product.sourceMode, versionKey: product.versionKey }) : null;
          if (Buffer.byteLength(snapshot ?? "", "utf8") > 256 * 1024 || [input.title, input.status, "medium", input.category, member.displayName, input.dueDate, snapshot].reduce((sum, value) => sum + Buffer.byteLength(value ?? "", "utf8"), 0) > 128 * 1024) taskWriteFail("TASK_BODY_TOO_LARGE", "BAD_REQUEST");
          taskId = await insertId(current, "INSERT INTO team_tasks (workspaceId,product_profile_id,user_id,title,task_status,task_priority_team,category,assignee_id,assignee_name,due_date,completed_at,reminder_enabled,board_product,completion_notes) VALUES (?,?,?,?,?,'medium',?,?,?,?,CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE NULL END,0,?,NULL)", [current.identity.workspaceId, product?.profileId ?? null, current.identity.userId, input.title, input.status, input.category, member.id, member.displayName, input.dueDate, input.status, snapshot]);
        } else {
          taskId = input.taskId; await currentVersion(current, taskId, input.expectedVersion);
          if (input.action === "update") {
            if (input.patch.completionNotes && Buffer.byteLength(input.patch.completionNotes, "utf8") > 65535) taskWriteFail("NOTES_TOO_LARGE", "BAD_REQUEST");
            await checkUpdatedBody(current, taskId, input.patch);
            const fields: string[] = [], values: unknown[] = [];
            for (const [key, column] of Object.entries({ title: "title", category: "category", dueDate: "due_date", completionNotes: "completion_notes" }) as [keyof typeof input.patch, string][]) if (input.patch[key] !== undefined) { fields.push(`${column}=?`); values.push(input.patch[key]); }
            if (input.patch.status !== undefined) { fields.push("completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END", "task_status=?"); values.push(input.patch.status, input.patch.status); }
            await change(current, `UPDATE team_tasks SET ${fields.join(",")} WHERE workspaceId=? AND id=?`, [...values, current.identity.workspaceId, taskId], true);
          } else {
            await attachment(current, taskId, input.attachmentId); attachmentId = input.attachmentId;
            await change(current, "DELETE FROM ops_task_attachments WHERE workspace_id=? AND task_id=? AND id=?", [current.identity.workspaceId, taskId, attachmentId]);
          }
        }
        const updated = await item(current, taskId, input.action === "create");
        return { receipt: await log.finalize({ identity: current.identity, operationId: input.operationId, action: input.action, status: "committed", taskId, attachmentId, taskVersion: updated.versionKey, reasonCode: null }, requestHash) };
      });
      if (result.receipt) return result.receipt;
      if (!result.upload) taskWriteFail("UPLOAD_PLAN_INVALID");
      // A prepared operation is durable before the one permitted PUT. Neither
      // repeat execute nor recover(check) can automatically upload again.
      await storage.putOnce(result.upload.prepared, result.upload.bytes);
      await storage.verify(result.upload.prepared);
      return await finalizeUpload(ctx, result.upload.prepared);
    } catch (error) {
      if (error instanceof TRPCError) return safeError(error);
      if (captured) return unknown(captured, input.operationId, "outcome_unknown_check_same_operation", input.action, "taskId" in input ? input.taskId : null);
      return safeError(error);
    }
  }
  async function recover(ctx: TrpcContext, raw: ProductTaskWriteRecoverInput): Promise<ProductTaskWriteResult> {
    const input = ProductTaskWriteRecoverInputSchema.parse(raw); let captured: Session["identity"] | null = null;
    try {
      const result = await session(ctx, input.expectedWorkspaceId, async current => {
        captured = current.identity; if (!(await schema(current)).journalReady) taskWriteFail("JOURNAL_SCHEMA_NOT_READY"); const log = operationJournal(current, input.operationId), state = await log.read();
        if (state.final) return { receipt: await replay(current, state.final.receipt, false) };
        if (state.prepared) await lockTask(current, state.prepared.taskId);
        // The rollback switch stops new business writes, not cancellation
        // fences or learning the result of an already-issued operation.
        if (input.decision === "cancel") return { receipt: await log.cancel() };
        if (input.decision === "complete_upload" && state.prepared) { await writable(current, "upload"); await currentVersion(current, state.prepared.taskId, state.prepared.expectedVersion); return { prepared: state.prepared }; }
        return { receipt: unknown(current.identity, input.operationId, state.prepared ? "upload_prepared_explicit_recovery_required" : "no_final_receipt_outcome_unknown", state.prepared ? "upload" : null, state.prepared?.taskId ?? null) };
      });
      if (result.receipt) return result.receipt;
      if (!result.prepared) taskWriteFail("UPLOAD_PLAN_INVALID");
      await storage.verify(result.prepared); // Never PUT during recovery.
      return await finalizeUpload(ctx, result.prepared);
    } catch (error) { if (error instanceof TRPCError) return safeError(error); if (captured) return unknown(captured, input.operationId, "outcome_unknown_check_same_operation"); return safeError(error); }
  }
  async function download(ctx: TrpcContext, raw: ProductTaskWriteDownloadInput) {
    const input = ProductTaskWriteDownloadInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      deployment(); await authorize(current, "export"); await lockTask(current, input.taskId);
      if (!(await schema(current)).attachment) taskWriteFail("SCHEMA_NOT_READY");
      const file = await attachment(current, input.taskId, input.attachmentId), signed = await storage.download({ workspaceId: current.identity.workspaceId, taskId: input.taskId, storageUri: file.storageUri as string });
      return ProductTaskWriteDownloadResultSchema.parse({ identity: current.identity, taskId: input.taskId, attachmentId: input.attachmentId, name: file.name, ...signed });
    }); } catch (error) { return safeError(error); }
  }
  return { options, products, execute, recover, download };
}
export const productTaskWriteRepository = createProductTaskWriteRepository();
