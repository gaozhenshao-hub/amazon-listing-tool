import { z } from "zod";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";
import { MONTHLY_FINANCIAL_LIMITS, MonthlyFinancialReadRowSchema, MonthlyFinancialVisibleBatchMetadataSchema, MonthlyFinancialRatioSchema, monthlyFinancialRatio, monthlyFinancialJsonBytes, monthlyFinancialRowMatchesScope, type MonthlyFinancialReadRow, type MonthlyFinancialReadIdentity, type MonthlyFinancialVisibleBatchMetadata } from "./monthlyFinancialRead";
import type { ProfitBoardMonthSelection } from "./profitBoardRead";
import { OperationsBoardOwnershipSchema, validateOperationsBoardOwnershipForRows, filterOperationsBoardRowsByOperator, validateOperationsBoardOwnershipPage, type OperationsBoardOwnership } from "./operationsBoardOwnership";

/** Read-only source projection, not a frozen edition, actual receipt ledger,
 * inventory signal, task permission, current product mapping or model output. */
export const PRODUCT_BOARD_READ_LIMITS = { historyMonths: 1200, rows: 60_000, products: 60_000, resultBytes: 12 * 1024 * 1024, resultJsonNodes: 1_000_000, resultJsonDepth: 24, scanBatches: 200 } as const;
// The derived response repeats bounded source refs, per-child statistics and
// parsed fee detail. It is not one raw monthly payload: valid multi-month
// drilldowns can exceed the raw 200k-node budget while remaining under 12 MiB.
// Every original raw object is still validated by MonthlyFinancialReadRowSchema.
const resultJsonLimits = { jsonNodes: PRODUCT_BOARD_READ_LIMITS.resultJsonNodes, jsonDepth: PRODUCT_BOARD_READ_LIMITS.resultJsonDepth, stringLength: MONTHLY_FINANCIAL_LIMITS.stringLength };
const resultJsonBytes = (value: unknown) => monthlyFinancialJsonBytes(value, resultJsonLimits);
export const PRODUCT_BOARD_PERIODS = ["month", "quarter", "total"] as const;
export const PRODUCT_BOARD_SECTIONS = ["highReturns", "highProfit", "losing", "all"] as const;
export type ProductBoardPeriod = typeof PRODUCT_BOARD_PERIODS[number];
export type ProductBoardSection = typeof PRODUCT_BOARD_SECTIONS[number];
export class ProductBoardReadError extends Error { constructor(public readonly code: string) { super("产品看板来源、范围或完整性无法核验；不截断历史、不补零、不回退旧批次"); this.name = "ProductBoardReadError"; } }
const id = z.number().int().positive().safe().max(2147483647);
const text = (max = 500) => z.string().min(1).max(max).refine(value => value === value.trim());
const monthSchema = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u);
const number = z.number().finite().nullable(), currencySchema = z.string().regex(/^[A-Z]{3}$/u).nullable();
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();
const offsetSchema = z.number().int().min(0).max(PRODUCT_BOARD_READ_LIMITS.products);
export const ProductBoardReadInputSchema = z.object({ expectedWorkspaceId: id, month: monthSchema.refine(value => value >= "1000-03"), storeName: text(200), country: text(50).transform(normalizeMarketplaceCode), parentAsin: text().optional(), operatorId: id.optional(), search: z.string().max(200), highReturnsOffset: offsetSchema, highProfitOffset: offsetSchema, losingOffset: offsetSchema, allOffset: offsetSchema, pageSize: z.number().int().min(1).max(20) }).strict();
export type ProductBoardReadInput = z.infer<typeof ProductBoardReadInputSchema>;
export type ProductBoardReadIdentity = MonthlyFinancialReadIdentity;
export type ProductBoardMonthSelection = ProfitBoardMonthSelection;
const refSchema = z.object({ batchId: id, rowIndex: z.number().int().min(0).max(9999) }).strict();
export type ProductBoardSourceRef = z.infer<typeof refSchema>;
const refsSchema = z.array(refSchema).max(PRODUCT_BOARD_READ_LIMITS.rows);
const periodSchema = z.object({ start: monthSchema, end: monthSchema, months: z.array(monthSchema).min(1).max(1200) }).strict();
const periodsSchema = z.object({ month: periodSchema, quarter: periodSchema, total: periodSchema }).strict();
const coverageSchema = z.object({ start: monthSchema, end: monthSchema, expectedMonths: z.number().int().min(1).max(1200), observedMonths: z.array(monthSchema).max(1200), missingMonths: z.array(monthSchema).max(1200), unavailableMonths: z.array(monthSchema).max(1200), complete: z.boolean(), basis: z.literal("visible_original_rows_per_product_not_workspace_month_count") }).strict();
export const ProductBoardRateSchema = z.object({ status: z.enum(["observed", "partial", "missing", "ambiguous"]), salesQty: number, salesAmount: number, profit: number, returns: number, refunds: number, returnRate: MonthlyFinancialRatioSchema, refundRate: MonthlyFinancialRatioSchema, coverage: coverageSchema, sourceRows: refsSchema, missingReason: z.string().nullable() }).strict();
export type ProductBoardRate = z.infer<typeof ProductBoardRateSchema>;
const ratesSchema = z.object({ month: ProductBoardRateSchema, quarter: ProductBoardRateSchema, total: ProductBoardRateSchema }).strict();
const cashSchema = z.object({ value: number, components: z.object({ profit: number, purchase: number, freight: number }).strict(), currency: currencySchema, formula: z.literal("financialProfit + purchaseCost + freight"), accountingStatus: z.literal("derived_not_actual_receipts"), sourceRows: refsSchema, missingReason: z.string().nullable() }).strict();
export const ProductBoardFinancialSchema = z.object({ status: z.enum(["observed", "partial", "missing", "ambiguous", "unknown_currency"]), qty: number, sales: number, profit: number, purchase: number, freight: number, margin: MonthlyFinancialRatioSchema, cashProxy: cashSchema, sourceRows: refsSchema, missingReason: z.string().nullable() }).strict();
export type ProductBoardFinancial = z.infer<typeof ProductBoardFinancialSchema>;
const basisSchema = z.enum(["child_rows", "reported_parent_row", "unallocated_rows"]);
type Basis = z.infer<typeof basisSchema>;
const childSchema = z.object({ id: text(4000), asin: z.string().max(500), title: z.string().max(4000), skus: z.array(z.string().max(2000)).max(10000), financial: ProductBoardFinancialSchema, rates: ratesSchema, sourceRows: refsSchema }).strict();
export const ProductBoardProductSchema = z.object({ id: text(4000), partitionId: text(4000), parentAsin: z.string().nullable(), title: z.string().max(4000), basis: basisSchema, currency: currencySchema, financial: ProductBoardFinancialSchema, rates: ratesSchema, children: z.array(childSchema).max(PRODUCT_BOARD_READ_LIMITS.rows), sourceRows: refsSchema }).strict();
export type ProductBoardProduct = z.infer<typeof ProductBoardProductSchema>;
const pageSchema = z.object({ offset: offsetSchema, limit: z.number().int().min(1).max(20), totalProducts: z.number().int().min(0).max(PRODUCT_BOARD_READ_LIMITS.products), nextOffset: offsetSchema.nullable(), hasMore: z.boolean() }).strict();
const sectionSchema = z.object({ entries: z.array(z.object({ productId: text(4000), position: offsetSchema }).strict()).max(20), page: pageSchema, rule: z.string().min(1), analysisBasis: z.literal("all_authorized_search_matched_groups_before_pagination") }).strict();
export type ProductBoardReadSection = z.infer<typeof sectionSchema>;
const sectionsSchema = z.object({ highReturns: sectionSchema, highProfit: sectionSchema, losing: sectionSchema, all: sectionSchema }).strict();
const sourceSchema = z.object({ month: monthSchema, status: z.enum(["selected", "not_found", "not_visible"]), selectedBatchId: id.nullable(), batch: MonthlyFinancialVisibleBatchMetadataSchema.nullable(), visibleRows: z.number().int().min(0).max(10000), missingReason: z.string().nullable() }).strict();
const historySchema = z.object({ complete: z.literal(true), scannedCount: z.number().int().min(0).max(200).nullable(), visibility: z.enum(["full", "scoped"]), firstVisibleMonth: monthSchema.nullable(), sourceMeaning: z.literal("all_saved_effective_history_at_read_time_not_archived_edition") }).strict();
const resultSchema = z.object({ identity: identitySchema, request: ProductBoardReadInputSchema, ownership: OperationsBoardOwnershipSchema.optional(), status: z.enum(["ready", "missing", "not_found", "invalid"]), reasonCode: z.string().nullable(), missingReason: z.string().nullable(), history: historySchema.nullable(), periods: periodsSchema.nullable(), sources: z.array(sourceSchema).max(1200), sections: sectionsSchema, products: z.array(ProductBoardProductSchema).max(80), pageRows: z.array(MonthlyFinancialReadRowSchema).max(PRODUCT_BOARD_READ_LIMITS.rows), matchedRows: z.number().int().min(0).max(PRODUCT_BOARD_READ_LIMITS.rows), timestampBasis: z.literal("database_datetime_without_timezone") }).strict();
export const ProductBoardReadResultSchema = resultSchema.superRefine((value, ctx) => validateResult(value, message => ctx.addIssue({ code: z.ZodIssueCode.custom, message })));
export type ProductBoardReadResult = z.infer<typeof ProductBoardReadResultSchema>;
/** Math inputs deliberately contain no uploader, filename, import timestamps or
 * other live-batch metadata. Their caller must have selected and authorized the
 * complete source rows before calling this projection. */
export const ProductBoardBodySourceSchema = z.object({ month: monthSchema, status: z.enum(["selected", "not_found", "not_visible"]), selectedBatchId: id.nullable(), visibleRows: z.number().int().min(0).max(10000) }).strict();
export type ProductBoardBodySource = z.infer<typeof ProductBoardBodySourceSchema>;
export type ProductBoardBodyProjection = Pick<ProductBoardReadResult, "sections" | "products" | "pageRows" | "matchedRows"> & {
  periods: NonNullable<ProductBoardReadResult["periods"]>; firstVisibleMonth: string | null;
};

const sectionRules: Record<ProductBoardSection, string> = {
  highReturns: "子体派生父组：近三个日历月已观测销量 ≥ 50 且退货量合计/销量合计 > 8%，按退货率降序；不完整期间显式标注，不用未知补零",
  highProfit: "子体派生父组：当月明确 USD 财务利润 > 1000，降序；其他币种不套用美元阈值，不换汇",
  losing: "子体派生父组：当月利润 < 0，各明确币种独立取亏损最多前十；分区排列，不作跨币种金额排序",
  all: "全部授权且搜索匹配的完整父组及独立原行；含原报表父体、未分配、歧义和未知币种，不与子体合计重复相加",
};
function serial(month: string): number { monthSchema.parse(month); const [year, monthPart] = month.split("-").map(Number); return year * 12 + monthPart - 1; }
function fromSerial(value: number) { return `${Math.floor(value / 12).toString().padStart(4, "0")}-${(value % 12 + 1).toString().padStart(2, "0")}`; }
export function productBoardCalendarMonths(start: string, end: string): string[] {
  const first = serial(start), last = serial(end);
  if (first > last || last - first + 1 > PRODUCT_BOARD_READ_LIMITS.historyMonths) throw new ProductBoardReadError("history_span_limit");
  return Array.from({ length: last - first + 1 }, (_, index) => fromSerial(first + index));
}
const refKey = (ref: ProductBoardSourceRef) => `${ref.batchId}:${ref.rowIndex}`;
const refs = (rows: MonthlyFinancialReadRow[]) => rows.map(({ batchId, rowIndex }) => ({ batchId, rowIndex }));
// JSON object property order is not evidence: schema parsing and native MySQL
// JSON may reorder keys. Arrays remain ordered and every own value is checked.
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function sum(values: Array<number | null>): number | null { if (!values.length || values.some(value => value === null)) return null; const total = values.reduce<number>((total, value) => total + value!, 0); return Number.isFinite(total) ? total : null; }
function ambiguous(rows: MonthlyFinancialReadRow[], basis: Basis) { return basis === "reported_parent_row" && new Set(rows.map(row => row.yearMonth)).size !== rows.length; }
function financial(rows: MonthlyFinancialReadRow[], basis: Basis, currency: string | null): ProductBoardFinancial {
  const conflict = ambiguous(rows, basis), metric = (key: "financialProfit" | "salesQty" | "salesAmount" | "purchaseCost" | "freight") => conflict ? null : sum(rows.map(row => row.metrics[key]));
  const qty = metric("salesQty"), sales = metric("salesAmount"), profit = metric("financialProfit"), purchase = metric("purchaseCost"), freight = metric("freight"), sourceRows = refs(rows);
  const status = !rows.length ? "missing" : conflict ? "ambiguous" : currency === null ? "unknown_currency" : [qty, sales, profit, purchase, freight].some(value => value === null) ? "partial" : "observed";
  const value = currency === null || conflict ? null : sum([profit, purchase, freight]);
  return { status, qty, sales, profit, purchase, freight, margin: monthlyFinancialRatio(currency === null ? null : profit, sales, "明确同币种已保存财务利润合计 ÷ 正销售额合计；不平均百分比"), cashProxy: { value, components: { profit, purchase, freight }, currency, formula: "financialProfit + purchaseCost + freight", accountingStatus: "derived_not_actual_receipts", sourceRows, missingReason: value === null ? "金额、币种或唯一原报表依据未知；不可推算" : "仅利润+采购成本+头程的代数代理值；不是实际回款、到账或现金流" }, sourceRows, missingReason: status === "observed" ? null : status === "missing" ? "当月没有可见原行，不补零" : status === "ambiguous" ? "同月多个原报表父体合计不相加、不择一" : status === "unknown_currency" ? "来源币种不明确；每原行独立，不排名金额或推算回款" : "至少一个已保存指标未知，不补零" };
}
function rate(period: z.infer<typeof periodSchema>, rows: MonthlyFinancialReadRow[], basis: Basis, sources: ReadonlyMap<string, Pick<ProductBoardBodySource, "status">>): ProductBoardRate {
  const selected = rows.filter(row => row.yearMonth >= period.start && row.yearMonth <= period.end), observedMonths = [...new Set(selected.map(row => row.yearMonth))].sort(), missingMonths = period.months.filter(month => !observedMonths.includes(month)), unavailableMonths = period.months.filter(month => sources.get(month)?.status !== "selected");
  const conflict = ambiguous(selected, basis), metric = (key: "financialProfit" | "salesQty" | "salesAmount" | "returnQty" | "refundQty") => conflict ? null : sum(selected.map(row => row.metrics[key]));
  const salesQty = metric("salesQty"), salesAmount = metric("salesAmount"), profit = metric("financialProfit"), returns = metric("returnQty"), refunds = metric("refundQty");
  const complete = missingMonths.length === 0 && unavailableMonths.length === 0, status = !selected.length ? "missing" : conflict ? "ambiguous" : !complete || [salesQty, salesAmount, profit, returns, refunds].some(value => value === null) ? "partial" : "observed";
  return { status, salesQty, salesAmount, profit, returns, refunds, returnRate: monthlyFinancialRatio(returns, salesQty, "期间已观测退货量合计 ÷ 同期间已观测销量合计；不是百分比平均"), refundRate: monthlyFinancialRatio(refunds, salesQty, "期间已观测退款量合计 ÷ 同期间已观测销量合计；不是退款订单率"), coverage: { start: period.start, end: period.end, expectedMonths: period.months.length, observedMonths, missingMonths, unavailableMonths, complete, basis: "visible_original_rows_per_product_not_workspace_month_count" }, sourceRows: refs(selected), missingReason: status === "observed" ? null : status === "missing" ? "该产品/子体在期间没有可见原行，不解释为零" : status === "ambiguous" ? "期间含同月重复原报表父体合计，不相加" : "只展示已观测原行合计；月份未完整覆盖或指标未知，不以零补齐" };
}
function product(value: { id: string; partitionId: string; parentAsin: string | null; basis: Basis; currency: string | null; rows: MonthlyFinancialReadRow[] }, periods: z.infer<typeof periodsSchema>, sources: ReadonlyMap<string, Pick<ProductBoardBodySource, "status">>): ProductBoardProduct {
  const rates = (rows: MonthlyFinancialReadRow[]) => Object.fromEntries(PRODUCT_BOARD_PERIODS.map(key => [key, rate(periods[key], rows, value.basis, sources)])) as z.infer<typeof ratesSchema>;
  const latestTitle = (rows: MonthlyFinancialReadRow[]) => [...rows].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth) || a.rowIndex - b.rowIndex)[0]?.title ?? "";
  const childRows = new Map<string, MonthlyFinancialReadRow[]>();
  if (value.basis === "child_rows") for (const row of value.rows) { const rows = childRows.get(row.asin) ?? []; rows.push(row); childRows.set(row.asin, rows); }
  return { id: value.id, partitionId: value.partitionId, parentAsin: value.parentAsin, basis: value.basis, currency: value.currency, title: latestTitle(value.rows), financial: financial(value.rows.filter(row => row.yearMonth === periods.month.end), value.basis, value.currency), rates: rates(value.rows), children: [...childRows].sort(([a], [b]) => a.localeCompare(b)).map(([asin, rows]) => ({ id: JSON.stringify([value.id, asin]), asin, title: latestTitle(rows), skus: [...new Set(rows.map(row => row.sku))], financial: financial(rows.filter(row => row.yearMonth === periods.month.end), "child_rows", value.currency), rates: rates(rows), sourceRows: refs(rows) })), sourceRows: refs(value.rows) };
}
function checkedResult(value: unknown): ProductBoardReadResult { try { if (resultJsonBytes(value) > PRODUCT_BOARD_READ_LIMITS.resultBytes) throw new Error(); return ProductBoardReadResultSchema.parse(value); } catch (error) { if (error instanceof ProductBoardReadError) throw error; throw new ProductBoardReadError("invalid_result"); } }
function section(input: ProductBoardReadInput, key: ProductBoardSection, products: Array<{ id: string }>): ProductBoardReadSection {
  const offset = input[`${key}Offset`], values = products.slice(offset, offset + input.pageSize), hasMore = offset + values.length < products.length;
  return { entries: values.map((product, index) => ({ productId: product.id, position: offset + index })), page: { offset, limit: input.pageSize, totalProducts: products.length, nextOffset: hasMore ? offset + values.length : null, hasMore }, rule: sectionRules[key], analysisBasis: "all_authorized_search_matched_groups_before_pagination" };
}
export function buildProductBoardReadFailure(value: { identity: ProductBoardReadIdentity; input: ProductBoardReadInput; status: "missing" | "not_found" | "invalid"; reasonCode: string; missingReason: string }): ProductBoardReadResult {
  const input = ProductBoardReadInputSchema.parse(value.input);
  return checkedResult({ identity: value.identity, request: input, status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, history: null, periods: null, sources: [], sections: Object.fromEntries(PRODUCT_BOARD_SECTIONS.map(key => [key, section(input, key, [])])), products: [], pageRows: [], matchedRows: 0, timestampBasis: "database_datetime_without_timezone" });
}
function visibleMetadata(batch: NonNullable<ProductBoardMonthSelection["selection"]["selected"]>["batch"], visibility: "full" | "scoped"): MonthlyFinancialVisibleBatchMetadata { return visibility === "full" ? batch : { visibility, id: batch.id, status: batch.status, createdAt: batch.createdAt, confirmedAt: batch.confirmedAt, timestampBasis: batch.timestampBasis }; }
export function buildProductBoardReadResult(value: { identity: ProductBoardReadIdentity; input: ProductBoardReadInput; selections: ProductBoardMonthSelection[]; ownership?: OperationsBoardOwnership; history: { complete: boolean; scannedCount: number; visibility: "full" | "scoped" } }): ProductBoardReadResult {
  const input = ProductBoardReadInputSchema.parse(value.input), identity = identitySchema.parse(value.identity);
  if (identity.workspaceId !== input.expectedWorkspaceId) throw new ProductBoardReadError("identity_mismatch");
  if (!value.history.complete) return buildProductBoardReadFailure({ identity, input, status: "invalid", reasonCode: "history_incomplete", missingReason: "未证明已扫描全部有效历史，不用近三月或近六个月冒充累计，不返回部分榜单" });
  if (!Number.isInteger(value.history.scannedCount) || value.history.scannedCount < 0 || value.history.scannedCount > PRODUCT_BOARD_READ_LIMITS.scanBatches || value.selections.length > PRODUCT_BOARD_READ_LIMITS.historyMonths || new Set(value.selections.map(item => item.month)).size !== value.selections.length) throw new ProductBoardReadError("history_limit_or_duplicates");
  const selectedRows: MonthlyFinancialReadRow[] = [], sourceByMonth = new Map<string, z.infer<typeof sourceSchema>>();
  const scannedIds = new Set<number>(), selectedBatches = new Map<number, NonNullable<ProductBoardMonthSelection["selection"]["selected"]>>();
  for (const item of [...value.selections].sort((a, b) => a.month.localeCompare(b.month))) {
    if (!monthSchema.safeParse(item.month).success || item.month > input.month || !item.selection.complete || item.metadataVisibility !== value.history.visibility) throw new ProductBoardReadError("history_selection_scope");
    const { selected, scannedBatchIds } = item.selection;
    if (scannedBatchIds.length > value.history.scannedCount || scannedBatchIds.some((value, index) => !id.safeParse(value).success || index > 0 && value >= scannedBatchIds[index - 1])) throw new ProductBoardReadError("history_selection_order");
    for (const batchId of scannedBatchIds) scannedIds.add(batchId);
    if (scannedIds.size > value.history.scannedCount) throw new ProductBoardReadError("history_scan_count_mismatch");
    if (!selected) { if (item.authorizedRowRefs?.length) throw new ProductBoardReadError("authorization_without_source"); continue; }
    if (selected.batch.workspaceId !== identity.workspaceId || selected.batch.status !== "completed" || selected.batch.confirmedAt === null || selected.rows.length !== selected.batch.totalRows || scannedBatchIds.at(-1) !== selected.batch.id) throw new ProductBoardReadError("selected_batch_identity");
    // A multi-month snapshot is immutable within this read. Independent month
    // selectors must not splice different contents under one batch identity.
    const previousBatch = selectedBatches.get(selected.batch.id);
    if (previousBatch && !equal(previousBatch, selected)) throw new ProductBoardReadError("selected_batch_changed");
    selectedBatches.set(selected.batch.id, selected);
    const original = selected.rows.filter(row => monthlyFinancialRowMatchesScope(row, { yearMonth: item.month, storeName: input.storeName, country: input.country })), originalKeys = new Set(original.map(refKey)), authorized = item.authorizedRowRefs;
    if (!original.length || originalKeys.size !== original.length || original.some(row => row.batchId !== selected.batch.id) || item.metadataVisibility === "scoped" && authorized === undefined || authorized && (new Set(authorized.map(refKey)).size !== authorized.length || authorized.some(ref => !originalKeys.has(refKey(ref))))) throw new ProductBoardReadError("authorization_or_source_membership");
    const allowed = authorized ? new Set(authorized.map(refKey)) : null, rows = original.filter(row => (!allowed || allowed.has(refKey(row))) && (!input.parentAsin || row.parentAsin === input.parentAsin && !["ambiguous", "unallocated"].includes(row.allocation)));
    for (const row of rows) MonthlyFinancialReadRowSchema.parse(row);
    selectedRows.push(...rows);
    if (item.metadataVisibility === "full" || rows.length) sourceByMonth.set(item.month, { month: item.month, status: "selected", selectedBatchId: selected.batch.id, batch: visibleMetadata(selected.batch, item.metadataVisibility), visibleRows: rows.length, missingReason: null });
  }
  if (selectedRows.length > PRODUCT_BOARD_READ_LIMITS.rows) throw new ProductBoardReadError("row_limit");
  if (new Set(selectedRows.map(refKey)).size !== selectedRows.length) throw new ProductBoardReadError("duplicate_original_reference");
  let ownership: OperationsBoardOwnership | undefined, filteredRows: MonthlyFinancialReadRow[];
  try {
    ownership = value.ownership === undefined ? undefined : validateOperationsBoardOwnershipForRows(value.ownership, selectedRows, identity.userId);
    if (ownership && ownership.visibility !== value.history.visibility) throw new Error("visibility");
    filteredRows = filterOperationsBoardRowsByOperator(selectedRows, ownership, input.operatorId);
  } catch { throw new ProductBoardReadError("ownership_invalid"); }
  const body = buildProductBoardBodyProjection({ input, rows: selectedRows, filteredRows, sources: [...sourceByMonth.values()].map(({ month, status, selectedBatchId, visibleRows }) => ({ month, status, selectedBatchId, visibleRows })) });
  const { firstVisibleMonth, ...presentation } = body, start = body.periods.total.start < body.periods.quarter.start ? body.periods.total.start : body.periods.quarter.start;
  const sources = productBoardCalendarMonths(start, input.month).map(month => sourceByMonth.get(month) ?? { month, status: value.history.visibility === "full" ? "not_found" as const : "not_visible" as const, batch: null, selectedBatchId: null, visibleRows: 0, missingReason: value.history.visibility === "full" ? "该月份店铺/国家没有有效已确认快照" : "该月没有当前可见来源；不区分无源、无权或其他父体数据" });
  return checkedResult({ identity, request: input, ...(ownership ? { ownership } : {}), status: "ready", reasonCode: null, missingReason: null, history: { complete: true, scannedCount: value.history.visibility === "full" ? value.history.scannedCount : null, visibility: value.history.visibility, firstVisibleMonth, sourceMeaning: "all_saved_effective_history_at_read_time_not_archived_edition" }, sources, ...presentation, timestampBasis: "database_datetime_without_timezone" });
}

/** Shared math only: no source selection, owner directory or permission grant.
 * filteredRows must be an exact subset of rows already narrowed by the caller's
 * numeric owner policy. Retaining rows for coverage preserves the live builder's
 * pre-owner-filter history basis; an edition passes its already filtered rows. */
export function buildProductBoardBodyProjection(value: { input: ProductBoardReadInput; rows: MonthlyFinancialReadRow[]; filteredRows?: MonthlyFinancialReadRow[]; sources: ProductBoardBodySource[] }): ProductBoardBodyProjection {
  const input = ProductBoardReadInputSchema.parse(value.input), selectedRows = value.rows, filteredRows = value.filteredRows ?? selectedRows;
  if (selectedRows.length > PRODUCT_BOARD_READ_LIMITS.rows || filteredRows.length > selectedRows.length || value.sources.length > PRODUCT_BOARD_READ_LIMITS.historyMonths) throw new ProductBoardReadError("body_limit");
  const sources = value.sources.map(source => ProductBoardBodySourceSchema.parse(source)), sourcesMap = new Map(sources.map(source => [source.month, source]));
  if (sourcesMap.size !== sources.length || sources.some(source => source.month > input.month || (source.status === "selected" ? source.selectedBatchId === null : source.selectedBatchId !== null || source.visibleRows !== 0))) throw new ProductBoardReadError("body_sources");
  const originals = new Map<string, MonthlyFinancialReadRow>(), counts = new Map<string, number>();
  for (const raw of selectedRows) {
    const row = MonthlyFinancialReadRowSchema.parse(raw), source = sourcesMap.get(row.yearMonth), key = refKey(row);
    if (originals.has(key) || row.yearMonth > input.month || row.storeName !== input.storeName || row.country !== input.country || source?.status !== "selected" || source.selectedBatchId !== row.batchId
      || input.parentAsin && (row.parentAsin !== input.parentAsin || ["ambiguous", "unallocated"].includes(row.allocation))) throw new ProductBoardReadError("body_row_membership");
    originals.set(key, row); counts.set(row.yearMonth, (counts.get(row.yearMonth) ?? 0) + 1);
  }
  if ([...counts].some(([month, count]) => count > sourcesMap.get(month)!.visibleRows) || new Set(filteredRows.map(refKey)).size !== filteredRows.length
    || filteredRows.some(row => !equal(originals.get(refKey(row)), row))) throw new ProductBoardReadError("body_filtered_membership");
  const firstVisibleMonth = selectedRows.length ? selectedRows.reduce((first, row) => row.yearMonth < first ? row.yearMonth : first, input.month) : null, totalStart = firstVisibleMonth ?? input.month, quarterStart = fromSerial(serial(input.month) - 2);
  const periods = { month: { start: input.month, end: input.month, months: [input.month] }, quarter: { start: quarterStart, end: input.month, months: productBoardCalendarMonths(quarterStart, input.month) }, total: { start: totalStart, end: input.month, months: productBoardCalendarMonths(totalStart, input.month) } };
  const groups = new Map<string, { id: string; partitionId: string; parentAsin: string | null; basis: Basis; currency: string | null; rows: MonthlyFinancialReadRow[] }>();
  for (const row of filteredRows) {
    const basis: Basis = ["unallocated", "ambiguous"].includes(row.allocation) ? "unallocated_rows" : row.allocation === "parent_only" ? "reported_parent_row" : "child_rows", unknownSource = row.currency === null ? { batchId: row.batchId, rowIndex: row.rowIndex } : null;
    const partitionId = JSON.stringify([input.storeName, input.country, row.currency, basis, unknownSource]), parentAsin = basis === "unallocated_rows" ? null : row.parentAsin, key = JSON.stringify([partitionId, parentAsin, basis === "unallocated_rows" ? [row.batchId, row.rowIndex] : null]);
    const group = groups.get(key) ?? { id: key, partitionId, parentAsin, basis, currency: row.currency, rows: [] }; group.rows.push(row); groups.set(key, group);
  }
  const search = input.search.trim().toLocaleLowerCase(), matched = [...groups.values()].filter(group => !search || group.rows.some(row => [row.parentAsin, row.asin, row.sku, row.title].some(value => value.toLocaleLowerCase().includes(search)))).sort((a, b) => a.id.localeCompare(b.id));
  // Rank all authorized matching originals, but expand full all-history month
  // coverage and child drilldowns only for the four requested page unions.
  // This avoids materializing products × 1200 months before pagination.
  const candidates = matched.filter(group => group.basis === "child_rows").map(group => {
    const current = group.rows.filter(row => row.yearMonth === input.month), quarter = group.rows.filter(row => row.yearMonth >= quarterStart);
    const qty = sum(quarter.map(row => row.metrics.salesQty)), returns = sum(quarter.map(row => row.metrics.returnQty));
    return { id: group.id, partitionId: group.partitionId, currency: group.currency, profit: sum(current.map(row => row.metrics.financialProfit)), qty, returnRate: qty !== null && qty > 0 && returns !== null && Number.isFinite(returns / qty) ? returns / qty : null };
  });
  const highReturns = candidates.filter(product => product.qty !== null && product.qty >= 50 && product.returnRate !== null && product.returnRate > .08).sort((a, b) => b.returnRate! - a.returnRate! || a.id.localeCompare(b.id));
  const highProfit = candidates.filter(product => product.currency === "USD" && product.profit !== null && product.profit > 1000).sort((a, b) => b.profit! - a.profit! || a.id.localeCompare(b.id));
  const losses = new Map<string, typeof candidates>();
  for (const product of candidates) if (product.currency !== null && product.profit !== null && product.profit < 0) { const items = losses.get(product.partitionId) ?? []; items.push(product); losses.set(product.partitionId, items); }
  const losing = [...losses].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, products]) => products.sort((a, b) => a.profit! - b.profit! || a.id.localeCompare(b.id)).slice(0, 10));
  const sections = { highReturns: section(input, "highReturns", highReturns), highProfit: section(input, "highProfit", highProfit), losing: section(input, "losing", losing), all: section(input, "all", matched) }, pageIds = new Set(Object.values(sections).flatMap(section => section.entries.map(entry => entry.productId))), products = matched.filter(group => pageIds.has(group.id)).map(group => product(group, periods, sourcesMap)), pageRefs = new Set(products.flatMap(product => product.sourceRows.map(refKey)));
  const body = { firstVisibleMonth, periods, sections, products, pageRows: selectedRows.filter(row => pageRefs.has(refKey(row))), matchedRows: matched.reduce((sum, group) => sum + group.rows.length, 0) };
  if (resultJsonBytes(body) > PRODUCT_BOARD_READ_LIMITS.resultBytes) throw new ProductBoardReadError("body_result_limit");
  return body;
}

function validateResult(value: z.infer<typeof resultSchema>, issue: (message: string) => void) {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue("Workspace mismatch");
  if (value.status === "ready" ? value.reasonCode !== null || value.missingReason !== null : !value.reasonCode?.trim() || !value.missingReason?.trim()) issue("Status/reason mismatch");
  for (const key of PRODUCT_BOARD_SECTIONS) {
    const { entries, page, rule } = value.sections[key];
    if (page.offset !== value.request[`${key}Offset`] || page.limit !== value.request.pageSize || rule !== sectionRules[key] || entries.length !== Math.min(page.limit, Math.max(0, page.totalProducts - page.offset)) || entries.some((entry, index) => entry.position !== page.offset + index) || new Set(entries.map(entry => entry.productId)).size !== entries.length || page.hasMore !== (page.offset + entries.length < page.totalProducts) || page.nextOffset !== (page.hasMore ? page.offset + entries.length : null)) issue("Section page mismatch");
  }
  if (value.status !== "ready") { if (value.ownership || value.history || value.periods || value.sources.length || value.products.length || value.pageRows.length || value.matchedRows || Object.values(value.sections).some(section => section.page.totalProducts)) issue("Unavailable result may not contain partial data"); return; }
  if (!value.history || !value.periods) { issue("Complete history and periods required"); return; }
  const { history, periods } = value;
  validateOperationsBoardOwnershipPage({ ownership: value.ownership, operatorId: value.request.operatorId, userId: value.identity.userId, parentAsin: value.request.parentAsin, month: value.request.month, rows: value.pageRows, products: value.products }, issue);
  if (value.ownership && value.ownership.visibility !== history.visibility) issue("Ownership/source visibility mismatch");
  if (value.ownership && value.request.operatorId === undefined && !value.request.search.trim() && value.sections.all.page.offset === 0 && value.sections.all.entries.length === value.sections.all.page.totalProducts) {
    try { validateOperationsBoardOwnershipForRows(value.ownership, value.pageRows, value.identity.userId); } catch { issue("Complete page ownership directory does not replay original parents"); }
  }
  if ((history.visibility === "scoped") !== (history.scannedCount === null) || periods.total.start !== (history.firstVisibleMonth ?? value.request.month) || periods.month.start !== value.request.month || periods.quarter.start !== fromSerial(serial(value.request.month) - 2)) issue("History/period basis mismatch");
  for (const key of PRODUCT_BOARD_PERIODS) { try { if (periods[key].end !== value.request.month || !equal(periods[key].months, productBoardCalendarMonths(periods[key].start, periods[key].end))) issue("Calendar period mismatch"); } catch { issue("Calendar limit"); } }
  const timelineStart = periods.total.start < periods.quarter.start ? periods.total.start : periods.quarter.start;
  try { if (!equal(value.sources.map(source => source.month), productBoardCalendarMonths(timelineStart, value.request.month))) { issue("Complete visible source calendar required"); return; } } catch { issue("Source calendar limit"); return; }
  const sources = new Map(value.sources.map(source => [source.month, source]));
  for (const source of value.sources) {
    if (source.status === "selected" ? !source.batch || source.batch.status !== "completed" || source.batch.confirmedAt === null || source.selectedBatchId !== source.batch.id || source.batch.visibility !== history.visibility || source.batch.visibility === "full" && (source.batch.workspaceId !== value.identity.workspaceId || !source.batch.months.includes(source.month) || source.visibleRows > source.batch.totalRows) || source.batch.visibility === "scoped" && !source.visibleRows : source.batch !== null || source.selectedBatchId !== null || source.visibleRows !== 0 || source.status !== (history.visibility === "full" ? "not_found" : "not_visible")) issue("Source metadata/visibility mismatch");
  }
  const products = new Map(value.products.map(product => [product.id, product])), rowMap = new Map(value.pageRows.map(row => [refKey(row), row])), requestedIds = new Set(Object.values(value.sections).flatMap(section => section.entries.map(entry => entry.productId)));
  if (products.size !== value.products.length || rowMap.size !== value.pageRows.length || products.size !== requestedIds.size || [...requestedIds].some(key => !products.has(key))) issue("Section union/duplicate mismatch");
  const usedRefs = new Set<string>();
  const pageMonthCounts = new Map<string, number>();
  for (const row of value.pageRows) {
    const source = sources.get(row.yearMonth);
    pageMonthCounts.set(row.yearMonth, (pageMonthCounts.get(row.yearMonth) ?? 0) + 1);
    if (!source || source.selectedBatchId !== row.batchId || source.batch?.visibility === "full" && row.rowIndex >= source.batch.totalRows || row.storeName !== value.request.storeName || row.country !== value.request.country || value.request.parentAsin && (row.parentAsin !== value.request.parentAsin || ["ambiguous", "unallocated"].includes(row.allocation))) issue("Page row source/scope mismatch");
    if (row.country !== normalizeMarketplaceCode(row.site) || row.allocation === "child" && (!row.parentAsin || !row.asin) || row.allocation === "parent_only" && (!row.parentAsin || row.asin) || row.allocation === "unallocated" && row.parentAsin) issue("Original allocation/site mismatch");
    if ((row.currencyEvidence.status === "explicit") !== (row.currency !== null) || row.currency !== null && (row.currencyEvidence.values.length !== 1 || row.currencyEvidence.values[0] !== row.currency)) issue("Original currency evidence mismatch");
  }
  if ([...pageMonthCounts].some(([month, count]) => count > (sources.get(month)?.visibleRows ?? 0)) || value.matchedRows > value.sources.reduce((sum, source) => sum + source.visibleRows, 0) || value.sections.all.page.totalProducts > value.matchedRows || Object.values(value.sections).some(section => section.page.totalProducts > value.sections.all.page.totalProducts)) issue("Visible source/group counts inconsistent");
  for (const item of value.products) {
    const rows = item.sourceRows.map(ref => rowMap.get(refKey(ref))).filter((row): row is MonthlyFinancialReadRow => !!row);
    for (const ref of item.sourceRows) { if (usedRefs.has(refKey(ref))) issue("Original row belongs to multiple products"); usedRefs.add(refKey(ref)); }
    if (!rows.length || rows.length !== item.sourceRows.length || rows.some(row => row.currency !== item.currency || (item.basis === "unallocated_rows" ? !["unallocated", "ambiguous"].includes(row.allocation) : row.parentAsin !== item.parentAsin || row.allocation !== (item.basis === "child_rows" ? "child" : "parent_only"))) || item.currency === null && rows.length !== 1 || item.basis === "unallocated_rows" && (item.parentAsin !== null || rows.length !== 1)) issue("Product original membership mismatch");
    const unknownSource = item.currency === null && rows[0] ? { batchId: rows[0].batchId, rowIndex: rows[0].rowIndex } : null;
    const partitionId = JSON.stringify([value.request.storeName, value.request.country, item.currency, item.basis, unknownSource]), productId = JSON.stringify([partitionId, item.parentAsin, item.basis === "unallocated_rows" && rows[0] ? [rows[0].batchId, rows[0].rowIndex] : null]);
    if (item.id !== productId || item.partitionId !== partitionId || !equal(item, product({ id: item.id, partitionId, parentAsin: item.parentAsin, basis: item.basis, currency: item.currency, rows }, periods, sources))) issue("Product/child metrics, coverage, proxy or source replay mismatch");
  }
  if (usedRefs.size !== rowMap.size || [...rowMap.keys()].some(key => !usedRefs.has(key)) || value.pageRows.length > value.matchedRows || value.sections.all.page.totalProducts < value.products.length) issue("Unrequested rows or false complete counts");
  for (const key of PRODUCT_BOARD_SECTIONS) {
    const entries = value.sections[key].entries.map(entry => products.get(entry.productId)).filter((item): item is ProductBoardProduct => !!item);
    if (key === "all" && entries.some((item, index) => index > 0 && item.id.localeCompare(entries[index - 1].id) <= 0)) issue("All-products stable order mismatch");
    if (key !== "all" && entries.some(item => item.basis !== "child_rows")) issue("Non-child original group cannot enter ranking");
    if (key === "highReturns" && entries.some((item, index) => item.rates.quarter.salesQty === null || item.rates.quarter.salesQty < 50 || item.rates.quarter.returnRate.value === null || item.rates.quarter.returnRate.value <= .08 || index > 0 && item.rates.quarter.returnRate.value > entries[index - 1].rates.quarter.returnRate.value!)) issue("Return ranking rule mismatch");
    if (key === "highProfit" && entries.some((item, index) => item.currency !== "USD" || item.financial.profit === null || item.financial.profit <= 1000 || index > 0 && item.financial.profit > entries[index - 1].financial.profit!)) issue("USD profit threshold mismatch");
    if (key === "losing" && entries.some((item, index) => item.currency === null || item.financial.profit === null || item.financial.profit >= 0 || index > 0 && (item.partitionId.localeCompare(entries[index - 1].partitionId) < 0 || item.partitionId === entries[index - 1].partitionId && item.financial.profit < entries[index - 1].financial.profit!) || entries.filter(other => other.partitionId === item.partitionId).length > 10)) issue("Loss currency/ranking mismatch");
  }
  try { if (resultJsonBytes(value) > PRODUCT_BOARD_READ_LIMITS.resultBytes) issue("Result limit"); } catch { issue("Bounded JSON required"); }
}
