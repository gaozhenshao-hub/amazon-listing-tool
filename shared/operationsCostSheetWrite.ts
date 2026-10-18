import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import {
  OperationsCostSheetPayloadSchema, OperationsCostSheetReadInputSchema, OperationsCostSheetReadResultSchema,
  OperationsCostSheetScopeSchema, parseOperationsCostSheetPayload, type OperationsCostSheetPayload, type OperationsCostSheetReadResult,
  type OperationsCostSheetRowInput, type OperationsCostSheetScope,
} from "./operationsCostSheetRead";

const id = z.number().int().positive().max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const OperationsCostSheetWriteIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type OperationsCostSheetWriteIdentity = z.infer<typeof OperationsCostSheetWriteIdentitySchema>;
export const OperationsCostSheetWriteOptionsInputSchema = OperationsCostSheetReadInputSchema;
export type OperationsCostSheetWriteOptionsInput = z.infer<typeof OperationsCostSheetWriteOptionsInputSchema>;
export const OperationsCostSheetWriteSaveInputSchema = OperationsCostSheetReadInputSchema.extend({
  operationId: uuid, expectedVersion: z.number().int().min(0).max(2147483646),
  expectedSnapshotKey: hash, payload: OperationsCostSheetPayloadSchema,
}).strict();
export type OperationsCostSheetWriteSaveInput = z.infer<typeof OperationsCostSheetWriteSaveInputSchema>;
export const OperationsCostSheetWriteRecoverInputSchema = OperationsCostSheetReadInputSchema.extend({ operationId: uuid, decision: z.enum(["check", "cancel"]) }).strict();
export type OperationsCostSheetWriteRecoverInput = z.infer<typeof OperationsCostSheetWriteRecoverInputSchema>;
export const OperationsCostSheetWriteCapabilitySchema = z.object({ status: z.enum(["available", "unavailable"]), reasonCode: z.string().min(1).max(200).nullable() }).strict().refine(value => (value.status === "available") === (value.reasonCode === null), "Capability reason mismatch");
export type OperationsCostSheetWriteCapability = z.infer<typeof OperationsCostSheetWriteCapabilitySchema>;

export class OperationsCostSheetWriteError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "OperationsCostSheetWriteError"; }
}
const fail = (code: string): never => { throw new OperationsCostSheetWriteError(code); };
const sameScope = (a: OperationsCostSheetScope, b: OperationsCostSheetScope) => a.workspaceId === b.workspaceId && a.parentAsin === b.parentAsin && a.storeName === b.storeName && a.country === b.country;
export function operationsCostSheetWriteScope(input: OperationsCostSheetWriteOptionsInput): OperationsCostSheetScope {
  const value = OperationsCostSheetReadInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, parentAsin: input.parentAsin, storeName: input.storeName, country: input.country });
  return { workspaceId: value.expectedWorkspaceId, parentAsin: value.parentAsin, storeName: value.storeName, country: value.country };
}
export function canSnapshotOperationsCostSheet(result: OperationsCostSheetReadResult): boolean {
  return (result.status === "saved" || result.status === "not_saved") && result.sourceStatus === "available";
}
export const OperationsCostSheetWriteOptionsResultSchema = z.object({
  identity: OperationsCostSheetWriteIdentitySchema, scope: OperationsCostSheetScopeSchema,
  readResult: OperationsCostSheetReadResultSchema, snapshotKey: hash.nullable(),
  capabilities: z.object({ save: OperationsCostSheetWriteCapabilitySchema }).strict(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.identity.userId !== value.readResult.identity.userId || value.identity.workspaceId !== value.scope.workspaceId || value.identity.workspaceId !== value.readResult.identity.workspaceId || !sameScope(value.scope, value.readResult.scope)) issue("Cost options identity mismatch");
  if (canSnapshotOperationsCostSheet(value.readResult) !== (value.snapshotKey !== null)) issue("Cost options snapshot mismatch");
  if (value.capabilities.save.status === "available" && (value.snapshotKey === null || (value.readResult.saved?.version ?? 0) >= 2147483647 || !value.readResult.sourceRecordCount || !value.readResult.rows.some(row => row.fact !== null))) issue("Unavailable cost state cannot be writable");
});
export type OperationsCostSheetWriteOptionsResult = z.infer<typeof OperationsCostSheetWriteOptionsResultSchema>;
export const OperationsCostSheetWriteResultSchema = z.object({
  identity: OperationsCostSheetWriteIdentitySchema, scope: OperationsCostSheetScopeSchema, operationId: uuid,
  status: z.enum(["committed", "cancelled", "unknown"]), version: id.nullable(), snapshotKey: hash.nullable(),
  reasonCode: z.string().min(1).max(200).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.workspaceId || (value.status === "committed" ? value.version === null || value.snapshotKey === null || value.reasonCode !== null : value.version !== null || value.snapshotKey !== null || value.reasonCode === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cost receipt state or identity mismatch" });
});
export type OperationsCostSheetWriteResult = z.infer<typeof OperationsCostSheetWriteResultSchema>;

/** Plain, bounded JSON projection; dates must be explicit source strings. No getters,
 * coercion, omitted undefined fields, prototype behavior, or invalid UTF-8. */
export function operationsCostSheetWriteCanonical(value: unknown): string {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): string => {
    // A lawful 500-source / 5000-observation read repeats full lineage. Keep
    // this internal traversal budget distinct from the unchanged payload caps.
    if (++nodes > 1000000 || depth > 24) return fail("COST_WRITE_PROJECTION_LIMIT");
    if (item === null) return "null";
    if (typeof item === "string") {
      if (item.length > 12 * 1024 * 1024 || new TextDecoder().decode(new TextEncoder().encode(item)) !== item) return fail("COST_WRITE_JSON_INVALID");
      return JSON.stringify(item);
    }
    if (typeof item === "number") { if (!Number.isFinite(item)) return fail("COST_WRITE_JSON_INVALID"); return JSON.stringify(item); }
    if (typeof item === "boolean") return String(item);
    if (typeof item !== "object" || seen.has(item)) return fail("COST_WRITE_JSON_INVALID");
    if (item instanceof Date) return fail("COST_WRITE_JSON_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== "string") || Object.values(descriptors).some(descriptor => !("value" in descriptor))) return fail("COST_WRITE_JSON_INVALID");
    seen.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (item.length > 200000 || keys.length !== item.length + 1 || !keys.includes("length") || Array.from({ length: item.length }, (_, index) => String(index)).some(key => !Object.hasOwn(item, key))) return fail("COST_WRITE_JSON_INVALID");
      result = `[${item.map(entry => visit(entry, depth + 1)).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null || Object.values(descriptors).some(descriptor => !descriptor.enumerable)) return fail("COST_WRITE_JSON_INVALID");
      result = `{${(keys as string[]).sort().map(key => `${visit(key, depth + 1)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
    }
    seen.delete(item);
    if (new TextEncoder().encode(result).byteLength > 12 * 1024 * 1024) return fail("COST_WRITE_PROJECTION_LIMIT");
    return result;
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(result).byteLength > 12 * 1024 * 1024) return fail("COST_WRITE_PROJECTION_LIMIT");
  return result;
}
export const operationsCostSheetWriteHash = (value: unknown): string => SHA256(operationsCostSheetWriteCanonical(value)).toString();
/** Caller supplies its complete validated source/saved projections, not a
 * truncated table page. These are hashed, never exposed in the receipt. */
export function operationsCostSheetSnapshotKey(projection: { readResult: OperationsCostSheetReadResult; sources: unknown; storage: unknown }): string {
  // Inspect the original projection first: schema parsers must not invoke a
  // getter/toJSON or silently omit undefined before the hash boundary.
  operationsCostSheetWriteCanonical(projection);
  const result = OperationsCostSheetReadResultSchema.parse(projection.readResult);
  if (!canSnapshotOperationsCostSheet(result)) return fail("COST_WRITE_SOURCE_UNAVAILABLE");
  let storage = projection.storage;
  // MySQL JSON can arrive as a textual object. Its whitespace/property order
  // is transport formatting, not a changed saved input or version.
  if (storage && typeof storage === "object" && !Array.isArray(storage)) {
    const value = storage as Record<string, unknown>, record = value.record;
    if (value.status === "saved" && record && typeof record === "object" && !Array.isArray(record)) {
      const saved = record as Record<string, unknown>;
      storage = { ...value, record: { ...saved, payload: parseOperationsCostSheetPayload(saved.payload) } };
    }
  }
  return operationsCostSheetWriteHash({ protocol: "cost-sheet-write-v1", ...projection, storage, readResult: { ...result, saved: result.saved ? { ...result.saved, updatedAt: new Date(result.saved.updatedAt).toISOString() } : null } });
}
export const operationsCostSheetOperationRequestHash = (input: OperationsCostSheetWriteSaveInput): string => operationsCostSheetWriteHash(OperationsCostSheetWriteSaveInputSchema.parse(input));

/** A new draft contains no fabricated saved rows or costs. The freight rate is
 * an explicit editable calculation setting, not imported financial evidence. */
export function initializeOperationsCostSheetDraft(raw: OperationsCostSheetReadResult): OperationsCostSheetPayload {
  const result = OperationsCostSheetReadResultSchema.parse(raw);
  if (!canSnapshotOperationsCostSheet(result)) return fail("COST_WRITE_SOURCE_UNAVAILABLE");
  return result.saved ? OperationsCostSheetPayloadSchema.parse(result.saved.payload) : { settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [] };
}
export function createOperationsCostSheetDraftRow(key: string): OperationsCostSheetRowInput {
  return OperationsCostSheetPayloadSchema.parse({ settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [{ key, productCost: null, packagingCost: null, actualFreight: null, actualFba: null, weightKg: null, lengthCm: null, widthCm: null, heightCm: null }] }).rows[0];
}
/** Validate against one freshly authorized, complete read under the save
 * transaction. Neither a client DTO nor its snapshot key grants authority. */
export function validateOperationsCostSheetWriteAgainstReadResult(raw: OperationsCostSheetWriteSaveInput, currentRaw: OperationsCostSheetReadResult, currentSnapshotKey: string): OperationsCostSheetWriteSaveInput {
  const input = OperationsCostSheetWriteSaveInputSchema.parse(raw), current = OperationsCostSheetReadResultSchema.parse(currentRaw);
  if (!sameScope(operationsCostSheetWriteScope({ expectedWorkspaceId: input.expectedWorkspaceId, parentAsin: input.parentAsin, storeName: input.storeName, country: input.country }), current.scope)) return fail("COST_WRITE_SCOPE_MISMATCH");
  if (!canSnapshotOperationsCostSheet(current)) return fail("COST_WRITE_SOURCE_UNAVAILABLE");
  if (!current.sourceRecordCount || !current.rows.some(row => row.fact !== null)) return fail("COST_WRITE_NO_CURRENT_FACTS");
  if (input.expectedVersion !== (current.saved?.version ?? 0) || input.expectedVersion === 0 && current.status !== "not_saved") return fail("COST_WRITE_VERSION_CONFLICT");
  if (input.expectedSnapshotKey !== hash.parse(currentSnapshotKey)) return fail("COST_WRITE_SNAPSHOT_CONFLICT");
  const submitted = new Map(input.payload.rows.map(row => [row.key, row])), saved = new Map(current.saved?.payload.rows.map(row => [row.key, row]) ?? []);
  const facts = new Set(current.rows.filter(row => row.fact !== null).map(row => row.key));
  for (const [key, original] of saved) {
    if (!submitted.has(key)) return fail("COST_WRITE_SAVED_ROW_REMOVED");
    if (!facts.has(key) && operationsCostSheetWriteCanonical(submitted.get(key)) !== operationsCostSheetWriteCanonical(original)) return fail("COST_WRITE_ORPHAN_CHANGED");
  }
  for (const key of submitted.keys()) if (!saved.has(key) && !facts.has(key)) return fail("COST_WRITE_UNKNOWN_ROW");
  return input;
}
