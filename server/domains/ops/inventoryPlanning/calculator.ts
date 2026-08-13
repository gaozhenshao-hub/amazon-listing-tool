export type PlanningDailyRecord = { reportDate: string; salesQty: number; totalInventory: number; isActive?: boolean };
export type InventoryPlanningInput = {
  asOfDate: string; fbaAvailable: number; fbaInTransit: number; localInventory: number;
  salesHistory: PlanningDailyRecord[]; manualDailySales?: number | null;
  productionDays?: number; shippingDays?: number; bufferDays?: number; targetCoverDays?: number;
  moq?: number; packSize?: number;
};

const round = (value: number, decimals = 2) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const roundToPack = (quantity: number, packSize: number) => Math.ceil(quantity / Math.max(packSize, 1)) * Math.max(packSize, 1);

function averageActiveDailySales(records: PlanningDailyRecord[], windowDays: number, asOfDate: string) {
  const start = addDays(asOfDate, -(windowDays - 1));
  const rows = records.filter(row => row.reportDate >= start && row.reportDate <= asOfDate && row.isActive !== false);
  return { value: rows.length ? rows.reduce((sum, row) => sum + row.salesQty, 0) / rows.length : 0, sampleDays: rows.length };
}

function isConfirmedStockout(records: PlanningDailyRecord[], asOfDate: string) {
  const days = [2, 1, 0].map(offset => addDays(asOfDate, -offset));
  const byDate = new Map(records.map(row => [row.reportDate, row]));
  const evidence = days.map(date => byDate.get(date));
  return evidence.every((row): row is PlanningDailyRecord => Boolean(row) && row!.totalInventory === 0 && row!.salesQty === 0);
}

export function calculateInventoryPlan(input: InventoryPlanningInput) {
  const productionDays = input.productionDays ?? 30;
  const shippingDays = input.shippingDays ?? 30;
  const bufferDays = input.bufferDays ?? 10;
  const targetCoverDays = input.targetCoverDays ?? 30;
  const totalLeadDays = productionDays + shippingDays + bufferDays;
  const sales7 = averageActiveDailySales(input.salesHistory, 7, input.asOfDate);
  const sales30 = averageActiveDailySales(input.salesHistory, 30, input.asOfDate);
  const weightedDailySales = input.manualDailySales ?? (sales7.value * 0.5 + sales30.value * 0.5);
  const totalInventory = input.fbaAvailable + input.fbaInTransit + input.localInventory;
  const coverageDays = weightedDailySales > 0 ? totalInventory / weightedDailySales : null;
  const suggestedOrderDate = coverageDays === null ? null : addDays(input.asOfDate, Math.max(0, Math.floor(coverageDays - totalLeadDays)));
  const safetyStock = weightedDailySales * totalLeadDays;
  const rawSuggestedQuantity = Math.max(0, safetyStock + weightedDailySales * targetCoverDays - totalInventory);
  const roundedQuantity = roundToPack(Math.max(rawSuggestedQuantity, input.moq ?? 0), input.packSize ?? 1);
  return {
    totalInventory, productionDays, shippingDays, bufferDays, totalLeadDays, targetCoverDays,
    sales7: { dailySales: round(sales7.value), sampleDays: sales7.sampleDays },
    sales30: { dailySales: round(sales30.value), sampleDays: sales30.sampleDays },
    weightedDailySales: round(weightedDailySales), manualOverrideApplied: input.manualDailySales != null,
    coverageDays: coverageDays === null ? null : round(coverageDays, 1), suggestedOrderDate,
    safetyStock: round(safetyStock), suggestedOrderQuantity: round(roundedQuantity),
    confirmedStockout: isConfirmedStockout(input.salesHistory, input.asOfDate),
    dataQuality: { hasSevenDaySample: sales7.sampleDays >= 7, hasThirtyDaySample: sales30.sampleDays >= 30 },
  };
}
