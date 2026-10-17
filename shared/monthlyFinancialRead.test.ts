import { describe, expect, it } from "vitest";
import {
  MONTHLY_FINANCIAL_METRICS, MONTHLY_FINANCIAL_LIMITS, MonthlyFinancialReadError,
  MonthlyFinancialHistoryInputSchema, MonthlyFinancialBatchInputSchema, MonthlyFinancialSnapshotInputSchema,
  MonthlyFinancialHistoryResultSchema, MonthlyFinancialBatchResultSchema, MonthlyFinancialSnapshotResultSchema,
  parseMonthlyFinancialBatchMetadata, parseMonthlyFinancialBatch, parseMonthlyFinancialJson, monthlyFinancialJsonBytes,
  aggregateMonthlyFinancialRows, buildMonthlyFinancialDetails, monthlyFinancialRatio,
  buildMonthlyFinancialHistoryResult, buildMonthlyFinancialBatchResult, buildMonthlyFinancialSnapshotResult,
  buildMonthlyFinancialHistoryFailure, buildMonthlyFinancialBatchFailure, buildMonthlyFinancialSnapshotFailure,
  findMonthlyFinancialSnapshot,
  type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics, type MonthlyFinancialJsonObject,
} from "./monthlyFinancialRead";

const identity = { userId: 7, workspaceId: 11 };
const historyInput = { expectedWorkspaceId: 11, cursor: null, limit: 2 };
const batchInput = { expectedWorkspaceId: 11, batchId: 90, rowOffset: 0, pageSize: 2 };
const baseScope = { yearMonth: "2026-09", storeName: "店铺 A", country: "US" };
const exactScope = { ...baseScope, parentAsin: "PARENT" };
const snapshotInput = { ...baseScope, expectedWorkspaceId: 11, rowOffset: 0, pageSize: 2 };
function metrics(values: Partial<MonthlyFinancialMetrics> = {}): MonthlyFinancialMetrics {
  return { ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), ...values } as MonthlyFinancialMetrics;
}
function source(values: Record<string, unknown> = {}) {
  return { yearMonth: "2026-09", parentAsin: "PARENT", asin: "CHILD", sku: "SKU", title: "原始标题", storeName: "店铺 A", site: "美国", operator: "Owner", ...metrics({ salesQty: 10, salesAmount: 100, financialProfit: 20, advertising: 15, purchaseCost: 30 }), raw: { currency: "USD" }, ...values };
}
function record(payload = [source()], values: Partial<MonthlyFinancialBatchRecord> = {}): MonthlyFinancialBatchRecord {
  return { id: 90, workspaceId: 11, userId: 7, fileName: "月报.xlsx", fileHash: "a".repeat(64), status: "completed", createdAt: "2026-10-01 12:34:56.123000", confirmedAt: "2026-10-01 13:00:00.000000", totalRows: payload.length, skippedRows: 3, unallocatedRows: payload.filter(row => !row.parentAsin).length, months: [...new Set(payload.map(row => row.yearMonth))], fileReferenceKind: "storage", sourceRunId: null, payload, ...values };
}
const batch = (payload = [source()]) => buildMonthlyFinancialBatchResult({ identity, input: batchInput, record: record(payload) });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("complete monthly source contracts", () => {
  it("accepts exact readonly inputs and canonicalizes marketplace aliases", () => {
    expect(MonthlyFinancialHistoryInputSchema.parse(historyInput)).toEqual(historyInput);
    expect(MonthlyFinancialBatchInputSchema.parse({ ...batchInput, scope: { ...exactScope, country: "英国站" } }).scope?.country).toBe("UK");
    expect(MonthlyFinancialSnapshotInputSchema.parse({ ...snapshotInput, country: "GB" }).country).toBe("UK");
  });
  it.each([
    { ...historyInput, extra: true }, { ...historyInput, expectedWorkspaceId: 0 }, { ...historyInput, cursor: 0 }, { ...historyInput, limit: 51 },
  ])("rejects invalid history input %j", value => expect(MonthlyFinancialHistoryInputSchema.safeParse(value).success).toBe(false));
  it.each([
    { ...batchInput, scope: baseScope }, { ...batchInput, batchId: -1 }, { ...batchInput, rowOffset: -1 }, { ...batchInput, pageSize: 101 }, { ...batchInput, rowOffset: 0.5 },
    { ...snapshotInput, yearMonth: "2026-13" }, { ...snapshotInput, country: " US " }, { ...snapshotInput, storeName: "" }, { ...snapshotInput, asOfDate: "2026-10-17" },
  ])("rejects malformed row scope or page %j", value => expect(("batchId" in value ? MonthlyFinancialBatchInputSchema : MonthlyFinancialSnapshotInputSchema).safeParse(value).success).toBe(false));
  it("keeps all nineteen metrics, source identifiers and complete nested raw JSON", () => {
    const raw = { currency: "USD", untouched: { array: ["字", -3, null, { deep: true }], flag: false }, "5:订单支出/销售佣金": -12.5 };
    const saved = source({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map((key, index) => [key, index - 9])), raw });
    const parsed = parseMonthlyFinancialBatch(record([saved]));
    expect(Object.keys(parsed.rows[0].metrics)).toEqual([...MONTHLY_FINANCIAL_METRICS]);
    expect(parsed.rows[0].raw).toEqual(raw);
    expect(parsed.rows[0]).toMatchObject({ batchId: 90, rowIndex: 0, site: "美国", country: "US", operator: "Owner", allocation: "child", currency: "USD" });
    expect(parsed.rows[0].details.fields.commission.components[0]).toEqual({ label: "销售佣金", rawPath: "90:0:5:订单支出/销售佣金", rawValue: -12.5, multiplier: -1, value: 12.5 });
  });
  it("accepts native and stringified MySQL JSON without changing original cells", () => {
    const saved = record();
    expect(parseMonthlyFinancialBatch({ ...saved, payload: JSON.stringify(saved.payload), months: JSON.stringify(saved.months) })).toEqual(parseMonthlyFinancialBatch(saved));
  });
  it.each(MONTHLY_FINANCIAL_METRICS)("preserves nullable %s separately from zero", key => {
    expect(parseMonthlyFinancialBatch(record([source({ [key]: null })])).rows[0].metrics[key]).toBeNull();
    expect(parseMonthlyFinancialBatch(record([source({ [key]: 0 })])).rows[0].metrics[key]).toBe(0);
  });
  it.each(MONTHLY_FINANCIAL_METRICS)("rejects nonfinite %s instead of JSON coercion", key => {
    expect(() => parseMonthlyFinancialBatch(record([source({ [key]: Infinity })]))).toThrow(MonthlyFinancialReadError);
  });
  it.each([
    source({ surprise: true }), source({ salesQty: "10" }), source({ raw: [] }), source({ raw: null }), source({ raw: { invalid: undefined } }),
    source({ storeName: " " }), source({ yearMonth: "2026-00" }), source({ raw: new Date() }),
  ])("rejects corrupt source rows without partial output", row => expect(() => parseMonthlyFinancialBatch(record([row]))).toThrow(MonthlyFinancialReadError));
  it("rejects missing metric keys rather than filling source gaps with zero", () => {
    const row = source() as Record<string, unknown>; delete row.coupon;
    expect(() => parseMonthlyFinancialBatch(record([row as ReturnType<typeof source>]))).toThrow(MonthlyFinancialReadError);
  });
  it.each([
    { totalRows: 2 }, { unallocatedRows: 1 }, { months: ["2026-08"] }, { months: ["2026-09", "2026-09"] }, { status: "running" }, { confirmedAt: null },
  ])("rejects dishonest metadata %j", values => expect(() => parseMonthlyFinancialBatch(record(undefined, values))).toThrow(MonthlyFinancialReadError));
  it("rejects duplicate canonical month/store/market/ASIN/SKU rows", () => {
    expect(() => parseMonthlyFinancialBatch(record([source(), source({ site: "US" })]))).toThrow(/月报/);
    expect(parseMonthlyFinancialBatch(record([source(), source({ sku: "SKU-2" })])).rows).toHaveLength(2);
  });
});

describe("source provenance and database dates", () => {
  it.each(["previewing", "completed", "deleted"])("keeps status %s and database timezone uncertainty", status => {
    const metadata = parseMonthlyFinancialBatchMetadata(record(undefined, { status }));
    expect(metadata.status).toBe(status);
    expect(metadata.createdAt).toBe("2026-10-01 12:34:56.123000");
    expect(metadata.timestampBasis).toBe("database_datetime_without_timezone");
    expect(metadata).not.toHaveProperty("fileUrl");
  });
  it.each(["0000-00-00 00:00:00.000000", "2026-02-29 00:00:00.000000", "2024-02-30 00:00:00.000000", "2026-04-31 00:00:00.000000", "2026-12-01 24:00:00.000000", "2026-12-01 00:60:00.000000", "2026-12-01 00:00:60.000000", "2026-10-01T12:00:00.000Z"])("rejects invalid/assumed-zone timestamp %s", createdAt => expect(() => parseMonthlyFinancialBatchMetadata(record(undefined, { createdAt }))).toThrow(MonthlyFinancialReadError));
  it("accepts a genuine leap date without assigning UTC", () => expect(parseMonthlyFinancialBatchMetadata(record(undefined, { createdAt: "2024-02-29 23:59:59.999999" })).createdAt).toContain("2024-02-29"));
  it("differentiates uploaded bytes, mapped API JSON and unconfirmed origin", () => {
    expect(parseMonthlyFinancialBatchMetadata(record()).origin).toEqual({ kind: "uploaded_file", hashBasis: "original_file_bytes", sourceRunId: null });
    expect(parseMonthlyFinancialBatchMetadata(record(undefined, { fileReferenceKind: "saihu_sync_run", sourceRunId: 55 })).origin).toEqual({ kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: 55 });
    expect(parseMonthlyFinancialBatchMetadata(record(undefined, { fileReferenceKind: "unknown" })).origin).toEqual({ kind: "unknown", hashBasis: "unknown", sourceRunId: null });
  });
  it("can classify an internal legacy reference but never returns that URI", () => {
    const metadata = parseMonthlyFinancialBatchMetadata(record(undefined, { fileReferenceKind: undefined, fileUrl: "saihu-sync-run:51" }));
    expect(metadata.origin.sourceRunId).toBe(51); expect(JSON.stringify(metadata)).not.toContain("saihu-sync-run:");
  });
  it.each([{ fileReferenceKind: "saihu_sync_run" as const, sourceRunId: null }, { fileReferenceKind: "storage" as const, sourceRunId: 44 }, { fileHash: "short" }])("refuses inconsistent source metadata", value => expect(() => parseMonthlyFinancialBatchMetadata(record(undefined, value))).toThrow(MonthlyFinancialReadError));
  it.each([{ raw: {} }, { raw: { note: "$100" } }, { raw: { currency: null } }, { raw: { currency: "USD", api: { currency: "CNY" } } }])("never infers currency from site or apparent dollar amounts", value => {
    const row = parseMonthlyFinancialBatch(record([source(value)])).rows[0];
    expect(row.currency).toBeNull(); expect(row.details.ratios.profitMargin).toMatchObject({ numerator: 20, denominator: 100, value: null }); expect(row.metrics.financialProfit).toBe(20);
  });
  it("explicit raw currency alias is evidence, not a site default", () => {
    const row = parseMonthlyFinancialBatch(record([source({ raw: { "4:币种/": "cny" } })])).rows[0];
    expect(row.currency).toBe("CNY"); expect(row.currencyEvidence.rawPaths).toEqual(["4:币种/"]);
  });
});

describe("complete expenses and ratio bases", () => {
  const adTotalsRaw: MonthlyFinancialJsonObject = { currency: "USD", "1:广告订单量/合计": 10, "2:广告订单量/SP": 6, "3:广告订单量/SD": 4, "4:广告销售额/合计": 500, "5:广告销售额/SP": 300, "6:广告销售额/SD": 200 };
  const excelComponents: Array<[string, string, number, number]> = [
    ["salesAmount", "1:订单收入/FBA销售额", 80, 80], ["salesAmount", "2:订单收入/FBM销售额", 20, 20],
    ["otherIncome", "3:订单收入/FBA买家运费", 3, 3], ["otherIncome", "4:其他收入/赔偿", 7, 7],
    ["discount", "5:订单收入/促销折扣", -2, 2], ["purchaseCost", "6:商品成本支出-采购成本/采购", -30, 30],
    ["freight", "7:商品成本支出-头程费用/头程", -10, 10], ["fbaFee", "8:订单支出/FBA配送费-非多渠道订单", -15, 15],
    ["fbaFee", "9:退款/FBA配送费退款", 1, -1], ["commission", "10:订单支出/销售佣金", -12, 12],
    ["commission", "11:退款/佣金退款", 2, -2], ["advertising", "12:广告花费/SP广告", -5, 5],
    ["promotion", "13:推广费/LD费", -4, 4], ["ld", "13:推广费/LD费", -4, 4],
    ["coupon", "14:推广费/优惠券", -6, 6], ["vine", "15:推广费/Vine", -8, 8],
    ["storage", "16:其余服务费/月度仓储费", -3, 3], ["otherFees", "17:其余服务费/订阅费", -2, 2],
    ["otherFees", "18:其他支出/调整", 1, -1], ["otherFees", "19:退款/退款管理费", -1, 1],
    ["refundAmount", "20:退款/FBA销售额退款", -9, 9], ["refundQty", "21:退款量/", 2, 2], ["returnQty", "22:退货量/", 1, 1],
  ];
  it.each(excelComponents)("retains %s component %s and original sign", (key, path, rawValue, value) => {
    const details = buildMonthlyFinancialDetails(metrics(), { [path]: rawValue }, true);
    expect(details.fields[key as keyof MonthlyFinancialMetrics].components[0]).toMatchObject({ rawPath: path, rawValue, value });
  });
  it("unknown original cells stay null even if the legacy normalized value was zero", () => {
    const details = buildMonthlyFinancialDetails(metrics(), { "1:订单收入/FBA销售额": "", "2:订单收入/FBM销售额": "-" }, true);
    expect(details.fields.salesAmount).toMatchObject({ reportedValue: 0, componentTotal: null, remainder: null });
    expect(details.fields.salesAmount.components.map(value => value.rawValue)).toEqual([null, null]);
  });
  it("retains unfamiliar source labels without treating prototype names as metrics", () => {
    const raw = { currency: "USD", "1:constructor/未知": 123, "2:__proto__/未知": 456, "3:推广费/constructor": -7 };
    const row = parseMonthlyFinancialBatch(record([source({ raw })])).rows[0];
    expect(row.raw).toEqual(raw);
    expect(row.details.fields.promotion.componentTotal).toBe(7);
    expect(row.details.fields.ld.components).toEqual([]);
  });
  it("retains signed credits and unexplained differences, without absolute value or forced allocation", () => {
    const details = buildMonthlyFinancialDetails(metrics({ commission: 14 }), { "1:订单支出/销售佣金": -20, "2:退款/佣金退款": 5 }, true);
    expect(details.fields.commission).toMatchObject({ reportedValue: 14, componentTotal: 15, remainder: -1 });
    expect(details.fields.commission.missingReason).not.toBeNull();
  });
  it("shows all API sales, seven ad classes and three promotions without adding total plus parts", () => {
    const api = { productSales: 100, fbaSales: 80, fbmSales: 20, cpcCost: -40, cpcSpCost: -1, cpcSdCost: -2, cpcSbvCost: -3, cpcSbFlagshipStore: -4, cpcSbCost: -5, cpcStCost: -6, cpcCrCost: -7, promoteFee: -70, ldPromoteFee: -10, couponsPromoteFee: -20, vineEnrollmentFee: -30 };
    const details = buildMonthlyFinancialDetails(metrics({ salesAmount: 100, advertising: 40, promotion: 70 }), { source: "sellfox_monthly_api", api }, true);
    expect(details.fields.salesAmount.components.map(value => value.label)).toEqual(["FBA销售额", "FBM销售额"]);
    expect(details.fields.salesAmount.componentTotal).toBe(100);
    expect(details.fields.advertising.components.map(value => value.rawValue)).toEqual([-1, -2, -3, -4, -5, -6, -7]);
    expect(details.fields.advertising).toMatchObject({ componentTotal: 28, remainder: 12 });
    expect(details.fields.promotion).toMatchObject({ componentTotal: 60, remainder: 10 });
    expect(details.fields.ld.components[0].rawValue).toBe(-10);
    expect(details.fields.coupon.components[0].rawValue).toBe(-20);
    expect(details.fields.vine.components[0].rawValue).toBe(-30);
    expect(details.fields.advertising.components.map(value => value.rawPath)).not.toContain("api.cpcCost");
  });
  it("requires complete available ad numerator and denominator evidence", () => {
    const details = buildMonthlyFinancialDetails(metrics({ advertising: 30, salesAmount: 100 }), { source: "sellfox_monthly_api", api: { adSpOrderNum: 3, adSdOrderNum: 0, adSbsOrderNum: 0, adSbvOrderNum: 0, adSbOrderNum: 0, cpcSales: 60 } }, true);
    expect(details.adOrders.value).toBeNull();
    expect(details.adSales).toMatchObject({ value: 60, rawPaths: ["api.cpcSales"] });
    expect(details.ratios.acos).toMatchObject({ numerator: 30, denominator: 60, value: 0.5 });
    expect(details.ratios.adOrderCost.value).toBeNull();
  });
  it("counts a matching advertisement total and its leaves once, retaining every original path", () => {
    const details = buildMonthlyFinancialDetails(metrics({ advertising: 40, salesAmount: 1000 }), adTotalsRaw, true);
    expect(details.adOrders).toMatchObject({ value: 10, missingReason: null });
    expect(details.adSales).toMatchObject({ value: 500, missingReason: null });
    expect(details.adOrders.rawPaths).toEqual(["1:广告订单量/合计", "2:广告订单量/SP", "3:广告订单量/SD"]);
    expect(details.adOrders.aggregationBasis).toContain("仅采用合计一次");
    expect(details.ratios.adOrderCost.value).toBe(4); expect(details.ratios.acos.value).toBe(0.08); expect(details.organicSales).toBe(500);
  });
  it.each(["合计", "总计", "小计", "汇总", "Total", "Grand Total"])("recognizes explicit %s totals without adding their leaves", total => {
    expect(buildMonthlyFinancialDetails(metrics(), { [`1:广告订单量/${total}`]: 10, "2:广告订单量/SP": 6, "3:广告订单量/SD": 4 }, true).adOrders.value).toBe(10);
  });
  it.each([
    { name: "conflicting total", patch: { "1:广告订单量/合计": 11 } },
    { name: "multiple totals", patch: { "7:广告订单量/总计": 10 } },
    { name: "unknown total", patch: { "1:广告订单量/合计": "-" } },
    { name: "unknown leaf", patch: { "3:广告订单量/SD": "bad" } },
    { name: "duplicate leaf", patch: { "7:广告订单量/SP": 6 } },
  ])("makes ambiguous advertisement evidence unknown: $name", ({ patch }) => {
    const details = buildMonthlyFinancialDetails(metrics({ advertising: 40 }), { ...adTotalsRaw, ...patch }, true);
    expect(details.adOrders.value).toBeNull(); expect(details.adOrders.missingReason).not.toBeNull(); expect(details.ratios.adOrderCost.value).toBeNull();
  });
  it("does not fabricate zero when a fee total or leaf is unknown or conflicts", () => {
    for (const raw of [{ "1:广告花费/合计": -40, "2:广告花费/SP": -30, "3:广告花费/SD": -20 }, { "1:推广费/合计": -40, "2:推广费/LD": "bad" }, { "1:广告花费/合计": -40, "2:广告花费/总计": -40 }]) {
      const details = buildMonthlyFinancialDetails(metrics(), raw, true);
      const field = Object.keys(raw)[0].includes("推广费") ? details.fields.promotion : details.fields.advertising;
      expect(field.componentTotal).toBeNull(); expect(field.remainder).toBeNull(); expect(field.missingReason).not.toBeNull();
    }
  });
  it("de-duplicates fee group totals while adding genuinely separate income/cost groups", () => {
    const raw = { "1:广告花费/合计": -40, "2:广告花费/SP": -30, "3:广告花费/SD": -10, "4:其他收入/合计": 10, "5:其他收入/赔偿": 10, "6:订单收入/FBA买家运费": 3, "7:订单支出/FBA配送费-非多渠道订单": -5, "8:订单支出/FBA配送费-多渠道订单": -2, "9:订单支出/FBA配送费合计": -7, "10:退款/FBA配送费退款": 1 };
    const details = buildMonthlyFinancialDetails(metrics({ advertising: 40, otherIncome: 13, fbaFee: 6 }), raw, true);
    expect(details.fields.advertising).toMatchObject({ componentTotal: 40, remainder: 0, missingReason: null });
    expect(details.fields.advertising.components).toHaveLength(3);
    expect(details.fields.otherIncome.componentTotal).toBe(13);
    expect(details.fields.fbaFee).toMatchObject({ componentTotal: 6, remainder: 0 });
  });
  it("does not misattribute whole cross-metric expense totals to residual other fees", () => {
    const raw = { currency: "USD", "1:订单支出/合计": -100, "2:订单支出/销售佣金": -20, "3:订单支出/FBM邮资": -10, "4:其余服务费/总计": -50, "5:其余服务费/月度仓储费": -30, "6:其余服务费/订阅费": -20 };
    const result = batch([source({ raw })]);
    expect(result.rows[0].raw).toEqual(raw);
    expect(result.rows[0].details.fields.otherFees.componentTotal).toBe(30);
    expect(result.rows[0].details.fields.storage.componentTotal).toBe(30);
  });
  it("sums two already de-duplicated rows instead of resumming retained total evidence", () => {
    const raw = { ...adTotalsRaw, "7:广告花费/合计": -40, "8:广告花费/SP": -30, "9:广告花费/SD": -10 };
    const rows = [source({ asin: "A", advertising: 40, salesAmount: 1000, raw }), source({ asin: "B", advertising: 40, salesAmount: 1000, raw })];
    const parent = aggregateMonthlyFinancialRows(parseMonthlyFinancialBatch(record(rows)).rows).find(value => value.dimension === "parent")!;
    expect(parent.details.adOrders.value).toBe(20); expect(parent.details.adSales.value).toBe(1000);
    expect(parent.details.fields.advertising).toMatchObject({ componentTotal: 80, remainder: 0 });
    expect(parent.details.fields.advertising.components).toHaveLength(6);
    expect(parent.details.ratios.adOrderCost.value).toBe(4); expect(parent.details.ratios.acos.value).toBe(0.08);
    expect(parent.details.fields.advertising.aggregationBasis).toContain("不再次相加证据列表");
  });
  it("uses totals for ratios and weighted single-unit costs rather than mean row ratios", () => {
    const rows = [source({ asin: "A", salesQty: 1, salesAmount: 10, financialProfit: 5, advertising: 2, refundQty: 1, raw: { currency: "USD", "1:平均/平均采购成本": 2, "2:广告订单量/SP": 1, "3:广告销售额/SP": 5 } }), source({ asin: "B", salesQty: 9, salesAmount: 90, financialProfit: 9, advertising: 9, refundQty: 0, raw: { currency: "USD", "1:平均/平均采购成本": 4, "2:广告订单量/SP": 3, "3:广告销售额/SP": 45 } })];
    const parent = aggregateMonthlyFinancialRows(parseMonthlyFinancialBatch(record(rows)).rows).find(value => value.dimension === "parent")!;
    expect(parent.details.averages.purchaseCost).toMatchObject({ numerator: 38, denominator: 10, value: 3.8, reportedRows: 2, calculatedRows: 0 });
    expect(parent.details.ratios.profitMargin).toMatchObject({ numerator: 14, denominator: 100, value: 0.14 });
    expect(parent.details.ratios.refundRate.value).toBe(0.1);
    expect(parent.details.ratios.acos).toMatchObject({ numerator: 11, denominator: 50, value: 0.22 });
    expect(parent.details.ratios.adOrderCost.value).toBe(2.75);
    expect(parent.sourceRows).toEqual([{ batchId: 90, rowIndex: 0 }, { batchId: 90, rowIndex: 1 }]);
  });
  it("does not treat a partially available aggregate component list as a complete total", () => {
    const rows = parseMonthlyFinancialBatch(record([source({ asin: "A", raw: { currency: "USD", "1:订单收入/FBA销售额": 100 } }), source({ asin: "B" })])).rows;
    const parent = aggregateMonthlyFinancialRows(rows).find(value => value.dimension === "parent")!;
    expect(parent.details.fields.salesAmount.components).toHaveLength(1);
    expect(parent.details.fields.salesAmount.componentTotal).toBeNull();
    expect(parent.details.fields.salesAmount.remainder).toBeNull();
  });
  it.each([null, 0, -1])("does not fabricate ratios for missing/nonpositive denominator %s", denominator => expect(monthlyFinancialRatio(1, denominator, "basis").value).toBeNull());
});

describe("scope-preserving parent, child and unallocated aggregation", () => {
  it("keeps reported parent total separate from child-derived totals", () => {
    const groups = aggregateMonthlyFinancialRows(parseMonthlyFinancialBatch(record([source(), source({ asin: "", sku: "", salesAmount: 1000 })])).rows);
    const parents = groups.filter(value => value.dimension === "parent");
    expect(parents).toHaveLength(2);
    expect(parents.map(value => [value.basis, value.metrics.salesAmount])).toEqual([["child_rows", 100], ["reported_parent_row", 1000]]);
  });
  it("retains no-parent ASIN rows, blank identities, and multi-parent ambiguity as unallocated", () => {
    const parsed = parseMonthlyFinancialBatch(record([source({ asin: "A", parentAsin: "" }), source({ asin: "", parentAsin: "" }), source({ asin: "B", raw: { currency: "USD", source: "sellfox_monthly_api", api: { parentAsinList: ["P1", "P2"] } } })]));
    expect(parsed.rows.map(value => value.allocation)).toEqual(["unallocated", "unallocated", "ambiguous"]);
    const groups = aggregateMonthlyFinancialRows(parsed.rows);
    expect(groups.every(value => value.dimension === "unallocated")).toBe(true);
    expect(groups.reduce((total, value) => total + value.rowCount, 0)).toBe(3);
    expect(parsed.rows[2].raw.api).toEqual({ parentAsinList: ["P1", "P2"] });
  });
  it("never merges month, store, marketplace, currency, or unknown currency source rows", () => {
    const rows = [source(), source({ storeName: "店铺 B" }), source({ site: "UK" }), source({ yearMonth: "2026-08" }), source({ asin: "B", raw: { currency: "CNY" } }), source({ asin: "C", raw: {} }), source({ asin: "D", raw: {} })];
    const parents = aggregateMonthlyFinancialRows(parseMonthlyFinancialBatch(record(rows)).rows).filter(value => value.dimension === "parent");
    expect(parents).toHaveLength(7); expect(parents.every(value => value.rowCount === 1)).toBe(true);
  });
});

describe("real history and row pagination with disclosure boundaries", () => {
  it("keyset history preserves all statuses and paginates on real last returned id", () => {
    const result = buildMonthlyFinancialHistoryResult({ identity, input: historyInput, records: [record(undefined, { id: 93, status: "deleted" }), record(undefined, { id: 92, status: "previewing" }), record(undefined, { id: 91 })] });
    expect(result.batches.map(value => value.status)).toEqual(["deleted", "previewing"]);
    expect(result.page).toEqual({ cursor: null, limit: 2, nextCursor: 92, hasMore: true });
    const next = buildMonthlyFinancialHistoryResult({ identity, input: { ...historyInput, cursor: 92 }, records: [record(undefined, { id: 91 })] });
    expect(next.page).toEqual({ cursor: 92, limit: 2, nextCursor: null, hasMore: false });
  });
  it.each([{ records: [record(), record(undefined, { id: 91 })] }, { records: [record(), record()] }, { records: [record(undefined, { workspaceId: 12 })] }])("rejects unsorted, duplicate or cross-workspace history", ({ records }) => expect(() => buildMonthlyFinancialHistoryResult({ identity, input: historyInput, records })).toThrow(MonthlyFinancialReadError));
  it("validates the lookahead record rather than hiding malformed extra metadata", () => {
    expect(() => buildMonthlyFinancialHistoryResult({ identity, input: { ...historyInput, limit: 1 }, records: [record(), record(undefined, { id: 89, fileHash: "invalid" })] })).toThrow(MonthlyFinancialReadError);
  });
  it("pages original rows while aggregates retain exact full matched-scope membership", () => {
    const saved = record([source({ asin: "A" }), source({ asin: "B" }), source({ asin: "C" })]);
    const first = buildMonthlyFinancialBatchResult({ identity, input: batchInput, record: saved });
    expect(first.rows.map(value => value.rowIndex)).toEqual([0, 1]);
    expect(first.page).toEqual({ rowOffset: 0, pageSize: 2, totalRows: 3, matchedRows: 3, nextOffset: 2, hasMore: true });
    expect(first.aggregates.find(value => value.dimension === "parent")?.rowCount).toBe(3);
    const next = buildMonthlyFinancialBatchResult({ identity, input: { ...batchInput, rowOffset: 2 }, record: saved });
    expect(next.rows.map(value => value.rowIndex)).toEqual([2]); expect(next.page.nextOffset).toBeNull();
  });
  it("invalidates a corrupt row outside the requested page rather than serving partial truth", () => {
    expect(() => batch([source({ asin: "A" }), source({ asin: "B" }), source({ asin: "C", salesQty: "bad" })])).toThrow(MonthlyFinancialReadError);
  });
  it("redacts other uploader metadata and cross-scope counts, retaining exact scope provenance", () => {
    const result = buildMonthlyFinancialBatchResult({ identity, input: { ...batchInput, scope: exactScope }, record: record([source(), source({ parentAsin: "SECRET", asin: "OTHER", raw: { secret: "keep private" } })], { userId: 88, fileName: "private-name.xlsx" }), metadataVisibility: "scoped" });
    expect(result.page.totalRows).toBeNull(); expect(result.page.matchedRows).toBe(1);
    expect(result.batch).toEqual({ visibility: "scoped", id: 90, status: "completed", createdAt: "2026-10-01 12:34:56.123000", confirmedAt: "2026-10-01 13:00:00.000000", timestampBasis: "database_datetime_without_timezone" });
    expect(JSON.stringify(result)).not.toMatch(/private-name|SECRET|keep private|fileHash|skippedRows|unallocatedRows/);
  });
  it("requires explicit business scope for redacted row access", () => expect(() => buildMonthlyFinancialBatchResult({ identity, input: batchInput, record: record(), metadataVisibility: "scoped" })).toThrow(MonthlyFinancialReadError));
  it("distinguishes missing table, not found batch and valid empty import", () => {
    expect(buildMonthlyFinancialBatchResult({ identity, input: batchInput, record: null, tableMissing: true }).status).toBe("missing");
    expect(buildMonthlyFinancialBatchResult({ identity, input: batchInput, record: null }).status).toBe("not_found");
    expect(batch([])).toMatchObject({ status: "ready", rows: [], page: { totalRows: 0, matchedRows: 0 } });
  });
});

describe("latest completed whole-scope snapshot before parent/actor filtering", () => {
  it("new scope replaces all parents; cannot fill missing parent from an older batch", () => {
    const requested = { ...snapshotInput, parentAsin: "OLD-PARENT" };
    const selection = findMonthlyFinancialSnapshot([record([source({ parentAsin: "NEW-PARENT" })], { id: 92 }), record([source({ parentAsin: "OLD-PARENT" })], { id: 91 })], requested, true);
    const result = buildMonthlyFinancialSnapshotResult({ identity, input: requested, selection });
    expect(result.selectedBatchId).toBe(92); expect(result.rows).toEqual([]); expect(result.page.matchedRows).toBe(0); expect(selection.scannedBatchIds).toEqual([92]);
  });
  it("uses the newest matching month/store/site, preserving source row indexes", () => {
    const selection = findMonthlyFinancialSnapshot([record([source({ storeName: "B" })], { id: 93 }), record([source({ yearMonth: "2026-08" }), source()], { id: 92 }), record(undefined, { id: 91 })], baseScope, true);
    const result = buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection });
    expect(result.selectedBatchId).toBe(92); expect(result.rows[0].rowIndex).toBe(1); expect(result.selection.scannedCount).toBe(2);
    expect(result.winningScopes).toEqual([{ ...baseScope, batchId: 92 }]);
  });
  it("never falls back past a newer corrupt completed candidate", () => expect(() => findMonthlyFinancialSnapshot([record(undefined, { id: 92, payload: "bad" }), record(undefined, { id: 91 })], baseScope, true)).toThrow(MonthlyFinancialReadError));
  it.each(["previewing", "deleted"])("refuses an unfiltered %s candidate", status => expect(() => findMonthlyFinancialSnapshot([record(undefined, { status })], baseScope, true)).toThrow(MonthlyFinancialReadError));
  it("distinguishes exhausted search from incomplete/limited search", () => {
    expect(buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection: findMonthlyFinancialSnapshot([], baseScope, true) })).toMatchObject({ status: "not_found", selection: { complete: true } });
    expect(buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection: findMonthlyFinancialSnapshot([], baseScope, false) })).toMatchObject({ status: "invalid", selection: { complete: false } });
    expect(buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection: findMonthlyFinancialSnapshot([], baseScope, true), tableMissing: true })).toMatchObject({ status: "missing", selection: { complete: false } });
  });
  it("redacts scan counts and unrelated scopes for another uploader business owner", () => {
    const result = buildMonthlyFinancialSnapshotResult({ identity, input: { ...snapshotInput, parentAsin: "PARENT" }, selection: findMonthlyFinancialSnapshot([record(undefined, { userId: 99 })], baseScope, true), metadataVisibility: "scoped" });
    expect(result.batch?.visibility).toBe("scoped"); expect(result.page.totalRows).toBeNull(); expect(result.selection.scannedCount).toBeNull();
  });
  it("refuses a supplied selection unrelated to requested base scope", () => {
    expect(() => buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection: { selected: parseMonthlyFinancialBatch(record([source({ storeName: "B" })])), scannedBatchIds: [90], complete: true } })).toThrow(MonthlyFinancialReadError);
  });
});

describe("bounded, lossless JSON and output self-consistency", () => {
  it("accepts repeated references but rejects cycles", () => {
    const reused = { keep: [1, 2] }; expect(parseMonthlyFinancialJson({ a: reused, b: reused })).toEqual({ a: reused, b: reused });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => parseMonthlyFinancialJson(cycle)).toThrow();
  });
  it("rejects native fields that JSON would silently erase", () => {
    const sparse = Array(2), custom = Object.assign([1], { secret: 2 });
    const hidden = Object.defineProperty({}, "secret", { value: 1 });
    const accessor = Object.defineProperty({}, "secret", { get: () => 1, enumerable: true });
    for (const value of [sparse, custom, hidden, accessor, { [Symbol("secret")]: 1 }, { bad: undefined }, { bad: NaN }, { bad: 1n }]) expect(() => parseMonthlyFinancialJson(value)).toThrow();
  });
  it("enforces UTF-8 bytes, depth and node limits without truncation", () => {
    expect(monthlyFinancialJsonBytes({ value: "中" })).toBe(new TextEncoder().encode('{"value":"中"}').length);
    expect(() => parseMonthlyFinancialJson('"中文"', 7)).toThrow();
    let nested: unknown = null; for (let index = 0; index < 18; index++) nested = [nested];
    expect(() => parseMonthlyFinancialJson(nested)).toThrow();
    expect(() => parseMonthlyFinancialJson(Array(MONTHLY_FINANCIAL_LIMITS.jsonNodes + 1).fill(0))).toThrow();
  });
  it("keeps native-format whitespace wire limits separate from canonical document limits", () => {
    const nativeWire = ` ${JSON.stringify(record().payload)}${" ".repeat(MONTHLY_FINANCIAL_LIMITS.payloadBytes)}`;
    expect(parseMonthlyFinancialBatch(record(undefined, { payload: nativeWire })).rows).toHaveLength(1);
    expect(() => parseMonthlyFinancialJson("  [1]  ", 4, 8)).not.toThrow();
    expect(() => parseMonthlyFinancialJson("  [10]  ", 3, 10)).toThrow();
  });
  it.each([
    (value: ReturnType<typeof batch>) => { value.page.nextOffset = 5; },
    value => { value.page.matchedRows = 20; }, value => { value.rows[0].batchId = 91; },
    value => { value.aggregates[0].sourceRows[0].batchId = 91; }, value => { value.aggregates[0].rowCount = 10; },
    value => { value.rows[0].currency = "CNY"; }, value => { value.status = "invalid"; value.reasonCode = "bad"; value.missingReason = "bad"; },
  ])("rejects inconsistent display output instead of trusting a serialized envelope", mutate => {
    const value = clone(batch()); mutate(value); expect(MonthlyFinancialBatchResultSchema.safeParse(value).success).toBe(false);
  });
  it("rejects leaked fields under scoped metadata", () => {
    const value = buildMonthlyFinancialBatchResult({ identity, input: { ...batchInput, scope: exactScope }, record: record(), metadataVisibility: "scoped" });
    expect(MonthlyFinancialBatchResultSchema.safeParse({ ...value, batch: { ...value.batch, fileName: "secret" } }).success).toBe(false);
    expect(MonthlyFinancialBatchResultSchema.safeParse({ ...value, page: { ...value.page, totalRows: 100 } }).success).toBe(false);
  });
  it("rejects tampered history cursor and snapshot winner", () => {
    const history = buildMonthlyFinancialHistoryResult({ identity, input: historyInput, records: [record()] });
    expect(MonthlyFinancialHistoryResultSchema.safeParse({ ...history, page: { ...history.page, nextCursor: 80 } }).success).toBe(false);
    const snapshot = buildMonthlyFinancialSnapshotResult({ identity, input: snapshotInput, selection: findMonthlyFinancialSnapshot([record()], baseScope, true) });
    expect(MonthlyFinancialSnapshotResultSchema.safeParse({ ...snapshot, selectedBatchId: 2 }).success).toBe(false);
    expect(MonthlyFinancialSnapshotResultSchema.safeParse({ ...snapshot, winningScopes: [{ ...baseScope, batchId: 90, storeName: "other" }] }).success).toBe(false);
  });
  it("failure builders return no partial financial data", () => {
    const failure = { identity, status: "invalid" as const, reasonCode: "invalid_record", missingReason: "来源不能核验" };
    expect(buildMonthlyFinancialHistoryFailure({ ...failure, input: historyInput }).batches).toEqual([]);
    expect(buildMonthlyFinancialBatchFailure({ ...failure, input: batchInput }).rows).toEqual([]);
    expect(buildMonthlyFinancialSnapshotFailure({ ...failure, input: snapshotInput }).selection.complete).toBe(false);
  });
  it("rejects identity changes rather than recomputing across workspaces", () => expect(() => buildMonthlyFinancialBatchResult({ identity: { ...identity, workspaceId: 12 }, input: batchInput, record: record() })).toThrow(MonthlyFinancialReadError));
});
