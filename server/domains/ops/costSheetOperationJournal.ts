import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { OperationsCostSheetScopeSchema, type OperationsCostSheetScope } from "../../../shared/operationsCostSheetRead";
import { OperationsCostSheetWriteIdentitySchema, OperationsCostSheetWriteResultSchema, operationsCostSheetWriteCanonical, operationsCostSheetWriteHash, type OperationsCostSheetWriteIdentity, type OperationsCostSheetWriteResult } from "../../../shared/operationsCostSheetWrite";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
export class CostSheetJournalError extends Error { constructor(public readonly code: string) { super(code); this.name = "CostSheetJournalError"; } }
const fail = (code: string): never => { throw new CostSheetJournalError(code); };
export const costSheetOperationAuditId = (identity: OperationsCostSheetWriteIdentity, operationId: string): string => `cost_final_${operationsCostSheetWriteHash({ identity: OperationsCostSheetWriteIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), requestHash: hash.nullable(), receipt: OperationsCostSheetWriteResultSchema }).strict().refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "committed" || value.requestHash !== null));
export type CostSheetJournalFinal = z.infer<typeof finalSchema>;
export type CostSheetJournalState = { final: CostSheetJournalFinal | null };
export type CostSheetJournalScope = OperationsCostSheetWriteIdentity & { scope: OperationsCostSheetScope; operationId: string; actorRole: string };
export interface CostSheetJournalTransaction { execute(statement: SQL): Promise<unknown> }
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) return fail("COST_JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function encode(value: unknown): string { const result = operationsCostSheetWriteCanonical(value); if (Buffer.byteLength(result, "utf8") > 32768) return fail("COST_JOURNAL_PAYLOAD_INVALID"); return result; }
function parse(value: unknown): unknown { if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 32768) return fail("COST_JOURNAL_PAYLOAD_INVALID"); try { const decoded = JSON.parse(value); encode(decoded); return decoded; } catch { return fail("COST_JOURNAL_PAYLOAD_INVALID"); } }

/** Caller holds the current actor serialization lock throughout a real
 * transaction. Business mutation and final receipt MUST commit together. */
export function createCostSheetOperationJournal(tx: CostSheetJournalTransaction, raw: CostSheetJournalScope) {
  const identity = OperationsCostSheetWriteIdentitySchema.parse({ userId: raw.userId, workspaceId: raw.workspaceId }), scope = OperationsCostSheetScopeSchema.parse(raw.scope), operationId = uuid.parse(raw.operationId), actorRole = z.string().trim().min(1).max(64).parse(raw.actorRole);
  if (identity.workspaceId !== scope.workspaceId) return fail("COST_JOURNAL_SCOPE_MISMATCH");
  const auditId = costSheetOperationAuditId(identity, operationId);
  const bound = (receipt: OperationsCostSheetWriteResult) => { if (encode(receipt.identity) !== encode(identity) || encode(receipt.scope) !== encode(scope) || receipt.operationId !== operationId) fail("COST_JOURNAL_SCOPE_MISMATCH"); };
  async function read(): Promise<CostSheetJournalState> {
    const result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR UPDATE", [auditId]));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 1) return fail("COST_JOURNAL_READ_INVALID");
    if (!result[0].length) return { final: null };
    const row = result[0][0];
    if (!row || typeof row !== "object" || row.auditId !== auditId || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== "ops_cost.final" || row.resourceType !== "ops_cost_operation" || row.resourceId !== operationId || row.status !== "success") return fail("COST_JOURNAL_SCOPE_MISMATCH");
    const final = finalSchema.parse(parse(row.metadataText)); bound(final.receipt); return { final };
  }
  async function finalize(rawReceipt: OperationsCostSheetWriteResult, requestHash: string | null): Promise<OperationsCostSheetWriteResult> {
    const receipt = OperationsCostSheetWriteResultSchema.parse(rawReceipt); bound(receipt);
    const value = finalSchema.parse({ version: 1, kind: "final", requestHash, receipt }), previous = await read();
    if (previous.final) {
      if (previous.final.receipt.status === "cancelled") { if (receipt.status !== "cancelled") return fail("COST_OPERATION_CANCELLED"); return previous.final.receipt; }
      if (previous.final.requestHash !== requestHash || encode(previous.final.receipt) !== encode(receipt)) return fail("COST_OPERATION_CONTENT_CONFLICT");
      return previous.final.receipt;
    }
    const result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,'ops_cost.final','ops_cost_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actorRole, operationId, encode(value)]));
    if (!Array.isArray(result) || result[0]?.affectedRows !== 1) return fail("COST_JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read(); if (!saved.final || encode(saved.final) !== encode(value)) return fail("COST_JOURNAL_READBACK_MISMATCH");
    return saved.final.receipt;
  }
  async function cancel(): Promise<OperationsCostSheetWriteResult> {
    const state = await read(); if (state.final) return state.final.receipt;
    return finalize({ identity, scope, operationId, status: "cancelled", version: null, snapshotKey: null, reasonCode: "operation_cancelled" }, null);
  }
  return { read, finalize, cancel };
}
