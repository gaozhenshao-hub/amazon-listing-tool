import { z } from "zod";
import {
  MonthlyFinancialReadRowSchema, MONTHLY_FINANCIAL_METRICS,
  aggregateMonthlyFinancialDetails, monthlyFinancialRatio,
  type MonthlyFinancialMetrics, type MonthlyFinancialReadRow,
} from "./monthlyFinancialRead";

/** A projection of already authorized source rows. This never grants access,
 * rewrites historical reports, infers exchange rates, or apportions shop fees.
 * The server must select complete winning batches and current US identities
 * before calling it; original rows stay attached to every displayed group. */
const bindingSchema = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/u),
  parentAsin: z.string().regex(/^[A-Z0-9]{10}$/u),
  storeName: z.string().trim().min(1).max(200),
  country: z.literal("US"),
  source: z.union([
    z.object({ table: z.literal("saihu_product_weekly"), rowId: z.number().int().positive().safe() }).strict(),
    z.object({ table: z.literal("ops_monthly_profit_imports"), batchId: z.number().int().positive().safe(), rowIndex: z.number().int().nonnegative(), yearMonth: z.string().regex(/^\d{4}-\d{2}$/u) }).strict(),
  ]),
}).strict();
export type CurrentUsFinancialBinding = z.infer<typeof bindingSchema>;

/** Prefer current US product identities. For discontinued products missing from
 * that directory, preserve the last known US financial identity, with its exact
 * provenance. Never infer an American store from a foreign store suffix. */
export function resolveNorthAmericaFinancialBindings(current: CurrentUsFinancialBinding[], history: MonthlyFinancialReadRow[]): CurrentUsFinancialBinding[] {
  if (current.length > 20_000 || history.length > 100_000) throw new Error("NA_FINANCIAL_LIMIT");
  const result = new Map<string, CurrentUsFinancialBinding>();
  for (const raw of current) {
    const value = bindingSchema.parse(raw), previous = result.get(value.asin);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error("NA_FINANCIAL_IDENTITY_CONFLICT");
    result.set(value.asin, value);
  }
  const latest = new Map<string, MonthlyFinancialReadRow[]>();
  for (const raw of history) {
    const row = MonthlyFinancialReadRowSchema.parse(raw);
    if (row.country !== "US" || !row.asin || !row.parentAsin || result.has(row.asin)) continue;
    const previous = latest.get(row.asin), head = previous?.[0];
    if (!head || row.yearMonth > head.yearMonth || row.yearMonth === head.yearMonth && row.batchId > head.batchId) latest.set(row.asin, [row]);
    else if (row.yearMonth === head.yearMonth && row.batchId === head.batchId) previous!.push(row);
  }
  for (const [asin, candidates] of latest) {
    if (new Set(candidates.map(row => JSON.stringify([row.storeName, row.parentAsin]))).size !== 1) throw new Error("NA_FINANCIAL_IDENTITY_CONFLICT");
    const row = [...candidates].sort((a,b) => a.rowIndex-b.rowIndex)[0];
    result.set(asin, bindingSchema.parse({ asin, parentAsin: row.parentAsin, storeName: row.storeName, country: "US", source: { table: "ops_monthly_profit_imports", batchId: row.batchId, rowIndex: row.rowIndex, yearMonth: row.yearMonth } }));
  }
  return [...result.values()];
}
type SourceRef = { batchId: number; rowIndex: number };
export type ConsolidatedFinancialMember = {
  original: MonthlyFinancialReadRow;
  currentUsBinding: CurrentUsFinancialBinding;
};
export type NorthAmericaFinancialGroup = {
  yearMonth: string; storeName: string; country: "US"; currency: "USD";
  parentAsin: string; members: ConsolidatedFinancialMember[];
  metrics: MonthlyFinancialMetrics;
  details: ReturnType<typeof aggregateMonthlyFinancialDetails>["details"];
  children: { asin: string; sourceRows: SourceRef[]; metrics: MonthlyFinancialMetrics }[];
};
const ref = (row: MonthlyFinancialReadRow): SourceRef => ({ batchId: row.batchId, rowIndex: row.rowIndex });
function metrics(rows: MonthlyFinancialReadRow[]): MonthlyFinancialMetrics {
  return Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => {
    const values = rows.map(row => row.metrics[key]);
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return [key, !values.length || values.some(value => value === null) || !Number.isFinite(total) ? null : total];
  })) as MonthlyFinancialMetrics;
}
export function consolidateNorthAmericaFinancialRows(
  rawRows: MonthlyFinancialReadRow[], rawBindings: CurrentUsFinancialBinding[],
) {
  if (rawRows.length > 100_000 || rawBindings.length > 20_000) throw new Error("NA_FINANCIAL_LIMIT");
  const rows = rawRows.map(row => MonthlyFinancialReadRowSchema.parse(row));
  const bindings = new Map<string, CurrentUsFinancialBinding>();
  for (const raw of rawBindings) {
    const binding = bindingSchema.parse(raw), previous = bindings.get(binding.asin);
    // An ASIN must have one current US identity. Do not choose the first store
    // or parent when the authoritative lookup itself is inconsistent.
    if (previous && JSON.stringify(previous) !== JSON.stringify(binding)) throw new Error("NA_FINANCIAL_IDENTITY_CONFLICT");
    bindings.set(binding.asin, binding);
  }
  const seen = new Set<string>(), groups = new Map<string, ConsolidatedFinancialMember[]>();
  const unallocated: MonthlyFinancialReadRow[] = [], excluded: SourceRef[] = [];
  const unresolved: { row: MonthlyFinancialReadRow; reason: "currency_not_usd" | "identity_missing" | "parent_total_not_additive" }[] = [];
  for (const row of rows) {
    const key = `${row.batchId}:${row.rowIndex}`;
    if (seen.has(key)) throw new Error("NA_FINANCIAL_DUPLICATE_SOURCE");
    seen.add(key);
    if (!["US", "CA", "MX"].includes(row.country)) { excluded.push(ref(row)); continue; }
    if (row.currency !== "USD" || row.currencyEvidence.status !== "explicit") {
      unresolved.push({ row, reason: "currency_not_usd" }); continue;
    }
    // Source rows without a product are real expenses. Retain them separately;
    // they must not become a fake child or vanish from reconciliation totals.
    if (!row.asin && !row.parentAsin) { unallocated.push(row); continue; }
    if (!row.asin) { unresolved.push({ row, reason: "parent_total_not_additive" }); continue; }
    const binding = bindings.get(row.asin);
    if (!binding) { unresolved.push({ row, reason: "identity_missing" }); continue; }
    const groupKey = JSON.stringify([row.yearMonth, binding.storeName, binding.parentAsin]);
    const group = groups.get(groupKey) ?? [];
    group.push({ original: row, currentUsBinding: binding }); groups.set(groupKey, group);
  }
  const products: NorthAmericaFinancialGroup[] = [...groups.values()].map(members => {
    const originals = members.map(member => member.original), first = members[0], sums = metrics(originals);
    const childRows = new Map<string, MonthlyFinancialReadRow[]>();
    for (const row of originals) { const child = childRows.get(row.asin) ?? []; child.push(row); childRows.set(row.asin, child); }
    return {
      yearMonth: first.original.yearMonth, storeName: first.currentUsBinding.storeName,
      parentAsin: first.currentUsBinding.parentAsin, country: "US", currency: "USD", members,
      metrics: sums, details: aggregateMonthlyFinancialDetails(originals, true).details,
      children: [...childRows].map(([asin, originals]) => ({ asin, sourceRows: originals.map(ref), metrics: metrics(originals) })),
    };
  });
  const included = products.flatMap(product => product.members.map(member => member.original));
  const productTotals = metrics(included), unallocatedTotals = metrics(unallocated);
  return {
    version: 1 as const, country: "US" as const, currency: "USD" as const,
    complete: unresolved.length === 0, products, unallocated, unresolved, excluded,
    productTotals, unallocatedTotals, reconciledTotals: unresolved.length ? null : metrics([...included, ...unallocated]),
    productMargin: monthlyFinancialRatio(productTotals.financialProfit, productTotals.salesAmount, "财务利润合计 / 销售额合计"),
    currencyBasis: "explicit_usd_source_values_no_second_conversion" as const,
  };
}
