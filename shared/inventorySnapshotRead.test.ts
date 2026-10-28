import { describe, expect, it } from "vitest";
import "./inventorySnapshotMapping.test";
import { INVENTORY_SOURCE_KEYS, INVENTORY_READ_LIMITS, InventorySnapshotReadError, InventorySnapshotReadInputSchema, InventorySnapshotReadResultSchema, parseInventorySnapshot, mapInventorySources, planInventoryScopeAccess, buildInventorySnapshotReadResult, buildInventorySnapshotReadFailure, inventorySnapshotTotals, parseInventoryJson, inventoryJsonBytes, type InventorySources, type InventoryScopeBinding, type InventorySnapshotReadInput, type InventoryRaw, type InventoryReadRow } from "./inventorySnapshotRead";

const identity = { userId: 7, workspaceId: 11 };
const scope = { parentAsin: "P", storeName: "Store", country: "US", accountId: "A1" };
const input: InventorySnapshotReadInput = { expectedWorkspaceId: 11, search: "", unpaired: false, ageThreshold: 180, groupOffset: 0, groupLimit: 20, agedGroupOffset: 0, agedGroupLimit: 20 };
const zero = () => ({ quantity: 0, value: 0 });
function oldRow(id = "old", overrides: Record<string, unknown> = {}) {
  return { id, commodityId: "C", parentAsin: "P", parentName: "Parent", asin: id, msku: `M-${id}`, localSku: "LOCAL", name: "Name", ownerIds: [7], operator: "historical-owner", unpaired: false, allocation: "old", lastShipment: null, plan: 0, domestic: zero(), purchase: zero(), shipping: zero(), fba: { quantity: 10, value: 100 }, total: { quantity: 10, value: 100 }, aux: [], notes: [], age: { days181To270: 1, days271To365: 2, days365Plus: 3, dates: ["2026-10-10"] }, ...overrides };
}
function legacy(rows = [oldRow()]) { return { version: 1, currency: "CNY", startedAt: 1, capturedAt: 2, rows, warnings: ["FULL-WORKSPACE-WARNING"], sourceCounts: Object.fromEntries(INVENTORY_SOURCE_KEYS.map(key => [key, 1])) }; }
function canonical(options: Array<{ parent?: string; account?: string; id?: number; age?: number | null; quantity?: number }> = [{}]) {
  const sources: InventorySources = { warehouses: [], warehouse: [], fba: [], commodities: [], aux: [], listings: [], shipping: [], shippingItems: [], details: [] }, scopeBindings: InventoryScopeBinding[] = [];
  options.forEach((option, index) => {
    const row: InventoryRaw = { id: option.id ?? index + 1, shareKey: `pool${index}`, asin: `A${index}`, sku: `M${index}`, commodityId: `${index}`, marketplaceId: "ATVPDKIKX0DER", currency: "CNY", available: option.quantity ?? 10, reservedTransfer: 0, reservedProcessing: 0, reservedCustomerorders: 0, unfulfillable: 0, research: 0, inTransit: 0, inboundShipped: 0, inboundReceiving: 0, inboundWorking: 0, totalInventory: option.quantity ?? 10, purchaseCosts: (option.quantity ?? 10) * 10, invAge181To270Days: option.age === undefined ? 1 : option.age, invAge271To365Days: 0, invAge365PlusDays: 0, snapshotDate: "2026-10-10", parent: option.parent ?? "P", store: "Store", country: "US", account: option.account ?? "A1", devList: [{ devName: "Owner" }] };
    sources.fba.push(row); scopeBindings.push({ ref: { source: "fba", index, id: String(row.id) }, fields: { parentAsin: "parent", storeName: "store", country: "country", accountId: "account" }, scope: { parentAsin: String(row.parent), storeName: "Store", country: "US", accountId: String(row.account) }, kind: "explicit_confirmed_field_mapping", mappingId: "synthetic" });
  });
  return mapInventorySources({ sources, scopeBindings, startedAt: 1, capturedAt: 2 });
}
const record = (payload: unknown) => ({ id: 20, workspaceId: 11, runId: 30, capturedAt: 2, payload });
const build = (payload: unknown = legacy(), request: InventorySnapshotReadInput = input) => buildInventorySnapshotReadResult({ identity, input: request, record: record(payload) });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("inventory snapshot readonly contracts and legacy fidelity", () => {
  it("attention filters use the same stock and calculate totals before pagination", () => {
    const payload=legacy([
      oldRow("domestic", { fba:zero(), domestic:{quantity:3,value:30},total:{quantity:3,value:30} }),
      oldRow("unpriced", { fba:{quantity:5,value:null},total:{quantity:5,value:null} }),
      oldRow("empty", { fba:zero(),total:zero() }),
      oldRow("regular"),
    ]);
    const emptyFba=build(payload,{...input,attention:"fba_empty"});
    expect(emptyFba.groups.flatMap(group=>group.rows.map(row=>row.asin))).toEqual(["domestic"]);
    expect(emptyFba.totals?.total.quantity).toBe(3);
    const unpriced=build(payload,{...input,attention:"valuation_missing"});
    expect(unpriced.groups.flatMap(group=>group.rows.map(row=>row.asin))).toEqual(["unpriced"]);
    expect(unpriced.totals?.total.value).toBeNull();
    expect(build(payload).totals?.total.quantity).toBe(18);
  });
  it("preserves complete legacy values, but never fabricates scopes, components or current owner authority", () => {
    const parsed = parseInventorySnapshot(legacy());
    expect(parsed.provenance.status).toBe("legacy_unverifiable");
    expect(parsed.rows[0]).toMatchObject({ ownerIds: [7], operator: "historical-owner", scopeStatus: "unknown", scopes: [], fbaComponents: [], ownerEvidence: { status: "unknown", names: [] } });
    expect(parsed.scopeUniverse).toEqual({ scopes: [], complete: false });
    expect(planInventoryScopeAccess(parsed, scope).scopeVerifiable).toBe(false);
    expect(build(legacy(), { ...input, exactScope: scope })).toMatchObject({ status: "scope_unverifiable", snapshot: null, groups: [], totals: null });
  });
  it("legacy identical parent labels remain separate unknown-scope groups", () => {
    const result = build(legacy([oldRow("one"), oldRow("two")]));
    expect(result.groups).toHaveLength(2); expect(result.groups.every(group => group.scopeStatus === "unknown")).toBe(true); expect(result.totals?.total.quantity).toBe(20);
  });
  it("legacy missing age stays unknown, not not-applicable even when current FBA is zero", () => {
    const row = oldRow(); delete (row as Partial<typeof row>).age;
    const parsed = parseInventorySnapshot(legacy([row])); expect(parsed.rows[0].ageStatus).toBe("unknown"); expect(parsed.rows[0].age.days365Plus).toBeNull();
  });
  it("accepts native and bounded JSON string snapshots identically", () => expect(parseInventorySnapshot(JSON.stringify(legacy()))).toEqual(parseInventorySnapshot(legacy())));
  it.each([{}, [], null, "bad", legacy([]), { ...legacy(), version: 3 }, { ...legacy(), currency: "USD" }, { ...legacy(), capturedAt: 0 }, { ...legacy(), sourceCounts: {} }])("rejects invalid/incomplete saved snapshot %j", value => expect(() => parseInventorySnapshot(value)).toThrow(InventorySnapshotReadError));
  it("rejects duplicate source IDs, inconsistent totals and conflicting shared accessories", () => {
    expect(() => parseInventorySnapshot(legacy([oldRow(), oldRow()]))).toThrow();
    expect(() => parseInventorySnapshot(legacy([oldRow("one", { total: { quantity: 11, value: 100 } })]))).toThrow();
    const aux = { id: "BOX", sku: "BOX", name: "Box", stock: { quantity: 2, value: 10 }, shared: true, note: "shared" };
    expect(() => parseInventorySnapshot(legacy([oldRow("one", { aux: [aux] }), oldRow("two", { aux: [{ ...aux, stock: { quantity: 3, value: 10 } }] })]))).toThrow();
  });
  it.each([{ ...input, operatorId: 7 }, { ...input, userId: 7 }, { ...input, groupLimit: 51 }, { ...input, ageThreshold: 200 }, { ...input, groupOffset: -1 }, { ...input, exactScope: { parentAsin: "P", storeName: "Store", country: "US" } }, { ...input, expectedWorkspaceId: 0 }])("rejects client ownership controls and invalid pages/scope", value => expect(InventorySnapshotReadInputSchema.safeParse(value).success).toBe(false));
});

describe("canonical replay, scope closure and exact metadata disclosure", () => {
  it("replays every v2 source and preserves explicit binding evidence", () => {
    const saved = canonical(), parsed = parseInventorySnapshot(saved); expect(parsed.version).toBe(2); expect(parsed.provenance.status).toBe("replayed_v2"); expect(parsed.rows).toEqual(saved.rows); expect(parsed.scopeUniverse).toEqual({ complete: true, scopes: [scope] });
  });
  it.each(["stock", "scope", "count", "source", "owner"])("rejects forged serialized v2 %s rather than trusting its derived receipt", change => {
    const saved = clone(canonical());
    if (change === "stock") saved.rows[0].total.quantity++;
    if (change === "scope") saved.rows[0].scopes[0].accountId = "OTHER";
    if (change === "count") saved.sourceCounts.fba++;
    if (change === "source") saved.mapping.sources.fba[0].available = 99;
    if (change === "owner") saved.rows[0].ownerEvidence.names = ["Impostor"];
    expect(() => parseInventorySnapshot(saved)).toThrow(InventorySnapshotReadError);
  });
  it("keeps zero display rows and all explicit metadata bindings in the server scope universe", () => {
    const saved = canonical([{}, { account: "B", quantity: 0, age: 0 }]);
    expect(saved.rows).toHaveLength(1); expect(parseInventorySnapshot(saved).scopeUniverse.scopes.map(value => value.accountId)).toEqual(["A1", "B"]);
    saved.mapping.sources.listings.push({ id: 90, commodityId: "meta", asin: "META", sku: "META", marketplaceId: "ATVPDKIKX0DER", parent: "P", store: "Store", country: "US", account: "C" });
    saved.mapping.scopeBindings.push({ ref: { source: "listings", index: 0, id: "90" }, fields: { parentAsin: "parent", storeName: "store", country: "country", accountId: "account" }, scope: { ...scope, accountId: "C" }, kind: "explicit_confirmed_field_mapping", mappingId: "metadata" });
    const rebuilt = mapInventorySources({ sources: saved.mapping.sources, scopeBindings: saved.mapping.scopeBindings, startedAt: 1, capturedAt: 2 });
    expect(parseInventorySnapshot(rebuilt).scopeUniverse.scopes.map(value => value.accountId)).toContain("C");
  });
  it("marks scope universe incomplete when any retained quantitative reference lacks binding", () => {
    const saved = canonical([{}, { account: "B", quantity: 0, age: 0 }]);
    const rebuilt = mapInventorySources({ sources: saved.mapping.sources, scopeBindings: saved.mapping.scopeBindings.slice(0, 1), startedAt: 1, capturedAt: 2 }); expect(parseInventorySnapshot(rebuilt).scopeUniverse.complete).toBe(false);
  });
  it("computes physical-stock closure by BFS through a reversed auxiliary chain", () => {
    const parsed = parseInventorySnapshot(canonical());
    const template = parsed.rows[0];
    parsed.rows = Array.from({ length: 200 }, (_, index): InventoryReadRow => ({ ...clone(template), id: `row${index}`, scopes: [{ ...scope, parentAsin: `P${index}` }], physicalStockIds: [`edge${index}`, `edge${index + 1}`] })).reverse();
    const plan = planInventoryScopeAccess(parsed, { ...scope, parentAsin: "P0" });
    expect(plan.rowIds).toEqual(["row0"]); expect(plan.requiredRows).toHaveLength(200); expect(new Set(plan.requiredRows.map(value => value.id)).size).toBe(200);
    parsed.rows[0].scopeStatus = "unknown"; expect(planInventoryScopeAccess(parsed, { ...scope, parentAsin: "P0" }).scopeVerifiable).toBe(false);
  });
  it("redacts all-workspace counts/warnings and returns only selected rows, not authorization closure", () => {
    const saved = canonical([{}, { parent: "OTHER", account: "B" }]), parsed = parseInventorySnapshot(saved), plan = planInventoryScopeAccess(parsed, scope);
    const result = buildInventorySnapshotReadResult({ identity, input: { ...input, exactScope: scope }, record: record(saved), visibility: "scoped", scopedRows: plan.rowIds });
    expect(result.snapshot?.sourceCounts).toBeNull(); expect(result.groups).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('"accountId":"B"'); expect(result).not.toHaveProperty("scopeUniverse"); expect(result.snapshot?.warnings).not.toEqual(parsed.warnings);
  });
  it.each([{ rowIds: [] }, { rowIds: ["extra"] }, { rowIds: ["fba:[\"A1\",\"pool0\"]", "fba:[\"A1\",\"pool0\"]"] }])("refuses forged/repeated authorized row set", ({ rowIds }) => {
    expect(() => buildInventorySnapshotReadResult({ identity, input: { ...input, exactScope: scope }, record: record(canonical()), visibility: "scoped", scopedRows: rowIds as unknown as string[] })).toThrow(InventorySnapshotReadError);
  });
});

describe("complete group pagination, aged and unknown classification", () => {
  it("groups same proven parent before searching or paging and keeps all sibling rows", () => {
    const result = build(canonical([{}, {}]), { ...input, search: "M1", groupLimit: 1 });
    expect(result.groups).toHaveLength(1); expect(result.groups[0].rows).toHaveLength(2); expect(result.page.totalRows).toBe(2); expect(result.totals?.total.quantity).toBe(20);
  });
  it("can search historical owner notes without turning them into authorization", () => {
    const result = build(legacy(), { ...input, search: "historical-owner" }); expect(result.groups).toHaveLength(1); expect(result.groups[0].rows[0].ownerEvidence.status).toBe("unknown");
  });
  it("preserves HTML-looking names as inert original text", () => {
    const result = build(legacy([oldRow("one", { name: '<img src=x onerror="alert(1)">' })])); expect(result.groups[0].rows[0].name).toContain("onerror");
  });
  it("computes complete filtered totals, not current-page totals", () => {
    const result = build(canonical([{ parent: "P1" }, { parent: "P2" }, { parent: "P3" }]), { ...input, groupLimit: 1 });
    expect(result.groups).toHaveLength(1); expect(result.page).toMatchObject({ totalGroups: 3, totalRows: 3, nextOffset: 1, hasMore: true }); expect(result.totals?.total.quantity).toBe(30);
  });
  it("jointly pages known-positive then unknown age without labeling unknown as zero", () => {
    const saved = canonical([{ parent: "P1", age: 2 }, { parent: "P2", age: 4 }, { parent: "P3", age: null }]);
    const first = build(saved, { ...input, agedGroupLimit: 1 }); expect(first.agedGroups[0].aged).toBe(4); expect(first.unknownAgeGroups).toEqual([]); expect(first.agedPage).toMatchObject({ totalGroups: 3, knownGroupCount: 2, unknownGroupCount: 1, nextOffset: 1 });
    const last = build(saved, { ...input, agedGroupLimit: 1, agedGroupOffset: 2 }); expect(last.agedGroups).toEqual([]); expect(last.unknownAgeGroups).toHaveLength(1); expect(last.agedPage.hasMore).toBe(false);
    expect(last.agedTotals?.total.quantity).toBe(20); expect(last.unknownAgeTotals?.total.quantity).toBe(10);
  });
  it("threshold365 can be known when earlier age bands are unknown", () => {
    const saved = canonical([{ age: null }]); expect(build(saved).unknownAgeGroups).toHaveLength(1); expect(build(saved, { ...input, ageThreshold: 365 }).unknownAgeGroups).toEqual([]);
  });
  it("search with no matches is a ready zero filtered result, not missing source", () => expect(build(canonical(), { ...input, search: "does-not-exist" })).toMatchObject({ status: "ready", groups: [], totals: { total: { quantity: 0, value: 0 } } }));
  it("distinguishes missing table, absent saved snapshot, corrupt data and unverifiable scope", () => {
    expect(buildInventorySnapshotReadResult({ identity, input, record: null, tableMissing: true }).status).toBe("missing");
    expect(buildInventorySnapshotReadResult({ identity, input, record: null }).status).toBe("not_found");
    expect(buildInventorySnapshotReadFailure({ identity, input, status: "invalid", reasonCode: "invalid_payload", missingReason: "source invalid" })).toMatchObject({ snapshot: null, totals: null, groups: [] });
  });
});

describe("bounded complete source and result validation", () => {
  it("requires real saved IDs and exact captured timestamp", () => {
    for (const patch of [{ workspaceId: 12 }, { capturedAt: 3 }, { capturedAt: "2.0" }, { capturedAt: " 2" }, { id: 0 }, { runId: 0 }]) expect(() => buildInventorySnapshotReadResult({ identity, input, record: { ...record(legacy()), ...patch } })).toThrow(InventorySnapshotReadError);
    expect(buildInventorySnapshotReadResult({ identity, input, record: { ...record(legacy()), capturedAt: "2" } }).status).toBe("ready");
  });
  it("rejects cycles, erased native fields, nonfinite numbers and oversize raw strings", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [cyclic, { secret: undefined }, Array(2), { n: NaN }, { n: Infinity }, { n: BigInt(1) }, { long: "x".repeat(32769) }, Object.assign([1], { hidden: true })]) expect(() => parseInventoryJson(value)).toThrow();
  });
  it("allows repeated references and distinguishes UTF8/canonical/wire limits", () => {
    const shared = { value: "中" }; expect(parseInventoryJson({ a: shared, b: shared })).toEqual({ a: shared, b: shared }); expect(inventoryJsonBytes("中")).toBe(5);
    expect(() => parseInventoryJson(" [1] ", 3, 10)).not.toThrow(); expect(() => parseInventoryJson(" [10] ", 3, 10)).toThrow();
    expect(() => parseInventoryJson(" ".repeat(INVENTORY_READ_LIMITS.payloadBytes + 1), 5, 10)).toThrow();
  });
  it.each([
    (value: ReturnType<typeof build>) => { value.groups[0].totals.total.quantity++; },
    value => { value.groups[0].aged = 999; }, value => { value.groups[0].rows.push(value.groups[0].rows[0]); },
    value => { value.page.nextOffset = 999; }, value => { value.totals!.total.quantity++; }, value => { value.groups[0].scopeStatus = "verified"; },
  ])("rejects inconsistent serialized ready groups", mutate => {
    const value = clone(build()); mutate(value); expect(InventorySnapshotReadResultSchema.safeParse(value).success).toBe(false);
  });
  it("rejects wrong-scope rows and leaked global metadata in a scoped response", () => {
    const saved = canonical(), plan = planInventoryScopeAccess(parseInventorySnapshot(saved), scope), result = buildInventorySnapshotReadResult({ identity, input: { ...input, exactScope: scope }, record: record(saved), visibility: "scoped", scopedRows: plan.rowIds });
    const wrong = clone(result); wrong.groups[0].rows[0].scopes[0].accountId = "B"; expect(InventorySnapshotReadResultSchema.safeParse(wrong).success).toBe(false);
    expect(InventorySnapshotReadResultSchema.safeParse({ ...result, snapshot: { ...result.snapshot, sourceCounts: { fba: 999 } } }).success).toBe(false);
  });
});
