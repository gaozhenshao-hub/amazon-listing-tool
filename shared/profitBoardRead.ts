import { z } from "zod";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";
import { MonthlyFinancialReadRowSchema, MonthlyFinancialVisibleBatchMetadataSchema, monthlyFinancialJsonBytes, monthlyFinancialRowMatchesScope, type MonthlyFinancialReadIdentity, type MonthlyFinancialReadRow, type MonthlyFinancialSnapshotSelection, type MonthlyFinancialVisibleBatchMetadata } from "./monthlyFinancialRead";

/** Supplied, authorized historical snapshots only; no collection, writes,
 * current-product metadata reassignment or authorization from saved owners. */
export const PROFIT_BOARD_READ_LIMITS = { months: 6, rows: 60_000, products: 60_000, resultBytes: 12 * 1024 * 1024, scanBatches: 200 } as const;
export class ProfitBoardReadError extends Error { constructor(public readonly code: string) { super("利润看板来源或完整性无法核验；不截断、不补零、不回退旧批次"); this.name = "ProfitBoardReadError"; } }
const id = z.number().int().positive().safe().max(2147483647);
const text = (length = 500) => z.string().min(1).max(length).refine(value => value.trim() === value);
const monthSchema = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u);
const currencySchema = z.string().regex(/^[A-Z]{3}$/u).nullable();
const number = z.number().finite().nullable();
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type ProfitBoardReadIdentity = MonthlyFinancialReadIdentity;
export const ProfitBoardReadInputSchema = z.object({ expectedWorkspaceId: id, month: monthSchema.refine(value => value >= "1000-06"), storeName: text(200), country: text(50).transform(normalizeMarketplaceCode), parentAsin: text().optional(), search: z.string().max(200), groupOffset: z.number().int().min(0).max(PROFIT_BOARD_READ_LIMITS.products), groupLimit: z.number().int().min(1).max(50) }).strict();
export type ProfitBoardReadInput = z.infer<typeof ProfitBoardReadInputSchema>;
export const ProfitBoardSourceRefSchema = z.object({ batchId: id, rowIndex: z.number().int().min(0).max(9999) }).strict();
export type ProfitBoardSourceRef = z.infer<typeof ProfitBoardSourceRefSchema>;
const basisSchema = z.enum(["child_rows", "reported_parent_row", "unallocated_rows"]);
export type ProfitBoardBasis = z.infer<typeof basisSchema>;
export const ProfitBoardPointSchema = z.object({ month: monthSchema, status: z.enum(["observed", "partial", "missing_month", "missing_product", "not_visible", "unknown_currency", "ambiguous"]), profit: number, qty: number, sales: number, margin: number, marginBasis: z.object({ numerator: number, denominator: number, unit: z.literal("fraction"), rule: z.literal("sum_profit_divided_by_sum_sales_positive_denominator") }).strict(), sourceRows: z.array(ProfitBoardSourceRefSchema).max(PROFIT_BOARD_READ_LIMITS.rows), observedProducts: z.number().int().nonnegative(), missingProducts: z.number().int().nonnegative(), missingReason: z.string().nullable() }).strict();
export type ProfitBoardPoint = z.infer<typeof ProfitBoardPointSchema>;
const changeSchema = z.object({ delta: number, relativePercent: number, percentagePoints: number, direction: z.enum(["up", "down", "flat", "unavailable"]), transition: z.enum(["normal", "new_profit", "new_loss", "loss_to_profit", "profit_to_loss", "unavailable"]), missingReason: z.string().nullable() }).strict();
export const ProfitBoardComparisonSchema = z.object({ profit: changeSchema, qty: changeSchema, sales: changeSchema, margin: changeSchema }).strict();
const childSchema = z.object({ id: text(4000), asin: z.string().max(500), title: z.string().max(4000), skus: z.array(z.string().max(2000)).max(10000), points: z.array(ProfitBoardPointSchema).length(6), current: ProfitBoardPointSchema, previous: ProfitBoardPointSchema, comparison: ProfitBoardComparisonSchema, sourceRows: z.array(ProfitBoardSourceRefSchema).max(PROFIT_BOARD_READ_LIMITS.rows) }).strict();
export const ProfitBoardProductSchema = z.object({ id: text(4000), partitionId: text(4000), parentAsin: z.string().nullable(), title: z.string().max(4000), basis: basisSchema, currency: currencySchema, points: z.array(ProfitBoardPointSchema).length(6), current: ProfitBoardPointSchema, previous: ProfitBoardPointSchema, comparison: ProfitBoardComparisonSchema, children: z.array(childSchema).max(PROFIT_BOARD_READ_LIMITS.rows), sourceRows: z.array(ProfitBoardSourceRefSchema).max(PROFIT_BOARD_READ_LIMITS.rows) }).strict();
export type ProfitBoardProduct = z.infer<typeof ProfitBoardProductSchema>;
const rankingSchema = z.object({ productId: text(4000), productOffset: z.number().int().min(0).max(PROFIT_BOARD_READ_LIMITS.products - 1), parentAsin: z.string().nullable(), title: z.string().max(4000), currency: currencySchema, basis: basisSchema, current: ProfitBoardPointSchema, previous: ProfitBoardPointSchema, delta: z.number().finite(), sourceRows: z.array(ProfitBoardSourceRefSchema).max(PROFIT_BOARD_READ_LIMITS.rows) }).strict();
export const ProfitBoardPartitionSchema = z.object({ id: text(4000), storeName: text(200), country: text(50), currency: currencySchema, basis: basisSchema, unknownSource: ProfitBoardSourceRefSchema.nullable(), productCount: z.number().int().nonnegative(), trend: z.array(ProfitBoardPointSchema).length(6), rising: z.array(rankingSchema).max(5), falling: z.array(rankingSchema).max(5), missingReason: z.string().nullable() }).strict();
export type ProfitBoardPartition = z.infer<typeof ProfitBoardPartitionSchema>;
const sourceSchema = z.object({ month: monthSchema, status: z.enum(["selected", "not_found", "not_visible"]), batch: MonthlyFinancialVisibleBatchMetadataSchema.nullable(), selectedBatchId: id.nullable(), selection: z.object({ rule: z.literal("latest_completed_batch_per_month_store_site"), complete: z.literal(true), scannedCount: z.number().int().min(0).max(200).nullable() }).strict(), visibleRows: z.number().int().min(0).max(10000), missingReason: z.string().nullable() }).strict();
const pageSchema = z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50), totalGroups: z.number().int().min(0).max(PROFIT_BOARD_READ_LIMITS.products), totalRows: z.number().int().min(0).max(PROFIT_BOARD_READ_LIMITS.rows), nextOffset: z.number().int().nonnegative().nullable(), hasMore: z.boolean() }).strict();
const resultSchema = z.object({ identity: identitySchema, request: ProfitBoardReadInputSchema, status: z.enum(["ready", "missing", "not_found", "invalid"]), reasonCode: z.string().nullable(), missingReason: z.string().nullable(), months: z.array(monthSchema).length(6), previousMonth: monthSchema, analysisBasis: z.literal("all_authorized_search_matched_groups"), timestampBasis: z.literal("database_datetime_without_timezone"), sources: z.array(sourceSchema).max(6), partitions: z.array(ProfitBoardPartitionSchema).max(PROFIT_BOARD_READ_LIMITS.products), products: z.array(ProfitBoardProductSchema).max(50), pageRows: z.array(MonthlyFinancialReadRowSchema).max(PROFIT_BOARD_READ_LIMITS.rows), page: pageSchema }).strict();
export const ProfitBoardReadResultSchema = resultSchema.superRefine((value, ctx) => validateResult(value, message => ctx.addIssue({ code: z.ZodIssueCode.custom, message })));
export type ProfitBoardReadResult = z.infer<typeof ProfitBoardReadResultSchema>;
export type ProfitBoardMonthSelection = { month: string; selection: MonthlyFinancialSnapshotSelection; authorizedRowRefs?: ProfitBoardSourceRef[]; metadataVisibility: "full" | "scoped" };

export function profitBoardMonths(month: string): string[] {
  monthSchema.parse(month);
  const [year, part] = month.split("-").map(Number), end = year * 12 + part - 1;
  const result = Array.from({ length: 6 }, (_, index) => { const serial = end - 5 + index; return `${Math.floor(serial / 12).toString().padStart(4, "0")}-${(serial % 12 + 1).toString().padStart(2, "0")}`; });
  if (result.some(value => !monthSchema.safeParse(value).success)) throw new ProfitBoardReadError("month_range");
  return result;
}
const refKey = (value: ProfitBoardSourceRef) => `${value.batchId}:${value.rowIndex}`;
const refs = (rows: MonthlyFinancialReadRow[]) => rows.map(({ batchId, rowIndex }) => ({ batchId, rowIndex }));
const sum = (values: Array<number | null>) => { if (!values.length || values.some(value => value === null)) return null; const value = values.reduce<number>((total, value) => total + value!, 0); return Number.isFinite(value) ? value : null; };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function change(current: number | null, previous: number | null, margin = false): z.infer<typeof changeSchema> {
  if (current === null || previous === null) return { delta: null, relativePercent: null, percentagePoints: null, direction: "unavailable", transition: "unavailable", missingReason: "缺少同范围、同币种两期可比数值，不补零" };
  const delta = current - previous, relative = previous !== 0 ? delta / Math.abs(previous) * 100 : null;
  if (!Number.isFinite(delta) || relative !== null && !Number.isFinite(relative)) return change(null, null, margin);
  return { delta, relativePercent: margin ? null : relative, percentagePoints: margin ? delta * 100 : null, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat", transition: previous === 0 && delta !== 0 ? current > 0 ? "new_profit" : "new_loss" : previous < 0 && current >= 0 ? "loss_to_profit" : previous >= 0 && current < 0 ? "profit_to_loss" : "normal", missingReason: null };
}
function comparison(current: ProfitBoardPoint, previous: ProfitBoardPoint, comparable: boolean) {
  return { profit: change(comparable ? current.profit : null, comparable ? previous.profit : null), qty: change(comparable ? current.qty : null, comparable ? previous.qty : null), sales: change(comparable ? current.sales : null, comparable ? previous.sales : null), margin: change(comparable ? current.margin : null, comparable ? previous.margin : null, true) };
}
function point(month: string, rows: MonthlyFinancialReadRow[], source: z.infer<typeof sourceSchema>, currency: string | null, basis: ProfitBoardBasis): ProfitBoardPoint {
  let status: ProfitBoardPoint["status"] = rows.length ? currency === null ? "unknown_currency" : "observed" : source.status === "not_found" ? "missing_month" : source.status === "not_visible" ? "not_visible" : "missing_product";
  const ambiguous = basis === "reported_parent_row" && rows.length > 1;
  if (ambiguous) status = "ambiguous";
  const profit = ambiguous ? null : sum(rows.map(row => row.metrics.financialProfit)), sales = ambiguous ? null : sum(rows.map(row => row.metrics.salesAmount)), qty = ambiguous ? null : sum(rows.map(row => row.metrics.salesQty));
  const ratio = currency !== null && profit !== null && sales !== null && sales > 0 ? profit / sales : null, margin = ratio !== null && Number.isFinite(ratio) ? ratio : null;
  const missingReason = status === "observed" ? [profit, qty, sales].some(value => value === null) ? "存量指标含未知值，不补零；利润率仅按总利润/正销售额计算" : null : status === "ambiguous" ? "同父体同月存在多个原报表父体合计，无法唯一选择；原行全部保留，不相加" : status === "unknown_currency" ? "币种未明确，每原行独立；原金额可查，不做跨行或跨期金额比较" : status === "not_visible" ? "该月没有当前可见授权范围，不推断为零或不存在" : status === "missing_month" ? "该月份店铺/国家没有有效已确认快照" : "有效快照中该父体/子体无可见原行，不用旧批次补齐或填零";
  return { month, status, profit, qty, sales, margin, marginBasis: { numerator: profit, denominator: sales, unit: "fraction", rule: "sum_profit_divided_by_sum_sales_positive_denominator" }, sourceRows: refs(rows), observedProducts: rows.length ? 1 : 0, missingProducts: rows.length ? 0 : 1, missingReason };
}
function metadata(batch: NonNullable<MonthlyFinancialSnapshotSelection["selected"]>["batch"], visibility: "full" | "scoped"): MonthlyFinancialVisibleBatchMetadata { return visibility === "full" ? batch : { visibility, id: batch.id, status: batch.status, createdAt: batch.createdAt, confirmedAt: batch.confirmedAt, timestampBasis: batch.timestampBasis }; }
function checkedResult(value: unknown): ProfitBoardReadResult { try { if (monthlyFinancialJsonBytes(value) > PROFIT_BOARD_READ_LIMITS.resultBytes) throw new Error(); return ProfitBoardReadResultSchema.parse(value); } catch (error) { if (error instanceof ProfitBoardReadError) throw error; throw new ProfitBoardReadError("invalid_result"); } }
export function buildProfitBoardReadFailure(value: { identity: ProfitBoardReadIdentity; input: ProfitBoardReadInput; status: "missing" | "not_found" | "invalid"; reasonCode: string; missingReason: string }): ProfitBoardReadResult {
  const input = ProfitBoardReadInputSchema.parse(value.input), months = profitBoardMonths(input.month);
  return checkedResult({ identity: value.identity, request: input, status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, months, previousMonth: months[4], analysisBasis: "all_authorized_search_matched_groups", timestampBasis: "database_datetime_without_timezone", sources: [], partitions: [], products: [], pageRows: [], page: { offset: input.groupOffset, limit: input.groupLimit, totalGroups: 0, totalRows: 0, nextOffset: null, hasMore: false } });
}

// Builder and public response cross-field validation intentionally share no
// database access. The backend selects whole-scope winners and supplies current
// authorized original row references, never saved owner annotations.
function validateResult(value: z.infer<typeof resultSchema>, issue: (message: string) => void) {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId || !equal(value.months, profitBoardMonths(value.request.month)) || value.previousMonth !== value.months[4]) issue("Identity/calendar mismatch");
  if (value.status === "ready" ? value.reasonCode !== null || value.missingReason !== null : !value.reasonCode?.trim() || !value.missingReason?.trim()) issue("Status/reason mismatch");
  if (value.page.offset !== value.request.groupOffset || value.page.limit !== value.request.groupLimit) issue("Request page mismatch");
  if (value.status !== "ready") { if (value.sources.length || value.partitions.length || value.products.length || value.pageRows.length || value.page.totalGroups || value.page.totalRows || value.page.hasMore || value.page.nextOffset !== null) issue("Failure may not leak partial data"); return; }
  if (value.sources.length !== 6 || value.sources.some((source, index) => source.month !== value.months[index])) { issue("Six original month sources required"); return; }
  const sourceByMonth = new Map(value.sources.map(source => [source.month, source]));
  for (const source of value.sources) {
    if (source.status === "selected" ? !source.batch || source.batch.status !== "completed" || source.batch.confirmedAt === null || source.selectedBatchId !== source.batch.id || source.batch.visibility === "full" && source.batch.workspaceId !== value.identity.workspaceId : source.batch !== null || source.selectedBatchId !== null || source.visibleRows !== 0) issue("Source metadata mismatch");
    if (source.batch?.visibility === "scoped" && source.selection.scannedCount !== null || source.status === "not_visible" && source.selection.scannedCount !== null) issue("Scoped source count disclosure");
    if (source.batch?.visibility === "scoped" && source.visibleRows === 0 || source.batch?.visibility === "full" && (!source.batch.months.includes(source.month) || source.visibleRows > source.batch.totalRows)) issue("Visible source coverage mismatch");
  }
  const partitions = new Map(value.partitions.map(partition => [partition.id, partition]));
  if (partitions.size !== value.partitions.length || value.partitions.reduce((sum, partition) => sum + partition.productCount, 0) !== value.page.totalGroups) issue("Partition membership mismatch");
  const productIds = new Set(value.products.map(product => product.id));
  if (productIds.size !== value.products.length || value.products.length !== Math.min(value.page.limit, Math.max(0, value.page.totalGroups - value.page.offset)) || value.page.hasMore !== (value.page.offset + value.products.length < value.page.totalGroups) || value.page.nextOffset !== (value.page.hasMore ? value.page.offset + value.products.length : null)) issue("Page continuity mismatch");
  const rows = new Map(value.pageRows.map(row => [refKey(row), row]));
  if (rows.size !== value.pageRows.length) issue("Duplicate page row");
  for (const row of value.pageRows) if (!value.months.includes(row.yearMonth) || row.storeName !== value.request.storeName || row.country !== value.request.country || row.batchId !== sourceByMonth.get(row.yearMonth)?.selectedBatchId || value.request.parentAsin && row.parentAsin !== value.request.parentAsin) issue("Original row source/scope mismatch");
  const referenced = new Set<string>(), allTrendRefs = new Set<string>(), partitionRefs = new Map<string, Set<string>>(), trendMonthCounts = new Map<string, number>();
  const validatePoint = (point: ProfitBoardPoint, currency: string | null) => {
    const source = sourceByMonth.get(point.month), pointRefs = point.sourceRows.map(refKey);
    if (!source || new Set(pointRefs).size !== pointRefs.length || point.sourceRows.some(ref => ref.batchId !== source.selectedBatchId)) issue("Point original source mismatch");
    const ratio = currency !== null && point.profit !== null && point.sales !== null && point.sales > 0 ? point.profit / point.sales : null;
    if (point.marginBasis.numerator !== point.profit || point.marginBasis.denominator !== point.sales || point.margin !== (ratio !== null && Number.isFinite(ratio) ? ratio : null)) issue("Point ratio-of-sums mismatch");
    if (!point.sourceRows.length && [point.profit, point.qty, point.sales, point.margin].some(value => value !== null) || ["missing_month", "missing_product", "not_visible"].includes(point.status) && point.sourceRows.length || point.status === "ambiguous" && [point.profit, point.qty, point.sales, point.margin].some(value => value !== null)) issue("Missing/ambiguous point cannot fabricate values");
    if (currency === null && point.sourceRows.length > 1 || point.status === "unknown_currency" && currency !== null || currency === null && point.sourceRows.length && point.status !== "unknown_currency") issue("Unknown currency point merged");
  };
  for (const partition of value.partitions) {
    const sourceRefs = new Set<string>();
    for (const point of partition.trend) {
      validatePoint(point, partition.currency);
      if (point.observedProducts + point.missingProducts !== partition.productCount) issue("Trend product coverage mismatch");
      trendMonthCounts.set(point.month, (trendMonthCounts.get(point.month) ?? 0) + point.sourceRows.length);
      for (const ref of point.sourceRows) { const key = refKey(ref); if (allTrendRefs.has(key)) issue("Original source double counted across trend partitions"); allTrendRefs.add(key); sourceRefs.add(key); }
    }
    partitionRefs.set(partition.id, sourceRefs);
    if (partition.currency === null && (sourceRefs.size !== 1 || partition.productCount !== 1 || !partition.unknownSource || !sourceRefs.has(refKey(partition.unknownSource)))) issue("Unknown currency partition is not one original row");
  }
  if (allTrendRefs.size !== value.page.totalRows) issue("Full-filter original row count mismatch");
  if (value.sources.some(source => (trendMonthCounts.get(source.month) ?? 0) > source.visibleRows)) issue("Trend exceeds authorized original rows");
  for (const product of value.products) {
    const partition = partitions.get(product.partitionId);
    if (!partition || product.currency !== partition.currency || product.basis !== partition.basis || value.request.parentAsin && product.parentAsin !== value.request.parentAsin) issue("Product partition/scope mismatch");
    const original = product.sourceRows.map(ref => rows.get(refKey(ref))).filter((row): row is MonthlyFinancialReadRow => !!row);
    product.sourceRows.forEach(ref => referenced.add(refKey(ref)));
    const productRefKeys = new Set(product.sourceRows.map(refKey));
    if (original.length !== product.sourceRows.length || productRefKeys.size !== product.sourceRows.length || product.sourceRows.some(ref => !partitionRefs.get(product.partitionId)?.has(refKey(ref))) || original.some(row => row.currency !== product.currency || (product.basis === "unallocated_rows" ? !["unallocated", "ambiguous"].includes(row.allocation) : row.parentAsin !== product.parentAsin || row.allocation !== (product.basis === "child_rows" ? "child" : "parent_only")))) issue("Product original membership mismatch");
    if (product.id !== JSON.stringify([product.partitionId, product.parentAsin, product.basis === "unallocated_rows" && original[0] ? [original[0].batchId, original[0].rowIndex] : null])) issue("Product stable identity mismatch");
    const expected = value.months.map(month => point(month, original.filter(row => row.yearMonth === month), sourceByMonth.get(month)!, product.currency, product.basis));
    if (!equal(product.points, expected) || !equal(product.current, expected[5]) || !equal(product.previous, expected[4]) || !equal(product.comparison, comparison(expected[5], expected[4], product.currency !== null && product.basis !== "unallocated_rows"))) issue("Product metrics mismatch");
    const childRefs = product.children.flatMap(child => child.sourceRows.map(refKey));
    if (product.basis === "child_rows" ? childRefs.length !== original.length || new Set(childRefs).size !== original.length || childRefs.some(ref => !productRefKeys.has(ref)) : product.children.length !== 0) issue("Child coverage mismatch");
    for (const child of product.children) {
      const childRows = child.sourceRows.map(ref => rows.get(refKey(ref))).filter((row): row is MonthlyFinancialReadRow => !!row), points = value.months.map(month => point(month, childRows.filter(row => row.yearMonth === month), sourceByMonth.get(month)!, product.currency, "child_rows"));
      if (child.id !== JSON.stringify([product.id, child.asin]) || childRows.some(row => row.asin !== child.asin) || !equal(child.skus, [...new Set(childRows.map(row => row.sku))]) || !equal(child.points, points) || !equal(child.current, points[5]) || !equal(child.previous, points[4]) || !equal(child.comparison, comparison(points[5], points[4], product.currency !== null))) issue("Child metrics/source mismatch");
    }
  }
  if (referenced.size !== rows.size || [...rows.keys()].some(key => !referenced.has(key))) issue("Unrequested source row disclosure");
  for (const partition of value.partitions) {
    if (partition.id !== JSON.stringify([partition.storeName, partition.country, partition.currency, partition.basis, partition.unknownSource]) || partition.storeName !== value.request.storeName || partition.country !== value.request.country || (partition.currency === null) !== (partition.unknownSource !== null) || partition.trend.some((point, index) => point.month !== value.months[index])) issue("Partition identity/calendar mismatch");
    for (const [kind, ranking] of [["rising", partition.rising], ["falling", partition.falling]] as const) for (let index = 0; index < ranking.length; index++) {
      const rank = ranking[index];
      validatePoint(rank.current, rank.currency); validatePoint(rank.previous, rank.currency);
      const rankedRefs = new Set(rank.sourceRows.map(refKey));
      if (rankedRefs.size !== rank.sourceRows.length || rank.sourceRows.some(ref => !partitionRefs.get(partition.id)?.has(refKey(ref))) || [...rank.current.sourceRows, ...rank.previous.sourceRows].some(ref => !rankedRefs.has(refKey(ref))) || ranking.some((other, otherIndex) => otherIndex !== index && other.productId === rank.productId)) issue("Ranking source membership mismatch");
      if (rank.productId !== JSON.stringify([partition.id, rank.parentAsin, null]) || value.request.parentAsin && rank.parentAsin !== value.request.parentAsin) issue("Ranking product identity mismatch");
      if (rank.productOffset >= value.page.offset && rank.productOffset < value.page.offset + value.products.length) {
        const product = value.products[rank.productOffset - value.page.offset];
        if (rank.productId !== product.id || !equal(rank.current, product.current) || !equal(rank.previous, product.previous) || !equal(rank.sourceRows, product.sourceRows)) issue("Ranking page locator mismatch");
      }
      if (rank.currency !== partition.currency || rank.basis !== partition.basis || partition.currency === null || partition.basis === "unallocated_rows" || rank.productOffset >= value.page.totalGroups || rank.current.month !== value.request.month || rank.previous.month !== value.previousMonth || rank.current.profit === null || rank.previous.profit === null || rank.delta !== rank.current.profit - rank.previous.profit || (kind === "rising" ? rank.delta <= 0 : rank.delta >= 0) || index > 0 && (kind === "rising" ? rank.delta > ranking[index - 1].delta : rank.delta < ranking[index - 1].delta)) issue("Ranking comparison mismatch");
    }
  }
  try { if (monthlyFinancialJsonBytes(value) > PROFIT_BOARD_READ_LIMITS.resultBytes) issue("Result limit"); } catch { issue("Bounded JSON required"); }
}

export function buildProfitBoardReadResult(value: { identity: ProfitBoardReadIdentity; input: ProfitBoardReadInput; selections: ProfitBoardMonthSelection[] }): ProfitBoardReadResult {
  const input = ProfitBoardReadInputSchema.parse(value.input), identity = identitySchema.parse(value.identity), months = profitBoardMonths(input.month);
  if (identity.workspaceId !== input.expectedWorkspaceId || value.selections.length !== 6 || new Set(value.selections.map(item => item.month)).size !== 6 || value.selections.some(item => !months.includes(item.month))) throw new ProfitBoardReadError("selection_identity");
  const sources: z.infer<typeof sourceSchema>[] = [], selectedRows: MonthlyFinancialReadRow[] = [];
  for (const month of months) {
    const item = value.selections.find(item => item.month === month)!, { selected, scannedBatchIds, complete } = item.selection;
    if (!complete) return buildProfitBoardReadFailure({ identity, input, status: "invalid", reasonCode: "scan_incomplete", missingReason: "六个月完整范围选择未完成，不回退旧月份批次或展示部分结果" });
    if (scannedBatchIds.length > PROFIT_BOARD_READ_LIMITS.scanBatches || scannedBatchIds.some((value, index) => !id.safeParse(value).success || index > 0 && value >= scannedBatchIds[index - 1])) throw new ProfitBoardReadError("selection_order");
    if (!selected) { sources.push({ month, status: item.metadataVisibility === "full" ? "not_found" : "not_visible", batch: null, selectedBatchId: null, selection: { rule: "latest_completed_batch_per_month_store_site", complete: true, scannedCount: item.metadataVisibility === "full" ? scannedBatchIds.length : null }, visibleRows: 0, missingReason: item.metadataVisibility === "full" ? "该月完整店铺/国家没有有效快照" : "该月没有当前可见授权范围；不披露其他父体批次资料" }); continue; }
    if (selected.batch.workspaceId !== identity.workspaceId || selected.batch.status !== "completed" || selected.batch.confirmedAt === null || scannedBatchIds.at(-1) !== selected.batch.id || selected.rows.length !== selected.batch.totalRows) throw new ProfitBoardReadError("selected_batch_identity");
    const scopeRows = selected.rows.filter(row => monthlyFinancialRowMatchesScope(row, { yearMonth: month, storeName: input.storeName, country: input.country }));
    if (!scopeRows.length || new Set(scopeRows.map(refKey)).size !== scopeRows.length || scopeRows.some(row => row.batchId !== selected.batch.id)) throw new ProfitBoardReadError("selected_scope_missing");
    const authorized = item.authorizedRowRefs, scopeRefKeys = new Set(scopeRows.map(refKey));
    if (item.metadataVisibility === "scoped" && authorized === undefined || authorized && (new Set(authorized.map(refKey)).size !== authorized.length || authorized.some(ref => !scopeRefKeys.has(refKey(ref))))) throw new ProfitBoardReadError("authorization_membership");
    const allowed = authorized ? new Set(authorized.map(refKey)) : null;
    const rows = scopeRows.filter(row => (!allowed || allowed.has(refKey(row))) && (!input.parentAsin || row.parentAsin === input.parentAsin && !["ambiguous", "unallocated"].includes(row.allocation)));
    for (const row of rows) MonthlyFinancialReadRowSchema.parse(row);
    selectedRows.push(...rows);
    const visible = item.metadataVisibility === "full" || rows.length > 0;
    sources.push({ month, status: visible ? "selected" : "not_visible", batch: visible ? metadata(selected.batch, item.metadataVisibility) : null, selectedBatchId: visible ? selected.batch.id : null, selection: { rule: "latest_completed_batch_per_month_store_site", complete: true, scannedCount: item.metadataVisibility === "full" ? scannedBatchIds.length : null }, visibleRows: rows.length, missingReason: visible ? null : "该月没有当前可见授权范围；不披露其他父体批次资料" });
  }
  if (selectedRows.length > PROFIT_BOARD_READ_LIMITS.rows) throw new ProfitBoardReadError("row_limit");
  const groups = new Map<string, { partitionId: string; parentAsin: string | null; basis: ProfitBoardBasis; currency: string | null; rows: MonthlyFinancialReadRow[]; unknownSource: ProfitBoardSourceRef | null }>();
  for (const row of selectedRows) {
    const basis: ProfitBoardBasis = ["unallocated", "ambiguous"].includes(row.allocation) ? "unallocated_rows" : row.allocation === "parent_only" ? "reported_parent_row" : "child_rows", unknownSource = row.currency === null ? { batchId: row.batchId, rowIndex: row.rowIndex } : null;
    const partitionId = JSON.stringify([input.storeName, input.country, row.currency, basis, unknownSource]);
    const parentAsin = basis === "unallocated_rows" ? null : row.parentAsin, key = JSON.stringify([partitionId, parentAsin, basis === "unallocated_rows" ? [row.batchId, row.rowIndex] : null]);
    const group = groups.get(key) ?? { partitionId, parentAsin, basis, currency: row.currency, rows: [], unknownSource }; group.rows.push(row); groups.set(key, group);
  }
  const search = input.search.trim().toLocaleLowerCase();
  const matched = [...groups].filter(([, group]) => !search || group.rows.some(row => [row.parentAsin, row.asin, row.sku, row.title].some(value => value.toLocaleLowerCase().includes(search)))).sort(([a], [b]) => a.localeCompare(b));
  const sourceByMonth = new Map(sources.map(source => [source.month, source]));
  const products: ProfitBoardProduct[] = matched.map(([key, group]) => {
    const points = months.map(month => point(month, group.rows.filter(row => row.yearMonth === month), sourceByMonth.get(month)!, group.currency, group.basis));
    const childGroups = new Map<string, MonthlyFinancialReadRow[]>();
    if (group.basis === "child_rows") for (const row of group.rows) { const children = childGroups.get(row.asin) ?? []; children.push(row); childGroups.set(row.asin, children); }
    const children = [...childGroups].sort(([a], [b]) => a.localeCompare(b)).map(([asin, rows]) => { const points = months.map(month => point(month, rows.filter(row => row.yearMonth === month), sourceByMonth.get(month)!, group.currency, "child_rows")); return { id: JSON.stringify([key, asin]), asin, title: [...rows].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0].title, skus: [...new Set(rows.map(row => row.sku))], points, current: points[5], previous: points[4], comparison: comparison(points[5], points[4], group.currency !== null), sourceRows: refs(rows) }; });
    return { id: key, partitionId: group.partitionId, parentAsin: group.parentAsin, title: [...group.rows].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0].title, basis: group.basis, currency: group.currency, points, current: points[5], previous: points[4], comparison: comparison(points[5], points[4], group.currency !== null && group.basis !== "unallocated_rows"), children, sourceRows: refs(group.rows) };
  });
  const partitionGroups = new Map<string, ProfitBoardProduct[]>(), partitionSources = new Map<string, { unknownSource: ProfitBoardSourceRef | null; rowsByMonth: Map<string, MonthlyFinancialReadRow[]> }>();
  for (const [, group] of matched) {
    const source = partitionSources.get(group.partitionId) ?? { unknownSource: group.unknownSource, rowsByMonth: new Map<string, MonthlyFinancialReadRow[]>() };
    for (const row of group.rows) { const rows = source.rowsByMonth.get(row.yearMonth) ?? []; rows.push(row); source.rowsByMonth.set(row.yearMonth, rows); }
    partitionSources.set(group.partitionId, source);
  }
  for (const product of products) { const values = partitionGroups.get(product.partitionId) ?? []; values.push(product); partitionGroups.set(product.partitionId, values); }
  const productOffsets = new Map(products.map((product, index) => [product.id, index]));
  const partitions: ProfitBoardPartition[] = [...partitionGroups].map(([partitionId, values]) => {
    const first = values[0], source = partitionSources.get(partitionId)!;
    const trend = months.map((month, index): ProfitBoardPoint => {
      const observations = values.map(product => product.points[index]), present = observations.filter(point => point.sourceRows.length), allRows = source.rowsByMonth.get(month) ?? [];
      const base = point(month, allRows, sourceByMonth.get(month)!, first.currency, "child_rows");
      const ambiguous = present.some(point => point.status === "ambiguous"), observedProducts = present.length, missingProducts = observations.length - observedProducts;
      const profit = ambiguous ? null : sum(present.map(point => point.profit)), qty = ambiguous ? null : sum(present.map(point => point.qty)), sales = ambiguous ? null : sum(present.map(point => point.sales)), ratio = first.currency !== null && profit !== null && sales !== null && sales > 0 ? profit / sales : null, margin = ratio !== null && Number.isFinite(ratio) ? ratio : null;
      return { ...base, status: ambiguous ? "ambiguous" : base.status === "observed" && missingProducts ? "partial" : base.status, profit, qty, sales, margin, marginBasis: { ...base.marginBasis, numerator: profit, denominator: sales }, observedProducts, missingProducts, missingReason: ambiguous ? "包含无法唯一核验的重复原报表父体合计，不输出合计金额" : missingProducts && present.length ? "只合计当月实际可见组，部分历史组该月缺失；未把缺组补零" : base.missingReason };
    });
    const eligible = first.currency !== null && first.basis !== "unallocated_rows" ? values.filter(product => product.comparison.profit.delta !== null) : [];
    const rank = (product: ProfitBoardProduct) => ({ productId: product.id, productOffset: productOffsets.get(product.id)!, parentAsin: product.parentAsin, title: product.title, currency: product.currency, basis: product.basis, current: product.current, previous: product.previous, delta: product.comparison.profit.delta!, sourceRows: product.sourceRows });
    return { id: partitionId, storeName: input.storeName, country: input.country, currency: first.currency, basis: first.basis, unknownSource: source.unknownSource, productCount: values.length, trend, rising: eligible.filter(product => product.comparison.profit.delta! > 0).sort((a, b) => b.comparison.profit.delta! - a.comparison.profit.delta! || a.id.localeCompare(b.id)).slice(0, 5).map(rank), falling: eligible.filter(product => product.comparison.profit.delta! < 0).sort((a, b) => a.comparison.profit.delta! - b.comparison.profit.delta! || a.id.localeCompare(b.id)).slice(0, 5).map(rank), missingReason: first.currency === null ? "币种未知的每个原行独立显示；不跨行或跨期比较金额" : first.basis === "reported_parent_row" ? "原报表父体合计单独分区，不与子体派生合计相加" : first.basis === "unallocated_rows" ? "未分配/父体歧义原行独立，不摊入父体或增长下降排名" : null };
  });
  const pageProducts = products.slice(input.groupOffset, input.groupOffset + input.groupLimit), pageRefs = new Set(pageProducts.flatMap(product => product.sourceRows.map(refKey))), pageRows = selectedRows.filter(row => pageRefs.has(refKey(row))), hasMore = input.groupOffset + pageProducts.length < products.length;
  return checkedResult({ identity, request: input, status: "ready", reasonCode: null, missingReason: null, months, previousMonth: months[4], analysisBasis: "all_authorized_search_matched_groups", timestampBasis: "database_datetime_without_timezone", sources, partitions, products: pageProducts, pageRows, page: { offset: input.groupOffset, limit: input.groupLimit, totalGroups: products.length, totalRows: matched.reduce((sum, [, group]) => sum + group.rows.length, 0), nextOffset: hasMore ? input.groupOffset + pageProducts.length : null, hasMore } });
}
