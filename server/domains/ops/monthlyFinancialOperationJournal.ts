import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { MONTHLY_FINANCIAL_IMPORT_LIMITS, MONTHLY_FINANCIAL_IMPORT_VERSION, MonthlyFinancialImportFileNameSchema, monthlyFinancialImportBytesHash } from "../../../shared/monthlyFinancialImport";
import { MonthlyFinancialWriteIdentitySchema, MonthlyFinancialWriteResultSchema, MonthlyFinancialWriteUploadInputSchema, MonthlyFinancialWriteConfirmInputSchema, MonthlyFinancialWriteRevokeInputSchema, monthlyFinancialWriteCanonical, monthlyFinancialWriteHash, type MonthlyFinancialWriteIdentity, type MonthlyFinancialWriteResult, type MonthlyFinancialWriteUploadInput, type MonthlyFinancialWriteConfirmInput, type MonthlyFinancialWriteRevokeInput } from "../../../shared/monthlyFinancialWrite";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
export class MonthlyFinancialJournalError extends Error { constructor(public readonly code: string) { super(code); this.name = "MonthlyFinancialJournalError"; } }
const fail = (code: string): never => { throw new MonthlyFinancialJournalError(code); };
export function monthlyFinancialOperationKey(identity: MonthlyFinancialWriteIdentity, operationId: string): string { return monthlyFinancialWriteHash({ identity: MonthlyFinancialWriteIdentitySchema.parse(identity), operationId: uuid.parse(operationId) }); }
export function monthlyFinancialOperationAuditIds(identity: MonthlyFinancialWriteIdentity, operationId: string) { const key = monthlyFinancialOperationKey(identity, operationId); return { prepared: `monthly_prepare_${key}`, final: `monthly_final_${key}` }; }
export function decodeMonthlyFinancialUpload(base64: string): Buffer { const bytes = Buffer.from(base64, "base64"); if (!bytes.length || bytes.length > MONTHLY_FINANCIAL_IMPORT_LIMITS.fileBytes || bytes.toString("base64") !== base64) return fail("MONTHLY_UPLOAD_INVALID_BASE64"); return bytes; }
export function monthlyFinancialOperationRequestHash(action: "upload", raw: MonthlyFinancialWriteUploadInput): string;
export function monthlyFinancialOperationRequestHash(action: "confirm" | "revoke", raw: MonthlyFinancialWriteConfirmInput | MonthlyFinancialWriteRevokeInput): string;
export function monthlyFinancialOperationRequestHash(action: "upload" | "confirm" | "revoke", raw: MonthlyFinancialWriteUploadInput | MonthlyFinancialWriteConfirmInput | MonthlyFinancialWriteRevokeInput): string {
  if (action !== "upload") return monthlyFinancialWriteHash({ action, ...(action === "confirm" ? MonthlyFinancialWriteConfirmInputSchema : MonthlyFinancialWriteRevokeInputSchema).parse(raw) });
  const { base64, ...input } = MonthlyFinancialWriteUploadInputSchema.parse(raw), bytes = decodeMonthlyFinancialUpload(base64);
  return monthlyFinancialWriteHash({ action, ...input, fileHash: monthlyFinancialImportBytesHash(bytes), byteSize: bytes.length });
}
export const MonthlyFinancialPreparedUploadSchema = z.object({ identity: MonthlyFinancialWriteIdentitySchema, operationId: uuid, action: z.literal("upload"), requestHash: hash, fileName: MonthlyFinancialImportFileNameSchema, format: z.enum(["xlsx", "csv"]), fileHash: hash, byteSize: z.number().int().positive().max(MONTHLY_FINANCIAL_IMPORT_LIMITS.fileBytes), parserVersion: z.literal(MONTHLY_FINANCIAL_IMPORT_VERSION), provider: z.enum(["s3", "oss"]), objectKey: z.string().min(1).max(300), storageUri: z.string().min(1).max(400) }).strict().superRefine((value, ctx) => {
  const objectKey = `monthly-financial/${value.identity.workspaceId}/${monthlyFinancialOperationKey(value.identity, value.operationId)}.${value.format}`;
  const requestHash = monthlyFinancialWriteHash({ action: "upload", expectedWorkspaceId: value.identity.workspaceId, operationId: value.operationId, fileName: value.fileName, format: value.format, fileHash: value.fileHash, byteSize: value.byteSize });
  if (!value.fileName.toLowerCase().endsWith(`.${value.format}`) || value.objectKey !== objectKey || value.storageUri !== `storage://${value.provider}/${objectKey}` || value.requestHash !== requestHash) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Prepared monthly upload binding mismatch" });
});
export type MonthlyFinancialPreparedUpload = z.infer<typeof MonthlyFinancialPreparedUploadSchema>;
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), requestHash: hash.nullable(), receipt: MonthlyFinancialWriteResultSchema }).strict().refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "committed" || value.requestHash !== null), "Only acknowledged final receipt may be persisted");
const preparedSchema = z.object({ version: z.literal(1), kind: z.literal("upload_prepared"), prepared: MonthlyFinancialPreparedUploadSchema }).strict();
export type MonthlyFinancialJournalFinal = z.infer<typeof finalSchema>;
export type MonthlyFinancialJournalState = { final: MonthlyFinancialJournalFinal | null; prepared: MonthlyFinancialPreparedUpload | null };
export type MonthlyFinancialJournalScope = MonthlyFinancialWriteIdentity & { operationId: string; actorRole: string };
export interface MonthlyFinancialJournalTransaction { execute(statement: SQL): Promise<unknown> }
function statement(text: string, values: unknown[]): SQL { const parts = text.split("?"); if (parts.length !== values.length + 1) return fail("MONTHLY_JOURNAL_SQL_INVALID"); return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw("")); }
function encoded(value: unknown): string { const result = monthlyFinancialWriteCanonical(value); if (Buffer.byteLength(result, "utf8") > 32768) return fail("MONTHLY_JOURNAL_PAYLOAD_INVALID"); return result; }
function parsed(value: unknown): unknown { if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 32768) return fail("MONTHLY_JOURNAL_PAYLOAD_INVALID"); try { const result = JSON.parse(value); encoded(result); return result; } catch { return fail("MONTHLY_JOURNAL_PAYLOAD_INVALID"); } }

/** Caller holds current-actor + workspace locks in ONE real transaction, including
 * batch/artifact mutation and final receipt. No own transaction, storage I/O,
 * automatic retry, model invocation or best-effort audit occurs here. */
export function createMonthlyFinancialOperationJournal(tx: MonthlyFinancialJournalTransaction, raw: MonthlyFinancialJournalScope) {
  const identity = MonthlyFinancialWriteIdentitySchema.parse({ userId: raw.userId, workspaceId: raw.workspaceId }), operationId = uuid.parse(raw.operationId), actorRole = z.string().trim().min(1).max(64).parse(raw.actorRole), keys = monthlyFinancialOperationAuditIds(identity, operationId);
  const bound = (value: { identity: MonthlyFinancialWriteIdentity; operationId: string }) => { if (monthlyFinancialWriteCanonical(value.identity) !== monthlyFinancialWriteCanonical(identity) || value.operationId !== operationId) return fail("MONTHLY_JOURNAL_SCOPE_MISMATCH"); };
  async function read(): Promise<MonthlyFinancialJournalState> {
    const result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId IN (?,?) LIMIT 3 FOR UPDATE", [keys.prepared, keys.final]));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 2) return fail("MONTHLY_JOURNAL_READ_INVALID");
    const state: MonthlyFinancialJournalState = { final: null, prepared: null }, seen = new Set<string>();
    for (const row of result[0] as Record<string, unknown>[]) {
      if (!row || typeof row !== "object" || typeof row.auditId !== "string" || seen.has(row.auditId) || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.resourceType !== "ops_monthly_operation" || row.resourceId !== operationId || row.status !== "success") return fail("MONTHLY_JOURNAL_SCOPE_MISMATCH"); seen.add(row.auditId);
      if (row.auditId === keys.prepared && row.action === "ops_monthly.prepare") { const value = preparedSchema.parse(parsed(row.metadataText)); bound(value.prepared); state.prepared = value.prepared; }
      else if (row.auditId === keys.final && row.action === "ops_monthly.final") { const value = finalSchema.parse(parsed(row.metadataText)); bound(value.receipt); state.final = value; }
      else return fail("MONTHLY_JOURNAL_SCOPE_MISMATCH");
    }
    if (state.prepared && state.final && (state.final.requestHash !== state.prepared.requestHash || state.final.receipt.action !== "upload")) return fail("MONTHLY_JOURNAL_RECEIPT_MISMATCH"); return state;
  }
  async function insert(auditId: string, action: string, payload: unknown) { const result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'ops_monthly_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actorRole, action, operationId, encoded(payload)])); if (!Array.isArray(result) || result[0]?.affectedRows !== 1) return fail("MONTHLY_JOURNAL_WRITE_UNCONFIRMED"); }
  async function prepare(rawPrepared: MonthlyFinancialPreparedUpload): Promise<{ created: boolean; prepared: MonthlyFinancialPreparedUpload }> {
    const prepared = MonthlyFinancialPreparedUploadSchema.parse(rawPrepared); bound(prepared); const previous = await read(); if (previous.final) return fail(previous.final.receipt.status === "cancelled" ? "MONTHLY_OPERATION_CANCELLED" : "MONTHLY_OPERATION_FINAL");
    if (previous.prepared) { if (encoded(previous.prepared) !== encoded(prepared)) return fail("MONTHLY_OPERATION_CONTENT_CONFLICT"); return { created: false, prepared: previous.prepared }; }
    await insert(keys.prepared, "ops_monthly.prepare", { version: 1, kind: "upload_prepared", prepared }); const saved = await read(); if (!saved.prepared || saved.final || encoded(saved.prepared) !== encoded(prepared)) return fail("MONTHLY_JOURNAL_READBACK_MISMATCH"); return { created: true, prepared: saved.prepared };
  }
  async function finalize(rawReceipt: MonthlyFinancialWriteResult, requestHash: string | null): Promise<MonthlyFinancialWriteResult> {
    const receipt = MonthlyFinancialWriteResultSchema.parse(rawReceipt); bound(receipt); const value = finalSchema.parse({ version: 1, kind: "final", requestHash, receipt }), previous = await read();
    if (previous.final) { if (previous.final.receipt.status === "cancelled") { if (receipt.status !== "cancelled") return fail("MONTHLY_OPERATION_CANCELLED"); return previous.final.receipt; } if (previous.final.requestHash !== requestHash || encoded(previous.final.receipt) !== encoded(receipt)) return fail("MONTHLY_OPERATION_CONTENT_CONFLICT"); return previous.final.receipt; }
    if (previous.prepared && (requestHash !== previous.prepared.requestHash || receipt.action !== "upload") || receipt.status === "committed" && receipt.action === "upload" && !previous.prepared) return fail("MONTHLY_JOURNAL_RECEIPT_MISMATCH");
    await insert(keys.final, "ops_monthly.final", value); const saved = await read(); if (!saved.final || encoded(saved.final) !== encoded(value)) return fail("MONTHLY_JOURNAL_READBACK_MISMATCH"); return saved.final.receipt;
  }
  async function cancel(): Promise<MonthlyFinancialWriteResult> { const previous = await read(); if (previous.final) return previous.final.receipt; return finalize({ identity, operationId, action: previous.prepared ? "upload" : null, status: "cancelled", batchId: null, batchStatus: null, batchVersion: null, reasonCode: "operation_cancelled" }, previous.prepared?.requestHash ?? null); }
  return { read, prepare, finalize, cancel };
}
