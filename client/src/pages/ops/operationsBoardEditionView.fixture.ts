import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";
import { buildOperationsBoardEditionCapture, OperationsBoardEditionReadResultSchema, operationsBoardEditionHash, type OperationsBoardEditionReadResult } from "@shared/operationsBoardEdition";

/** Explicit synthetic sources for component/browser checks, never customer data. */
export function syntheticOperationsBoardEdition(options: { groups?: number; archived?: boolean; currentEmpty?: boolean } = {}): OperationsBoardEditionReadResult {
  const scope = { workspaceId: 11, storeName: "SYNTHETIC 合成店铺", country: "US" }, identity = { userId: 7, workspaceId: 11 };
  const stamp = "2026-10-18 09:00:00.000000", groups = options.groups ?? 3;
  const periods = ["2024-01", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].filter(value => !options.currentEmpty || value !== "2026-10");
  const batches = periods.map((yearMonth, index) => {
    const payload = Array.from({ length: groups * 2 }, (_, row) => ({
      ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])),
      yearMonth, storeName: scope.storeName, site: "US", parentAsin: `P${String(Math.floor(row / 2)).padStart(2, "0")}`,
      asin: `CHILD-${row}`, sku: `SYNTHETIC-SKU-${row}`, title: `合成产品 ${Math.floor(row / 2)} <img src=x onerror=bad()>`, operator: "来源原文，不授予权限",
      salesQty: 40, salesAmount: 5000, financialProfit: (Math.floor(row / 2) === 1 ? -1 : 1) * (index + 1) * 500,
      purchaseCost: -40, freight: -10, returnQty: 5, refundQty: 2, raw: { currency: "USD", "1:完整原始说明": "合成明细\n保留原文" },
    }));
    const record: MonthlyFinancialBatchRecord = { id: 100 + index, workspaceId: 11, userId: 7, fileName: "SYNTHETIC-NOT-ARCHIVED.xlsx", fileHash: "d".repeat(64), status: "completed", totalRows: payload.length, skippedRows: 0, unallocatedRows: 0, months: [yearMonth], createdAt: stamp, confirmedAt: stamp, fileReferenceKind: "storage", payload };
    return parseMonthlyFinancialBatch(record);
  });
  const sources = batches.map((batch, index) => ({ month: periods[index], batchId: batch.batch.id, recordHash: operationsBoardEditionHash(batch), rowCount: batch.rows.length, origin: batch.batch.origin }));
  const rows = batches.flatMap(batch => batch.rows);
  const capture = buildOperationsBoardEditionCapture({ scope, month: "2026-10", sources, rows, scannedBatches: sources.map(source => ({ id: source.batchId, recordHash: source.recordHash })).reverse() });
  const archived = options.archived !== false;
  const edition = { id: 41, scope, month: "2026-10", revision: 1, version: 2, kind: "original" as const, status: archived ? "archived" as const : "current" as const, originalEditionId: null, sourceHash: capture.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: archived ? stamp : null };
  const parents = Array.from({ length: groups }, (_, index) => ({ parentAsin: `P${String(index).padStart(2, "0")}`, operatorIds: [7], status: "resolved" as const, basis: "manual" as const, sourceMonth: null }));
  const value = {
    identity, scope, request: { expectedWorkspaceId: 11, scope: { storeName: scope.storeName, country: scope.country }, editionId: archived ? 41 : null },
    state: { scope, version: 2, currentMonth: archived ? "2026-11" : "2026-10", currentEditionId: archived ? 42 : 41, status: options.currentEmpty && !archived ? "current_empty" as const : "current" as const },
    edition, status: options.currentEmpty && !archived ? "current_empty" as const : "ready" as const, reasonCode: null, visibility: "full" as const, authorizationHash: "a".repeat(64), rows, sources,
    ownership: { version: 1 as const, meaning: "current_authorization_not_historical_membership" as const, visibility: "full" as const, operators: [{ userId: 7, displayName: "合成负责人", relation: "self" as const }], parents, selectedOperatorId: null },
    coverage: { complete: true as const, meaning: "all_currently_authorized_edition_rows" as const, rowCount: rows.length },
    notes: parents.map(parent => ({ editionId: 41, parentAsin: parent.parentAsin, note: "SYNTHETIC 已保存备注", version: 1, updatedBy: 7, updatedAt: stamp, canEdit: !archived, editBasis: archived ? "readonly" as const : "admin" as const })),
  };
  return OperationsBoardEditionReadResultSchema.parse({ ...value, viewKey: operationsBoardEditionHash(value) });
}
