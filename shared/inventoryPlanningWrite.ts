import { z } from "zod";
import SHA256 from "crypto-js/sha256";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

export const INVENTORY_PLANNING_WRITE_VERSION = "inventory-planning-write-v1";
export const INVENTORY_PLANNING_LIMITS = { parameters: 5000, locals: 10000, sources: 10000, snapshotBytes: 16 * 1024 * 1024, responseBytes: 8 * 1024 * 1024 } as const;
const id = z.number().int().positive().max(2147483647), integer = z.number().int().min(0).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().transform(value => value.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) && new TextDecoder().decode(new TextEncoder().encode(value)) === value);
const asin = text(20).regex(/^[A-Z0-9]+$/u), store = text(200);
// Stored business identity is exact original source text, not a rewritten alias.
const country = text(50);
export const InventoryPlanningDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return value >= "1000-01-01" && value <= "9999-12-31" && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const timestamp = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.[0-9]{1,6})?$/u).refine(value => {
  const base = value.slice(0, 19).replace(" ", "T"), date = new Date(`${base}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === base;
})]);
const marketplace = z.union([z.literal("ALL"), text(50).regex(/^[A-Z]{2}$/u).refine(value => normalizeMarketplaceCode(value) === value)]);
const decimal = (scale: number, max: number) => z.number().finite().min(0).max(max).refine(value => Number(value.toFixed(scale)) === value, `At most ${scale} decimal places; no rounding`);
const amount = decimal(2, 99999999.99).nullable(), weight = decimal(3, 9999999.999).nullable();
const dimensions = text(120).nullable();
export const InventoryPlanningIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type InventoryPlanningIdentity = z.infer<typeof InventoryPlanningIdentitySchema>;
export const InventoryPlanningScopeSchema = z.discriminatedUnion("scopeType", [
  z.object({ scopeType: z.literal("workspace") }).strict(),
  z.object({ scopeType: z.literal("store_country"), storeName: store, country }).strict(),
  z.object({ scopeType: z.literal("parent_asin"), parentAsin: asin, storeName: store, country }).strict(),
  z.object({ scopeType: z.literal("asin"), asin, storeName: store, country, parentAsin: asin.nullable().optional() }).strict(),
]);
export type InventoryPlanningScope = z.infer<typeof InventoryPlanningScopeSchema>;
export function canonicalInventoryPlanningScope(raw: InventoryPlanningScope): InventoryPlanningScope {
  const value = InventoryPlanningScopeSchema.parse(raw);
  if (value.scopeType === "asin") return { scopeType: "asin", asin: value.asin, storeName: value.storeName, country: value.country };
  return value;
}
export const InventoryPlanningValuesSchema = z.object({
  productionDays: integer.max(365), shippingDays: integer.max(365), bufferDays: integer.max(365), targetCoverDays: integer.min(1).max(365), moq: integer, packSize: integer.min(1),
  productCost: amount, estimatedFirstLegCost: amount, actualFirstLegCost: amount, estimatedFbaFee: amount, actualFbaFee: amount, sellingPrice: amount,
  estimatedDimensions: dimensions, actualDimensions: dimensions, estimatedWeight: weight, actualWeight: weight,
  dimensionUnit: z.enum(["in", "cm"]), weightUnit: z.enum(["lb", "kg"]), currency: z.literal("USD"),
}).strict();
export type InventoryPlanningValues = z.infer<typeof InventoryPlanningValuesSchema>;
export const INVENTORY_PLANNING_DEFAULTS: Readonly<InventoryPlanningValues> = Object.freeze({ productionDays: 30, shippingDays: 30, bufferDays: 10, targetCoverDays: 30, moq: 0, packSize: 1, productCost: null, estimatedFirstLegCost: null, actualFirstLegCost: null, estimatedFbaFee: null, actualFbaFee: null, sellingPrice: null, estimatedDimensions: null, actualDimensions: null, estimatedWeight: null, actualWeight: null, dimensionUnit: "in", weightUnit: "lb", currency: "USD" });
export const InventoryPlanningPatchSchema = InventoryPlanningValuesSchema.partial().refine(value => Object.keys(value).length > 0 && Object.values(value).every(item => item !== undefined), "A nonempty explicit patch is required");
export type InventoryPlanningPatch = z.infer<typeof InventoryPlanningPatchSchema>;
export const InventoryPlanningParameterRowSchema = InventoryPlanningValuesSchema.extend({
  id, workspaceId: id, userId: id, scopeType: z.enum(["workspace", "store_country", "parent_asin", "asin"]), asin: asin.nullable(), parentAsin: asin.nullable(), storeName: store.nullable(), country: country.nullable(), isActive: z.union([z.literal(0), z.literal(1)]), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  const valid = value.scopeType === "workspace" ? value.asin === null && value.parentAsin === null && value.storeName === null && value.country === null
    : value.scopeType === "store_country" ? value.asin === null && value.parentAsin === null && value.storeName !== null && value.country !== null
      : value.scopeType === "parent_asin" ? value.asin === null && value.parentAsin !== null && value.storeName !== null && value.country !== null
        : value.asin !== null && value.storeName !== null && value.country !== null;
  if (!valid) ctx.addIssue({ code: "custom", message: "Malformed stored parameter scope" });
});
export type InventoryPlanningParameterRow = z.infer<typeof InventoryPlanningParameterRowSchema>;
export const InventoryPlanningLocalRowSchema = z.object({ id, workspaceId: id, userId: id, asin, storeName: store, country,
  effectiveDate: InventoryPlanningDateSchema, localQty: integer, reason: z.string().max(500).nullable(), status: z.enum(["draft", "confirmed", "superseded"]),
  confirmedBy: id.nullable(), confirmedAt: timestamp.nullable(), supersededById: id.nullable(), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.status !== "draft" && (value.confirmedBy === null || value.confirmedAt === null) || (value.status === "superseded") !== (value.supersededById !== null)) ctx.addIssue({ code: "custom", message: "Invalid local confirmation lineage" });
});
export type InventoryPlanningLocalRow = z.infer<typeof InventoryPlanningLocalRowSchema>;
export const InventoryPlanningReadInputSchema = z.object({ expectedWorkspaceId: id, scope: InventoryPlanningScopeSchema, asOfDate: InventoryPlanningDateSchema, marketplace }).strict();
export type InventoryPlanningReadInput = z.infer<typeof InventoryPlanningReadInputSchema>;
const commandBase = { ...InventoryPlanningReadInputSchema.shape, operationId: uuid, expectedSnapshotKey: hash };
export const InventoryPlanningExecuteInputSchema = z.discriminatedUnion("action", [
  z.object({ ...commandBase, action: z.literal("confirmLocal"), localQty: integer, effectiveDate: InventoryPlanningDateSchema, reason: z.string().max(500).nullable() }).strict().refine(value => value.scope.scopeType === "asin", "Local inventory requires a child ASIN scope"),
  z.object({ ...commandBase, action: z.literal("saveParameters"), patch: InventoryPlanningPatchSchema }).strict(),
]);
export type InventoryPlanningExecuteInput = z.infer<typeof InventoryPlanningExecuteInputSchema>;
export const InventoryPlanningRecoverInputSchema = InventoryPlanningReadInputSchema.extend({ operationId: uuid, decision: z.enum(["check", "cancel"]) }).strict();
export type InventoryPlanningRecoverInput = z.infer<typeof InventoryPlanningRecoverInputSchema>;
export const InventoryPlanningCapabilitySchema = z.object({ status: z.enum(["available", "unavailable"]), reasonCode: text(200).nullable() }).strict().refine(value => (value.status === "available") === (value.reasonCode === null));
export type InventoryPlanningCapability = z.infer<typeof InventoryPlanningCapabilitySchema>;
export class InventoryPlanningWriteError extends Error { constructor(public readonly code: string) { super(code); this.name = "InventoryPlanningWriteError"; } }
const fail = (code: string): never => { throw new InventoryPlanningWriteError(code); };

/** Snapshot hashes bind complete projections; dates must be explicit strings.
 * No getters, toJSON, nonfinite values, omission, truncation or key-order drift. */
export function inventoryPlanningWriteCanonical(value: unknown): string {
  const seen = new Set<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): string {
    if (++nodes > 4000000 || depth > 24) return fail("PLANNING_PROJECTION_LIMIT");
    if (item === null) return "null";
    if (typeof item === "string") { if (new TextDecoder().decode(new TextEncoder().encode(item)) !== item) return fail("PLANNING_JSON_INVALID"); return JSON.stringify(item); }
    if (typeof item === "number") { if (!Number.isFinite(item)) return fail("PLANNING_JSON_INVALID"); return JSON.stringify(item); }
    if (typeof item === "boolean") return String(item);
    if (typeof item !== "object" || seen.has(item) || item instanceof Date) return fail("PLANNING_JSON_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== "string") || Object.values(descriptors).some(descriptor => !("value" in descriptor))) return fail("PLANNING_JSON_INVALID");
    seen.add(item); let result: string;
    if (Array.isArray(item)) {
      if (item.length > 100000 || keys.length !== item.length + 1 || Array.from({ length: item.length }, (_, index) => String(index)).some(key => !Object.hasOwn(item, key))) return fail("PLANNING_JSON_INVALID");
      result = `[${item.map(entry => visit(entry, depth + 1)).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null || Object.values(descriptors).some(descriptor => !descriptor.enumerable)) return fail("PLANNING_JSON_INVALID");
      result = `{${(keys as string[]).sort().map(key => `${visit(key, depth + 1)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
    }
    seen.delete(item);
    if (new TextEncoder().encode(result).byteLength > INVENTORY_PLANNING_LIMITS.snapshotBytes) return fail("PLANNING_PROJECTION_LIMIT");
    return result;
  }
  const result = visit(value, 0);
  if (new TextEncoder().encode(result).byteLength > INVENTORY_PLANNING_LIMITS.snapshotBytes) return fail("PLANNING_PROJECTION_LIMIT");
  return result;
}
export const inventoryPlanningWriteHash = (value: unknown) => SHA256(inventoryPlanningWriteCanonical(value)).toString();
export const inventoryPlanningScopeKey = (scope: InventoryPlanningScope) => inventoryPlanningWriteCanonical(canonicalInventoryPlanningScope(scope));
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().trim();
const aliasScopeKey = (scope: InventoryPlanningScope) => {
  const value = canonicalInventoryPlanningScope(scope);
  return fold(inventoryPlanningWriteCanonical(value.scopeType === "workspace" ? value : { ...value, country: normalizeMarketplaceCode(value.country) }));
};
function rowScope(value: InventoryPlanningParameterRow): InventoryPlanningScope {
  if (value.scopeType === "workspace") return { scopeType: "workspace" };
  if (value.scopeType === "store_country") return { scopeType: value.scopeType, storeName: value.storeName!, country: value.country! };
  if (value.scopeType === "parent_asin") return { scopeType: value.scopeType, parentAsin: value.parentAsin!, storeName: value.storeName!, country: value.country! };
  return { scopeType: value.scopeType, asin: value.asin!, storeName: value.storeName!, country: value.country! };
}
function databaseRows(raw: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length > max) return fail("PLANNING_RECORD_LIMIT");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1 || Array.from({ length: raw.length }, (_, index) => String(index)).some(key => !descriptors[key] || !("value" in descriptors[key]))) return fail("PLANNING_RECORD_INVALID");
  return raw.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null) return fail("PLANNING_RECORD_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(row);
    if (Reflect.ownKeys(row).some(key => typeof key !== "string") || Object.values(descriptors).some(value => !("value" in value) || !value.enumerable)) return fail("PLANNING_RECORD_INVALID");
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const value = descriptor.value;
      if (value instanceof Date && ["createdAt", "updatedAt", "confirmedAt"].includes(key)) {
        if (!Number.isFinite(Date.prototype.getTime.call(value))) return fail("PLANNING_RECORD_INVALID");
        result[key] = Date.prototype.toISOString.call(value);
      } else result[key] = value;
    }
    inventoryPlanningWriteCanonical(result); return result;
  });
}
function assertOwned(rows: { id: number; userId: number; workspaceId: number }[], identity: InventoryPlanningIdentity) {
  InventoryPlanningIdentitySchema.parse(identity);
  if (rows.some(row => row.userId !== identity.userId || row.workspaceId !== identity.workspaceId)) return fail("PLANNING_IDENTITY_MISMATCH");
  if (new Set(rows.map(row => row.id)).size !== rows.length) return fail("PLANNING_DUPLICATE_ID");
}
export function parseInventoryPlanningParameterRows(raw: unknown, identity: InventoryPlanningIdentity): InventoryPlanningParameterRow[] {
  const fields = ["productCost", "estimatedFirstLegCost", "actualFirstLegCost", "estimatedFbaFee", "actualFbaFee", "sellingPrice", "estimatedWeight", "actualWeight"];
  const rows = databaseRows(raw, INVENTORY_PLANNING_LIMITS.parameters).map(row => {
    for (const key of fields) if (typeof row[key] === "string") {
      const scale = key.endsWith("Weight") ? 3 : 2;
      if (!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${scale}})?$`, "u").test(row[key] as string)) return fail("PLANNING_DECIMAL_INVALID");
      row[key] = Number(row[key]);
    }
    return InventoryPlanningParameterRowSchema.parse(row);
  });
  assertOwned(rows, identity);
  const keys = new Set<string>(), aliases = new Set<string>();
  for (const row of rows) {
    const key = inventoryPlanningScopeKey(rowScope(row)), alias = aliasScopeKey(rowScope(row));
    if (keys.has(key) || aliases.has(alias)) return fail("PLANNING_PARAMETER_CONFLICT");
    keys.add(key); aliases.add(alias);
  }
  return rows;
}
export function parseInventoryPlanningLocalRows(raw: unknown, identity: InventoryPlanningIdentity): InventoryPlanningLocalRow[] {
  const rows = databaseRows(raw, INVENTORY_PLANNING_LIMITS.locals).map(row => InventoryPlanningLocalRowSchema.parse(row)); assertOwned(rows, identity);
  const identities = new Map<string, string>(), byId = new Map(rows.map(row => [row.id, row]));
  for (const row of rows) {
    const scope: InventoryPlanningScope = { scopeType: "asin", asin: row.asin, storeName: row.storeName, country: row.country }, key = inventoryPlanningScopeKey(scope), alias = aliasScopeKey(scope);
    if (identities.has(alias) && identities.get(alias) !== key) return fail("PLANNING_LOCAL_ALIAS_CONFLICT");
    identities.set(alias, key);
    if (row.supersededById !== null) {
      const next = byId.get(row.supersededById);
      if (!next || next.id <= row.id || next.status === "draft" || next.asin !== row.asin || next.storeName !== row.storeName || next.country !== row.country || next.effectiveDate !== row.effectiveDate) return fail("PLANNING_LOCAL_LINEAGE_INVALID");
    }
  }
  return rows;
}
const parameterStateSchema = z.object({ current: InventoryPlanningParameterRowSchema.nullable(), effective: InventoryPlanningValuesSchema, resolvedFrom: z.enum(["asin", "parent_asin", "store_country", "workspace", "system_defaults"]) }).strict();
const localStateSchema = z.object({ current: InventoryPlanningLocalRowSchema.nullable(), history: z.array(InventoryPlanningLocalRowSchema).max(INVENTORY_PLANNING_LIMITS.locals) }).strict();
/** Validate once and index once when replaying an entire planning table. */
export function createInventoryPlanningStateResolver(input: { identity: InventoryPlanningIdentity; parameters: unknown; locals: unknown }) {
  const parameters = parseInventoryPlanningParameterRows(input.parameters, input.identity), locals = parseInventoryPlanningLocalRows(input.locals, input.identity);
  inventoryPlanningWriteCanonical({ parameters, locals });
  const parameterByKey = new Map(parameters.map(row => [inventoryPlanningScopeKey(rowScope(row)), row]));
  const parameterByAlias = new Map(parameters.map(row => [aliasScopeKey(rowScope(row)), inventoryPlanningScopeKey(rowScope(row))]));
  const localByKey = new Map<string, InventoryPlanningLocalRow[]>(), localByAlias = new Map<string, string>();
  for (const row of locals) { const scope: InventoryPlanningScope = { scopeType: "asin", asin: row.asin, storeName: row.storeName, country: row.country }, key = inventoryPlanningScopeKey(scope); const rows = localByKey.get(key) ?? []; rows.push(row); localByKey.set(key, rows); localByAlias.set(aliasScopeKey(scope), key); }
  for (const rows of localByKey.values()) rows.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id);
  const lookup = (target: InventoryPlanningScope) => {
    const key = inventoryPlanningScopeKey(target), alias = parameterByAlias.get(aliasScopeKey(target));
    if (alias !== undefined && alias !== key) return fail("PLANNING_PARAMETER_ALIAS_CONFLICT");
    const row = parameterByKey.get(key); return row?.isActive === 1 ? row : null;
  };
  return (rawScope: InventoryPlanningScope, rawDate: string) => {
  const scope = canonicalInventoryPlanningScope(rawScope), asOfDate = InventoryPlanningDateSchema.parse(rawDate);
  const current = lookup(scope);
  let resolved = current;
  if (!resolved && scope.scopeType !== "workspace" && scope.scopeType !== "store_country") resolved = lookup({ scopeType: "store_country", storeName: scope.storeName, country: scope.country });
  if (!resolved && scope.scopeType !== "workspace") resolved = lookup({ scopeType: "workspace" });
  const effective = resolved ? InventoryPlanningValuesSchema.parse(Object.fromEntries(Object.keys(INVENTORY_PLANNING_DEFAULTS).map(key => [key, resolved[key as keyof InventoryPlanningValues]]))) : { ...INVENTORY_PLANNING_DEFAULTS };
  const expected = inventoryPlanningScopeKey(scope), alias = localByAlias.get(aliasScopeKey(scope));
  if (alias !== undefined && alias !== expected) return fail("PLANNING_LOCAL_ALIAS_CONFLICT");
  const history = scope.scopeType === "asin" ? localByKey.get(expected) ?? [] : [];
  return { parameters: { current, effective, resolvedFrom: resolved?.scopeType ?? "system_defaults" as const }, local: { current: history.find(row => row.status === "confirmed" && row.effectiveDate <= asOfDate) ?? null, history } };
  };
}
export function resolveInventoryPlanningState(input: { identity: InventoryPlanningIdentity; scope: InventoryPlanningScope; asOfDate: string; parameters: unknown; locals: unknown }) {
  return createInventoryPlanningStateResolver(input)(input.scope, input.asOfDate);
}
export function applyInventoryPlanningPatch(base: InventoryPlanningValues, raw: InventoryPlanningPatch): InventoryPlanningValues {
  return InventoryPlanningValuesSchema.parse({ ...InventoryPlanningValuesSchema.parse(base), ...InventoryPlanningPatchSchema.parse(raw) });
}
export const InventoryPlanningReadResultSchema = z.object({
  identity: InventoryPlanningIdentitySchema, scope: InventoryPlanningScopeSchema, asOfDate: InventoryPlanningDateSchema, marketplace,
  status: z.enum(["ready", "unavailable", "conflict"]), reasonCode: text(200).nullable(), snapshotKey: hash.nullable(),
  source: z.object({ status: z.enum(["available", "unavailable", "missing"]), recordCount: integer, asOfDate: InventoryPlanningDateSchema.nullable() }).strict(),
  parameters: parameterStateSchema.nullable(), local: localStateSchema.nullable(),
  capabilities: z.object({ confirmLocal: InventoryPlanningCapabilitySchema, saveParameters: InventoryPlanningCapabilitySchema }).strict(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status === "ready" ? value.parameters === null || value.local === null || value.snapshotKey === null || value.reasonCode !== null || value.source.status !== "available" || value.source.asOfDate !== value.asOfDate : value.parameters !== null || value.local !== null || value.snapshotKey !== null || value.reasonCode === null) issue("Invalid planning read state");
  if ((value.capabilities.confirmLocal.status === "available" || value.capabilities.saveParameters.status === "available") && (value.status !== "ready" || value.source.recordCount === 0)) issue("Unavailable source is not writable");
  if (value.scope.scopeType !== "asin" && (value.capabilities.confirmLocal.status === "available" || value.local?.current !== null && value.local !== null || (value.local?.history.length ?? 0) > 0)) issue("Non-child scope cannot confirm local inventory");
  if (value.parameters?.current && (value.parameters.current.userId !== value.identity.userId || value.parameters.current.workspaceId !== value.identity.workspaceId || inventoryPlanningScopeKey(rowScope(value.parameters.current)) !== inventoryPlanningScopeKey(value.scope) || value.parameters.current.isActive !== 1)) issue("Parameter identity mismatch");
  if (value.parameters?.current) {
    const current = value.parameters.current;
    if (value.parameters.resolvedFrom !== current.scopeType || Object.keys(INVENTORY_PLANNING_DEFAULTS).some(key => value.parameters!.effective[key as keyof InventoryPlanningValues] !== current[key as keyof InventoryPlanningValues])) issue("Current parameters cannot differ from effective values");
  }
  if (value.parameters?.resolvedFrom === "system_defaults" && inventoryPlanningWriteCanonical(value.parameters.effective) !== inventoryPlanningWriteCanonical(INVENTORY_PLANNING_DEFAULTS)) issue("Fabricated default values");
  if (value.scope.scopeType === "asin" && value.parameters?.resolvedFrom === "parent_asin") issue("Parent parameters must not be inherited");
  if (value.local) {
    try { const rows = parseInventoryPlanningLocalRows(value.local.history, value.identity); const expected = rows.filter(row => row.status === "confirmed" && row.effectiveDate <= value.asOfDate).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id)[0] ?? null;
      if (inventoryPlanningWriteCanonical(expected) !== inventoryPlanningWriteCanonical(value.local.current)) issue("Local selection mismatch");
      if (rows.some(row => inventoryPlanningScopeKey({ scopeType: "asin", asin: row.asin, storeName: row.storeName, country: row.country }) !== inventoryPlanningScopeKey(value.scope))) issue("Local scope mismatch");
    } catch { issue("Invalid local history"); }
  }
  try { if (new TextEncoder().encode(inventoryPlanningWriteCanonical(value)).byteLength > INVENTORY_PLANNING_LIMITS.responseBytes) issue("Planning response exceeds budget"); } catch { issue("Invalid planning response JSON"); }
});
export type InventoryPlanningReadResult = z.infer<typeof InventoryPlanningReadResultSchema>;
/** Backend must provide complete authorized sources and all relevant full rows,
 * not table pages. The digest does not grant source or member authorization. */
export function inventoryPlanningSnapshotKey(projection: { identity: InventoryPlanningIdentity; scope: InventoryPlanningScope; asOfDate: string; marketplace: string; sources: unknown; parameters: unknown; locals: unknown }): string {
  const parameters = parseInventoryPlanningParameterRows(projection.parameters, projection.identity).sort((a, b) => a.id - b.id), locals = parseInventoryPlanningLocalRows(projection.locals, projection.identity).sort((a, b) => a.id - b.id);
  if (!Array.isArray(projection.sources) || projection.sources.length > INVENTORY_PLANNING_LIMITS.sources) return fail("PLANNING_SOURCE_LIMIT");
  const sources = projection.sources.map(value => inventoryPlanningWriteCanonical(value)).sort();
  return inventoryPlanningWriteHash({ protocol: INVENTORY_PLANNING_WRITE_VERSION, identity: InventoryPlanningIdentitySchema.parse(projection.identity), scope: canonicalInventoryPlanningScope(projection.scope), asOfDate: InventoryPlanningDateSchema.parse(projection.asOfDate), marketplace: marketplace.parse(projection.marketplace), sources, parameters, locals });
}
export const inventoryPlanningOperationRequestHash = (raw: InventoryPlanningExecuteInput) => { inventoryPlanningWriteCanonical(raw); const input = InventoryPlanningExecuteInputSchema.parse(raw); return inventoryPlanningWriteHash({ ...input, scope: canonicalInventoryPlanningScope(input.scope) }); };
export const InventoryPlanningWriteResultSchema = z.object({ identity: InventoryPlanningIdentitySchema, scope: InventoryPlanningScopeSchema, asOfDate: InventoryPlanningDateSchema, marketplace, operationId: uuid,
  action: z.enum(["confirmLocal", "saveParameters"]).nullable(), status: z.enum(["committed", "cancelled", "unknown"]), recordId: id.nullable(), snapshotKey: hash.nullable(), reasonCode: text(200).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "committed" ? value.action === null || value.recordId === null || value.snapshotKey === null || value.reasonCode !== null : value.recordId !== null || value.snapshotKey !== null || value.reasonCode === null) ctx.addIssue({ code: "custom", message: "Invalid planning receipt state" });
  if (value.action === "confirmLocal" && value.scope.scopeType !== "asin") ctx.addIssue({ code: "custom", message: "Invalid local scope" });
});
export type InventoryPlanningWriteResult = z.infer<typeof InventoryPlanningWriteResultSchema>;
export function validateInventoryPlanningWriteAgainstReadResult(raw: InventoryPlanningExecuteInput, readRaw: InventoryPlanningReadResult): InventoryPlanningExecuteInput {
  inventoryPlanningWriteCanonical(raw);
  const input = InventoryPlanningExecuteInputSchema.parse(raw), read = InventoryPlanningReadResultSchema.parse(readRaw);
  if (input.expectedWorkspaceId !== read.identity.workspaceId || inventoryPlanningScopeKey(input.scope) !== inventoryPlanningScopeKey(read.scope) || input.asOfDate !== read.asOfDate || input.marketplace !== read.marketplace) return fail("PLANNING_SCOPE_MISMATCH");
  if (read.status !== "ready" || read.source.recordCount === 0 || read.capabilities[input.action].status !== "available") return fail("PLANNING_WRITE_UNAVAILABLE");
  if (read.snapshotKey !== input.expectedSnapshotKey) return fail("PLANNING_SNAPSHOT_CONFLICT");
  return input;
}
