import { z } from "zod";
import { ListingConfiguredIdSchema as id, ListingConfiguredUuidSchema as uuid, ListingConfiguredHashSchema as hash, listingConfiguredCanonical as canonical } from "@shared/listingConfiguredWorkflow";
import { ListingAuxiliaryOperationSchema } from "@shared/listingAuxiliaryWorkflow";
export const ListingAuxiliaryPendingContextSchema = z.object({ userId: id, workspaceId: id, projectId: id }).strict();
export type ListingAuxiliaryPendingContext = z.infer<typeof ListingAuxiliaryPendingContextSchema>;
const schema = z.object({ version: z.literal(1), context: ListingAuxiliaryPendingContextSchema, kind: z.enum(["start", "observed", "apply"]), operation: ListingAuxiliaryOperationSchema,
  operationId: uuid, runOperationId: uuid, requestHash: hash.nullable(), previewHash: hash.nullable(), sourceHash: hash, draftHash: hash, runtimeHash: hash.nullable(), resultHash: hash.nullable() }).strict().refine(value =>
  (value.kind === "start" ? value.operationId === value.runOperationId && value.requestHash !== null && value.previewHash !== null && value.runtimeHash !== null && value.resultHash === null
    : value.kind === "observed" ? value.operationId === value.runOperationId && value.requestHash === null && value.runtimeHash === null && value.resultHash === null
      : value.operationId !== value.runOperationId && value.requestHash !== null && value.runtimeHash === null && value.resultHash !== null));
export type ListingAuxiliaryPending = z.infer<typeof schema>;
export const listingAuxiliaryPendingKey = (context: ListingAuxiliaryPendingContext) => `listing-auxiliary-pending:v1:${canonical(ListingAuxiliaryPendingContextSchema.parse(context))}`;
const listeners = new Map<string, Set<() => void>>();
function storage() { try { return window.localStorage; } catch { throw new Error("LISTING_AUXILIARY_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("LISTING_AUXILIARY_LOCK_UNAVAILABLE"); return navigator.locks; }
const notify = (key: string) => { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate mounted views */ } } };
function checked(context: ListingAuxiliaryPendingContext, value: unknown) { const parsed = schema.safeParse(value); if (!parsed.success || canonical(parsed.data.context) !== canonical(context)) throw new Error("LISTING_AUXILIARY_PENDING_INVALID"); return parsed.data; }
export function readListingAuxiliaryPending(context: ListingAuxiliaryPendingContext): ListingAuxiliaryPending | null {
  const raw = storage().getItem(listingAuxiliaryPendingKey(context)); if (raw === null) return null; if (raw.length > 4096) throw new Error("LISTING_AUXILIARY_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("LISTING_AUXILIARY_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonical(parsed) !== raw) throw new Error("LISTING_AUXILIARY_PENDING_INVALID"); return parsed;
}
export async function withListingAuxiliaryPendingLock<T>(context: ListingAuxiliaryPendingContext, signal: AbortSignal, work: () => Promise<T>) {
  storage(); if (signal.aborted) throw new Error("LISTING_AUXILIARY_ABORTED"); return locks().request(listingAuxiliaryPendingKey(context), { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("LISTING_AUXILIARY_ABORTED"); return work(); });
}
/** Caller holds the owner/project lock. Replacing a verified successful start
 * with its apply is one storage write, retaining the original run UUID. */
export function reserveListingAuxiliaryPending(context: ListingAuxiliaryPendingContext, value: ListingAuxiliaryPending, replaceId?: string) {
  locks(); const key = listingAuxiliaryPendingKey(context), next = checked(context, value), previous = readListingAuxiliaryPending(context);
  if (previous && canonical(previous) === canonical(next)) return;
  if (replaceId ? !previous || previous.operationId !== replaceId || previous.kind === "apply" || next.kind !== "apply" || next.runOperationId !== previous.operationId
    || next.operation !== previous.operation || next.sourceHash !== previous.sourceHash || next.draftHash !== previous.draftHash || next.previewHash !== previous.previewHash : previous !== null) throw new Error("LISTING_AUXILIARY_PENDING_EXISTS");
  try { storage().setItem(key, canonical(next)); if (storage().getItem(key) !== canonical(next)) throw new Error("LISTING_AUXILIARY_STORAGE_UNVERIFIED"); } finally { notify(key); }
}
export function releaseListingAuxiliaryPending(context: ListingAuxiliaryPendingContext, expectedId: string) {
  locks(); uuid.parse(expectedId); const key = listingAuxiliaryPendingKey(context), previous = readListingAuxiliaryPending(context); if (!previous || previous.operationId !== expectedId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("LISTING_AUXILIARY_STORAGE_UNVERIFIED"); return true; } finally { notify(key); }
}
export function subscribeListingAuxiliaryPending(context: ListingAuxiliaryPendingContext, listener: () => void) {
  const key = listingAuxiliaryPendingKey(context), local = storage(), group = listeners.get(key) ?? new Set<() => void>(); group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === local || event.storageArea === null)) listener(); };
  window.addEventListener("storage", changed); return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
