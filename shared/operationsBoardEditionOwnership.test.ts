import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch } from "./monthlyFinancialRead";
import { OperationsBoardEditionOwnershipSchema, filterOperationsBoardEditionRowsByOperator, validateOperationsBoardEditionOwnershipResult,
  type OperationsBoardEditionOwnership } from "./operationsBoardEditionOwnership";
import { OperationsBoardOwnershipSchema, validateOperationsBoardOwnershipForRows } from "./operationsBoardOwnership";

function rows() {
  return parseMonthlyFinancialBatch({ id: 1, workspaceId: 7, userId: 3, fileName: "synthetic.csv", fileHash: "a".repeat(64), status: "completed", totalRows: 3,
    skippedRows: 0, unallocatedRows: 0, months: ["2026-09", "2026-10"], createdAt: "2026-10-18 12:00:00.000000", confirmedAt: "2026-10-18 12:00:00.000000",
    payload: [["P1", "2026-09"], ["P1", "2026-10"], ["P2", "2026-10"]].map(([parentAsin, yearMonth]) => ({
      ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, metric === "financialProfit" ? -7 : metric === "salesQty" ? 0 : null])),
      yearMonth, parentAsin, asin: `${parentAsin}-C`, sku: `${parentAsin}-SKU`, title: "完整原文", storeName: "SYNTHETIC", site: "US",
      operator: "Not a current account name", raw: { currency: "USD", original: "原始\n完整数据" },
    })),
  }).rows;
}
function ownership(): OperationsBoardEditionOwnership {
  return { version: 1, meaning: "current_authorization_not_historical_membership", visibility: "scoped", selectedOperatorId: null,
    operators: [{ userId: 3, displayName: "当前负责人", relation: "self" }, { userId: 4, displayName: "当前直接搭档", relation: "direct_partner" }],
    parents: [{ parentAsin: "P1", operatorIds: [3], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: "2026-10" },
      { parentAsin: "P2", operatorIds: [4], status: "resolved", basis: "manual", sourceMonth: null }] };
}
describe("separate archive current-authorization owner contract", () => {
  it("filters entire authorized parent history without altering any original row", () => {
    const original = rows(), before = structuredClone(original), selected = filterOperationsBoardEditionRowsByOperator(original, ownership(), 3, 3);
    expect(selected.rows.map(row => [row.parentAsin, row.yearMonth])).toEqual([["P1", "2026-09"], ["P1", "2026-10"]]);
    expect(selected.rows[0]).toBe(original[0]); expect(original).toEqual(before);
    expect(selected.ownership.parents).toHaveLength(2); expect(selected.ownership.operators).toHaveLength(2); expect(selected.ownership.selectedOperatorId).toBe(3);
  });
  it("can choose an authorized direct partner's actual owned parents without changing permission metadata", () => {
    const selected = filterOperationsBoardEditionRowsByOperator(rows(), ownership(), 3, 4);
    expect(selected.rows.map(row => row.parentAsin)).toEqual(["P2"]); expect(selected.ownership.operators[1].relation).toBe("direct_partner");
    const issues: string[] = []; validateOperationsBoardEditionOwnershipResult({ ...selected, userId: 3, operatorId: 4, visibility: "scoped", month: "2026-10" }, message => issues.push(message)); expect(issues).toEqual([]);
  });
  it.each([9, 0, -1, "4", null, 1.5])("does not infer a permission grant for invalid or hidden selected owner %j", operatorId => {
    expect(() => filterOperationsBoardEditionRowsByOperator(rows(), ownership(), 3, operatorId as number)).toThrow("OPERATOR_NOT_VISIBLE");
  });
  it("does not silently accept an incomplete directory before calculations", () => {
    const missing = ownership(); missing.parents.pop(); missing.operators.pop();
    expect(() => filterOperationsBoardEditionRowsByOperator(rows(), missing, 3)).toThrow("FILTER_MISMATCH");
  });
  it("rejects a directory built from an older, rather than latest visible, source month", () => {
    const stale = ownership(); stale.parents[0].sourceMonth = "2026-09";
    expect(() => filterOperationsBoardEditionRowsByOperator(rows(), stale, 3)).toThrow("FILTER_MISMATCH");
  });
  it.each(["unrelated directory", "unknown reference", "duplicate", "false self", "workspace scoped", "fake historical meaning"])("rejects %s", reason => {
    const changed = ownership();
    if (reason === "unrelated directory") changed.operators.push({ userId: 5, displayName: "hidden", relation: "direct_partner" });
    if (reason === "unknown reference") changed.parents[0].operatorIds = [8];
    if (reason === "duplicate") changed.operators.push(changed.operators[0]);
    if (reason === "false self") changed.operators[1].relation = "self";
    if (reason === "workspace scoped") changed.operators[1].relation = "workspace_owner";
    if (reason === "fake historical meaning") (changed as unknown as Record<string, unknown>).meaning = "archived_membership";
    expect(() => filterOperationsBoardEditionRowsByOperator(rows(), changed, 3)).toThrow();
  });
  it("rejects filtered rows that do not match the selected numeric owner", () => {
    const selected = filterOperationsBoardEditionRowsByOperator(rows(), ownership(), 3, 4), issues: string[] = [];
    validateOperationsBoardEditionOwnershipResult({ ...selected, rows: rows(), userId: 3, operatorId: 4, visibility: "scoped", month: "2026-10" }, message => issues.push(message)); expect(issues).not.toEqual([]);
  });
  it("requires a complete unfiltered directory and does not leak unused current members", () => {
    const empty = { ...ownership(), operators: [], parents: [] };
    expect(OperationsBoardEditionOwnershipSchema.parse(empty)).toEqual(empty);
    expect(filterOperationsBoardEditionRowsByOperator([], empty, 3)).toEqual({ rows: [], ownership: empty });
  });
  it("does not broaden the legacy self-only ownership validator", () => {
    const legacy = OperationsBoardOwnershipSchema.parse({ version: 1, meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", status: "ready", reasonCode: null,
      visibility: "scoped", operators: [{ userId: 3, displayName: "Self" }, { userId: 4, displayName: "Partner" }], parents: ownership().parents.map(parent => ({ ...parent, reasonCode: null })),
      partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" } });
    expect(() => validateOperationsBoardOwnershipForRows(legacy, rows(), 3)).toThrow();
  });
});
