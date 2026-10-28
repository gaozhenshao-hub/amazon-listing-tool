import { shiftBoardMonth, type NorthAmericaBoardPayload } from "@shared/northAmericaBoard";

/** Monthly reports are delayed: the previous month becomes visible on Shanghai's 16th. */
export function defaultProductFinancialMonth(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_CALENDAR");
  const local = new Date(now.getTime() + 8 * 3600000);
  const end = local.getUTCMonth() - (local.getUTCDate() <= 15 ? 2 : 1);
  return new Date(Date.UTC(local.getUTCFullYear(), end, 1)).toISOString().slice(0, 7);
}

export type ProductFinancialTrendPoint = { yearMonth: string; month: string; financialProfit: number | null };

export type ProductFinancialTrendPayload = Pick<NorthAmericaBoardPayload, "country" | "currency"> & {
  products: Array<{ asin: string; storeName: string; months: Record<string, { metrics: { financialProfit: number | null } }> }>;
};

/** Already-authorized financial reports, aggregated to the current US parent in USD.
 * Never use weekly operational profits or manually entered trend values as a fallback.
 */
export function buildProductFinancialTrend(
  payload: ProductFinancialTrendPayload | null | undefined,
  scope: { parentAsin: string; storeName?: string | null; marketplace?: string | null },
  now = new Date(),
): ProductFinancialTrendPoint[] {
  const matches = payload?.country === "US" && payload.currency === "USD" && scope.marketplace === "US"
    ? payload.products.filter(product => product.asin === scope.parentAsin && product.storeName === scope.storeName) : [];
  const product = matches.length === 1 ? matches[0] : undefined;
  const end = defaultProductFinancialMonth(now);
  return Array.from({ length: 6 }, (_, index) => {
    const yearMonth = shiftBoardMonth(end, index - 5);
    const value = product?.months[yearMonth]?.metrics.financialProfit;
    return { yearMonth, month: yearMonth.slice(2), financialProfit: typeof value === "number" && Number.isFinite(value) ? value : null };
  });
}
