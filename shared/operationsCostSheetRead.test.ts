import { describe, expect, it } from "vitest";
import {
  OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES,
  OPERATIONS_COST_SHEET_RULE_VERSION,
  OperationsCostSheetReadInputSchema,
  OperationsCostSheetReadResultSchema,
  buildOperationsCostSheetReadResult,
  calculateOperationsCostSheetFreight,
  calculateOperationsCostSheetProfit,
  estimateOperationsCostSheetFba,
  mapOperationsCostSheetFacts,
  parseOperationsCostSheetPayload,
  type BuildOperationsCostSheetReadInput,
  type OperationsCostSheetPayload,
  type OperationsCostSheetRowInput,
  type OperationsCostSheetSourceRow,
} from "./operationsCostSheetRead";

const scope = { workspaceId: 1, parentAsin: "PARENT", storeName: "Store", country: "US" };
const row = (overrides: Partial<OperationsCostSheetRowInput> = {}): OperationsCostSheetRowInput => ({
  key: "SKU-1", productCost: 10, packagingCost: 2, actualFreight: 9, actualFba: 3,
  weightKg: 0.05, lengthCm: 20, widthCm: 10, heightCm: 1, ...overrides,
});
const payload = (): OperationsCostSheetPayload => ({
  settings: { cnyPerCurrency: 7, freightRate: 9, standardGoodsConfirmed: true }, rows: [row()],
});
const source = (overrides: Partial<OperationsCostSheetSourceRow> = {}): OperationsCostSheetSourceRow => ({
  kind: "lingxing", id: 1, importId: 12, date: "2026-10-16", scope,
  sourceKind: "uploaded_parent_asin_weekly", sourceBatchId: 8, sourceTraceId: "trace-1", sourceSchemaVersion: "v1",
  sku: "SKU-1", msku: null, asin: "CHILD-1", name: "Product", currency: "USD", price: "20.00", priceField: "avgPrice",
  actualFbaUnitFee: "-4.50", actualFbaTotalFee: null, fbaSalesQty: "10", missingColumns: [], ...overrides,
});
const input = (): BuildOperationsCostSheetReadInput => ({
  identity: { userId: 2, workspaceId: 1 }, scope, asOfDate: "2026-10-17",
  storage: { status: "saved", record: { id: 30, version: 7, updatedBy: 4, updatedAt: "2026-10-16T01:02:03.000Z", payload: payload() } },
  sources: [source()],
});

describe("complete saved cost payload", () => {
  it("preserves every field in native/string MySQL JSON, including zero and null", () => {
    const value = payload(); value.rows.push(row({ key: "zero", productCost: 0, actualFba: null }));
    expect(parseOperationsCostSheetPayload(value)).toEqual(value);
    expect(parseOperationsCostSheetPayload(JSON.stringify(value))).toEqual(value);
  });
  it("retains all 500 saved rows without slicing", () => {
    const value = payload(); value.rows = Array.from({ length: 500 }, (_, index) => row({ key: `SKU-${index}` }));
    expect(parseOperationsCostSheetPayload(value).rows).toEqual(value.rows);
    expect(() => parseOperationsCostSheetPayload({ ...value, rows: [...value.rows, row({ key: "extra" })] })).toThrow();
  });
  it.each([
    ["duplicate row keys", () => ({ ...payload(), rows: [row(), row()] })],
    ["unknown root field", () => ({ ...payload(), version: 4 })],
    ["unknown setting", () => ({ ...payload(), settings: { ...payload().settings, secret: "x" } })],
    ["unknown row field", () => ({ ...payload(), rows: [{ ...row(), actualCost: 1 }] })],
    ["missing packaging cost", () => { const value: Record<string, unknown> = row(); delete value.packagingCost; return { ...payload(), rows: [value] }; }],
    ["undefined is not null", () => ({ ...payload(), rows: [row({ actualFba: undefined })] })],
    ["nonfinite input", () => ({ ...payload(), rows: [row({ productCost: Infinity })] })],
    ["NaN input", () => ({ ...payload(), rows: [row({ productCost: NaN })] })],
    ["negative cost", () => ({ ...payload(), rows: [row({ productCost: -1 })] })],
    ["zero dimension", () => ({ ...payload(), rows: [row({ widthCm: 0 })] })],
    ["numeric string saved cost", () => ({ ...payload(), rows: [{ ...row(), productCost: "10" }] })],
    ["zero FX", () => ({ ...payload(), settings: { ...payload().settings, cnyPerCurrency: 0 } })],
    ["missing confirmation", () => ({ ...payload(), settings: { cnyPerCurrency: 7, freightRate: 9 } })],
    ["malformed JSON", () => "{x"],
    ["JSON null", () => "null"],
    ["array root", () => []],
  ] as const)("rejects %s", (_name, make) => expect(() => parseOperationsCostSheetPayload(make())).toThrow());
  it("bounds UTF-8 source bytes, not only JS string length", () => {
    const padding = " ".repeat(OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES);
    expect(() => parseOperationsCostSheetPayload(padding + JSON.stringify(payload()))).toThrow("TOO_LARGE");
    const value = { ...payload(), unknown: "中".repeat(OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES / 2) };
    expect(() => parseOperationsCostSheetPayload(value)).toThrow("TOO_LARGE");
  });
  it("rejects cyclic non-JSON objects", () => {
    const value: Record<string, unknown> = payload(); value.cycle = value;
    expect(() => parseOperationsCostSheetPayload(value)).toThrow();
  });
  it("normalizes established marketplace aliases without accepting client dates or authority", () => {
    expect(OperationsCostSheetReadInputSchema.parse({ expectedWorkspaceId: 1, parentAsin: "P", storeName: "S", country: "英国站" }).country).toBe("UK");
    expect(OperationsCostSheetReadInputSchema.safeParse({ expectedWorkspaceId: 1, parentAsin: "P", storeName: "S", country: "US", asOfDate: "2026-10-17" }).success).toBe(false);
    expect(OperationsCostSheetReadInputSchema.safeParse({ expectedWorkspaceId: 1, parentAsin: "P", storeName: "S", country: "US", userId: 1 }).success).toBe(false);
  });
});

describe("source facts and compatibility", () => {
  it("keeps report lineage, original signed values and explicit fee derivation", () => {
    const fact = mapOperationsCostSheetFacts(scope, [source()])[0];
    expect(fact.actualFba).toBe(4.5);
    expect(fact.source).toMatchObject({ kind: "lingxing", id: 1, importId: 12, date: "2026-10-16", sourceKind: "uploaded_parent_asin_weekly", sourceBatchId: 8, sourceTraceId: "trace-1", sourceSchemaVersion: "v1", raw: { actualFbaUnitFee: -4.5 } });
    expect(fact.source.basis.actualFba).toContain("绝对值");
  });
  it("only derives total fee from the same source row's positive quantity", () => {
    const facts = mapOperationsCostSheetFacts(scope, [source({ actualFbaUnitFee: null, actualFbaTotalFee: -45, fbaSalesQty: 10 })]);
    expect(facts[0].actualFba).toBe(4.5);
    expect(facts[0].source.basis.actualFba).toContain("同行");
    for (const qty of [0, null, "", -1]) expect(mapOperationsCostSheetFacts(scope, [source({ actualFbaUnitFee: null, actualFbaTotalFee: -45, fbaSalesQty: qty })])[0].actualFba).toBeNull();
  });
  it("does not replace zero fees with another total, or absent fees with zero", () => {
    expect(mapOperationsCostSheetFacts(scope, [source({ actualFbaUnitFee: 0, actualFbaTotalFee: 100 })])[0].actualFba).toBe(0);
    const fact = mapOperationsCostSheetFacts(scope, [source({ actualFbaUnitFee: null, actualFbaTotalFee: null, missingColumns: ["actualFbaUnitFee", "actualFbaTotalFee"] })])[0];
    expect(fact.actualFba).toBeNull(); expect(fact.source.missingColumns).toHaveLength(2);
  });
  it("never splits multi-SKU/child aggregates, including a parent without a unique child", () => {
    const facts = mapOperationsCostSheetFacts(scope, [source({ sku: "one,two", asin: "A,B", price: 12, actualFbaUnitFee: 3 })]);
    expect(facts.map(fact => fact.key)).toEqual(["one", "two"]);
    for (const fact of facts) expect(fact).toMatchObject({ ambiguous: true, price: null, actualFba: null, source: { raw: { price: 12, actualFbaUnitFee: 3 } } });
    expect(mapOperationsCostSheetFacts(scope, [source({ sku: null, msku: null, asin: null })])[0]).toMatchObject({ key: "父级汇总", ambiguous: true, price: null });
  });
  it("retains MSKU fallback, child-only keys and alias scope identities", () => {
    expect(mapOperationsCostSheetFacts(scope, [source({ sku: "", msku: "M-1", scope: { ...scope, country: "美国" } })])[0].key).toBe("M-1");
    expect(mapOperationsCostSheetFacts(scope, [source({ sku: null, msku: null, asin: "A" })])[0].key).toBe("A");
  });
  it("labels country-inferred currency and unknown currencies explicitly", () => {
    const fact = mapOperationsCostSheetFacts(scope, [source({ currency: "" })])[0];
    expect(fact.currency).toBe("USD"); expect(fact.source.basis.currency).toContain("不是来源报表币种认证");
    const unknown = { ...scope, country: "ZZ" };
    expect(mapOperationsCostSheetFacts(unknown, [source({ scope: unknown, currency: null })])[0].currency).toBeNull();
  });
  it.each(["abc", "Infinity", "0x20", "1e9999", NaN, Infinity])("rejects corrupt report numeric value %s", value => {
    expect(() => mapOperationsCostSheetFacts(scope, [source({ price: value })])).toThrow();
  });
  it("rejects duplicate, cross-workspace and over-limit sources rather than filtering", () => {
    expect(() => mapOperationsCostSheetFacts(scope, [source(), source()])).toThrow("DUPLICATE");
    expect(() => mapOperationsCostSheetFacts(scope, [source({ scope: { ...scope, workspaceId: 2 } })])).toThrow("SCOPE");
    expect(() => mapOperationsCostSheetFacts(scope, Array.from({ length: 2001 }, (_, index) => source({ id: index + 1 })))).toThrow();
  });
  it("does not emit infinity for tiny same-row sales quantity", () => {
    expect(mapOperationsCostSheetFacts(scope, [source({ actualFbaUnitFee: null, actualFbaTotalFee: 10, fbaSalesQty: 5e-324 })])[0].actualFba).toBeNull();
  });
});

describe("complete readonly builder", () => {
  it("roundtrips native and MySQL JSON to the real result schema", () => {
    const original = buildOperationsCostSheetReadResult(input());
    const other = input(); if (other.storage.status === "saved") other.storage.record.payload = JSON.stringify(payload());
    expect(buildOperationsCostSheetReadResult(other)).toEqual(original);
    expect(OperationsCostSheetReadResultSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(original.saved).toMatchObject({ id: 30, version: 7, updatedBy: 4, updatedAt: "2026-10-16T01:02:03.000Z", payload: payload() });
    expect(original.rows[0].profit).toMatchObject({ profit: 11, commissionRate: 0.15 });
    expect(original.rows[0].profit?.margin).toBeCloseTo(55);
    expect(original.rows[0].input?.actualFba).toBe(3);
    expect(original.rows[0].fact?.actualFba).toBe(4.5); // Report fee does not silently override saved fee.
    expect(original.provenance).toMatchObject({ historyAvailable: false, sourcePriority: "latest_unambiguous_observation" });
  });
  it("normalizes real Date metadata without inventing a timezone for invalid text", () => {
    const value = input(); if (value.storage.status === "saved") value.storage.record.updatedAt = new Date("2026-10-16T01:02:03Z");
    expect(buildOperationsCostSheetReadResult(value).saved?.updatedAt).toBe("2026-10-16T01:02:03.000Z");
    if (value.storage.status === "saved") value.storage.record.updatedAt = "2026-10-16 01:02:03";
    expect(buildOperationsCostSheetReadResult(value).status).toBe("corrupt");
  });
  it("preserves all 500 orphan saved rows and every input value", () => {
    const value = input(); const saved = payload(); saved.rows = Array.from({ length: 500 }, (_, index) => row({ key: `orphan-${index}`, actualFba: index }));
    value.storage = { status: "saved", record: { id: 1, version: 1, updatedBy: 2, updatedAt: "2026-10-16T00:00:00Z", payload: saved } };
    const result = buildOperationsCostSheetReadResult(value);
    expect(result.rows).toHaveLength(501);
    const orphans = result.rows.filter(item => item.orphaned);
    expect(orphans.map(item => item.input)).toEqual(saved.rows);
    expect(orphans.every(item => item.profit === null)).toBe(true);
  });
  it("does not pick an older Lingxing report over a newer Saihu report", () => {
    const value = input(); value.sources = [source(), source({ kind: "saihu", id: 2, date: "2026-10-17", price: 25 })];
    const result = buildOperationsCostSheetReadResult(value);
    expect(result.rows[0].fact?.source.kind).toBe("saihu");
    expect(result.rows[0].observations).toHaveLength(2);
    expect(result.rows[0].sourceConflict).toBe(false);
  });
  it("prefers the latest unambiguous single-SKU observation, keeping newer aggregates", () => {
    const value = input(); value.sources = [source(), source({ id: 2, date: "2026-10-17", sku: "SKU-1,other", price: 100 })];
    const result = buildOperationsCostSheetReadResult(value);
    expect(result.rows[0].fact?.source.id).toBe(1); expect(result.rows[0].observations).toHaveLength(2);
    expect(result.rows.find(item => item.key === "other")?.profit).toBeNull();
  });
  it.each([{ price: 21 }, { actualFbaUnitFee: 3 }, { currency: "CAD" }])("refuses profit for same-day conflicting sources %j", changes => {
    const value = input(); value.sources = [source(), source({ kind: "saihu", id: 20, ...changes })];
    const result = buildOperationsCostSheetReadResult(value);
    expect(result.rows[0].sourceConflict).toBe(true); expect(result.rows[0].profit).toBeNull();
    expect(result.rows[0].observations).toHaveLength(2);
  });
  it("does not mistake equal cross-source facts for a conflict", () => {
    const value = input(); value.sources = [source(), source({ kind: "saihu", id: 20 })];
    expect(buildOperationsCostSheetReadResult(value).rows[0].sourceConflict).toBe(false);
  });
  it.each(["official_mcp_parent_weekly", "daily_snapshot_aggregate", null])("keeps Lingxing channel %s distinct from uploaded facts", sourceKind => {
    const value = input(); value.sources = [source(), source({ id: 2, sourceKind, price: 99 })];
    expect(buildOperationsCostSheetReadResult(value).rows[0]).toMatchObject({ sourceConflict: true, profit: null });
  });
  it("retains latest-import ordering inside the same explicit source channel", () => {
    const value = input(); value.sources = [source(), source({ id: 2, importId: 13, price: 99 })];
    expect(buildOperationsCostSheetReadResult(value).rows[0]).toMatchObject({ sourceConflict: false, fact: { source: { id: 2 } } });
  });
  it("blocks currency mismatch, ambiguity and missing actual input; never substitutes report FBA", () => {
    const mismatch = input(); mismatch.sources = [source({ currency: "CAD" })];
    expect(buildOperationsCostSheetReadResult(mismatch).rows[0]).toMatchObject({ currencyMismatch: true, profit: null });
    const aggregate = input(); aggregate.sources = [source({ asin: "A,B" })];
    expect(buildOperationsCostSheetReadResult(aggregate).rows[0]).toMatchObject({ ambiguous: true, profit: null });
    const absent = input(); if (absent.storage.status === "saved") absent.storage.record.payload = { ...payload(), rows: [row({ actualFba: null })] };
    expect(buildOperationsCostSheetReadResult(absent).rows[0]).toMatchObject({ profit: null, fact: { actualFba: 4.5 } });
  });
  it("distinguishes unknown source evidence from a known empty source set", () => {
    const value = input(); value.sources = null;
    expect(buildOperationsCostSheetReadResult(value)).toMatchObject({ sourceStatus: "unavailable", sourceRecordCount: null, rows: [{ orphaned: true, profit: null }] });
    value.sources = [];
    expect(buildOperationsCostSheetReadResult(value)).toMatchObject({ sourceStatus: "available", sourceRecordCount: 0, rows: [{ orphaned: true, profit: null }] });
  });
  it.each([
    ["not_saved", "not_saved"], ["not_connected", "table_missing"], ["corrupt", "invalid_payload"],
  ] as const)("keeps %s distinct without fake defaults", (status, reasonCode) => {
    const value = input(); value.storage = { status };
    const result = buildOperationsCostSheetReadResult(value);
    expect(result).toMatchObject({ status, reasonCode, saved: null });
    expect(result.rows[0]).toMatchObject({ input: null, profit: null });
  });
  it("omits bad payloads rather than returning their raw strings", () => {
    const value = input(); if (value.storage.status === "saved") value.storage.record.payload = '{"privateBadRaw":"secret"}';
    const result = buildOperationsCostSheetReadResult(value);
    expect(result).toMatchObject({ status: "corrupt", reasonCode: "invalid_payload", saved: null });
    expect(JSON.stringify(result)).not.toContain("privateBadRaw");
  });
  it("rejects the complete result for invalid/over-limit source data", () => {
    const value = input(); value.sources = Array.from({ length: 2001 }, (_, index) => source({ id: index + 1 }));
    expect(buildOperationsCostSheetReadResult(value)).toMatchObject({ status: "corrupt", reasonCode: "invalid_source", saved: null, sourceRecordCount: null, rows: [] });
  });
  it("rejects over-limit expanded output rather than silently dropping saved rows", () => {
    const value = input(); value.sources = Array.from({ length: 500 }, (_, index) => source({ id: index + 1, sku: `A-${index},B-${index},C-${index}`, asin: null }));
    expect(buildOperationsCostSheetReadResult(value)).toMatchObject({ status: "corrupt", reasonCode: "result_limit", saved: null, rows: [] });
  });
  it("refuses wrong top identity and invalid calendar dates", () => {
    expect(() => buildOperationsCostSheetReadResult({ ...input(), identity: { userId: 2, workspaceId: 3 } })).toThrow("IDENTITY");
    expect(() => buildOperationsCostSheetReadResult({ ...input(), asOfDate: "2026-02-30" })).toThrow();
  });
  it("honors saved standard-goods confirmation rather than hardcoding true", () => {
    const value = input(); const saved = payload(); saved.settings.standardGoodsConfirmed = false;
    if (value.storage.status === "saved") value.storage.record.payload = saved;
    expect(buildOperationsCostSheetReadResult(value).rows[0].estimatedFba.fee).toBeNull();
  });
  it("schema rejects omitted saved rows, invented inputs, changed identities and false empty sources", () => {
    const result = buildOperationsCostSheetReadResult(input());
    expect(OperationsCostSheetReadResultSchema.safeParse({ ...result, rows: [] }).success).toBe(false);
    expect(OperationsCostSheetReadResultSchema.safeParse({ ...result, identity: { userId: 2, workspaceId: 8 } }).success).toBe(false);
    expect(OperationsCostSheetReadResultSchema.safeParse({ ...result, sourceStatus: "unavailable", sourceRecordCount: 0 }).success).toBe(false);
    const bad = structuredClone(result); bad.rows[0].input!.actualFba = 100;
    expect(OperationsCostSheetReadResultSchema.safeParse(bad).success).toBe(false);
  });
  it("schema refuses altered derived profit, source counts and suppressed conflict flags", () => {
    const result = buildOperationsCostSheetReadResult(input());
    const modified = structuredClone(result); modified.rows[0].profit!.profit = 999;
    expect(OperationsCostSheetReadResultSchema.safeParse(modified).success).toBe(false);
    expect(OperationsCostSheetReadResultSchema.safeParse({ ...result, sourceRecordCount: 2 }).success).toBe(false);
    const value = input(); value.sources = [source(), source({ kind: "saihu", id: 20, price: 21 })];
    const conflict = buildOperationsCostSheetReadResult(value); conflict.rows[0].sourceConflict = false;
    expect(OperationsCostSheetReadResultSchema.safeParse(conflict).success).toBe(false);
  });
});

describe("pinned pure calculations", () => {
  it("keeps zero costs/fees and negative modeled profit; forecast dimensions do not enter profit", () => {
    const zero = row({ productCost: 0, packagingCost: 0, actualFreight: 0, actualFba: 0, weightKg: null, lengthCm: null });
    expect(calculateOperationsCostSheetProfit(20, 0, zero, payload().settings)).toMatchObject({ profit: 17, margin: 85 });
    expect(calculateOperationsCostSheetProfit(1, 10, zero, payload().settings)?.profit).toBe(-9.15);
    expect(calculateOperationsCostSheetProfit(20, null, zero, payload().settings)).toBeNull();
    expect(calculateOperationsCostSheetProfit(20, 3, row(), { ...payload().settings, cnyPerCurrency: 5e-324 })).toBeNull();
  });
  it("uses max(weight, volume/6000) and preserves zero freight rate", () => {
    const value = row({ weightKg: 1, lengthCm: 60, widthCm: 20, heightCm: 10 });
    expect(calculateOperationsCostSheetFreight(value, 9)).toEqual({ dimensionalKg: 2, billableKg: 2, cost: 18 });
    expect(calculateOperationsCostSheetFreight(value, 0)?.cost).toBe(0);
    expect(calculateOperationsCostSheetFreight(row({ widthCm: null }), 9)).toBeNull();
  });

  // Independent frozen fixtures from friend 383b69e shared/productCostSheet.ts.
  // Exercise EVERY table cell through the public evaluator, not its internal arrays.
  const tables = [
    { kind: "small", at: "2026-02-01", rates: [[2.43,3.32,3.58],[2.49,3.42,3.68],[2.56,3.45,3.71],[2.66,3.54,3.80],[2.77,3.68,3.94],[2.82,3.78,4.04],[2.92,3.91,4.17],[2.95,3.96,4.22]] },
    { kind: "large", at: "2026-02-01", rates: [[2.91,3.73,3.99],[3.13,3.95,4.21],[3.38,4.20,4.46],[3.78,4.60,4.86],[4.22,5.04,5.30],[4.60,5.42,5.68],[4.75,5.57,5.83],[5.00,5.82,6.08],[5.10,5.92,6.18],[5.28,6.10,6.36],[5.44,6.26,6.52],[5.85,6.67,6.93]] },
    { kind: "small", at: "2026-10-15", rates: [[2.62,3.51,3.77],[2.68,3.61,3.87],[2.76,3.65,3.91],[2.86,3.74,4.00],[2.98,3.89,4.15],[3.03,3.99,4.25],[3.14,4.13,4.39],[3.17,4.18,4.44]] },
    { kind: "large", at: "2026-10-15", rates: [[3.15,3.97,4.23],[3.39,4.21,4.47],[3.66,4.48,4.74],[4.07,4.89,5.15],[4.52,5.34,5.60],[4.91,5.73,5.99],[5.07,5.89,6.15],[5.33,6.15,6.41],[5.47,6.29,6.55],[5.67,6.49,6.75],[5.84,6.66,6.92],[6.26,7.08,7.34]] },
  ];
  const cells = tables.flatMap(table => table.rates.flatMap((rates, weightIndex) => rates.map((rate, band) => ({ ...table, rate, weightIndex, band }))));
  it.each(cells)("matches frozen $kind/$at/$weightIndex/$band", ({ kind, at, rate, weightIndex, band }) => {
    const weightLb = (weightIndex + 1) / (kind === "small" ? 8 : 4);
    const value = row({ weightKg: weightLb * 0.45359237, lengthCm: 20, widthCm: 5, heightCm: kind === "small" ? 1 : 2 });
    const fee = estimateOperationsCostSheetFba(value, [5, 20, 60][band], "US", true, at);
    expect(fee.fee).toBe(Math.round(rate * (at >= "2026-04-17" ? 1.035 : 1) * 100) / 100);
    expect(fee).toMatchObject({ asOfDate: at, ruleVersion: OPERATIONS_COST_SHEET_RULE_VERSION, currency: "USD" });
    expect(fee.reason).toContain("非最新官方认证");
  });
  it.each([
    ["2026-01-14", null], ["2026-01-15", 3.32], ["2026-04-16", 3.32],
    ["2026-04-17", 3.44], ["2026-10-14", 3.44], ["2026-10-15", 3.63],
    ["2027-01-14", 3.63], ["2027-01-15", null],
  ])("pins explicit fee date %s", (at, expected) => expect(estimateOperationsCostSheetFba(row(), 20, "US", true, at).fee).toBe(expected));
  it.each([[9.99, 2.43], [10, 3.32], [50, 3.32], [50.01, 3.58]])("preserves price boundary %s", (price, expected) => {
    expect(estimateOperationsCostSheetFba(row(), price, "US", true, "2026-02-01").fee).toBe(expected);
  });
  it("covers >3lb standard, both oversize tiers, exclusions and missing confirmation", () => {
    const standard = row({ weightKg: 4 * 0.45359237, lengthCm: 20, widthCm: 5, heightCm: 2 });
    expect(estimateOperationsCostSheetFba(standard, 20, "US", true, "2026-02-01").fee).toBe(7.29);
    const smallOversize = row({ weightKg: 2 * 0.45359237, lengthCm: 19 * 2.54, widthCm: 2 * 2.54, heightCm: 2 * 2.54 });
    expect(estimateOperationsCostSheetFba(smallOversize, 20, "US", true, "2026-02-01").fee).toBe(7.93);
    const largeOversize = row({ weightKg: 2 * 0.45359237, lengthCm: 38 * 2.54, widthCm: 2 * 2.54, heightCm: 2 * 2.54 });
    expect(estimateOperationsCostSheetFba(largeOversize, 20, "US", true, "2026-02-01").fee).toBe(9.73);
    expect(estimateOperationsCostSheetFba(row({ weightKg: 100 }), 20, "US", true, "2026-02-01").fee).toBeNull();
    expect(estimateOperationsCostSheetFba(row(), 20, "CA", true, "2026-02-01").fee).toBeNull();
    expect(estimateOperationsCostSheetFba(row(), 20, "US", false, "2026-02-01").fee).toBeNull();
  });
});
