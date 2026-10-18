import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "./monthlyFinancialRead";
import { OperationsBoardOwnershipSchema, OperationsBoardOwnershipError, validateOperationsBoardOwnershipForRows, filterOperationsBoardRowsByOperator, buildUnavailableOperationsBoardOwnership, type OperationsBoardOwnership } from "./operationsBoardOwnership";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function rows() {
  const payload = ["2026-09", "2026-10"].map(yearMonth => ({ yearMonth, storeName: "Store", site: "US", parentAsin: "P", asin: "A", sku: "SKU", title: "Synthetic", operator: "Source name is not authority", ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])) as MonthlyFinancialMetrics, raw: { currency: "USD" } }));
  const record: MonthlyFinancialBatchRecord = { id: 90, workspaceId: 11, userId: 7, status: "completed", fileName: "synthetic.xlsx", fileHash: "a".repeat(64), totalRows: payload.length, skippedRows: 0, unallocatedRows: 0, months: ["2026-09", "2026-10"], createdAt: "2026-10-10 10:00:00.000000", confirmedAt: "2026-10-10 11:00:00.000000", fileReferenceKind: "storage", payload };
  return parseMonthlyFinancialBatch(record).rows;
}
function directory(): OperationsBoardOwnership { return { version: 1, meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", status: "ready", reasonCode: null, visibility: "full", operators: [{ userId: 7, displayName: "Synthetic A" }, { userId: 8, displayName: "Synthetic B" }], parents: [{ parentAsin: "P", operatorIds: [7, 8], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: "2026-10", reasonCode: null }], partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" } }; }

describe("current numeric operator filtering metadata is not authorization or partner evidence", () => {
  it("keeps shared ownership without duplicating any financial original", () => {
    const original = rows(), ownership = validateOperationsBoardOwnershipForRows(directory(), original, 7);
    for (const operatorId of [7, 8]) expect(filterOperationsBoardRowsByOperator(original, ownership, operatorId)).toEqual(original);
    expect(filterOperationsBoardRowsByOperator(original, ownership)).toEqual(original);
  });
  it("does not mutate original rows or ownership during filtering", () => {
    const original = rows(), before = clone(original), ownership = directory(), copy = clone(ownership);
    filterOperationsBoardRowsByOperator(original, ownership, 7); expect(original).toEqual(before); expect(ownership).toEqual(copy);
  });
  it("requires the latest visible month, not the newest month of another parent", () => {
    const original = rows(); original[1].parentAsin = "Q";
    const value = directory(); value.parents[0].sourceMonth = "2026-09"; value.parents.push({ ...value.parents[0], parentAsin: "Q", sourceMonth: "2026-10" });
    expect(validateOperationsBoardOwnershipForRows(value, original, 7)).toEqual(value);
    value.parents[0].sourceMonth = "2026-10"; expect(() => validateOperationsBoardOwnershipForRows(value, original, 7)).toThrow(OperationsBoardOwnershipError);
  });
  it("allows a manual owner without claiming a financial source month", () => {
    const value = directory(); value.parents[0].basis = "manual"; value.parents[0].sourceMonth = null;
    expect(validateOperationsBoardOwnershipForRows(value, rows(), 7)).toEqual(value);
  });
  it("keeps unavailable registry distinct from missing mapping and cannot filter it", () => {
    const original = rows(), value = buildUnavailableOperationsBoardOwnership(original, "full");
    expect(value).toMatchObject({ status: "unavailable", reasonCode: "registry_unavailable", operators: [], parents: [{ parentAsin: "P", status: "unresolved", basis: "none", sourceMonth: null, reasonCode: "registry_unavailable" }] });
    expect(validateOperationsBoardOwnershipForRows(value, original, 7)).toEqual(value);
    expect(filterOperationsBoardRowsByOperator(original, value)).toEqual(original);
    expect(() => filterOperationsBoardRowsByOperator(original, value, 7)).toThrow(OperationsBoardOwnershipError);
  });
  it("keeps unresolved and conflict parents unfiltered but never attributes them", () => {
    const value = directory(); value.parents[0] = { ...value.parents[0], operatorIds: [], status: "conflict", reasonCode: "mapping_conflict" };
    expect(validateOperationsBoardOwnershipForRows(value, rows(), 7)).toEqual(value);
    expect(filterOperationsBoardRowsByOperator(rows(), value, 7)).toEqual([]);
    expect(filterOperationsBoardRowsByOperator(rows(), value)).toHaveLength(2);
  });
  it("scoped directories expose self only, not an invented full co-owner list", () => {
    const value = directory(); value.visibility = "scoped"; value.operators = [value.operators[0]]; value.parents[0].operatorIds = [7];
    expect(validateOperationsBoardOwnershipForRows(value, rows(), 7)).toEqual(value);
    expect(() => validateOperationsBoardOwnershipForRows(value, rows(), 8)).toThrow(OperationsBoardOwnershipError);
    value.operators.push({ userId: 8, displayName: "Synthetic B" }); expect(() => validateOperationsBoardOwnershipForRows(value, rows(), 7)).toThrow(OperationsBoardOwnershipError);
  });
  it.each(["missing", "extra", "stale"])("rejects %s metadata even without an operator filter", kind => {
    const value = directory();
    if (kind === "missing") value.parents = [];
    if (kind === "extra") value.parents.push({ ...value.parents[0], parentAsin: "OTHER" });
    if (kind === "stale") value.parents[0].sourceMonth = "2026-09";
    expect(() => validateOperationsBoardOwnershipForRows(value, rows(), 7)).toThrow(OperationsBoardOwnershipError);
  });
  it.each([0, -1, 1.1, 2147483648, NaN, Infinity, 9])("rejects unknown or invalid selected operator %s", operatorId => expect(() => filterOperationsBoardRowsByOperator(rows(), directory(), operatorId)).toThrow(OperationsBoardOwnershipError));
  it("cannot turn names, saved owners, or partners into trusted metadata", () => {
    expect(OperationsBoardOwnershipSchema.safeParse({ ...directory(), ownerIds: [7] }).success).toBe(false);
    expect(OperationsBoardOwnershipSchema.safeParse({ ...directory(), partners: { status: "ready", userIds: [8] } }).success).toBe(false);
    expect(OperationsBoardOwnershipSchema.safeParse({ ...directory(), operators: [{ userId: 7, displayName: "Synthetic", email: "synthetic@example.invalid" }] }).success).toBe(false);
  });
  it.each(["operator", "parent", "owner", "reference", "status", "month", "manualMonth", "noneConflict", "global", "unavailable", "unavailableParent"])("rejects inconsistent %s metadata", kind => {
    const value = directory();
    if (kind === "operator") value.operators.push(value.operators[0]);
    if (kind === "parent") value.parents.push(value.parents[0]);
    if (kind === "owner") value.parents[0].operatorIds.push(7);
    if (kind === "reference") value.parents[0].operatorIds = [9];
    if (kind === "status") value.parents[0].status = "unresolved";
    if (kind === "month") value.parents[0].sourceMonth = null;
    if (kind === "manualMonth") value.parents[0].basis = "manual";
    if (kind === "noneConflict") value.parents[0] = { ...value.parents[0], basis: "none", sourceMonth: null, status: "conflict", operatorIds: [], reasonCode: "mapping_conflict" };
    if (kind === "global") value.reasonCode = "registry_unavailable";
    if (kind === "unavailable") value.status = "unavailable";
    if (kind === "unavailableParent") { Object.assign(value, buildUnavailableOperationsBoardOwnership(rows(), "full")); value.parents[0].reasonCode = "mapping_missing"; }
    expect(OperationsBoardOwnershipSchema.safeParse(value).success).toBe(false);
  });
  it("bounds plain JSON before inspecting getters or accepting huge directories", () => {
    let called = false; const value = { ...directory() }; Object.defineProperty(value, "operators", { enumerable: true, get() { called = true; return []; } });
    expect(OperationsBoardOwnershipSchema.safeParse(value).success).toBe(false); expect(called).toBe(false);
    expect(OperationsBoardOwnershipSchema.safeParse({ ...directory(), operators: Array.from({ length: 5001 }, (_, index) => ({ userId: index + 1, displayName: "Synthetic" })) }).success).toBe(false);
  });
});
