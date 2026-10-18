import { z } from "zod";
import { canonicalCompetitorResearchEvidence as canonical } from "@shared/competitorResearchEvidence";

const id = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
export const CompetitorDeepPendingContextSchema = z.object({ userId: id, workspaceId: id.nullable(), projectId: id, analysisId: id, asin: z.string().regex(/^[A-Z0-9]{10}$/u) }).strict();
export type CompetitorDeepPendingContext = z.infer<typeof CompetitorDeepPendingContextSchema>;
const pendingSchema = z.object({ version: z.literal(1), context: CompetitorDeepPendingContextSchema, operationId: uuid, expectedRevision: hash, expectedEvidenceHash: hash }).strict();
export type CompetitorDeepPending = z.infer<typeof pendingSchema>;
const subscribers = new Map<string, Set<() => void>>();
function safe<T>(schema: z.ZodType<T>, value: unknown): T {
  const checked = schema.safeParse(value); if (!checked.success) throw new Error("DEEP_PENDING_INVALID"); return checked.data;
}
export function competitorDeepPendingKey(context: CompetitorDeepPendingContext): string {
  const owner = safe(CompetitorDeepPendingContextSchema, context);
  // Exclude source revision: an old unresolved UUID must remain discoverable
  // after the same product's source changes. No source or note body is stored.
  return "competitor-deep-pending:v1:" + canonical(owner);
}
function storage() {
  if (typeof window === "undefined") throw new Error("DEEP_PENDING_BROWSER_UNAVAILABLE");
  try { return window.localStorage; } catch { throw new Error("DEEP_PENDING_STORAGE_UNAVAILABLE"); }
}
function lockManager() {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("DEEP_PENDING_LOCK_UNAVAILABLE");
  return navigator.locks;
}
function notify(key: string) { for (const callback of [...subscribers.get(key) ?? []]) { try { callback(); } catch { /* isolate a stale view */ } } }
function checked(context: CompetitorDeepPendingContext, value: unknown) {
  const pending = safe(pendingSchema, value);
  if (canonical(pending.context) !== canonical(context)) throw new Error("DEEP_PENDING_SCOPE_CHANGED");
  return pending;
}
export function readCompetitorDeepPending(context: CompetitorDeepPendingContext): CompetitorDeepPending | null {
  const key = competitorDeepPendingKey(context), raw = storage().getItem(key);
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error("DEEP_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("DEEP_PENDING_INVALID"); }
  const pending = checked(context, value);
  if (canonical(pending) !== raw) throw new Error("DEEP_PENDING_INVALID");
  return pending;
}
/** All reserve/release calls must be inside this exact context's lock. */
export async function withCompetitorDeepPendingLock<T>(context: CompetitorDeepPendingContext, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  const key = competitorDeepPendingKey(context); storage();
  if (signal.aborted) throw new Error("DEEP_PENDING_ABORTED");
  return lockManager().request(key, { mode: "exclusive", signal }, async () => {
    if (signal.aborted) throw new Error("DEEP_PENDING_ABORTED");
    return action();
  });
}
export function reserveCompetitorDeepPending(context: CompetitorDeepPendingContext, value: CompetitorDeepPending): void {
  lockManager(); const key = competitorDeepPendingKey(context), pending = checked(context, value), previous = readCompetitorDeepPending(context);
  if (previous) { if (canonical(previous) === canonical(pending)) return; throw new Error("DEEP_PENDING_EXISTS"); }
  try { storage().setItem(key, canonical(pending)); if (storage().getItem(key) !== canonical(pending)) throw new Error("DEEP_PENDING_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseCompetitorDeepPending(context: CompetitorDeepPendingContext, expectedId: string): boolean {
  lockManager(); safe(uuid, expectedId); const key = competitorDeepPendingKey(context), pending = readCompetitorDeepPending(context);
  if (!pending || pending.operationId !== expectedId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("DEEP_PENDING_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeCompetitorDeepPending(context: CompetitorDeepPendingContext, listener: () => void): () => void {
  const key = competitorDeepPendingKey(context), store = storage(), callbacks = subscribers.get(key) ?? new Set<() => void>();
  callbacks.add(listener); subscribers.set(key, callbacks);
  const changed = (event: StorageEvent) => { if ((event.key === null || event.key === key) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { callbacks.delete(listener); if (!callbacks.size) subscribers.delete(key); window.removeEventListener("storage", changed); };
}
