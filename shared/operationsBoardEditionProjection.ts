import { z } from "zod";
import { monthlyFinancialJsonBytes, type MonthlyFinancialReadRow } from "./monthlyFinancialRead";
import {
  OPERATIONS_BOARD_EDITION_LIMITS, OperationsBoardEditionReadResultSchema,
  type OperationsBoardEditionReadResult, type OperationsBoardEditionSummary,
} from "./operationsBoardEdition";
import {
  ProductBoardReadInputSchema, buildProductBoardBodyProjection,
  type ProductBoardReadInput, type ProductBoardBodyProjection, type ProductBoardBodySource,
} from "./productBoardRead";
import {
  ProfitBoardReadInputSchema, buildProfitBoardBodyProjection, profitBoardMonths,
  type ProfitBoardReadInput, type ProfitBoardBodyProjection, type ProfitBoardBodySource,
} from "./profitBoardRead";

/** Local presentation filters only. Month, scope and selected numeric owner are
 * bound to the complete fresh server read and cannot be overridden by a page.
 * This is not a replacement for source selection or server authorization. */
export const OperationsBoardEditionProductProjectionInputSchema = ProductBoardReadInputSchema.pick({ parentAsin: true, search: true, highReturnsOffset: true, highProfitOffset: true, losingOffset: true, allOffset: true, pageSize: true });
export const OperationsBoardEditionProfitProjectionInputSchema = ProfitBoardReadInputSchema.pick({ parentAsin: true, search: true, groupOffset: true, groupLimit: true });
export type OperationsBoardEditionProductProjectionInput = z.infer<typeof OperationsBoardEditionProductProjectionInputSchema>;
export type OperationsBoardEditionProfitProjectionInput = z.infer<typeof OperationsBoardEditionProfitProjectionInputSchema>;
export type OperationsBoardEditionProjectionHeader = {
  kind: "operations_board_edition";
  meaning: "immutable_edition_under_current_authorization" | "current_edition_under_current_authorization";
  identity: OperationsBoardEditionReadResult["identity"];
  scope: OperationsBoardEditionReadResult["scope"];
  edition: OperationsBoardEditionSummary;
  state: OperationsBoardEditionReadResult["state"];
  readStatus: "ready" | "current_empty";
  authorizationHash: string;
  viewKey: string;
  visibility: OperationsBoardEditionReadResult["visibility"];
  ownership: OperationsBoardEditionReadResult["ownership"];
  /** Real persisted edition provenance, not a synthetic live batch. Row counts
   * are for the entire server-authorized/owner-filtered read, before local search. */
  sources: OperationsBoardEditionReadResult["sources"];
  coverage: OperationsBoardEditionReadResult["coverage"];
};
export type OperationsBoardEditionProductProjection = ProductBoardBodyProjection & {
  header: OperationsBoardEditionProjectionHeader; request: ProductBoardReadInput;
};
export type OperationsBoardEditionProfitProjection = ProfitBoardBodyProjection & {
  header: OperationsBoardEditionProjectionHeader; request: ProfitBoardReadInput;
};
export class OperationsBoardEditionProjectionError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_EDITION_PROJECTION_${code}`); this.name = "OperationsBoardEditionProjectionError"; }
}
function checkedRead(raw: OperationsBoardEditionReadResult) {
  const checked = OperationsBoardEditionReadResultSchema.safeParse(raw);
  if (!checked.success) throw new OperationsBoardEditionProjectionError("invalid_complete_read");
  const read = checked.data;
  if (!read.edition || read.status !== "ready" && read.status !== "current_empty") throw new OperationsBoardEditionProjectionError("edition_unavailable");
  const header: OperationsBoardEditionProjectionHeader = {
    kind: "operations_board_edition", meaning: read.edition.status === "archived" ? "immutable_edition_under_current_authorization" : "current_edition_under_current_authorization",
    identity: read.identity, scope: read.scope, edition: read.edition, state: read.state, readStatus: read.status,
    authorizationHash: read.authorizationHash, viewKey: read.viewKey, visibility: read.visibility, ownership: read.ownership, sources: read.sources, coverage: read.coverage,
  };
  return { read, header };
}
function scopedRows(rows: MonthlyFinancialReadRow[], parentAsin?: string) {
  return parentAsin === undefined ? rows : rows.filter(row => row.parentAsin === parentAsin && ["child", "parent_only"].includes(row.allocation));
}
function sourceAvailability(read: OperationsBoardEditionReadResult, rows: MonthlyFinancialReadRow[], month: string): ProductBoardBodySource {
  const source = read.sources.find(source => source.month === month), visibleRows = rows.filter(row => row.yearMonth === month).length;
  return source && (read.visibility === "full" || visibleRows > 0)
    ? { month, status: "selected", selectedBatchId: source.batchId, visibleRows }
    : { month, status: read.visibility === "full" ? "not_found" : "not_visible", selectedBatchId: null, visibleRows: 0 };
}
function bounded<T>(value: T): T {
  try {
    if (monthlyFinancialJsonBytes(value, { jsonNodes: 1_000_000, jsonDepth: 28, stringLength: OPERATIONS_BOARD_EDITION_LIMITS.stringLength }) > OPERATIONS_BOARD_EDITION_LIMITS.publicBytes) throw Error();
    return value;
  } catch { throw new OperationsBoardEditionProjectionError("complete_projection_limit"); }
}
export function buildOperationsBoardEditionProductProjection(value: { read: OperationsBoardEditionReadResult; input: OperationsBoardEditionProductProjectionInput }): OperationsBoardEditionProductProjection {
  const input = OperationsBoardEditionProductProjectionInputSchema.parse(value.input), { read, header } = checkedRead(value.read);
  const request = ProductBoardReadInputSchema.parse({ expectedWorkspaceId: read.identity.workspaceId, storeName: read.scope.storeName, country: read.scope.country, month: header.edition.month,
    ...(read.request.operatorId === undefined ? {} : { operatorId: read.request.operatorId }), ...input });
  const rows = scopedRows(read.rows, input.parentAsin), sources = read.sources.map(source => sourceAvailability(read, rows, source.month));
  return bounded({ header, request, ...buildProductBoardBodyProjection({ input: request, rows, sources }) });
}
export function buildOperationsBoardEditionProfitProjection(value: { read: OperationsBoardEditionReadResult; input: OperationsBoardEditionProfitProjectionInput }): OperationsBoardEditionProfitProjection {
  const input = OperationsBoardEditionProfitProjectionInputSchema.parse(value.input), { read, header } = checkedRead(value.read);
  const request = ProfitBoardReadInputSchema.parse({ expectedWorkspaceId: read.identity.workspaceId, storeName: read.scope.storeName, country: read.scope.country, month: header.edition.month,
    ...(read.request.operatorId === undefined ? {} : { operatorId: read.request.operatorId }), ...input });
  const months = profitBoardMonths(header.edition.month), rows = scopedRows(read.rows, input.parentAsin).filter(row => months.includes(row.yearMonth));
  const sources: ProfitBoardBodySource[] = months.map(month => sourceAvailability(read, rows, month));
  return bounded({ header, request, ...buildProfitBoardBodyProjection({ input: request, rows, sources }) });
}
