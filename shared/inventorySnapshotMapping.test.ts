import { describe, expect, it } from "vitest";
import { mapInventorySources, InventorySnapshotReadError, INVENTORY_SOURCE_KEYS, type InventorySources, type InventoryRaw, type InventoryScopeBinding, type InventorySourceKey } from "./inventorySnapshotMapping";
import { inventorySnapshotTotals, inventorySnapshotGroups, inventoryAgeQuantity, parseInventorySnapshot, planInventoryScopeAccess } from "./inventorySnapshotRead";

const scope = { parentAsin: "PARENT", storeName: "Store", country: "US", accountId: "A1" };
function metadata(extra: InventoryRaw = {}): InventoryRaw { return { parent: "PARENT", store: "Store", country: "US", account: "A1", devList: [{ devName: "Owner" }], ...extra }; }
function fba(extra: InventoryRaw = {}): InventoryRaw { return { id: 1, shareKey: "shared", marketplaceId: "ATVPDKIKX0DER", currency: "CNY", asin: "A", sku: "M1", commodityId: "1", available: 5, reservedTransfer: 1, reservedProcessing: 1, reservedCustomerorders: 1, unfulfillable: 1, research: 1, inTransit: 4, inboundShipped: 3, inboundReceiving: 1, inboundWorking: 100, totalInventory: 14, purchaseCosts: 140, invAge181To270Days: 2, invAge271To365Days: 3, invAge365PlusDays: 1, snapshotDate: "2026-10-10", ...metadata(), ...extra }; }
function warehouse(extra: InventoryRaw = {}): InventoryRaw { return { id: 10, commodityId: "1", commoditySku: "LOCAL", warehouseId: "1", stockAvailable: 10, stockOccupy: 2, stockDefective: 1, stockAllNum: 13, stockWait: 7, stockPlan: 100, totalPurchase: 130, onWayPurchase: 70, paid: 1, ...metadata(), ...extra }; }
function listing(extra: InventoryRaw = {}): InventoryRaw { return { id: 20, commodityId: "1", commoditySku: "LOCAL", commodityName: "Product", asin: "A", sku: "M1", parentAsin: "PARENT", marketplaceId: "ATVPDKIKX0DER", ...metadata(), ...extra }; }
function sources(): InventorySources { return { warehouses: [{ id: "1", type: 1 }], warehouse: [], fba: [fba()], commodities: [{ id: "1", name: "Product", sku: "LOCAL" }], aux: [], listings: [listing()], shipping: [], shippingItems: [], details: [] }; }
function binding(d: InventorySources, source: InventorySourceKey, index = 0): InventoryScopeBinding {
  const raw = d[source]![index];
  return { ref: { source, index, id: String(raw.id ?? raw.shipSn ?? "") || null }, kind: "explicit_confirmed_field_mapping", mappingId: "synthetic-v1", fields: { parentAsin: "parent", storeName: "store", country: "country", accountId: "account" }, scope: { parentAsin: String(raw.parent), storeName: String(raw.store), country: String(raw.country), accountId: String(raw.account) } };
}
const map = (d = sources(), scopeBindings: InventoryScopeBinding[] = []) => mapInventorySources({ sources: d, startedAt: 1, capturedAt: 2, scopeBindings });

describe("complete nine-source inventory mapping", () => {
  it("retains original arrays and full FBA components with CNY procurement values", () => {
    const d = sources(), result = map(d, [binding(d, "fba"), binding(d, "listings")]);
    expect(result.mapping.sources).toEqual(d);
    expect(result.mapping.collectionCoverage).toBe("provided_arrays_not_collection_attested");
    expect(result.rows[0]).toMatchObject({ scopeStatus: "verified", scopes: [scope], shipping: { quantity: 4, value: 40 }, fba: { quantity: 10, value: 100 }, total: { quantity: 14, value: 140 }, ownerEvidence: { status: "complete", names: ["Owner"] } });
    expect(result.rows[0].fbaComponents[0]).toMatchObject({ inboundWorking: 100, inboundShipped: 3, inboundReceiving: 1, refs: [{ source: "fba", index: 0, id: "1" }] });
    expect(inventorySnapshotTotals(result.rows).inboundWorking).toBe(100);
  });
  it.each(INVENTORY_SOURCE_KEYS)("rejects missing required %s source instead of substituting []", key => {
    const d = sources(); delete (d as Partial<InventorySources>)[key]; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("keeps the complete source count including optional auxParents", () => {
    const d = sources(); d.auxParents = []; expect(map(d).sourceCounts).toEqual(Object.fromEntries(Object.entries(d).map(([key, values]) => [key, values.length])));
  });
  it.each([true, false, "", " ", "0x5", "1e3", "NaN", "Infinity", -1, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe/ambiguous quantity %j", value => {
    const d = sources(); d.fba[0].available = value; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("accepts exact decimal string quantities but never boolean coercion", () => {
    const d = sources(); d.fba[0].available = "5.0"; expect(map(d).rows[0].fba.quantity).toBe(10);
  });
  it.each(["available", "reservedTransfer", "reservedProcessing", "reservedCustomerorders", "unfulfillable", "research", "inTransit", "inboundShipped", "inboundReceiving", "totalInventory"])("validates second-copy %s before deduplication", field => {
    const d = sources(); d.fba.push(fba({ id: 2, [field]: null })); expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("rejects shared copies with different components even when both totals are valid", () => {
    const d = sources(); d.fba.push(fba({ id: 2, available: 6, reservedTransfer: 0 })); expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it.each([{ purchaseCosts: 141 }, { invAge181To270Days: null }, { invAge181To270Days: 0 }, { inboundWorking: 99 }, { snapshotDate: "2026-10-11" }])("rejects contradictory shared money/age/planned evidence %j", patch => {
    const d = sources(); d.fba.push(fba({ id: 2, ...patch })); expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("does not collapse unknown age and explicit zero in shared signatures", () => {
    const d = sources(); d.fba = [fba({ invAge181To270Days: 0 }), fba({ id: 2, invAge181To270Days: null })]; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("deduplicates identical same-account NA copies and preserves all scopes and references", () => {
    const d = sources(); d.fba.push(fba({ id: 2, marketplaceId: "A2EUQ1WTGCTBG2", country: "CA" }));
    const result = map(d, [binding(d, "fba"), binding(d, "fba", 1)]);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].total.quantity).toBe(14);
    expect(result.rows[0].scopes.map(value => value.country)).toEqual(["US", "CA"]);
    expect(result.rows[0].fbaComponents[0].refs).toHaveLength(2);
    expect(planInventoryScopeAccess(parseInventorySnapshot(result), scope).requiredRows[0].scopes).toHaveLength(2);
  });
  it("rejects a shared key across accounts rather than silently duplicating or merging pools", () => {
    const d = sources(); d.fba.push(fba({ id: 2, account: "A2" })); expect(() => map(d, [binding(d, "fba"), binding(d, "fba", 1)])).toThrow(InventorySnapshotReadError);
  });
  it("also refuses known/unknown account mixtures for the same shared key", () => {
    const d = sources(); d.fba.push(fba({ id: 2 })); expect(() => map(d, [binding(d, "fba")])).toThrow(InventorySnapshotReadError);
  });
  it("keeps different proven account pools with different share keys separate", () => {
    const d = sources(); d.fba.push(fba({ id: 2, shareKey: "other", account: "A2" })); const result = map(d, [binding(d, "fba"), binding(d, "fba", 1)]);
    expect(inventorySnapshotGroups(result.rows, 180)).toHaveLength(2); expect(inventorySnapshotTotals(result.rows).total.quantity).toBe(28);
  });
  it("excludes non-North-American FBA without changing the supplied original arrays", () => {
    const d = sources(); d.fba.push(fba({ id: 2, shareKey: "BR", marketplaceId: "A2Q3Y263D00KWC" })); const result = map(d);
    expect(result.mapping.sources.fba).toHaveLength(2); expect(result.rows).toHaveLength(1); expect(result.warnings.join(" ")).toContain("排除非北美");
  });
  it("does not infer US or account from an unbound platform row", () => {
    const result = map(); expect(result.rows[0].scopeStatus).toBe("unknown"); expect(result.rows[0].scopes).toEqual([]);
    expect(planInventoryScopeAccess(parseInventorySnapshot(result), scope).scopeVerifiable).toBe(false);
  });
  it.each(["parentAsin", "storeName", "country", "accountId"] as const)("rejects invented binding %s not equal to original field", key => {
    const d = sources(), value = binding(d, "fba"); value.scope[key] = "invented"; expect(() => map(d, [value])).toThrow(InventorySnapshotReadError);
  });
  it("rejects country contradictory to explicit marketplace identity", () => {
    const d = sources(); d.fba[0].country = "CA"; expect(() => map(d, [binding(d, "fba")])).toThrow(InventorySnapshotReadError);
  });
  it("requires exact source row ref and own fields, not prototype names", () => {
    const d = sources(), wrongId = binding(d, "fba"), inherited = binding(d, "fba"); wrongId.ref.id = "2"; inherited.fields.accountId = "constructor";
    expect(() => map(d, [wrongId])).toThrow(); expect(() => map(d, [inherited])).toThrow(); expect(() => map(d, [binding(d, "fba"), binding(d, "fba")])).toThrow();
  });
  it("does not import another account's listing metadata or source ref", () => {
    const d = sources(); d.listings[0] = listing({ account: "OTHER", commodityName: "SECRET", parentAsin: "PRIVATE" });
    const result = map(d, [binding(d, "fba"), binding(d, "listings")]);
    expect(result.rows[0].name).not.toBe("SECRET"); expect(result.rows[0].parentAsin).toBe("PARENT"); expect(result.rows[0].sourceRefs.some(value => value.source === "listings")).toBe(false);
  });
  it("does not silently overwrite conflicting parent identity from a same-account listing", () => {
    const d = sources(); d.listings[0] = listing({ parent: "OTHER", parentAsin: "OTHER", commodityName: "OTHER SECRET" });
    const result = map(d, [binding(d, "fba"), binding(d, "listings")]);
    expect(result.rows[0].parentAsin).toBe("PARENT"); expect(result.rows[0].name).not.toBe("OTHER SECRET"); expect(result.rows[0].sourceRefs.some(value => value.source === "listings")).toBe(false);
  });
  it.each([false, true])("does not attach cross-account commodity labels with binding=%s", withBinding => {
    const d = sources(); d.listings = []; d.commodities = [{ id: "1", sku: "SECRET_SKU", name: "SECRET_NAME", ...metadata({ account: "OTHER", store: "OTHER", country: "CA", parent: "OTHER" }) }];
    const result = map(d, [binding(d, "fba"), ...withBinding ? [binding(d, "commodities")] : []]);
    expect(result.rows[0].scopeStatus).toBe("verified"); expect(JSON.stringify(result.rows)).not.toContain("SECRET"); expect(result.rows[0].sourceRefs.some(value => value.source === "commodities")).toBe(false);
  });
  it("retains same-scope catalog labels with their original metadata reference", () => {
    const d = sources(); d.listings = []; d.commodities[0] = { ...d.commodities[0], ...metadata() };
    const result = map(d, [binding(d, "fba"), binding(d, "commodities")]); expect(result.rows[0].name).toBe("Product"); expect(result.rows[0].sourceRefs).toContainEqual({ source: "commodities", index: 0, id: "1" });
  });
  it("does not attach unbound or cross-account auxiliary catalog labels to verified stock", () => {
    const d = sources(); d.fba = []; d.listings = []; d.aux = [{ id: "BOX", name: "SECRET_BOX", sku: "SECRET_SKU", ...metadata({ account: "OTHER" }) }]; d.warehouse = [warehouse({ commodityId: "BOX" })];
    for (const bound of [false, true]) {
      const result = map(d, [binding(d, "warehouse"), ...bound ? [binding(d, "aux")] : []]); expect(result.rows[0].scopeStatus).toBe("verified"); expect(JSON.stringify(result.rows)).not.toContain("SECRET"); expect(result.rows[0].sourceRefs.some(value => value.source === "aux")).toBe(false);
    }
  });
});

describe("inventory quantities, age, procurement and shared accessories", () => {
  it("keeps planned quantities separate and uses procurement value rather than payments", () => {
    const d = sources(); d.fba = []; d.warehouse = [warehouse()];
    const result = map(d); expect(result.rows[0]).toMatchObject({ plan: 100, domestic: { quantity: 13, value: 130 }, purchase: { quantity: 7, value: 70 }, total: { quantity: 20, value: 200 }, ageStatus: "not_applicable" });
  });
  it("missing procurement values remain unknown, including zero quantities", () => {
    const d = sources(); d.fba[0].purchaseCosts = null; const row = map(d).rows[0]; expect(row.shipping.value).toBeNull(); expect(row.fba.value).toBeNull(); expect(row.total.value).toBeNull();
    d.fba = []; d.warehouse = [warehouse({ stockWait: 0, onWayPurchase: null })]; expect(map(d).rows[0].purchase.value).toBeNull();
  });
  it("keeps zero realtime stock with old positive age", () => {
    const d = sources(); d.fba = [fba({ available: 0, reservedTransfer: 0, reservedProcessing: 0, reservedCustomerorders: 0, unfulfillable: 0, research: 0, inTransit: 0, inboundShipped: 0, inboundReceiving: 0, inboundWorking: 0, totalInventory: 0, purchaseCosts: 0 })];
    const result = map(d); expect(result.rows[0].total.quantity).toBe(0); expect(inventoryAgeQuantity(result.rows[0])).toBe(6); expect(result.rows[0].notes.join(" ")).toContain("更新时间不同");
  });
  it("keeps zero realtime stock with unknown age instead of reporting no aged inventory", () => {
    const d = sources(); d.fba = [fba({ available: 0, reservedTransfer: 0, reservedProcessing: 0, reservedCustomerorders: 0, unfulfillable: 0, research: 0, inTransit: 0, inboundShipped: 0, inboundReceiving: 0, inboundWorking: 0, totalInventory: 0, purchaseCosts: 0, invAge181To270Days: null, invAge271To365Days: null, invAge365PlusDays: null })];
    const result = map(d); expect(result.rows).toHaveLength(1); expect(result.rows[0].ageStatus).toBe("unknown"); expect(inventoryAgeQuantity(result.rows[0])).toBeNull();
  });
  it("does not let non-FBA domestic rows invalidate a parent with complete FBA age", () => {
    const d = sources(); d.warehouse = [warehouse()]; const result = map(d, [binding(d, "fba"), binding(d, "warehouse"), binding(d, "listings")]);
    const groups = inventorySnapshotGroups(result.rows, 180); expect(groups).toHaveLength(1); expect(groups[0].aged).toBe(6); expect(groups[0].rows.map(row => row.ageStatus)).toContain("not_applicable");
  });
  it("rejects fully empty inputs without pretending zero was a successful refresh", () => {
    const d = sources(); d.fba = []; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("keeps multi-MSKU inventory independent by default", () => {
    const d = sources(); d.fba = []; d.warehouse = [warehouse()]; d.listings.push(listing({ id: 21, asin: "B", sku: "M2" })); const result = map(d);
    expect(result.rows[0]).toMatchObject({ asin: "", msku: "", unpaired: true, total: { quantity: 20, value: 200 } });
  });
  it("does not use an unmatched-account listing as a unique domestic candidate", () => {
    const d = sources(); d.fba = []; d.warehouse = [warehouse()]; d.listings[0] = listing({ account: "OTHER" }); const result = map(d, [binding(d, "warehouse"), binding(d, "listings")]);
    expect(result.rows[0].msku).toBe(""); expect(result.rows[0].scopeStatus).toBe("verified"); expect(result.rows[0].scopes[0].accountId).toBe("A1");
  });
  it("requires actual-shipment item batches even when latest-allocation rule is off", () => {
    const d = sources(); d.shipping = [{ shipSn: "S", status: 3, restoreStock: 0, realShipTime: "2026-10-01" }]; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("requires auxParents to have complete details", () => {
    const d = sources(); d.auxParents = [{ id: "1" }]; expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("deduplicates shared accessories independently and rejects conflicting metadata", () => {
    const d = sources(); d.fba.push(fba({ id: 2, shareKey: "second", asin: "B", sku: "M2" })); d.aux = [{ id: "BOX", sku: "BOX", name: "Box" }]; d.warehouse = [warehouse({ id: 12, commodityId: "BOX", stockPlan: 0 })]; d.details = [{ id: "1", commodityAux: [{ auxId: "BOX" }] }];
    const result = map(d), totals = inventorySnapshotTotals(result.rows); expect(totals.total.quantity).toBe(28); expect(totals.aux).toEqual({ quantity: 20, value: 200 });
    expect(result.rows.filter(row => row.aux.length)).toHaveLength(2);
    d.aux.push({ id: "BOX", sku: "DIFFERENT", name: "Box" }); expect(() => map(d)).toThrow(InventorySnapshotReadError);
  });
  it("requires explicit approval AND same-scope shipment evidence before latest allocation", () => {
    const d = sources(); d.fba = []; d.warehouse = [warehouse()]; d.listings.push(listing({ id: 21, asin: "B", sku: "M2" }));
    d.shipping = [{ shipSn: "S1", status: 3, restoreStock: 0, realShipTime: "2026-10-01", ...metadata() }, { shipSn: "S2", status: 3, restoreStock: 0, realShipTime: "2026-10-03", ...metadata() }];
    d.shippingItems = [{ shipSn: "S1", items: [{ commodityId: "1", asin: "A", sellerSku: "M1", shipCount: 1 }], ...metadata() }, { shipSn: "S2", items: [{ commodityId: "1", asin: "B", sellerSku: "M2", shipCount: 1 }], ...metadata() }];
    const bound = [binding(d, "warehouse"), binding(d, "listings"), binding(d, "listings", 1), binding(d, "shipping"), binding(d, "shipping", 1), binding(d, "shippingItems"), binding(d, "shippingItems", 1)];
    expect(map(d, bound).rows[0].msku).toBe("");
    const approved = mapInventorySources({ sources: d, startedAt: 1, capturedAt: 2, scopeBindings: bound, options: { latestShipmentAllocation: { approved: true, approvalRef: "approved-fixture" } } }); expect(approved.rows[0].msku).toBe("M2");
    expect(approved.rows[0].allocationEvidence).toEqual({ kind: "approved_latest_actual_shipment", approvalRef: "approved-fixture", scope, shipDate: "2026-10-03", itemIndex: 0, shipmentRef: { source: "shipping", index: 1, id: "S2" }, itemBatchRef: { source: "shippingItems", index: 1, id: "S2" } });
    expect(approved.rows[0].sourceRefs).toContainEqual({ source: "shippingItems", index: 1, id: "S2" });
    d.shipping[1].account = "OTHER"; d.shippingItems[1].account = "OTHER";
    const changed = bound.map(value => binding(d, value.ref.source, value.ref.index));
    const isolated = mapInventorySources({ sources: d, startedAt: 1, capturedAt: 2, scopeBindings: changed, options: { latestShipmentAllocation: { approved: true, approvalRef: "approved-fixture" } } }); expect(isolated.rows[0].msku).toBe("M1");
    const noScope = mapInventorySources({ sources: d, startedAt: 1, capturedAt: 2, options: { latestShipmentAllocation: { approved: true, approvalRef: "approved-fixture" } } }); expect(noScope.rows[0].msku).toBe("");
  });
  it.each(["parent", "store", "country", "account"])("rejects shipment item %s contradictory to its explicit header/batch mapping", field => {
    const d = sources(); d.fba = []; d.warehouse = [warehouse()]; d.listings.push(listing({ id: 21, asin: "B", sku: "M2" }));
    d.shipping = [{ shipSn: "S", status: 3, restoreStock: 0, realShipTime: "2026-10-03", ...metadata() }];
    d.shippingItems = [{ shipSn: "S", items: [{ commodityId: "1", asin: "B", sellerSku: "M2", shipCount: 1, [field]: "OTHER" }], ...metadata() }];
    const bound = [binding(d, "warehouse"), binding(d, "listings"), binding(d, "listings", 1), binding(d, "shipping"), binding(d, "shippingItems")];
    expect(() => mapInventorySources({ sources: d, startedAt: 1, capturedAt: 2, scopeBindings: bound, options: { latestShipmentAllocation: { approved: true, approvalRef: "approved-fixture" } } })).toThrow(InventorySnapshotReadError);
  });
});
