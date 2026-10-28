import { z } from "zod";
import { MONTHLY_FINANCIAL_METRICS, MonthlyFinancialMetricsSchema, type MonthlyFinancialMetrics, type MonthlyFinancialReadRow } from "./monthlyFinancialRead";
import { consolidateNorthAmericaFinancialRows, type CurrentUsFinancialBinding } from "./northAmericaFinancialConsolidation";

const id = z.number().int().positive().max(2147483647);
const monthSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/u);
export const NorthAmericaBoardInputSchema = z.object({ expectedWorkspaceId: id, operatorId: id.optional(), month: monthSchema.optional(), legacyEditionId:id.optional() }).strict().refine(value=>!(value.month&&value.legacyEditionId),"Choose one archive");
export const NorthAmericaNoteInputSchema=z.object({expectedWorkspaceId:id,editionId:id,storeName:z.string().trim().min(1).max(200),parentAsin:z.string().regex(/^[A-Z0-9]{10}$/u),note:z.string().max(5000),expectedVersion:z.number().int().nonnegative()}).strict();
export type NorthAmericaBoardInput = z.infer<typeof NorthAmericaBoardInputSchema>;
export const shiftBoardMonth = (month: string, offset: number) => {
  monthSchema.parse(month);
  return new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)) - 1 + offset, 1)).toISOString().slice(0,7);
};
const sourceSchema = z.object({ batchId: id, rowIndex: z.number().int().nonnegative(), country: z.enum(["US","CA","MX"]), storeName: z.string(), originalParentAsin: z.string() }).strict();
const monthValueSchema = z.object({ metrics: MonthlyFinancialMetricsSchema, sources: z.array(sourceSchema).max(20000) }).strict();
const childSchema = z.object({ asin: z.string(), title: z.string(), months: z.record(monthSchema, monthValueSchema) }).strict();
export const NorthAmericaBoardProductSchema = childSchema.extend({ storeName: z.string(), ownerIds: z.array(id), children: z.array(childSchema).max(20000) }).strict();
export const NorthAmericaBoardPayloadSchema = z.object({ version: z.literal(1), currency: z.literal("USD"), country: z.literal("US"), month: monthSchema,
  availableMonths: z.array(monthSchema).max(1200), products: z.array(NorthAmericaBoardProductSchema).max(20000),
  unallocated: z.record(monthSchema, monthValueSchema),
  sourceRule: z.literal("latest_complete_batch_per_month_store_country_current_us_parent_explicit_usd"),
}).strict();
export type NorthAmericaBoardPayload = z.infer<typeof NorthAmericaBoardPayloadSchema>;
export type NorthAmericaBoardProduct = z.infer<typeof NorthAmericaBoardProductSchema>;
export type NorthAmericaBoardOwner = { storeName: string; parentAsin: string; title: string; ownerIds: number[] };
export const northAmericaProductKey = (value: { storeName: string; asin: string }) => JSON.stringify([value.storeName, value.asin]);
export function sumBoardMetrics(values: MonthlyFinancialMetrics[]): MonthlyFinancialMetrics {
  return Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => {
    const total = values.reduce((sum, value) => sum + (value[key] ?? 0), 0);
    return [key, !values.length || values.some(value => value[key] === null) || !Number.isFinite(total) ? null : total];
  })) as MonthlyFinancialMetrics;
}
/** These are only already-authorized rows. Unknown amounts never turn into zero. */
export function buildNorthAmericaBoard(rows: MonthlyFinancialReadRow[], bindings: CurrentUsFinancialBinding[], owners: NorthAmericaBoardOwner[], selectedMonth?: string): NorthAmericaBoardPayload | null {
  const source = consolidateNorthAmericaFinancialRows(rows, bindings);
  if (!source.complete) throw new Error("NA_BOARD_UNRESOLVED_SOURCE");
  const dates = [...new Set(rows.filter(row => ["US","CA","MX"].includes(row.country)).map(row => row.yearMonth))].sort();
  const month = selectedMonth ?? dates.at(-1);
  if (!month) return null;
  monthSchema.parse(month);
  if (!dates.includes(month)) throw new Error("NA_BOARD_MONTH_MISSING");
  const availableMonths = dates.filter(date => date <= month), products = new Map<string, NorthAmericaBoardProduct>();
  const metadata = new Map(owners.map(owner => [northAmericaProductKey({ storeName: owner.storeName, asin: owner.parentAsin }), owner]));
  if (metadata.size !== owners.length) throw new Error("NA_BOARD_OWNER_CONFLICT");
  const sources = (originals: MonthlyFinancialReadRow[]) => originals.map(row => sourceSchema.parse({ batchId: row.batchId, rowIndex: row.rowIndex, country: row.country, storeName: row.storeName, originalParentAsin: row.parentAsin }));
  for (const group of source.products) {
    if (group.yearMonth > month) continue;
    const key = northAmericaProductKey({ storeName: group.storeName, asin: group.parentAsin }), meta = metadata.get(key);
    let product = products.get(key);
    if (!product) { product = { asin: group.parentAsin, storeName: group.storeName, title: meta?.title || group.members[0].original.title || group.parentAsin, ownerIds: meta?.ownerIds ?? [], months: {}, children: [] }; products.set(key, product); }
    product.months[group.yearMonth] = { metrics: group.metrics, sources: sources(group.members.map(member => member.original)) };
    for (const child of group.children) {
      const originals = group.members.filter(member => member.original.asin === child.asin).map(member => member.original);
      let target = product.children.find(value => value.asin === child.asin);
      if (!target) { target = { asin: child.asin, title: originals[0]?.title || child.asin, months: {} }; product.children.push(target); }
      target.months[group.yearMonth] = { metrics: child.metrics, sources: sources(originals) };
    }
  }
  const unallocated: NorthAmericaBoardPayload["unallocated"] = {};
  for (const date of availableMonths) {
    const originals = source.unallocated.filter(row => row.yearMonth === date);
    if (originals.length) unallocated[date] = { metrics: sumBoardMetrics(originals.map(row => row.metrics)), sources: sources(originals) };
  }
  return NorthAmericaBoardPayloadSchema.parse({ version: 1, country: "US", currency: "USD", month, availableMonths,
    products: [...products.values()].sort((a,b) => northAmericaProductKey(a).localeCompare(northAmericaProductKey(b))), unallocated,
    sourceRule: "latest_complete_batch_per_month_store_country_current_us_parent_explicit_usd" });
}
const ratio = (n: number | null, d: number | null) => n !== null && d !== null && d > 0 ? n / d : null;
export function boardPeriod(product: Pick<NorthAmericaBoardProduct,"months">, start: string, end: string) {
  const rows = Object.entries(product.months).filter(([date]) => date >= start && date <= end).map(([, value]) => value.metrics);
  const values = sumBoardMetrics(rows);
  return { ...values, margin: ratio(values.financialProfit, values.salesAmount), returnRate: ratio(values.returnQty, values.salesQty), refundRate: ratio(values.refundQty, values.salesQty),
    cash: [values.financialProfit, values.purchaseCost, values.freight].every(value => value !== null) ? values.financialProfit! + values.purchaseCost! + values.freight! : null };
}
export function northAmericaBoardView(payload: NorthAmericaBoardPayload) {
  const month = payload.month, previousMonth = shiftBoardMonth(month,-1), quarter = shiftBoardMonth(month,-2), first = payload.availableMonths[0] ?? month;
  const products = payload.products.map(product => {
    const current = boardPeriod(product,month,month), previous = boardPeriod(product,previousMonth,previousMonth);
    return { ...product, current, previous, quarter: boardPeriod(product,quarter,month), total: boardPeriod(product,first,month),
      delta: current.financialProfit !== null && previous.financialProfit !== null ? current.financialProfit-previous.financialProfit : null };
  });
  const stable = (a: NorthAmericaBoardProduct,b: NorthAmericaBoardProduct) => northAmericaProductKey(a).localeCompare(northAmericaProductKey(b));
  const compared = products.filter(product => product.delta !== null);
  return { month, previousMonth, quarter, first, products,
    trend: Array.from({length:6},(_,index) => { const date = shiftBoardMonth(month,index-5); const values = payload.products.flatMap(product => product.months[date] ? [product.months[date].metrics] : []); return { month: date, profit: sumBoardMetrics(values).financialProfit }; }),
    rising: compared.filter(product => product.delta! > 0).sort((a,b) => b.delta!-a.delta! || stable(a,b)).slice(0,5),
    falling: compared.filter(product => product.delta! < 0).sort((a,b) => a.delta!-b.delta! || stable(a,b)).slice(0,5),
    highReturns: products.filter(product => product.quarter.salesQty !== null && product.quarter.salesQty >= 50 && product.quarter.returnRate !== null && product.quarter.returnRate > .08).sort((a,b) => b.quarter.returnRate!-a.quarter.returnRate! || stable(a,b)),
    highProfit: products.filter(product => product.current.financialProfit !== null && product.current.financialProfit > 1000).sort((a,b) => b.current.financialProfit!-a.current.financialProfit! || stable(a,b)),
    losing: products.filter(product => product.current.financialProfit !== null && product.current.financialProfit < 0).sort((a,b) => a.current.financialProfit!-b.current.financialProfit! || stable(a,b)).slice(0,10),
  };
}
