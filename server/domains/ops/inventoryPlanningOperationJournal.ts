import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { InventoryPlanningIdentitySchema, InventoryPlanningReadInputSchema, InventoryPlanningWriteResultSchema, canonicalInventoryPlanningScope, inventoryPlanningScopeKey, inventoryPlanningWriteCanonical, inventoryPlanningWriteHash, type InventoryPlanningIdentity, type InventoryPlanningReadInput, type InventoryPlanningWriteResult } from "../../../shared/inventoryPlanningWrite";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
export class InventoryPlanningJournalError extends Error { constructor(public readonly code: string) { super(code); this.name = "InventoryPlanningJournalError"; } }
const fail = (code: string): never => { throw new InventoryPlanningJournalError(code); };
export const inventoryPlanningOperationAuditId = (identity: InventoryPlanningIdentity, operationId: string): string => `planning_final_${inventoryPlanningWriteHash({ identity: InventoryPlanningIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), requestHash: hash.nullable(), receipt: InventoryPlanningWriteResultSchema }).strict().refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "committed" || value.requestHash !== null));
export type InventoryPlanningJournalFinal = z.infer<typeof finalSchema>;
export type InventoryPlanningJournalState = { final: InventoryPlanningJournalFinal | null };
export type InventoryPlanningJournalScope = InventoryPlanningIdentity & Pick<InventoryPlanningReadInput, "scope" | "asOfDate" | "marketplace"> & { operationId: string; actorRole: string };
export interface InventoryPlanningJournalTransaction { execute(statement: SQL): Promise<unknown> }
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) return fail("PLANNING_JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function encode(value: unknown): string { const result = inventoryPlanningWriteCanonical(value); if (Buffer.byteLength(result, "utf8") > 32768) return fail("PLANNING_JOURNAL_PAYLOAD_INVALID"); return result; }
function parse(value: unknown): unknown { if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 32768) return fail("PLANNING_JOURNAL_PAYLOAD_INVALID"); try { const decoded = JSON.parse(value); encode(decoded); return decoded; } catch { return fail("PLANNING_JOURNAL_PAYLOAD_INVALID"); } }

/** The caller holds workspace/actor locks in a required real transaction.
 * Business writes and this durable final receipt must commit together. */
export function createInventoryPlanningOperationJournal(tx: InventoryPlanningJournalTransaction, raw: InventoryPlanningJournalScope) {
  const identity = InventoryPlanningIdentitySchema.parse({ userId: raw.userId, workspaceId: raw.workspaceId });
  const input = InventoryPlanningReadInputSchema.parse({ expectedWorkspaceId: raw.workspaceId, scope: raw.scope, asOfDate: raw.asOfDate, marketplace: raw.marketplace });
  const scope = canonicalInventoryPlanningScope(input.scope), operationId = uuid.parse(raw.operationId), actorRole = z.string().trim().min(1).max(64).parse(raw.actorRole);
  const auditId = inventoryPlanningOperationAuditId(identity, operationId);
  const bound = (receipt: InventoryPlanningWriteResult) => {
    if (encode(receipt.identity) !== encode(identity) || inventoryPlanningScopeKey(receipt.scope) !== inventoryPlanningScopeKey(scope) || receipt.asOfDate !== input.asOfDate || receipt.marketplace !== input.marketplace || receipt.operationId !== operationId) fail("PLANNING_JOURNAL_SCOPE_MISMATCH");
  };
  async function read(): Promise<InventoryPlanningJournalState> {
    const result = await tx.execute(statement("SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR UPDATE", [auditId]));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 1) return fail("PLANNING_JOURNAL_READ_INVALID");
    if (!result[0].length) return { final: null };
    const row = result[0][0];
    if (!row || typeof row !== "object" || row.auditId !== auditId || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== "ops_inventory_planning.final" || row.resourceType !== "ops_inventory_planning_operation" || row.resourceId !== operationId || row.status !== "success") return fail("PLANNING_JOURNAL_SCOPE_MISMATCH");
    const final = finalSchema.parse(parse(row.metadataText)); bound(final.receipt); return { final };
  }
  async function finalize(rawReceipt: InventoryPlanningWriteResult, requestHash: string | null): Promise<InventoryPlanningWriteResult> {
    inventoryPlanningWriteCanonical(rawReceipt);
    const receipt = InventoryPlanningWriteResultSchema.parse(rawReceipt); receipt.scope = canonicalInventoryPlanningScope(receipt.scope); bound(receipt);
    const value = finalSchema.parse({ version: 1, kind: "final", requestHash, receipt }), previous = await read();
    if (previous.final) {
      if (previous.final.receipt.status === "cancelled") { if (receipt.status !== "cancelled") return fail("PLANNING_OPERATION_CANCELLED"); return previous.final.receipt; }
      if (previous.final.requestHash !== requestHash || encode(previous.final.receipt) !== encode(receipt)) return fail("PLANNING_OPERATION_CONTENT_CONFLICT");
      return previous.final.receipt;
    }
    const result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,'ops_inventory_planning.final','ops_inventory_planning_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actorRole, operationId, encode(value)]));
    if (!Array.isArray(result) || result[0]?.affectedRows !== 1) return fail("PLANNING_JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read(); if (!saved.final || encode(saved.final) !== encode(value)) return fail("PLANNING_JOURNAL_READBACK_MISMATCH");
    return saved.final.receipt;
  }
  async function cancel(): Promise<InventoryPlanningWriteResult> {
    const state = await read(); if (state.final) return state.final.receipt;
    return finalize({ identity, scope, asOfDate: input.asOfDate, marketplace: input.marketplace, operationId, action: null, status: "cancelled", recordId: null, snapshotKey: null, reasonCode: "operation_cancelled" }, null);
  }
  return { read, finalize, cancel };
}
