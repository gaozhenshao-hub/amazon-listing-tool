import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createProductTaskReadRepository, strictTaskDirectory } from "./productTaskReadRepository";
import type { DbExecutor } from "../../repositories/dbClient";

type Row = Record<string, unknown>;
const time = "2026-10-18 10:20:30.000000";
const input = { expectedWorkspaceId: 7, product: null, association: "all" as const, assigneeId: null, unassignedOnly: false, status: null, category: null, search: "", groupBy: "none" as const, cursor: null, limit: 20 };
const detailInput = { expectedWorkspaceId: 7, taskId: 11, attachmentCursor: null, attachmentLimit: 20 };
const ctx = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7 }, workspaceId: 7, ...patch }) as TrpcContext;
const product = { workspaceId: 7, storeName: "Exact Store", country: "US", parentAsin: "B000000001" };
const task = (patch: Row = {}): Row => ({ id: 11, workspaceId: 7, creatorId: 8, productProfileId: 21, title: "原始任务<script>secret</script>", description: "完整说明", status: "todo", priority: "medium", category: "旧自定义类型", assigneeId: 3, assigneeName: "原始负责人", startDate: "2026-10-01", dueDate: "2026-10-19", completedAt: null, estimatedHours: "2.5", actualHours: null, tags: "[\"原始标签\"]", createdAt: time, updatedAt: time, completionNotes: "完整完成情况", boardProduct: null, ...patch });
const profile = (patch: Row = {}): Row => ({ id: 21, workspaceId: 7, parentAsin: product.parentAsin, storeName: product.storeName, site: "美国站", title: "产品名称", chineseName: "中文名称", imageUrl: "https://example.test/safe.png", ...patch });
const attachment = (patch: Row = {}): Row => ({ id: 31, workspaceId: 7, taskId: 11, name: "证据.xlsx", byteSize: 100, uploadedBy: 3, createdAt: time, ...patch });
const roleOverride = (patch: Row = {}): Row => ({ id: 1, role: "ops_manager", workspaceId: 7, modules: '["ops"]', detailedPermissions: null, ...patch });
const taskColumns = ["id", "workspaceId", "product_profile_id", "user_id", "title", "description", "task_status", "task_priority_team", "category", "assignee_id", "assignee_name", "start_date", "due_date", "completed_at", "estimated_hours", "actual_hours", "tags", "createdAt", "updatedAt", "completion_notes", "board_product"];
const profileColumns = ["id", "workspaceId", "parent_asin", "store_name", "marketplace", "title", "chinese_name", "image_url"];
const attachmentColumns = ["id", "workspace_id", "task_id", "file_name", "byte_size", "uploaded_by", "created_at"];
let actors: Row[], tasks: Row[], profiles: Row[], attachments: Row[], overrides: Row[], policies: Row[];
let schema: Record<string, string[]>, absent: Set<string>, failures: Record<string, unknown>, queries: { sql: string; params: unknown[] }[], afterCandidates: (() => void) | null, afterAttachmentCandidates: (() => void) | null;
let candidatesOverride: Row[] | null, bodiesOverride: Row[] | null, profileOverride: Row[] | null, attachmentsOverride: Row[] | null, commits: number, rollbacks: number;
const bytes = (values: unknown[]) => values.reduce<number>((sum, value) => sum + (value === null || value === undefined ? 0 : Buffer.byteLength(String(value), "utf8")), 0);
const taskBytes = (row: Row) => bytes([row.title, row.description, row.status, row.priority, row.category, row.assigneeName, row.startDate, row.dueDate, row.estimatedHours, row.actualHours, row.tags, ...(schema.team_tasks.includes("completion_notes") ? [row.completionNotes] : []), ...(schema.team_tasks.includes("board_product") ? [row.boardProduct] : [])]);
const profileBytes = (row: Row) => bytes([row.parentAsin, row.storeName, row.site, row.title, row.chineseName, row.imageUrl]);
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  for (const table of ["users", "role_permissions", "security_access_policies", "team_tasks", "product_profiles", "ops_task_attachments", "information_schema.COLUMNS"]) if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM role_permissions")) {
    const found = overrides.filter(row => row.role === query.params[0] && (row.workspaceId === query.params[1] || row.workspaceId === null)).sort((a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null) || Number(b.id) - Number(a.id));
    return [found.slice(0, query.sql.includes("LIMIT 3") ? 3 : 1), []];
  }
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM information_schema.COLUMNS")) return [(schema[String(query.params[0])] ?? []).map(columnName => ({ columnName })), []];
  if (query.sql.startsWith("SELECT 1 AS probe")) {
    const table = query.sql.match(/FROM (\w+)/u)![1]; if (absent.has(table)) throw { code: "ER_NO_SUCH_TABLE" }; return [[], []];
  }
  if (query.sql.includes("FROM team_tasks WHERE")) {
    let offset = 1;
    const assigneeCount = query.sql.match(/assignee_id IN \(([^)]+)\)/u)?.[1].split(",").length ?? 0;
    const assigneeIds = query.params.slice(offset, offset + assigneeCount); offset += assigneeCount;
    const taskId = query.sql.includes("AND id=?") ? query.params[offset++] : undefined;
    let selected = tasks.filter(row => row.workspaceId === query.params[0] && (!assigneeCount || assigneeIds.includes(row.assigneeId)) && (taskId === undefined || row.id === taskId));
    if (query.sql.includes("AND id IN")) selected = selected.filter(row => query.params.slice(offset).includes(row.id));
    selected = selected.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id));
    if (!query.sql.includes("product_profile_id AS productProfileId")) {
      const result = candidatesOverride ?? selected.slice(0, 5001).map(row => ({ id: row.id, workspaceId: row.workspaceId, assigneeId: row.assigneeId, createdAt: row.createdAt, bodyBytes: taskBytes(row) }));
      afterCandidates?.(); return [result, []];
    }
    return [bodiesOverride ?? selected.map(row => ({ ...row, completionNotes: schema.team_tasks.includes("completion_notes") ? row.completionNotes : null, boardProduct: schema.team_tasks.includes("board_product") ? row.boardProduct : null, bodyBytes: taskBytes(row) })), []];
  }
  if (query.sql.includes("FROM product_profiles p")) {
    const selected = profiles.filter(row => row.workspaceId === query.params[0] && query.params.slice(1).includes(row.id));
    return [profileOverride ?? selected.map(row => query.sql.includes("p.parent_asin AS") ? { ...row, bodyBytes: profileBytes(row) } : { id: row.id, workspaceId: row.workspaceId, bodyBytes: profileBytes(row) }), []];
  }
  if (query.sql.includes("FROM ops_task_attachments a")) {
    const taskCount = query.sql.match(/t.id IN \(([^)]+)\)/u)![1].split(",").length, ids = query.params.slice(2, 2 + taskCount);
    const assigneeCount = query.sql.match(/t.assignee_id IN \(([^)]+)\)/u)?.[1].split(",").length ?? 0;
    const assigneeIds = query.params.slice(2 + taskCount, 2 + taskCount + assigneeCount);
    const body = query.sql.includes("AS name,"), attachmentIds = query.params.slice(2 + taskCount + assigneeCount);
    const selected = attachments.filter(row => row.workspaceId === query.params[0] && ids.includes(row.taskId) && (!body || attachmentIds.includes(row.id)) && tasks.some(t => t.id === row.taskId && t.workspaceId === query.params[1] && (!assigneeCount || assigneeIds.includes(t.assigneeId)))).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || Number(a.id) - Number(b.id)).slice(0, 5001);
    const result = attachmentsOverride ?? selected.map(row => body ? { ...row, nameBytes: bytes([row.name]) } : { id: row.id, workspaceId: row.workspaceId, taskId: row.taskId, createdAt: row.createdAt, nameBytes: bytes([row.name]) });
    if (!body) afterAttachmentCandidates?.(); return [result, []];
  }
  throw new Error(`Unexpected query ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => { try { const result = await body({ execute }); commits++; return result; } catch (error) { rollbacks++; throw error; } });
const database = vi.fn(async () => ({ transaction }));
const repo = createProductTaskReadRepository({ database });
function admin(role = "admin") { actors[0].role = role; return ctx(role); }
beforeEach(() => {
  vi.clearAllMocks(); actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; tasks = [task()]; profiles = [profile()]; attachments = [attachment()]; overrides = []; policies = [];
  schema = { team_tasks: [...taskColumns], product_profiles: [...profileColumns], ops_task_attachments: [...attachmentColumns] }; absent = new Set(); failures = {}; queries = []; afterCandidates = null; afterAttachmentCandidates = null;
  candidatesOverride = null; bodiesOverride = null; profileOverride = null; attachmentsOverride = null; commits = 0; rollbacks = 0;
});

describe("product task fixed complete authorized source", () => {
  it("reads the complete saved task and attachment metadata without directories, finance, writes or object URLs", async () => {
    const result = await repo.list(ctx(), input); expect(result.status).toBe("ready"); expect(Object.keys(repo)).toEqual(["list", "detail"]);
    expect(result.items[0]).toMatchObject({ id: 11, status: "todo", category: "旧自定义类型", completionNotes: { status: "available", value: "完整完成情况" }, attachments: { status: "available", total: 1 } });
    expect(result.items[0].product.identity).toEqual(product); expect(result.capabilities.partners).toBe("unavailable");
    expect(transaction).toHaveBeenCalledTimes(1); expect(commits).toBe(1); expect(rollbacks).toBe(0);
    expect(queries.every(query => query.sql.startsWith("SELECT "))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|storage_ref|fileUrl|INSERT |UPDATE .* SET|CREATE TABLE|ALTER TABLE|DELETE |workspace_memberships|operator_name_mappings|monthly_profit|weekly|sync_runs/u);
    expect(JSON.stringify(result)).toContain("原始任务<script>secret</script>");
    expect(queries[0]).toMatchObject({ params: [3], sql: "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE" });
  });
  it("retains all five states and full-source statistics before paging", async () => {
    tasks = ["backlog", "todo", "in_progress", "review", "done"].map((status, index) => task({ id: 11 + index, status, completedAt: status === "done" ? time : null }));
    const result = await repo.list(ctx(), { ...input, limit: 1 }); expect(result.stats).toMatchObject({ total: 5, pending: 4, done: 1, byStatus: { backlog: 0, todo: 2, in_progress: 2, review: 0, done: 1 } });
    expect(result.items).toHaveLength(1); expect(result.page.hasMore).toBe(true);
    const next = await repo.list(ctx(), { ...input, limit: 1, cursor: result.page.nextCursor }); expect(next.items[0].status).toBe("in_progress"); expect(next.stats?.total).toBe(5);
  });
  it("retains unlinked tasks and exact product identity without cross-store/market matching", async () => {
    tasks = [task(), task({ id: 12, productProfileId: 0, title: "通用任务" }), task({ id: 13, productProfileId: 22, title: "另一店任务" }), task({ id: 14, productProfileId: 23, title: "加拿大任务" })];
    profiles.push(profile({ id: 22, storeName: "OTHER" }), profile({ id: 23, site: "CA" }));
    expect((await repo.list(ctx(), { ...input, product })).items.map(row => row.id)).toEqual([11]);
    expect((await repo.list(ctx(), { ...input, association: "unlinked" })).items.map(row => row.id)).toEqual([12]);
    expect((await repo.list(ctx(), input)).stats?.total).toBe(4);
  });
  it("keeps complete historical product snapshot without per-field profile fallback", async () => {
    tasks = [task({ boardProduct: JSON.stringify({ key: "profile:21", id: 21, parentAsin: "OLD_PARENT", storeName: "OLD_STORE", site: "US", title: "历史产品", chineseName: null, imageUrl: null }) })];
    const result = await repo.list(ctx(), input); expect(result.items[0].product).toMatchObject({ basis: "saved_snapshot", profileMismatch: true, identity: { workspaceId: 7, parentAsin: "OLD_PARENT", storeName: "OLD_STORE", country: "US" } });
    tasks[0].boardProduct = JSON.stringify({ parentAsin: "OLD_PARENT", title: "不完整快照" });
    const incomplete = await repo.list(ctx(), input); expect(incomplete.items[0].product.status).not.toBe("linked"); expect((await repo.list(ctx(), { ...input, product })).items).toEqual([]);
  });
  it("never resolves a linked profile across workspaces", async () => {
    profiles = [profile({ workspaceId: 8, title: "FOREIGN_PRODUCT_SECRET" })];
    const result = await repo.list(ctx(), input); expect(JSON.stringify(result)).not.toContain("FOREIGN_PRODUCT_SECRET"); expect(result.items[0].product.status).not.toBe("linked");
    expect(queries.filter(q => q.sql.includes("FROM product_profiles")).every(q => q.sql.includes("p.workspaceId=?") && q.params[0] === 7)).toBe(true);
  });
  it("does not admit newly inserted tasks after fixed candidate selection", async () => {
    afterCandidates = () => { tasks.push(task({ id: 99, title: "LATE_SECRET" })); };
    const result = await repo.list(ctx(), input); expect(result.stats?.total).toBe(1); expect(JSON.stringify(result)).not.toContain("LATE_SECRET");
  });
  it("fails closed if fixed candidate ownership changes before body read", async () => {
    afterCandidates = () => { tasks[0].assigneeId = 9; };
    expect(await repo.list(ctx(), input)).toMatchObject({ status: "invalid", reasonCode: "invalid_source" });
  });
  it("rejects truncating over 5000 authorized tasks", async () => {
    tasks = Array.from({ length: 5001 }, (_, index) => task({ id: index + 1 }));
    const result = await repo.list(ctx(), input); expect(result).toMatchObject({ status: "invalid", reasonCode: "source_incomplete", items: [], stats: null });
    expect(queries.some(q => q.sql.includes("product_profile_id AS productProfileId"))).toBe(false);
  });
  it("checks combined source bytes before body transfer", async () => {
    candidatesOverride = Array.from({ length: 100 }, (_, index) => ({ id: 100 - index, workspaceId: 7, assigneeId: 3, createdAt: time, bodyBytes: 100000 }));
    expect(await repo.list(ctx(), input)).toMatchObject({ status: "invalid", reasonCode: "source_incomplete" });
    expect(queries.some(q => q.sql.includes("product_profile_id AS productProfileId"))).toBe(false);
  });
  it.each([{ id: "11" }, { workspaceId: 8 }, { assigneeId: 9 }, { bodyBytes: -1 }, { bodyBytes: "10" }, { createdAt: new Date() }])("rejects invalid candidate metadata %j", async patch => {
    candidatesOverride = [{ id: 11, workspaceId: 7, assigneeId: 3, createdAt: time, bodyBytes: taskBytes(tasks[0]), ...patch }];
    expect((await repo.list(ctx(), input)).status).toBe("invalid");
  });
  it.each([{ id: 12 }, { workspaceId: 8 }, { assigneeId: 9 }, { bodyBytes: 1 }, { title: "changed" }])("rejects fixed body drift %j", async patch => {
    bodiesOverride = [{ ...tasks[0], bodyBytes: taskBytes(tasks[0]), ...patch }]; expect((await repo.list(ctx(), input)).status).toBe("invalid");
  });
  it("rejects unknown saved state without relabeling it todo", async () => {
    tasks = [task({ status: "unexpected" })]; expect(await repo.list(ctx(), input)).toMatchObject({ status: "invalid", items: [], stats: null });
  });
});

describe("product tasks exact task authority and directory permission", () => {
  it("reads only currently confirmed direct partner tasks, including their attachment metadata", async () => {
    const partners = vi.fn(async () => ({ available: true, ids: [3, 6] }));
    const partnerRepo = createProductTaskReadRepository({ database, partners });
    tasks.push(task({ id: 12, assigneeId: 6 }), task({ id: 13, assigneeId: 9, title: "OTHER_TEAM_SECRET" }), task({ id: 14, assigneeId: 6, workspaceId: 8, title: "OTHER_WORKSPACE_SECRET" }));
    attachments.push(attachment({ id: 32, taskId: 12 }));
    const result = await partnerRepo.list(ctx(), input);
    expect(result.items.map(task => task.id)).toEqual([12, 11]);
    expect(result.capabilities.partners).toBe("available");
    expect(JSON.stringify(result)).not.toMatch(/OTHER_TEAM_SECRET|OTHER_WORKSPACE_SECRET/u);
    expect((await partnerRepo.detail(ctx(), { ...detailInput, taskId: 12 })).attachments.map(file => file.id)).toEqual([32]);
    partners.mockResolvedValue({ available: true, ids: [3] });
    expect((await partnerRepo.list(ctx(), input)).items.map(task => task.id)).toEqual([11]);
    expect((await partnerRepo.detail(ctx(), { ...detailInput, taskId: 12 })).task).toBeNull();
  });
  it("ops_manager has only their current numeric assignee tasks, not every product-owner task", async () => {
    tasks.push(task({ id: 12, assigneeId: 9, assigneeName: "原始负责人", creatorId: 3, title: "OTHER_ASSIGNEE_SECRET" }), task({ id: 13, workspaceId: 8, title: "OTHER_WORKSPACE_SECRET" }));
    expect((await repo.list(ctx(), input)).stats?.total).toBe(1); expect(JSON.stringify(await repo.list(ctx(), input))).not.toMatch(/OTHER_ASSIGNEE_SECRET|OTHER_WORKSPACE_SECRET/u);
    expect((await repo.list(ctx(), { ...input, assigneeId: 9 })).items).toEqual([]);
    expect(await repo.detail(ctx(), { ...detailInput, taskId: 12 })).toMatchObject({ status: "not_found", task: null, attachments: [] });
  });
  it.each(["admin", "super_admin"])("%s can read all workspace tasks including unassigned, not another workspace", async role => {
    tasks.push(task({ id: 12, assigneeId: 9 }), task({ id: 13, assigneeId: null }), task({ id: 14, workspaceId: 8, title: "FOREIGN_SECRET" }));
    const result = await repo.list(admin(role), input); expect(result.stats?.total).toBe(3); expect(JSON.stringify(result)).not.toContain("FOREIGN_SECRET");
  });
  it("checks strict ops_data permission before source or directory probing", async () => {
    policies = [{ effect: "deny" }]; await expect(repo.list(ctx(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(q => q.sql.includes("information_schema") || q.sql.includes("LIMIT 3"))).toBe(false);
  });
  it.each(["ops_manager", "admin"])("ops_data policy allow cannot bypass %s ops_tasks directory denial", async role => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ role, detailedPermissions: JSON.stringify([{ moduleId: "ops", operations: ["read"], subModules: [{ subModuleId: "ops_tasks", operations: [] }] }]) })];
    await expect(repo.list(admin(role), input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "PRODUCT_TASK_READ_DIRECTORY_DENIED" }); expect(queries.some(q => q.sql.includes("information_schema"))).toBe(false);
  });
  it("requires module grant even when ops_data allow and task submodule read are explicit", async () => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ modules: "[]", detailedPermissions: '[{"moduleId":"ops","operations":["read"]}]' })];
    await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_DIRECTORY_DENIED" });
  });
  it("honors workspace override before global fallback without mutating either", async () => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ id: 2, workspaceId: null, modules: "[]" }), roleOverride()];
    expect((await repo.list(ctx(), input)).status).toBe("ready"); overrides = overrides.filter(row => row.workspaceId === null);
    await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_DIRECTORY_DENIED" });
  });
  it.each([null, [], [{ moduleId: "ops", operations: ["read"] }], [{ moduleId: "listing", operations: [] }]])("uses existing module inheritance for valid detailed permissions %j", async details => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ detailedPermissions: details === null ? null : JSON.stringify(details) })]; expect((await repo.list(ctx(), input)).status).toBe("ready");
  });
  it.each([{ modules: "bad" }, { modules: '["ops","ops"]' }, { modules: '{}' }, { detailedPermissions: "bad" }, { detailedPermissions: '{}' }, { detailedPermissions: '[{"moduleId":"ops","operations":["read","read"]}]' }, { detailedPermissions: '[{"moduleId":"ops","operations":["execute"]}]' }, { detailedPermissions: '[{"moduleId":"ops","operations":["read"],"subModules":[{"subModuleId":"ops_tasks","operations":[]},{"subModuleId":"ops_tasks","operations":["read"]}]}]' }])("fails closed on malformed directory config %j", async patch => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride(patch)]; await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_DIRECTORY_POLICY_INVALID" });
  });
  it("rejects duplicated directory sources", async () => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride(), roleOverride({ id: 2 })]; await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_DIRECTORY_POLICY_INVALID" });
  });
  it("bounds native JSON permission arrays as well as JSON text", async () => {
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ detailedPermissions: Array.from({ length: 5 }, (_, index) => ({ moduleId: index === 0 ? "ops" : "module" + index, operations: ["read"], subModules: Array.from({ length: 100 }, (_, i) => ({ subModuleId: (`sub-${i}`).padEnd(100, "x"), operations: ["read", "edit", "delete"] })) })) })];
    await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_DIRECTORY_POLICY_INVALID" });
  });
  it("rechecks directory revocation on subsequent page and detail calls", async () => {
    tasks.push(task({ id: 12 })); const first = await repo.list(ctx(), { ...input, limit: 1 });
    policies = [{ effect: "allow" }]; overrides = [roleOverride({ modules: "[]" })];
    await expect(repo.list(ctx(), { ...input, limit: 1, cursor: first.page.nextCursor })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.detail(ctx(), detailInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("lets operators read assigned tasks by default while retaining explicit role restrictions", async () => {
    actors[0].role = "ops_specialist";
    const result = await repo.list(ctx("ops_specialist"), input);
    expect(result.status).toBe("ready");
    expect(result.items.every(task => task.assigneeId === 3)).toBe(true);
    overrides = [roleOverride({ role: "ops_specialist", modules: JSON.stringify(["listing", "knowledge"]) })];
    await expect(repo.list(ctx("ops_specialist"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("task-specific write directory gate preserves independent reads", () => {
  const gate = (operation: "read" | "edit" | "delete") => strictTaskDirectory({ execute } as unknown as DbExecutor, "ops_manager", 7, operation);
  const permission = (dashboard: string[], task: string[]) => {
    overrides = [roleOverride({ detailedPermissions: JSON.stringify([{ moduleId: "ops", operations: [], subModules: [
      { subModuleId: "ops_dashboard", operations: dashboard }, { subModuleId: "ops_tasks", operations: task },
    ] }]) })];
  };
  it("task editing does not require financial dashboard editing", async () => {
    permission(["read"], ["read", "edit"]); await expect(gate("edit")).resolves.toBeUndefined();
  });
  it.each(["edit", "delete"] as const)("%s never inherits financial editing", async operation => {
    permission(["read", "edit", "delete"], ["read"]); await expect(gate(operation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["edit", "delete"] as const)("%s still requires task reading", async operation => {
    permission(["read"], [operation]); await expect(gate(operation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["edit", "delete"] as const)("%s still requires dashboard reading", async operation => {
    permission([], ["read", operation]); await expect(gate(operation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("attachment deletion needs its separate directory operation", async () => {
    permission(["read"], ["read", "edit"]); await expect(gate("delete")).rejects.toMatchObject({ code: "FORBIDDEN" });
    permission(["read"], ["read", "delete"]); await expect(gate("delete")).resolves.toBeUndefined();
  });
});

describe("product task structure availability and details", () => {
  it("marks missing completion and snapshot columns unavailable without inventing empty values", async () => {
    schema.team_tasks = schema.team_tasks.filter(name => !["completion_notes", "board_product"].includes(name));
    const result = await repo.list(ctx(), input); expect(result.status).toBe("ready"); expect(result.capabilities).toMatchObject({ completionNotes: "unavailable", boardProduct: "unavailable" });
    expect(result.items[0].completionNotes).toEqual({ status: "unavailable", value: null });
    expect(queries.filter(q => q.sql.includes("FROM team_tasks WHERE")).every(q => !q.sql.includes("completion_notes") && !q.sql.includes("board_product"))).toBe(true);
  });
  it("distinguishes truly absent attachment table from zero saved attachments", async () => {
    schema.ops_task_attachments = []; absent.add("ops_task_attachments");
    const missing = await repo.detail(ctx(), detailInput); expect(missing.status).toBe("ready"); expect(missing.capabilities.attachments).toBe("unavailable"); expect(missing.page.total).toBeNull();
    schema.ops_task_attachments = [...attachmentColumns]; absent.clear(); attachments = [];
    const empty = await repo.detail(ctx(), detailInput); expect(empty.capabilities.attachments).toBe("available"); expect(empty.page.total).toBe(0);
  });
  it("marks profile/attachment missing required columns unavailable, not as no existing records", async () => {
    schema.product_profiles = schema.product_profiles.filter(name => name !== "store_name"); schema.ops_task_attachments = schema.ops_task_attachments.filter(name => name !== "task_id");
    const result = await repo.list(ctx(), input); expect(result.capabilities).toMatchObject({ profiles: "unavailable", attachments: "unavailable" }); expect(result.items[0].product.status).not.toBe("linked");
  });
  it("does not interpret an empty hidden catalog as a missing table", async () => {
    schema.team_tasks = []; await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_SCHEMA_UNAVAILABLE" });
    absent.add("team_tasks"); expect(await repo.list(ctx(), input)).toMatchObject({ status: "missing", items: [], stats: null });
  });
  it("loads bounded attachment metadata pages with original timestamps and no URL", async () => {
    attachments = Array.from({ length: 22 }, (_, index) => attachment({ id: index + 31, name: `附件${index}.xlsx` }));
    const result = await repo.detail(ctx(), { ...detailInput, attachmentLimit: 20 }); expect(result.page.total).toBe(22); expect(result.attachments).toHaveLength(20); expect(result.page.hasMore).toBe(true);
    const next = await repo.detail(ctx(), { ...detailInput, attachmentLimit: 20, attachmentCursor: result.page.nextCursor }); expect(next.attachments).toHaveLength(2); expect(next.page.hasMore).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/storage_ref|storageRef|signedUrl|fileUrl/u);
  });
  it("retains valid multi-byte file names beyond 800 bytes with bounded SQL transfer", async () => {
    attachments = [attachment({ name: "图".repeat(300) + ".xlsx" })];
    const result = await repo.detail(ctx(), detailInput); expect(result.status).toBe("ready"); expect(result.attachments[0].name).toBe(attachments[0].name);
    const reads = queries.filter(q => q.sql.includes("FROM ops_task_attachments a")); expect(reads).toHaveLength(2); expect(reads[0].sql).not.toContain("AS name,");
    expect(reads[1].sql).toContain("<=2000"); expect(reads[1].sql).toContain("AND a.id IN (?)");
  });
  it("does not admit new attachments after their fixed metadata set is captured", async () => {
    afterAttachmentCandidates = () => attachments.push(attachment({ id: 32, name: "LATE_ATTACHMENT_SECRET" }));
    const result = await repo.detail(ctx(), detailInput); expect(result.page.total).toBe(1); expect(JSON.stringify(result)).not.toContain("LATE_ATTACHMENT_SECRET");
  });
  it.each(["x".repeat(501), "图".repeat(700)])("rejects file-name character/byte excess without partial detail", async name => {
    attachments = [attachment({ name })]; expect(await repo.detail(ctx(), detailInput)).toMatchObject({ status: "invalid", attachments: [], task: null });
    if (Buffer.byteLength(name, "utf8") > 2000) expect(queries.some(q => q.sql.includes("AS name,"))).toBe(false);
  });
  it("checks combined task and attachment-name bytes before attachment bodies transfer", async () => {
    tasks = Array.from({ length: 100 }, (_, index) => task({ id: index + 1, description: "x".repeat(16000) }));
    attachments = Array.from({ length: 5000 }, (_, index) => attachment({ id: index + 1, taskId: 1, name: "图".repeat(500) }));
    expect(await repo.list(ctx(), input)).toMatchObject({ status: "invalid", reasonCode: "source_incomplete", items: [] });
    expect(queries.some(q => q.sql.includes("AS name,"))).toBe(false);
  });
  it("does not return other-task or cross-workspace attachment metadata", async () => {
    tasks.push(task({ id: 12, assigneeId: 9 })); attachments.push(attachment({ id: 32, taskId: 12, name: "OTHER_TASK_SECRET" }), attachment({ id: 33, workspaceId: 8, name: "OTHER_WORKSPACE_SECRET" }));
    expect(JSON.stringify(await repo.detail(ctx(), detailInput))).not.toMatch(/OTHER_TASK_SECRET|OTHER_WORKSPACE_SECRET/u);
  });
  it.each([{ workspaceId: 8 }, { taskId: 99 }, { id: "31" }])("rejects an out-of-scope attachment driver result %j", async patch => {
    attachmentsOverride = [attachment(patch)]; expect((await repo.detail(ctx(), detailInput)).status).toBe("invalid");
  });
  it("rejects attachment metadata truncation", async () => {
    attachments = Array.from({ length: 5001 }, (_, index) => attachment({ id: index + 1 })); expect(await repo.detail(ctx(), detailInput)).toMatchObject({ status: "invalid", reasonCode: "source_incomplete" });
  });
  it.each(["users", "role_permissions", "security_access_policies", "information_schema.COLUMNS"])("does not swallow %s failure as empty task data", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE", message: "SECRET_CONNECTION" }; await expect(repo.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_FAILED" });
  });
  it.each([{ role: "admin" }, { status: "disabled" }, { defaultWorkspaceId: 8 }, { id: 9 }])("rejects changed current actor %j before source loading", async patch => {
    Object.assign(actors[0], patch); await expect(repo.list(ctx(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries).toHaveLength(1);
  });
  it("rejects no-login, workspace drift and caller-provided authority before database access", async () => {
    await expect(repo.list(ctx("ops_manager", { user: null }), input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(repo.list(ctx(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.list(ctx(), { ...input, ownerIds: [3] } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(database).not.toHaveBeenCalled();
  });
  it.each([null, {}])("requires a real transaction %j", async db => {
    const service = createProductTaskReadRepository({ database: async () => db }); await expect(service.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_TRANSACTION_REQUIRED" });
  });
  it("fails rather than declaring success when transaction completion fails", async () => {
    const service = createProductTaskReadRepository({ database: async () => ({ transaction: async body => { await body({ execute } as never); throw new Error("SECRET_COMMIT_ERROR"); } }) });
    await expect(service.list(ctx(), input)).rejects.toMatchObject({ message: "PRODUCT_TASK_READ_FAILED" });
  });
});
