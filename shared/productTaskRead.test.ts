import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildProductTaskListResult, buildProductTaskDetailResult, buildProductTaskReadFailure, sameTaskProductIdentity, ProductTaskListInputSchema, ProductTaskDetailInputSchema, ProductTaskListResultSchema, ProductTaskDetailResultSchema, ProductTaskReadError, PRODUCT_TASK_STATUSES, type ProductTaskReadSource, type ProductTaskSourceRecord, type ProductTaskProfileSource, type ProductTaskAttachment, type ProductTaskListInput, type ProductTaskDetailInput, type ProductTaskListResult } from "./productTaskRead";

const identity = { userId: 7, workspaceId: 11 };
const input: ProductTaskListInput = { expectedWorkspaceId: 11, product: null, association: "all", assigneeId: null, unassignedOnly: false, status: null, category: null, search: "", groupBy: "none", cursor: null, limit: 20 };
const time = "2026-10-18 01:02:03.000000";
function task(patch: Partial<ProductTaskSourceRecord> = {}): ProductTaskSourceRecord { return { id: 1, workspaceId: 11, productProfileId: 10, creatorId: 7, title: "Task original", description: "Full original description\nSecond line", status: "todo", priority: "medium", category: "旧版自定义分类", assigneeId: 7, assigneeName: "Same display name", startDate: "2026-10-01", dueDate: "2026-10-31", completedAt: null, estimatedHours: "1.5", actualHours: null, tags: '["original","tag"]', createdAt: time, updatedAt: time, completionNotes: "Full completion notes", boardProduct: null, ...patch }; }
function profile(patch: Partial<ProductTaskProfileSource> = {}): ProductTaskProfileSource { return { id: 10, workspaceId: 11, parentAsin: "P", storeName: "Exact Store", site: "US", title: "Profile title", chineseName: "中文商品", imageUrl: "https://example.test/image", ...patch }; }
function file(patch: Partial<ProductTaskAttachment> = {}): ProductTaskAttachment { return { id: 100, workspaceId: 11, taskId: 1, name: "Original file.pdf", byteSize: 1234, uploadedBy: 7, createdAt: time, ...patch }; }
function source(patch: Partial<ProductTaskReadSource> = {}): ProductTaskReadSource { return { identity, input, capabilities: { completionNotes: "available", boardProduct: "available", profiles: "available", attachments: "available", partners: "unavailable" }, access: { all: true, assigneeIds: [7] }, tasks: [task()], profiles: [profile()], attachments: [], complete: true, ...patch }; }
const list = (patch: Partial<ProductTaskReadSource> = {}) => buildProductTaskListResult(source(patch));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function detail(value = source(), patch: Partial<ProductTaskDetailInput> = {}) { return buildProductTaskDetailResult({ ...value, input: { expectedWorkspaceId: 11, taskId: 1, attachmentCursor: null, attachmentLimit: 20, ...patch } }); }
const exact = { workspaceId: 11, parentAsin: "P", storeName: "Exact Store", country: "US" };

it("replays task statistics across server English and browser Chinese locales", () => {
  const compare = String.prototype.localeCompare;
  const locale = vi.spyOn(String.prototype, "localeCompare");
  try {
    locale.mockImplementation(function (this: string, other: string) { return compare.call(this, other, "en-US"); });
    const response = list({ tasks: ["listing优化", "广告优化", "绩效处理", "其他"].map((category, i) => task({ id: i + 1, category })) });
    locale.mockImplementation(function (this: string, other: string) { return compare.call(this, other, "zh-CN"); });
    expect(ProductTaskListResultSchema.safeParse(clone(response)).success).toBe(true);
  } finally { locale.mockRestore(); }
});

describe("exact task product identity and saved association", () => {
  it("canonicalizes parent and country but requires all four identity dimensions", () => {
    expect(sameTaskProductIdentity(exact, { ...exact, parentAsin: "p", country: "美国站" })).toBe(true);
    expect(sameTaskProductIdentity({ ...exact, country: "GB" }, { ...exact, country: "英国" })).toBe(true);
    for (const patch of [{ workspaceId: 12 }, { storeName: "Other" }, { country: "CA" }, { parentAsin: "OTHER" }, { storeName: "" }, { country: "" }, { workspaceId: undefined }]) expect(sameTaskProductIdentity(exact, { ...exact, ...patch })).toBe(false);
  });
  it("never puts same-parent other stores or countries into a product's task list", () => {
    const tasks = [task(), task({ id: 2, productProfileId: 20 }), task({ id: 3, productProfileId: 30 })], profiles = [profile(), profile({ id: 20, storeName: "Other" }), profile({ id: 30, site: "CA" })];
    const result = list({ tasks, profiles, input: { ...input, product: exact } }); expect(result.items.map(task => task.id)).toEqual([1]); expect(result.stats?.total).toBe(1);
    expect(list({ tasks, profiles, input: { ...input, groupBy: "product" } }).groups).toHaveLength(3);
  });
  it("keeps a complete saved snapshot as one historical identity when the current profile changed", () => {
    const saved = { parentAsin: "OLD", storeName: "Old Store", site: "加拿大", title: "Historical title", chineseName: "原商品", imageUrl: null };
    const result = list({ tasks: [task({ boardProduct: saved })] }), association = result.items[0].product;
    expect(association).toMatchObject({ status: "linked", basis: "saved_snapshot", profileMismatch: true, identity: { workspaceId: 11, parentAsin: "OLD", storeName: "Old Store", country: "CA" } });
    expect(association.snapshot?.title).toBe("Historical title"); expect(association.currentProfile?.title).toBe("Profile title");
    expect(list({ tasks: [task({ boardProduct: saved })], input: { ...input, product: exact } }).items).toEqual([]);
  });
  it("accepts native and JSON-text snapshots without changing the immutable view key", () => {
    const saved = { parentAsin: "P", storeName: "Exact Store", site: "US", title: "Saved" };
    expect(list({ tasks: [task({ boardProduct: saved })] })).toEqual(list({ tasks: [task({ boardProduct: JSON.stringify(saved) })] }));
  });
  it.each([{}, { parentAsin: "P", storeName: "Exact Store" }, { parentAsin: "P", site: "US" }, "{broken", [], 42])("does not fill a bad/incomplete saved product from a valid live profile: %j", boardProduct => {
    const result = list({ tasks: [task({ boardProduct })] }); expect(result.items[0].product.status).toBe("incomplete"); expect(result.items[0].product.identity).toBeNull(); expect(result.stats?.total).toBe(1);
    expect(list({ tasks: [task({ boardProduct })], input: { ...input, association: "issues" } }).items).toHaveLength(1);
  });
  it.each([{ parentAsin: "P", storeName: "Exact Store", site: "US", marketplace: "CA" }, { workspaceId: 12, parentAsin: "P", storeName: "Exact Store", site: "US" }])("retains conflicting association as a visible issue, never an exact product match", boardProduct => {
    const result = list({ tasks: [task({ boardProduct })] }); expect(result.items[0].product.status).toBe("conflict"); expect(result.items[0].product.identity).toBeNull();
  });
  it.each([0, null])("keeps a genuinely unassociated general task with profile ID %s", productProfileId => {
    const result = list({ tasks: [task({ productProfileId })], profiles: [], input: { ...input, association: "unlinked" } }); expect(result.items[0].product.status).toBe("unlinked"); expect(result.stats?.total).toBe(1);
  });
  it("distinguishes a missing referenced profile from an unassociated task", () => {
    const result = list({ profiles: [] }); expect(result.items[0].product.status).toBe("incomplete"); expect(result.items[0].product.reasonCode).toBe("profile_not_found");
  });
  it("uses a verified complete legacy profile while exposing that the snapshot column is unavailable", () => {
    const value = source(); value.capabilities.boardProduct = "unavailable";
    const result = buildProductTaskListResult(value); expect(result.items[0].product).toMatchObject({ status: "linked", basis: "current_profile", snapshot: { status: "unavailable" }, reasonCode: "saved_product_column_unavailable" });
  });
  it("does not call a task unlinked when both profile and saved association sources are unavailable", () => {
    const value = source({ tasks: [task({ productProfileId: null })], profiles: [] }); value.capabilities.boardProduct = "unavailable"; value.capabilities.profiles = "unavailable";
    expect(buildProductTaskListResult(value).items[0].product.status).toBe("unavailable");
  });
});

describe("complete task records, original states and source text", () => {
  it("normalizes legacy statuses into three visible states while retaining all tasks", () => {
    const result = list({ tasks: PRODUCT_TASK_STATUSES.map((status, index) => task({ id: index + 1, status })) });
    expect(result.stats).toMatchObject({ total: 5, pending: 4, done: 1, inProgress: 2, byStatus: { backlog: 0, todo: 2, in_progress: 2, review: 0, done: 1 } });
    expect(result.items.map(task => task.status)).toEqual(["done", "in_progress", "in_progress", "todo", "todo"]);
  });
  it("preserves custom category, full description/notes and HTML-like text without normalization", () => {
    const original = " <img src=x onerror=alert(1)> ", result = list({ tasks: [task({ title: original, description: "<script>not code</script>\n".repeat(100), completionNotes: "full notes\n".repeat(1000) })] }).items[0];
    expect(result.title).toBe(original); expect(result.category).toBe("旧版自定义分类"); expect(result.description).toContain("<script>"); expect(result.completionNotes.value).toHaveLength(11000);
    expect(result.legacy).toEqual({ startDate: "2026-10-01", estimatedHours: "1.5", actualHours: null, tags: '["original","tag"]' });
  });
  it("keeps unknown categories distinct from the explicitly stored other category", () => {
    const tasks = [task(), task({ id: 2, category: "其他" }), task({ id: 3, category: null })];
    expect(list({ tasks, input: { ...input, category: "其他" } }).items.map(task => task.id)).toEqual([2]);
    expect(list({ tasks, input: { ...input, groupBy: "type" } }).groups).toHaveLength(3);
  });
  it.each(["2026-02-29", "2026-10-32", "tomorrow"])("preserves invalid legacy due date %s without reinterpreting it as missing or overdue", dueDate => {
    expect(list({ tasks: [task({ dueDate })] }).items[0].dueDate).toEqual({ raw: dueDate, value: null, status: "invalid" });
  });
  it.each([null, ""])("keeps missing due date %s", dueDate => expect(list({ tasks: [task({ dueDate })] }).items[0].dueDate).toEqual({ raw: dueDate, value: null, status: "missing" }));
  it("preserves database timestamp text and a valid leap day", () => {
    const result = list({ tasks: [task({ dueDate: "2024-02-29", completedAt: time })] }); expect(result.timestampBasis).toBe("database_datetime_without_timezone"); expect(result.items[0].completedAt).toBe(time); expect(result.items[0].dueDate.value).toBe("2024-02-29");
  });
  it("does not manufacture empty completion notes or zero attachments for missing schema", () => {
    const value = source({ tasks: [task({ completionNotes: null })] }); value.capabilities.completionNotes = "unavailable"; value.capabilities.attachments = "unavailable";
    const result = buildProductTaskListResult(value); expect(result.items[0].completionNotes).toEqual({ status: "unavailable", value: null }); expect(result.items[0].attachments).toEqual({ status: "unavailable", total: null });
    expect(detail(value)).toMatchObject({ status: "ready", attachments: [], page: { total: null, hasMore: false } });
    const empty = list({ tasks: [task({ completionNotes: null })] }).items[0]; expect(empty.completionNotes).toEqual({ status: "available", value: null }); expect(empty.attachments).toEqual({ status: "available", total: 0 });
  });
});

describe("all authorized matching task statistics, filtering, grouping and stable cursors", () => {
  it("computes complete statistics before paging and retains equal-timestamp cursor ties", () => {
    const tasks = Array.from({ length: 25 }, (_, index) => task({ id: index + 1, status: PRODUCT_TASK_STATUSES[index % 5] })), first = list({ tasks, input: { ...input, limit: 3 } });
    expect(first.items.map(task => task.id)).toEqual([25, 24, 23]); expect(first.stats?.total).toBe(25); expect(first.stats?.pending).toBe(20); expect(first.groups[0]).toMatchObject({ total: 25, pageCount: 3 });
    const second = list({ tasks, input: { ...input, limit: 3, cursor: first.page.nextCursor } }); expect(second.items.map(task => task.id)).toEqual([22, 21, 20]); expect(second.viewKey).toBe(first.viewKey); expect(second.stats).toEqual(first.stats);
  });
  it("reaches every task across pages without duplicates or hidden status conversion", () => {
    const tasks = Array.from({ length: 21 }, (_, index) => task({ id: index + 1, status: index % 2 ? "review" : "backlog" }));
    let cursor: ProductTaskListInput["cursor"] = null; const ids: number[] = [];
    do { const result = list({ tasks, input: { ...input, limit: 4, cursor } }); ids.push(...result.items.map(task => task.id)); cursor = result.page.nextCursor; } while (cursor);
    expect(ids).toEqual(tasks.map(task => task.id).reverse()); expect(new Set(ids).size).toBe(21);
  });
  it("filters the full authorized matching set, including raw categories and all status values", () => {
    const tasks = [task({ id: 1, status: "review" }), task({ id: 2, status: "review", assigneeId: 8 }), task({ id: 3, status: "todo" }), task({ id: 4, status: "review", category: "其他" })];
    const result = list({ tasks, input: { ...input, assigneeId: 7, status: "in_progress", category: "旧版自定义分类", search: "中文商品", limit: 1 } }); expect(result.stats?.total).toBe(1); expect(result.items[0].id).toBe(1);
  });
  it("does not merge identical assignee names with different numeric identities", () => {
    const result = list({ tasks: [task(), task({ id: 2, assigneeId: 8 })] }); expect(result.stats?.byAssignee).toEqual([{ assigneeId: 7, count: 1 }, { assigneeId: 8, count: 1 }]);
  });
  it("retains unassigned tasks for authorized managers and their distinct filter", () => {
    const result = list({ tasks: [task(), task({ id: 2, assigneeId: null })], input: { ...input, unassignedOnly: true } }); expect(result.items.map(task => task.id)).toEqual([2]); expect(result.stats?.byAssignee).toEqual([{ assigneeId: null, count: 1 }]);
  });
  it.each(["none", "type", "status", "product"] as const)("provides exact full group count with only the current page's members for %s", groupBy => {
    const result = list({ tasks: Array.from({ length: 8 }, (_, index) => task({ id: index + 1 })), input: { ...input, groupBy, limit: 2 } }); expect(result.groups).toHaveLength(1); expect(result.groups[0]).toMatchObject({ total: 8, pageCount: 2, taskIds: [8, 7], coverage: "current_page_members_with_full_matching_group_count" });
  });
  it("returns explicit complete empty lists and past-end pages without inventing records", () => {
    expect(list({ tasks: [], profiles: [] })).toMatchObject({ status: "ready", items: [], stats: { total: 0 }, page: { total: 0, hasMore: false, nextCursor: null } });
    expect(list({ input: { ...input, cursor: { createdAt: "2020-01-01 00:00:00.000000", id: 1 } } })).toMatchObject({ items: [], stats: { total: 1 }, page: { hasMore: false } });
  });
  it("changes view bindings for updates outside the visible page and authority changes", () => {
    const tasks = [task(), task({ id: 2 })], initial = list({ tasks, input: { ...input, limit: 1 } });
    expect(list({ tasks: [task({ completionNotes: "changed" }), task({ id: 2 })], input: { ...input, limit: 1 } }).viewKey).not.toBe(initial.viewKey);
    expect(list({ tasks, input: { ...input, limit: 1 }, access: { all: false, assigneeIds: [7] } }).viewKey).not.toBe(initial.viewKey);
  });
});

describe("task detail, metadata-only attachments and evidence binding", () => {
  it("matches the selected list item version when detail reads only that exact task", () => {
    const value = source({ tasks: [task(), task({ id: 2 })], attachments: [file()] }), listed = buildProductTaskListResult(value), detailed = detail({ ...value, tasks: [task()] });
    expect(detailed.task?.versionKey).toBe(listed.items.find(task => task.id === 1)?.versionKey); expect(detailed.task?.description).toBe(task().description); expect(detailed.attachments).toEqual([file()]);
    expect(JSON.stringify(detailed)).not.toMatch(/storage_ref|storageRef|signedUrl/);
  });
  it("paginates every attachment with a stable task binding", () => {
    const value = source({ attachments: Array.from({ length: 25 }, (_, index) => file({ id: index + 100 })) }), first = detail(value, { attachmentLimit: 3 }), second = detail(value, { attachmentLimit: 3, attachmentCursor: first.page.nextCursor });
    expect(first.attachments.map(file => file.id)).toEqual([124, 123, 122]); expect(second.attachments.map(file => file.id)).toEqual([121, 120, 119]); expect(second.viewKey).toBe(first.viewKey); expect(second.page.total).toBe(25);
  });
  it("changes selected task version when attachment metadata changes without a task timestamp change", () => {
    expect(detail(source({ attachments: [file({ name: "changed.pdf" })] })).task?.versionKey).not.toBe(detail(source({ attachments: [file()] })).task?.versionKey);
  });
  it("does not distinguish nonexistent and invisible detail through a stale task body", () => expect(detail(source({ tasks: [], profiles: [] }))).toMatchObject({ status: "not_found", task: null, attachments: [], page: { total: null } }));
  it("uses SHA-256 with key-order-independent evidence, not a client authority token", () => {
    const first = list(), second = list(clone(source())); expect(second).toEqual(first);
    const value = detail(), expected = createHash("sha256").update(`{"identity":{"userId":7,"workspaceId":11},"task":${JSON.stringify(value.task!.versionKey)}}`).digest("hex"); expect(value.viewKey).toBe(expected);
  });
});

describe("input, authority, source completeness and response invariants", () => {
  it.each([{ expectedWorkspaceId: 0 }, { status: "waiting" }, { product: { parentAsin: "P" } }, { product: { ...exact, workspaceId: 12 } }, { product: exact, association: "unlinked" }, { assigneeId: 7, unassignedOnly: true }, { limit: 0 }, { limit: 51 }, { ownerIds: [7] }, { role: "admin" }, { cursor: { id: 1, createdAt: "2026-02-30 00:00:00.000000" } }])("rejects malformed/authority input %j", patch => expect(ProductTaskListInputSchema.safeParse({ ...input, ...patch }).success).toBe(false));
  it.each([{ taskId: 0 }, { attachmentLimit: 51 }, { attachmentCursor: { id: 1, createdAt: "today" } }, { download: true }, { workspaceId: 11 }])("rejects detail write controls or malformed input %j", patch => expect(ProductTaskDetailInputSchema.safeParse({ expectedWorkspaceId: 11, taskId: 1, attachmentLimit: 20, attachmentCursor: null, ...patch }).success).toBe(false));
  it.each(["task_workspace", "profile_workspace", "attachment_workspace", "attachment_task", "self_owner", "fake_partner", "duplicate_task", "duplicate_profile", "duplicate_file", "missing_notes", "missing_board", "missing_attachments", "missing_profiles"])("rejects invalid source %s", kind => {
    const value = source();
    if (kind === "task_workspace") value.tasks[0].workspaceId = 12;
    if (kind === "profile_workspace") value.profiles[0].workspaceId = 12;
    if (kind === "attachment_workspace") value.attachments = [file({ workspaceId: 12 })];
    if (kind === "attachment_task") value.attachments = [file({ taskId: 99 })];
    if (kind === "self_owner") { value.access.all = false; value.tasks[0].assigneeId = 8; }
    if (kind === "fake_partner") { value.access.all = false; value.access.assigneeIds = [7, 8]; }
    if (kind === "duplicate_task") value.tasks.push(clone(value.tasks[0]));
    if (kind === "duplicate_profile") value.profiles.push(clone(value.profiles[0]));
    if (kind === "duplicate_file") value.attachments = [file(), file()];
    if (kind === "missing_notes") value.capabilities.completionNotes = "unavailable";
    if (kind === "missing_board") { value.capabilities.boardProduct = "unavailable"; value.tasks[0].boardProduct = {}; }
    if (kind === "missing_attachments") { value.capabilities.attachments = "unavailable"; value.attachments = [file()]; }
    if (kind === "missing_profiles") value.capabilities.profiles = "unavailable";
    expect(() => buildProductTaskListResult(value)).toThrow(ProductTaskReadError);
  });
  it("retains a valid self-only read without inventing approved partners", () => expect(list({ access: { all: false, assigneeIds: [7] } }).stats?.total).toBe(1));
  it("rejects unknown persisted statuses instead of converting them to todo", () => expect(() => list({ tasks: [task({ status: "unknown" })] })).toThrow());
  it("rejects incomplete source sets rather than returning partial counts", () => {
    expect(list({ complete: false })).toMatchObject({ status: "invalid", items: [], stats: null, groups: [], page: { total: null } }); expect(detail(source({ complete: false }))).toMatchObject({ status: "invalid", task: null, attachments: [] });
  });
  it.each(["missing", "invalid", "not_found"] as const)("keeps %s failures data-free", status => {
    const value = buildProductTaskReadFailure({ identity, capabilities: source().capabilities, kind: "list", input, status, reasonCode: "explicit", missingReason: "explicit source failure" }); expect(value).toMatchObject({ status, items: [], stats: null, groups: [], viewKey: null, page: { total: null } });
  });
  it.each([
    ["workspace", (r: ProductTaskListResult) => { r.identity.workspaceId = 12; }],
    ["unlinked false", (r: ProductTaskListResult) => { Object.assign(r.items[0].product, { status: "unlinked", identity: null, basis: null }); }],
    ["incomplete false", (r: ProductTaskListResult) => { Object.assign(r.items[0].product, { status: "incomplete", identity: null, basis: null }); }],
    ["availability", (r: ProductTaskListResult) => { r.items[0].completionNotes.status = "unavailable"; }],
    ["due date", (r: ProductTaskListResult) => { r.items[0].dueDate.value = "2026-10-30"; }],
    ["status counts", (r: ProductTaskListResult) => { r.stats!.byStatus.backlog++; }],
    ["association counts", (r: ProductTaskListResult) => { r.stats!.byAssociation.linked = 0; r.stats!.byAssociation.unlinked = 1; }],
    ["group total", (r: ProductTaskListResult) => { r.groups[0].total = 0; }],
    ["group membership", (r: ProductTaskListResult) => { r.groups[0].taskIds = [99]; }],
    ["cursor", (r: ProductTaskListResult) => { r.page.hasMore = true; }],
    ["injected task", (r: ProductTaskListResult) => { r.items.push(clone(r.items[0])); }],
    ["failure partial", (r: ProductTaskListResult) => { r.status = "invalid"; r.reasonCode = "bad"; r.missingReason = "bad"; r.viewKey = null; }],
  ] as const)("rejects response mutation %s", (_, mutate) => { const result = clone(list()); mutate(result); expect(ProductTaskListResultSchema.safeParse(result).success).toBe(false); });
  it.each(["none", "type", "status"] as const)("replays global group counts for %s instead of accepting any in-range number", groupBy => {
    const result = list({ tasks: [task(), task({ id: 2 }), task({ id: 3 })], input: { ...input, groupBy, limit: 1 } }); result.groups[0].total = 2;
    expect(ProductTaskListResultSchema.safeParse(result).success).toBe(false);
  });
  it("replays all statistics exactly when the complete matching set fits the first page", () => {
    const result = list({ tasks: [task(), task({ id: 2 })] }); result.stats!.byCategory = [{ category: "wrong", count: 2 }]; expect(ProductTaskListResultSchema.safeParse(result).success).toBe(false);
  });
  it.each(["current_profile", "saved_snapshot"] as const)("rejects a forged incomplete %s despite complete original fields", basis => {
    const result = list({ tasks: [task({ boardProduct: basis === "saved_snapshot" ? { parentAsin: "P", storeName: "店铺A", site: "US" } : null })] });
    const association = result.items[0].product, evidence = basis === "saved_snapshot" ? association.snapshot! : association.currentProfile!;
    Object.assign(evidence, { identity: null, status: "incomplete", reasonCode: "product_scope_incomplete" });
    Object.assign(association, { identity: null, status: "incomplete", basis: null, profileMismatch: false, reasonCode: "product_scope_incomplete" });
    result.stats!.byAssociation = { linked: 0, unlinked: 0, incomplete: 1, conflict: 0, unavailable: 0 };
    expect(ProductTaskListResultSchema.safeParse(result).success).toBe(false);
  });
  it.each(["status", "assignee", "unassigned", "category", "product", "unlinked", "issues"])("rejects full matching statistics that violate %s filter even beyond the first page", kind => {
    const tasks = Array.from({ length: 25 }, (_, index) => task({ id: index + 1, status: "review", assigneeId: kind === "unassigned" ? null : 7, category: "原分类", ...(kind === "unlinked" ? { productProfileId: null } : {}), ...(kind === "issues" ? { boardProduct: {} } : {}) }));
    const result = list({ tasks, profiles: kind === "unlinked" ? [] : [profile()], input: { ...input, limit: 20, ...(kind === "status" ? { status: "review" as const } : {}), ...(kind === "assignee" ? { assigneeId: 7 } : {}), ...(kind === "unassigned" ? { unassignedOnly: true } : {}), ...(kind === "category" ? { category: "原分类" } : {}), ...(kind === "product" ? { product: exact } : {}), ...(kind === "unlinked" || kind === "issues" ? { association: kind } : {}) } });
    if (kind === "status") { result.stats!.byStatus.review = 24; result.stats!.byStatus.done = 1; result.stats!.done = 1; result.stats!.pending = 24; }
    if (kind === "assignee" || kind === "unassigned") result.stats!.byAssignee = [{ assigneeId: kind === "unassigned" ? null : 7, count: 24 }, { assigneeId: 8, count: 1 }];
    if (kind === "category") result.stats!.byCategory = [{ category: "原分类", count: 24 }, { category: "其他", count: 1 }];
    if (kind === "product") { result.stats!.byAssociation.linked = 24; result.stats!.byAssociation.unlinked = 1; }
    if (kind === "unlinked") { result.stats!.byAssociation.unlinked = 24; result.stats!.byAssociation.linked = 1; }
    if (kind === "issues") { result.stats!.byAssociation.incomplete = 24; result.stats!.byAssociation.linked = 1; }
    expect(ProductTaskListResultSchema.safeParse(result).success).toBe(false);
  });
  it("rejects a later attachment page that exceeds the requested limit", () => {
    const result = detail(source({ attachments: [file(), file({ id: 101 })] }));
    result.request.attachmentCursor = { createdAt: "2026-12-31 23:59:59.999999", id: 999 };
    result.request.attachmentLimit = 1; result.page.limit = 1;
    expect(ProductTaskDetailResultSchema.safeParse(result).success).toBe(false);
  });
  it.each(["foreign", "version", "total", "order"])("rejects corrupted detail %s", kind => {
    const result = detail(source({ attachments: [file(), file({ id: 101 })] }));
    if (kind === "foreign") result.attachments[0].workspaceId = 12;
    if (kind === "version") result.task!.versionKey = "a".repeat(64);
    if (kind === "total") result.page.total = 0;
    if (kind === "order") result.attachments.reverse();
    expect(ProductTaskDetailResultSchema.safeParse(result).success).toBe(false);
  });
  it("enforces source and response limits instead of silently slicing tasks, notes or attachments", () => {
    expect(() => list({ tasks: Array.from({ length: 5001 }, (_, index) => task({ id: index + 1 })) })).toThrow(ProductTaskReadError);
    const big = "a".repeat(65535), tasks = Array.from({ length: 40 }, (_, index) => task({ id: index + 1, description: big, completionNotes: big }));
    expect(() => list({ tasks, input: { ...input, limit: 50 } })).toThrow(ProductTaskReadError);
  });
});
