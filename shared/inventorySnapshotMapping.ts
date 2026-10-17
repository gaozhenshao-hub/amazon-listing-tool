import { z } from "zod";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

export const INVENTORY_READ_LIMITS = { payloadBytes: 8 * 1024 * 1024, wireBytes: 64 * 1024 * 1024, resultBytes: 12 * 1024 * 1024, rows: 10_000, sourceRows: 10_000, jsonNodes: 500_000, depth: 18 } as const;
export const INVENTORY_SOURCE_KEYS = ["warehouses", "warehouse", "fba", "commodities", "aux", "listings", "shipping", "shippingItems", "details"] as const;
export type InventorySourceKey = typeof INVENTORY_SOURCE_KEYS[number] | "auxParents";
export type InventoryJson = null | boolean | number | string | InventoryJson[] | { [key: string]: InventoryJson };
export type InventoryRaw = { [key: string]: InventoryJson };
export class InventorySnapshotReadError extends Error {
  constructor(public readonly code: string) { super("库存快照、来源完整性或读取范围无法核验；不截断、不回退、不猜测"); this.name = "InventorySnapshotReadError"; }
}
export function inventoryJsonBytes(value: unknown): number {
  let count = 0;
  const ancestors = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) { ancestors.delete(item.value as object); continue; }
    if (++count > INVENTORY_READ_LIMITS.jsonNodes || item.depth > INVENTORY_READ_LIMITS.depth) throw new InventorySnapshotReadError("json_limit");
    if (item.value === null || typeof item.value === "boolean") continue;
    if (typeof item.value === "number") { if (!Number.isFinite(item.value)) throw new InventorySnapshotReadError("nonfinite_json"); continue; }
    if (typeof item.value === "string") { if (item.value.length > 32768) throw new InventorySnapshotReadError("string_limit"); continue; }
    if (typeof item.value !== "object" || ancestors.has(item.value) || Object.getOwnPropertySymbols(item.value).length) throw new InventorySnapshotReadError("invalid_json");
    if (!Array.isArray(item.value) && ![null, Object.prototype].includes(Object.getPrototypeOf(item.value))) throw new InventorySnapshotReadError("invalid_json_object");
    if (Array.isArray(item.value) && (Object.keys(item.value).length !== item.value.length || Object.keys(item.value).some((key, index) => key !== String(index)))) throw new InventorySnapshotReadError("invalid_json_array");
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item.value))) if (!(Array.isArray(item.value) && key === "length") && (!descriptor.enumerable || !("value" in descriptor) || key.length > 32768)) throw new InventorySnapshotReadError("invalid_json_property");
    ancestors.add(item.value); stack.push({ ...item, exit: true });
    for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
  }
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export function parseInventoryJson(value: unknown, canonicalLimit: number = INVENTORY_READ_LIMITS.payloadBytes, wireLimit: number = INVENTORY_READ_LIMITS.wireBytes): InventoryJson {
  try {
    if (typeof value === "string") { if (new TextEncoder().encode(value).byteLength > wireLimit) throw new Error(); value = JSON.parse(value); }
    if (inventoryJsonBytes(value) > canonicalLimit) throw new Error();
    return value as InventoryJson;
  } catch (error) { if (error instanceof InventorySnapshotReadError) throw error; throw new InventorySnapshotReadError("payload_limit_or_json"); }
}
export function inventoryCanonical(value: unknown): string {
  inventoryJsonBytes(value);
  const sort = (node: unknown): unknown => Array.isArray(node) ? node.map(sort) : node !== null && typeof node === "object" ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : node;
  return JSON.stringify(sort(value));
}
const text = (max = 500) => z.string().max(max);
const nonempty = (max = 500) => text(max).min(1).refine(value => value === value.trim());
const qtySchema = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const moneySchema = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 10000);
const timeSchema = z.number().int().safe().min(0).max(253402300799999);
export const InventoryStockSchema = z.object({ quantity: qtySchema, value: moneySchema.nullable() }).strict();
export type InventoryStock = z.infer<typeof InventoryStockSchema>;
export const INVENTORY_STOCK_KEYS = ["domestic", "purchase", "shipping", "fba", "total"] as const;
export const InventoryAgeSchema = z.object({ days181To270: qtySchema.nullable(), days271To365: qtySchema.nullable(), days365Plus: qtySchema.nullable(), dates: z.array(nonempty(100)).max(10000) }).strict();
export type InventoryAge = z.infer<typeof InventoryAgeSchema>;
export const InventoryBusinessScopeSchema = z.object({ parentAsin: nonempty(), storeName: nonempty(200), country: nonempty(100).transform(normalizeMarketplaceCode), accountId: nonempty(200) }).strict();
export type InventoryBusinessScope = z.infer<typeof InventoryBusinessScopeSchema>;
export const InventorySourceRefSchema = z.object({ source: z.enum([...INVENTORY_SOURCE_KEYS, "auxParents"]), index: z.number().int().nonnegative().max(INVENTORY_READ_LIMITS.sourceRows - 1), id: text().nullable() }).strict();
export type InventorySourceRef = z.infer<typeof InventorySourceRefSchema>;
export const InventoryScopeBindingSchema = z.object({ ref: InventorySourceRefSchema, scope: InventoryBusinessScopeSchema, mappingId: nonempty(), kind: z.literal("explicit_confirmed_field_mapping"), fields: z.object({ parentAsin: nonempty(100), storeName: nonempty(100), country: nonempty(100), accountId: nonempty(100) }).strict() }).strict();
export type InventoryScopeBinding = z.infer<typeof InventoryScopeBindingSchema>;
export const InventoryAuxSchema = z.object({ id: nonempty(2000), sku: text(2000), name: text(4000), stock: InventoryStockSchema, shared: z.boolean(), note: text(4000) }).strict();
export type InventoryAux = z.infer<typeof InventoryAuxSchema>;
export const InventoryLegacyRowSchema = z.object({ id: nonempty(2000), parentAsin: text(), parentName: text(4000), asin: text(), msku: text(2000), localSku: text(2000), commodityId: text(), name: text(4000), ownerIds: z.array(z.number().int().positive().safe()).max(10000), operator: text(2000), unpaired: z.boolean(), allocation: text(4000), lastShipment: text(100).nullable(), plan: qtySchema, domestic: InventoryStockSchema, purchase: InventoryStockSchema, shipping: InventoryStockSchema, fba: InventoryStockSchema, total: InventoryStockSchema, aux: z.array(InventoryAuxSchema).max(10000), notes: z.array(text(4000)).max(10000), age: InventoryAgeSchema.optional() }).strict();
export const InventoryFbaComponentsSchema = z.object({ physicalStockId: nonempty(2000), refs: z.array(InventorySourceRefSchema).min(1).max(10000), asin: nonempty(), msku: nonempty(2000), commodityId: text(), marketplaceIds: z.array(nonempty()).min(1), currency: z.literal("CNY"), available: qtySchema, reservedTransfer: qtySchema, reservedProcessing: qtySchema, reservedCustomerorders: qtySchema, unfulfillable: qtySchema, research: qtySchema, inTransit: qtySchema, inboundShipped: qtySchema, inboundReceiving: qtySchema, inboundWorking: qtySchema.nullable(), totalInventory: qtySchema, purchaseCosts: qtySchema.nullable(), age: InventoryAgeSchema }).strict();
export type InventoryFbaComponents = z.infer<typeof InventoryFbaComponentsSchema>;
export const InventoryAllocationEvidenceSchema = z.object({ kind: z.literal("approved_latest_actual_shipment"), approvalRef: nonempty(), shipmentRef: InventorySourceRefSchema, itemBatchRef: InventorySourceRefSchema, itemIndex: z.number().int().nonnegative().max(INVENTORY_READ_LIMITS.sourceRows - 1), shipDate: nonempty(100), scope: InventoryBusinessScopeSchema }).strict();
export const InventoryReadRowSchema = InventoryLegacyRowSchema.extend({ allocationEvidence: InventoryAllocationEvidenceSchema.nullable(), age: InventoryAgeSchema, ageStatus: z.enum(["observed", "unknown", "not_applicable"]), scopeStatus: z.enum(["verified", "unknown"]), scopes: z.array(InventoryBusinessScopeSchema).max(10000), sourceRefs: z.array(InventorySourceRefSchema).max(10000), physicalStockIds: z.array(nonempty(2000)).max(10000), fbaComponents: z.array(InventoryFbaComponentsSchema).max(10000), sourceSystem: z.enum(["saihu", "unknown"]), ownerEvidence: z.object({ status: z.enum(["complete", "unknown", "conflict"]), names: z.array(nonempty(2000)).max(10000), sourceRefs: z.array(InventorySourceRefSchema).max(10000) }).strict() }).strict();
export type InventoryReadRow = z.infer<typeof InventoryReadRowSchema>;
const rawSchema = z.custom<InventoryRaw>(value => { try { inventoryJsonBytes(value); return value !== null && typeof value === "object" && !Array.isArray(value); } catch { return false; } });
export const InventorySourcesSchema = z.object(Object.fromEntries(INVENTORY_SOURCE_KEYS.map(key => [key, z.array(rawSchema).max(INVENTORY_READ_LIMITS.sourceRows)])) as Record<typeof INVENTORY_SOURCE_KEYS[number], z.ZodArray<typeof rawSchema>>).extend({ auxParents: z.array(rawSchema).max(INVENTORY_READ_LIMITS.sourceRows).optional() }).strict();
export type InventorySources = z.infer<typeof InventorySourcesSchema>;
export const InventoryMappingOptionsSchema = z.object({ latestShipmentAllocation: z.union([z.object({ approved: z.literal(false) }).strict(), z.object({ approved: z.literal(true), approvalRef: nonempty() }).strict()]) }).strict();
export type InventoryMappingOptions = z.infer<typeof InventoryMappingOptionsSchema>;
export const InventoryCanonicalSnapshotSchema = z.object({ version: z.literal(2), currency: z.literal("CNY"), startedAt: timeSchema, capturedAt: timeSchema, rows: z.array(InventoryReadRowSchema).max(INVENTORY_READ_LIMITS.rows), warnings: z.array(text(4000)).max(10000), sourceCounts: z.record(z.string(), z.number().int().nonnegative()), mapping: z.object({ ruleVersion: z.literal("friend383b69e_T14_v2"), sources: InventorySourcesSchema, scopeBindings: z.array(InventoryScopeBindingSchema).max(90000), options: InventoryMappingOptionsSchema, collectionCoverage: z.literal("provided_arrays_not_collection_attested") }).strict() }).strict();
export type InventoryCanonicalSnapshot = z.infer<typeof InventoryCanonicalSnapshotSchema>;
export function sumInventoryStock(values: InventoryStock[]): InventoryStock {
  const quantity = values.reduce((sum, value) => sum + value.quantity, 0), value = values.some(value => value.value === null) ? null : values.reduce((sum, value) => sum + value.value!, 0);
  if (!Number.isFinite(quantity) || quantity > Number.MAX_SAFE_INTEGER || value !== null && (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER / 10000)) throw new InventorySnapshotReadError("stock_overflow");
  return { quantity, value: value === null ? null : Math.round(value * 10000) / 10000 };
}
const str = (value: InventoryJson | undefined) => value === null || value === undefined ? "" : typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
function quantity(row: InventoryRaw, key: string): number {
  const value = row[key]; if ((typeof value !== "number" && typeof value !== "string") || typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) throw new InventorySnapshotReadError(`quantity_${key}`);
  return Number(value);
}
function nullableQuantity(row: InventoryRaw, key: string): number | null {
  if (row[key] === undefined || row[key] === null || row[key] === "") return null;
  const result = quantity(row, key);
  if (["totalPurchase", "onWayPurchase", "purchaseCosts"].includes(key) && result > Number.MAX_SAFE_INTEGER / 10000) throw new InventorySnapshotReadError("money_range");
  return result;
}
const zero = (): InventoryStock => ({ quantity: 0, value: 0 });
const unknownAge = (): InventoryAge => ({ days181To270: null, days271To365: null, days365Plus: null, dates: [] });
function ref(source: InventorySourceKey, index: number, raw: InventoryRaw): InventorySourceRef { return { source, index, id: str(raw.id) || str(raw.shipSn) || null }; }
const refKey = (value: InventorySourceRef) => `${value.source}:${value.index}`;
const same = (left: unknown, right: unknown) => inventoryCanonical(left) === inventoryCanonical(right);
const NA = new Set(["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8"]);

/** Pure supplied-source compatibility only. No collection, persistence, calls,
 * owner authorization or implicit approval of the latest-shipment rule. */
export function mapInventorySources(value: { sources: InventorySources; startedAt: number; capturedAt: number; scopeBindings?: InventoryScopeBinding[]; options?: InventoryMappingOptions }): InventoryCanonicalSnapshot {
  try { return mapSources(value); } catch (error) { if (error instanceof InventorySnapshotReadError) throw error; throw new InventorySnapshotReadError("invalid_sources"); }
}
function mapSources(value: Parameters<typeof mapInventorySources>[0]): InventoryCanonicalSnapshot {
  parseInventoryJson(value.sources);
  const sources = InventorySourcesSchema.parse(value.sources), startedAt = timeSchema.parse(value.startedAt), capturedAt = timeSchema.parse(value.capturedAt);
  if (capturedAt < startedAt) throw new InventorySnapshotReadError("capture_before_start");
  const options = InventoryMappingOptionsSchema.parse(value.options ?? { latestShipmentAllocation: { approved: false } });
  const scopeBindings = z.array(InventoryScopeBindingSchema).max(90000).parse(value.scopeBindings ?? []), bindings = new Map<string, InventoryScopeBinding>();
  for (const binding of scopeBindings) {
    const raw = sources[binding.ref.source]?.[binding.ref.index];
    if (!raw || !same(ref(binding.ref.source, binding.ref.index, raw), binding.ref) || bindings.has(refKey(binding.ref))) throw new InventorySnapshotReadError("scope_binding_ref");
    for (const key of ["parentAsin", "storeName", "country", "accountId"] as const) {
      const field = binding.fields[key]; if (!Object.hasOwn(raw, field)) throw new InventorySnapshotReadError("scope_binding_field");
      const actual = key === "country" ? normalizeMarketplaceCode(str(raw[field])) : str(raw[field]);
      if (!actual || actual !== binding.scope[key]) throw new InventorySnapshotReadError("scope_binding_value");
    }
    const marketplaceCountries: Record<string, string> = { ATVPDKIKX0DER: "US", A2EUQ1WTGCTBG2: "CA", A1AM78C64UM0Y8: "MX" };
    if (["fba", "listings"].includes(binding.ref.source) && Object.hasOwn(marketplaceCountries, str(raw.marketplaceId)) && marketplaceCountries[str(raw.marketplaceId)] !== binding.scope.country) throw new InventorySnapshotReadError("marketplace_country_conflict");
    bindings.set(refKey(binding.ref), binding);
  }
  const warnings = ["仅核验传入来源数组及映射；没有实采分页完成凭证，不证明已覆盖全账号。", "金额为 CNY 采购货值，不是已付款金额；计划库存独立，不能替换领星补货输入。"];
  const rows: InventoryReadRow[] = [];
  const quantitativeRefs = new Map<InventoryReadRow, InventorySourceRef[]>();
  const commodities = new Map<string, InventoryRaw>(), aux = new Map<string, InventoryRaw>(), warehouses = new Map<string, number>();
  const catalogRefs = new Map<InventoryRaw, InventorySourceRef>();
  for (const [target, input] of [[commodities, sources.commodities], [aux, sources.aux]] as const) for (const raw of input) { const id = str(raw.id); if (!id || target.has(id) && !same(target.get(id), raw)) throw new InventorySnapshotReadError("conflicting_commodity_or_aux"); target.set(id, raw); }
  for (const source of ["commodities", "aux"] as const) sources[source].forEach((raw, index) => catalogRefs.set(raw, ref(source, index, raw)));
  const scopedCatalog = (raw: InventoryRaw | undefined, scopes: InventoryBusinessScope[]) => {
    if (!raw) return undefined;
    const sourceRef = catalogRefs.get(raw)!, bound = bindings.get(refKey(sourceRef))?.scope;
    // A catalog id alone does not establish account ownership. Unknown rows
    // may retain unbound legacy labels, but verified rows require the same
    // explicit, row-bound scope for every attached catalog label.
    return scopes.length ? bound && scopes.some(scope => same(scope, bound)) ? { raw, ref: sourceRef } : undefined : !bound ? { raw, ref: sourceRef } : undefined;
  };
  for (const raw of sources.warehouses) { const id = str(raw.id), type = quantity(raw, "type"); if (!id || warehouses.has(id) && warehouses.get(id) !== type) throw new InventorySnapshotReadError("conflicting_warehouse"); warehouses.set(id, type); }
  const listings = sources.listings.flatMap((raw, index) => NA.has(str(raw.marketplaceId)) && str(raw.asin) && str(raw.sku) ? [{ raw, ref: ref("listings", index, raw) }] : []);
  const listingsByIdentity = new Map<string, typeof listings>(), listingsByCommodity = new Map<string, typeof listings>();
  for (const item of listings) {
    const cid = str(item.raw.commodityId), key = JSON.stringify([cid, str(item.raw.asin), str(item.raw.sku)]);
    const identities = listingsByIdentity.get(key) ?? [], commodities = listingsByCommodity.get(cid) ?? []; identities.push(item); commodities.push(item); listingsByIdentity.set(key, identities); listingsByCommodity.set(cid, commodities);
  }
  const createRow = (id: string, cid: string, asin: string, msku: string, refs: InventorySourceRef[], physicalIds: string[]): InventoryReadRow => {
    const provenScopes = refs.map(source => bindings.get(refKey(source))?.scope).filter((scope): scope is InventoryBusinessScope => !!scope);
    const candidates = (listingsByIdentity.get(JSON.stringify([cid, asin, msku])) ?? []).filter(item => {
      const scope = bindings.get(refKey(item.ref))?.scope;
      return !provenScopes.length || !!scope && provenScopes.some(proven => same(proven, scope));
    });
    const parents = [...new Set(candidates.map(item => str(item.raw.parentAsin)).filter(Boolean))], catalog = scopedCatalog(commodities.get(cid), provenScopes), commodity = catalog?.raw, listing = candidates[0]?.raw;
    const row: InventoryReadRow = { id, commodityId: cid, localSku: str(listing?.commoditySku) || str(commodity?.sku), asin, msku, parentAsin: parents.length === 1 ? parents[0] : "", parentName: str(listing?.commodityName) || str(commodity?.name), name: str(listing?.commodityName) || str(commodity?.name) || asin || "未命名本地库存", ownerIds: [], operator: "", unpaired: !asin, allocation: "原始库存身份独立保留", allocationEvidence: null, lastShipment: null, plan: 0, domestic: zero(), purchase: zero(), shipping: zero(), fba: zero(), total: zero(), aux: [], notes: [], age: unknownAge(), ageStatus: "unknown", scopeStatus: "unknown", scopes: [], sourceRefs: [...refs, ...candidates.map(item => item.ref), ...catalog ? [catalog.ref] : []], physicalStockIds: physicalIds, fbaComponents: [], sourceSystem: "saihu", ownerEvidence: { status: "unknown", names: [], sourceRefs: refs } };
    if (parents.length > 1) row.notes.push("同一 ASIN/MSKU 的源父体冲突，未选择单一父体");
    quantitativeRefs.set(row, [...refs]); rows.push(row); return row;
  };
  const fbaByPhysical = new Map<string, { normalized: Omit<InventoryFbaComponents, "refs" | "marketplaceIds" | "physicalStockId">; refs: InventorySourceRef[]; markets: string[] }>();
  const sharedAccounts = new Map<string, string | null>();
  // Validate every copy before deduplication: a second copy cannot hide a bad
  // component merely because its old v1 total signature looked equal.
  sources.fba.forEach((raw, index) => {
    const keys = ["available", "reservedTransfer", "reservedProcessing", "reservedCustomerorders", "unfulfillable", "research", "inTransit", "inboundShipped", "inboundReceiving", "totalInventory"] as const;
    const parts = Object.fromEntries(keys.map(key => [key, quantity(raw, key)])) as Record<typeof keys[number], number>;
    if (parts.inTransit !== parts.inboundShipped + parts.inboundReceiving || parts.totalInventory !== parts.available + parts.reservedTransfer + parts.reservedProcessing + parts.reservedCustomerorders + parts.unfulfillable + parts.research + parts.inTransit) throw new InventorySnapshotReadError("fba_component_total");
    const age = { days181To270: nullableQuantity(raw, "invAge181To270Days"), days271To365: nullableQuantity(raw, "invAge271To365Days"), days365Plus: nullableQuantity(raw, "invAge365PlusDays"), dates: str(raw.snapshotDate) ? [str(raw.snapshotDate)] : [] };
    if (!NA.has(str(raw.marketplaceId))) { warnings.push(`排除非北美 FBA 来源行 ${index}，不混入本快照`); return; }
    if (str(raw.currency) !== "CNY") throw new InventorySnapshotReadError("fba_currency");
    const sourceRef = ref("fba", index, raw), account = bindings.get(refKey(sourceRef))?.scope.accountId;
    const shared = str(raw.shareKey) || str(raw.id); if (!shared) throw new InventorySnapshotReadError("fba_identity");
    if (sharedAccounts.has(shared) && sharedAccounts.get(shared) !== (account ?? null)) throw new InventorySnapshotReadError("shared_key_account_ambiguity");
    sharedAccounts.set(shared, account ?? null);
    const physicalId = `fba:${JSON.stringify([account ?? null, shared])}`;
    const normalized = { ...parts, asin: str(raw.asin), msku: str(raw.sku), commodityId: str(raw.commodityId), currency: "CNY" as const, inboundWorking: nullableQuantity(raw, "inboundWorking"), purchaseCosts: nullableQuantity(raw, "purchaseCosts"), age };
    if (!normalized.asin || !normalized.msku) throw new InventorySnapshotReadError("fba_product_identity");
    const prior = fbaByPhysical.get(physicalId);
    if (prior && !same(prior.normalized, normalized)) throw new InventorySnapshotReadError("shared_fba_conflict");
    if (prior) { prior.refs.push(sourceRef); if (!prior.markets.includes(str(raw.marketplaceId))) prior.markets.push(str(raw.marketplaceId)); }
    else fbaByPhysical.set(physicalId, { normalized, refs: [sourceRef], markets: [str(raw.marketplaceId)] });
  });
  for (const [physicalId, stock] of fbaByPhysical) {
    const data = stock.normalized, row = createRow(physicalId, data.commodityId, data.asin, data.msku, stock.refs, [physicalId]);
    const value = data.purchaseCosts, transitValue = value === null ? null : data.totalInventory > 0 ? Math.round(value * data.inTransit / data.totalInventory * 10000) / 10000 : value === 0 ? 0 : null;
    row.shipping = { quantity: data.inTransit, value: transitValue };
    row.fba = { quantity: data.totalInventory - data.inTransit, value: value === null || transitValue === null ? null : Math.round((value - transitValue) * 10000) / 10000 };
    row.age = data.age; row.ageStatus = [data.age.days181To270, data.age.days271To365, data.age.days365Plus].some(value => value === null) ? "unknown" : "observed"; row.fbaComponents = [{ ...data, physicalStockId: physicalId, refs: stock.refs, marketplaceIds: stock.markets }];
    row.notes.push("FBA 在途仅含 inboundShipped 与 inboundReceiving；inboundWorking 单列，不重复计入库存。采购货值按数量比例分配，不使用付款金额。");
    if (value === null) row.notes.push("FBA 采购货值未知，不补零");
    if ([data.age.days181To270, data.age.days271To365, data.age.days365Plus].some(value => value === null)) row.notes.push("库龄分段未知，不按零计入排序");
    if ([data.age.days181To270, data.age.days271To365, data.age.days365Plus].reduce<number>((total, value) => total + (value ?? 0), 0) > row.fba.quantity) row.notes.push("库龄快照数量超过实时仓内数量，更新时间不同；完整保留原库龄");
  }
  const shipments = new Map<string, InventoryRaw>(), shipmentBatches = new Map<string, InventoryRaw>();
  for (const raw of sources.shipping) { const id = str(raw.shipSn); if (!id || shipments.has(id)) throw new InventorySnapshotReadError("shipment_identity"); shipments.set(id, raw); }
  for (const raw of sources.shippingItems) { const id = str(raw.shipSn); if (!id || shipmentBatches.has(id) || !shipments.has(id) || !Array.isArray(raw.items)) throw new InventorySnapshotReadError("shipment_items"); shipmentBatches.set(id, raw); }
  for (const [shipSn, shipping] of shipments) if (Number(shipping.status) === 3 && Number(shipping.restoreStock) !== 1 && !shipmentBatches.has(shipSn)) throw new InventorySnapshotReadError("missing_shipment_items");
  type ShipmentEvidence = Omit<z.infer<typeof InventoryAllocationEvidenceSchema>, "approvalRef" | "kind">;
  const latest = new Map<string, ShipmentEvidence>();
  for (const [shipSn, batch] of shipmentBatches) {
    const shipping = shipments.get(shipSn)!; if (Number(shipping.status) !== 3 || Number(shipping.restoreStock) === 1) continue;
    const shippingBinding = bindings.get(`shipping:${sources.shipping.indexOf(shipping)}`), batchBinding = bindings.get(`shippingItems:${sources.shippingItems.indexOf(batch)}`), shippingScope = shippingBinding?.scope, batchScope = batchBinding?.scope;
    // Approval of a rule is not evidence of an account association. Both the
    // shipment and its item batch must carry matching explicit source fields.
    if (!shippingScope || !batchScope || !same(shippingScope, batchScope)) continue;
    const date = str(shipping.realShipTime) || str(shipping.shipTime); if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/u.test(date)) continue;
    const [year, month, day, hour = 0, minute = 0, second = 0] = date.split(/[- T:]/u).map(Number), days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) continue;
    for (const [itemIndex, item] of (batch.items as InventoryJson[]).entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new InventorySnapshotReadError("shipment_item_structure");
      for (const bound of [shippingBinding!, batchBinding!]) for (const key of ["parentAsin", "storeName", "country", "accountId"] as const) {
        const field = bound.fields[key];
        if (Object.hasOwn(item, field) && (key === "country" ? normalizeMarketplaceCode(str(item[field])) : str(item[field])) !== bound.scope[key]) throw new InventorySnapshotReadError("shipment_item_scope_conflict");
      }
      if (!quantity(item, "shipCount")) continue;
      const key = JSON.stringify([shippingScope, str(item.commodityId), str(item.asin), str(item.sellerSku)]);
      if (!latest.has(key) || latest.get(key)!.shipDate < date) latest.set(key, { scope: shippingScope, shipmentRef: shippingBinding!.ref, itemBatchRef: batchBinding!.ref, itemIndex, shipDate: date });
    }
  }
  const balanceGroups = new Map<string, { cid: string; sku: string; domestic: InventoryStock; purchase: InventoryStock; plan: number; refs: InventorySourceRef[]; physical: string[] }>();
  const warehouseSeen = new Set<string>();
  sources.warehouse.forEach((raw, index) => {
    const type = warehouses.get(str(raw.warehouseId)), q = quantity(raw, "stockAllNum"), purchase = quantity(raw, "stockWait"), plan = quantity(raw, "stockPlan");
    if (q !== quantity(raw, "stockAvailable") + quantity(raw, "stockDefective") + quantity(raw, "stockOccupy")) throw new InventorySnapshotReadError("domestic_component_total");
    if (type === 2) return;
    if (type !== 0 && type !== 1) { if (q || purchase || plan) throw new InventorySnapshotReadError("unknown_warehouse_scope"); return; }
    const id = str(raw.id), cid = str(raw.commodityId); if (!id || !cid || warehouseSeen.has(id)) throw new InventorySnapshotReadError("domestic_identity"); warehouseSeen.add(id);
    const sourceRef = ref("warehouse", index, raw), scope = bindings.get(refKey(sourceRef))?.scope;
    const key = JSON.stringify([cid, scope ?? null]), balance = balanceGroups.get(key) ?? { cid, sku: str(raw.commoditySku), domestic: zero(), purchase: zero(), plan: 0, refs: [], physical: [] };
    balance.domestic = sumInventoryStock([balance.domestic, { quantity: q, value: nullableQuantity(raw, "totalPurchase") }]);
    balance.purchase = sumInventoryStock([balance.purchase, { quantity: purchase, value: nullableQuantity(raw, "onWayPurchase") }]);
    balance.plan += plan; balance.refs.push(sourceRef); balance.physical.push(`warehouse:${id}`); balanceGroups.set(key, balance);
  });
  const auxStocks = new Map<string, { cid: string; aux: InventoryAux; refs: InventorySourceRef[]; metadataRefs: InventorySourceRef[]; physical: string[] }>();
  for (const [key, balance] of balanceGroups) {
    if (aux.has(balance.cid)) {
      const scopes = balance.refs.map(source => bindings.get(refKey(source))?.scope).filter((scope): scope is InventoryBusinessScope => !!scope), catalog = scopedCatalog(aux.get(balance.cid), scopes);
      auxStocks.set(key, { cid: balance.cid, aux: { id: `aux:${key}`, sku: str(catalog?.raw.sku), name: str(catalog?.raw.name), stock: sumInventoryStock([balance.domestic, balance.purchase]), shared: true, note: "辅料采购货值与商品库存分开；共享记录独立去重，不用付款金额" }, refs: balance.refs, metadataRefs: catalog ? [catalog.ref] : [], physical: balance.physical }); continue;
    }
    const uniqueCandidates = new Map<string, { asin: string; msku: string; refs: InventorySourceRef[] }>();
    const balanceScopes = balance.refs.map(source => bindings.get(refKey(source))?.scope).filter((scope): scope is InventoryBusinessScope => !!scope);
    for (const item of (listingsByCommodity.get(balance.cid) ?? []).filter(item => {
      const scope = bindings.get(refKey(item.ref))?.scope;
      return !balanceScopes.length || !!scope && balanceScopes.some(proven => same(proven, scope));
    })) {
      const key = JSON.stringify([balance.cid, str(item.raw.asin), str(item.raw.sku)]), candidate = uniqueCandidates.get(key) ?? { asin: str(item.raw.asin), msku: str(item.raw.sku), refs: [] };
      candidate.refs.push(item.ref); uniqueCandidates.set(key, candidate);
    }
    let selected = uniqueCandidates.size === 1 ? [...uniqueCandidates.values()][0] : undefined, lastShipment: string | null = null, allocationEvidence: InventoryReadRow["allocationEvidence"] = null;
    if (!selected && uniqueCandidates.size > 1 && options.latestShipmentAllocation.approved) {
      const distinctScopes = new Map(balanceScopes.map(scope => [inventoryCanonical(scope), scope]));
      if (distinctScopes.size === 1 && balanceScopes.length === balance.refs.length) {
        const scope = [...distinctScopes.values()][0];
        const dated = [...uniqueCandidates.values()].map(candidate => ({ candidate, evidence: latest.get(JSON.stringify([scope, balance.cid, candidate.asin, candidate.msku])) })).filter((item): item is { candidate: typeof item.candidate; evidence: ShipmentEvidence } => !!item.evidence);
        const newest = dated.map(item => item.evidence.shipDate).sort().at(-1), matching = dated.filter(item => item.evidence.shipDate === newest);
        if (matching.length === 1) { selected = matching[0].candidate; lastShipment = newest!; allocationEvidence = { ...matching[0].evidence, kind: "approved_latest_actual_shipment", approvalRef: options.latestShipmentAllocation.approvalRef }; }
      }
    }
    const row = createRow(`domestic:${key}`, balance.cid, selected?.asin ?? "", selected?.msku ?? "", balance.refs, balance.physical);
    row.age = { days181To270: 0, days271To365: 0, days365Plus: 0, dates: [] }; row.ageStatus = "not_applicable";
    row.localSku = balance.sku || row.localSku; row.domestic = balance.domestic; row.purchase = balance.purchase; row.plan = balance.plan; row.lastShipment = lastShipment; row.allocationEvidence = allocationEvidence;
    if (allocationEvidence) row.sourceRefs.push(allocationEvidence.shipmentRef, allocationEvidence.itemBatchRef);
    row.allocation = selected ? lastShipment ? "已显式批准规则，归属于唯一最近实际发货 MSKU" : "本地商品仅有一个 MSKU 候选" : uniqueCandidates.size ? "多个 MSKU 归属未唯一核验，库存独立保留" : "本地商品无可配对 MSKU";
    if (!selected) row.notes.push(row.allocation);
    if (balance.domestic.value === null || balance.purchase.value === null) row.notes.push("采购货值未知，不补零、不以已付款金额代替");
  }
  const details = new Map<string, InventoryRaw>();
  for (const raw of sources.details) { const id = str(raw.id); if (!id || details.has(id) || !Array.isArray(raw.commodityAux)) throw new InventorySnapshotReadError("aux_detail_structure"); details.set(id, raw); }
  for (const parent of sources.auxParents ?? []) if (!str(parent.id) || !details.has(str(parent.id))) throw new InventorySnapshotReadError("missing_aux_parent_detail");
  const auxUsed = new Set<string>();
  for (const [cid, detail] of details) for (const link of detail.commodityAux as InventoryJson[]) {
    if (!link || typeof link !== "object" || Array.isArray(link) || !str(link.auxId) || !aux.has(str(link.auxId))) throw new InventorySnapshotReadError("aux_link_missing");
    const matching = [...auxStocks.values()].filter(item => item.cid === str(link.auxId));
    if (!matching.length) throw new InventorySnapshotReadError("aux_stock_source_missing");
    for (const row of rows.filter(row => row.commodityId === cid && row.asin)) for (const item of matching) {
      const productScopes = quantitativeRefs.get(row)!.map(source => bindings.get(refKey(source))?.scope).filter((scope): scope is InventoryBusinessScope => !!scope);
      const auxScopes = item.refs.map(source => bindings.get(refKey(source))?.scope).filter((scope): scope is InventoryBusinessScope => !!scope);
      const detailIndex = sources.details.indexOf(detail), detailScope = bindings.get(`details:${detailIndex}`)?.scope;
      if (productScopes.length && (!detailScope || !productScopes.some(scope => scope.accountId === detailScope.accountId && scope.storeName === detailScope.storeName && scope.country === detailScope.country) || !auxScopes.length || auxScopes.some(scope => !productScopes.some(product => product.accountId === scope.accountId && product.storeName === scope.storeName && product.country === scope.country)))) { row.notes.push("辅料关联的原行范围证据不完整或不同账号，辅料独立保留，不跨范围关联"); continue; }
      if (!row.aux.some(prior => prior.id === item.aux.id)) row.aux.push(item.aux);
      row.physicalStockIds.push(...item.physical.map(id => `aux:${id}`)); row.sourceRefs.push(...item.refs, ...item.metadataRefs, ref("details", detailIndex, detail)); quantitativeRefs.get(row)!.push(...item.refs); auxUsed.add(item.aux.id);
    }
  }
  for (const item of auxStocks.values()) if (!auxUsed.has(item.aux.id)) {
    const row = createRow(item.aux.id, "", "", "", item.refs, item.physical.map(id => `aux:${id}`)); row.age = { days181To270: 0, days271To365: 0, days365Plus: 0, dates: [] }; row.ageStatus = "not_applicable"; row.name = item.aux.name; row.localSku = item.aux.sku; row.aux = [item.aux]; row.sourceRefs.push(...item.metadataRefs); row.allocation = "未关联辅料独立保留，不计入商品库存";
  }
  for (const row of rows) {
    const refs = quantitativeRefs.get(row)!;
    const scopes = refs.map(source => bindings.get(refKey(source))?.scope), uniqueScopes = new Map(scopes.filter((scope): scope is InventoryBusinessScope => !!scope).map(scope => [inventoryCanonical(scope), scope]));
    row.scopes = [...uniqueScopes.values()]; row.scopeStatus = refs.length > 0 && scopes.every(Boolean) ? "verified" : "unknown";
    const parentIds = [...new Set(row.scopes.map(scope => scope.parentAsin))]; if (parentIds.length === 1 && row.scopeStatus === "verified") row.parentAsin = parentIds[0];
    if (row.scopeStatus === "unknown") row.notes.push("原行没有完整明确的店铺、账号、站点、父体字段映射，范围未知，不用于普通用户授权");
    const ownerSets = refs.map(source => {
      const raw = sources[source.source]![source.index], list = raw.devList;
      if (!Array.isArray(list) || !list.length) return null;
      const names = list.map(item => item && typeof item === "object" && !Array.isArray(item) ? str(item.devName) : "");
      return names.every(Boolean) ? [...new Set(names)].sort() : null;
    });
    const names = [...new Set(ownerSets.flatMap(value => value ?? []))].sort();
    row.ownerEvidence = { status: ownerSets.some(value => value === null) || !ownerSets.length ? "unknown" : new Set(ownerSets.map(value => inventoryCanonical(value))).size === 1 ? "complete" : "conflict", names, sourceRefs: refs };
    row.operator = names.join("/"); row.sourceRefs = [...new Map(row.sourceRefs.map(source => [refKey(source), source])).values()]; row.physicalStockIds = [...new Set(row.physicalStockIds)];
    row.total = sumInventoryStock([row.domestic, row.purchase, row.shipping, row.fba]);
  }
  // Retain zero realtime rows with old age, planned quantities or unknown
  // evidence. An entirely empty source result is never a successful overwrite.
  const active = rows.filter(row => row.total.quantity > 0 || row.plan > 0 || row.aux.some(value => value.stock.quantity > 0 || value.stock.value === null) || Object.values(row.age).some(value => typeof value === "number" && value > 0) || row.total.value === null || row.fbaComponents.some(value => value.inboundWorking !== null && value.inboundWorking > 0 || [value.age.days181To270, value.age.days271To365, value.age.days365Plus].some(age => age === null)));
  if (!active.length) throw new InventorySnapshotReadError("empty_snapshot");
  const result = { version: 2 as const, currency: "CNY" as const, startedAt, capturedAt, rows: active, warnings, sourceCounts: Object.fromEntries(Object.entries(sources).map(([key, rows]) => [key, rows.length])), mapping: { ruleVersion: "friend383b69e_T14_v2" as const, sources, scopeBindings, options, collectionCoverage: "provided_arrays_not_collection_attested" as const } };
  if (inventoryJsonBytes(result) > INVENTORY_READ_LIMITS.payloadBytes) throw new InventorySnapshotReadError("mapped_payload_limit");
  return InventoryCanonicalSnapshotSchema.parse(result);
}
