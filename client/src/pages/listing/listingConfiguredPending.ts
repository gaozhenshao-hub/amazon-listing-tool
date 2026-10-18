import { z } from "zod";
import { ListingConfiguredIdSchema as id, ListingConfiguredUuidSchema as uuid, ListingConfiguredHashSchema as hash, ListingConfiguredOperationSchema, listingConfiguredCanonical as canonical } from "@shared/listingConfiguredWorkflow";
export const ListingConfiguredPendingContextSchema = z.object({ userId: id, workspaceId: id, projectId: id }).strict();
export type ListingConfiguredPendingContext = z.infer<typeof ListingConfiguredPendingContextSchema>;
const schema = z.object({ version: z.literal(1), context: ListingConfiguredPendingContextSchema, kind: z.enum(["start", "observed", "apply"]), operation: ListingConfiguredOperationSchema,
  operationId: uuid, runOperationId: uuid, requestHash: hash.nullable(), sourceHash: hash, runtimeHash: hash.nullable(), resultHash: hash.nullable() }).strict().refine(value =>
  (value.kind === "start" ? value.operationId === value.runOperationId && value.requestHash !== null && value.runtimeHash !== null && value.resultHash === null
    : value.kind === "observed" ? value.operationId === value.runOperationId && value.requestHash === null && value.runtimeHash === null && value.resultHash === null
      : value.operationId !== value.runOperationId && value.requestHash !== null && value.runtimeHash === null && value.resultHash !== null));
export type ListingConfiguredPending = z.infer<typeof schema>;
export const listingConfiguredPendingKey = (context: ListingConfiguredPendingContext) => `listing-configured-pending:v1:${canonical(ListingConfiguredPendingContextSchema.parse(context))}`;
const listeners = new Map<string, Set<() => void>>();
function storage() { try { return window.localStorage; } catch { throw new Error("LISTING_CONFIGURED_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("LISTING_CONFIGURED_LOCK_UNAVAILABLE"); return navigator.locks; }
const notify = (key: string) => { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate mounted views */ } } };
function checked(context: ListingConfiguredPendingContext, value: unknown) { const parsed = schema.safeParse(value); if (!parsed.success || canonical(parsed.data.context) !== canonical(context)) throw new Error("LISTING_CONFIGURED_PENDING_INVALID"); return parsed.data; }
export function readListingConfiguredPending(context: ListingConfiguredPendingContext): ListingConfiguredPending | null {
  const raw = storage().getItem(listingConfiguredPendingKey(context)); if (raw === null) return null; if (raw.length > 4096) throw new Error("LISTING_CONFIGURED_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("LISTING_CONFIGURED_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonical(parsed) !== raw) throw new Error("LISTING_CONFIGURED_PENDING_INVALID"); return parsed;
}
export async function withListingConfiguredPendingLock<T>(context: ListingConfiguredPendingContext, signal: AbortSignal, work: () => Promise<T>) {
  storage(); if (signal.aborted) throw new Error("LISTING_CONFIGURED_ABORTED"); return locks().request(listingConfiguredPendingKey(context), { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("LISTING_CONFIGURED_ABORTED"); return work(); });
}
/** Caller holds the owner/project lock. Replacing a verified successful start
 * with its apply is one storage write, retaining the original run UUID. */
export function reserveListingConfiguredPending(context: ListingConfiguredPendingContext, value: ListingConfiguredPending, replaceId?: string) {
  locks(); const key = listingConfiguredPendingKey(context), next = checked(context, value), previous = readListingConfiguredPending(context);
  if (previous && canonical(previous) === canonical(next)) return;
  if (replaceId ? !previous || previous.operationId !== replaceId || previous.kind === "apply" || next.kind !== "apply" || next.runOperationId !== previous.operationId
    || next.operation !== previous.operation || next.sourceHash !== previous.sourceHash : previous !== null) throw new Error("LISTING_CONFIGURED_PENDING_EXISTS");
  try { storage().setItem(key, canonical(next)); if (storage().getItem(key) !== canonical(next)) throw new Error("LISTING_CONFIGURED_STORAGE_UNVERIFIED"); } finally { notify(key); }
}
export function releaseListingConfiguredPending(context: ListingConfiguredPendingContext, expectedId: string) {
  locks(); uuid.parse(expectedId); const key = listingConfiguredPendingKey(context), previous = readListingConfiguredPending(context); if (!previous || previous.operationId !== expectedId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("LISTING_CONFIGURED_STORAGE_UNVERIFIED"); return true; } finally { notify(key); }
}
export function subscribeListingConfiguredPending(context: ListingConfiguredPendingContext, listener: () => void) {
  const key = listingConfiguredPendingKey(context), local = storage(), group = listeners.get(key) ?? new Set<() => void>(); group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === local || event.storageArea === null)) listener(); };
  window.addEventListener("storage", changed); return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
