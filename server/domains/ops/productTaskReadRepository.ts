import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { ProductTaskListInputSchema, ProductTaskDetailInputSchema, ProductTaskReadError,
  buildProductTaskListResult, buildProductTaskDetailResult, buildProductTaskReadFailure,
  type ProductTaskListInput, type ProductTaskDetailInput, type ProductTaskListResult, type ProductTaskDetailResult, type ProductTaskReadSource } from "../../../shared/productTaskRead";

type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; all: boolean; assigneeIds: number[] };
type Table = "team_tasks" | "product_profiles" | "ops_task_attachments";
export interface ProductTaskReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const TASK_LIMIT = 5000, WIRE_BYTES_MAX = 8 * 1024 * 1024, ROW_BYTES_MAX = 128 * 1024, CHUNK = 200;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message: `PRODUCT_TASK_READ_${message}` }); }
class MissingSource extends Error {}
class InvalidSource extends Error {}
class IncompleteSource extends Error {}
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
  if (parts.length !== values.length + 1) fail("SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function query(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("RESPONSE_INVALID");
  return result[0] as Row[];
}
async function columns(tx: DbExecutor, table: Table): Promise<Set<string> | null> {
  const records = await query(tx, "SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  if (records.length > 200 || records.some(row => typeof row.columnName !== "string") || new Set(records.map(row => row.columnName)).size !== records.length) fail("SCHEMA_INVALID");
  if (records.length) return new Set(records.map(row => row.columnName as string));
  // A hidden catalog is not proof that a business table is missing. Only the
  // exact table probe's ER_NO_SUCH_TABLE can establish an unavailable source.
  try { await query(tx, `SELECT 1 AS probe FROM ${table} LIMIT 0`); }
  catch (error) { if (noSuchTable(error)) return null; throw error; }
  fail("SCHEMA_UNAVAILABLE");
}
function required(known: Set<string> | null, names: string[]) {
  if (!known) return false;
  if (names.some(name => !known.has(name))) fail("SCHEMA_UNAVAILABLE");
  return true;
}
function chunks<T>(items: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += CHUNK) result.push(items.slice(i, i + CHUNK)); return result; }
const permissionName = z.string().min(1).max(100).refine(value => value === value.trim());
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(values => new Set(values).size === values.length);
const permissionDetails = z.array(z.object({ moduleId: permissionName, operations, subModules: z.array(z.object({ subModuleId: permissionName, operations }).strict()).max(100).refine(values => new Set(values.map(item => item.subModuleId)).size === values.length).optional() }).strict()).max(100).refine(values => new Set(values.map(item => item.moduleId)).size === values.length);
function permissionJson(value: unknown): unknown {
  if (typeof value !== "string") {
    try { if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 65536) fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN"); }
    catch { return fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN"); }
    return value;
  }
  if (Buffer.byteLength(value, "utf8") > 65536) fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN");
  try { return JSON.parse(value); } catch { return fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN"); }
}
async function assertTaskDirectory(tx: DbExecutor, role: string, workspaceId: number) {
  if (role === "super_admin") return;
  const records = await query(tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [role, workspaceId]);
  if (records.length > 2 || new Set(records.map(row => row.workspaceId)).size !== records.length || records.some(row => !positiveId(row.id) || row.role !== role || row.workspaceId !== null && row.workspaceId !== workspaceId)) fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN");
  const selected = records.find(row => row.workspaceId === workspaceId) ?? records.find(row => row.workspaceId === null);
  if (!selected) { if (!ROLE_MODULE_ACCESS[role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return; }
  const modules = z.array(permissionName).max(100).refine(values => new Set(values).size === values.length).safeParse(permissionJson(selected.modules));
  const details = selected.detailedPermissions === null ? null : permissionDetails.safeParse(permissionJson(selected.detailedPermissions));
  if (!modules.success || details !== null && !details.success) fail("DIRECTORY_POLICY_INVALID", "FORBIDDEN");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = details?.success ? details.data.find(item => item.moduleId === "ops") : undefined;
  if (!module) return;
  // Match usePermissions inheritance, with both required directory reads.
  // Explicit access-policy allow must not bypass an ops_tasks directory deny.
  for (const subModuleId of ["ops_dashboard", "ops_tasks"]) {
    const sub = module.subModules?.find(item => item.subModuleId === subModuleId);
    if (!(sub?.operations ?? module.operations).includes("read")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  }
}
const taskFields = { productProfileId: "product_profile_id", creatorId: "user_id", title: "title", description: "description", status: "task_status", priority: "task_priority_team", category: "category", assigneeId: "assignee_id", assigneeName: "assignee_name", startDate: "start_date", dueDate: "due_date", estimatedHours: "estimated_hours", actualHours: "actual_hours", tags: "tags" };
const taskTextFields = ["title", "description", "task_status", "task_priority_team", "category", "assignee_name", "start_date", "due_date", "estimated_hours", "actual_hours", "tags"];
const byteExpression = (fields: string[]) => fields.map(field => `COALESCE(OCTET_LENGTH(CAST(${field} AS CHAR CHARACTER SET utf8mb4)),0)`).join("+");
const timestamp = (field: string, alias = field) => `DATE_FORMAT(${field},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
function textBytes(values: unknown[]) {
  if (values.some(value => value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))) throw new InvalidSource();
  return values.reduce<number>((sum, value) => sum + (value === null ? 0 : Buffer.byteLength(String(value), "utf8")), 0);
}
type SourceData = Omit<ProductTaskReadSource, "input">;
type Capabilities = ProductTaskReadSource["capabilities"];
function emptyCapabilities(): Capabilities {
  return { completionNotes: "unavailable", boardProduct: "unavailable", profiles: "unavailable", attachments: "unavailable", partners: "unavailable" };
}
const canReadTask = (session: Session, row: Row) => row.workspaceId === session.identity.workspaceId && (session.all || typeof row.assigneeId === "number" && session.assigneeIds.includes(row.assigneeId));
async function load(session: Session, taskId?: number): Promise<SourceData> {
  const taskColumns = await columns(session.tx, "team_tasks"), capabilities = emptyCapabilities();
  if (!taskColumns) throw new MissingSource();
  required(taskColumns, ["id", "workspaceId", ...Object.values(taskFields), "completed_at", "createdAt", "updatedAt"]);
  capabilities.completionNotes = taskColumns.has("completion_notes") ? "available" : "unavailable";
  capabilities.boardProduct = taskColumns.has("board_product") ? "available" : "unavailable";
  const wireFields = [...taskTextFields, ...(capabilities.completionNotes === "available" ? ["completion_notes"] : []), ...(capabilities.boardProduct === "available" ? ["board_product"] : [])];
  const size = byteExpression(wireFields);
  const scope = `workspaceId=?${session.all ? "" : ` AND assignee_id IN (${session.assigneeIds.map(() => "?").join(",")})`}${taskId === undefined ? "" : " AND id=?"}`;
  const params: unknown[] = [session.identity.workspaceId, ...(session.all ? [] : session.assigneeIds), ...(taskId === undefined ? [] : [taskId])];
  // Freeze the authorized candidate identities before loading bodies. All
  // filters/counts are subsequently computed from this complete fixed set.
  const candidates = await query(session.tx, `SELECT id,workspaceId,assignee_id AS assigneeId,${timestamp("createdAt")},${size} AS bodyBytes FROM team_tasks WHERE ${scope} ORDER BY createdAt DESC,id DESC LIMIT ${TASK_LIMIT + 1} FOR SHARE`, params);
  if (candidates.length > TASK_LIMIT) throw new IncompleteSource();
  if (new Set(candidates.map(row => row.id)).size !== candidates.length || candidates.some((row, index) => !positiveId(row.id) || !canReadTask(session, row)
    || typeof row.createdAt !== "string" || index > 0 && (String(row.createdAt) > String(candidates[index - 1].createdAt) || row.createdAt === candidates[index - 1].createdAt && Number(row.id) >= Number(candidates[index - 1].id))
    || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0 || row.bodyBytes > ROW_BYTES_MAX || taskId !== undefined && row.id !== taskId)) throw new InvalidSource();
  let bytes = candidates.reduce((sum, row) => sum + Number(row.bodyBytes), 0);
  if (bytes > WIRE_BYTES_MAX) throw new IncompleteSource();
  const tasks: ProductTaskReadSource["tasks"] = [];
  const conditional = (available: boolean, field: string, alias: string) => available ? `CAST(${field} AS CHAR CHARACTER SET utf8mb4) AS ${alias}` : `NULL AS ${alias}`;
  for (const group of chunks(candidates)) {
    const found = await query(session.tx, `SELECT id,workspaceId,${Object.entries(taskFields).map(([alias, field]) => `${field} AS ${alias}`).join(",")},
      ${timestamp("createdAt")},${timestamp("updatedAt")},${timestamp("completed_at", "completedAt")},
      ${conditional(capabilities.completionNotes === "available", "completion_notes", "completionNotes")},${conditional(capabilities.boardProduct === "available", "board_product", "boardProduct")},${size} AS bodyBytes
      FROM team_tasks WHERE ${scope} AND id IN (${group.map(() => "?").join(",")}) ORDER BY createdAt DESC,id DESC LIMIT ${CHUNK + 1} FOR SHARE`, [...params, ...group.map(row => row.id)]);
    if (found.length !== group.length || new Set(found.map(row => row.id)).size !== found.length) throw new InvalidSource();
    for (const row of found) {
      const candidate = group.find(item => item.id === row.id);
      if (!candidate || !canReadTask(session, row) || row.assigneeId !== candidate.assigneeId || row.createdAt !== candidate.createdAt || row.bodyBytes !== candidate.bodyBytes
        || textBytes([...Object.entries(taskFields).filter(([, field]) => taskTextFields.includes(field)).map(([alias]) => row[alias]), row.completionNotes, row.boardProduct]) !== row.bodyBytes) throw new InvalidSource();
      const { bodyBytes: _bodyBytes, ...task } = row;
      tasks.push(task as ProductTaskReadSource["tasks"][number]);
    }
  }
  const profileColumns = await columns(session.tx, "product_profiles"), profileFields = ["id", "workspaceId", "parent_asin", "store_name", "marketplace", "title", "chinese_name", "image_url"];
  capabilities.profiles = profileColumns && profileFields.every(field => profileColumns.has(field)) ? "available" : "unavailable";
  const profiles: ProductTaskReadSource["profiles"] = [];
  if (capabilities.profiles === "available") {
    const profileIds = [...new Set(tasks.map(row => row.productProfileId).filter(positiveId))];
    for (const group of chunks(profileIds)) {
      const profileSize = byteExpression(["p.parent_asin", "p.store_name", "p.marketplace", "p.title", "p.chinese_name", "p.image_url"]);
      const profileCandidates = await query(session.tx, `SELECT p.id,p.workspaceId,${profileSize} AS bodyBytes FROM product_profiles p WHERE p.workspaceId=? AND p.id IN (${group.map(() => "?").join(",")}) ORDER BY p.id LIMIT ${CHUNK + 1} FOR SHARE`, [session.identity.workspaceId, ...group]);
      if (profileCandidates.length > group.length || new Set(profileCandidates.map(row => row.id)).size !== profileCandidates.length || profileCandidates.some(row => !positiveId(row.id) || !group.includes(row.id) || row.workspaceId !== session.identity.workspaceId
        || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0 || row.bodyBytes > ROW_BYTES_MAX)) throw new InvalidSource();
      bytes += profileCandidates.reduce((sum, row) => sum + Number(row.bodyBytes), 0); if (bytes > WIRE_BYTES_MAX) throw new IncompleteSource();
      if (!profileCandidates.length) continue;
      const found = await query(session.tx, `SELECT p.id,p.workspaceId,p.parent_asin AS parentAsin,p.store_name AS storeName,p.marketplace AS site,p.title,p.chinese_name AS chineseName,
        IF(${profileSize}<=${ROW_BYTES_MAX},p.image_url,NULL) AS imageUrl,${profileSize} AS bodyBytes
        FROM product_profiles p WHERE p.workspaceId=? AND p.id IN (${profileCandidates.map(() => "?").join(",")}) ORDER BY p.id LIMIT ${CHUNK + 1} FOR SHARE`, [session.identity.workspaceId, ...profileCandidates.map(row => row.id)]);
      if (found.length !== profileCandidates.length || new Set(found.map(row => row.id)).size !== found.length) throw new InvalidSource();
      for (const row of found) {
        const candidate = profileCandidates.find(item => item.id === row.id);
        if (!candidate || row.workspaceId !== session.identity.workspaceId || row.bodyBytes !== candidate.bodyBytes
          || textBytes([row.parentAsin, row.storeName, row.site, row.title, row.chineseName, row.imageUrl]) !== row.bodyBytes) throw new InvalidSource();
        const { bodyBytes: _bodyBytes, ...profile } = row; profiles.push(profile as ProductTaskReadSource["profiles"][number]);
      }
    }
  }
  const attachmentColumns = await columns(session.tx, "ops_task_attachments"), attachmentFields = ["id", "workspace_id", "task_id", "file_name", "byte_size", "uploaded_by", "created_at"];
  capabilities.attachments = attachmentColumns && attachmentFields.every(field => attachmentColumns.has(field)) ? "available" : "unavailable";
  const attachments: ProductTaskReadSource["attachments"] = [];
  if (capabilities.attachments === "available" && tasks.length) {
    const taskIds = tasks.map(row => row.id), nameSize = "OCTET_LENGTH(CAST(a.file_name AS CHAR CHARACTER SET utf8mb4))";
    const attachmentScope = `a.workspace_id=? AND t.workspaceId=? AND t.id IN (${taskIds.map(() => "?").join(",")})${session.all ? "" : ` AND t.assignee_id IN (${session.assigneeIds.map(() => "?").join(",")})`}`;
    const attachmentParams = [session.identity.workspaceId, session.identity.workspaceId, ...taskIds, ...(session.all ? [] : session.assigneeIds)];
    const attachmentCandidates = await query(session.tx, `SELECT a.id,a.workspace_id AS workspaceId,a.task_id AS taskId,${timestamp("a.created_at", "createdAt")},${nameSize} AS nameBytes
      FROM ops_task_attachments a JOIN team_tasks t ON t.id=a.task_id AND t.workspaceId=a.workspace_id
      WHERE ${attachmentScope} ORDER BY a.created_at ASC,a.id ASC LIMIT ${TASK_LIMIT + 1} FOR SHARE`, attachmentParams);
    if (attachmentCandidates.length > TASK_LIMIT) throw new IncompleteSource();
    if (new Set(attachmentCandidates.map(row => row.id)).size !== attachmentCandidates.length || attachmentCandidates.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || !positiveId(row.taskId) || !taskIds.includes(row.taskId)
      || typeof row.createdAt !== "string" || typeof row.nameBytes !== "number" || !Number.isSafeInteger(row.nameBytes) || row.nameBytes < 1 || row.nameBytes > 2000)) throw new InvalidSource();
    bytes += attachmentCandidates.reduce((sum, row) => sum + Number(row.nameBytes), 0); if (bytes > WIRE_BYTES_MAX) throw new IncompleteSource();
    for (const group of chunks(attachmentCandidates)) {
      const found = await query(session.tx, `SELECT a.id,a.workspace_id AS workspaceId,a.task_id AS taskId,IF(${nameSize}<=2000,CAST(a.file_name AS CHAR CHARACTER SET utf8mb4),NULL) AS name,${nameSize} AS nameBytes,a.byte_size AS byteSize,a.uploaded_by AS uploadedBy,${timestamp("a.created_at", "createdAt")}
        FROM ops_task_attachments a JOIN team_tasks t ON t.id=a.task_id AND t.workspaceId=a.workspace_id
        WHERE ${attachmentScope} AND a.id IN (${group.map(() => "?").join(",")}) ORDER BY a.created_at ASC,a.id ASC LIMIT ${CHUNK + 1} FOR SHARE`, [...attachmentParams, ...group.map(row => row.id)]);
      if (found.length !== group.length || new Set(found.map(row => row.id)).size !== found.length) throw new InvalidSource();
      for (const row of found) {
        const candidate = group.find(item => item.id === row.id);
        if (!candidate || row.workspaceId !== session.identity.workspaceId || row.taskId !== candidate.taskId || row.createdAt !== candidate.createdAt || row.nameBytes !== candidate.nameBytes
          || typeof row.name !== "string" || row.name.length > 500 || Buffer.byteLength(row.name, "utf8") !== row.nameBytes) throw new InvalidSource();
        const { nameBytes: _nameBytes, ...attachment } = row; attachments.push(attachment as ProductTaskReadSource["attachments"][number]);
      }
    }
    if (new Set(attachments.map(row => row.id)).size !== attachments.length) throw new InvalidSource();
  }
  return { identity: session.identity, access: { all: session.all, assigneeIds: session.assigneeIds }, capabilities, tasks, profiles, attachments, complete: true };
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^PRODUCT_TASK_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN");
  fail("FAILED", "INTERNAL_SERVER_ERROR");
}

/** Current saved tasks only. No task creation, assignment, mutations, object
 * resolution, directory expansion, financial queries or scheduler invocation. */
export function createProductTaskReadRepository(dependencies: { database?: () => Promise<ProductTaskReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function read(ctx: TrpcContext, raw: ProductTaskListInput, kind: "list"): Promise<ProductTaskListResult>;
  async function read(ctx: TrpcContext, raw: ProductTaskDetailInput, kind: "detail"): Promise<ProductTaskDetailResult>;
  async function read(ctx: TrpcContext, raw: ProductTaskListInput | ProductTaskDetailInput, kind: "list" | "detail") {
    try {
      if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = kind === "list" ? ProductTaskListInputSchema.safeParse(raw) : ProductTaskDetailInputSchema.safeParse(raw);
      if (!parsed.success) fail("INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        await assertTaskDirectory(tx, actor.role as string, workspaceId);
        const session: Session = { tx, identity: { userId: actor.id as number, workspaceId }, all: ["admin", "super_admin"].includes(actor.role as string), assigneeIds: [actor.id as number] };
        function failure(status: "missing" | "invalid", reasonCode: string, missingReason: string) {
          const base = { identity: session.identity, status, reasonCode, missingReason, capabilities: emptyCapabilities() };
          return kind === "list" ? buildProductTaskReadFailure({ ...base, input: input as ProductTaskListInput, kind: "list" }) : buildProductTaskReadFailure({ ...base, input: input as ProductTaskDetailInput, kind: "detail" });
        }
        try {
          const source = await load(session, kind === "detail" ? (input as ProductTaskDetailInput).taskId : undefined);
          return kind === "list" ? buildProductTaskListResult({ ...source, input: input as ProductTaskListInput }) : buildProductTaskDetailResult({ ...source, input: input as ProductTaskDetailInput });
        } catch (error) {
          if (error instanceof MissingSource) return failure("missing", "table_missing", "运营任务来源表尚未接通，不表示没有任务");
          if (error instanceof IncompleteSource) return failure("invalid", "source_incomplete", "完整授权任务或附件超出有界读取范围；不截断、不以当前页冒充全部统计");
          if (error instanceof InvalidSource || error instanceof ProductTaskReadError || error instanceof z.ZodError) return failure("invalid", "invalid_source", "任务来源、身份或附件元数据无法完整核验；不返回部分数据");
          throw error;
        }
      });
    } catch (error) { return sanitized(error); }
  }
  return {
    list: (ctx: TrpcContext, input: ProductTaskListInput) => read(ctx, input, "list"),
    detail: (ctx: TrpcContext, input: ProductTaskDetailInput) => read(ctx, input, "detail"),
  };
}
export const productTaskReadRepository = createProductTaskReadRepository();
