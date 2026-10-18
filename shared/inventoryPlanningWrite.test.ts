import { describe, expect, it } from "vitest";
import { INVENTORY_PLANNING_DEFAULTS, InventoryPlanningExecuteInputSchema, InventoryPlanningReadInputSchema, InventoryPlanningReadResultSchema, InventoryPlanningWriteResultSchema, InventoryPlanningPatchSchema, InventoryPlanningValuesSchema, applyInventoryPlanningPatch, canonicalInventoryPlanningScope, createInventoryPlanningStateResolver, inventoryPlanningOperationRequestHash, inventoryPlanningScopeKey, inventoryPlanningSnapshotKey, inventoryPlanningWriteCanonical, parseInventoryPlanningLocalRows, parseInventoryPlanningParameterRows, resolveInventoryPlanningState, validateInventoryPlanningWriteAgainstReadResult, type InventoryPlanningParameterRow, type InventoryPlanningLocalRow, type InventoryPlanningReadResult, type InventoryPlanningScope } from "./inventoryPlanningWrite";

const identity = { userId: 7, workspaceId: 11 }, date = "2026-10-18", time = "2026-10-18T01:02:03.000Z", operationId = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const scope: InventoryPlanningScope = { scopeType: "asin", asin: "B012345678", storeName: "Exact Store", country: "US" };
const request = { expectedWorkspaceId: 11, scope, asOfDate: date, marketplace: "ALL" };
function parameter(patch: Partial<InventoryPlanningParameterRow> = {}): InventoryPlanningParameterRow {
  return { ...INVENTORY_PLANNING_DEFAULTS, id: 1, ...identity, scopeType: "asin", asin: "B012345678", parentAsin: null, storeName: "Exact Store", country: "US", isActive: 1, createdAt: time, updatedAt: time, ...patch };
}
function local(patch: Partial<InventoryPlanningLocalRow> = {}): InventoryPlanningLocalRow {
  return { id: 1, ...identity, asin: "B012345678", storeName: "Exact Store", country: "US", effectiveDate: date, localQty: 5, reason: null, status: "confirmed", confirmedBy: 7, confirmedAt: time, supersededById: null, createdAt: time, updatedAt: time, ...patch };
}
function state(parameters: unknown = [], locals: unknown = [], target = scope) { return resolveInventoryPlanningState({ identity, scope: target, asOfDate: date, parameters, locals }); }
function read(parameters: unknown = [], locals: unknown = []): InventoryPlanningReadResult {
  return { identity, scope, asOfDate: date, marketplace: "ALL", status: "ready", reasonCode: null, snapshotKey: hash, source: { status: "available", recordCount: 1, asOfDate: date }, ...state(parameters, locals), capabilities: { confirmLocal: { status: "available", reasonCode: null }, saveParameters: { status: "available", reasonCode: null } } };
}
const save = () => ({ ...request, operationId, expectedSnapshotKey: hash, action: "saveParameters" as const, patch: { productionDays: 40 } });

describe("inventory planning exact scope and field protocol", () => {
  it.each<InventoryPlanningScope>([{ scopeType: "workspace" }, { scopeType: "store_country", storeName: "Exact Store", country: "US" }, { scopeType: "parent_asin", parentAsin: "PARENT", storeName: "Exact Store", country: "US" }, scope])("retains stored scope $scopeType", target => {
    expect(InventoryPlanningReadInputSchema.parse({ ...request, scope: target }).scope).toEqual(target);
    expect(InventoryPlanningExecuteInputSchema.parse({ ...save(), scope: target }).scope).toEqual(target);
  });
  it("child parent is metadata, never a second save identity or request", () => {
    expect(canonicalInventoryPlanningScope({ ...scope, parentAsin: "PARENT" })).toEqual(scope);
    expect(inventoryPlanningScopeKey({ ...scope, parentAsin: "PARENT" })).toBe(inventoryPlanningScopeKey(scope));
    expect(inventoryPlanningOperationRequestHash({ ...save(), scope: { ...scope, parentAsin: "PARENT" } })).toBe(inventoryPlanningOperationRequestHash(save()));
  });
  it.each(["2026-02-29", "2024-02-30", "2026-00-01", "2026-13-01", "0000-01-01", "2026-1-01"])("rejects non-calendar %s", asOfDate => expect(InventoryPlanningReadInputSchema.safeParse({ ...request, asOfDate }).success).toBe(false));
  it("accepts leap day and future local confirmation without pretending it is current", () => {
    expect(InventoryPlanningReadInputSchema.safeParse({ ...request, asOfDate: "2024-02-29" }).success).toBe(true);
    expect(InventoryPlanningExecuteInputSchema.safeParse({ ...request, operationId, expectedSnapshotKey: hash, action: "confirmLocal", effectiveDate: "2027-01-01", localQty: 0, reason: null }).success).toBe(true);
    expect(state([], [local({ effectiveDate: "2027-01-01" })]).local.current).toBeNull();
  });
  it("keeps exact original country text; marketplace is separately canonical", () => {
    expect(InventoryPlanningReadInputSchema.parse({ ...request, scope: { ...scope, country: "美国" }, marketplace: "US" }).scope).toMatchObject({ country: "美国" });
    expect(InventoryPlanningReadInputSchema.safeParse({ ...request, marketplace: "美国" }).success).toBe(false);
    expect(InventoryPlanningReadInputSchema.safeParse({ ...request, marketplace: "GB" }).success).toBe(false);
  });
  it.each([{ scopeType: "workspace", country: "US" }, { scopeType: "store_country", country: "US" }, { scopeType: "parent_asin", storeName: "S", country: "US" }, { ...scope, storeName: " S " }, { ...scope, asin: "x".repeat(21) }, { ...scope, storeName: "x".repeat(201) }])("rejects incomplete/oversized scope", target => expect(InventoryPlanningReadInputSchema.safeParse({ ...request, scope: target }).success).toBe(false));
  it.each([{}, { productCost: undefined }, { productionDays: null }, { dimensionUnit: null }, { currency: "CNY" }, { extra: 1 }])("rejects empty/implicit/invalid patch", patch => expect(InventoryPlanningPatchSchema.safeParse(patch).success).toBe(false));
  it.each(["productionDays", "shippingDays", "bufferDays"])("enforces day bounds for %s", field => {
    expect(InventoryPlanningPatchSchema.safeParse({ [field]: 0 }).success).toBe(true); expect(InventoryPlanningPatchSchema.safeParse({ [field]: 366 }).success).toBe(false);
  });
  it.each(["productCost", "estimatedFirstLegCost", "actualFirstLegCost", "estimatedFbaFee", "actualFbaFee", "sellingPrice"])("preserves money null/zero and rejects precision/range for %s", field => {
    for (const value of [null, 0, 1.01, 99999999.99]) expect(InventoryPlanningPatchSchema.safeParse({ [field]: value }).success).toBe(true);
    for (const value of [-1, 1.005, 100000000, NaN, Infinity, "1.00"]) expect(InventoryPlanningPatchSchema.safeParse({ [field]: value }).success).toBe(false);
  });
  it.each(["estimatedWeight", "actualWeight"])("enforces DECIMAL(10,3) for %s", field => {
    for (const value of [null, 0, 1.001, 9999999.999]) expect(InventoryPlanningPatchSchema.safeParse({ [field]: value }).success).toBe(true);
    for (const value of [-1, 0.0001, 10000000]) expect(InventoryPlanningPatchSchema.safeParse({ [field]: value }).success).toBe(false);
  });
  it("preserves all untouched values and explicit clears, never fills null with zero", () => {
    const base = { ...INVENTORY_PLANNING_DEFAULTS, productCost: 11.23, actualWeight: 2.345, dimensionUnit: "cm" as const, weightUnit: "kg" as const, packSize: 17, moq: 81, estimatedDimensions: "长 × 宽 × 高" };
    const first = applyInventoryPlanningPatch(base, { productionDays: 45 }); expect(first).toEqual({ ...base, productionDays: 45 });
    expect(applyInventoryPlanningPatch(first, { productCost: null, actualWeight: null, estimatedDimensions: null })).toEqual({ ...first, productCost: null, actualWeight: null, estimatedDimensions: null });
    expect(InventoryPlanningValuesSchema.safeParse({ ...base, moq: 2147483648 }).success).toBe(false);
    expect(InventoryPlanningValuesSchema.safeParse({ ...base, packSize: 0 }).success).toBe(false);
  });
  it("allows null clear dimensions but no empty pseudo-value and no overlong string", () => {
    expect(InventoryPlanningPatchSchema.safeParse({ actualDimensions: null }).success).toBe(true);
    for (const actualDimensions of ["", " ", "x".repeat(121), "bad\ud800"]) expect(InventoryPlanningPatchSchema.safeParse({ actualDimensions }).success).toBe(false);
  });
  it("local writes are child-only and absolute bounded integer quantities", () => {
    const input = { ...request, operationId, expectedSnapshotKey: hash, action: "confirmLocal", localQty: 2147483647, effectiveDate: date, reason: null };
    expect(InventoryPlanningExecuteInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ localQty: 2147483648 }, { localQty: -1 }, { localQty: 0.1 }, { scope: { scopeType: "workspace" } }, { reason: "x".repeat(501) }]) expect(InventoryPlanningExecuteInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});

describe("whole per-user records and deterministic resolution", () => {
  it("uses defaults only for proven empty arrays, full costs remain unknown", () => {
    expect(state().parameters).toEqual({ current: null, effective: INVENTORY_PLANNING_DEFAULTS, resolvedFrom: "system_defaults" }); expect(state().local.current).toBeNull();
    for (const invalid of [undefined, null, {}, "[]"]) expect(() => resolveInventoryPlanningState({ identity, scope, asOfDate: date, parameters: invalid, locals: [] })).toThrow();
  });
  it("inherits complete store values for first child patch and never parent values", () => {
    const workspace = parameter({ id: 1, scopeType: "workspace", asin: null, storeName: null, country: null, productCost: 5, moq: 7 });
    const storeRow = parameter({ id: 2, scopeType: "store_country", asin: null, productCost: 12.35, actualWeight: 1.234, dimensionUnit: "cm", weightUnit: "kg", moq: 30, packSize: 6 });
    const parent = parameter({ id: 3, scopeType: "parent_asin", asin: null, parentAsin: "PARENT", productCost: 999 });
    const resolved = state([workspace, storeRow, parent], [], { ...scope, parentAsin: "PARENT" });
    expect(resolved.parameters.current).toBeNull(); expect(resolved.parameters.resolvedFrom).toBe("store_country");
    expect(applyInventoryPlanningPatch(resolved.parameters.effective, { productionDays: 45 })).toMatchObject({ productionDays: 45, productCost: 12.35, actualWeight: 1.234, dimensionUnit: "cm", weightUnit: "kg", moq: 30, packSize: 6 });
    expect(state([workspace, parent]).parameters.effective.productCost).toBe(5);
    expect(state([parent]).parameters.effective.productCost).toBeNull();
    expect(state([parent], [], { scopeType: "parent_asin", parentAsin: "PARENT", storeName: "Exact Store", country: "US" }).parameters.effective.productCost).toBe(999);
  });
  it("child complete row takes precedence even if nullable costs differ from store", () => {
    const storeRow = parameter({ id: 2, scopeType: "store_country", asin: null, productCost: 20 });
    expect(state([storeRow, parameter()]).parameters).toMatchObject({ current: { id: 1 }, effective: { productCost: null }, resolvedFrom: "asin" });
  });
  it("inactive original is preserved in parse but does not become effective", () => {
    const inactive = parameter({ isActive: 0, productCost: 15 }); expect(parseInventoryPlanningParameterRows([inactive], identity)).toEqual([inactive]); expect(state([inactive]).parameters.current).toBeNull();
  });
  it.each([{ parentAsin: "PARENT" }, { isActive: 0 as const }, { country: "美国" }, { storeName: "exact store" }, { storeName: "Éxact Store" }])("rejects duplicate/alias parameter identities across all states", patch => expect(() => state([parameter(), parameter({ id: 2, ...patch })])).toThrow());
  it.each([{ workspaceId: 12 }, { userId: 8 }, { currency: "CNY" }, { packSize: 0 }, { asin: null }, { country: null }, { extra: 1 }])("fails closed for invalid or foreign stored fields", patch => expect(() => state([{ ...parameter(), ...patch }])).toThrow());
  it("does not rewrite a single original country but refuses choosing an alias", () => {
    const row = parameter({ country: "美国" }); expect(state([row], [], { ...scope, country: "美国" }).parameters.current?.country).toBe("美国"); expect(() => state([row])).toThrow("ALIAS_CONFLICT");
  });
  it("accepts actual DB decimal strings and explicit Date timestamp columns only", () => {
    const parsed = parseInventoryPlanningParameterRows([{ ...parameter(), productCost: "12.30", actualWeight: "1.234", createdAt: new Date(time), updatedAt: "2026-10-18 01:02:03.123456" }], identity)[0];
    expect(parsed).toMatchObject({ productCost: 12.3, actualWeight: 1.234, createdAt: time, updatedAt: "2026-10-18 01:02:03.123456" });
    for (const productCost of ["", " 1.00", "1e2", "1.001", "NaN", "-1", "100000000.00"]) expect(() => state([{ ...parameter(), productCost }])).toThrow();
    expect(() => state([{ ...parameter(), createdAt: new Date(NaN) }])).toThrow();
  });
  it("selects latest date then highest ID among legacy same-day confirmed rows; future retained", () => {
    const result = state([], [local({ id: 2, localQty: 17 }), local({ id: 1, localQty: 9 }), local({ id: 3, effectiveDate: "2026-10-19", localQty: 21 })]);
    expect(result.local.current?.id).toBe(2); expect(result.local.history.map(row => row.id)).toEqual([3, 2, 1]);
  });
  it("preserves superseded and draft history without treating either as current", () => {
    const rows = [local({ id: 1, status: "superseded", supersededById: 2 }), local({ id: 2, localQty: 6 }), local({ id: 3, status: "draft", confirmedBy: null, confirmedAt: null })];
    expect(state([], rows).local.history).toHaveLength(3); expect(state([], rows).local.current?.id).toBe(2);
    expect(() => parseInventoryPlanningLocalRows([rows[0]], identity)).toThrow("LINEAGE_INVALID");
  });
  it.each([{ userId: 8 }, { workspaceId: 12 }, { localQty: -1 }, { confirmedBy: null }, { confirmedAt: null }, { supersededById: 2 }, { effectiveDate: "2026-02-30" }])("rejects invalid local record", patch => expect(() => state([], [{ ...local(), ...patch }])).toThrow());
  it("rejects local country/store aliases and duplicate primary IDs", () => {
    expect(() => state([], [local(), local({ id: 2, country: "美国" })])).toThrow("ALIAS_CONFLICT");
    expect(() => state([], [local(), local()])).toThrow("DUPLICATE_ID");
  });
  it("indexes once for repeated table scopes and does not cross store/country", () => {
    const resolve = createInventoryPlanningStateResolver({ identity, parameters: [parameter({ productCost: 10 }), parameter({ id: 2, country: "CA", productCost: 25 })], locals: [local()] });
    expect(resolve(scope, date).parameters.effective.productCost).toBe(10); expect(resolve({ ...scope, country: "CA" }, date).parameters.effective.productCost).toBe(25);
    expect(resolve({ ...scope, storeName: "Other" }, date).local.current).toBeNull();
  });
  it("does not allow array accessors or sparse rows to invoke or hide records", () => {
    let called = false;
    const rows = Object.defineProperty(new Array(1), "0", { enumerable: true, get() { called = true; return parameter(); } });
    expect(() => parseInventoryPlanningParameterRows(rows, identity)).toThrow(); expect(called).toBe(false);
    expect(() => parseInventoryPlanningParameterRows(new Array(1), identity)).toThrow();
  });
  it("admits the full 5000 parameter and 10000 local bounded range without quadratic lineage checks", () => {
    const parameters = Array.from({ length: 5000 }, (_, index) => parameter({ id: index + 1, asin: `B${String(index).padStart(9, "0")}`, productCost: 2.35 }));
    const locals = Array.from({ length: 10000 }, (_, index) => local({ id: index + 1, asin: `B${String(index).padStart(9, "0")}`, reason: "说明".repeat(100) }));
    const resolve = createInventoryPlanningStateResolver({ identity, parameters, locals });
    expect(resolve({ ...scope, asin: "B000000000" }, date)).toMatchObject({ parameters: { current: { id: 1 }, effective: { productCost: 2.35 } }, local: { current: { id: 1 } } });
    expect(() => parseInventoryPlanningParameterRows([...parameters, parameter({ id: 5001, asin: "B999999999" })], identity)).toThrow("RECORD_LIMIT");
  });
  it("rejects combined parameter/local aggregate above 16MiB even if each row is valid", () => {
    const parameters = Array.from({ length: 5000 }, (_, index) => parameter({ id: index + 1, asin: `B${String(index).padStart(9, "0")}`, estimatedDimensions: "界".repeat(120), actualDimensions: "界".repeat(120) }));
    const locals = Array.from({ length: 10000 }, (_, index) => local({ id: index + 1, asin: `B${String(index).padStart(9, "0")}`, reason: "界".repeat(500) }));
    expect(() => createInventoryPlanningStateResolver({ identity, parameters, locals })).toThrow("PROJECTION_LIMIT");
  });
});

describe("snapshot, response consistency and unknown outcome contract", () => {
  const projection = () => ({ identity, scope, asOfDate: date, marketplace: "ALL", sources: [{ id: 1, sourceHash: "old", reportDate: date, nested: { b: 2, a: 1 } }], parameters: [parameter()], locals: [local()] });
  it("hashes complete source and record fields, not timestamps alone", () => {
    const original = projection(), key = inventoryPlanningSnapshotKey(original);
    for (const changed of [{ ...original, sources: [{ ...original.sources[0], sourceHash: "new" }] }, { ...original, parameters: [parameter({ productCost: 4.56 })] }, { ...original, locals: [local({ localQty: 8 })] }, { ...original, asOfDate: "2026-10-17" }, { ...original, marketplace: "US" }]) expect(inventoryPlanningSnapshotKey(changed)).not.toBe(key);
    expect(inventoryPlanningSnapshotKey({ ...original, sources: [{ nested: { a: 1, b: 2 }, reportDate: date, sourceHash: "old", id: 1 }], scope: { ...scope, parentAsin: "PARENT" } })).toBe(key);
  });
  it("sorts full source and record order without dropping a source", () => {
    const value = projection(), sources = [...value.sources, { id: 2, sourceHash: "two", reportDate: date, nested: { b: 4, a: 3 } }];
    expect(inventoryPlanningSnapshotKey({ ...value, sources })).toBe(inventoryPlanningSnapshotKey({ ...value, sources: [...sources].reverse() }));
    expect(inventoryPlanningSnapshotKey(value)).not.toBe(inventoryPlanningSnapshotKey({ ...value, sources }));
  });
  it.each([undefined, NaN, Infinity, new Date(time), { x: undefined }, { toJSON() { return {}; } }, new Map(), [, 1]])("rejects non-plain or lossy JSON snapshots", value => expect(() => inventoryPlanningWriteCanonical(value)).toThrow());
  it("never invokes getters while validating storage or snapshot", () => {
    let called = false; const object = Object.defineProperty({}, "value", { enumerable: true, get() { called = true; return 1; } });
    expect(() => inventoryPlanningWriteCanonical(object)).toThrow(); expect(called).toBe(false);
    const row = Object.defineProperty(parameter(), "productCost", { enumerable: true, get() { called = true; return 1; } }); expect(() => state([row])).toThrow(); expect(called).toBe(false);
  });
  it("rejects aggregate raw budget rather than only individual rows", () => expect(() => inventoryPlanningWriteCanonical({ a: "a".repeat(9 * 1024 * 1024), b: "b".repeat(9 * 1024 * 1024) })).toThrow("PROJECTION_LIMIT"));
  it("checks scope, source availability, capability and full snapshot CAS", () => {
    expect(validateInventoryPlanningWriteAgainstReadResult(save(), read())).toEqual(save());
    for (const patch of [{ expectedWorkspaceId: 12 }, { expectedSnapshotKey: "b".repeat(64) }, { marketplace: "US" }, { asOfDate: "2026-10-17" }, { scope: { ...scope, country: "CA" } }]) expect(() => validateInventoryPlanningWriteAgainstReadResult({ ...save(), ...patch }, read())).toThrow();
    const denied = read(); denied.capabilities.saveParameters = { status: "unavailable", reasonCode: "release_disabled" }; expect(() => validateInventoryPlanningWriteAgainstReadResult(save(), denied)).toThrow("UNAVAILABLE");
  });
  it.each(["identity", "local_scope", "local_selection", "parent_inheritance", "source_empty", "false_available", "false_absent", "effective_changed", "false_default"])("rejects contradictory read reply %s", scenario => {
    const value = read([parameter()], [local()]);
    if (scenario === "identity") value.parameters!.current!.userId = 8;
    if (scenario === "local_scope") value.local!.history[0].country = "CA";
    if (scenario === "local_selection") value.local!.current = null;
    if (scenario === "parent_inheritance") value.parameters!.resolvedFrom = "parent_asin";
    if (scenario === "source_empty") value.source.recordCount = 0;
    if (scenario === "false_available") value.source.status = "unavailable";
    if (scenario === "false_absent") value.status = "unavailable";
    if (scenario === "effective_changed") value.parameters!.effective.productCost = 99;
    if (scenario === "false_default") { value.parameters!.current = null; value.parameters!.resolvedFrom = "system_defaults"; value.parameters!.effective.moq = 8; }
    expect(InventoryPlanningReadResultSchema.safeParse(value).success).toBe(false);
  });
  it("requires final receipt metadata and does not label unknown as missing/failed", () => {
    const base = { identity, scope, asOfDate: date, marketplace: "ALL", operationId, action: null, status: "unknown", recordId: null, snapshotKey: null, reasonCode: "commit_unknown" };
    expect(InventoryPlanningWriteResultSchema.safeParse(base).success).toBe(true);
    expect(InventoryPlanningWriteResultSchema.safeParse({ ...base, status: "committed" }).success).toBe(false);
    expect(InventoryPlanningWriteResultSchema.safeParse({ ...base, status: "committed", action: "saveParameters", recordId: 2, snapshotKey: hash, reasonCode: null }).success).toBe(true);
  });
});
