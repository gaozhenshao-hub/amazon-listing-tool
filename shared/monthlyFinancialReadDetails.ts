import { z } from "zod";

export const MONTHLY_FINANCIAL_METRICS = ["financialProfit", "salesQty", "salesAmount", "otherIncome", "discount", "purchaseCost", "freight", "fbaFee", "commission", "advertising", "promotion", "storage", "otherFees", "refundAmount", "refundQty", "returnQty", "ld", "coupon", "vine"] as const;
export type MonthlyFinancialMetric = typeof MONTHLY_FINANCIAL_METRICS[number];
export const MONTHLY_FINANCIAL_AVERAGE_FIELDS = ["purchaseCost", "freight", "fbaFee", "commission"] as const;
export type MonthlyFinancialJson = string | number | boolean | null | MonthlyFinancialJson[] | { [key: string]: MonthlyFinancialJson };
export type MonthlyFinancialJsonObject = { [key: string]: MonthlyFinancialJson };
export const MONTHLY_FINANCIAL_LIMITS = { payloadBytes: 8 * 1024 * 1024, rows: 10_000, jsonDepth: 16, jsonNodes: 200_000, stringLength: 32768, resultBytes: 12 * 1024 * 1024, scanBatches: 200 } as const;
export type MonthlyFinancialJsonLimits = { jsonDepth: number; jsonNodes: number; stringLength: number };

/** Optional limits are for internal derived response envelopes only. Raw
 * financial payloads keep the unchanged default limits through their parser. */
export function assertMonthlyFinancialJson(value: unknown, limits: MonthlyFinancialJsonLimits = MONTHLY_FINANCIAL_LIMITS): asserts value is MonthlyFinancialJson {
  if (![limits.jsonDepth, limits.jsonNodes, limits.stringLength].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("INVALID_JSON_LIMITS");
  const queue: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (item.exit) { ancestors.delete(item.value as object); continue; }
    if (++count > limits.jsonNodes || item.depth > limits.jsonDepth) throw new Error("JSON_LIMIT");
    if (item.value === null || typeof item.value === "boolean") continue;
    if (typeof item.value === "number") { if (!Number.isFinite(item.value)) throw new Error("NONFINITE_JSON"); continue; }
    if (typeof item.value === "string") { if (item.value.length > limits.stringLength) throw new Error("STRING_LIMIT"); continue; }
    if (typeof item.value !== "object" || ancestors.has(item.value)) throw new Error("INVALID_JSON");
    ancestors.add(item.value);
    queue.push({ ...item, exit: true });
    if (!Array.isArray(item.value) && Object.getPrototypeOf(item.value) !== Object.prototype && Object.getPrototypeOf(item.value) !== null) throw new Error("INVALID_JSON_OBJECT");
    // JSON must not silently drop symbols, non-enumerable fields, accessors,
    // sparse array holes or custom array properties from native DB values.
    const descriptors = Object.getOwnPropertyDescriptors(item.value);
    if (Object.getOwnPropertySymbols(item.value).length) throw new Error("INVALID_JSON_KEY");
    if (Array.isArray(item.value) && (Object.keys(item.value).length !== item.value.length || Object.keys(item.value).some((key, index) => key !== String(index)))) throw new Error("INVALID_JSON_ARRAY");
    for (const [key, descriptor] of Object.entries(descriptors)) if (!(Array.isArray(item.value) && key === "length") && (!descriptor.enumerable || !("value" in descriptor))) throw new Error("INVALID_JSON_PROPERTY");
    for (const [key, child] of Object.entries(item.value)) {
      if (key.length > limits.stringLength) throw new Error("KEY_LIMIT");
      queue.push({ value: child, depth: item.depth + 1 });
    }
  }
}
export function monthlyFinancialJsonBytes(value: unknown, limits: MonthlyFinancialJsonLimits = MONTHLY_FINANCIAL_LIMITS) {
  assertMonthlyFinancialJson(value, limits);
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export function parseMonthlyFinancialJson(value: unknown, maxBytes: number = MONTHLY_FINANCIAL_LIMITS.payloadBytes, wireMaxBytes: number = maxBytes): MonthlyFinancialJson {
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > wireMaxBytes) throw new Error("PAYLOAD_WIRE_LIMIT");
    value = JSON.parse(value);
  }
  assertMonthlyFinancialJson(value);
  if (monthlyFinancialJsonBytes(value) > maxBytes) throw new Error("PAYLOAD_BYTE_LIMIT");
  return value;
}
export const MonthlyFinancialRawSchema = z.custom<MonthlyFinancialJsonObject>(value => {
  try { assertMonthlyFinancialJson(value); return value !== null && typeof value === "object" && !Array.isArray(value); } catch { return false; }
}, "Invalid bounded raw JSON object");
const number = z.number().finite().nullable();
export const MonthlyFinancialMetricsSchema = z.object(Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, number])) as Record<MonthlyFinancialMetric, typeof number>).strict();
export type MonthlyFinancialMetrics = z.infer<typeof MonthlyFinancialMetricsSchema>;
export const MonthlyFinancialRatioSchema = z.object({ numerator: number, denominator: number, value: number, unit: z.enum(["fraction", "amount_per_unit"]), basis: z.string(), missingReason: z.string().nullable() }).strict();
export type MonthlyFinancialRatio = z.infer<typeof MonthlyFinancialRatioSchema>;
const componentSchema = z.object({ label: z.string(), rawPath: z.string(), rawValue: number, multiplier: z.union([z.literal(1), z.literal(-1)]), value: number }).strict();
const fieldSchema = z.object({ reportedValue: number, components: z.array(componentSchema), componentTotal: number, remainder: number, aggregationBasis: z.string(), missingReason: z.string().nullable() }).strict();
const averageSchema = z.object({ numerator: number, denominator: number, value: number, reportedRows: z.number().int().nonnegative(), calculatedRows: z.number().int().nonnegative(), basis: z.string(), missingReason: z.string().nullable() }).strict();
export const MonthlyFinancialDetailsSchema = z.object({
  fields: z.object(Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, fieldSchema])) as Record<MonthlyFinancialMetric, typeof fieldSchema>).strict(),
  adOrders: z.object({ value: number, rawPaths: z.array(z.string()), aggregationBasis: z.string(), missingReason: z.string().nullable() }).strict(),
  adSales: z.object({ value: number, rawPaths: z.array(z.string()), aggregationBasis: z.string(), missingReason: z.string().nullable() }).strict(),
  ratios: z.object({ profitMargin: MonthlyFinancialRatioSchema, refundRate: MonthlyFinancialRatioSchema, returnRate: MonthlyFinancialRatioSchema, adOrderCost: MonthlyFinancialRatioSchema, acos: MonthlyFinancialRatioSchema, perUnitAdCost: MonthlyFinancialRatioSchema, aAcos: MonthlyFinancialRatioSchema, adSalesRatio: MonthlyFinancialRatioSchema }).strict(),
  averages: z.object({ purchaseCost: averageSchema, freight: averageSchema, fbaFee: averageSchema, commission: averageSchema }).strict(),
  organicSales: number,
}).strict();
export type MonthlyFinancialDetails = z.infer<typeof MonthlyFinancialDetailsSchema>;

function numeric(value: MonthlyFinancialJson | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || ["-", "--", "—"].includes(value.trim())) return null;
  const cleaned = value.trim().replace(/^\((.*)\)$/u, "-$1").replace(/[,，$￥¥\s]/gu, "");
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(cleaned) && Number.isFinite(Number(cleaned)) ? Number(cleaned) : null;
}
const sum = (values: Array<number | null>): number | null => {
  if (!values.length || values.some(value => value === null)) return null;
  const total = values.reduce<number>((total, value) => total + value!, 0);
  return Number.isFinite(total) ? total : null;
};
export function monthlyFinancialRatio(numerator: number | null, denominator: number | null, basis: string, unit: MonthlyFinancialRatio["unit"] = "fraction"): MonthlyFinancialRatio {
  const ratio = numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
  const value = ratio !== null && Number.isFinite(ratio) ? ratio : null;
  return { numerator, denominator, value, unit, basis, missingReason: value === null ? "分子或分母未知、分母非正或结果不可表示；不补零" : null };
}
function isTotalLabel(label: string) {
  const normalized = label.trim();
  return !normalized || /(?:合计|总计|小计|汇总)$/u.test(normalized) || /^(?:grand\s+total|sub[ -]?total|total|summary)$/iu.test(normalized);
}
function isWholeGroupTotal(group: string, label: string) {
  const normalized = label.trim();
  return !normalized || /^(?:合计|总计|小计|汇总|grand\s+total|sub[ -]?total|total|summary)$/iu.test(normalized) || ["合计", "总计", "小计", "汇总"].some(suffix => normalized === `${group}${suffix}`);
}
type AdditiveObservation = { path: string; label: string; value: number | null };
/** Original cells remain visible. A total is never added to its own parts. */
function selectedAdditiveValue(entries: AdditiveObservation[]) {
  const totals = entries.filter(entry => isTotalLabel(entry.label)), leaves = entries.filter(entry => !isTotalLabel(entry.label));
  let value: number | null = null, missingReason: string | null = null;
  let aggregationBasis = "同一原始分组内仅合计叶子字段，不与总计重复相加";
  if (!entries.length) missingReason = "没有可识别的原始字段";
  else if (totals.length > 1) missingReason = "同一分组存在多个合计/总计/小计/汇总，无法唯一确认，不相加";
  else if (new Set(leaves.map(entry => entry.label.trim().toLowerCase())).size !== leaves.length) missingReason = "同一分组存在重复叶子字段，无法唯一确认，不相加";
  else if (totals.length === 1) {
    aggregationBasis = leaves.length ? "唯一合计与叶子字段核对一致后，仅采用合计一次；所有原字段保留为证据" : "仅采用唯一合计一次；原表没有可核对子项";
    const total = totals[0].value, leafTotal = sum(leaves.map(entry => entry.value));
    if (total === null || leaves.length && leafTotal === null) missingReason = "合计或其叶子字段含未知/非数字值，无法核对，不补零";
    else if (leaves.length && Math.abs(total! - leafTotal!) > 1e-9 * Math.max(1, Math.abs(total!), Math.abs(leafTotal!))) missingReason = "唯一合计与叶子合计不一致，不选择其中之一，也不相加";
    else value = total;
  } else {
    value = sum(leaves.map(entry => entry.value));
    if (value === null) missingReason = "叶子字段含未知/非数字值或合计不可表示，不补零";
  }
  return { value, aggregationBasis, missingReason };
}
function classifyCell(group: string, label: string): Array<[MonthlyFinancialMetric, 1 | -1]> {
  const result: Array<[MonthlyFinancialMetric, 1 | -1]> = [];
  const add = (key: MonthlyFinancialMetric, multiplier: 1 | -1 = 1) => result.push([key, multiplier]);
  const simple: Record<string, MonthlyFinancialMetric> = { "毛利润": "financialProfit", "销量": "salesQty", "退款量": "refundQty", "退货量": "returnQty" };
  // These whole groups span several metrics. Their grand total cannot be
  // assigned to the residual "other fees" metric or any individual component.
  if (isWholeGroupTotal(group, label) && ["订单收入", "订单支出", "其余服务费", "退款"].includes(group)) return result;
  if (group === "订单支出" && isTotalLabel(label) && label.startsWith("FBA配送费")) { add("fbaFee", -1); return result; }
  if (group === "订单支出" && isTotalLabel(label) && label.startsWith("销售佣金")) { add("commission", -1); return result; }
  if (Object.hasOwn(simple, group)) add(simple[group]);
  if (group === "订单收入" && ["FBA销售额", "FBM销售额"].includes(label)) add("salesAmount");
  if (group === "其他收入" || group === "订单收入" && ["FBA买家运费", "FBM买家运费", "礼品包装费", "COD收费", "监管费"].includes(label)) add("otherIncome");
  if (group === "订单收入" && label === "促销折扣") add("discount", -1);
  if (group.startsWith("商品成本支出-采购成本")) add("purchaseCost", -1);
  if (group.startsWith("商品成本支出-头程费用")) add("freight", -1);
  if (group === "订单支出" && ["FBA配送费-非多渠道订单", "FBA配送费-多渠道订单"].includes(label) || group === "退款" && label === "FBA配送费退款") add("fbaFee", -1);
  if (group === "订单支出" && label === "销售佣金" || group === "退款" && label === "佣金退款") add("commission", -1);
  if (group === "广告花费") add("advertising", -1);
  if (group === "推广费") { add("promotion", -1); const sub: Record<string, MonthlyFinancialMetric> = { LD费: "ld", 优惠券: "coupon", Vine: "vine" }; if (Object.hasOwn(sub, label)) add(sub[label], -1); }
  if (group === "其余服务费" && /仓储/u.test(label) && !/占比/u.test(label)) add("storage", -1);
  if (group === "订单支出" && !["销售佣金", "FBA配送费-非多渠道订单", "FBA配送费-多渠道订单"].includes(label)
    || group === "其余服务费" && !/仓储|占比/u.test(label) || ["其他支出", "订单税费", "商品成本-FBM运费"].includes(group) || group.startsWith("自定义费用")
    || group === "退款" && !["FBA销售额退款", "FBM销售额退款", "佣金退款", "FBA配送费退款"].includes(label)) add("otherFees", -1);
  if (group === "退款" && ["FBA销售额退款", "FBM销售额退款"].includes(label)) add("refundAmount", -1);
  return result;
}
// Field sets pinned to friend 383b69e's monthly API adapter, not a new API call.
const apiKeys: Record<MonthlyFinancialMetric, string> = {
  financialProfit: "grossProfit", salesQty: "salesNum", salesAmount: "fbaSales fbmSales",
  otherIncome: "fbaSaleFee fbmSaleFee giftWrapFee codItemCharge regulatoryFee fbaInventoryCompensation amazonShippingReimbursement reimbursement revenue liquidationsBrokerageFee feeAdjustment fbaPerUnitFulfillmentFee fbaWeightRefundFee postageRefund buyerRecharge a2zGuaranteeRecovery adjustmentAmount subscriptionFeeCorrection adjustmentOther taxCollectedAtSource refundCommission guaranteeClaim reimbursedAmount cod netco retrochargeTax otherIncomeFee sellerRewards rentalExtensionFee",
  discount: "promotionValue", purchaseCost: "batchPurchaseCostFba batchPurchaseCostFbm batchPurchaseCostMc batchPurchaseCrpcFeeSell batchPurchaseCrpcFeeUnsell batchPurchaseApcFeeSell batchPurchaseApcFeeUnsell batchPurchaseVrpcFeeSell batchPurchaseVrpcFeeUnsell batchPurchaseDfpcFeeSell batchPurchaseDfpcFeeUnsell receivedDiffPurchase purchasePcFee",
  freight: "batchHeadtripCostFba batchHeadtripCostFbm batchHeadtripCostMc batchHeadtripCrpcFeeSell batchHeadtripCrpcFeeUnsell batchHeadtripApcFeeSell batchHeadtripApcFeeUnsell batchHeadtripVrpcFeeSell batchHeadtripVrpcFeeUnsell batchHeadtripDfpcFeeSell batchHeadtripDfpcFeeUnsell receivedDiffHeadtrip headTripPcFee",
  fbaFee: "fbaNonMultiChannelFee fbaMultiChannelFee fbaFulfillmentRefundSales", commission: "commission commissionRefundSales", advertising: "cpcSpCost cpcSdCost cpcSbvCost cpcSbFlagshipStore cpcSbCost cpcStCost cpcCrCost", promotion: "ldPromoteFee couponsPromoteFee vineEnrollmentFee",
  storage: "storageFeeReport storageFeeDiff storageLongFeeReport storageLongFeeDiff starStorageFee fbaOverageFee",
  otherFees: "amazonExclusivesFee amazonLicensingFee digitalServicesFee fbmPostageFee giftWrapChargeBack shippingChargeBack fbaTransportationFee fixedClosingFee variableClosingFee fbaWeightBasedFee codChargeBack orderOtherExpend subscriptionFee fbaDisposalFee fbaRemovalFee paidServicesFee processingFee storageTransportationFee fbaReturnFee fbaInboundConvenienceFee fbaInboundDefectFee fbaInboundCartonFee labelingFee polyBaggingFee opaqueBaggingFee bubbleWrapFee highVolumelistingFee postageBilling returnPostageFee inventoryPlacementFee compensatedClawback customerReturnHrrUnitFee reCommerceCharge amazonVatServiceFee capacityReservationFee fbaAglFee fbaShipFee refundManagementFee refundDigitalServicesFee shippingChargeRefundSales promotionRefundSales taxRefundSales otherRefundSales otherExpend orderTax customFee fbmShippingCredits",
  refundAmount: "fbaRefundSales fbmRefundSales", refundQty: "refundNum", returnQty: "returnNum", ld: "ldPromoteFee", coupon: "couponsPromoteFee", vine: "vineEnrollmentFee",
};
const apiLabels: Record<string, string> = { fbaSales: "FBA销售额", fbmSales: "FBM销售额", cpcSpCost: "SP广告", cpcSdCost: "SD广告", cpcSbvCost: "SB视频广告", cpcSbFlagshipStore: "SB旗舰店广告", cpcSbCost: "SB商品集广告", cpcStCost: "ST广告", cpcCrCost: "CR广告", ldPromoteFee: "LD / 秒杀", couponsPromoteFee: "优惠券", vineEnrollmentFee: "Vine" };

function deriveRatios(metrics: MonthlyFinancialMetrics, adOrders: number | null, adSales: number | null, currencyKnown: boolean) {
  const moneyRatio = (numerator: number | null, denominator: number | null, basis: string, unit: MonthlyFinancialRatio["unit"] = "fraction") => {
    const ratio = monthlyFinancialRatio(numerator, denominator, basis, unit);
    return currencyKnown ? ratio : { ...ratio, value: null, missingReason: "原字段币种未知或冲突；保留分子分母，不计算金额相关比值" };
  };
  return {
    profitMargin: moneyRatio(metrics.financialProfit, metrics.salesAmount, "已保存财务利润 ÷ 已保存销售额；比例为小数"),
    refundRate: monthlyFinancialRatio(metrics.refundQty, metrics.salesQty, "退款量 ÷ 销量，不是退款订单率"),
    returnRate: monthlyFinancialRatio(metrics.returnQty, metrics.salesQty, "退货量 ÷ 销量"),
    adOrderCost: moneyRatio(metrics.advertising, adOrders, "广告费 ÷ 有完整来源的广告订单量", "amount_per_unit"),
    acos: moneyRatio(metrics.advertising, adSales, "广告费 ÷ 有完整来源的广告销售额"),
    perUnitAdCost: moneyRatio(metrics.advertising, metrics.salesQty, "广告费 ÷ 销量", "amount_per_unit"),
    aAcos: moneyRatio(metrics.advertising, metrics.salesAmount, "广告费 ÷ 总销售额"),
    adSalesRatio: moneyRatio(adSales, metrics.salesAmount, "广告销售额 ÷ 总销售额"),
  };
}
export function buildMonthlyFinancialDetails(metrics: MonthlyFinancialMetrics, raw: MonthlyFinancialJsonObject, currencyKnown: boolean): MonthlyFinancialDetails {
  const fields = Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, { reportedValue: metrics[key], components: [] as z.infer<typeof componentSchema>[], componentTotal: null as number | null, remainder: null as number | null, aggregationBasis: "", missingReason: null as string | null }])) as MonthlyFinancialDetails["fields"];
  const groups = new Map<MonthlyFinancialMetric, Map<string, AdditiveObservation[]>>();
  const orders: AdditiveObservation[] = [], sales: typeof orders = [];
  const api = raw.source === "sellfox_monthly_api" && raw.api && typeof raw.api === "object" && !Array.isArray(raw.api) ? raw.api as MonthlyFinancialJsonObject : null;
  const add = (metric: MonthlyFinancialMetric, path: string, label: string, original: MonthlyFinancialJson | undefined, multiplier: 1 | -1, group = "API固定字段") => {
    const rawValue = numeric(original);
    fields[metric].components.push({ label, rawPath: path, rawValue, multiplier, value: rawValue === null ? null : rawValue * multiplier });
    const metricGroups = groups.get(metric) ?? new Map<string, AdditiveObservation[]>(), entries = metricGroups.get(group) ?? [];
    entries.push({ path, label, value: rawValue === null ? null : rawValue * multiplier }); metricGroups.set(group, entries); groups.set(metric, metricGroups);
  };
  if (api) {
    for (const key of MONTHLY_FINANCIAL_METRICS) for (const field of apiKeys[key].split(" ")) add(key, `api.${field}`, apiLabels[field] ?? field, api[field], ["financialProfit", "salesQty", "salesAmount", "otherIncome", "refundQty", "returnQty"].includes(key) ? 1 : -1);
    for (const field of ["adSpOrderNum", "adSdOrderNum", "adSbsOrderNum", "adSbvOrderNum", "adSbOrderNum", "adStOrderNum", "adCrOrderNum"]) orders.push({ path: `api.${field}`, label: field, value: numeric(api[field]) });
    for (const field of ["adSpOrderSales", "adSdOrderSales", "adSbsOrderSales", "adSbvOrderSales", "adSbOrderSales", "adStOrderSales", "adCrOrderSales"]) sales.push({ path: `api.${field}`, label: field, value: numeric(api[field]) });
    if (sales.some(item => item.value === null) && numeric(api.cpcSales) !== null) { sales.length = 0; sales.push({ path: "api.cpcSales", label: "唯一合计", value: numeric(api.cpcSales) }); }
  } else {
    for (const [path, original] of Object.entries(raw)) {
      const match = /^\d+:([^/]+)\/(.*)$/u.exec(path); if (!match) continue;
      const [, group, label] = match;
      for (const [metric, multiplier] of classifyCell(group, label)) add(metric, path, label, original, multiplier, group);
      if (group === "广告订单量") orders.push({ path, label, value: numeric(original) });
      if (group === "广告销售额") sales.push({ path, label, value: numeric(original) });
    }
  }
  for (const key of MONTHLY_FINANCIAL_METRICS) {
    const field = fields[key], selectedGroups = [...(groups.get(key)?.entries() ?? [])].map(([group, entries]) => ({ group, ...selectedAdditiveValue(entries) }));
    field.componentTotal = sum(selectedGroups.map(item => item.value));
    field.aggregationBasis = selectedGroups.length ? selectedGroups.map(item => `${item.group}：${item.aggregationBasis}`).join("；") : "未提供可识别分组，不假设为零";
    field.remainder = field.componentTotal !== null && metrics[key] !== null ? metrics[key]! - field.componentTotal : null;
    field.missingReason = field.componentTotal === null ? selectedGroups.filter(item => item.missingReason).map(item => `${item.group}：${item.missingReason}`).join("；") || "原字段缺失或含未知值；存量标准化金额不证明缺项为零" : field.remainder !== null && Math.abs(field.remainder) > 0.015 ? "存量标准化金额与可识别原字段存在差额，保留差额不强制摊分" : null;
  }
  const adOrders = { ...selectedAdditiveValue(orders), rawPaths: orders.map(item => item.path) };
  const adSales = { ...selectedAdditiveValue(sales), rawPaths: sales.map(item => item.path) };
  const averageAliases = { purchaseCost: ["平均采购成本", "平均采购费用"], freight: ["平均头程费用", "平均头程成本"], fbaFee: ["平均FBA费用", "平均FBA配送费"], commission: ["平均销售佣金", "平均佣金"] };
  const averages = Object.fromEntries(MONTHLY_FINANCIAL_AVERAGE_FIELDS.map(key => {
    const entries = Object.entries(raw).filter(([path]) => averageAliases[key].some(label => path.endsWith(`/${label}`)));
    const apiField = key === "purchaseCost" ? "avgPurchasePcFeeBatch" : key === "freight" ? "avgHeadTripPcFeeBatch" : null;
    const reported = api && apiField ? numeric(api[apiField]) : entries.length === 1 ? numeric(entries[0][1]) : null;
    const qty = metrics.salesQty;
    const numerator = reported !== null && qty !== null && qty > 0 ? reported * qty : metrics[key];
    const ratio = monthlyFinancialRatio(numerator, qty, reported !== null ? "原报表平均费用 × 本行销量 / 本行销量；汇总按销量加权" : "存量标准化费用 ÷ 本行销量（原表未提供唯一可用平均值）", "amount_per_unit");
    if (!currencyKnown) { ratio.value = null; ratio.missingReason = "来源币种未知或冲突；保留原分子分母，不计算单件费用"; }
    return [key, { numerator: ratio.numerator, denominator: ratio.denominator, value: ratio.value, reportedRows: reported !== null ? 1 : 0, calculatedRows: reported === null ? 1 : 0, basis: ratio.basis, missingReason: ratio.missingReason }];
  })) as MonthlyFinancialDetails["averages"];
  return { fields, adOrders, adSales, ratios: deriveRatios(metrics, adOrders.value, adSales.value, currencyKnown), averages, organicSales: currencyKnown && metrics.salesAmount !== null && adSales.value !== null ? metrics.salesAmount - adSales.value : null };
}

/** Sums source numerators/denominators, never averages ratios; unknown propagates. */
export function aggregateMonthlyFinancialDetails(rows: Array<{ metrics: MonthlyFinancialMetrics; details: MonthlyFinancialDetails }>, currencyKnown: boolean): { metrics: MonthlyFinancialMetrics; details: MonthlyFinancialDetails } {
  const metrics = Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, sum(rows.map(row => row.metrics[key]))])) as MonthlyFinancialMetrics;
  const details = buildMonthlyFinancialDetails(metrics, {}, currencyKnown);
  for (const key of MONTHLY_FINANCIAL_METRICS) {
    const components = rows.flatMap(row => row.details.fields[key].components);
    const componentTotal = sum(rows.map(row => row.details.fields[key].componentTotal));
    details.fields[key] = { reportedValue: metrics[key], components, componentTotal, remainder: metrics[key] !== null && componentTotal !== null ? metrics[key]! - componentTotal : null, aggregationBasis: "逐原始行先核验合计与叶子是否重叠，再合计各行已核验 componentTotal；不再次相加证据列表", missingReason: rows.some(row => row.details.fields[key].missingReason !== null) ? "至少一条来源的明细缺失、不完整或与标准化值不一致" : null };
  }
  for (const key of ["adOrders", "adSales"] as const) {
    const value = sum(rows.map(row => row.details[key].value));
    details[key] = { value, rawPaths: rows.flatMap(row => row.details[key].rawPaths), aggregationBasis: "逐原始行先核验总计与分项、每行仅采用一次，再合计各行已核验数值", missingReason: value === null ? "至少一条来源缺少完整广告分母或总计/分项存在冲突" : null };
  }
  details.ratios = deriveRatios(metrics, details.adOrders.value, details.adSales.value, currencyKnown);
  for (const key of MONTHLY_FINANCIAL_AVERAGE_FIELDS) {
    const source = rows.map(row => row.details.averages[key]);
    const numerator = sum(source.map(item => item.numerator)), denominator = sum(source.map(item => item.denominator));
    const ratio = monthlyFinancialRatio(numerator, denominator, "原表平均费用×各行销量或各行标准化费用的合计 ÷ 原销量合计；不是平均各行比例", "amount_per_unit");
    if (!currencyKnown) { ratio.value = null; ratio.missingReason = "来源币种未知或冲突；保留原分子分母，不计算单件费用"; }
    details.averages[key] = { numerator: ratio.numerator, denominator, value: ratio.value, reportedRows: source.reduce((total, item) => total + item.reportedRows, 0), calculatedRows: source.reduce((total, item) => total + item.calculatedRows, 0), basis: ratio.basis, missingReason: ratio.missingReason };
  }
  details.organicSales = currencyKnown && metrics.salesAmount !== null && details.adSales.value !== null ? metrics.salesAmount - details.adSales.value : null;
  return { metrics, details };
}
