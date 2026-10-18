import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { InventoryGovernanceIdentitySchema, InventoryGovernanceSubjectSchema, InventoryGovernanceWriteResultSchema, inventoryGovernanceCanonical, inventoryGovernanceHash, inventoryGovernanceSubjectKey, type InventoryGovernanceIdentity, type InventoryGovernanceSubject, type InventoryGovernanceWriteResult } from "../../../shared/inventoryGovernanceWrite";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
export class InventoryGovernanceJournalError extends Error { constructor(public readonly code: string) { super(code); this.name = "InventoryGovernanceJournalError"; } }
const fail = (code: string): never => { throw new InventoryGovernanceJournalError(code); };
export const inventoryGovernanceOperationAuditId = (identity: InventoryGovernanceIdentity, operationId: string) => `gov_final_${inventoryGovernanceHash({ identity: InventoryGovernanceIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), requestHash: hash.nullable(), receipt: InventoryGovernanceWriteResultSchema }).strict().refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "committed" || value.requestHash !== null));
export type InventoryGovernanceJournalState = { final: z.infer<typeof finalSchema> | null };
export type InventoryGovernanceJournalScope = InventoryGovernanceIdentity & { subject: InventoryGovernanceSubject; operationId: string; actorRole: string };
export interface InventoryGovernanceJournalTransaction { execute(statement: SQL): Promise<unknown> }
function statement(text: string, params: unknown[]): SQL { const parts = text.split("?"); if (parts.length !== params.length + 1) return fail("GOVERNANCE_JOURNAL_SQL_INVALID"); return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw("")); }
function encode(value: unknown): string { const result = inventoryGovernanceCanonical(value); if (Buffer.byteLength(result, "utf8") > 32768) return fail("GOVERNANCE_JOURNAL_PAYLOAD_INVALID"); return result; }
function decode(value: unknown): unknown { if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 32768) return fail("GOVERNANCE_JOURNAL_PAYLOAD_INVALID"); try { const decoded = JSON.parse(value); encode(decoded); return decoded; } catch { return fail("GOVERNANCE_JOURNAL_PAYLOAD_INVALID"); } }

/** Caller must hold current workspace then actor locks in one real transaction. */
export function createInventoryGovernanceOperationJournal(tx: InventoryGovernanceJournalTransaction, raw: InventoryGovernanceJournalScope) {
  const identity = InventoryGovernanceIdentitySchema.parse({ userId: raw.userId, workspaceId: raw.workspaceId }), subject = InventoryGovernanceSubjectSchema.parse(raw.subject), operationId = uuid.parse(raw.operationId), actorRole = z.string().trim().min(1).max(64).parse(raw.actorRole);
  const auditId = inventoryGovernanceOperationAuditId(identity, operationId);
  function bound(receipt: InventoryGovernanceWriteResult) { if (encode(receipt.identity) !== encode(identity) || inventoryGovernanceSubjectKey(receipt.subject) !== inventoryGovernanceSubjectKey(subject) || receipt.operationId !== operationId) fail("GOVERNANCE_JOURNAL_SCOPE_MISMATCH"); }
  async function read(): Promise<InventoryGovernanceJournalState> {
    const result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR UPDATE", [auditId]));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 1) return fail("GOVERNANCE_JOURNAL_READ_INVALID");
    if (!result[0].length) return { final: null };
    const row = result[0][0];
    if (!row || typeof row !== "object" || row.auditId !== auditId || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== "ops_inventory_governance.final" || row.resourceType !== "ops_inventory_governance_operation" || row.resourceId !== operationId || row.status !== "success") return fail("GOVERNANCE_JOURNAL_SCOPE_MISMATCH");
    const final = finalSchema.parse(decode(row.metadataText)); bound(final.receipt); return { final };
  }
  async function finalize(rawReceipt: InventoryGovernanceWriteResult, requestHash: string | null): Promise<InventoryGovernanceWriteResult> {
    inventoryGovernanceCanonical(rawReceipt); const receipt = InventoryGovernanceWriteResultSchema.parse(rawReceipt); bound(receipt);
    const value = finalSchema.parse({ version: 1, kind: "final", requestHash, receipt }), previous = await read();
    if (previous.final) {
      if (previous.final.receipt.status === "cancelled") { if (receipt.status !== "cancelled") return fail("GOVERNANCE_OPERATION_CANCELLED"); return previous.final.receipt; }
      if (previous.final.requestHash !== requestHash || encode(previous.final.receipt) !== encode(receipt)) return fail("GOVERNANCE_OPERATION_CONTENT_CONFLICT");
      return previous.final.receipt;
    }
    const result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,'ops_inventory_governance.final','ops_inventory_governance_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actorRole, operationId, encode(value)]));
    if (!Array.isArray(result) || result[0]?.affectedRows !== 1) return fail("GOVERNANCE_JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read(); if (!saved.final || encode(saved.final) !== encode(value)) return fail("GOVERNANCE_JOURNAL_READBACK_MISMATCH");
    return saved.final.receipt;
  }
  async function cancel(): Promise<InventoryGovernanceWriteResult> { const state = await read(); if (state.final) return state.final.receipt; return finalize({ identity, subject, operationId, action: null, status: "cancelled", snapshotKey: null, recordIds: [], counts: null, reasonCode: "operation_cancelled" }, null); }
  return { read, finalize, cancel };
}
