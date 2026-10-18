import { describe, expect, it } from "vitest";
import { buildOperationsCostSheetReadResult, type BuildOperationsCostSheetReadInput, type OperationsCostSheetPayload, type OperationsCostSheetSourceRow } from "./operationsCostSheetRead";
import {
  OperationsCostSheetWriteOptionsInputSchema, OperationsCostSheetWriteOptionsResultSchema, OperationsCostSheetWriteRecoverInputSchema,
  OperationsCostSheetWriteResultSchema, OperationsCostSheetWriteSaveInputSchema, createOperationsCostSheetDraftRow,
  initializeOperationsCostSheetDraft, operationsCostSheetOperationRequestHash, operationsCostSheetSnapshotKey,
  operationsCostSheetWriteCanonical, operationsCostSheetWriteScope, validateOperationsCostSheetWriteAgainstReadResult,
  type OperationsCostSheetWriteSaveInput,
} from "./operationsCostSheetWrite";

const identity = { userId: 2, workspaceId: 7 }, scope = { workspaceId: 7, parentAsin: "PARENT", storeName: "Exact Store", country: "US" };
const input = { expectedWorkspaceId: 7, parentAsin: scope.parentAsin, storeName: scope.storeName, country: "US" };
const operationId = "11111111-1111-4111-8111-111111111111", key = "a".repeat(64);
const source = (): OperationsCostSheetSourceRow => ({ kind: "lingxing", id: 1, importId: 2, date: "2026-10-17", sourceKind: "report", sourceBatchId: 1, sourceTraceId: "trace", sourceSchemaVersion: "v1", scope, sku: "SKU", msku: null, asin: "CHILD", name: "Product", currency: "USD", price: "20.00", actualFbaUnitFee: "-3", actualFbaTotalFee: null, fbaSalesQty: 4, missingColumns: [] });
const payload = (): OperationsCostSheetPayload => ({ settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [{ ...createOperationsCostSheetDraftRow("SKU"), productCost: 0 }, { ...createOperationsCostSheetDraftRow("ORPHAN"), productCost: 7 }] });
function projection(saved = true) {
  const sources = [source()], storage: BuildOperationsCostSheetReadInput["storage"] = saved ? { status: "saved", record: { id: 1, version: 7, updatedBy: 2, updatedAt: "2026-10-17T01:02:03.000Z", payload: payload() } } : { status: "not_saved" };
  return { sources, storage, readResult: buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", sources, storage }) };
}
function command(saved = true): OperationsCostSheetWriteSaveInput {
  const value = projection(saved);
  return { ...input, operationId, expectedVersion: saved ? 7 : 0, expectedSnapshotKey: operationsCostSheetSnapshotKey(value), payload: initializeOperationsCostSheetDraft(value.readResult) };
}
const validate = (value: OperationsCostSheetWriteSaveInput) => { const current = projection(); return validateOperationsCostSheetWriteAgainstReadResult(value, current.readResult, operationsCostSheetSnapshotKey(current)); };

describe("cost write strict protocol and scoped options", () => {
  it("keeps exact four-part identity and existing marketplace normalization", () => { expect(OperationsCostSheetWriteOptionsInputSchema.parse({ ...input, country: "美国站" }).country).toBe("US"); expect(operationsCostSheetWriteScope(command())).toEqual(scope); });
  it.each(["actorUserId", "scope", "asOfDate"])("does not accept a client authority/derived field %s", field => expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...command(), [field]: 1 }).success).toBe(false));
  it.each([-1, 1.1, 2147483647, Infinity])("rejects invalid expected version %s", expectedVersion => expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...command(), expectedVersion }).success).toBe(false));
  it("strictly bounds UUID, snapshot, decisions and complete payload", () => {
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...command(), operationId: "id" }).success).toBe(false);
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...command(), expectedSnapshotKey: "key" }).success).toBe(false);
    expect(OperationsCostSheetWriteRecoverInputSchema.safeParse({ ...input, operationId, decision: "retry" }).success).toBe(false);
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...command(), payload: { rows: [] } }).success).toBe(false);
  });
  it("allows feature-off options without falsely declaring source or write available", () => {
    const current = projection(), value = { identity, scope, readResult: current.readResult, snapshotKey: operationsCostSheetSnapshotKey(current), capabilities: { save: { status: "unavailable", reasonCode: "not_enabled_before_release" } } };
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse(value).success).toBe(true);
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ ...value, identity: { ...identity, userId: 9 } }).success).toBe(false);
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ ...value, scope: { ...scope, storeName: "Other" } }).success).toBe(false);
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ ...value, snapshotKey: null }).success).toBe(false);
  });
  it.each(["not_connected", "corrupt"] as const)("cannot authorize %s even if a client supplies a hash", status => {
    const readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", storage: { status }, sources: [source()] });
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ identity, scope, readResult, snapshotKey: key, capabilities: { save: { status: "available", reasonCode: null } } }).success).toBe(false);
    expect(() => operationsCostSheetSnapshotKey({ readResult, sources: [], storage: null })).toThrow("SOURCE_UNAVAILABLE");
  });
  it("unknown source cannot be promoted to editable by a well-formed saved payload", () => {
    const current = projection(); const readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", storage: current.storage, sources: null });
    expect(() => initializeOperationsCostSheetDraft(readResult)).toThrow("SOURCE_UNAVAILABLE");
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ identity, scope, readResult, snapshotKey: null, capabilities: { save: { status: "available", reasonCode: null } } }).success).toBe(false);
  });
  it("zero current sources retain history but cannot save settings or new rows", () => {
    const current = projection(); current.sources = []; current.readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", storage: current.storage, sources: [] });
    const snapshotKey = operationsCostSheetSnapshotKey(current);
    expect(OperationsCostSheetWriteOptionsResultSchema.safeParse({ identity, scope, readResult: current.readResult, snapshotKey, capabilities: { save: { status: "available", reasonCode: null } } }).success).toBe(false);
    expect(() => validateOperationsCostSheetWriteAgainstReadResult({ ...command(), expectedSnapshotKey: snapshotKey }, current.readResult, snapshotKey)).toThrow("NO_CURRENT_FACTS");
  });
  it("committed receipt proves version/key, unknown and cancel never pretend an outcome", () => {
    const value = { identity, scope, operationId, status: "committed", version: 8, snapshotKey: key, reasonCode: null };
    expect(OperationsCostSheetWriteResultSchema.safeParse(value).success).toBe(true);
    for (const patch of [{ version: 0 }, { snapshotKey: null }, { reasonCode: "failed" }, { identity: { ...identity, workspaceId: 8 } }, { status: "unknown" }]) expect(OperationsCostSheetWriteResultSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    for (const status of ["cancelled", "unknown"]) expect(OperationsCostSheetWriteResultSchema.safeParse({ ...value, status, version: null, snapshotKey: null, reasonCode: status }).success).toBe(true);
  });
});

describe("complete lossless cost draft and compare-and-save", () => {
  it("initializes saved values by deep copy including null, zero and orphans", () => { const current = projection(); const draft = initializeOperationsCostSheetDraft(current.readResult); expect(draft).toEqual(payload()); draft.rows[0].productCost = 99; expect(current.readResult.saved!.payload.rows[0].productCost).toBe(0); });
  it("not-saved draft uses explicit settings but never prefills report fee or cost zero", () => { const draft = initializeOperationsCostSheetDraft(projection(false).readResult); expect(draft).toEqual({ settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [] }); expect(createOperationsCostSheetDraftRow("SKU").actualFba).toBeNull(); });
  it("permits unchanged or edited current rows and preserves original orphan", () => { const value = command(); value.payload.rows[0].actualFba = 0; expect(validate(value).payload.rows[0].actualFba).toBe(0); });
  it.each(["SKU", "ORPHAN"])("cannot delete saved row %s even if it has a current fact", removed => { const value = command(); value.payload.rows = value.payload.rows.filter(row => row.key !== removed); expect(() => validate(value)).toThrow("SAVED_ROW_REMOVED"); });
  it("orphan values are immutable while complete settings remain editable", () => { const value = command(); value.payload.rows[1].actualFba = 0; expect(() => validate(value)).toThrow("ORPHAN_CHANGED"); value.payload.rows[1].actualFba = null; value.payload.settings.freightRate = 12; expect(validate(value).payload.settings.freightRate).toBe(12); });
  it("accepts new current fact keys but rejects invented or formerly deleted keys", () => { const value = command(false), current = projection(false); value.payload.rows = [createOperationsCostSheetDraftRow("SKU")]; expect(validateOperationsCostSheetWriteAgainstReadResult(value, current.readResult, operationsCostSheetSnapshotKey(current))).toEqual(value); value.payload.rows.push(createOperationsCostSheetDraftRow("invented")); expect(() => validateOperationsCostSheetWriteAgainstReadResult(value, current.readResult, operationsCostSheetSnapshotKey(current))).toThrow("UNKNOWN_ROW"); });
  it.each(["workspace", "store", "parent", "country"])("refuses cross-%s replay", field => { const value = command(); if (field === "workspace") value.expectedWorkspaceId = 8; if (field === "store") value.storeName = "Other"; if (field === "parent") value.parentAsin = "Other"; if (field === "country") value.country = "CA"; expect(() => validate(value)).toThrow("SCOPE_MISMATCH"); });
  it("rejects stale versions, zero on saved state, and changed source snapshot", () => { expect(() => validate({ ...command(), expectedVersion: 6 })).toThrow("VERSION_CONFLICT"); expect(() => validate({ ...command(), expectedVersion: 0 })).toThrow("VERSION_CONFLICT"); expect(() => validate({ ...command(), expectedSnapshotKey: key })).toThrow("SNAPSHOT_CONFLICT"); });
  it("preserves all 500 saved rows and refuses 501 rather than truncating", () => { const current = projection(); if (current.storage.status !== "saved") throw new Error("fixture"); current.storage.record.payload = { ...payload(), rows: Array.from({ length: 500 }, (_, i) => createOperationsCostSheetDraftRow(`saved-${i}`)) }; current.readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", sources: current.sources, storage: current.storage }); const value = { ...command(), expectedSnapshotKey: operationsCostSheetSnapshotKey(current), payload: initializeOperationsCostSheetDraft(current.readResult) }; expect(validateOperationsCostSheetWriteAgainstReadResult(value, current.readResult, value.expectedSnapshotKey).payload.rows).toHaveLength(500); value.payload.rows.push(createOperationsCostSheetDraftRow("SKU")); expect(OperationsCostSheetWriteSaveInputSchema.safeParse(value).success).toBe(false); });
  it("rejects nonfinite, omitted and duplicate fields while retaining legal wide UTF-8 rows", () => {
    const value = command();
    for (const productCost of [undefined, Infinity, NaN, "1"]) expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...value, payload: { ...value.payload, rows: [{ ...value.payload.rows[0], productCost }] } }).success).toBe(false);
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...value, payload: { ...value.payload, rows: [value.payload.rows[0], value.payload.rows[0]] } }).success).toBe(false);
    const rows = Array.from({ length: 500 }, (_, i) => createOperationsCostSheetDraftRow(`${i}${"中".repeat(490)}`));
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...value, payload: { ...value.payload, rows } }).success).toBe(true);
    const wide = Array.from({ length: 500 }, (_, i) => createOperationsCostSheetDraftRow(`${i}${"😀".repeat(245)}`));
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...value, payload: { ...value.payload, rows: wide } }).success).toBe(true);
    expect(OperationsCostSheetWriteSaveInputSchema.safeParse({ ...value, payload: { ...value.payload, extra: "中".repeat(1024 * 1024) } }).success).toBe(false);
  });
});

describe("complete canonical cost snapshot and request hash", () => {
  it("admits all 500 sources, 5000 expanded observations and 500 saved rows within the unchanged read budget", () => {
    const sources = Array.from({ length: 500 }, (_, i) => ({ ...source(), id: i + 1, sku: Array.from({ length: 10 }, (_, n) => `fact-${n}`).join(","), sourceKind: null, sourceBatchId: null, sourceTraceId: null, sourceSchemaVersion: null }));
    const storage: BuildOperationsCostSheetReadInput["storage"] = { status: "saved", record: { id: 1, version: 7, updatedBy: 2, updatedAt: "2026-10-17T01:02:03.000Z", payload: { ...payload(), rows: Array.from({ length: 500 }, (_, i) => createOperationsCostSheetDraftRow(`saved-${i}`)) } } };
    const readResult = buildOperationsCostSheetReadResult({ identity, scope, asOfDate: "2026-10-18", sources, storage });
    expect(readResult.status).toBe("saved"); expect(readResult.rows.reduce((sum, row) => sum + row.observations.length, 0)).toBe(5000);
    expect(new TextEncoder().encode(JSON.stringify(readResult)).length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(operationsCostSheetSnapshotKey({ readResult, sources, storage })).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("object property order does not change snapshots or request hashes", () => { const current = projection(); expect(operationsCostSheetSnapshotKey({ storage: current.storage, sources: current.sources, readResult: current.readResult })).toBe(operationsCostSheetSnapshotKey(current)); expect(operationsCostSheetWriteCanonical({ b: { z: 1, a: 2 }, a: null })).toBe(operationsCostSheetWriteCanonical({ a: null, b: { a: 2, z: 1 } })); expect(operationsCostSheetOperationRequestHash(command())).toBe(operationsCostSheetOperationRequestHash({ payload: command().payload, ...command() })); });
  it("normalizes native versus textual MySQL saved JSON without omitting original values", () => {
    const current = projection(), original = operationsCostSheetSnapshotKey(current);
    if (current.storage.status !== "saved") throw new Error("fixture");
    const reordered = { rows: payload().rows.map(row => Object.fromEntries(Object.entries(row).reverse())), settings: payload().settings };
    current.storage.record.payload = JSON.stringify(reordered, null, 2);
    expect(operationsCostSheetSnapshotKey(current)).toBe(original);
    current.storage.record.payload = "{";
    expect(() => operationsCostSheetSnapshotKey(current)).toThrow();
  });
  it("checks original getters before any read schema can touch them", () => {
    let touched = false;
    const value = Object.defineProperty({}, "readResult", { enumerable: true, get() { touched = true; return projection().readResult; } });
    expect(() => operationsCostSheetSnapshotKey(value as never)).toThrow("JSON_INVALID"); expect(touched).toBe(false);
  });
  it("binds hidden full source/saved projections, lineage and actor rather than a table page", () => { const current = projection(), original = operationsCostSheetSnapshotKey(current); expect(operationsCostSheetSnapshotKey({ ...current, sources: current.sources.map(row => ({ ...row, operator: "current-owner" })) })).not.toBe(original); expect(operationsCostSheetSnapshotKey({ ...current, storage: { ...current.storage, rawVersion: 9 } })).not.toBe(original); const other = { ...current, readResult: { ...current.readResult, identity: { ...identity, userId: 3 } } }; expect(operationsCostSheetSnapshotKey(other)).not.toBe(original); });
  it("every save input is content bound without embedding its body in a receipt", () => { const original = operationsCostSheetOperationRequestHash(command()); const changed = command(); changed.payload.rows[0].productCost = 1; expect(operationsCostSheetOperationRequestHash(changed)).not.toBe(original); expect(operationsCostSheetOperationRequestHash({ ...command(), expectedVersion: 6 })).not.toBe(original); });
  it.each([undefined, Infinity, NaN, new Date("2026-10-18T00:00:00Z"), new Date("invalid"), /pattern/u, new Map(), 1n, "\ud800"])("rejects nonplain/non-JSON projection %#", value => expect(() => operationsCostSheetWriteCanonical({ value })).toThrow());
  it("rejects cycles, getters, symbol/nonenumerable fields, holes and extra array properties", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("MUST_NOT_RUN"); } });
    const extra = Object.assign([1], { extra: 2 });
    for (const value of [cycle, getter, { [Symbol("s")]: 1 }, Object.defineProperty({}, "hidden", { value: 1 }), new Array(2), extra]) expect(() => operationsCostSheetWriteCanonical(value)).toThrow();
  });
  it("bounds depth and native UTF-8 bytes", () => { let nested: unknown = null; for (let i = 0; i < 26; i++) nested = { nested }; expect(() => operationsCostSheetWriteCanonical(nested)).toThrow("LIMIT"); expect(() => operationsCostSheetWriteCanonical("中".repeat(5 * 1024 * 1024))).toThrow("LIMIT"); });
});
