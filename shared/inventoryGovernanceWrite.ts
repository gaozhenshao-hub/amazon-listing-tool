import { z } from "zod";
import { inventoryPlanningWriteCanonical, inventoryPlanningWriteHash } from "./inventoryPlanningWrite";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

export const INVENTORY_GOVERNANCE_LIMITS = { targets: 500, sources: 10000, rules: 10000, members: 5000, responseBytes: 8 * 1024 * 1024 } as const;
const id = z.number().int().positive().max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) && new TextDecoder().decode(new TextEncoder().encode(value)) === value);
const asin = text(20).regex(/^[A-Za-z0-9]+$/u);
const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u).refine(value => { const date = new Date(value.slice(0, 19).replace(" ", "T") + "Z"); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19).replace(" ", "T"); });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => { const parsed = new Date(value + "T00:00:00Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; });
const reason = z.string().max(500).refine(value => value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)).nullable();
export const InventoryGovernanceIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type InventoryGovernanceIdentity = z.infer<typeof InventoryGovernanceIdentitySchema>;
export const InventoryGovernanceOwnerScopeSchema = z.object({ parentAsin: asin, storeName: text(200), country: text(50) }).strict();
export type InventoryGovernanceOwnerScope = z.infer<typeof InventoryGovernanceOwnerScopeSchema>;
export const InventoryGovernanceLifecycleScopeSchema = z.object({ asin, storeName: text(200), country: text(50) }).strict();
export const InventoryGovernanceSubjectSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("owners") }).strict(), z.object({ kind: z.literal("lifecycle"), scope: InventoryGovernanceLifecycleScopeSchema }).strict()]);
export type InventoryGovernanceSubject = z.infer<typeof InventoryGovernanceSubjectSchema>;
export const inventoryGovernanceCanonical = inventoryPlanningWriteCanonical;
export const inventoryGovernanceHash = inventoryPlanningWriteHash;
export const inventoryGovernanceScopeKey = (scope: InventoryGovernanceOwnerScope) => inventoryGovernanceCanonical(InventoryGovernanceOwnerScopeSchema.parse({ parentAsin: scope.parentAsin, storeName: scope.storeName, country: scope.country }));
export const inventoryGovernanceSubjectKey = (subject: InventoryGovernanceSubject) => inventoryGovernanceCanonical(InventoryGovernanceSubjectSchema.parse(subject));
export function inventoryGovernanceAliasKey(scope: InventoryGovernanceOwnerScope): string {
  const value = InventoryGovernanceOwnerScopeSchema.parse({ parentAsin: scope.parentAsin, storeName: scope.storeName, country: scope.country });
  return inventoryGovernanceCanonical({ ...value, country: normalizeMarketplaceCode(value.country) }).normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase();
}
export const InventoryGovernanceReadInputSchema = z.object({ expectedWorkspaceId: id, subject: InventoryGovernanceSubjectSchema }).strict();
export type InventoryGovernanceReadInput = z.infer<typeof InventoryGovernanceReadInputSchema>;
const commandBase = { expectedWorkspaceId: id, operationId: uuid, expectedSnapshotKey: hash };
export const InventoryGovernanceExecuteInputSchema = z.discriminatedUnion("action", [
  z.object({ ...commandBase, subject: z.object({ kind: z.literal("owners") }).strict(), action: z.literal("assign"), targets: z.array(InventoryGovernanceOwnerScopeSchema).min(1).max(500), assigneeUserId: id, reason }).strict().refine(value => new Set(value.targets.map(inventoryGovernanceScopeKey)).size === value.targets.length, "Duplicate targets are not silently deduplicated"),
  z.object({ ...commandBase, subject: z.object({ kind: z.literal("owners") }).strict(), action: z.literal("revoke"), ruleId: id, reason }).strict(),
  z.object({ ...commandBase, subject: z.object({ kind: z.literal("lifecycle"), scope: InventoryGovernanceLifecycleScopeSchema }).strict(), action: z.literal("restore"), reason: text(500).min(2) }).strict(),
]);
export type InventoryGovernanceExecuteInput = z.infer<typeof InventoryGovernanceExecuteInputSchema>;
export const InventoryGovernanceRecoverInputSchema = InventoryGovernanceReadInputSchema.extend({ operationId: uuid, decision: z.enum(["check", "cancel"]) }).strict();
export type InventoryGovernanceRecoverInput = z.infer<typeof InventoryGovernanceRecoverInputSchema>;
export const InventoryGovernanceRuleSchema = InventoryGovernanceOwnerScopeSchema.extend({ id, workspaceId: id, assigneeUserId: id, assigneeName: text(200), isActive: z.union([z.literal(0), z.literal(1)]), createdByUserId: id, updatedByUserId: id, createdAt: stamp, updatedAt: stamp }).strict();
export type InventoryGovernanceRule = z.infer<typeof InventoryGovernanceRuleSchema>;
export const InventoryGovernanceMemberSchema = z.object({ userId: id, displayName: text(200), role: text(64) }).strict();
export const InventoryGovernanceCandidateSchema = z.object({ scope: InventoryGovernanceOwnerScopeSchema, childAsins: z.array(asin).max(10000), productNames: z.array(text(1000)).max(10000), externalOperators: z.array(text(200)).max(10000), sourceKinds: z.array(z.enum(["daily", "parent_weekly"])).min(1).max(2), sourceCount: id, latestDate: date }).strict();
export type InventoryGovernanceCandidate = z.infer<typeof InventoryGovernanceCandidateSchema>;
export const InventoryGovernanceLifecycleRowSchema = z.object({ id, workspaceId: id, userId: id, asin, parentAsin: asin.nullable(), storeName: text(200), country: text(50), status: z.enum(["active", "discontinued"]), reason: text(80).nullable(), evidenceStartDate: date.nullable(), evidenceEndDate: date.nullable(), evidenceDays: z.number().int().min(0), evidenceSalesQty: z.number().int(), evidenceProfit: z.union([z.string().regex(/^-?\d+(?:\.\d{1,2})?$/u), z.number().finite()]), evidenceMaxInventory: z.number().int(), changedBy: id.nullable(), changedAt: stamp, restoredAt: stamp.nullable(), restoreReason: reason, createdAt: stamp, updatedAt: stamp }).strict();
export type InventoryGovernanceLifecycleRow = z.infer<typeof InventoryGovernanceLifecycleRowSchema>;
export const InventoryGovernanceCapabilitySchema = z.object({ status: z.enum(["available", "unavailable"]), reasonCode: text(200).nullable() }).strict().refine(value => (value.status === "available") === (value.reasonCode === null));
export const InventoryGovernanceReadResultSchema = z.object({
  identity: InventoryGovernanceIdentitySchema, subject: InventoryGovernanceSubjectSchema, status: z.enum(["ready", "unavailable", "conflict"]), reasonCode: text(200).nullable(), snapshotKey: hash.nullable(),
  owners: z.object({ candidates: z.array(InventoryGovernanceCandidateSchema).max(10000), rules: z.array(InventoryGovernanceRuleSchema).max(10000), members: z.array(InventoryGovernanceMemberSchema).max(5000) }).strict().nullable(),
  lifecycle: z.object({ row: InventoryGovernanceLifecycleRowSchema.nullable(), rows: z.array(InventoryGovernanceLifecycleRowSchema).max(1) }).strict().nullable(),
  capabilities: z.object({ assign: InventoryGovernanceCapabilitySchema, revoke: InventoryGovernanceCapabilitySchema, restore: InventoryGovernanceCapabilitySchema }).strict(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status === "ready" ? value.snapshotKey === null || value.reasonCode !== null || (value.subject.kind === "owners" ? value.owners === null || value.lifecycle !== null : value.lifecycle === null || value.owners !== null) : value.snapshotKey !== null || value.reasonCode === null || value.owners !== null || value.lifecycle !== null) issue("Invalid governance read state");
  if (value.status !== "ready" && Object.values(value.capabilities).some(capability => capability.status === "available")) issue("Unavailable data is never writable");
  if (value.owners) {
    if (new Set(value.owners.members.map(member => member.userId)).size !== value.owners.members.length || new Set(value.owners.rules.map(rule => rule.id)).size !== value.owners.rules.length || new Set(value.owners.rules.map(inventoryGovernanceScopeKey)).size !== value.owners.rules.length || new Set(value.owners.candidates.map(candidate => inventoryGovernanceScopeKey(candidate.scope))).size !== value.owners.candidates.length) issue("Duplicate governance projection");
    if (value.owners.rules.some(rule => rule.workspaceId !== value.identity.workspaceId)) issue("Rule workspace mismatch");
    if (value.capabilities.restore.status === "available" || value.capabilities.assign.status === "available" && (!value.owners.candidates.length || !value.owners.members.length)) issue("Invalid owners capability");
  }
  if (value.lifecycle) {
    const row = value.lifecycle.row;
    if (inventoryGovernanceCanonical(value.lifecycle.rows) !== inventoryGovernanceCanonical(row ? [row] : [])) issue("Incomplete lifecycle projection");
    if (value.subject.kind !== "lifecycle" || row && (row.workspaceId !== value.identity.workspaceId || row.asin !== value.subject.scope.asin || row.storeName !== value.subject.scope.storeName || row.country !== value.subject.scope.country)) issue("Lifecycle scope mismatch");
    if (value.capabilities.assign.status === "available" || value.capabilities.revoke.status === "available" || value.capabilities.restore.status === "available" && row?.status !== "discontinued") issue("Invalid lifecycle capability");
  }
  try { if (new TextEncoder().encode(inventoryGovernanceCanonical(value)).byteLength > INVENTORY_GOVERNANCE_LIMITS.responseBytes) issue("Response budget exceeded"); } catch { issue("Invalid response JSON"); }
});
export type InventoryGovernanceReadResult = z.infer<typeof InventoryGovernanceReadResultSchema>;
export const InventoryGovernanceCountsSchema = z.object({ created: z.number().int().min(0).max(500), replaced: z.number().int().min(0).max(500), reactivated: z.number().int().min(0).max(500), unchanged: z.number().int().min(0).max(500), revoked: z.number().int().min(0).max(1), restored: z.number().int().min(0).max(1) }).strict();
export const InventoryGovernanceWriteResultSchema = z.object({ identity: InventoryGovernanceIdentitySchema, subject: InventoryGovernanceSubjectSchema, operationId: uuid, action: z.enum(["assign", "revoke", "restore"]).nullable(), status: z.enum(["committed", "cancelled", "unknown"]), snapshotKey: hash.nullable(), recordIds: z.array(id).max(500), counts: InventoryGovernanceCountsSchema.nullable(), reasonCode: text(200).nullable() }).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status === "committed" ? value.action === null || value.snapshotKey === null || value.counts === null || value.reasonCode !== null || !value.recordIds.length : value.snapshotKey !== null || value.counts !== null || value.recordIds.length > 0 || value.reasonCode === null) issue("Invalid governance receipt");
  if (new Set(value.recordIds).size !== value.recordIds.length) issue("Duplicate receipt IDs");
  if (value.action !== null && (value.action === "restore") !== (value.subject.kind === "lifecycle")) issue("Subject/action mismatch");
  if (value.counts) {
    const count = value.counts;
    if (value.action === "assign" ? count.created + count.replaced + count.unchanged !== value.recordIds.length || count.reactivated > count.replaced || count.revoked !== 0 || count.restored !== 0 : value.action === "revoke" ? count.revoked !== 1 || value.recordIds.length !== 1 || count.created + count.replaced + count.reactivated + count.unchanged + count.restored !== 0 : count.restored !== 1 || value.recordIds.length !== 1 || count.created + count.replaced + count.reactivated + count.unchanged + count.revoked !== 0) issue("Invalid governance counts");
  }
});
export type InventoryGovernanceWriteResult = z.infer<typeof InventoryGovernanceWriteResultSchema>;
export const inventoryGovernanceOperationRequestHash = (raw: InventoryGovernanceExecuteInput) => { inventoryGovernanceCanonical(raw); return inventoryGovernanceHash(InventoryGovernanceExecuteInputSchema.parse(raw)); };
export function inventoryGovernanceSnapshotKey(value: { identity: InventoryGovernanceIdentity; subject: InventoryGovernanceSubject; sources: unknown; rules: unknown; members: unknown; lifecycle: unknown }): string {
  InventoryGovernanceIdentitySchema.parse(value.identity); InventoryGovernanceSubjectSchema.parse(value.subject);
  return inventoryGovernanceHash({ protocol: "inventory-governance-v1", ...value });
}
