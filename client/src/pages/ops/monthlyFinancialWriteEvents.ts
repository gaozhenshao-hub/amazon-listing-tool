/** Metadata-only notification. A notice invalidates already-open reads; it is
 * never authority to broaden a query, grant access or merge financial rows. */
export type MonthlyFinancialChangeNotice = {
  userId: number;
  workspaceId: number;
  action: "upload" | "confirm" | "revoke";
  batchId: number;
};
const listeners = new Set<(notice: MonthlyFinancialChangeNotice) => void>();
export function subscribeMonthlyFinancialChanges(listener: (notice: MonthlyFinancialChangeNotice) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishMonthlyFinancialChange(notice: MonthlyFinancialChangeNotice) {
  for (const listener of listeners) listener(notice);
}
