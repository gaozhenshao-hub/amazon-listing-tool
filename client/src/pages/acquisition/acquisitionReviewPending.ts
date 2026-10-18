import { z } from "zod";
import { acquisitionReviewCanonical } from "@shared/acquisitionReview";

const id = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
export const AcquisitionReviewPendingContextSchema = z.object({ userId: id, workspaceId: id,
  projectId: id.nullable(), snapshotId: id }).strict();
export type AcquisitionReviewPendingContext = z.infer<typeof AcquisitionReviewPendingContextSchema>;
const pendingSchema = z.object({ version: z.literal(1), context: AcquisitionReviewPendingContextSchema,
  operationId: uuid, action: z.enum(["save", "confirm", "reject", "image"]), expectedRevisionHash: hash, requestHash: hash }).strict();
export type AcquisitionReviewPending = z.infer<typeof pendingSchema>;
export const canonicalReviewValue = acquisitionReviewCanonical;
const listeners = new Map<string, Set<() => void>>();
export function acquisitionReviewPendingKey(context: AcquisitionReviewPendingContext) {
  return "acquisition-review-pending:v1:" + canonicalReviewValue(AcquisitionReviewPendingContextSchema.parse(context));
}
function storage() { try { return window.localStorage; } catch { throw new Error("REVIEW_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("REVIEW_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate another view */ } } }
function checked(context: AcquisitionReviewPendingContext, value: unknown) {
  const parsed = pendingSchema.safeParse(value);
  if (!parsed.success || canonicalReviewValue(parsed.data.context) !== canonicalReviewValue(context)) throw new Error("REVIEW_PENDING_INVALID");
  return parsed.data;
}
export function readAcquisitionReviewPending(context: AcquisitionReviewPendingContext): AcquisitionReviewPending | null {
  const raw = storage().getItem(acquisitionReviewPendingKey(context)); if (raw === null) return null;
  if (raw.length > 8192) throw new Error("REVIEW_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("REVIEW_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonicalReviewValue(parsed) !== raw) throw new Error("REVIEW_PENDING_INVALID"); return parsed;
}
export async function withAcquisitionReviewLock<T>(context: AcquisitionReviewPendingContext, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const key = acquisitionReviewPendingKey(context); storage(); if (signal.aborted) throw new Error("REVIEW_ABORTED");
  return locks().request(key, { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("REVIEW_ABORTED"); return work(); });
}
/** Caller must hold the exact owner/snapshot lock. Never store draft text or bytes. */
export function reserveAcquisitionReviewPending(context: AcquisitionReviewPendingContext, value: AcquisitionReviewPending) {
  locks(); const key = acquisitionReviewPendingKey(context), pending = checked(context, value), previous = readAcquisitionReviewPending(context);
  if (previous) { if (canonicalReviewValue(previous) === canonicalReviewValue(pending)) return; throw new Error("REVIEW_PENDING_EXISTS"); }
  try { storage().setItem(key, canonicalReviewValue(pending)); if (storage().getItem(key) !== canonicalReviewValue(pending)) throw new Error("REVIEW_STORAGE_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseAcquisitionReviewPending(context: AcquisitionReviewPendingContext, operationId: string) {
  locks(); uuid.parse(operationId); const key = acquisitionReviewPendingKey(context), pending = readAcquisitionReviewPending(context);
  if (!pending || pending.operationId !== operationId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("REVIEW_STORAGE_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeAcquisitionReviewPending(context: AcquisitionReviewPendingContext, listener: () => void) {
  const key = acquisitionReviewPendingKey(context), store = storage(), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === null || event.key === key) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
