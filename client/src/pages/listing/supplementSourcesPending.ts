import { z } from "zod";
import { SupplementIdentitySchema, SupplementHashSchema, SupplementUuidSchema, supplementCanonical as canonical } from "@shared/listingSupplementSources";
import { SupplementClientError } from "./supplementSourcesClientError";

export const SupplementPendingContextSchema = SupplementIdentitySchema.extend({ projectId: z.number().int().positive().max(2147483647) }).strict();
export type SupplementPendingContext = z.infer<typeof SupplementPendingContextSchema>;
const pendingSchema = z.object({ version: z.literal(1), context: SupplementPendingContextSchema, action: z.enum(["save", "delete_original", "delete_record"]), operationId: SupplementUuidSchema, sourceId: SupplementUuidSchema, requestHash: SupplementHashSchema, manifestHash: SupplementHashSchema.nullable() }).strict().refine(value => value.action === "save" ? value.sourceId === value.operationId && value.manifestHash === null : value.manifestHash !== null);
export type SupplementPending = z.infer<typeof pendingSchema>;
export const supplementPendingKey = (context: SupplementPendingContext) => `listing-supplement-pending:v1:${canonical(SupplementPendingContextSchema.parse(context))}`;
const listeners = new Map<string, Set<() => void>>();
function storage() { try { return window.localStorage; } catch { throw new SupplementClientError("SUPPLEMENT_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new SupplementClientError("SUPPLEMENT_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* Another view cannot interrupt persistence. */ } } }
function checked(context: SupplementPendingContext, value: unknown) { const result = pendingSchema.safeParse(value); if (!result.success || canonical(result.data.context) !== canonical(context)) throw new SupplementClientError("SUPPLEMENT_PENDING_INVALID"); return result.data; }
export function readSupplementPending(context: SupplementPendingContext): SupplementPending | null {
  const raw = storage().getItem(supplementPendingKey(context)); if (raw === null) return null;
  if (raw.length > 4096) throw new SupplementClientError("SUPPLEMENT_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new SupplementClientError("SUPPLEMENT_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonical(parsed) !== raw) throw new SupplementClientError("SUPPLEMENT_PENDING_INVALID"); return parsed;
}
export async function withSupplementLock<T>(context: SupplementPendingContext, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  storage(); if (signal.aborted) throw new SupplementClientError("SUPPLEMENT_ABORTED");
  return locks().request(supplementPendingKey(context), { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new SupplementClientError("SUPPLEMENT_ABORTED"); return work(); });
}
/** Caller holds the owner/project lock. Persist metadata only, never originals or records. */
export function reserveSupplementPending(context: SupplementPendingContext, value: SupplementPending) {
  locks(); const key = supplementPendingKey(context), next = checked(context, value), previous = readSupplementPending(context);
  if (previous && canonical(previous) === canonical(next)) return;
  if (previous) throw new SupplementClientError("SUPPLEMENT_PENDING_EXISTS");
  try { storage().setItem(key, canonical(next)); if (storage().getItem(key) !== canonical(next)) throw new SupplementClientError("SUPPLEMENT_STORAGE_UNVERIFIED"); } finally { notify(key); }
}
/** Only release an independently verified terminal receipt for this exact UUID. */
export function releaseSupplementPending(context: SupplementPendingContext, expectedId: string) {
  locks(); SupplementUuidSchema.parse(expectedId); const key = supplementPendingKey(context), previous = readSupplementPending(context);
  if (!previous || previous.operationId !== expectedId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new SupplementClientError("SUPPLEMENT_STORAGE_UNVERIFIED"); return true; } finally { notify(key); }
}
export function subscribeSupplementPending(context: SupplementPendingContext, listener: () => void) {
  const key = supplementPendingKey(context), local = storage(), group = listeners.get(key) ?? new Set<() => void>(); group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === null || event.storageArea === local)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
