import { z } from "zod";
import SHA256 from "crypto-js/sha256";
import {
  INVENTORY_READ_LIMITS, InventorySourcesSchema, inventoryJsonBytes,
  mapInventorySources, type InventoryRaw, type InventorySources, type InventoryJson,
  type InventoryMappingOptions, type InventoryScopeBinding, type InventoryCanonicalSnapshot,
} from "./inventorySnapshotMapping";

export const INVENTORY_COLLECTION_VERSION = "saihu-inventory-collection-v1" as const;
export const INVENTORY_COLLECTION_LIMITS = {
  sourceRows: 10_000, pageSize: 100, pagesPerSource: 100, shippingBatchSize: 20,
  responseBytes: 4 * 1024 * 1024, totalResponseBytes: 16 * 1024 * 1024,
  sourceBytes: INVENTORY_READ_LIMITS.payloadBytes, proofBytes: 16 * 1024 * 1024,
  collectionBytes: 24 * 1024 * 1024, receipts: 11_500, jsonNodes: 2_000_000,
} as const;
export const INVENTORY_COLLECTION_SOURCES = ["warehouses", "warehouse", "fba", "commodities", "aux", "auxParents", "listings", "shipping", "shippingItems", "details"] as const;
export const INVENTORY_COLLECTION_PAGED_SOURCES = ["warehouses", "warehouse", "fba", "commodities", "aux", "auxParents", "listings", "shipping"] as const;
export type InventoryCollectionSource = typeof INVENTORY_COLLECTION_SOURCES[number];
export type InventoryCollectionRequestSource = InventoryCollectionSource | "catalogStart" | "catalogEnd";
type PagedSource = typeof INVENTORY_COLLECTION_PAGED_SOURCES[number] | "catalogStart" | "catalogEnd";
export type CollectedInventorySources = InventorySources & { auxParents: InventoryRaw[] };

export class InventorySnapshotCollectionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "InventorySnapshotCollectionError"; }
}
const fail = (code: string): never => { throw new InventorySnapshotCollectionError(`INVENTORY_COLLECTION_${code}`); };
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.number().int().safe().min(0).max(253402300799999);
const count = z.number().int().min(0).max(INVENTORY_COLLECTION_LIMITS.sourceRows);
export const InventoryCollectionContextSchema = z.object({ workspaceId: z.number().int().positive().max(2147483647), connectionVersion: hash, mappingVersion: hash }).strict();
export type InventoryCollectionContext = z.infer<typeof InventoryCollectionContextSchema>;
export type InventoryCollectionRequest = { source: InventoryCollectionRequestSource; endpoint: string; body: InventoryRaw };
export type InventoryCollectionResponse = { httpStatus: number; body: unknown; receivedAt: number; wireByteLength: number };
export type InventoryCollectionRead = (request: InventoryCollectionRequest) => Promise<InventoryCollectionResponse>;

/** These are the friend's complete request scopes, not a UI-selected subset. */
const definitions: Record<PagedSource, { endpoint: string; body: InventoryRaw }> = {
  catalogStart: { endpoint: "/api/shop/pageList.json", body: {} },
  catalogEnd: { endpoint: "/api/shop/pageList.json", body: {} },
  warehouses: { endpoint: "/api/warehouseManage/warehouseList.json", body: {} },
  warehouse: { endpoint: "/api/warehouseManage/warehouseItemList.json", body: { isHidden: "false" } },
  fba: { endpoint: "/api/inventoryManage/fba/pageList.json", body: { currency: "CNY", hideZero: "false", hideDeletedPrd: "false", needMergeShare: "true", history: "false" } },
  commodities: { endpoint: "/api/commodity/pageList.json", body: { isAllGroup: 1 } },
  aux: { endpoint: "/api/commodity/aux/pageList.json", body: {} },
  auxParents: { endpoint: "/api/commodity/pageList.json", body: { isAllGroup: 1, relAuxFlag: 1 } },
  listings: { endpoint: "/api/order/api/product/v2/pageList.json", body: { marketplaceIdList: ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8"] } },
  shipping: { endpoint: "/api/fba/shippingOrder/pageList/v2.json", body: { status: "3" } },
};
export function inventoryCollectionPageRequest(source: PagedSource, pageNo: number): InventoryCollectionRequest {
  if (!Object.hasOwn(definitions, source) || !Number.isInteger(pageNo) || pageNo < 1 || pageNo > INVENTORY_COLLECTION_LIMITS.pagesPerSource) return fail("REQUEST_INVALID");
  const definition = definitions[source];
  return { source, endpoint: definition.endpoint, body: { ...structuredClone(definition.body), pageNo: String(pageNo), pageSize: String(INVENTORY_COLLECTION_LIMITS.pageSize) } };
}
export function inventoryCollectionShippingRequest(shipSnList: string[]): InventoryCollectionRequest {
  if (!shipSnList.length || shipSnList.length > INVENTORY_COLLECTION_LIMITS.shippingBatchSize || new Set(shipSnList).size !== shipSnList.length || shipSnList.some(value => !value || value !== value.trim() || value.length > 500)) return fail("SHIPPING_REQUEST_INVALID");
  return { source: "shippingItems", endpoint: "/api/fba/shippingOrder/itemsBatch.json", body: { shipSnList: [...shipSnList] } };
}
export function inventoryCollectionDetailRequest(id: string): InventoryCollectionRequest {
  if (!id || id !== id.trim() || id.length > 500) return fail("DETAIL_REQUEST_INVALID");
  return { source: "details", endpoint: "/api/commodity/v2/getCommodityDetail.json", body: { id } };
}

/** JSON identity is canonical, not the original wire bytes. No getters, dates,
 * non-finite numbers, sparse arrays, coercions or JSON truncation are admitted. */
export function inventoryCollectionCanonical(value: unknown, byteLimit = INVENTORY_COLLECTION_LIMITS.collectionBytes): string {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || byteLimit > INVENTORY_COLLECTION_LIMITS.collectionBytes) return fail("BUDGET_INVALID");
  const seen = new Set<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): string {
    if (++nodes > INVENTORY_COLLECTION_LIMITS.jsonNodes || depth > 24) return fail("JSON_LIMIT");
    if (item === null) return "null";
    if (typeof item === "string") { if (item.length > 32768 || new TextDecoder().decode(new TextEncoder().encode(item)) !== item) return fail("JSON_INVALID"); return JSON.stringify(item); }
    if (typeof item === "number") { if (!Number.isFinite(item)) return fail("JSON_INVALID"); return JSON.stringify(item); }
    if (typeof item === "boolean") return String(item);
    if (typeof item !== "object" || seen.has(item) || Object.getOwnPropertySymbols(item).length) return fail("JSON_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.entries(descriptors).some(([key, d]) => !(Array.isArray(item) && key === "length") && (!d.enumerable || !("value" in d)))) return fail("JSON_INVALID");
    seen.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (item.length > 100_000 || Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index))) return fail("JSON_INVALID");
      result = `[${item.map(child => visit(child, depth + 1)).join(",")}]`;
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) return fail("JSON_INVALID");
      result = `{${Object.keys(descriptors).sort().map(key => `${visit(key, depth + 1)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
    }
    seen.delete(item);
    if (new TextEncoder().encode(result).byteLength > byteLimit) return fail("BYTES_LIMIT");
    return result;
  }
  const result = visit(value, 0);
  if (new TextEncoder().encode(result).byteLength > byteLimit) return fail("BYTES_LIMIT");
  return result;
}
export const inventoryCollectionHash = (value: unknown): string => SHA256(inventoryCollectionCanonical(value)).toString();
const same = (left: unknown, right: unknown) => inventoryCollectionCanonical(left) === inventoryCollectionCanonical(right);
const isRaw = (value: unknown): value is InventoryRaw => value !== null && typeof value === "object" && !Array.isArray(value);
const rawSchema = z.custom<InventoryRaw>(isRaw);
const requestSchema = z.object({ source: z.enum([...INVENTORY_COLLECTION_SOURCES, "catalogStart", "catalogEnd"]), endpoint: z.string().min(1).max(200), body: rawSchema }).strict();
const receiptSchema = z.object({
  request: requestSchema, requestHash: hash, responseCanonicalHash: hash,
  responseMetadata: rawSchema, dataMetadata: rawSchema.nullable(),
  httpStatus: z.literal(200), receivedAt: time, wireByteLength: z.number().int().positive().max(INVENTORY_COLLECTION_LIMITS.responseBytes),
  canonicalByteLength: z.number().int().positive().max(INVENTORY_COLLECTION_LIMITS.responseBytes),
  offset: count, count, sliceHash: hash,
}).strict();
export type InventoryCollectionReceipt = z.infer<typeof receiptSchema>;
const proofSchema = z.object({
  version: z.literal(INVENTORY_COLLECTION_VERSION), coverage: z.literal("advertised_api_full_pagination"),
  context: InventoryCollectionContextSchema, startedAt: time, capturedAt: time,
  catalogStart: z.array(rawSchema).min(1).max(INVENTORY_COLLECTION_LIMITS.sourceRows),
  catalogEnd: z.array(rawSchema).min(1).max(INVENTORY_COLLECTION_LIMITS.sourceRows), accountSourceVersion: hash,
  receipts: z.array(receiptSchema).min(10).max(INVENTORY_COLLECTION_LIMITS.receipts),
  sourceCounts: z.object({ warehouses: count, warehouse: count, fba: count, commodities: count, aux: count, auxParents: count, listings: count, shipping: count, shippingItems: count, details: count }).strict(),
  sourcesHash: hash, totalWireBytes: z.number().int().positive().max(INVENTORY_COLLECTION_LIMITS.totalResponseBytes),
  totalCanonicalBytes: z.number().int().positive().max(INVENTORY_COLLECTION_LIMITS.totalResponseBytes), proofHash: hash,
}).strict();
export type InventorySnapshotCollectionProof = z.infer<typeof proofSchema>;
export type InventorySnapshotCollection = { sources: CollectedInventorySources; proof: InventorySnapshotCollectionProof };

function identifier(value: unknown): string {
  if (typeof value === "string" && value.length <= 500 && value.trim() && value.trim() === value) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return fail("ROW_ID_INVALID");
}
function integer(value: unknown): number {
  const parsed = typeof value === "string" && /^(?:0|[1-9]\d{0,8})$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > INVENTORY_COLLECTION_LIMITS.sourceRows) return fail("PAGE_NUMBER_INVALID");
  return parsed;
}
function rowKey(source: InventoryCollectionRequestSource, row: InventoryRaw): string {
  if (source === "shipping" || source === "shippingItems") return identifier(row.shipSn);
  if (source === "fba") return JSON.stringify([identifier(row.id ?? row.shareKey), identifier(row.marketplaceId), identifier(row.asin), identifier(row.sku)]);
  if (source === "listings" && row.id === undefined) return JSON.stringify([identifier(row.marketplaceId), identifier(row.asin), identifier(row.sku), identifier(row.commodityId)]);
  return identifier(row.id);
}
function checkRows(source: InventoryCollectionRequestSource, values: InventoryRaw[]) {
  const seen = new Set<string>();
  for (const row of values) {
    if (!isRaw(row)) return fail("ROW_INVALID");
    const key = rowKey(source, row);
    if (seen.has(key)) return fail("DUPLICATE_SOURCE_ROW");
    seen.add(key);
    if (source === "catalogStart" || source === "catalogEnd") {
      // Preserve raw id/name/region and all additional supplier fields. Missing
      // labels remain unknown, never fabricated into authorization bindings.
      for (const field of ["name", "region"]) if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "string") return fail("CATALOG_INVALID");
    }
  }
}
function catalogHash(values: InventoryRaw[]) { checkRows("catalogStart", values); return inventoryCollectionHash([...values].sort((a, b) => { const left = identifier(a.id), right = identifier(b.id); return left < right ? -1 : left > right ? 1 : 0; })); }
function responseBody(receipt: InventoryCollectionReceipt, slice: InventoryRaw[]): InventoryRaw {
  if (Object.hasOwn(receipt.responseMetadata, "data") || receipt.responseMetadata.code !== 0) return fail("RESPONSE_METADATA_INVALID");
  let data: InventoryJson;
  if (receipt.request.source === "details") { if (receipt.dataMetadata !== null || slice.length !== 1) return fail("DETAIL_RESPONSE_INVALID"); data = slice[0]; }
  else if (receipt.request.source === "shippingItems") { if (receipt.dataMetadata !== null) return fail("SHIPPING_RESPONSE_INVALID"); data = slice; }
  else { if (!receipt.dataMetadata || Object.hasOwn(receipt.dataMetadata, "rows")) return fail("PAGE_METADATA_INVALID"); data = { ...receipt.dataMetadata, rows: slice }; }
  return { ...receipt.responseMetadata, data };
}
function makeReceipt(request: InventoryCollectionRequest, response: InventoryCollectionResponse, offset: number): { receipt: InventoryCollectionReceipt; rows: InventoryRaw[] } {
  inventoryCollectionCanonical(response, INVENTORY_COLLECTION_LIMITS.responseBytes + 1024);
  if (response.httpStatus !== 200 || !isRaw(response.body) || response.body.code !== 0 || !Number.isSafeInteger(response.wireByteLength) || response.wireByteLength < 1 || response.wireByteLength > INVENTORY_COLLECTION_LIMITS.responseBytes) return fail("RESPONSE_INVALID");
  const { data, ...responseMetadata } = response.body;
  let output: unknown, dataMetadata: InventoryRaw | null = null;
  if (request.source === "shippingItems") output = data;
  else if (request.source === "details") output = [data];
  else {
    if (!isRaw(data)) return fail("PAGE_RESPONSE_INVALID");
    const { rows, ...metadata } = data; output = rows; dataMetadata = metadata;
  }
  if (!Array.isArray(output) || output.some(row => !isRaw(row))) return fail("SOURCE_RESPONSE_INVALID");
  const values = output as InventoryRaw[], canonical = inventoryCollectionCanonical(response.body, INVENTORY_COLLECTION_LIMITS.responseBytes);
  const receipt = receiptSchema.parse({ request, requestHash: inventoryCollectionHash(request), responseCanonicalHash: SHA256(canonical).toString(), responseMetadata, dataMetadata,
    httpStatus: 200, receivedAt: response.receivedAt, wireByteLength: response.wireByteLength, canonicalByteLength: new TextEncoder().encode(canonical).byteLength,
    offset, count: values.length, sliceHash: inventoryCollectionHash(values) });
  return { receipt, rows: values };
}
function verifyPage(receipt: InventoryCollectionReceipt, total: number | null, offset: number): number {
  const source = receipt.request.source as PagedSource, pageNo = Math.floor(offset / INVENTORY_COLLECTION_LIMITS.pageSize) + 1;
  if (!same(receipt.request, inventoryCollectionPageRequest(source, pageNo)) || !receipt.dataMetadata) return fail("PAGE_REQUEST_MISMATCH");
  const currentTotal = integer(receipt.dataMetadata.totalSize);
  if (integer(receipt.dataMetadata.pageNo) !== pageNo || total !== null && total !== currentTotal || receipt.offset !== offset || receipt.count !== Math.min(INVENTORY_COLLECTION_LIMITS.pageSize, currentTotal - offset) || offset > currentTotal) return fail("PAGE_COVERAGE_INVALID");
  return currentTotal;
}
function validateSourceArrays(sources: CollectedInventorySources) {
  inventoryCollectionCanonical(sources, INVENTORY_COLLECTION_LIMITS.sourceBytes);
  // The existing parser imposes the unchanged 500k-node/8MiB source admission.
  if (inventoryJsonBytes(sources) > INVENTORY_READ_LIMITS.payloadBytes) return fail("SOURCE_BYTES_LIMIT");
  for (const source of INVENTORY_COLLECTION_SOURCES) checkRows(source, sources[source]);
  const requiredQuantity = (row: InventoryRaw, field: string) => {
    const value = row[field];
    if ((typeof value !== "number" && typeof value !== "string") || typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) return fail("REQUIRED_QUANTITY_INVALID");
    return Number(value);
  };
  for (const row of sources.warehouses) requiredQuantity(row, "type");
  for (const row of sources.warehouse) {
    for (const field of ["stockAllNum", "stockAvailable", "stockDefective", "stockOccupy", "stockWait", "stockPlan"]) requiredQuantity(row, field);
    if (Number(row.stockAllNum) !== Number(row.stockAvailable) + Number(row.stockDefective) + Number(row.stockOccupy)) return fail("REQUIRED_QUANTITY_TOTAL");
  }
  for (const row of sources.fba) {
    for (const field of ["available", "reservedTransfer", "reservedProcessing", "reservedCustomerorders", "unfulfillable", "research", "inTransit", "inboundShipped", "inboundReceiving", "totalInventory"]) requiredQuantity(row, field);
    if (Number(row.inTransit) !== Number(row.inboundShipped) + Number(row.inboundReceiving) || Number(row.totalInventory) !== Number(row.available) + Number(row.reservedTransfer) + Number(row.reservedProcessing) + Number(row.reservedCustomerorders) + Number(row.unfulfillable) + Number(row.research) + Number(row.inTransit)) return fail("REQUIRED_QUANTITY_TOTAL");
  }
  for (const row of sources.shippingItems) { if (!Array.isArray(row.items) || row.items.some(item => !isRaw(item))) return fail("SHIPPING_ITEMS_INVALID"); for (const item of row.items as InventoryRaw[]) requiredQuantity(item, "shipCount"); }
  for (const row of sources.details) if (!Array.isArray(row.commodityAux) || row.commodityAux.some(item => !isRaw(item))) return fail("DETAIL_LINKS_INVALID");
}

/** Replays proof over every original row. Hashes bind evidence; they are not a
 * signature or proof of trust in arbitrary client-supplied evidence. Only the
 * trusted server transport may create a publishable collection. */
export function validateInventorySnapshotCollection(value: unknown): InventorySnapshotCollection {
  inventoryCollectionCanonical(value);
  if (!isRaw(value) || Object.keys(value).sort().join(",") !== "proof,sources") return fail("STRUCTURE_INVALID");
  const sources = InventorySourcesSchema.extend({ auxParents: z.array(rawSchema).max(INVENTORY_COLLECTION_LIMITS.sourceRows) }).parse(value.sources) as CollectedInventorySources;
  const proof = proofSchema.parse(value.proof);
  inventoryCollectionCanonical(proof, INVENTORY_COLLECTION_LIMITS.proofBytes);
  validateSourceArrays(sources);
  if (proof.capturedAt < proof.startedAt || proof.sourcesHash !== inventoryCollectionHash(sources) || !same(proof.sourceCounts, Object.fromEntries(INVENTORY_COLLECTION_SOURCES.map(source => [source, sources[source].length])))) return fail("SOURCE_HASH_MISMATCH");
  if (catalogHash(proof.catalogStart) !== proof.accountSourceVersion || catalogHash(proof.catalogEnd) !== proof.accountSourceVersion) return fail("ACCOUNT_SOURCE_CHANGED");
  const { proofHash, ...unsigned } = proof;
  if (inventoryCollectionHash(unsigned) !== proofHash) return fail("PROOF_HASH_MISMATCH");
  let cursor = 0, lastAt = proof.startedAt, wireBytes = 0, canonicalBytes = 0;
  const take = (request: InventoryCollectionRequest, values: InventoryRaw[], offset: number, expectedCount?: number) => {
    const receipt = proof.receipts[cursor++];
    if (!receipt || !same(receipt.request, request) || receipt.requestHash !== inventoryCollectionHash(request) || receipt.offset !== offset || expectedCount !== undefined && receipt.count !== expectedCount || receipt.receivedAt < lastAt || receipt.receivedAt > proof.capturedAt) return fail("RECEIPT_SEQUENCE_INVALID");
    const slice = values.slice(offset, offset + receipt.count);
    if (slice.length !== receipt.count || receipt.sliceHash !== inventoryCollectionHash(slice)) return fail("SOURCE_SLICE_MISMATCH");
    const canonical = inventoryCollectionCanonical(responseBody(receipt, slice), INVENTORY_COLLECTION_LIMITS.responseBytes);
    if (receipt.responseCanonicalHash !== SHA256(canonical).toString() || receipt.canonicalByteLength !== new TextEncoder().encode(canonical).byteLength) return fail("RESPONSE_HASH_MISMATCH");
    lastAt = receipt.receivedAt; wireBytes += receipt.wireByteLength; canonicalBytes += receipt.canonicalByteLength;
    return receipt;
  };
  const pageAll = (source: PagedSource, values: InventoryRaw[]) => {
    checkRows(source, values); let offset = 0, total: number | null = null;
    do {
      const receipt = take(inventoryCollectionPageRequest(source, Math.floor(offset / INVENTORY_COLLECTION_LIMITS.pageSize) + 1), values, offset);
      total = verifyPage(receipt, total, offset); offset += receipt.count;
      if (total !== values.length) return fail("PAGE_TOTAL_MISMATCH");
    } while (offset < total);
  };
  pageAll("catalogStart", proof.catalogStart);
  for (const source of INVENTORY_COLLECTION_PAGED_SOURCES) pageAll(source, sources[source]);
  let shippingOffset = 0;
  for (let offset = 0; offset < sources.shipping.length; offset += INVENTORY_COLLECTION_LIMITS.shippingBatchSize) {
    const ids = sources.shipping.slice(offset, offset + INVENTORY_COLLECTION_LIMITS.shippingBatchSize).map(row => identifier(row.shipSn));
    const receipt = take(inventoryCollectionShippingRequest(ids), sources.shippingItems, shippingOffset, ids.length);
    const returned = sources.shippingItems.slice(shippingOffset, shippingOffset + receipt.count).map(row => identifier(row.shipSn));
    if (!same([...ids].sort(), [...returned].sort())) return fail("SHIPPING_COVERAGE_INVALID");
    shippingOffset += receipt.count;
  }
  if (shippingOffset !== sources.shippingItems.length) return fail("SHIPPING_COVERAGE_INVALID");
  for (let index = 0; index < sources.auxParents.length; index++) {
    const id = identifier(sources.auxParents[index].id); take(inventoryCollectionDetailRequest(id), sources.details, index, 1);
    if (identifier(sources.details[index].id) !== id) return fail("DETAIL_COVERAGE_INVALID");
  }
  if (sources.details.length !== sources.auxParents.length) return fail("DETAIL_COVERAGE_INVALID");
  pageAll("catalogEnd", proof.catalogEnd);
  if (cursor !== proof.receipts.length || wireBytes !== proof.totalWireBytes || canonicalBytes !== proof.totalCanonicalBytes) return fail("RECEIPT_TOTAL_MISMATCH");
  return { sources, proof };
}

/** Dependency-injected, sequential collector. It never makes network requests
 * itself, retries an operation, creates a task or writes a database. */
export async function collectInventorySnapshotSources(input: { context: InventoryCollectionContext; read: InventoryCollectionRead; now?: () => number; signal?: AbortSignal }): Promise<InventorySnapshotCollection> {
  inventoryCollectionCanonical(input.context);
  const context = InventoryCollectionContextSchema.parse(input.context), now = input.now ?? Date.now;
  const startedAt = time.parse(now()), receipts: InventoryCollectionReceipt[] = [];
  const sources: CollectedInventorySources = { warehouses: [], warehouse: [], fba: [], commodities: [], aux: [], auxParents: [], listings: [], shipping: [], shippingItems: [], details: [] };
  let totalWireBytes = 0, totalCanonicalBytes = 0, lastAt = startedAt, retainedBytes = 2;
  const checkAbort = () => { if (input.signal?.aborted) return fail("ABORTED"); };
  const read = async (request: InventoryCollectionRequest, offset: number) => {
    checkAbort();
    // Both arguments and returned bodies are copied so a transport cannot
    // mutate previously hashed evidence while a later asynchronous call waits.
    const response = await input.read(structuredClone(request)); checkAbort();
    const result = makeReceipt(request, response, offset);
    if (result.receipt.receivedAt < lastAt) return fail("TIME_ORDER_INVALID");
    lastAt = result.receipt.receivedAt; totalWireBytes += result.receipt.wireByteLength; totalCanonicalBytes += result.receipt.canonicalByteLength;
    if (totalWireBytes > INVENTORY_COLLECTION_LIMITS.totalResponseBytes || totalCanonicalBytes > INVENTORY_COLLECTION_LIMITS.totalResponseBytes || receipts.length >= INVENTORY_COLLECTION_LIMITS.receipts) return fail("RESPONSE_BUDGET_EXCEEDED");
    const copied = structuredClone(result); receipts.push(copied.receipt); return copied;
  };
  const pageAll = async (source: PagedSource): Promise<InventoryRaw[]> => {
    const values: InventoryRaw[] = []; let total: number | null = null;
    do {
      const result = await read(inventoryCollectionPageRequest(source, Math.floor(values.length / INVENTORY_COLLECTION_LIMITS.pageSize) + 1), values.length);
      total = verifyPage(result.receipt, total, values.length); values.push(...result.rows);
      checkRows(source, values);
      if (source !== "catalogStart" && source !== "catalogEnd") {
        retainedBytes += new TextEncoder().encode(inventoryCollectionCanonical(result.rows)).byteLength;
        if (retainedBytes > INVENTORY_COLLECTION_LIMITS.sourceBytes + INVENTORY_COLLECTION_LIMITS.receipts * 2) return fail("SOURCE_BYTES_LIMIT");
      }
    } while (values.length < total);
    return values;
  };
  const catalogStart = await pageAll("catalogStart");
  if (!catalogStart.length) return fail("EMPTY_ACCOUNT_CATALOG");
  for (const source of INVENTORY_COLLECTION_PAGED_SOURCES) sources[source] = await pageAll(source);
  for (let offset = 0; offset < sources.shipping.length; offset += INVENTORY_COLLECTION_LIMITS.shippingBatchSize) {
    const ids = sources.shipping.slice(offset, offset + INVENTORY_COLLECTION_LIMITS.shippingBatchSize).map(row => identifier(row.shipSn));
    const result = await read(inventoryCollectionShippingRequest(ids), sources.shippingItems.length);
    if (result.rows.length !== ids.length || !same(result.rows.map(row => identifier(row.shipSn)).sort(), [...ids].sort())) return fail("SHIPPING_COVERAGE_INVALID");
    sources.shippingItems.push(...result.rows); checkRows("shippingItems", sources.shippingItems);
  }
  for (const parent of sources.auxParents) {
    const id = identifier(parent.id), result = await read(inventoryCollectionDetailRequest(id), sources.details.length);
    if (result.rows.length !== 1 || identifier(result.rows[0].id) !== id) return fail("DETAIL_COVERAGE_INVALID");
    sources.details.push(result.rows[0]);
  }
  const catalogEnd = await pageAll("catalogEnd"), accountSourceVersion = catalogHash(catalogStart);
  if (catalogHash(catalogEnd) !== accountSourceVersion) return fail("ACCOUNT_SOURCE_CHANGED");
  const capturedAt = time.parse(now());
  if (capturedAt < lastAt) return fail("TIME_ORDER_INVALID");
  const unsigned = { version: INVENTORY_COLLECTION_VERSION, coverage: "advertised_api_full_pagination" as const, context, startedAt, capturedAt,
    catalogStart, catalogEnd, accountSourceVersion, receipts, sourceCounts: Object.fromEntries(INVENTORY_COLLECTION_SOURCES.map(source => [source, sources[source].length])),
    sourcesHash: inventoryCollectionHash(sources), totalWireBytes, totalCanonicalBytes };
  return validateInventorySnapshotCollection({ sources, proof: { ...unsigned, proofHash: inventoryCollectionHash(unsigned) } });
}

/** Publication reuses the existing mapper and its unchanged 8MiB budget. No
 * account/scope binding is inferred from a catalog or historical owner name. */
export function buildCollectedInventorySnapshot(input: { collection: InventorySnapshotCollection; scopeBindings?: InventoryScopeBinding[]; options?: InventoryMappingOptions }): { snapshot: InventoryCanonicalSnapshot; snapshotHash: string; proofHash: string } {
  const collection = validateInventorySnapshotCollection(input.collection);
  const snapshot = mapInventorySources({ sources: collection.sources, startedAt: collection.proof.startedAt, capturedAt: collection.proof.capturedAt, scopeBindings: input.scopeBindings, options: input.options });
  return { snapshot, snapshotHash: inventoryCollectionHash(snapshot), proofHash: collection.proof.proofHash };
}
