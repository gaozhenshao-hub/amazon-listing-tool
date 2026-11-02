export type LingxingDraftStatus = "new" | "changed" | "unchanged" | "needs_review" | "skipped" | "applied" | string;

export function filterLingxingDraftRows<T extends { rowStatus: LingxingDraftStatus }>(rows: T[], status: string) {
  return status === "all" ? rows : rows.filter((row) => row.rowStatus === status);
}
