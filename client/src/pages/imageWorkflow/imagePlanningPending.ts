import { z } from "zod";

const id = z.number().int().positive().max(2_147_483_647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ImagePlanningPendingContextSchema = z.object({ userId: id, workspaceId: id, projectId: id, sessionId: id }).strict();
export type ImagePlanningPendingContext = z.infer<typeof ImagePlanningPendingContextSchema>;
const pendingSchema = z.object({ version: z.literal(1), context: ImagePlanningPendingContextSchema,
  kind: z.enum(["start", "apply", "observed"]), operationId: uuid, runOperationId: uuid,
  requestHash: hash.nullable(), sourceHash: hash.nullable(), runtimeHash: hash.nullable(), resultHash: hash.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "observed" ? value.operationId !== value.runOperationId || value.requestHash !== null || value.resultHash !== null
    : value.requestHash === null || value.sourceHash === null || (value.kind === "start" ? value.operationId !== value.runOperationId || value.runtimeHash === null || value.resultHash !== null
    : value.operationId === value.runOperationId || value.runtimeHash !== null || value.resultHash === null))
    ctx.addIssue({ code: "custom", message: "Pending operation binding invalid" });
});
export type ImagePlanningPending = z.infer<typeof pendingSchema>;
export function imagePlanningPendingCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(imagePlanningPendingCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${imagePlanningPendingCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const listeners = new Map<string, Set<() => void>>();
export function imagePlanningPendingKey(context: ImagePlanningPendingContext) {
  return "image-planning-pending:v1:" + imagePlanningPendingCanonical(ImagePlanningPendingContextSchema.parse(context));
}
function storage() { try { return window.localStorage; } catch { throw new Error("PLANNING_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("PLANNING_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate views */ } } }
function checked(context: ImagePlanningPendingContext, value: unknown) {
  const parsed = pendingSchema.safeParse(value);
  if (!parsed.success || imagePlanningPendingCanonical(parsed.data.context) !== imagePlanningPendingCanonical(ImagePlanningPendingContextSchema.parse(context))) throw new Error("PLANNING_PENDING_INVALID");
  return parsed.data;
}
export function readImagePlanningPending(context: ImagePlanningPendingContext): ImagePlanningPending | null {
  const raw = storage().getItem(imagePlanningPendingKey(context)); if (raw === null) return null;
  if (raw.length > 4096) throw new Error("PLANNING_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("PLANNING_PENDING_INVALID"); }
  const parsed = checked(context, value);
  if (imagePlanningPendingCanonical(parsed) !== raw) throw new Error("PLANNING_PENDING_INVALID");
  return parsed;
}
export async function withImagePlanningPendingLock<T>(context: ImagePlanningPendingContext, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const key = imagePlanningPendingKey(context); storage(); if (signal.aborted) throw new Error("PLANNING_ABORTED");
  return locks().request(key, { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("PLANNING_ABORTED"); return work(); });
}
/** Caller holds the exact owner/project/session lock. Never persist labels, pixels or URLs. */
export function reserveImagePlanningPending(context: ImagePlanningPendingContext, value: ImagePlanningPending) {
  locks(); const key = imagePlanningPendingKey(context), pending = checked(context, value), previous = readImagePlanningPending(context);
  if (previous) { if (imagePlanningPendingCanonical(previous) === imagePlanningPendingCanonical(pending)) return; throw new Error("PLANNING_PENDING_EXISTS"); }
  try { storage().setItem(key, imagePlanningPendingCanonical(pending)); if (storage().getItem(key) !== imagePlanningPendingCanonical(pending)) throw new Error("PLANNING_STORAGE_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseImagePlanningPending(context: ImagePlanningPendingContext, operationId: string) {
  locks(); uuid.parse(operationId); const key = imagePlanningPendingKey(context), pending = readImagePlanningPending(context);
  if (!pending || pending.operationId !== operationId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("PLANNING_STORAGE_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeImagePlanningPending(context: ImagePlanningPendingContext, listener: () => void) {
  const key = imagePlanningPendingKey(context), store = storage(), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === null || event.key === key) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
