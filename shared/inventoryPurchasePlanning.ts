export type InventoryPurchaseInput = {
  asin?: string | null;
  sku?: string | null;
  productName?: string | null;
  suggestedOrderQuantity?: number | string | null;
  suggestedOrderDate?: string | null;
  productCost?: number | string | null;
  [key: string]: unknown;
};

export type MonthlyPurchasePlan = {
  key: string;
  label: "本月采购" | "下月采购" | "后月采购";
  rows: Array<InventoryPurchaseInput & { sourceAsin: string | null | undefined; quantity: number; productCost: number | null; purchaseAmount: number | null }>;
  totalQuantity: number;
  knownAmount: number;
  missingCostCount: number;
};

export function buildMonthlyPurchasePlans(rows: InventoryPurchaseInput[], asOfDate?: string | null): MonthlyPurchasePlan[] {
  const anchor = asOfDate ? new Date(`${asOfDate}T00:00:00`) : new Date();
  const labels: MonthlyPurchasePlan["label"][] = ["本月采购", "下月采购", "后月采购"];
  const months = labels.map((label, offset) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label, rows: [] as MonthlyPurchasePlan["rows"] };
  });
  for (const row of rows) {
    const quantity = Number(row.suggestedOrderQuantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const suggested = row.suggestedOrderDate ? new Date(`${row.suggestedOrderDate}T00:00:00`) : anchor;
    const effective = suggested < anchor ? anchor : suggested;
    const monthKey = `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, "0")}`;
    const bucket = months.find((month) => month.key === monthKey);
    if (!bucket) continue;
    const rawCost = row.productCost == null ? null : Number(row.productCost);
    const productCost = rawCost !== null && Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
    bucket.rows.push({ ...row, sourceAsin: row.asin, quantity, productCost, purchaseAmount: productCost === null ? null : quantity * productCost });
  }
  return months.map((month) => ({
    ...month,
    totalQuantity: month.rows.reduce((sum, row) => sum + row.quantity, 0),
    knownAmount: month.rows.reduce((sum, row) => sum + (row.purchaseAmount ?? 0), 0),
    missingCostCount: month.rows.filter((row) => row.productCost === null).length,
  }));
}
