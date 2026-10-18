import { z } from "zod";
import { KnowledgeQaIdentitySchema, KnowledgeQaUuidSchema, KnowledgeQaHashSchema, knowledgeQaCanonical as canonical } from "@shared/knowledgeQa";

export const KnowledgeQaPendingSchema = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema,
  threadId: KnowledgeQaUuidSchema, operationId: KnowledgeQaUuidSchema, kind: z.enum(["start", "observed"]),
  sourceHash: KnowledgeQaHashSchema.nullable(), runtimeHash: KnowledgeQaHashSchema.nullable(), requestHash: KnowledgeQaHashSchema.nullable(),
}).strict().refine(value => value.kind === "start" ? !!value.sourceHash && !!value.runtimeHash && !!value.requestHash
  : value.sourceHash === null && value.runtimeHash === null && value.requestHash === null);
export type KnowledgeQaPending = z.infer<typeof KnowledgeQaPendingSchema>;
type Identity = z.infer<typeof KnowledgeQaIdentitySchema>;
const listeners = new Map<string, Set<() => void>>();
export const knowledgeQaPendingKey = (identity: Identity) => `knowledge-qa-pending:v1:${canonical(KnowledgeQaIdentitySchema.parse(identity))}`;
function storage() { try { return window.localStorage; } catch { throw new Error("QA_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("QA_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate views */ } } }
function checked(identity: Identity, raw: unknown): KnowledgeQaPending {
  const parsed = KnowledgeQaPendingSchema.safeParse(raw);
  if (!parsed.success || canonical(parsed.data.identity) !== canonical(identity)) throw new Error("QA_PENDING_INVALID");
  return parsed.data;
}
/** Metadata only: no questions, answers, titles, source excerpts, or model data. */
export function readKnowledgeQaPending(identity: Identity): KnowledgeQaPending | null {
  const raw = storage().getItem(knowledgeQaPendingKey(identity)); if (raw === null) return null;
  if (raw.length > 2048) throw new Error("QA_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("QA_PENDING_INVALID"); }
  const parsed = checked(identity, value); if (canonical(parsed) !== raw) throw new Error("QA_PENDING_INVALID"); return parsed;
}
export async function withKnowledgeQaPendingLock<T>(identity: Identity, signal: AbortSignal, body: () => Promise<T>): Promise<T> {
  const key = knowledgeQaPendingKey(identity); storage(); if (signal.aborted) throw new Error("QA_ABORTED");
  return locks().request(key, { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("QA_ABORTED"); return body(); });
}
/** Caller holds the identity lock; another tab's unresolved UUID is never replaced. */
export function reserveKnowledgeQaPending(identity: Identity, raw: KnowledgeQaPending) {
  locks(); const value = checked(identity, raw), previous = readKnowledgeQaPending(identity), key = knowledgeQaPendingKey(identity);
  if (previous) { if (canonical(previous) === canonical(value)) return; throw new Error("QA_PENDING_EXISTS"); }
  try { storage().setItem(key, canonical(value)); if (storage().getItem(key) !== canonical(value)) throw new Error("QA_STORAGE_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseKnowledgeQaPending(identity: Identity, operationId: string) {
  locks(); KnowledgeQaUuidSchema.parse(operationId); const key = knowledgeQaPendingKey(identity), previous = readKnowledgeQaPending(identity);
  if (!previous || previous.operationId !== operationId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("QA_STORAGE_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeKnowledgeQaPending(identity: Identity, listener: () => void) {
  const key = knowledgeQaPendingKey(identity), store = storage(), group = listeners.get(key) ?? new Set<() => void>(); group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
