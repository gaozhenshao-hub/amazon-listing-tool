import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { PRODUCT_TASK_STATUSES, ProductTaskProductIdentitySchema } from "./productTaskRead";

export const PRODUCT_TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_TASK_TEXT_MAX_BYTES = 65535;
export const PRODUCT_TASK_ROW_MAX_BYTES = 128 * 1024;
export const PRODUCT_TASK_SNAPSHOT_MAX_BYTES = 256 * 1024;
export const productTaskWriteUtf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const PRODUCT_TASK_ATTACHMENT_EXTENSIONS = /\.(png|jpe?g|webp|gif|pdf|xlsx?|csv|docx?|pptx?|txt|zip)$/iu;
const id = z.number().int().positive().max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ProductTaskWriteIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type ProductTaskWriteIdentity = z.infer<typeof ProductTaskWriteIdentitySchema>;
const operationId = z.string().uuid().transform(value => value.toLowerCase());
const title = z.string().trim().min(1).max(200);
const category = z.string().max(100).nullable();
const status = z.enum(PRODUCT_TASK_STATUSES);
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(`${value}T00:00:00Z`); return Number(value.slice(0, 4)) >= 1000 && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}).nullable();
export const ProductTaskAttachmentNameSchema = z.string().min(1).max(200).refine(value => !/[\x00-\x1f\x7f/\\]/u.test(value) && PRODUCT_TASK_ATTACHMENT_EXTENSIONS.test(value));
export const ProductTaskAttachmentBase64Schema = z.string().min(4).max(Math.ceil(PRODUCT_TASK_ATTACHMENT_MAX_BYTES / 3) * 4).refine(value => {
  if (value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  const length = value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  return length > 0 && length <= PRODUCT_TASK_ATTACHMENT_MAX_BYTES;
});
export const ProductTaskWriteOptionsInputSchema = z.object({ expectedWorkspaceId: id }).strict();
export const ProductTaskWriteProductsInputSchema = ProductTaskWriteOptionsInputSchema.extend({ assigneeId: id, search: z.string().max(200), offset: z.number().int().min(0).max(5000), limit: z.number().int().min(1).max(50) }).strict();
const operation = { expectedWorkspaceId: id, operationId };
const patch = z.object({ title: title.optional(), category: category.optional(), status: status.optional(), dueDate: dueDate.optional(), completionNotes: z.string().max(65535).refine(value => productTaskWriteUtf8Bytes(value) <= PRODUCT_TASK_TEXT_MAX_BYTES).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined));
export const ProductTaskWriteExecuteInputSchema = z.discriminatedUnion("action", [
  z.object({ ...operation, action: z.literal("create"), title, assigneeId: id, category, status, dueDate, productKey: hash.nullable() }).strict(),
  z.object({ ...operation, action: z.literal("update"), taskId: id, expectedVersion: hash, patch }).strict(),
  z.object({ ...operation, action: z.literal("upload"), taskId: id, expectedVersion: hash, name: ProductTaskAttachmentNameSchema, base64: ProductTaskAttachmentBase64Schema }).strict(),
  z.object({ ...operation, action: z.literal("deleteAttachment"), taskId: id, expectedVersion: hash, attachmentId: id }).strict(),
]);
export const ProductTaskWriteRecoverInputSchema = z.object({ ...operation, decision: z.enum(["check", "complete_upload", "cancel"]) }).strict();
export const ProductTaskWriteDownloadInputSchema = ProductTaskWriteOptionsInputSchema.extend({ taskId: id, attachmentId: id }).strict();
export type ProductTaskWriteOptionsInput = z.infer<typeof ProductTaskWriteOptionsInputSchema>;
export type ProductTaskWriteProductsInput = z.infer<typeof ProductTaskWriteProductsInputSchema>;
export type ProductTaskWriteExecuteInput = z.infer<typeof ProductTaskWriteExecuteInputSchema>;
export type ProductTaskWriteRecoverInput = z.infer<typeof ProductTaskWriteRecoverInputSchema>;
export type ProductTaskWriteDownloadInput = z.infer<typeof ProductTaskWriteDownloadInputSchema>;
export type ProductTaskWriteAction = ProductTaskWriteExecuteInput["action"];
export const ProductTaskWriteResultSchema = z.object({ identity: ProductTaskWriteIdentitySchema, operationId, action: z.enum(["create", "update", "upload", "deleteAttachment"]).nullable(), status: z.enum(["committed", "cancelled", "unknown"]), taskId: id.nullable(), attachmentId: id.nullable(), taskVersion: hash.nullable(), reasonCode: z.string().min(1).max(100).nullable() }).strict().superRefine((value, ctx) => {
  if (value.status === "committed" ? !value.action || !value.taskId || !value.taskVersion || value.reasonCode !== null || (["upload", "deleteAttachment"].includes(value.action) ? value.attachmentId === null : value.attachmentId !== null) : value.reasonCode === null || value.taskVersion !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Operation receipt state mismatch" });
});
export type ProductTaskWriteResult = z.infer<typeof ProductTaskWriteResultSchema>;
export const ProductTaskWriteCapabilitySchema = z.object({ status: z.enum(["available", "unavailable"]), reasonCode: z.string().min(1).max(100).nullable() }).strict().refine(value => (value.status === "available") === (value.reasonCode === null));
export type ProductTaskWriteCapability = z.infer<typeof ProductTaskWriteCapabilitySchema>;
export const ProductTaskWriteCapabilitiesSchema = z.object({ create: ProductTaskWriteCapabilitySchema, update: ProductTaskWriteCapabilitySchema, upload: ProductTaskWriteCapabilitySchema, deleteAttachment: ProductTaskWriteCapabilitySchema, download: ProductTaskWriteCapabilitySchema, partners: ProductTaskWriteCapabilitySchema }).strict();
export type ProductTaskWriteCapabilities = z.infer<typeof ProductTaskWriteCapabilitiesSchema>;
export const ProductTaskWriteOptionsResultSchema = z.object({ identity: ProductTaskWriteIdentitySchema, members: z.array(z.object({ id, displayName: z.string().min(1).max(320) }).strict()).max(5000), capabilities: ProductTaskWriteCapabilitiesSchema }).strict().refine(value => new Set(value.members.map(member => member.id)).size === value.members.length);
export type ProductTaskWriteOptionsResult = z.infer<typeof ProductTaskWriteOptionsResultSchema>;
export const ProductTaskWriteProductSchema = z.object({ key: hash, identity: ProductTaskProductIdentitySchema, profileId: id.nullable(), source: z.enum(["profile", "saihu"]), sourceMode: z.enum(["profile", "daily", "legacy_weekly"]), sourceId: id, versionKey: hash, title: z.string().max(4000), chineseName: z.string().max(4000).nullable(), imageUrl: z.string().max(4000).nullable() }).strict().refine(value => (value.source === "profile") === (value.sourceMode === "profile"));
export type ProductTaskWriteProduct = z.infer<typeof ProductTaskWriteProductSchema>;
export const ProductTaskWriteCandidateCapabilitiesSchema = z.object({ profiles: ProductTaskWriteCapabilitySchema, saihuLatest: ProductTaskWriteCapabilitySchema, numericMappings: ProductTaskWriteCapabilitySchema, manualOwners: ProductTaskWriteCapabilitySchema, members: ProductTaskWriteCapabilitySchema }).strict();
export type ProductTaskWriteCandidateCapabilities = z.infer<typeof ProductTaskWriteCandidateCapabilitiesSchema>;
export const ProductTaskWriteProductsResultSchema = z.object({ identity: ProductTaskWriteIdentitySchema, request: ProductTaskWriteProductsInputSchema, availability: ProductTaskWriteCapabilitySchema, capabilities: ProductTaskWriteCandidateCapabilitiesSchema, coverage: z.enum(["complete", "partial", "unavailable"]), viewKey: hash.nullable(), items: z.array(ProductTaskWriteProductSchema).max(50), page: z.object({ offset: z.number().int().min(0).max(5000), limit: z.number().int().min(1).max(50), total: z.number().int().min(0).max(5000).nullable(), hasMore: z.boolean(), nextOffset: z.number().int().min(1).max(5000).nullable() }).strict() }).strict().superRefine((value, ctx) => {
  const bad = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate scope/completeness mismatch" });
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId || value.page.offset !== value.request.offset || value.page.limit !== value.request.limit || value.items.some(item => item.identity.workspaceId !== value.identity.workspaceId || item.key !== productTaskProductKey(item)) || new Set(value.items.map(item => item.key)).size !== value.items.length) bad();
  if (value.availability.status === "unavailable") { if (value.coverage !== "unavailable" || value.items.length || value.viewKey || value.page.total !== null || value.page.hasMore || value.page.nextOffset !== null) bad(); return; }
  if (value.coverage === "unavailable" || value.coverage === "complete" && (Object.values(value.capabilities).some(capability => capability.status !== "available") || value.items.some(item => item.sourceMode === "legacy_weekly")) || value.capabilities.members.status !== "available" || value.items.some(item => value.capabilities[item.source === "profile" ? "profiles" : "saihuLatest"].status !== "available")) bad();
  const total = value.page.total;
  if (!value.viewKey || total === null || value.items.length !== Math.min(value.page.limit, Math.max(0, (total ?? 0) - value.page.offset)) || value.page.hasMore !== (value.page.offset + value.items.length < (total ?? 0)) || value.page.nextOffset !== (value.page.hasMore ? value.page.offset + value.items.length : null)) bad();
});
export type ProductTaskWriteProductsResult = z.infer<typeof ProductTaskWriteProductsResultSchema>;
export const ProductTaskWriteDownloadResultSchema = z.object({ identity: ProductTaskWriteIdentitySchema, taskId: id, attachmentId: id, name: ProductTaskAttachmentNameSchema, url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash; }), expiresSeconds: z.number().int().min(60).max(300) }).strict();
export type ProductTaskWriteDownloadResult = z.infer<typeof ProductTaskWriteDownloadResultSchema>;

/** Only plain bounded JSON is accepted; hashes bind content, never confer permission. */
export function productTaskWriteCanonical(value: unknown): string {
  let nodes = 0;
  function visit(item: unknown, depth: number): string {
    if (++nodes > 100000 || depth > 16) throw new Error("TASK_WRITE_JSON_INVALID");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item === "string") { if (item.length > Math.ceil(PRODUCT_TASK_ATTACHMENT_MAX_BYTES / 3) * 4) throw new Error("TASK_WRITE_JSON_INVALID"); return JSON.stringify(item); }
    if (!item || typeof item !== "object" || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("TASK_WRITE_JSON_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).some(key => typeof key !== "string") || Object.values(descriptors).some(d => !Object.prototype.hasOwnProperty.call(d, "value"))) throw new Error("TASK_WRITE_JSON_INVALID");
    if (Array.isArray(item)) { if (Object.keys(item).length !== item.length) throw new Error("TASK_WRITE_JSON_INVALID"); return `[${item.map(child => visit(child, depth + 1)).join(",")}]`; }
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
  }
  return visit(value, 0);
}
export const productTaskWriteHash = (value: unknown) => SHA256(productTaskWriteCanonical(value)).toString();
export function productTaskProductKey(product: Omit<ProductTaskWriteProduct, "key"> | ProductTaskWriteProduct): string {
  const { identity, profileId, source, sourceMode, sourceId, versionKey, title, chineseName, imageUrl } = product;
  return productTaskWriteHash({ identity: ProductTaskProductIdentitySchema.parse(identity), profileId, source, sourceMode, sourceId, versionKey, title, chineseName, imageUrl });
}
