import { z } from "zod";
import { ProfitAnalysisPreviewInputSchema, type ProfitAnalysisPreviewInput } from "@shared/profitAnalysis";
import { ProfitAnalysisStartInputSchema, ProfitAnalysisSaveInputSchema,
  type ProfitAnalysisStartInput, type ProfitAnalysisSaveInput } from "@shared/profitAnalysisWorkflow";

/** Recovery metadata is neither financial data nor authority to replay a write.
 * The caller must hold the matching browser lock for reserve/release, and only
 * release after validating an authoritative terminal receipt for that UUID. */
export type ProfitAnalysisPendingOwner = { userId: number; workspaceId: number };
export type ProfitAnalysisPending =
  | { version: 1; identity: ProfitAnalysisPendingOwner; kind: "generate"; request: ProfitAnalysisStartInput }
  | { version: 1; identity: ProfitAnalysisPendingOwner; kind: "save"; request: ProfitAnalysisSaveInput };
export const PROFIT_ANALYSIS_PENDING_MAX_BYTES = 8192;
type ErrorCode = "INVALID" | "SCOPE_MISMATCH" | "BROWSER_UNAVAILABLE" | "STORAGE_UNAVAILABLE" | "STORAGE_UNVERIFIED"
  | "LOCK_UNAVAILABLE" | "ABORTED" | "PENDING_CONFLICT" | "CONTENT_CONFLICT";
export class ProfitAnalysisPendingError extends Error {
  constructor(readonly code: ErrorCode) { super(`PROFIT_ANALYSIS_PENDING_${code}`); this.name = "ProfitAnalysisPendingError"; }
}
function fail(code: ErrorCode): never { throw new ProfitAnalysisPendingError(code); }
const id = z.number().int().safe().positive().max(2_147_483_647);
const ownerSchema = z.object({ userId: id, workspaceId: id }).strict();
const uuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
const pendingSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), identity: ownerSchema, kind: z.literal("generate"), request: ProfitAnalysisStartInputSchema }).strict(),
  z.object({ version: z.literal(1), identity: ownerSchema, kind: z.literal("save"), request: ProfitAnalysisSaveInputSchema }).strict(),
]);
const listeners = new Map<string, Set<() => void>>();
function notify(key: string) {
  // One stale subscriber must not hide a completed/uncertain storage write from
  // other views. Listeners receive only an invalidation, never stored content.
  for (const listener of [...(listeners.get(key) ?? [])]) { try { listener(); } catch { /* isolate subscriber failure */ } }
}
function bytes(text: string) {
  const encoded = new TextEncoder().encode(text);
  if (new TextDecoder("utf-8", { fatal: true }).decode(encoded) !== text) fail("INVALID");
  return encoded.byteLength;
}
function canonical(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 150 || depth > 8) fail("INVALID");
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") { if (!Number.isFinite(item)) fail("INVALID"); return JSON.stringify(item); }
    if (typeof item === "string") { if (item.length > 2048) fail("INVALID"); bytes(item); return JSON.stringify(item); }
    if (!item || typeof item !== "object" || Array.isArray(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail("INVALID");
    const entries = Reflect.ownKeys(item);
    if (entries.some(key => typeof key !== "string")) fail("INVALID");
    return `{${(entries as string[]).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) fail("INVALID");
      return `${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`;
    }).join(",")}}`;
  };
  const result = visit(value, 0); if (bytes(result) > PROFIT_ANALYSIS_PENDING_MAX_BYTES) fail("INVALID"); return result;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  canonical(value); const checked = schema.safeParse(value); if (!checked.success) fail("INVALID"); return checked.data;
}
function context(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput) {
  const identity = parse(ownerSchema, owner), request = parse(ProfitAnalysisPreviewInputSchema, input);
  if (identity.workspaceId !== request.expectedWorkspaceId) fail("SCOPE_MISMATCH");
  const scope = request.scope;
  const key = `profit-analysis-pending:v1:${JSON.stringify([identity.userId, identity.workspaceId, scope.storeName, scope.country, scope.parentAsin, scope.currency, scope.basis, request.month])}`;
  return { identity, request, key };
}
function checkedPending(value: unknown, expected?: ReturnType<typeof context>): ProfitAnalysisPending {
  const pending = parse(pendingSchema, value);
  if (pending.identity.workspaceId !== pending.request.expectedWorkspaceId) fail("SCOPE_MISMATCH");
  if (expected) {
    const request = { expectedWorkspaceId: pending.request.expectedWorkspaceId, scope: pending.request.scope, month: pending.request.month };
    if (canonical(pending.identity) !== canonical(expected.identity) || canonical(request) !== canonical(expected.request)) fail("SCOPE_MISMATCH");
  }
  return pending;
}
function browser() {
  if (typeof window === "undefined") fail("BROWSER_UNAVAILABLE");
  return window;
}
function storage() {
  const current = browser();
  try {
    const value = current.localStorage;
    if (!value || typeof value.getItem !== "function" || typeof value.setItem !== "function" || typeof value.removeItem !== "function") fail("STORAGE_UNAVAILABLE");
    return value;
  } catch { return fail("STORAGE_UNAVAILABLE"); }
}
function lockManager() {
  const current = browser();
  try { const value = current.navigator.locks; if (!value || typeof value.request !== "function") fail("LOCK_UNAVAILABLE"); return value; }
  catch { return fail("LOCK_UNAVAILABLE"); }
}
function stored(store: Storage, key: string): string | null {
  try { const value = store.getItem(key); if (value !== null && typeof value !== "string") fail("STORAGE_UNVERIFIED"); return value; }
  catch (error) { if (error instanceof ProfitAnalysisPendingError) throw error; return fail("STORAGE_UNAVAILABLE"); }
}
function decode(raw: string, expected: ReturnType<typeof context>): ProfitAnalysisPending {
  if (raw.length > PROFIT_ANALYSIS_PENDING_MAX_BYTES || bytes(raw) > PROFIT_ANALYSIS_PENDING_MAX_BYTES) fail("INVALID");
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return fail("INVALID"); }
  const pending = checkedPending(parsed, expected);
  // Only this version's exact serialized metadata is recoverable. This also
  // rejects duplicate JSON keys hiding an overwritten body or identity value.
  if (raw !== canonical(pending)) fail("INVALID");
  return pending;
}
export function pendingOperationId(value: ProfitAnalysisPending): string {
  const pending = checkedPending(value); return pending.kind === "generate" ? pending.request.operationId : pending.request.saveOperationId;
}
export function profitAnalysisPendingKey(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput): string { return context(owner, input).key; }
export function readProfitAnalysisPending(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput): ProfitAnalysisPending | null {
  const expected = context(owner, input), raw = stored(storage(), expected.key); return raw === null ? null : decode(raw, expected);
}
export async function withProfitAnalysisPendingLock<T>(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const expected = context(owner, input); storage(); const locks = lockManager();
  if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof work !== "function") fail("INVALID");
  if (signal.aborted) fail("ABORTED");
  return locks.request(expected.key, { mode: "exclusive", signal }, async () => { if (signal.aborted) fail("ABORTED"); return await work(); });
}
export function reserveProfitAnalysisPending(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput, value: ProfitAnalysisPending): void {
  const expected = context(owner, input), accepted = checkedPending(value, expected), encoded = canonical(accepted), operationId = pendingOperationId(accepted);
  lockManager(); const store = storage(), previous = stored(store, expected.key);
  if (previous !== null) {
    const current = decode(previous, expected);
    if (pendingOperationId(current) !== operationId) fail("PENDING_CONFLICT");
    if (previous !== encoded) fail("CONTENT_CONFLICT");
    return;
  }
  try {
    store.setItem(expected.key, encoded);
    if (stored(store, expected.key) !== encoded) fail("STORAGE_UNVERIFIED");
  } catch (error) { if (error instanceof ProfitAnalysisPendingError) throw error; fail("STORAGE_UNAVAILABLE"); }
  finally { notify(expected.key); }
}
export function releaseProfitAnalysisPending(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput, expectedId: string): boolean {
  const expected = context(owner, input); if (!uuidSchema.safeParse(expectedId).success) fail("INVALID");
  lockManager(); const store = storage(), previous = stored(store, expected.key);
  if (previous === null) return false;
  const current = decode(previous, expected); if (pendingOperationId(current) !== expectedId) return false;
  try {
    store.removeItem(expected.key); if (stored(store, expected.key) !== null) fail("STORAGE_UNVERIFIED"); return true;
  } catch (error) { if (error instanceof ProfitAnalysisPendingError) throw error; return fail("STORAGE_UNAVAILABLE"); }
  finally { notify(expected.key); }
}
export function subscribeProfitAnalysisPending(owner: ProfitAnalysisPendingOwner, input: ProfitAnalysisPreviewInput, listener: () => void): () => void {
  const expected = context(owner, input), current = browser(), store = storage(); if (typeof listener !== "function") fail("INVALID");
  const subscription = () => listener(), group = listeners.get(expected.key) ?? new Set<() => void>(); group.add(subscription); listeners.set(expected.key, group);
  const onStorage = (event: StorageEvent) => {
    if ((event.key === expected.key || event.key === null) && (event.storageArea === null || event.storageArea === store)) {
      try { subscription(); } catch { /* invalidation still reached this subscriber */ }
    }
  };
  current.addEventListener("storage", onStorage);
  let active = true;
  return () => { if (!active) return; active = false; current.removeEventListener("storage", onStorage); group.delete(subscription); if (!group.size && listeners.get(expected.key) === group) listeners.delete(expected.key); };
}
