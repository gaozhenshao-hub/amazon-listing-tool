import { z } from "zod";
import { VideoWorkflowIdSchema as id, VideoWorkflowUuidSchema as uuid, VideoWorkflowHashSchema as hash, VideoWorkflowOperationSchema, videoWorkflowCanonical as canonical } from "@shared/videoWorkflow";
export const VideoWorkflowPendingContextSchema = z.object({ userId: id, workspaceId: id, projectId: id, videoScriptId: id }).strict();
export type VideoWorkflowPendingContext = z.infer<typeof VideoWorkflowPendingContextSchema>;
const schema = z.object({ version: z.literal(1), context: VideoWorkflowPendingContextSchema, kind: z.enum(["start", "observed", "apply"]), operation: VideoWorkflowOperationSchema,
  competitorScriptId: id.nullable(), operationId: uuid, runOperationId: uuid, requestHash: hash.nullable(), sourceHash: hash, runtimeHash: hash.nullable(), resultHash: hash.nullable() }).strict().refine(value =>
  (value.operation === "competitor_analysis") === (value.competitorScriptId !== null) && (value.kind === "start" ? value.operationId === value.runOperationId && value.requestHash !== null && value.runtimeHash !== null && value.resultHash === null
    : value.kind === "observed" ? value.operationId === value.runOperationId && value.requestHash === null && value.runtimeHash === null && value.resultHash === null
      : value.operationId !== value.runOperationId && value.requestHash !== null && value.runtimeHash === null && value.resultHash !== null));
export type VideoWorkflowPending = z.infer<typeof schema>;
export const videoWorkflowPendingKey = (context: VideoWorkflowPendingContext) => `video-workflow-pending:v1:${canonical(VideoWorkflowPendingContextSchema.parse(context))}`;
const listeners = new Map<string, Set<() => void>>();
function storage() { try { return window.localStorage; } catch { throw new Error("VIDEO_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("VIDEO_LOCK_UNAVAILABLE"); return navigator.locks; }
const notify = (key: string) => { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate mounted views */ } } };
function checked(context: VideoWorkflowPendingContext, value: unknown) { const parsed = schema.safeParse(value); if (!parsed.success || canonical(parsed.data.context) !== canonical(context)) throw new Error("VIDEO_PENDING_INVALID"); return parsed.data; }
export function readVideoWorkflowPending(context: VideoWorkflowPendingContext): VideoWorkflowPending | null {
  const raw = storage().getItem(videoWorkflowPendingKey(context)); if (raw === null) return null; if (raw.length > 4096) throw new Error("VIDEO_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("VIDEO_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonical(parsed) !== raw) throw new Error("VIDEO_PENDING_INVALID"); return parsed;
}
export async function withVideoWorkflowPendingLock<T>(context: VideoWorkflowPendingContext, signal: AbortSignal, work: () => Promise<T>) {
  storage(); if (signal.aborted) throw new Error("VIDEO_ABORTED"); return locks().request(videoWorkflowPendingKey(context), { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("VIDEO_ABORTED"); return work(); });
}
/** Caller holds the owner/script lock. Replacing a verified successful start
 * with its apply is one storage write, retaining the original run UUID. */
export function reserveVideoWorkflowPending(context: VideoWorkflowPendingContext, value: VideoWorkflowPending, replaceId?: string) {
  locks(); const key = videoWorkflowPendingKey(context), next = checked(context, value), previous = readVideoWorkflowPending(context);
  if (previous && canonical(previous) === canonical(next)) return;
  if (replaceId ? !previous || previous.operationId !== replaceId || previous.kind === "apply" || next.kind !== "apply" || next.runOperationId !== previous.operationId
    || next.operation !== previous.operation || next.competitorScriptId !== previous.competitorScriptId || next.sourceHash !== previous.sourceHash : previous !== null) throw new Error("VIDEO_PENDING_EXISTS");
  try { storage().setItem(key, canonical(next)); if (storage().getItem(key) !== canonical(next)) throw new Error("VIDEO_STORAGE_UNVERIFIED"); } finally { notify(key); }
}
export function releaseVideoWorkflowPending(context: VideoWorkflowPendingContext, expectedId: string) {
  locks(); uuid.parse(expectedId); const key = videoWorkflowPendingKey(context), previous = readVideoWorkflowPending(context); if (!previous || previous.operationId !== expectedId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("VIDEO_STORAGE_UNVERIFIED"); return true; } finally { notify(key); }
}
export function subscribeVideoWorkflowPending(context: VideoWorkflowPendingContext, listener: () => void) {
  const key = videoWorkflowPendingKey(context), local = storage(), group = listeners.get(key) ?? new Set<() => void>(); group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === key || event.key === null) && (event.storageArea === local || event.storageArea === null)) listener(); };
  window.addEventListener("storage", changed); return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
