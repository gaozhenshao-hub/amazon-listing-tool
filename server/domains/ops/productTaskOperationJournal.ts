import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { PRODUCT_TASK_ATTACHMENT_MAX_BYTES, ProductTaskAttachmentNameSchema, ProductTaskWriteExecuteInputSchema, ProductTaskWriteIdentitySchema, ProductTaskWriteResultSchema, productTaskWriteCanonical, productTaskWriteHash, type ProductTaskWriteExecuteInput, type ProductTaskWriteIdentity, type ProductTaskWriteResult } from "../../../shared/productTaskWrite";

const id = z.number().int().positive().max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
export class ProductTaskJournalError extends Error { constructor(public readonly code: string) { super(code); this.name = "ProductTaskJournalError"; } }
const fail = (code: string): never => { throw new ProductTaskJournalError(code); };
export function productTaskOperationKey(identity: ProductTaskWriteIdentity, operationId: string): string { return productTaskWriteHash({ identity: ProductTaskWriteIdentitySchema.parse(identity), operationId: uuid.parse(operationId) }); }
export function productTaskOperationAuditIds(identity: ProductTaskWriteIdentity, operationId: string) { const key = productTaskOperationKey(identity, operationId); return { prepared: `ptask_prepare_${key}`, final: `ptask_final_${key}` }; }
export function decodeProductTaskAttachment(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > PRODUCT_TASK_ATTACHMENT_MAX_BYTES || bytes.toString("base64") !== base64) return fail("TASK_ATTACHMENT_INVALID_BASE64");
  return bytes;
}
export function productTaskOperationRequestHash(raw: ProductTaskWriteExecuteInput): string {
  const command = ProductTaskWriteExecuteInputSchema.parse(raw);
  if (command.action !== "upload") return productTaskWriteHash(command);
  const { base64, ...rest } = command, bytes = decodeProductTaskAttachment(base64);
  return productTaskWriteHash({ ...rest, contentHash: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length });
}
export const ProductTaskPreparedUploadSchema = z.object({ identity: ProductTaskWriteIdentitySchema, operationId: uuid, action: z.literal("upload"), requestHash: hash, taskId: id, expectedVersion: hash, name: ProductTaskAttachmentNameSchema, contentHash: hash, byteSize: z.number().int().min(1).max(PRODUCT_TASK_ATTACHMENT_MAX_BYTES), provider: z.enum(["s3", "oss", "local"]), domainHash: hash.optional(), objectKey: z.string().min(1).max(300), storageUri: z.string().min(1).max(400) }).strict().superRefine((value, ctx) => {
  const localPrefix = value.provider === "local" ? `${value.domainHash}-${value.contentHash}-${value.byteSize}-` : "";
  if ((value.provider === "local") !== Boolean(value.domainHash)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Storage domain binding missing or unexpected" });
  const key = `ops-tasks/${value.identity.workspaceId}/${value.taskId}/${localPrefix}${productTaskOperationKey(value.identity, value.operationId)}.${value.name.split(".").at(-1)!.toLowerCase()}`;
  const requestHash = productTaskWriteHash({ expectedWorkspaceId: value.identity.workspaceId, operationId: value.operationId, action: "upload", taskId: value.taskId, expectedVersion: value.expectedVersion, name: value.name, contentHash: value.contentHash, byteSize: value.byteSize });
  if (value.objectKey !== key || value.storageUri !== `storage://${value.provider}/${key}` || value.requestHash !== requestHash) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Prepared upload object binding mismatch" });
});
export type ProductTaskPreparedUpload = z.infer<typeof ProductTaskPreparedUploadSchema>;
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), requestHash: hash.nullable(), receipt: ProductTaskWriteResultSchema }).strict().refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "committed" || value.requestHash !== null));
const preparedSchema = z.object({ version: z.literal(1), kind: z.literal("upload_prepared"), prepared: ProductTaskPreparedUploadSchema }).strict();
export type ProductTaskJournalFinal = z.infer<typeof finalSchema>;
export type ProductTaskJournalState = { final: ProductTaskJournalFinal | null; prepared: ProductTaskPreparedUpload | null };
export type ProductTaskJournalScope = ProductTaskWriteIdentity & { operationId: string; actorRole: string };
export interface ProductTaskJournalTransaction { execute(statement: SQL): Promise<unknown> }
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== values.length + 1) return fail("TASK_JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function encoded(value: unknown): string { const text = productTaskWriteCanonical(value); if (Buffer.byteLength(text, "utf8") > 32768 || Buffer.from(text, "utf8").toString("utf8") !== text) return fail("TASK_JOURNAL_PAYLOAD_INVALID"); return text; }
function parsed(text: unknown): unknown { if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 32768) return fail("TASK_JOURNAL_PAYLOAD_INVALID"); try { const value = JSON.parse(text); encoded(value); return value; } catch { return fail("TASK_JOURNAL_PAYLOAD_INVALID"); } }

/** The caller MUST hold the same current-actor serialization lock throughout its
 * real transaction, including task mutation + finalize. No independent connection,
 * best-effort auditing, storage I/O, background task or automatic retry occurs here. */
export function createProductTaskOperationJournal(tx: ProductTaskJournalTransaction, raw: ProductTaskJournalScope) {
  const identity = ProductTaskWriteIdentitySchema.parse({ userId: raw.userId, workspaceId: raw.workspaceId }), operationId = uuid.parse(raw.operationId), actorRole = z.string().trim().min(1).max(64).parse(raw.actorRole), keys = productTaskOperationAuditIds(identity, operationId);
  function bound(value: { identity: ProductTaskWriteIdentity; operationId: string }) { if (productTaskWriteCanonical(value.identity) !== productTaskWriteCanonical(identity) || value.operationId !== operationId) fail("TASK_JOURNAL_SCOPE_MISMATCH"); }
  async function read(): Promise<ProductTaskJournalState> {
    const result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId IN (?,?) LIMIT 3 FOR UPDATE", [keys.prepared, keys.final]));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 2) return fail("TASK_JOURNAL_READ_INVALID");
    const state: ProductTaskJournalState = { final: null, prepared: null }, seen = new Set<string>();
    for (const row of result[0] as Record<string, unknown>[]) {
      if (typeof row.auditId !== "string" || seen.has(row.auditId) || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.resourceType !== "ops_task_operation" || row.resourceId !== operationId || row.status !== "success") return fail("TASK_JOURNAL_SCOPE_MISMATCH");
      seen.add(row.auditId);
      if (row.auditId === keys.prepared && row.action === "ops_task.prepare") { const value = preparedSchema.parse(parsed(row.metadataText)); bound(value.prepared); state.prepared = value.prepared; }
      else if (row.auditId === keys.final && row.action === "ops_task.final") { const value = finalSchema.parse(parsed(row.metadataText)); bound(value.receipt); state.final = value; }
      else return fail("TASK_JOURNAL_SCOPE_MISMATCH");
    }
    if (state.prepared && state.final && (state.final.requestHash !== state.prepared.requestHash || state.final.receipt.action !== "upload" || state.final.receipt.taskId !== state.prepared.taskId)) return fail("TASK_JOURNAL_RECEIPT_MISMATCH");
    return state;
  }
  async function insert(auditId: string, action: "ops_task.prepare" | "ops_task.final", payload: unknown) {
    const result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'ops_task_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actorRole, action, operationId, encoded(payload)]));
    if (!Array.isArray(result) || result[0]?.affectedRows !== 1) return fail("TASK_JOURNAL_WRITE_UNCONFIRMED");
  }
  async function prepare(rawPrepared: ProductTaskPreparedUpload) {
    const prepared = ProductTaskPreparedUploadSchema.parse(rawPrepared); bound(prepared); const previous = await read();
    if (previous.final) return fail(previous.final.receipt.status === "cancelled" ? "TASK_OPERATION_CANCELLED" : "TASK_OPERATION_FINAL");
    if (previous.prepared) { if (encoded(previous.prepared) !== encoded(prepared)) return fail("TASK_OPERATION_CONTENT_CONFLICT"); return { created: false, prepared: previous.prepared }; }
    await insert(keys.prepared, "ops_task.prepare", { version: 1, kind: "upload_prepared", prepared });
    const saved = await read(); if (!saved.prepared || encoded(saved.prepared) !== encoded(prepared) || saved.final) return fail("TASK_JOURNAL_READBACK_MISMATCH");
    return { created: true, prepared: saved.prepared };
  }
  async function finalize(rawReceipt: ProductTaskWriteResult, requestHash: string | null): Promise<ProductTaskWriteResult> {
    const receipt = ProductTaskWriteResultSchema.parse(rawReceipt); bound(receipt);
    const value = finalSchema.parse({ version: 1, kind: "final", requestHash, receipt }), previous = await read();
    if (previous.final) {
      if (previous.final.receipt.status === "cancelled") { if (receipt.status !== "cancelled") return fail("TASK_OPERATION_CANCELLED"); return previous.final.receipt; }
      if (previous.final.requestHash !== requestHash || encoded(previous.final.receipt) !== encoded(receipt)) return fail("TASK_OPERATION_CONTENT_CONFLICT");
      return previous.final.receipt;
    }
    if (previous.prepared && (previous.prepared.requestHash !== requestHash || receipt.action !== "upload" || receipt.taskId !== previous.prepared.taskId) || receipt.status === "committed" && receipt.action === "upload" && !previous.prepared) return fail("TASK_JOURNAL_RECEIPT_MISMATCH");
    await insert(keys.final, "ops_task.final", value);
    const saved = await read(); if (!saved.final || encoded(saved.final) !== encoded(value)) return fail("TASK_JOURNAL_READBACK_MISMATCH");
    return saved.final.receipt;
  }
  async function cancel(): Promise<ProductTaskWriteResult> {
    const state = await read(); if (state.final) return state.final.receipt;
    return finalize({ identity, operationId, action: state.prepared ? "upload" : null, status: "cancelled", taskId: state.prepared?.taskId ?? null, attachmentId: null, taskVersion: null, reasonCode: "operation_cancelled" }, state.prepared?.requestHash ?? null);
  }
  return { read, prepare, finalize, cancel };
}
