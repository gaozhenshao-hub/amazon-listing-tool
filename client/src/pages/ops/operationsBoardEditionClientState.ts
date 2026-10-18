import { z } from "zod";
import { operationsBoardEditionCanonical, operationsBoardEditionHash, OperationsBoardEditionStateInputSchema } from "@shared/operationsBoardEdition";

export type BoardOwner = { userId: number; workspaceId: number; role: string };
export type BoardScope = { storeName: string; country: string };
export type BoardOperationContext = { identity: { userId: number; workspaceId: number }; namespace: "edition" | "partners"; scope: BoardScope | null };
const id = z.number().int().positive().max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.object({ storeName: z.string().min(1).max(200), country: z.string().min(1).max(50) }).strict();
const contextSchema = z.object({ identity: z.object({ userId: id, workspaceId: id }).strict(), namespace: z.enum(["edition", "partners"]),
  scope: scopeSchema.nullable() }).strict().superRefine((value, ctx) => {
  if (value.namespace === "edition" ? !value.scope || !OperationsBoardEditionStateInputSchema.safeParse({ expectedWorkspaceId: value.identity.workspaceId, scope: value.scope }).success : value.scope !== null) ctx.addIssue({ code: "custom", message: "Invalid operation context" });
});
const pendingSchema = z.object({ version: z.literal(1), context: contextSchema, operationId: uuid, requestHash: hash,
  action: z.enum(["initialize", "publishRevision", "saveNote", "setPartner"]), editionId: id.nullable(), parentAsin: z.string().min(1).max(500).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.context.namespace === "partners" ? value.action !== "setPartner" || value.editionId !== null || value.parentAsin !== null
    : value.action === "setPartner" || (value.action === "saveNote" ? value.editionId === null || value.parentAsin === null : value.parentAsin !== null || (value.action === "initialize") !== (value.editionId === null))) ctx.addIssue({ code: "custom", message: "Operation target mismatch" });
});
export type BoardPendingOperation = z.infer<typeof pendingSchema>;
export function boardOperationContext(owner: BoardOwner, scope: BoardScope | null): BoardOperationContext {
  return contextSchema.parse({ identity: { userId: owner.userId, workspaceId: owner.workspaceId }, namespace: scope ? "edition" : "partners", scope });
}
const canonical = (value: unknown) => operationsBoardEditionCanonical(value, 8192);
export function boardPendingKey(context: BoardOperationContext) { return `ops-board-operation:v1:${operationsBoardEditionHash(contextSchema.parse(context), 8192)}`; }
function storage() { if (typeof window === "undefined") throw new Error("STORAGE_UNAVAILABLE"); return window.localStorage; }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("LOCK_UNAVAILABLE"); return navigator.locks; }
const pendingListeners = new Map<string, Set<() => void>>();
function notify(key: string) { for (const listener of pendingListeners.get(key) ?? []) { try { listener(); } catch { /* independently invalidate subscribers */ } } }
function checked(raw: unknown, context: BoardOperationContext) {
  canonical(raw); const value = pendingSchema.parse(raw);
  if (canonical(value.context) !== canonical(contextSchema.parse(context))) throw new Error("PENDING_CONTEXT_CHANGED");
  return value;
}
export function readBoardPending(context: BoardOperationContext): BoardPendingOperation | null {
  const raw = storage().getItem(boardPendingKey(context)); if (raw === null) return null;
  if (raw.length > 8192) throw new Error("PENDING_INVALID");
  const value = checked(JSON.parse(raw), context);
  if (raw !== canonical(value)) throw new Error("PENDING_INVALID");
  return value;
}
export async function withBoardPendingLock<T>(context: BoardOperationContext, signal: AbortSignal, work: () => Promise<T>) {
  storage(); if (signal.aborted) throw new Error("ABORTED");
  return locks().request(boardPendingKey(context), { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("ABORTED"); return work(); });
}
/** Caller holds the matching Web Lock; neither financial rows nor note bodies
 * are permitted by this metadata schema. A second UUID cannot replace one. */
export function reserveBoardPending(context: BoardOperationContext, pending: BoardPendingOperation) {
  locks(); const value = checked(pending, context), before = readBoardPending(context), key = boardPendingKey(context), encoded = canonical(value);
  if (before) { if (canonical(before) !== encoded) throw new Error("PENDING_CONFLICT"); return; }
  try { storage().setItem(key, encoded); if (storage().getItem(key) !== encoded) throw new Error("PENDING_UNVERIFIED"); } finally { notify(key); }
}
/** Caller holds the same lock and has verified a final server receipt. */
export function releaseBoardPending(context: BoardOperationContext, operationId: string) {
  locks(); uuid.parse(operationId); const before = readBoardPending(context); if (!before || before.operationId !== operationId) return false;
  const key = boardPendingKey(context);
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("PENDING_UNVERIFIED"); return true; } finally { notify(key); }
}
export function subscribeBoardPending(context: BoardOperationContext, listener: () => void) {
  const key = boardPendingKey(context), currentStorage = storage(), group = pendingListeners.get(key) ?? new Set();
  group.add(listener); pendingListeners.set(key, group);
  const onStorage = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === null || event.storageArea === currentStorage)) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { group.delete(listener); if (!group.size) pendingListeners.delete(key); window.removeEventListener("storage", onStorage); };
}

export type BoardEditionChange = { workspaceId: number; scope: BoardScope | null; action: "edition" | "note" | "partners" };
const changeSchema = z.object({ workspaceId: id, scope: scopeSchema.nullable(), action: z.enum(["edition", "note", "partners"]) }).strict();
const changes = new Set<(notice: BoardEditionChange) => void>();
const eventKey = "ops-board-changed:v1";
export function publishBoardEditionChange(raw: BoardEditionChange) {
  const notice = changeSchema.parse(raw); for (const listener of changes) { try { listener(notice); } catch { /* no authority from notices */ } }
  try { storage().setItem(eventKey, JSON.stringify({ ...notice, nonce: crypto.randomUUID() })); } catch { /* local committed result remains true; explicit reload works */ }
}
export function subscribeBoardEditionChanges(listener: (notice: BoardEditionChange) => void) {
  changes.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== eventKey || !event.newValue || event.newValue.length > 1024) return;
    try { const { nonce: _nonce, ...raw } = JSON.parse(event.newValue); const parsed = changeSchema.safeParse(raw); if (parsed.success) listener(parsed.data); } catch { /* untrusted events never grant access */ }
  };
  window.addEventListener("storage", onStorage);
  return () => { changes.delete(listener); window.removeEventListener("storage", onStorage); };
}
