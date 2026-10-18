import { z } from "zod";
import { AgentLibraryKeySchema, type AgentLibraryKey } from "@shared/agentLibraryContracts";
import { ASSISTANT_CONVERSATION_LIMITS as LIMITS } from "@shared/assistantConversation";

export type ConversationOwner = { userId: number; workspaceId: number; agentKey: AgentLibraryKey };
const id = z.number().int().min(1).max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
export const ConversationPendingSchema = z.object({
  version: z.literal(1), userId: id, workspaceId: id, agentKey: AgentLibraryKeySchema,
  threadId: uuid, operationId: uuid,
  // null when adopting a server history UUID whose original precondition is not public.
  expectedThreadVersion: id.nullable(),
  configurationRevision: id,
}).strict();
export type ConversationPending = z.infer<typeof ConversationPendingSchema>;
export const CONVERSATION_PENDING_EVENT = "assistant-conversation-pending-changed";
export const conversationPendingKey = (owner: ConversationOwner) => `assistant-conversation:v1:${owner.userId}:${owner.workspaceId}:${owner.agentKey}`;
export function conversationLocksAvailable() { return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"; }
export function readConversationPending(owner: ConversationOwner): ConversationPending | null {
  const raw = localStorage.getItem(conversationPendingKey(owner));
  if (raw === null) return null;
  if (raw.length > 2048) throw new Error("RECOVERY_METADATA_INVALID");
  const value = ConversationPendingSchema.parse(JSON.parse(raw));
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId || value.agentKey !== owner.agentKey) throw new Error("RECOVERY_OWNER_CHANGED");
  return value;
}
/** The lock covers only synchronous metadata changes, never network/model work. */
async function locked<T>(owner: ConversationOwner, signal: AbortSignal, work: () => T) {
  if (!conversationLocksAvailable()) throw new Error("BROWSER_LOCK_REQUIRED");
  return navigator.locks.request(conversationPendingKey(owner), { mode: "exclusive", signal }, () => {
    if (signal.aborted) throw new Error("OWNER_CHANGED");
    return work();
  });
}
function notify(owner: ConversationOwner) { window.dispatchEvent(new CustomEvent(CONVERSATION_PENDING_EVENT, { detail: conversationPendingKey(owner) })); }
export async function reserveConversationPending(owner: ConversationOwner, value: ConversationPending, signal: AbortSignal) {
  return locked(owner, signal, () => {
    if (readConversationPending(owner)) throw new Error("PENDING_OPERATION_EXISTS");
    const parsed = ConversationPendingSchema.parse(value);
    if (parsed.userId !== owner.userId || parsed.workspaceId !== owner.workspaceId || parsed.agentKey !== owner.agentKey) throw new Error("RECOVERY_OWNER_CHANGED");
    localStorage.setItem(conversationPendingKey(owner), JSON.stringify(parsed));
    if (readConversationPending(owner)?.operationId !== parsed.operationId) throw new Error("RECOVERY_STORAGE_FAILED");
    notify(owner); return parsed;
  });
}
export async function releaseConversationPending(owner: ConversationOwner, operationId: string, signal: AbortSignal) {
  return locked(owner, signal, () => {
    if (readConversationPending(owner)?.operationId !== operationId) throw new Error("RECOVERY_OPERATION_CHANGED");
    localStorage.removeItem(conversationPendingKey(owner)); notify(owner);
  });
}

export type ConversationDraftFile = { id: string; name: string; base64: string; sizeBytes: number; previewUrl: string | null };
const supported = /\.(png|jpe?g|webp|gif|txt|md|csv|json|pdf|docx|xlsx)$/iu;
export const CONVERSATION_FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,.pdf,.docx,.xlsx";
export function validateConversationFiles(incoming: readonly File[], existingCount: number) {
  if (incoming.length + existingCount > LIMITS.files) throw new Error("每次最多 3 个附件");
  for (const file of incoming) {
    if (!file.size || file.size > LIMITS.fileBytes) throw new Error("每个附件必须非空且不超过 3 MiB");
    if (!file.name || file.name.trim() !== file.name || file.name.length > 180 || /[\x00-\x1f\x7f/\\]/u.test(file.name) || !supported.test(file.name)) throw new Error("文件名称或类型不支持；请使用图片、TXT、MD、CSV、JSON、PDF、DOCX、XLSX");
  }
}
export function disposeConversationFiles(files: readonly ConversationDraftFile[]) { for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl); }
export async function readConversationFiles(incoming: readonly File[], existingCount: number, signal: AbortSignal): Promise<ConversationDraftFile[]> {
  validateConversationFiles(incoming, existingCount);
  const result: ConversationDraftFile[] = [];
  try {
    for (const file of incoming) {
      const base64 = await new Promise<string>((resolve, reject) => {
        if (signal.aborted) { reject(new Error("附件读取已取消")); return; }
        const reader = new FileReader();
        const abort = () => { reader.abort(); reject(new Error("附件读取已取消")); };
        const done = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
        reader.onload = () => { done(); const value = String(reader.result); const at = value.indexOf(","); if (at < 0 || !value.slice(at + 1)) reject(new Error("附件读取失败")); else resolve(value.slice(at + 1)); };
        reader.onerror = () => { done(); reject(new Error("附件读取失败")); };
        reader.onabort = () => { done(); reject(new Error("附件读取已取消")); };
        reader.readAsDataURL(file);
      });
      if (signal.aborted) throw new Error("附件读取已取消");
      const image = /\.(png|jpe?g|webp|gif)$/iu.test(file.name);
      result.push({ id: crypto.randomUUID(), name: file.name, sizeBytes: file.size, base64, previewUrl: image ? URL.createObjectURL(file) : null });
    }
    return result;
  } catch (error) { disposeConversationFiles(result); throw error; }
}
