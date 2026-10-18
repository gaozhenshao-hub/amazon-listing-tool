import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialRead";
import { selectMonthlyBoardSnapshots } from "./monthlyBoardSnapshotSelection";
import { InvalidSource } from "./monthlyBoardReadCore";

const input = { months: ["2026-08", "2026-09"], storeName: "Store", country: "US" };
function harness(months = input.months) {
  const payload = JSON.stringify(months.map(yearMonth => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])),
    yearMonth, parentAsin: "PARENT", asin: "CHILD", sku: "SKU", title: "Original", storeName: "Store", site: "US", operator: "Operator", raw: { currency: "USD" } })));
  const record = { id: 9, workspaceId: 7, userId: 4, status: "completed", fileName: "private.xlsx", fileHash: "a".repeat(64), totalRows: months.length, skippedRows: 0, unallocatedRows: 0,
    months: JSON.stringify(months), monthsBytes: Buffer.byteLength(JSON.stringify(months)), payload, payloadBytes: Buffer.byteLength(payload), createdAt: "2026-10-01 00:00:00.000000", confirmedAt: "2026-10-01 00:00:00.000000", fileReferenceKind: "storage", sourceRunId: null };
  const execute = vi.fn(async (statement: SQL) => {
    const query = new MySqlDialect().sqlToQuery(statement);
    return [query.sql.includes("LIMIT 201") ? [{ id: 9, workspaceId: 7, status: "completed", payloadBytes: record.payloadBytes, monthsBytes: record.monthsBytes }] : [record], []];
  });
  return { execute, record, session: { tx: { execute } as unknown as DbExecutor, identity: { userId: 3, workspaceId: 7 }, manager: true } };
}
describe("transaction-owned monthly snapshot selection", () => {
  it("returns unchanged selections plus private original-record capture", async () => {
    const { session, execute, record } = harness(); const capture = await selectMonthlyBoardSnapshots(session, input);
    expect(capture.proof.stopReason).toBe("all_months_selected"); expect(capture.proof.records).toHaveLength(1);
    expect(capture.proof.records[0]).toMatchObject({ fileName: "private.xlsx", payload: record.payload });
    expect(capture.selections.map(item => item.selection.selected?.batch.id)).toEqual([9, 9]); expect(execute).toHaveBeenCalledTimes(2);
  });
  it("supports seven explicit months without changing the old six-month caller", async () => {
    const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const { session } = harness(months); expect((await selectMonthlyBoardSnapshots(session, { ...input, months })).selections).toHaveLength(7);
  });
  it("proves exhausted candidates for a genuinely absent month", async () => {
    const { session } = harness(["2026-09"]); const capture = await selectMonthlyBoardSnapshots(session, input);
    expect(capture.proof.stopReason).toBe("candidate_set_exhausted"); expect(capture.selections[0].selection).toEqual({ selected: null, complete: true, scannedBatchIds: [9] });
  });
  it.each([[], ["2026-09", "2026-09"], ["2026-13"], ["2026-00"], ["2026-1"], ["0999-01"], Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}`)].map(months => ({ months })))("rejects invalid month set $months before queries", async ({ months }) => {
    const { session, execute } = harness(); await expect(selectMonthlyBoardSnapshots(session, { ...input, months })).rejects.toBeInstanceOf(InvalidSource); expect(execute).not.toHaveBeenCalled();
  });
  it.each([{ country: "美国" }, { storeName: " Store" }, { storeName: "" }])("requires previously validated exact normalized selection scope %j", async patch => {
    const { session, execute } = harness(); await expect(selectMonthlyBoardSnapshots(session, { ...input, ...patch })).rejects.toBeInstanceOf(InvalidSource); expect(execute).not.toHaveBeenCalled();
  });
});
