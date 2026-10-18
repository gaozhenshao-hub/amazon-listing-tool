import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { buildProductTaskDetailResult, type ProductTaskReadSource, type ProductTaskSourceRecord } from "../../../shared/productTaskRead";
import { productTaskProductKey, type ProductTaskWriteExecuteInput } from "../../../shared/productTaskWrite";
import { createProductTaskWriteRepository } from "./productTaskWriteRepository";
import { createProductTaskAttachmentStorage } from "./productTaskAttachmentStorage";

type Row = Record<string, any>;
const time = "2026-10-18 10:20:30.000000", operationId = "11111111-1111-4111-8111-111111111111", op2 = "22222222-2222-4222-8222-222222222222";
const ctx = (role = "ops_specialist") => ({ user: { id: 3, role, defaultWorkspaceId: 7 }, workspaceId: 7 }) as TrpcContext;
const task = (patch: Partial<ProductTaskSourceRecord> = {}): ProductTaskSourceRecord => ({ id: 11, workspaceId: 7, creatorId: 3, productProfileId: null, title: "待办", description: "保留说明", status: "todo", priority: "medium", category: "原类型", assigneeId: 3, assigneeName: "成员3", startDate: null, dueDate: null, completedAt: null, estimatedHours: null, actualHours: null, tags: null, createdAt: time, updatedAt: time, completionNotes: null, boardProduct: null, ...patch });
const member = (id: number, patch: Row = {}) => ({ membershipId: id + 20, workspaceId: 7, userId: id, membershipStatus: "active", id, status: "active", name: `成员${id}`, ...patch });
const create: Extract<ProductTaskWriteExecuteInput, { action: "create" }> = { expectedWorkspaceId: 7, operationId, action: "create", title: "完整通用任务", assigneeId: 3, category: "原生自定义类型", status: "review", dueDate: "2026-10-19", productKey: null };
let actors: Row[], members: Row[], tasks: ProductTaskSourceRecord[], files: Row[], audit: Row[], queries: { sql: string; params: unknown[] }[], enabled: boolean, commitLost: boolean, journalFailure: boolean, denied: string[], engines: Row[], indexes: Row[], schemas: Record<string, Row[]>;
const col = (columnName: string, patch: Row = {}) => ({ columnName, isNullable: "YES", dataType: "int", columnType: "int", extra: "", maxLength: null, defaultValue: null, ...patch });
const index = (tableName: string, indexName: string, columnName: string) => ({ tableName, indexName, columnName, nonUnique: 0, sequence: 1, prefixLength: null });
const permission = vi.fn(async ({ resource, action }: { resource: string; action: string }) => { if (denied.includes(`${resource}.${action}`)) throw new TRPCError({ code: "FORBIDDEN", message: "Denied" }); });
const directory = vi.fn(async () => {});
const loadSource = vi.fn(async (session: Row, taskId?: number): Promise<Omit<ProductTaskReadSource, "input">> => ({ identity: session.identity, access: { all: session.all, assigneeIds: session.assigneeIds }, capabilities: { completionNotes: "available", boardProduct: "available", profiles: "available", attachments: "available", partners: "unavailable" }, tasks: tasks.filter(row => row.workspaceId === session.identity.workspaceId && (!taskId || row.id === taskId) && (session.all || session.assigneeIds.includes(row.assigneeId))), profiles: [], attachments: files.filter(row => row.taskId === taskId).map(({ storageUri: _uri, ...row }) => row) as ProductTaskReadSource["attachments"], complete: true }));
const candidate = (() => { const value = { identity: { workspaceId: 7, parentAsin: "B000000001", storeName: "Exact Store", country: "US" }, profileId: null, source: "saihu" as const, sourceId: 22, sourceMode: "legacy_weekly" as const, versionKey: "c".repeat(64), title: "源产品", chineseName: null, imageUrl: null }; return { ...value, key: productTaskProductKey(value) }; })();
const candidates = vi.fn(async () => ({ items: [candidate], capabilities: { profiles: "available" as const, saihu: "available" as const, mappings: "available" as const, manualOwners: "available" as const }, complete: false }));
const storage = createProductTaskAttachmentStorage({ assertPrivate: () => {}, provider: () => "s3", configured: () => true });
storage.putOnce = vi.fn(async () => {}); storage.verify = vi.fn(async () => {}); storage.download = vi.fn(async () => ({ url: "https://private.example.test/short", expiresSeconds: 60 }));
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query); const q = query.sql, p = query.params;
  if (q.includes("FROM users WHERE")) return [actors, []];
  if (q.includes("FROM workspace_memberships")) return [members.filter(row => row.workspaceId === p[0] && (p.length === 1 || p.slice(1).includes(row.id))), []];
  if (q.includes("FROM information_schema.COLUMNS")) return [schemas[String(p[0])] ?? [], []];
  if (q.includes("FROM information_schema.TABLES")) return [engines, []];
  if (q.includes("FROM information_schema.STATISTICS")) return [indexes, []];
  if (q.startsWith("SELECT 1 AS probe")) throw { code: "ER_NO_SUCH_TABLE" };
  if (q.startsWith("SELECT id,workspaceId,user_id AS creatorId")) return [tasks.filter(row => row.workspaceId === p[0] && row.id === p[1]).map(({ id, workspaceId, creatorId, assigneeId }) => ({ id, workspaceId, creatorId, assigneeId })), []];
  if (q.includes("FROM security_audit_logs")) return [audit.filter(row => p.includes(row.auditId)), []];
  if (q.startsWith("INSERT INTO security_audit_logs")) {
    if (journalFailure) throw new Error("journal write failed");
    if (audit.some(row => row.auditId === p[0])) throw new Error("duplicate audit");
    audit.push({ auditId: p[0], workspaceId: p[1], actorUserId: p[2], actorRole: p[3], action: p[4], resourceType: "ops_task_operation", resourceId: p[5], status: "success", metadataText: p[6] }); return [{ affectedRows: 1, insertId: audit.length }, []];
  }
  if (q.startsWith("INSERT INTO team_tasks")) {
    const id = Math.max(0, ...tasks.map(row => row.id)) + 1; tasks.push(task({ id, workspaceId: p[0] as number, productProfileId: p[1] as number | null, creatorId: p[2] as number, title: p[3] as string, status: p[4] as string, category: p[5] as string | null, assigneeId: p[6] as number, assigneeName: p[7] as string, dueDate: p[8] as string | null, completedAt: p[9] === "done" ? time : null, boardProduct: p[10] })); return [{ affectedRows: 1, insertId: id }, []];
  }
  if (q.startsWith("UPDATE team_tasks SET")) {
    const target = tasks.find(row => row.workspaceId === p.at(-2) && row.id === p.at(-1))!; let offset = 0;
    for (const [column, field] of [["title", "title"], ["category", "category"], ["due_date", "dueDate"], ["completion_notes", "completionNotes"]] as const) if (q.includes(`${column}=?`)) (target as Row)[field] = p[offset++];
    if (q.includes("task_status=?")) { const status = p[offset++] as string; target.completedAt = status === "done" ? target.completedAt ?? time : null; target.status = p[offset] as string; }
    return [{ affectedRows: 1 }, []];
  }
  if (q.startsWith("INSERT INTO ops_task_attachments")) {
    const id = Math.max(30, ...files.map(row => row.id)) + 1; files.push({ id, workspaceId: p[0], taskId: p[1], name: p[2], byteSize: p[3], storageUri: p[4], uploadedBy: p[5], createdAt: time }); return [{ affectedRows: 1, insertId: id }, []];
  }
  if (q.startsWith("SELECT ") && q.includes("FROM ops_task_attachments WHERE")) return [files.filter(row => row.workspaceId === p[0] && row.taskId === p[1] && row.id === p[2]), []];
  if (q.startsWith("DELETE FROM ops_task_attachments")) { const count = files.length; files = files.filter(row => !(row.workspaceId === p[0] && row.taskId === p[1] && row.id === p[2])); return [{ affectedRows: count - files.length }, []]; }
  throw new Error(`Unmocked ${q}`);
});
const tx = { execute };
const transaction = vi.fn(async <T>(body: (executor: typeof tx) => Promise<T>) => { const saved = structuredClone({ tasks, files, audit }); let value: T; try { value = await body(tx); } catch (error) { ({ tasks, files, audit } = saved); throw error; } if (commitLost) { commitLost = false; throw new Error("commit acknowledgement lost"); } return value; });
const repo = createProductTaskWriteRepository({ database: async () => ({ transaction }), permission: permission as never, directory, loadSource, candidates, storage, enabled: () => enabled });
async function version(id = 11, all = false) { const source = await loadSource({ identity: { userId: 3, workspaceId: 7 }, all, assigneeIds: [3] }, id); return buildProductTaskDetailResult({ ...source, input: { expectedWorkspaceId: 7, taskId: id, attachmentCursor: null, attachmentLimit: 1 } }).task!.versionKey; }
const update = async (patch: Row = {}, id = 11) => ({ expectedWorkspaceId: 7, operationId, action: "update" as const, taskId: id, expectedVersion: await version(id), patch: { title: "更新", ...patch } });
const upload = async () => ({ expectedWorkspaceId: 7, operationId, action: "upload" as const, taskId: 11, expectedVersion: await version(), name: "凭证.txt", base64: "eA==" });
beforeEach(() => {
  vi.clearAllMocks(); actors = [{ id: 3, role: "ops_specialist", status: "active", defaultWorkspaceId: 7 }]; members = [member(3), member(4)]; tasks = [task()]; files = []; audit = []; queries = []; enabled = true; commitLost = false; journalFailure = false; denied = ["ops_task.assign"];
  schemas = {
    team_tasks: ["workspaceId", "user_id", "title", "task_status", "task_priority_team", "category", "assignee_id", "assignee_name", "due_date", "completed_at", "createdAt", "updatedAt", "completion_notes", "board_product", "product_profile_id", "reminder_enabled"].map(name => col(name)),
    ops_task_attachments: ["workspace_id", "task_id", "file_name", "byte_size", "storage_ref", "uploaded_by", "created_at"].map(name => col(name)),
    security_audit_logs: ["auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"].map(name => col(name)),
  };
  for (const name of ["team_tasks", "ops_task_attachments"]) schemas[name].push(col("id", { extra: "auto_increment" }));
  Object.assign(schemas.team_tasks.find(row => row.columnName === "title")!, { dataType: "varchar", maxLength: 200 }); Object.assign(schemas.team_tasks.find(row => row.columnName === "task_status")!, { columnType: "enum('backlog','todo','in_progress','review','done')" }); Object.assign(schemas.team_tasks.find(row => row.columnName === "board_product")!, { dataType: "json" }); Object.assign(schemas.team_tasks.find(row => row.columnName === "completion_notes")!, { dataType: "text" });
  Object.assign(schemas.ops_task_attachments.find(row => row.columnName === "file_name")!, { dataType: "varchar", maxLength: 200 }); Object.assign(schemas.security_audit_logs.find(row => row.columnName === "auditId")!, { maxLength: 80 });
  engines = ["team_tasks", "ops_task_attachments", "security_audit_logs"].map(tableName => ({ tableName, engine: "InnoDB" })); indexes = [index("team_tasks", "PRIMARY", "id"), index("ops_task_attachments", "PRIMARY", "id"), index("security_audit_logs", "audit_id_unique", "auditId")];
  vi.mocked(storage.putOnce).mockResolvedValue(); vi.mocked(storage.verify).mockResolvedValue(); candidates.mockResolvedValue({ items: [candidate], capabilities: { profiles: "available", saihu: "available", mappings: "available", manualOwners: "available" }, complete: false });
});
describe("real task mutation transaction and row authorization", () => {
  it("defaults disabled with explicit options and no mutation or candidate read", async () => { enabled = false; expect(await repo.options(ctx(), { expectedWorkspaceId: 7 })).toMatchObject({ members: [], capabilities: { create: { status: "unavailable", reasonCode: "not_enabled_before_release" } } }); await expect(repo.execute(ctx(), create)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(tasks).toHaveLength(1); expect(audit).toEqual([]); expect(candidates).not.toHaveBeenCalled(); });
  it("creates a genuine unlinked five-state task plus same-transaction receipt without reminders", async () => { const result = await repo.execute(ctx(), create); expect(result).toMatchObject({ status: "committed", action: "create", taskId: 12 }); expect(tasks[1]).toMatchObject({ productProfileId: null, boardProduct: null, status: "review", category: create.category }); expect(audit).toHaveLength(1); expect(queries.find(query => query.sql.startsWith("INSERT INTO team_tasks"))?.sql).toContain("ELSE NULL END,0,?,NULL"); expect(queries.some(query => /ALTER TABLE|CREATE TABLE|sync|monthly_profit/iu.test(query.sql))).toBe(false); });
  it("enforces current actor, membership, exact expected workspace and real transactions", async () => {
    await expect(repo.execute(ctx(), { ...create, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" }); actors[0].role = "admin"; await expect(repo.execute(ctx(), create)).rejects.toMatchObject({ code: "FORBIDDEN" }); actors[0].role = "ops_specialist"; members[0].membershipStatus = "disabled"; await expect(repo.execute(ctx(), create)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(tasks).toHaveLength(1);
    const noTx = createProductTaskWriteRepository({ database: async () => ({}) }); await expect(noTx.execute(ctx(), create)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("strictly checks independent task actions with no owner bypass or ops_data.update", async () => { await repo.execute(ctx(), create); expect(permission.mock.calls.some(([input]) => input.resource === "ops_data" && input.action !== "read")).toBe(false); for (const [input] of permission.mock.calls) { expect(input).not.toHaveProperty("ownerUserId"); expect(input).toMatchObject({ authorizationRead: { executor: tx, strict: true, lock: true } }); } denied.push("ops_task.update"); await expect(repo.execute(ctx(), await update())).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("assigning another member requires assign and does not grant creator later read/update", async () => {
    await expect(repo.execute(ctx(), { ...create, assigneeId: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" }); denied = []; actors[0].role = "ops_manager";
    const receipt = await repo.execute(ctx("ops_manager"), { ...create, assigneeId: 4 }); expect(receipt.status).toBe("committed"); expect(tasks[1].assigneeId).toBe(4);
    await expect(repo.execute(ctx("ops_manager"), { expectedWorkspaceId: 7, operationId: op2, action: "update", taskId: 12, expectedVersion: receipt.taskVersion!, patch: { title: "不能借creator修改" } })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(tasks[1].title).toBe(create.title);
  });
  it("inactive target and duplicated active memberships fail closed", async () => { denied = []; members[1].status = "disabled"; await expect(repo.execute(ctx(), { ...create, assigneeId: 4 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); members.push(member(3, { membershipId: 90 })); await expect(repo.options(ctx(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); });
  it("ops_manager cannot write another task even when assign allowed; admin can", async () => { tasks[0].assigneeId = 4; actors[0].role = "ops_manager"; denied = []; const command = { expectedWorkspaceId: 7, operationId, action: "update" as const, taskId: 11, expectedVersion: await version(11, true), patch: { title: "管理" } }; await expect(repo.execute(ctx("ops_manager"), command)).rejects.toMatchObject({ code: "NOT_FOUND" }); actors[0].role = "admin"; expect((await repo.execute(ctx("admin"), command)).status).toBe("committed"); });
  it("uses full version including unchanged-second content and attachments", async () => { const command = await update(); tasks[0].description = "同秒被另一人改变"; await expect(repo.execute(ctx(), command)).rejects.toMatchObject({ code: "CONFLICT" }); expect(audit).toEqual([]); });
  it("preserves description/legacy fields and updates done time including reopening", async () => { expect((await repo.execute(ctx(), await update({ status: "done", completionNotes: "完成说明" }))).status).toBe("committed"); expect(tasks[0]).toMatchObject({ description: "保留说明", completedAt: time, completionNotes: "完成说明", status: "done" }); expect((await repo.execute(ctx(), { ...await update({ status: "review" }), operationId: op2 })).status).toBe("committed"); expect(tasks[0].completedAt).toBeNull(); });
  it("rejects merged row oversize before mutation even if individual notes fit", async () => { tasks[0].description = "a".repeat(65000); tasks[0].tags = "b".repeat(60000); await expect(repo.execute(ctx(), await update({ completionNotes: "c".repeat(10000) }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(tasks[0].completionNotes).toBeNull(); });
  it("retains exact source-only legacy product snapshot and refuses a stale candidate key", async () => { await expect(repo.execute(ctx(), { ...create, productKey: "f".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" }); expect((await repo.execute(ctx(), { ...create, productKey: candidate.key })).status).toBe("committed"); expect(JSON.parse(tasks[1].boardProduct as string)).toMatchObject({ id: null, sourceMode: "legacy_weekly", storeName: "Exact Store", site: "US" }); });
});
describe("durable journal replay, rollback and cancellation fence", () => {
  it("replays once, rejects UUID content reuse, and rolls back business write if receipt fails", async () => { const first = await repo.execute(ctx(), create); expect(await repo.execute(ctx(), create)).toEqual(first); expect(tasks).toHaveLength(2); await expect(repo.execute(ctx(), { ...create, title: "不同内容" })).rejects.toMatchObject({ code: "CONFLICT" }); journalFailure = true; expect((await repo.execute(ctx(), { ...create, operationId: op2 })).status).toBe("unknown"); expect(tasks).toHaveLength(2); });
  it("commit acknowledgement loss returns unknown then same-operation recover proves committed", async () => { commitLost = true; expect((await repo.execute(ctx(), create)).status).toBe("unknown"); expect(tasks).toHaveLength(2); expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "check" })).status).toBe("committed"); expect(tasks).toHaveLength(2); });
  it("receipt absence remains unknown, while cancel writes durable fence even when deployment disabled", async () => { expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "check" })).status).toBe("unknown"); enabled = false; expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "cancel" })).status).toBe("cancelled"); enabled = true; expect((await repo.execute(ctx(), create)).status).toBe("cancelled"); expect(tasks).toHaveLength(1); });
  it("rechecks user status/membership before every replay and recovery", async () => { await repo.execute(ctx(), create); actors[0].status = "disabled"; await expect(repo.execute(ctx(), create)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
});
describe("prepared upload, explicit recovery and authorized short download", () => {
  it("performs one prepared PUT and finalize; metadata changes full task version", async () => { const command = await upload(), result = await repo.execute(ctx(), command); expect(result).toMatchObject({ status: "committed", action: "upload", attachmentId: 31 }); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(storage.verify).toHaveBeenCalledTimes(1); expect(audit).toHaveLength(2); expect(result.taskVersion).not.toBe(command.expectedVersion); expect(await repo.execute(ctx(), command)).toEqual(result); expect(storage.putOnce).toHaveBeenCalledTimes(1); });
  it("prepare commit uncertainty does not PUT and cannot be retried implicitly", async () => { const command = await upload(); commitLost = true; expect((await repo.execute(ctx(), command)).status).toBe("unknown"); expect(storage.putOnce).not.toHaveBeenCalled(); expect((await repo.execute(ctx(), command)).status).toBe("unknown"); expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "check" })).status).toBe("unknown"); expect(storage.putOnce).not.toHaveBeenCalled(); });
  it("a lost PUT outcome only explicitly verifies/finalizes, never PUT again", async () => { vi.mocked(storage.putOnce).mockRejectedValueOnce(new Error("lost PUT ack")); const command = await upload(); expect((await repo.execute(ctx(), command)).status).toBe("unknown"); expect(files).toEqual([]); expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "complete_upload" })).status).toBe("committed"); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(files).toHaveLength(1); });
  it("cancel prepared when disabled and block late explicit completion", async () => { vi.mocked(storage.putOnce).mockRejectedValueOnce(new Error("uncertain")); await repo.execute(ctx(), await upload()); enabled = false; expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "cancel" })).status).toBe("cancelled"); enabled = true; expect((await repo.recover(ctx(), { expectedWorkspaceId: 7, operationId, decision: "complete_upload" })).status).toBe("cancelled"); expect(files).toEqual([]); expect(storage.putOnce).toHaveBeenCalledTimes(1); });
  it("upload finalization rejects changed owner/version after PUT", async () => { vi.mocked(storage.verify).mockImplementationOnce(async () => { tasks[0].title = "另一个修改"; }); await expect(repo.execute(ctx(), await upload())).rejects.toMatchObject({ code: "CONFLICT" }); expect(files).toEqual([]); expect(audit).toHaveLength(1); });
  it("download and delete independently authorize exact task/attachment and leave private object intact", async () => {
    await repo.execute(ctx(), await upload()); const receipt = await repo.download(ctx(), { expectedWorkspaceId: 7, taskId: 11, attachmentId: 31 }); expect(receipt.expiresSeconds).toBe(60); expect(JSON.stringify(receipt)).not.toContain("storage://");
    await expect(repo.download(ctx(), { expectedWorkspaceId: 7, taskId: 12, attachmentId: 31 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repo.execute(ctx(), { expectedWorkspaceId: 7, operationId: op2, action: "deleteAttachment", taskId: 11, attachmentId: 31, expectedVersion: await version() })).status).toBe("committed"); expect(files).toEqual([]); expect(tasks).toHaveLength(1); expect(queries.some(query => query.sql.startsWith("DELETE FROM team_tasks"))).toBe(false);
  });
});
describe("actual schema capability and source disclosure", () => {
  it.each(["missing_extension", "not_nullable", "no_unique_audit", "audit_prefix_unique", "myisam", "status_three", "no_auto_increment", "short_title"])("rejects incompatible runtime structure: %s", async failure => {
    if (failure === "missing_extension") schemas.team_tasks = schemas.team_tasks.filter(row => row.columnName !== "board_product");
    if (failure === "not_nullable") schemas.team_tasks.find(row => row.columnName === "product_profile_id")!.isNullable = "NO";
    if (failure === "no_unique_audit") indexes = indexes.filter(row => row.tableName !== "security_audit_logs");
    if (failure === "audit_prefix_unique") indexes[2].prefixLength = 10;
    if (failure === "myisam") engines[0].engine = "MyISAM";
    if (failure === "status_three") schemas.team_tasks.find(row => row.columnName === "task_status")!.columnType = "enum('todo','in_progress','done')";
    if (failure === "no_auto_increment") schemas.team_tasks.find(row => row.columnName === "id")!.extra = "";
    if (failure === "short_title") schemas.team_tasks.find(row => row.columnName === "title")!.maxLength = 100;
    expect((await repo.options(ctx(), { expectedWorkspaceId: 7 })).capabilities.create.status).toBe("unavailable"); await expect(repo.execute(ctx(), create)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(audit).toEqual([]); expect(tasks).toHaveLength(1);
  });
  it("exposes only self to unprivileged users and legacy partial source explicitly", async () => { expect((await repo.options(ctx(), { expectedWorkspaceId: 7 })).members).toEqual([{ id: 3, displayName: "成员3" }]); const result = await repo.products(ctx(), { expectedWorkspaceId: 7, assigneeId: 3, search: "Exact", offset: 0, limit: 20 }); expect(result).toMatchObject({ coverage: "partial", items: [{ sourceMode: "legacy_weekly" }], page: { total: 1 } }); await expect(repo.products(ctx(), { expectedWorkspaceId: 7, assigneeId: 4, search: "", offset: 0, limit: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("unavailable owner source does not present empty products as complete", async () => { candidates.mockResolvedValueOnce({ items: [], capabilities: { profiles: "available", saihu: "available", mappings: "available", manualOwners: "unavailable" }, complete: false }); const result = await repo.products(ctx(), { expectedWorkspaceId: 7, assigneeId: 3, search: "", offset: 0, limit: 20 }); expect(result).toMatchObject({ availability: { status: "unavailable" }, coverage: "unavailable", page: { total: null }, viewKey: null }); });
});
