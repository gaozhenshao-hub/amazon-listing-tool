import { z } from "zod";

const id = z.number().int().positive().max(2_147_483_647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ImageTaggingPendingContextSchema = z.object({ userId: id, workspaceId: id, imageSetId: id }).strict();
export type ImageTaggingPendingContext = z.infer<typeof ImageTaggingPendingContextSchema>;
const pendingSchema = z.object({ version: z.literal(1), context: ImageTaggingPendingContextSchema,
  kind: z.enum(["start", "apply", "observed"]), operationId: uuid, runOperationId: uuid,
  requestHash: hash.nullable(), sourceHash: hash.nullable(), runtimeHash: hash.nullable(), resultHash: hash.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "observed" ? value.operationId !== value.runOperationId || value.requestHash !== null || value.resultHash !== null
    : value.requestHash === null || value.sourceHash === null || (value.kind === "start" ? value.operationId !== value.runOperationId || value.runtimeHash === null || value.resultHash !== null
    : value.operationId === value.runOperationId || value.runtimeHash !== null || value.resultHash === null))
    ctx.addIssue({ code: "custom", message: "Pending operation binding invalid" });
});
export type ImageTaggingPending = z.infer<typeof pendingSchema>;
export function imageTaggingPendingCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(imageTaggingPendingCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${imageTaggingPendingCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const listeners = new Map<string, Set<() => void>>();
export function imageTaggingPendingKey(context: ImageTaggingPendingContext) {
  return "image-tagging-pending:v1:" + imageTaggingPendingCanonical(ImageTaggingPendingContextSchema.parse(context));
}
function storage() { try { return window.localStorage; } catch { throw new Error("TAGGING_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("TAGGING_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate views */ } } }
function checked(context: ImageTaggingPendingContext, value: unknown) {
  const parsed = pendingSchema.safeParse(value);
  if (!parsed.success || imageTaggingPendingCanonical(parsed.data.context) !== imageTaggingPendingCanonical(ImageTaggingPendingContextSchema.parse(context))) throw new Error("TAGGING_PENDING_INVALID");
  return parsed.data;
}
export function readImageTaggingPending(context: ImageTaggingPendingContext): ImageTaggingPending | null {
  const raw = storage().getItem(imageTaggingPendingKey(context)); if (raw === null) return null;
  if (raw.length > 4096) throw new Error("TAGGING_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("TAGGING_PENDING_INVALID"); }
  const parsed = checked(context, value);
  if (imageTaggingPendingCanonical(parsed) !== raw) throw new Error("TAGGING_PENDING_INVALID");
  return parsed;
}
export async function withImageTaggingPendingLock<T>(context: ImageTaggingPendingContext, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const key = imageTaggingPendingKey(context); storage(); if (signal.aborted) throw new Error("TAGGING_ABORTED");
  return locks().request(key, { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("TAGGING_ABORTED"); return work(); });
}
/** Caller holds the exact owner/set lock. Never persist labels, pixels or URLs. */
export function reserveImageTaggingPending(context: ImageTaggingPendingContext, value: ImageTaggingPending) {
  locks(); const key = imageTaggingPendingKey(context), pending = checked(context, value), previous = readImageTaggingPending(context);
  if (previous) { if (imageTaggingPendingCanonical(previous) === imageTaggingPendingCanonical(pending)) return; throw new Error("TAGGING_PENDING_EXISTS"); }
  try { storage().setItem(key, imageTaggingPendingCanonical(pending)); if (storage().getItem(key) !== imageTaggingPendingCanonical(pending)) throw new Error("TAGGING_STORAGE_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseImageTaggingPending(context: ImageTaggingPendingContext, operationId: string) {
  locks(); uuid.parse(operationId); const key = imageTaggingPendingKey(context), pending = readImageTaggingPending(context);
  if (!pending || pending.operationId !== operationId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("TAGGING_STORAGE_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeImageTaggingPending(context: ImageTaggingPendingContext, listener: () => void) {
  const key = imageTaggingPendingKey(context), store = storage(), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === null || event.key === key) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
