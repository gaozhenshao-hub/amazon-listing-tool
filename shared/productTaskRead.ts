import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { normalizeMarketplaceCode, normalizeIdentityPart } from "./marketplaceIdentity";
import { monthlyFinancialJsonBytes, parseMonthlyFinancialJson } from "./monthlyFinancialReadDetails";

export const PRODUCT_TASK_READ_LIMITS = { tasks: 5000, attachments: 5000, sourceBytes: 8 * 1024 * 1024, resultBytes: 4 * 1024 * 1024 } as const;
export const PRODUCT_TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
export type ProductTaskStatus = typeof PRODUCT_TASK_STATUSES[number];
export class ProductTaskReadError extends Error { constructor(public readonly code: string) { super("任务来源、范围或完整性无法核验；不截断、不改变状态、不扩展权限"); this.name = "ProductTaskReadError"; } }
const id = z.number().int().positive().max(2147483647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
const statusSchema = z.enum(PRODUCT_TASK_STATUSES);
const availability = z.enum(["available", "unavailable"]);
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type ProductTaskReadIdentity = z.infer<typeof identitySchema>;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const [year, month, day] = value.split("-").map(Number), days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
});
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u).refine(value => dateSchema.safeParse(value.slice(0, 10)).success && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
const cursorSchema = z.object({ createdAt: timestamp, id }).strict();
export type ProductTaskCursor = z.infer<typeof cursorSchema>;
export const ProductTaskProductIdentitySchema = z.object({ workspaceId: id, storeName: text(200), country: text(200).transform(normalizeMarketplaceCode), parentAsin: text(500).transform(normalizeIdentityPart) }).strict();
export type ProductTaskProductIdentity = z.infer<typeof ProductTaskProductIdentitySchema>;
export const ProductTaskCapabilitiesSchema = z.object({ completionNotes: availability, boardProduct: availability, profiles: availability, attachments: availability, partners: availability }).strict();
export type ProductTaskCapabilities = z.infer<typeof ProductTaskCapabilitiesSchema>;
export const ProductTaskListInputSchema = z.object({ expectedWorkspaceId: id, product: ProductTaskProductIdentitySchema.nullable(), association: z.enum(["all", "unlinked", "issues"]), assigneeId: id.nullable(), unassignedOnly: z.boolean(), status: statusSchema.nullable(), category: z.string().max(100).nullable(), search: z.string().max(200), groupBy: z.enum(["none", "type", "status", "product"]), cursor: cursorSchema.nullable(), limit: z.number().int().min(1).max(50) }).strict().superRefine((value, ctx) => {
  if (value.product && (value.product.workspaceId !== value.expectedWorkspaceId || value.association !== "all") || value.unassignedOnly && value.assigneeId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Conflicting task filters" });
});
export type ProductTaskListInput = z.infer<typeof ProductTaskListInputSchema>;
export const ProductTaskDetailInputSchema = z.object({ expectedWorkspaceId: id, taskId: id, attachmentCursor: cursorSchema.nullable(), attachmentLimit: z.number().int().min(1).max(50) }).strict();
export type ProductTaskDetailInput = z.infer<typeof ProductTaskDetailInputSchema>;
const nullableText = (max: number) => z.string().max(max).nullable();
const sourceDateSchema = z.object({ raw: nullableText(100), value: dateSchema.nullable(), status: z.enum(["valid", "missing", "invalid"]) }).strict();
const evidenceSchema = z.object({ source: z.enum(["saved_snapshot", "current_profile"]), profileId: id.nullable(), identity: ProductTaskProductIdentitySchema.nullable(), parentAsin: nullableText(500), storeName: nullableText(200), site: nullableText(200), title: nullableText(4000), chineseName: nullableText(4000), imageUrl: nullableText(4000), status: z.enum(["complete", "incomplete", "invalid", "unavailable", "not_found"]), reasonCode: nullableText(100) }).strict();
export const ProductTaskAssociationSchema = z.object({ status: z.enum(["linked", "unlinked", "incomplete", "conflict", "unavailable"]), identity: ProductTaskProductIdentitySchema.nullable(), basis: z.enum(["saved_snapshot", "current_profile"]).nullable(), productProfileId: z.number().int().min(0).max(2147483647).nullable(), snapshot: evidenceSchema.nullable(), currentProfile: evidenceSchema.nullable(), profileMismatch: z.boolean(), reasonCode: nullableText(100) }).strict();
export type ProductTaskAssociation = z.infer<typeof ProductTaskAssociationSchema>;
const notesSchema = z.object({ status: availability, value: nullableText(65535) }).strict();
const attachmentSummarySchema = z.object({ status: availability, total: z.number().int().min(0).max(PRODUCT_TASK_READ_LIMITS.attachments).nullable() }).strict();
export const ProductTaskAttachmentSchema = z.object({ id, workspaceId: id, taskId: id, name: z.string().min(1).max(500), byteSize: z.number().int().nonnegative().safe(), uploadedBy: id.nullable(), createdAt: timestamp }).strict();
export type ProductTaskAttachment = z.infer<typeof ProductTaskAttachmentSchema>;
const decimal = z.union([z.number().finite(), z.string().max(100)]).nullable();
export const ProductTaskItemSchema = z.object({ id, workspaceId: id, creatorId: id, title: z.string().min(1).max(200), description: nullableText(65535), status: statusSchema, priority: z.enum(["urgent", "high", "medium", "low"]).nullable(), category: nullableText(100), assigneeId: id.nullable(), assigneeName: nullableText(100), product: ProductTaskAssociationSchema, createdAt: timestamp, updatedAt: timestamp, dueDate: sourceDateSchema, completedAt: timestamp.nullable(), completionNotes: notesSchema, attachments: attachmentSummarySchema, legacy: z.object({ startDate: nullableText(100), estimatedHours: decimal, actualHours: decimal, tags: nullableText(65535) }).strict(), versionKey: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export type ProductTaskReadItem = z.infer<typeof ProductTaskItemSchema>;
const count = z.number().int().min(0).max(PRODUCT_TASK_READ_LIMITS.tasks);
const statusCounts = z.object({ backlog: count, todo: count, in_progress: count, review: count, done: count }).strict();
const associationCounts = z.object({ linked: count, unlinked: count, incomplete: count, conflict: count, unavailable: count }).strict();
export const ProductTaskStatisticsSchema = z.object({ total: count, pending: count, done: count, inProgress: count, byStatus: statusCounts, byCategory: z.array(z.object({ category: nullableText(100), count }).strict()).max(PRODUCT_TASK_READ_LIMITS.tasks), byAssignee: z.array(z.object({ assigneeId: id.nullable(), count }).strict()).max(PRODUCT_TASK_READ_LIMITS.tasks), byAssociation: associationCounts, basis: z.literal("all_authorized_matching_tasks_before_pagination") }).strict();
export type ProductTaskStatistics = z.infer<typeof ProductTaskStatisticsSchema>;
const groupSchema = z.object({ key: z.string().max(2000), label: z.string().max(4000), total: count, pageCount: count, taskIds: z.array(id).max(50), coverage: z.literal("current_page_members_with_full_matching_group_count") }).strict();
const baseResult = { identity: identitySchema, status: z.enum(["ready", "missing", "invalid", "not_found"]), reasonCode: nullableText(100), missingReason: nullableText(1000), capabilities: ProductTaskCapabilitiesSchema, viewKey: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), timestampBasis: z.literal("database_datetime_without_timezone") };
const listResult = z.object({ ...baseResult, request: ProductTaskListInputSchema, items: z.array(ProductTaskItemSchema).max(50), stats: ProductTaskStatisticsSchema.nullable(), groups: z.array(groupSchema).max(50), page: z.object({ limit: z.number().int().min(1).max(50), nextCursor: cursorSchema.nullable(), hasMore: z.boolean(), returned: z.number().int().min(0).max(50), total: count.nullable() }).strict() }).strict();
const detailResult = z.object({ ...baseResult, request: ProductTaskDetailInputSchema, task: ProductTaskItemSchema.nullable(), attachments: z.array(ProductTaskAttachmentSchema).max(50), page: z.object({ limit: z.number().int().min(1).max(50), nextCursor: cursorSchema.nullable(), hasMore: z.boolean(), returned: z.number().int().min(0).max(50), total: z.number().int().min(0).max(PRODUCT_TASK_READ_LIMITS.attachments).nullable() }).strict() }).strict();
export const ProductTaskListResultSchema = listResult.superRefine((value, ctx) => validateList(value, message => ctx.addIssue({ code: z.ZodIssueCode.custom, message })));
export const ProductTaskDetailResultSchema = detailResult.superRefine((value, ctx) => validateDetail(value, message => ctx.addIssue({ code: z.ZodIssueCode.custom, message })));
export type ProductTaskListResult = z.infer<typeof ProductTaskListResultSchema>;
export type ProductTaskDetailResult = z.infer<typeof ProductTaskDetailResultSchema>;

export type ProductTaskSourceRecord = { id: number; workspaceId: number; productProfileId: number | null; creatorId: number; title: string; description: string | null; status: string; priority: string | null; category: string | null; assigneeId: number | null; assigneeName: string | null; startDate: string | null; dueDate: string | null; completedAt: string | null; estimatedHours: string | number | null; actualHours: string | number | null; tags: string | null; createdAt: string; updatedAt: string; completionNotes: string | null; boardProduct: unknown };
export type ProductTaskProfileSource = { id: number; workspaceId: number; parentAsin: string | null; storeName: string | null; site: string | null; title: string | null; chineseName: string | null; imageUrl: string | null };
export type ProductTaskReadSource<I = ProductTaskListInput> = { identity: ProductTaskReadIdentity; input: I; capabilities: ProductTaskCapabilities; access: { all: boolean; assigneeIds: number[] }; tasks: ProductTaskSourceRecord[]; profiles: ProductTaskProfileSource[]; attachments: ProductTaskAttachment[]; complete: boolean };

const jsonLimits = { jsonDepth: 24, jsonNodes: 500000, stringLength: 65535 };
const byteSize = (value: unknown) => monthlyFinancialJsonBytes(value, jsonLimits);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { byteSize(value); return SHA256(canonical(value)).toString(); }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function canonicalTaskProductIdentity(value: unknown): ProductTaskProductIdentity | null { const result = ProductTaskProductIdentitySchema.safeParse(value); return result.success ? result.data : null; }
export function sameTaskProductIdentity(a: unknown, b: unknown): boolean { const left = canonicalTaskProductIdentity(a), right = canonicalTaskProductIdentity(b); return !!left && !!right && same(left, right); }
const productKey = (value: ProductTaskProductIdentity) => JSON.stringify([value.workspaceId, value.storeName, value.country, value.parentAsin]);
const emptyEvidence = (source: "saved_snapshot" | "current_profile", profileId: number | null, state: z.infer<typeof evidenceSchema>["status"], reasonCode: string): z.infer<typeof evidenceSchema> => ({ source, profileId, identity: null, parentAsin: null, storeName: null, site: null, title: null, chineseName: null, imageUrl: null, status: state, reasonCode });
function sourceEvidence(value: unknown, source: "saved_snapshot" | "current_profile", workspaceId: number, profileId: number | null): z.infer<typeof evidenceSchema> {
  try {
    const parsed = parseMonthlyFinancialJson(value, 256 * 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const pick = (key: string, max: number) => parsed[key] === undefined || parsed[key] === null ? null : z.string().max(max).parse(parsed[key]);
    const site = pick("site", 200), marketplace = pick("marketplace", 200), parentAsin = pick("parentAsin", 500), storeName = pick("storeName", 200);
    const fields = { source, profileId, parentAsin, storeName, site: site || marketplace, title: pick("title", 4000), chineseName: pick("chineseName", 4000), imageUrl: pick("imageUrl", 4000) };
    if (parsed.workspaceId !== undefined && parsed.workspaceId !== workspaceId || site && marketplace && normalizeMarketplaceCode(site) !== normalizeMarketplaceCode(marketplace)) return { ...fields, identity: null, status: "invalid", reasonCode: "product_scope_conflict" };
    const identity = canonicalTaskProductIdentity({ workspaceId, parentAsin: parentAsin?.trim(), storeName, country: (site || marketplace)?.trim() });
    return { ...fields, identity, status: identity ? "complete" : "incomplete", reasonCode: identity ? null : "product_scope_incomplete" };
  } catch { return emptyEvidence(source, profileId, "invalid", "product_source_invalid"); }
}
export function resolveTaskProductAssociation(record: ProductTaskSourceRecord, profile: ProductTaskProfileSource | null, capabilities: ProductTaskCapabilities): ProductTaskAssociation {
  const profileId = record.productProfileId && record.productProfileId > 0 ? record.productProfileId : null;
  const currentProfile = capabilities.profiles === "unavailable" ? emptyEvidence("current_profile", profileId, "unavailable", "profile_source_unavailable") : profile ? sourceEvidence(profile, "current_profile", record.workspaceId, profile.id) : profileId ? emptyEvidence("current_profile", profileId, "not_found", "profile_not_found") : null;
  const snapshot = capabilities.boardProduct === "unavailable" ? emptyEvidence("saved_snapshot", profileId, "unavailable", "saved_product_unavailable") : record.boardProduct === null ? null : sourceEvidence(record.boardProduct, "saved_snapshot", record.workspaceId, profileId);
  return associationFromEvidence(record.productProfileId, snapshot, currentProfile);
}
function associationFromEvidence(productProfileId: number | null, snapshot: z.infer<typeof evidenceSchema> | null, currentProfile: z.infer<typeof evidenceSchema> | null): ProductTaskAssociation {
  const profileId = productProfileId && productProfileId > 0 ? productProfileId : null;
  const base = { productProfileId, snapshot, currentProfile, profileMismatch: false };
  if (snapshot && snapshot.status !== "unavailable") {
    if (snapshot.status === "complete") return { ...base, status: "linked", identity: snapshot.identity, basis: "saved_snapshot", profileMismatch: !!currentProfile?.identity && !sameTaskProductIdentity(snapshot.identity, currentProfile.identity), reasonCode: currentProfile?.identity && !sameTaskProductIdentity(snapshot.identity, currentProfile.identity) ? "saved_product_preserved_after_profile_change" : null };
    return { ...base, status: snapshot.reasonCode === "product_scope_conflict" ? "conflict" : "incomplete", identity: null, basis: null, reasonCode: snapshot.reasonCode };
  }
  if (currentProfile?.status === "complete") return { ...base, status: "linked", identity: currentProfile.identity, basis: "current_profile", reasonCode: snapshot?.status === "unavailable" ? "saved_product_column_unavailable" : null };
  if (!profileId && snapshot === null) return { ...base, status: "unlinked", identity: null, basis: null, reasonCode: null };
  return { ...base, status: snapshot?.status === "unavailable" || currentProfile?.status === "unavailable" ? "unavailable" : currentProfile?.reasonCode === "product_scope_conflict" ? "conflict" : "incomplete", identity: null, basis: null, reasonCode: currentProfile?.reasonCode ?? snapshot?.reasonCode ?? "product_source_incomplete" };
}
function sourceDate(raw: string | null): z.infer<typeof sourceDateSchema> { const value = raw !== null && dateSchema.safeParse(raw).success ? raw : null; return { raw, value, status: raw === null || raw === "" ? "missing" : value ? "valid" : "invalid" }; }
export function compareTaskOrder(a: ProductTaskCursor, b: ProductTaskCursor): number { return b.createdAt.localeCompare(a.createdAt) || b.id - a.id; }
const afterCursor = (item: ProductTaskCursor, cursor: ProductTaskCursor | null) => cursor === null || compareTaskOrder(item, cursor) > 0;
const cursorFor = ({ createdAt, id }: ProductTaskCursor) => ({ createdAt, id });
function sourceItems<I>(source: ProductTaskReadSource<I>): ProductTaskReadItem[] {
  identitySchema.parse(source.identity); ProductTaskCapabilitiesSchema.parse(source.capabilities);
  if (!source.complete || source.tasks.length > PRODUCT_TASK_READ_LIMITS.tasks || source.profiles.length > PRODUCT_TASK_READ_LIMITS.tasks || source.attachments.length > PRODUCT_TASK_READ_LIMITS.attachments || byteSize(source) > PRODUCT_TASK_READ_LIMITS.sourceBytes) throw new ProductTaskReadError("incomplete_or_oversize_source");
  if (typeof source.access.all !== "boolean" || source.access.assigneeIds.some(value => !id.safeParse(value).success) || new Set(source.access.assigneeIds).size !== source.access.assigneeIds.length || !source.access.all && source.capabilities.partners === "unavailable" && source.access.assigneeIds.some(value => value !== source.identity.userId)) throw new ProductTaskReadError("unverified_task_access");
  const taskIds = new Set(source.tasks.map(task => task.id)), profiles = new Map(source.profiles.map(profile => [profile.id, profile]));
  if (taskIds.size !== source.tasks.length || profiles.size !== source.profiles.length || new Set(source.attachments.map(file => file.id)).size !== source.attachments.length) throw new ProductTaskReadError("duplicate_source_identity");
  for (const profile of source.profiles) if (!id.safeParse(profile.id).success || profile.workspaceId !== source.identity.workspaceId || !source.tasks.some(task => task.productProfileId === profile.id)) throw new ProductTaskReadError("profile_scope_mismatch");
  for (const attachment of source.attachments) { ProductTaskAttachmentSchema.parse(attachment); if (attachment.workspaceId !== source.identity.workspaceId || !taskIds.has(attachment.taskId) || source.capabilities.attachments !== "available") throw new ProductTaskReadError("attachment_scope_mismatch"); }
  if (source.capabilities.profiles === "unavailable" && source.profiles.length) throw new ProductTaskReadError("unavailable_profile_payload");
  return source.tasks.map(record => {
    if (record.workspaceId !== source.identity.workspaceId || !source.access.all && (record.assigneeId === null || !source.access.assigneeIds.includes(record.assigneeId))) throw new ProductTaskReadError("task_scope_mismatch");
    if (source.capabilities.completionNotes === "unavailable" && record.completionNotes !== null || source.capabilities.boardProduct === "unavailable" && record.boardProduct !== null) throw new ProductTaskReadError("unavailable_field_payload");
    const attachments = source.attachments.filter(file => file.taskId === record.id).sort(compareTaskOrder);
    const item = { id: record.id, workspaceId: record.workspaceId, creatorId: record.creatorId, title: record.title, description: record.description, status: record.status, priority: record.priority, category: record.category, assigneeId: record.assigneeId, assigneeName: record.assigneeName, product: resolveTaskProductAssociation(record, profiles.get(record.productProfileId ?? 0) ?? null, source.capabilities), createdAt: record.createdAt, updatedAt: record.updatedAt, dueDate: sourceDate(record.dueDate), completedAt: record.completedAt, completionNotes: { status: source.capabilities.completionNotes, value: record.completionNotes }, attachments: { status: source.capabilities.attachments, total: source.capabilities.attachments === "available" ? attachments.length : null }, legacy: { startDate: record.startDate, estimatedHours: record.estimatedHours, actualHours: record.actualHours, tags: record.tags } };
    return ProductTaskItemSchema.parse({ ...item, versionKey: digest({ item, attachments, capabilities: source.capabilities }) });
  }).sort(compareTaskOrder);
}
export function matchesTaskFilters(task: ProductTaskReadItem, input: ProductTaskListInput): boolean {
  if (input.product && !sameTaskProductIdentity(task.product.identity, input.product) || input.association === "unlinked" && task.product.status !== "unlinked" || input.association === "issues" && ["linked", "unlinked"].includes(task.product.status) || input.assigneeId !== null && task.assigneeId !== input.assigneeId || input.unassignedOnly && task.assigneeId !== null || input.status !== null && task.status !== input.status || input.category !== null && task.category !== input.category) return false;
  const search = input.search.trim().toLocaleLowerCase(), evidence = task.product.basis === "saved_snapshot" ? task.product.snapshot : task.product.currentProfile;
  return !search || [task.title, task.description, evidence?.title, evidence?.chineseName, task.product.identity?.parentAsin].some(value => value?.toLocaleLowerCase().includes(search));
}
export function buildTaskStatistics(tasks: ProductTaskReadItem[]): ProductTaskStatistics {
  const byStatus = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 }, byAssociation = { linked: 0, unlinked: 0, incomplete: 0, conflict: 0, unavailable: 0 }, categories = new Map<string | null, number>(), assignees = new Map<number | null, number>();
  for (const task of tasks) { byStatus[task.status]++; byAssociation[task.product.status]++; categories.set(task.category, (categories.get(task.category) ?? 0) + 1); assignees.set(task.assigneeId, (assignees.get(task.assigneeId) ?? 0) + 1); }
  return { total: tasks.length, pending: tasks.length - byStatus.done, done: byStatus.done, inProgress: byStatus.in_progress, byStatus, byAssociation, byCategory: [...categories].sort(([a], [b]) => JSON.stringify(a).localeCompare(JSON.stringify(b))).map(([category, count]) => ({ category, count })), byAssignee: [...assignees].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([assigneeId, count]) => ({ assigneeId, count })), basis: "all_authorized_matching_tasks_before_pagination" };
}
function taskGroup(task: ProductTaskReadItem, groupBy: ProductTaskListInput["groupBy"]): { key: string; label: string } {
  if (groupBy === "none") return { key: "all", label: "全部任务" };
  if (groupBy === "status") return { key: task.status, label: task.status };
  if (groupBy === "type") return { key: JSON.stringify(task.category), label: task.category ?? "未分类" };
  return task.product.identity ? { key: productKey(task.product.identity), label: `${task.product.identity.parentAsin} · ${task.product.identity.storeName} / ${task.product.identity.country}` } : { key: `association:${task.product.status}`, label: task.product.status === "unlinked" ? "未关联商品" : `关联待核验（${task.product.status}）` };
}
export function groupTaskPage(page: ProductTaskReadItem[], allMatching: ProductTaskReadItem[], groupBy: ProductTaskListInput["groupBy"]): z.infer<typeof groupSchema>[] {
  const groups = new Map<string, z.infer<typeof groupSchema>>();
  for (const task of page) { const { key, label } = taskGroup(task, groupBy), group = groups.get(key) ?? { key, label, total: allMatching.filter(value => taskGroup(value, groupBy).key === key).length, pageCount: 0, taskIds: [], coverage: "current_page_members_with_full_matching_group_count" as const }; group.taskIds.push(task.id); group.pageCount++; groups.set(key, group); }
  return [...groups.values()];
}
type Failure = { identity: ProductTaskReadIdentity; status: "missing" | "not_found" | "invalid"; reasonCode: string; missingReason: string; capabilities: ProductTaskCapabilities };
export function buildProductTaskReadFailure(value: Failure & { kind: "list"; input: ProductTaskListInput }): ProductTaskListResult;
export function buildProductTaskReadFailure(value: Failure & { kind: "detail"; input: ProductTaskDetailInput }): ProductTaskDetailResult;
export function buildProductTaskReadFailure(value: Failure & { kind: "list" | "detail"; input: ProductTaskListInput | ProductTaskDetailInput }): ProductTaskListResult | ProductTaskDetailResult {
  const base = { identity: value.identity, status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, capabilities: value.capabilities, viewKey: null, timestampBasis: "database_datetime_without_timezone" };
  return value.kind === "list" ? ProductTaskListResultSchema.parse({ ...base, request: value.input, items: [], stats: null, groups: [], page: { limit: (value.input as ProductTaskListInput).limit, nextCursor: null, hasMore: false, returned: 0, total: null } }) : ProductTaskDetailResultSchema.parse({ ...base, request: value.input, task: null, attachments: [], page: { limit: (value.input as ProductTaskDetailInput).attachmentLimit, nextCursor: null, hasMore: false, returned: 0, total: null } });
}
export function buildProductTaskListResult(source: ProductTaskReadSource): ProductTaskListResult {
  const input = ProductTaskListInputSchema.parse(source.input); if (input.expectedWorkspaceId !== source.identity.workspaceId) throw new ProductTaskReadError("workspace_mismatch");
  if (!source.complete) return buildProductTaskReadFailure({ ...source, input, kind: "list", status: "invalid", reasonCode: "source_incomplete", missingReason: "未证明授权任务来源完整，不以截断列表冒充完整统计" });
  const all = sourceItems(source), matching = all.filter(task => matchesTaskFilters(task, input)), remaining = matching.filter(task => afterCursor(task, input.cursor)), items = remaining.slice(0, input.limit), hasMore = remaining.length > items.length, { cursor: _cursor, ...filters } = input;
  const result = { identity: source.identity, request: input, status: "ready", reasonCode: null, missingReason: null, capabilities: source.capabilities, viewKey: digest({ identity: source.identity, capabilities: source.capabilities, access: source.access, filters, tasks: all.map(task => [task.id, task.versionKey]) }), timestampBasis: "database_datetime_without_timezone", items, stats: buildTaskStatistics(matching), groups: groupTaskPage(items, matching, input.groupBy), page: { limit: input.limit, nextCursor: hasMore ? cursorFor(items.at(-1)!) : null, hasMore, returned: items.length, total: matching.length } };
  if (byteSize(result) > PRODUCT_TASK_READ_LIMITS.resultBytes) throw new ProductTaskReadError("result_limit");
  return ProductTaskListResultSchema.parse(result);
}
export function buildProductTaskDetailResult(source: ProductTaskReadSource<ProductTaskDetailInput>): ProductTaskDetailResult {
  const input = ProductTaskDetailInputSchema.parse(source.input); if (input.expectedWorkspaceId !== source.identity.workspaceId) throw new ProductTaskReadError("workspace_mismatch");
  if (!source.complete) return buildProductTaskReadFailure({ ...source, input, kind: "detail", status: "invalid", reasonCode: "source_incomplete", missingReason: "任务或附件来源未完整读取，不返回部分详情" });
  const tasks = sourceItems(source), task = tasks.find(task => task.id === input.taskId);
  if (!task) return buildProductTaskReadFailure({ ...source, input, kind: "detail", status: "not_found", reasonCode: "task_not_visible", missingReason: "任务不存在或当前不可见" });
  const all = source.attachments.filter(file => file.taskId === input.taskId).sort(compareTaskOrder), remaining = all.filter(file => afterCursor(file, input.attachmentCursor)), attachments = remaining.slice(0, input.attachmentLimit), hasMore = remaining.length > attachments.length;
  const result = { identity: source.identity, request: input, status: "ready", reasonCode: null, missingReason: null, capabilities: source.capabilities, viewKey: digest({ identity: source.identity, task: task.versionKey }), timestampBasis: "database_datetime_without_timezone", task, attachments, page: { limit: input.attachmentLimit, nextCursor: hasMore ? cursorFor(attachments.at(-1)!) : null, hasMore, returned: attachments.length, total: task.attachments.total } };
  if (byteSize(result) > PRODUCT_TASK_READ_LIMITS.resultBytes) throw new ProductTaskReadError("result_limit");
  return ProductTaskDetailResultSchema.parse(result);
}
function validateBase(value: z.infer<typeof listResult> | z.infer<typeof detailResult>, issue: (message: string) => void) {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue("Workspace mismatch");
  if (value.status === "ready" ? value.reasonCode !== null || value.missingReason !== null || value.viewKey === null : !value.reasonCode || !value.missingReason || value.viewKey !== null) issue("Result state mismatch");
  try { if (byteSize(value) > PRODUCT_TASK_READ_LIMITS.resultBytes) issue("Result byte limit"); } catch { issue("Bounded lossless JSON required"); }
}
function validateTask(task: ProductTaskReadItem, capabilities: ProductTaskCapabilities, workspaceId: number, issue: (message: string) => void) {
  if (task.workspaceId !== workspaceId || task.product.identity && task.product.identity.workspaceId !== workspaceId) issue("Task workspace mismatch");
  if (!same(task.dueDate, sourceDate(task.dueDate.raw)) || task.completionNotes.status !== capabilities.completionNotes || task.completionNotes.status === "unavailable" && task.completionNotes.value !== null || task.attachments.status !== capabilities.attachments || (task.attachments.status === "unavailable") !== (task.attachments.total === null)) issue("Task field availability mismatch");
  const association = task.product, evidence = association.basis === "saved_snapshot" ? association.snapshot : association.basis === "current_profile" ? association.currentProfile : null;
  if (!same(association, associationFromEvidence(association.productProfileId, association.snapshot, association.currentProfile))) issue("Association state contradicts original evidence");
  if ((capabilities.boardProduct === "unavailable") !== (association.snapshot?.status === "unavailable") || (capabilities.profiles === "unavailable") !== (association.currentProfile?.status === "unavailable") || (association.productProfileId ?? 0) > 0 && association.currentProfile === null || association.snapshot && association.snapshot.source !== "saved_snapshot" || association.currentProfile && association.currentProfile.source !== "current_profile") issue("Association capability/source mismatch");
  if (association.status === "linked" ? !association.identity || !evidence?.identity || evidence.status !== "complete" || !sameTaskProductIdentity(association.identity, evidence.identity) : association.identity !== null || association.basis !== null || association.profileMismatch) issue("Association identity mismatch");
  for (const source of [association.snapshot, association.currentProfile]) if (source) {
    const fieldsIdentity = canonicalTaskProductIdentity({ workspaceId, storeName: source.storeName, country: source.site?.trim(), parentAsin: source.parentAsin?.trim() });
    const emptyFields = [source.parentAsin, source.storeName, source.site, source.title, source.chineseName, source.imageUrl].every(field => field === null);
    if (source.profileId !== ((association.productProfileId ?? 0) > 0 ? association.productProfileId : null)) issue("Association profile reference mismatch");
    if (source.status === "complete" ? !fieldsIdentity || !source.identity || !sameTaskProductIdentity(source.identity, fieldsIdentity) || source.reasonCode !== null : source.identity !== null) issue("Association source mismatch");
    if (source.status === "incomplete" && (fieldsIdentity || source.reasonCode !== "product_scope_incomplete")) issue("Complete fields cannot be marked incomplete");
    if (source.status === "invalid" && !(source.reasonCode === "product_scope_conflict" || source.reasonCode === "product_source_invalid" && emptyFields)) issue("Invalid association evidence mismatch");
    if (source.status === "unavailable" && (!emptyFields || source.reasonCode !== (source.source === "saved_snapshot" ? "saved_product_unavailable" : "profile_source_unavailable")) || source.status === "not_found" && (source.source !== "current_profile" || !emptyFields || source.reasonCode !== "profile_not_found")) issue("Unavailable association evidence mismatch");
  }
  if (association.basis === "current_profile" && association.snapshot && association.snapshot.status !== "unavailable" || association.basis === "saved_snapshot" && capabilities.boardProduct !== "available" || association.currentProfile?.status === "complete" && capabilities.profiles !== "available") issue("Association source priority mismatch");
  const mismatch = association.basis === "saved_snapshot" && !!association.currentProfile?.identity && !sameTaskProductIdentity(association.identity, association.currentProfile.identity);
  if (association.profileMismatch !== mismatch) issue("Profile mismatch flag inconsistent");
}
function validateList(value: z.infer<typeof listResult>, issue: (message: string) => void) {
  validateBase(value, issue);
  if (value.page.limit !== value.request.limit || value.page.returned !== value.items.length || value.items.length > value.page.limit) issue("Task page limit mismatch");
  if (value.status !== "ready") { if (value.items.length || value.groups.length || value.stats || value.page.total !== null || value.page.hasMore || value.page.nextCursor) issue("Unavailable list contains partial data"); return; }
  const stats = value.stats;
  if (!stats || value.page.total !== stats.total) { issue("Complete matching statistics required"); return; }
  if (stats.total !== Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0) || stats.total !== Object.values(stats.byAssociation).reduce((sum, count) => sum + count, 0) || stats.total !== stats.byCategory.reduce((sum, row) => sum + row.count, 0) || stats.total !== stats.byAssignee.reduce((sum, row) => sum + row.count, 0) || stats.pending !== stats.total - stats.done || stats.done !== stats.byStatus.done || stats.inProgress !== stats.byStatus.in_progress || new Set(stats.byCategory.map(row => row.category)).size !== stats.byCategory.length || new Set(stats.byAssignee.map(row => row.assigneeId)).size !== stats.byAssignee.length) issue("Statistics arithmetic mismatch");
  if (value.request.status !== null && stats.byStatus[value.request.status] !== stats.total || value.request.category !== null && stats.byCategory.some(row => row.count > 0 && row.category !== value.request.category) || (value.request.assigneeId !== null || value.request.unassignedOnly) && stats.byAssignee.some(row => row.count > 0 && row.assigneeId !== value.request.assigneeId) || value.request.product !== null && stats.byAssociation.linked !== stats.total || value.request.association === "unlinked" && stats.byAssociation.unlinked !== stats.total || value.request.association === "issues" && (stats.byAssociation.linked > 0 || stats.byAssociation.unlinked > 0)) issue("Matching statistics contradict request filters");
  if (new Set(value.items.map(task => task.id)).size !== value.items.length || value.items.some((task, index) => !matchesTaskFilters(task, value.request) || !afterCursor(task, value.request.cursor) || index > 0 && compareTaskOrder(value.items[index - 1], task) >= 0) || value.items.length > stats.total) issue("Task page scope/order mismatch");
  if (!value.request.cursor && value.items.length !== Math.min(stats.total, value.page.limit) || value.page.hasMore && (value.items.length !== value.page.limit || !same(value.page.nextCursor, cursorFor(value.items.at(-1)!))) || !value.page.hasMore && value.page.nextCursor !== null || !value.request.cursor && value.page.hasMore !== (stats.total > value.items.length)) issue("Task cursor continuity mismatch");
  for (const task of value.items) validateTask(task, value.capabilities, value.identity.workspaceId, issue);
  const pageStats = buildTaskStatistics(value.items);
  if (PRODUCT_TASK_STATUSES.some(status => pageStats.byStatus[status] > stats.byStatus[status]) || (Object.keys(pageStats.byAssociation) as Array<keyof typeof pageStats.byAssociation>).some(status => pageStats.byAssociation[status] > stats.byAssociation[status]) || pageStats.byCategory.some(row => row.count > (stats.byCategory.find(other => other.category === row.category)?.count ?? 0)) || pageStats.byAssignee.some(row => row.count > (stats.byAssignee.find(other => other.assigneeId === row.assigneeId)?.count ?? 0))) issue("Page counts exceed matching statistics");
  if (!value.request.cursor && value.items.length === stats.total && !same(pageStats, stats)) issue("Complete page statistics must exactly replay");
  const expectedGroups = groupTaskPage(value.items, value.items, value.request.groupBy);
  if (expectedGroups.length !== value.groups.length || expectedGroups.some((group, index) => !same({ ...group, total: value.groups[index]?.total }, value.groups[index]) || value.groups[index].total < group.pageCount || value.groups[index].total > stats.total)) issue("Page grouping mismatch");
  for (const group of value.groups) {
    const first = value.items.find(task => task.id === group.taskIds[0]);
    const exactCount = value.request.groupBy === "none" ? stats.total : value.request.groupBy === "status" && first ? stats.byStatus[first.status] : value.request.groupBy === "type" && first ? stats.byCategory.find(row => row.category === first.category)?.count : !value.request.cursor && value.items.length === stats.total ? expectedGroups.find(row => row.key === group.key)?.total : undefined;
    if (exactCount !== undefined && group.total !== exactCount) issue("Full matching group count mismatch");
  }
}
function validateDetail(value: z.infer<typeof detailResult>, issue: (message: string) => void) {
  validateBase(value, issue);
  if (value.page.limit !== value.request.attachmentLimit || value.page.returned !== value.attachments.length || value.attachments.length > value.page.limit) issue("Attachment page limit mismatch");
  if (value.status !== "ready") { if (value.task || value.attachments.length || value.page.total !== null || value.page.hasMore || value.page.nextCursor) issue("Unavailable detail contains partial data"); return; }
  const task = value.task; if (!task || task.id !== value.request.taskId) { issue("Detail task identity mismatch"); return; }
  validateTask(task, value.capabilities, value.identity.workspaceId, issue);
  if (value.page.total !== task.attachments.total || value.viewKey !== digest({ identity: value.identity, task: task.versionKey })) issue("Detail version/total mismatch");
  if (value.capabilities.attachments === "unavailable") { if (value.attachments.length || value.page.hasMore || value.page.nextCursor) issue("Unavailable attachments disclosed"); return; }
  if (new Set(value.attachments.map(file => file.id)).size !== value.attachments.length || value.attachments.some((file, index) => file.taskId !== task.id || file.workspaceId !== task.workspaceId || !afterCursor(file, value.request.attachmentCursor) || index > 0 && compareTaskOrder(value.attachments[index - 1], file) >= 0)) issue("Attachment scope/order mismatch");
  if (value.attachments.length > (value.page.total ?? 0) || !value.request.attachmentCursor && value.attachments.length !== Math.min(value.page.limit, value.page.total ?? 0) || value.page.hasMore && (value.attachments.length !== value.page.limit || !same(value.page.nextCursor, cursorFor(value.attachments.at(-1)!))) || !value.page.hasMore && value.page.nextCursor !== null || !value.request.attachmentCursor && value.page.hasMore !== ((value.page.total ?? 0) > value.attachments.length)) issue("Attachment cursor continuity mismatch");
}
