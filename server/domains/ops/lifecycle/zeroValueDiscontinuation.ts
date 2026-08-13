export type AsinLifecycleEvidence = {
  reportDate: string;
  salesQty: number;
  orderProfit: number;
  totalInventory: number;
};

export type ZeroValueDiscontinuationResult = {
  shouldDiscontinue: boolean;
  reason: "three_months_zero" | "insufficient_history" | "non_zero_evidence";
  evidenceStartDate: string | null;
  evidenceEndDate: string | null;
  evidenceDays: number;
  salesQty: number;
  profit: number;
  maxInventory: number;
};

/**
 * Determines whether one child ASIN may be auto-discontinued. The date range must
 * cover 90 consecutive calendar days ending at the most recent import date; gaps
 * never qualify as three continuous months of evidence.
 */
export function evaluateThreeMonthZeroDiscontinuation(records: AsinLifecycleEvidence[]): ZeroValueDiscontinuationResult {
  const ordered = [...records].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  if (!ordered.length) return { shouldDiscontinue: false, reason: "insufficient_history", evidenceStartDate: null, evidenceEndDate: null, evidenceDays: 0, salesQty: 0, profit: 0, maxInventory: 0 };
  const end = ordered.at(-1)!.reportDate;
  const endDate = new Date(`${end}T00:00:00Z`);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 89);
  const start = startDate.toISOString().slice(0, 10);
  const window = ordered.filter(row => row.reportDate >= start && row.reportDate <= end);
  const uniqueDates = new Set(window.map(row => row.reportDate));
  const salesQty = window.reduce((sum, row) => sum + Number(row.salesQty || 0), 0);
  const profit = window.reduce((sum, row) => sum + Number(row.orderProfit || 0), 0);
  const maxInventory = window.reduce((max, row) => Math.max(max, Number(row.totalInventory || 0)), 0);
  const hasContinuousEvidence = uniqueDates.size === 90 && window[0]?.reportDate === start;
  const reason = !hasContinuousEvidence ? "insufficient_history" : (salesQty === 0 && profit === 0 && maxInventory === 0 ? "three_months_zero" : "non_zero_evidence");
  return { shouldDiscontinue: reason === "three_months_zero", reason, evidenceStartDate: start, evidenceEndDate: end, evidenceDays: uniqueDates.size, salesQty, profit, maxInventory };
}
