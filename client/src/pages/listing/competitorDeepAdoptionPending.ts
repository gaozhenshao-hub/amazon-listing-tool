import { z } from "zod";
import { CompetitorDeepAdoptionOperationInputSchema, competitorDeepAdoptionCanonical as canonical } from "@shared/competitorDeepAdoption";
import { CompetitorDeepPendingContextSchema, type CompetitorDeepPendingContext } from "./competitorDeepPending";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const schema = z.object({ version: z.literal(1), context: CompetitorDeepPendingContextSchema,
  operation: CompetitorDeepAdoptionOperationInputSchema, expectedRevision: hash, expectedResultHash: hash,
  expectedEvidenceHash: hash, summaryHash: hash, requestHash: hash }).strict().refine(value => value.context.projectId === value.operation.projectId
    && value.context.analysisId === value.operation.analysisId && value.context.workspaceId === value.operation.expectedWorkspaceId);
export type CompetitorDeepAdoptionPending = z.infer<typeof schema>;
export type CompetitorDeepAdoptionContext = CompetitorDeepPendingContext;
const listeners = new Map<string, Set<() => void>>();
export function deepAdoptionPendingKey(context: CompetitorDeepAdoptionContext) {
  return "competitor-deep-adoption-pending:v1:" + canonical(CompetitorDeepPendingContextSchema.parse(context));
}
function storage() { try { return window.localStorage; } catch { throw new Error("ADOPTION_STORAGE_UNAVAILABLE"); } }
function locks() { if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("ADOPTION_LOCK_UNAVAILABLE"); return navigator.locks; }
function notify(key: string) { for (const listener of [...listeners.get(key) ?? []]) { try { listener(); } catch { /* isolate another view */ } } }
function checked(context: CompetitorDeepAdoptionContext, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success || canonical(parsed.data.context) !== canonical(context)) throw new Error("ADOPTION_PENDING_INVALID");
  return parsed.data;
}
export function readDeepAdoptionPending(context: CompetitorDeepAdoptionContext): CompetitorDeepAdoptionPending | null {
  const raw = storage().getItem(deepAdoptionPendingKey(context)); if (raw === null) return null;
  if (raw.length > 8192) throw new Error("ADOPTION_PENDING_INVALID");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("ADOPTION_PENDING_INVALID"); }
  const parsed = checked(context, value); if (canonical(parsed) !== raw) throw new Error("ADOPTION_PENDING_INVALID"); return parsed;
}
export async function withDeepAdoptionLock<T>(context: CompetitorDeepAdoptionContext, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const key = deepAdoptionPendingKey(context); storage(); if (signal.aborted) throw new Error("ADOPTION_ABORTED");
  return locks().request(key, { mode: "exclusive", signal }, async () => { if (signal.aborted) throw new Error("ADOPTION_ABORTED"); return work(); });
}
/** Only call reserve/release inside the matching owner lock; never store summary/body. */
export function reserveDeepAdoptionPending(context: CompetitorDeepAdoptionContext, value: CompetitorDeepAdoptionPending) {
  locks(); const key = deepAdoptionPendingKey(context), pending = checked(context, value), previous = readDeepAdoptionPending(context);
  if (previous) { if (canonical(previous) === canonical(pending)) return; throw new Error("ADOPTION_PENDING_EXISTS"); }
  try { storage().setItem(key, canonical(pending)); if (storage().getItem(key) !== canonical(pending)) throw new Error("ADOPTION_STORAGE_UNVERIFIED"); }
  finally { notify(key); }
}
export function releaseDeepAdoptionPending(context: CompetitorDeepAdoptionContext, operationId: string) {
  locks(); const key = deepAdoptionPendingKey(context), pending = readDeepAdoptionPending(context);
  if (!pending || pending.operation.operationId !== operationId) return false;
  try { storage().removeItem(key); if (storage().getItem(key) !== null) throw new Error("ADOPTION_STORAGE_UNVERIFIED"); return true; }
  finally { notify(key); }
}
export function subscribeDeepAdoptionPending(context: CompetitorDeepAdoptionContext, listener: () => void) {
  const key = deepAdoptionPendingKey(context), store = storage(), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key, group);
  const changed = (event: StorageEvent) => { if ((event.key === null || event.key === key) && (event.storageArea === null || event.storageArea === store)) listener(); };
  window.addEventListener("storage", changed);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); window.removeEventListener("storage", changed); };
}
