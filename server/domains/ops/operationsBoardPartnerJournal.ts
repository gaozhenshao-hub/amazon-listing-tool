import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { operationsBoardEditionCanonical, operationsBoardEditionHash } from "../../../shared/operationsBoardEdition";
import { OperationsBoardPartnersWriteResultSchema, type OperationsBoardPartnersWriteResult } from "../../../shared/operationsBoardPartners";
import { assertOperationsBoardOperationJournalSchema, type OperationsBoardOperationJournalExecutor } from "./operationsBoardOperationJournal";

const ACTION = "ops.board.partner.final", RESOURCE = "ops_board_partner", MAX_BYTES = 32768;
const id = z.number().int().positive().max(2147483647), uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const identitySchema = z.object({ workspaceId: id, userId: id }).strict();
const scopeSchema = z.object({ identity: identitySchema, operationId: uuid,
  actorRole: z.string().min(1).max(64).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)) }).strict();
export type OperationsBoardPartnerJournalScope = z.infer<typeof scopeSchema>;
export class OperationsBoardPartnerJournalError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_PARTNER_${code}`); this.name = "OperationsBoardPartnerJournalError"; }
}
function fail(code: string): never { throw new OperationsBoardPartnerJournalError(code); }
function encode(value: unknown): string { try { return operationsBoardEditionCanonical(value, MAX_BYTES); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); } }
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(JSON.parse(encode(value))); if (!result.success) fail("JOURNAL_PAYLOAD_INVALID"); return result.data;
}
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) fail("JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
export function operationsBoardPartnerAuditId(identity: OperationsBoardPartnerJournalScope["identity"], operationId: string): string {
  // 12 + 64 = 76 characters: compatible with the existing admitted auditId.
  // Independent of target pair/payload so one UUID cannot mutate a second pair.
  return `bpair_final_${operationsBoardEditionHash({ namespace: ACTION, identity: parse(identitySchema, identity), operationId: parse(uuid, operationId) }, MAX_BYTES)}`;
}
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), receipt: OperationsBoardPartnersWriteResultSchema }).strict()
  .refine(value => value.receipt.status !== "unknown");
export type OperationsBoardPartnerJournalState = { final: OperationsBoardPartnersWriteResult | null };

/** One caller-owned transaction. No own connection, best-effort audit, body
 * persistence or business write. Cancel is a permanent same-UUID fence. */
export function createOperationsBoardPartnerJournal(tx: OperationsBoardOperationJournalExecutor, raw: OperationsBoardPartnerJournalScope) {
  const context = parse(scopeSchema, raw), { identity, operationId } = context, auditId = operationsBoardPartnerAuditId(identity, operationId);
  let admitted: Promise<void> | null = null;
  const assertSchema = () => admitted ??= assertOperationsBoardOperationJournalSchema(tx);
  function bind(value: OperationsBoardPartnersWriteResult) {
    if (encode(value.identity) !== encode(identity) || value.operationId !== operationId) fail("JOURNAL_SCOPE_MISMATCH");
  }
  async function read(): Promise<OperationsBoardPartnerJournalState> {
    await assertSchema(); let result: unknown;
    try { result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [auditId, auditId])); }
    catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1]) || result[0].length > 1) fail("JOURNAL_READ_INVALID");
    if (!result[0].length) return { final: null };
    const row = result[0][0];
    if (!row || typeof row !== "object" || Array.isArray(row) || row.auditId !== auditId || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId
      || row.action !== ACTION || row.resourceType !== RESOURCE || row.resourceId !== operationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_SCOPE_MISMATCH");
    if (typeof row.metadataText !== "string" || Buffer.byteLength(row.metadataText, "utf8") > MAX_BYTES) fail("JOURNAL_PAYLOAD_INVALID");
    let value: unknown; try { value = JSON.parse(row.metadataText); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); }
    const saved = parse(finalSchema, value); bind(saved.receipt); return { final: saved.receipt };
  }
  async function finalize(rawReceipt: OperationsBoardPartnersWriteResult): Promise<OperationsBoardPartnersWriteResult> {
    const value = parse(finalSchema, { version: 1, kind: "final", receipt: rawReceipt }); bind(value.receipt);
    const existing = await read();
    if (existing.final) {
      if (existing.final.status === "cancelled") {
        if (value.receipt.status !== "cancelled") fail("OPERATION_CANCELLED");
        return existing.final;
      }
      if (encode(existing.final) !== encode(value.receipt)) fail("OPERATION_CONTENT_CONFLICT");
      return existing.final;
    }
    let result: unknown;
    try { result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,?,?,'success','medium',?)",
      [auditId, identity.workspaceId, identity.userId, context.actorRole, ACTION, RESOURCE, operationId, encode(value)])); }
    catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
    if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1) fail("JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read(); if (!saved.final || encode(saved.final) !== encode(value.receipt)) fail("JOURNAL_READBACK_MISMATCH");
    return saved.final;
  }
  async function cancel(): Promise<OperationsBoardPartnersWriteResult> {
    const existing = await read(); if (existing.final) return existing.final;
    return finalize({ identity, operationId, status: "cancelled", requestHash: null, pair: null, reasonCode: "operation_cancelled" });
  }
  return { assertSchema, read, finalize, cancel };
}
