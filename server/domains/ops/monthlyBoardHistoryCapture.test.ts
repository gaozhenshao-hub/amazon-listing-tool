import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { OperationsBoardEditionCaptureSchema } from "../../../shared/operationsBoardEdition";
import { IncompleteScan, InvalidSource, type Session } from "./monthlyBoardReadCore";
import { captureOperationsBoardEdition, selectMonthlyBoardHistory, prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";

type Row = Record<string, unknown>;
const input = { month: "2026-10", storeName: "SYNTHETIC exact shop", country: "US" };
const rawRow = (patch: Row = {}) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])),
  yearMonth: input.month, parentAsin: "SYN-P1", asin: "SYN-C1", sku: "SYN-SKU", title: "SYNTHETIC full original title", storeName: input.storeName, site: "美国站", operator: "SYNTHETIC label not authority",
  financialProfit: 12, salesQty: 2, salesAmount: 40, raw: { currency: "USD", "原始字段": "原文\n完整保留", nested: { a: 1, b: 2 } }, ...patch });
function batch(id: number, rows: Row[] = [rawRow()]) {
  const payload = JSON.stringify(rows), months = JSON.stringify([...new Set(rows.map(row => row.yearMonth))]);
  return { id, workspaceId: 11, userId: 7, fileName: "SYNTHETIC.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length,
    months, monthsBytes: Buffer.byteLength(months), payload, payloadBytes: Buffer.byteLength(payload), createdAt: "2026-10-18 01:02:03.000000", confirmedAt: "2026-10-18 02:03:04.000000", fileReferenceKind: "storage" as const, sourceRunId: null };
}
type SavedBatch = Omit<ReturnType<typeof batch>, "fileReferenceKind" | "sourceRunId"> & { fileReferenceKind: "storage" | "saihu_sync_run" | "unknown"; sourceRunId: number | null };
function fixture(initial: SavedBatch[], options: { manager?: boolean; candidatePatch?: (rows: Row[]) => Row[]; afterCandidates?: () => void } = {}) {
  const records = initial, calls: { sql: string; params: unknown[] }[] = [];
  const tx = { async execute(statement: SQL) {
    const query = new MySqlDialect().sqlToQuery(statement); calls.push(query);
    if (!query.sql.startsWith("SELECT ") || !query.sql.includes("FROM ops_monthly_profit_imports") || !query.sql.endsWith("FOR SHARE")) throw Error("Unexpected source operation");
    if (query.sql.includes("LIMIT 201")) {
      const values = records.filter(row => row.workspaceId === query.params[0] && row.status === "completed").sort((a, b) => b.id - a.id).slice(0, 201).map(({ id, workspaceId, status, payloadBytes, monthsBytes }) => ({ id, workspaceId, status, payloadBytes, monthsBytes }));
      const result = options.candidatePatch?.(values) ?? values; options.afterCandidates?.(); return [result, []];
    }
    return [records.filter(row => row.workspaceId === query.params[0] && row.id === query.params[1]), []];
  } };
  return { records, calls, session: { tx, identity: { userId: 7, workspaceId: 11 }, manager: options.manager ?? true } satisfies Session };
}

describe("complete immutable shop/site edition source capture", () => {
  it("reads a nine-month production-sized history above 32 MiB without losing January", async () => {
    const records = Array.from({ length: 9 }, (_, i) => batch(9-i, Array.from({ length: 125 }, (_, j) => rawRow({
      yearMonth: `2026-${String(9-i).padStart(2,"0")}`, asin: `SYN-${j}`, raw: { currency: "USD", originalText: "x".repeat(32000) },
    }))));
    const bytes = records.reduce((sum, r) => sum+r.payloadBytes+r.monthsBytes, 0);
    expect(bytes).toBeGreaterThan(32*1024*1024);
    expect(bytes).toBeLessThan(64*1024*1024);
    const result = await selectMonthlyBoardHistory(fixture(records).session, input);
    expect(result.history.complete).toBe(true);
    expect(result.selections.map(s => s.month)).toEqual(Array.from({ length: 9 }, (_, i) => `2026-${String(i+1).padStart(2,"0")}`));
    expect(result.selections.flatMap(s => s.selection.selected!.rows).length).toBe(1125);
  }, 60000);
  it.each([
    { fileReferenceKind: "storage", sourceRunId: null, kind: "uploaded_file", hashBasis: "original_file_bytes" },
    { fileReferenceKind: "saihu_sync_run", sourceRunId: 17, kind: "saihu_sync", hashBasis: "mapped_json_bytes" },
    { fileReferenceKind: "unknown", sourceRunId: null, kind: "unknown", hashBasis: "unknown" },
  ] as const)("both capture paths retain saved origin, never raw claims: %j", origin => {
    const record: SavedBatch = { ...batch(5, [rawRow({ raw: { source: "sellfox_monthly_api", forgedOrigin: "saihu_sync" } })]), fileReferenceKind: origin.fileReferenceKind, sourceRunId: origin.sourceRunId };
    const prepared = prepareOperationsBoardHistoryCapture([record], 11).capture(input);
    expect(prepared.sources[0].origin).toEqual({ kind: origin.kind, hashBasis: origin.hashBasis, sourceRunId: origin.sourceRunId });
    return captureOperationsBoardEdition(fixture([record]).session, input).then(selected => {
      expect(selected.sources[0].origin).toEqual(prepared.sources[0].origin);
      expect(selected.sourceHash).toBe(prepared.sourceHash);
    });
  });
  it("captures all saved historical rows, not six months or a product page, without owner/name filtering", async () => {
    const records = Array.from({ length: 20 }, (_, index) => batch(100 + index, [rawRow({ yearMonth: `${2025 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`, operator: index % 2 ? "SYNTHETIC other owner" : "" })]));
    const source = fixture(records), result = await captureOperationsBoardEdition(source.session, input);
    expect(result.rows).toHaveLength(20); expect(result.sources).toHaveLength(20); expect(result.scannedBatches).toHaveLength(20);
    expect(result.rows[0].yearMonth).toBe("2025-01"); expect(result.rows[0].raw["原始字段"]).toBe("原文\n完整保留");
    expect(result.scannedBatches.map(record => record.id)).toEqual(Array.from({ length: 20 }, (_, index) => 119 - index));
    expect(source.calls).toHaveLength(21); expect(source.calls.every(call => !/users|owner|operator_name|UPDATE|INSERT/u.test(call.sql))).toBe(true);
    expect(OperationsBoardEditionCaptureSchema.safeParse(result).success).toBe(true);
  });
  it("chooses the whole newest exact month/shop/site batch before parents and keeps all its children", async () => {
    const source = fixture([batch(1, [rawRow({ parentAsin: "OLD_ONLY" }), rawRow({ yearMonth: "2026-09" })]), batch(2, [rawRow(), rawRow({ asin: "SYN-C2" }), rawRow({ storeName: "other shop" }), rawRow({ site: "CA" })])]);
    const result = await captureOperationsBoardEdition(source.session, input);
    expect(result.sources.map(item => [item.month, item.batchId, item.rowCount])).toEqual([["2026-09", 1, 1], ["2026-10", 2, 2]]);
    expect(result.rows).toHaveLength(3); expect(result.rows.some(row => row.parentAsin === "OLD_ONLY")).toBe(false);
    expect(result.rows.every(row => row.storeName === input.storeName && row.country === "US")).toBe(true);
  });
  it("retains unallocated/unknown currency and null financial facts instead of fabricating totals", async () => {
    const result = await captureOperationsBoardEdition(fixture([batch(1, [rawRow({ parentAsin: "", financialProfit: null, raw: { completeOriginal: "unknown currency" } })])]).session, input);
    expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({ parentAsin: "", currency: null, allocation: "unallocated", metrics: { financialProfit: null } });
  });
  it("binds original payload changes even when fileHash, batch ID and row counts stay the same", async () => {
    const first = await captureOperationsBoardEdition(fixture([batch(1)]).session, input);
    const second = await captureOperationsBoardEdition(fixture([batch(1, [rawRow({ financialProfit: 99 })])]).session, input);
    expect(first.scannedBatches[0].recordHash).not.toBe(second.scannedBatches[0].recordHash);
    expect(first.sourceHash).not.toBe(second.sourceHash); expect(first.selectionHash).not.toBe(second.selectionHash);
  });
  it("uses canonical JSON meaning, not native wire object-key ordering", async () => {
    const original = rawRow(), reversed = Object.fromEntries(Object.entries(original).reverse());
    const a = await captureOperationsBoardEdition(fixture([batch(1, [original])]).session, input);
    const b = await captureOperationsBoardEdition(fixture([batch(1, [reversed])]).session, input);
    expect(a.sourceHash).toBe(b.sourceHash); expect(a.selectionHash).toBe(b.selectionHash);
  });
  it("records even nonwinning candidates in the full selection proof", async () => {
    const a = await captureOperationsBoardEdition(fixture([batch(2), batch(1, [rawRow({ storeName: "other" })])]).session, input);
    const b = await captureOperationsBoardEdition(fixture([batch(2), batch(1, [rawRow({ storeName: "other", financialProfit: 80 })])]).session, input);
    expect(a.rows).toEqual(b.rows); expect(a.scannedBatches).toHaveLength(2); expect(a.selectionHash).not.toBe(b.selectionHash);
  });
  it("does not invent current-month rows when only historical sources remain", async () => {
    const result = await captureOperationsBoardEdition(fixture([batch(1, [rawRow({ yearMonth: "2026-09" })])]).session, input);
    expect(result.rows).toHaveLength(1); expect(result.sources.some(source => source.month === input.month)).toBe(false);
    const empty = await captureOperationsBoardEdition(fixture([]).session, input);
    expect(empty.rows).toEqual([]); expect(empty.sources).toEqual([]); expect(empty.scannedBatches).toEqual([]);
  });
  it("fixes candidate identities once; a later candidate cannot enter the capture", async () => {
    const records = [batch(1)]; const source = fixture(records, { afterCandidates: () => records.push(batch(2)) });
    const result = await captureOperationsBoardEdition(source.session, input);
    expect(result.scannedBatches.map(row => row.id)).toEqual([1]); expect(result.sources[0].batchId).toBe(1);
  });
  it("refuses managerless capture before any source query", async () => {
    const source = fixture([batch(1)], { manager: false });
    await expect(captureOperationsBoardEdition(source.session, input)).rejects.toBeInstanceOf(InvalidSource); expect(source.calls).toHaveLength(0);
  });
  it.each([{ country: "美国" }, { storeName: " padded " }, { month: "2026-13" }])("rejects noncanonical capture scope %j", async patch => {
    const source = fixture([batch(1)]); await expect(captureOperationsBoardEdition(source.session, { ...input, ...patch })).rejects.toThrow(); expect(source.calls).toHaveLength(0);
  });
  it("rejects incomplete scans including nonwinning historical candidates", async () => {
    const source = fixture(Array.from({ length: 201 }, (_, index) => batch(index + 1)));
    await expect(captureOperationsBoardEdition(source.session, input)).rejects.toBeInstanceOf(IncompleteScan);
  });
  it("enforces wire budget before loading an oversized candidate", async () => {
    const source = fixture([batch(1)], { candidatePatch: rows => rows.map(row => ({ ...row, payloadBytes: 64 * 1024 * 1024 })) });
    await expect(captureOperationsBoardEdition(source.session, input)).rejects.toBeInstanceOf(IncompleteScan); expect(source.calls).toHaveLength(1);
  });
  it("keeps ordinary live reads on their existing selection without archive proof side effects", async () => {
    const source = fixture([batch(1)], { manager: false });
    const result = await selectMonthlyBoardHistory(source.session, input);
    expect(result.scannedBatches).toEqual([]); expect(result.selections[0].metadataVisibility).toBe("scoped");
    expect(result.history).toEqual({ complete: true, scannedCount: 1, visibility: "scoped" }); expect(source.calls).toHaveLength(2);
  });
  it("reuses locked post-state records with identical full SQL capture and no repeated SQL", async () => {
    const records = [batch(2, [rawRow(), rawRow({ site: "CA", yearMonth: "2026-12" })]), batch(1, [rawRow({ yearMonth: "2026-08" }), rawRow({ parentAsin: "OLD_ONLY" })])];
    const prepared = prepareOperationsBoardHistoryCapture(records, 11), sql = await captureOperationsBoardEdition(fixture(records).session, input);
    expect(prepared.capture(input)).toEqual(sql);
    expect(prepared.latestMonth({ storeName: input.storeName, country: "US" })).toBe("2026-10");
    expect(prepared.latestMonth({ storeName: input.storeName, country: "CA" })).toBe("2026-12");
    expect(prepared.latestMonth({ storeName: "Other", country: "US" })).toBeNull();
  });
  it("retains duplicate business rows with distinct original row indexes", () => {
    const result = prepareOperationsBoardHistoryCapture([batch(1, [rawRow({ asin: "" }), rawRow({ asin: "" })])], 11).capture(input);
    expect(result.rows.map(row => row.rowIndex)).toEqual([0, 1]);
    expect(result.coverage.rowCount).toBe(2);
  });
  it("keeps a prepared capture fixed if the caller later mutates its record list", () => {
    const records = [batch(1)], prepared = prepareOperationsBoardHistoryCapture(records, 11), before = prepared.capture(input);
    records.push(batch(2)); records[0].payload = "[]";
    expect(prepared.capture(input)).toEqual(before);
  });
  it.each(["workspace", "status", "order", "duplicate", "count", "bytes"])("refuses incomplete or invalid post-state records: %s", reason => {
    let records: MonthlyFinancialBatchRecord[] = [batch(2), batch(1)];
    if (reason === "workspace") records[0].workspaceId = 12;
    if (reason === "status") records[0].status = "deleted";
    if (reason === "order") records.reverse();
    if (reason === "duplicate") records[1].id = 2;
    if (reason === "count") records = Array.from({ length: 201 }, (_, index) => batch(201 - index));
    if (reason === "bytes") records[0].payload = " ".repeat(64 * 1024 * 1024);
    expect(() => prepareOperationsBoardHistoryCapture(records, 11)).toThrow();
  });
});
