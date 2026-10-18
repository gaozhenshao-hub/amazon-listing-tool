import { z } from "zod";
import { AgentLibraryKeySchema } from "@shared/agentLibraryContracts";
import { conversationLocksAvailable, type ConversationOwner } from "./AssistantConversationDraft";

const id = z.number().int().positive().max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
/** Recovery metadata only. Rule text never enters localStorage. */
export const RuleConfirmationPendingSchema = z.object({
  version: z.literal(1), userId: id, workspaceId: id, agentKey: AgentLibraryKeySchema,
  threadId: uuid, operationId: uuid, confirmationId: uuid,
  baseRevision: id, baseHash: hash, proposalHash: hash,
}).strict().refine(value => value.confirmationId !== value.operationId, { path: ["confirmationId"], message: "Rule confirmation must differ from original message" });
export type RuleConfirmationPending = z.infer<typeof RuleConfirmationPendingSchema>;
export const RULE_CONFIRMATION_PENDING_EVENT = "assistant-rule-confirmation-pending-changed";
export const ruleConfirmationPendingKey = (owner: ConversationOwner) => `assistant-rule-confirmation:v1:${owner.userId}:${owner.workspaceId}:${owner.agentKey}`;
export function readRuleConfirmationPending(owner: ConversationOwner): RuleConfirmationPending | null {
  const raw = localStorage.getItem(ruleConfirmationPendingKey(owner));
  if (raw === null) return null;
  if (raw.length > 2048) throw new Error("RULE_RECOVERY_METADATA_INVALID");
  const value = RuleConfirmationPendingSchema.parse(JSON.parse(raw));
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId || value.agentKey !== owner.agentKey) throw new Error("RULE_RECOVERY_OWNER_CHANGED");
  return value;
}
async function locked<T>(owner: ConversationOwner, signal: AbortSignal, work: () => T) {
  if (!conversationLocksAvailable()) throw new Error("BROWSER_LOCK_REQUIRED");
  return navigator.locks.request(ruleConfirmationPendingKey(owner), { mode: "exclusive", signal }, () => {
    signal.throwIfAborted(); return work();
  });
}
function notify(owner: ConversationOwner) { window.dispatchEvent(new CustomEvent(RULE_CONFIRMATION_PENDING_EVENT, { detail: ruleConfirmationPendingKey(owner) })); }
export async function reserveRuleConfirmation(owner: ConversationOwner, value: RuleConfirmationPending, signal: AbortSignal) {
  return locked(owner, signal, () => {
    if (readRuleConfirmationPending(owner)) throw new Error("RULE_CONFIRMATION_PENDING");
    const parsed = RuleConfirmationPendingSchema.parse(value);
    if (parsed.userId !== owner.userId || parsed.workspaceId !== owner.workspaceId || parsed.agentKey !== owner.agentKey) throw new Error("RULE_RECOVERY_OWNER_CHANGED");
    localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify(parsed));
    if (readRuleConfirmationPending(owner)?.confirmationId !== parsed.confirmationId) throw new Error("RULE_RECOVERY_STORAGE_FAILED");
    notify(owner); return parsed;
  });
}
export async function releaseRuleConfirmation(owner: ConversationOwner, confirmationId: string, signal: AbortSignal) {
  return locked(owner, signal, () => {
    if (readRuleConfirmationPending(owner)?.confirmationId !== confirmationId) throw new Error("RULE_RECOVERY_CONFIRMATION_CHANGED");
    localStorage.removeItem(ruleConfirmationPendingKey(owner)); notify(owner);
  });
}
