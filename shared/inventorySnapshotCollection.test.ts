import { describe, expect, it, vi } from "vitest";
import {
  INVENTORY_COLLECTION_LIMITS, INVENTORY_COLLECTION_SOURCES,
  buildCollectedInventorySnapshot, collectInventorySnapshotSources, inventoryCollectionCanonical,
  inventoryCollectionHash, inventoryCollectionPageRequest, inventoryCollectionShippingRequest,
  inventoryCollectionDetailRequest, validateInventorySnapshotCollection,
  type CollectedInventorySources, type InventoryCollectionRequest, type InventoryCollectionResponse,
  type InventorySnapshotCollection,
} from "./inventorySnapshotCollection";
import { parseInventorySnapshot } from "./inventorySnapshotRead";

const context = { workspaceId: 7, connectionVersion: "a".repeat(64), mappingVersion: "b".repeat(64) };
function originalSources(): CollectedInventorySources {
  return {
    warehouses: [{ id: "W", type: 1 }],
    warehouse: [{ id: "WH", warehouseId: "W", commodityId: "C", stockAllNum: 4, stockAvailable: 3, stockDefective: 0, stockOccupy: 1, stockWait: 2, stockPlan: 9, totalPurchase: null, onWayPurchase: 20, supplierRaw: "完整原文" }],
    fba: [{ id: "F", shareKey: "SHARED", marketplaceId: "ATVPDKIKX0DER", currency: "CNY", asin: "ASIN", sku: "SKU", commodityId: "C", available: 3, reservedTransfer: 1, reservedProcessing: 1, reservedCustomerorders: 1, unfulfillable: 1, research: 1, inTransit: 3, inboundShipped: 2, inboundReceiving: 1, totalInventory: 11, inboundWorking: null, purchaseCosts: null, invAge181To270Days: null, invAge271To365Days: 0, invAge365PlusDays: 0 }],
    commodities: [{ id: "C", sku: "LOCAL", name: "完整商品" }], aux: [{ id: "BOX", name: "包装" }], auxParents: [{ id: "C", relAuxFlag: true }],
    listings: [{ id: "L", commodityId: "C", asin: "ASIN", sku: "SKU", parentAsin: "PARENT", marketplaceId: "ATVPDKIKX0DER" }],
    shipping: [{ shipSn: "S", status: 3, restoreStock: 0, realShipTime: "2026-10-18" }],
    shippingItems: [{ shipSn: "S", items: [{ commodityId: "C", asin: "ASIN", sellerSku: "SKU", shipCount: 3 }] }],
    details: [{ id: "C", commodityAux: [], untouched: { original: true } }],
  };
}
function fixture() {
  const sources = originalSources(), catalog = [{ id: 7, name: "店铺", region: "NA", untouched: "原始目录" }];
  let tick = 1000;
  const respond = (request: InventoryCollectionRequest): InventoryCollectionResponse => {
    let data: unknown;
    if (request.source === "details") data = sources.details.find(row => String(row.id) === request.body.id);
    else if (request.source === "shippingItems") data = sources.shippingItems.filter(row => (request.body.shipSnList as string[]).includes(String(row.shipSn)));
    else {
      const values = request.source.startsWith("catalog") ? catalog : sources[request.source];
      const pageNo = Number(request.body.pageNo), pageSize = Number(request.body.pageSize);
      data = { rows: values.slice((pageNo - 1) * pageSize, pageNo * pageSize), pageNo, totalSize: values.length, preservedPageMetadata: "原页元信息" };
    }
    const body = { code: 0, message: "原始成功消息", supplierRequestId: `r${tick}`, data };
    return { httpStatus: 200, body, receivedAt: tick++, wireByteLength: Buffer.byteLength(JSON.stringify(body)) };
  };
  const read = vi.fn(async (request: InventoryCollectionRequest) => respond(request));
  return { sources, catalog, read, respond, run: () => collectInventorySnapshotSources({ context, read, now: () => tick++ }) };
}
function resign(value: InventorySnapshotCollection) {
  const { proofHash: _, ...unsigned } = value.proof;
  value.proof.proofHash = inventoryCollectionHash(unsigned); return value;
}

describe("complete advertised inventory collection proof", () => {
  it("collects all ten sources and both complete catalogs without losing original fields", async () => {
    const f = fixture(), value = await f.run();
    expect(value.sources).toEqual(f.sources);
    expect(Object.keys(value.sources).sort()).toEqual([...INVENTORY_COLLECTION_SOURCES].sort());
    expect(value.proof.coverage).toBe("advertised_api_full_pagination");
    expect(value.proof.context).toEqual(context);
    expect(value.proof.catalogStart).toEqual(f.catalog); expect(value.proof.catalogEnd).toEqual(f.catalog);
    expect(value.proof.receipts).toHaveLength(12);
    expect(value.proof.receipts.map(row => row.request.source)).toEqual(["catalogStart", "warehouses", "warehouse", "fba", "commodities", "aux", "auxParents", "listings", "shipping", "shippingItems", "details", "catalogEnd"]);
    expect(value.proof.receipts[0].responseMetadata).toMatchObject({ code: 0, message: "原始成功消息" });
    expect(value.proof.receipts[0].dataMetadata).toMatchObject({ preservedPageMetadata: "原页元信息" });
    expect(validateInventorySnapshotCollection(value)).toEqual(value);
  });
  it("preserves null money/age/planned components and leaves old reader coverage unchanged", async () => {
    const value = await fixture().run(), built = buildCollectedInventorySnapshot({ collection: value });
    expect(built.snapshot.mapping.sources).toEqual(value.sources);
    expect(built.snapshot.mapping.collectionCoverage).toBe("provided_arrays_not_collection_attested");
    expect(built.snapshot.rows.some(row => row.total.value === null)).toBe(true);
    expect(parseInventorySnapshot(built.snapshot).provenance.sourceCoverage).toBe("provided_arrays_not_collection_attested");
    expect(built.snapshotHash).toMatch(/^[a-f0-9]{64}$/u); expect(built.proofHash).toBe(value.proof.proofHash);
  });
  it("uses fixed unfiltred endpoint bodies including raw zero/deleted FBA and all auxiliary parents", () => {
    expect(inventoryCollectionPageRequest("fba", 1)).toEqual({ source: "fba", endpoint: "/api/inventoryManage/fba/pageList.json", body: { currency: "CNY", hideZero: "false", hideDeletedPrd: "false", needMergeShare: "true", history: "false", pageNo: "1", pageSize: "100" } });
    expect(inventoryCollectionPageRequest("auxParents", 2).body).toEqual({ isAllGroup: 1, relAuxFlag: 1, pageNo: "2", pageSize: "100" });
    expect(inventoryCollectionPageRequest("catalogStart", 2)).toMatchObject({ endpoint: "/api/shop/pageList.json", body: { pageNo: "2", pageSize: "100" } });
  });
  it("collects more than 100 catalog and source rows, including the last row", async () => {
    const f = fixture(); f.catalog.splice(0, 1, ...Array.from({ length: 201 }, (_, i) => ({ id: i + 1, name: `Shop ${i}`, region: "NA", untouched: "raw" })));
    f.sources.commodities = Array.from({ length: 101 }, (_, i) => ({ id: `C${i}` }));
    const value = await f.run();
    expect(value.proof.catalogStart).toHaveLength(201); expect(value.sources.commodities.at(-1)).toEqual({ id: "C100" });
    expect(value.proof.receipts.filter(row => row.request.source === "catalogStart")).toHaveLength(3);
    expect(value.proof.receipts.filter(row => row.request.source === "commodities")).toHaveLength(2);
  });
  it("fetches shipping in batches of 20 and every auxiliary parent detail", async () => {
    const f = fixture(); f.sources.shipping = Array.from({ length: 21 }, (_, i) => ({ shipSn: `S${i}` }));
    f.sources.shippingItems = f.sources.shipping.map(row => ({ shipSn: row.shipSn, items: [] })).reverse();
    f.sources.auxParents = [{ id: "C" }, { id: "D" }]; f.sources.details.push({ id: "D", commodityAux: [] });
    const result = await f.run(), shipping = result.proof.receipts.filter(row => row.request.source === "shippingItems");
    expect(shipping.map(row => row.count)).toEqual([20, 1]); expect(result.sources.shippingItems).toHaveLength(21);
    expect(result.sources.details.map(row => row.id)).toEqual(["C", "D"]);
  });
  it("empty individual endpoints retain explicit first-page zero receipts", async () => {
    const f = fixture(); for (const source of INVENTORY_COLLECTION_SOURCES) f.sources[source] = [];
    const result = await f.run(); expect(result.proof.receipts).toHaveLength(10); expect(result.proof.sourceCounts.fba).toBe(0);
    expect(() => buildCollectedInventorySnapshot({ collection: result })).toThrow("库存快照");
  });
  it("catalog ordering can differ, but its full original row content must agree", async () => {
    const f = fixture(); f.catalog.push({ id: 8, name: "二号", region: "NA", untouched: "second" });
    f.read.mockImplementation(async request => { const result = f.respond(request); if (request.source === "catalogEnd") (result.body as { data: { rows: unknown[] } }).data.rows.reverse(); return result; });
    expect((await f.run()).proof.accountSourceVersion).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("does not accept a caller's account list or verified flag", async () => {
    const f = fixture(); await expect(collectInventorySnapshotSources({ context: { ...context, verified: true, accountIds: [7] } as never, read: f.read })).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled();
  });
  it("copies retained originals before the next transport call can mutate them", async () => {
    const f = fixture(); f.read.mockImplementation(async request => { if (request.source === "catalogEnd") f.sources.fba[0].available = 999; return f.respond(request); });
    const result = await f.run(); expect(result.sources.fba[0].available).toBe(3);
  });
  it("accepts exactly 10000 source rows / 100 pages without silently truncating", async () => {
    const f = fixture(); f.sources.commodities = Array.from({ length: 10000 }, (_, i) => ({ id: `C${i}`, originalName: `原始${i}` }));
    const result = await f.run(); expect(result.sources.commodities).toHaveLength(10000);
    expect(result.sources.commodities.at(-1)?.originalName).toBe("原始9999");
    expect(result.proof.receipts.filter(row => row.request.source === "commodities")).toHaveLength(100);
  });
  it("accepts exact string page counters used by the supplier", async () => {
    const f = fixture(); f.read.mockImplementation(async request => { const response = f.respond(request); if (request.source !== "details" && request.source !== "shippingItems") { const data = (response.body as { data: Record<string, unknown> }).data; data.pageNo = String(data.pageNo); data.totalSize = String(data.totalSize); } return response; });
    expect((await f.run()).sources.fba).toHaveLength(1);
  });
});

describe("collection failures never yield publishable partial data", () => {
  it.each(["catalogStart", "catalogEnd"] as const)("rejects empty %s", async source => {
    const f = fixture(); f.read.mockImplementation(async request => { const result = f.respond(request); if (request.source === source) (result.body as { data: unknown }).data = { rows: [], totalSize: 0, pageNo: 1 }; return result; }); await expect(f.run()).rejects.toThrow();
  });
  it.each(["missing-id", "duplicate-id", "changed-label", "changed-id"])("rejects account catalog %s", async kind => {
    const f = fixture(); f.read.mockImplementation(async request => { const result = f.respond(request), data = (result.body as { data: { rows: unknown[]; totalSize: number } }).data;
      if (request.source === "catalogStart" && kind === "missing-id") data.rows = [{ name: "missing" }];
      if (request.source === "catalogStart" && kind === "duplicate-id") { data.rows = [f.catalog[0], f.catalog[0]]; data.totalSize = 2; }
      if (request.source === "catalogEnd" && kind === "changed-label") data.rows = [{ ...f.catalog[0], name: "changed" }];
      if (request.source === "catalogEnd" && kind === "changed-id") data.rows = [{ ...f.catalog[0], id: 8 }];
      return result; }); await expect(f.run()).rejects.toThrow();
  });
  it.each(["wrong-page", "changed-total", "missing-row", "repeated-row", "excess-total"])("rejects %s across pagination", async kind => {
    const f = fixture(); f.sources.commodities = Array.from({ length: 101 }, (_, i) => ({ id: String(i + 1) }));
    f.read.mockImplementation(async request => { const result = f.respond(request); if (request.source === "commodities" && request.body.pageNo === "2") {
      const data = (result.body as { data: { rows: unknown[]; pageNo: number; totalSize: number } }).data;
      if (kind === "wrong-page") data.pageNo = 1; if (kind === "changed-total") data.totalSize = 102; if (kind === "missing-row") data.rows = []; if (kind === "repeated-row") data.rows = [f.sources.commodities[0]]; if (kind === "excess-total") data.totalSize = 10001;
    } return result; }); await expect(f.run()).rejects.toThrow();
  });
  it.each([null, true, "", " ", -1, "1e3", "NaN", "Infinity"])("rejects unknown or malformed mandatory inventory quantity %j", async value => {
    const f = fixture(); f.sources.fba[0].available = value; await expect(f.run()).rejects.toThrow("REQUIRED_QUANTITY");
  });
  it.each(["fba", "warehouse"] as const)("rejects inconsistent %s total", async source => {
    const f = fixture(); f.sources[source][0][source === "fba" ? "totalInventory" : "stockAllNum"] = 999; await expect(f.run()).rejects.toThrow("REQUIRED_QUANTITY_TOTAL");
  });
  it("rejects missing shipment item batch and unknown shipCount", async () => {
    const f = fixture(); f.sources.shippingItems = []; await expect(f.run()).rejects.toThrow("SHIPPING_COVERAGE_INVALID");
    const next = fixture(); (next.sources.shippingItems[0].items as Record<string, unknown>[])[0].shipCount = null; await expect(next.run()).rejects.toThrow("REQUIRED_QUANTITY_INVALID");
  });
  it("rejects unexpected extra shipping batches or mismatched commodity detail", async () => {
    for (const source of ["shippingItems", "details"] as const) { const f = fixture(); f.read.mockImplementation(async request => { const response = f.respond(request); if (request.source === source) (response.body as { data: unknown }).data = source === "details" ? { id: "wrong", commodityAux: [] } : [{ shipSn: "wrong", items: [] }]; return response; }); await expect(f.run()).rejects.toThrow(); }
  });
  it.each(["http", "code", "wireBytes", "time", "nonfinite", "getter"])("rejects unsafe response %s", async kind => {
    const f = fixture(); f.read.mockImplementation(async request => { const result = f.respond(request); if (kind === "http") result.httpStatus = 503; if (kind === "code") (result.body as { code: number }).code = 40019; if (kind === "wireBytes") result.wireByteLength = INVENTORY_COLLECTION_LIMITS.responseBytes + 1; if (kind === "time") result.receivedAt = 0; if (kind === "nonfinite") (result.body as Record<string, unknown>).bad = NaN; if (kind === "getter") Object.defineProperty(result.body, "bad", { enumerable: true, get: () => { throw new Error("getter executed"); } }); return result; }); await expect(f.run()).rejects.toThrow();
  });
  it("aborts before making reads and after an in-flight read", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(); await expect(collectInventorySnapshotSources({ context, read: f.read, signal: controller.signal })).rejects.toThrow("ABORTED"); expect(f.read).not.toHaveBeenCalled();
    const other = new AbortController(); f.read.mockImplementation(async request => { other.abort(); return f.respond(request); }); await expect(collectInventorySnapshotSources({ context, read: f.read, signal: other.signal, now: () => 1 })).rejects.toThrow("ABORTED"); expect(f.read).toHaveBeenCalledTimes(1);
  });
  it("transport errors are not retried by the pure collector", async () => { const f = fixture(); f.read.mockRejectedValue(new Error("timeout")); await expect(f.run()).rejects.toThrow("timeout"); expect(f.read).toHaveBeenCalledTimes(1); });
  it("stops at cumulative wire budget even if each individual response is admitted", async () => {
    const f = fixture(); f.read.mockImplementation(async request => ({ ...f.respond(request), wireByteLength: INVENTORY_COLLECTION_LIMITS.responseBytes }));
    await expect(f.run()).rejects.toThrow("RESPONSE_BUDGET_EXCEEDED"); expect(f.read).toHaveBeenCalledTimes(5);
  });
  it("never labels canonical JSON hashes as hashes of original wire bytes", async () => {
    const f = fixture(); f.read.mockImplementation(async request => { const response = f.respond(request); response.wireByteLength += 200; return response; });
    const result = await f.run(); expect(result.proof.totalWireBytes).toBeGreaterThan(result.proof.totalCanonicalBytes);
    expect(Object.keys(result.proof.receipts[0])).toContain("responseCanonicalHash"); expect(Object.keys(result.proof.receipts[0])).not.toContain("rawResponseHash");
  });
  it.each([true, false, "", " ", "1e2", "01", -1, 1.1])("rejects ambiguous supplier page counters %j", async value => {
    const f = fixture(); f.read.mockImplementation(async request => { const response = f.respond(request); (response.body as { data: Record<string, unknown> }).data.totalSize = value; return response; }); await expect(f.run()).rejects.toThrow();
  });
});

describe("offline proof replay and bounded canonical values", () => {
  it.each(["context", "source", "receipt", "metadata", "catalog", "bytes"])("rejects un-rehashed %s tampering", async kind => {
    const v = await fixture().run(); if (kind === "context") v.proof.context.workspaceId = 8; if (kind === "source") v.sources.fba[0].available = 1; if (kind === "receipt") v.proof.receipts.pop(); if (kind === "metadata") v.proof.receipts[0].responseMetadata.message = "different"; if (kind === "catalog") v.proof.catalogEnd[0].name = "changed"; if (kind === "bytes") v.proof.totalWireBytes = 1;
    expect(() => validateInventorySnapshotCollection(v)).toThrow();
  });
  it.each(["wrong-endpoint", "filtered-request", "wrong-request-hash", "wrong-response-hash", "wrong-slice-hash", "missing-page", "reordered-page", "extra-page", "wrong-total", "wrong-count", "wrong-offset", "wrong-time", "wrong-byte-sum", "hidden-data"])("rejects rehashed structural proof attack %s", async kind => {
    const v = await fixture().run(), first = v.proof.receipts[0];
    if (kind === "wrong-endpoint") first.request.endpoint = "/evil";
    if (kind === "filtered-request") first.request.body.parentAsin = "FILTER";
    if (kind === "wrong-request-hash") first.requestHash = "c".repeat(64);
    if (kind === "wrong-response-hash") first.responseCanonicalHash = "c".repeat(64);
    if (kind === "wrong-slice-hash") first.sliceHash = "c".repeat(64);
    if (kind === "missing-page") v.proof.receipts.splice(2, 1);
    if (kind === "reordered-page") [v.proof.receipts[0], v.proof.receipts[1]] = [v.proof.receipts[1], v.proof.receipts[0]];
    if (kind === "extra-page") v.proof.receipts.push(structuredClone(first));
    if (kind === "wrong-total") first.dataMetadata!.totalSize = 2;
    if (kind === "wrong-count") first.count = 0;
    if (kind === "wrong-offset") first.offset = 1;
    if (kind === "wrong-time") first.receivedAt = 0;
    if (kind === "wrong-byte-sum") v.proof.totalWireBytes++;
    if (kind === "hidden-data") first.responseMetadata.data = [];
    expect(() => validateInventorySnapshotCollection(resign(v))).toThrow();
  });
  it("hash is object-order invariant but preserves source array order and null", () => {
    expect(inventoryCollectionHash({ b: 2, a: 1 })).toBe(inventoryCollectionHash({ a: 1, b: 2 }));
    expect(inventoryCollectionHash([1, 2])).not.toBe(inventoryCollectionHash([2, 1]));
    expect(inventoryCollectionHash({ a: null })).not.toBe(inventoryCollectionHash({ a: 0 }));
  });
  it.each([new Date(), NaN, Infinity, undefined, { a: undefined }, [, 1], Object.create({ a: 1 }), "\ud800"])("rejects noncanonical JSON %j", value => expect(() => inventoryCollectionCanonical(value)).toThrow());
  it("rejects a getter without evaluating it", () => { let touched = false; const value = { get secret() { touched = true; return "secret"; } }; expect(() => inventoryCollectionCanonical(value)).toThrow(); expect(touched).toBe(false); });
  it.each([Infinity, NaN, -1, 0, 1.5, INVENTORY_COLLECTION_LIMITS.collectionBytes + 1])("cannot disable budgets with %j", bytes => expect(() => inventoryCollectionCanonical({}, bytes)).toThrow());
  it("rejects oversized strings/body and illegal request sizes", () => {
    expect(() => inventoryCollectionCanonical("x".repeat(32769))).toThrow();
    expect(() => inventoryCollectionCanonical({ rows: Array.from({ length: 200 }, () => "x".repeat(32768)) }, INVENTORY_COLLECTION_LIMITS.responseBytes)).toThrow("BYTES_LIMIT");
    expect(() => inventoryCollectionPageRequest("fba", 101)).toThrow(); expect(() => inventoryCollectionShippingRequest([])).toThrow(); expect(() => inventoryCollectionShippingRequest(["S", "S"])).toThrow(); expect(() => inventoryCollectionDetailRequest("")).toThrow();
  });
  it("full source and snapshot budgets remain the original reader limits", async () => {
    const v = await fixture().run(); v.sources.commodities = Array.from({ length: 300 }, (_, i) => ({ id: String(i), raw: "x".repeat(30000) }));
    v.proof.sourcesHash = inventoryCollectionHash(v.sources); v.proof.sourceCounts.commodities = 300;
    expect(() => validateInventorySnapshotCollection(resign(v))).toThrow("BYTES_LIMIT");
  });
  it.each(INVENTORY_COLLECTION_SOURCES)("missing original %s source is never substituted by an empty array", async source => {
    const v = await fixture().run(); delete (v.sources as Partial<CollectedInventorySources>)[source]; expect(() => validateInventorySnapshotCollection(v)).toThrow();
  });
  it("publication still rejects unapproved phantom source scope bindings", async () => {
    const collection = await fixture().run(); expect(() => buildCollectedInventorySnapshot({ collection, scopeBindings: [{ ref: { source: "fba", index: 0, id: "F" }, scope: { parentAsin: "P", storeName: "Store", country: "US", accountId: "7" }, mappingId: "x", kind: "explicit_confirmed_field_mapping", fields: { parentAsin: "parent", storeName: "store", country: "country", accountId: "account" } }] })).toThrow();
  });
});
