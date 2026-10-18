import { parseMonthlyFinancialBatch, monthlyFinancialRowMatchesScope, monthlyFinancialJsonBytes, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { operationsBoardEditionHash, OperationsBoardEditionScopeSchema, buildOperationsBoardEditionCapture } from "../../../shared/operationsBoardEdition";
import { SourceTableMissing, InvalidSource, IncompleteScan, positiveId, SCAN_BYTES_MAX, SCAN_BATCHES_MAX, query, noSuchTable, projection, sourceRecord, type Row, type Session, type MonthlyBoardMonthSelection } from "./monthlyBoardReadCore";

export type MonthlyBoardHistoryScope = { month: string; storeName: string; country: string };
/** Reuse a complete, locked post-transition candidate set. This is deliberately
 * an internal source-record API, never a public DTO or a paginated result.
 * Hash/parse each record once even when a batch affects several shop/site pairs. */
export function prepareOperationsBoardHistoryCapture(records: readonly MonthlyFinancialBatchRecord[], workspaceId: number) {
  if (!positiveId(workspaceId) || !Array.isArray(records) || records.length > SCAN_BATCHES_MAX) throw new IncompleteScan();
  let bytes = 0;
  const parsed = records.map((record, index) => {
    if (!positiveId(record.id) || record.workspaceId !== workspaceId || record.status !== "completed"
      || index > 0 && record.id >= records[index - 1].id) throw new InvalidSource();
    const monthsBytes = typeof record.months === "string" ? Buffer.byteLength(record.months) : monthlyFinancialJsonBytes(record.months);
    const payloadBytes = typeof record.payload === "string" ? Buffer.byteLength(record.payload) : monthlyFinancialJsonBytes(record.payload);
    bytes += monthsBytes + payloadBytes;
    if (bytes > SCAN_BYTES_MAX) throw new IncompleteScan();
    const batch = parseMonthlyFinancialBatch(record);
    const recordHash = operationsBoardEditionHash({ id: record.id, workspaceId: record.workspaceId, userId: record.userId, fileName: record.fileName,
      fileHash: record.fileHash, status: record.status, totalRows: record.totalRows, skippedRows: record.skippedRows, unallocatedRows: record.unallocatedRows,
      months: typeof record.months === "string" ? JSON.parse(record.months) : record.months,
      payload: typeof record.payload === "string" ? JSON.parse(record.payload) : record.payload,
      createdAt: record.createdAt, confirmedAt: record.confirmedAt, fileReferenceKind: record.fileReferenceKind ?? "unknown", sourceRunId: record.sourceRunId ?? null });
    return { batch, recordHash };
  });
  const checkedScope = (scope: { storeName: string; country: string }) => OperationsBoardEditionScopeSchema.parse({ ...scope, workspaceId });
  return {
    latestMonth(input: { storeName: string; country: string }): string | null {
      const scope = checkedScope(input);
      let latest: string | null = null;
      for (const { batch } of parsed) for (const row of batch.rows) {
        if (monthlyFinancialRowMatchesScope(row, { ...scope, yearMonth: row.yearMonth }) && (latest === null || row.yearMonth > latest)) latest = row.yearMonth;
      }
      return latest;
    },
    capture(input: MonthlyBoardHistoryScope) {
      const scope = checkedScope({ storeName: input.storeName, country: input.country });
      if (!/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(input.month)) throw new InvalidSource();
      const winners = new Map<string, { batchId: number; recordHash: string; origin: ReturnType<typeof parseMonthlyFinancialBatch>["batch"]["origin"]; rows: ReturnType<typeof parseMonthlyFinancialBatch>["rows"] }>();
      for (const { batch, recordHash } of parsed) {
        const matching = batch.rows.filter(row => row.yearMonth <= input.month && monthlyFinancialRowMatchesScope(row, { ...scope, yearMonth: row.yearMonth }));
        for (const row of matching) if (!winners.has(row.yearMonth)) winners.set(row.yearMonth, { batchId: batch.batch.id, recordHash, origin: batch.batch.origin, rows: matching.filter(other => other.yearMonth === row.yearMonth) });
      }
      const selected = [...winners].sort(([a], [b]) => a.localeCompare(b));
      return buildOperationsBoardEditionCapture({ scope, month: input.month,
        scannedBatches: parsed.map(({ batch, recordHash }) => ({ id: batch.batch.id, recordHash })),
        sources: selected.map(([month, source]) => ({ month, batchId: source.batchId, recordHash: source.recordHash, rowCount: source.rows.length, origin: source.origin })),
        rows: selected.flatMap(([, source]) => source.rows) });
    },
  };
}
/** Internal complete fixed-set selector. Caller supplies its authorized
 * transaction; this performs no owner filtering and grants no read access.
 * Existing live reads omit proof hashing. Archives request it explicitly. */
export async function selectMonthlyBoardHistory(session: Session, input: MonthlyBoardHistoryScope, recordProof = false) {
  const winners = new Map<string, MonthlyBoardMonthSelection>();
  let candidates: Row[];
  try {
    // Fix all candidate identities once before reading any payload. A newly
    // completed/injected record cannot join this view halfway through.
    candidates = await query(session.tx, `SELECT id,workspaceId,status,
      OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes,
      OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes
      FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE`, [session.identity.workspaceId]);
  } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
  if (candidates.length > SCAN_BATCHES_MAX + 1 || candidates.some((row, index) => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.status !== "completed"
    || index > 0 && Number(row.id) >= Number(candidates[index - 1].id) || typeof row.payloadBytes !== "number" || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0
    || typeof row.monthsBytes !== "number" || !Number.isSafeInteger(row.monthsBytes) || row.monthsBytes < 0)) throw new InvalidSource();
  let scannedBytes = 0;
  const scannedBatchIds: number[] = [];
  const scannedBatches: Array<{ id: number; recordHash: string }> = [];
  for (const candidate of candidates.slice(0, SCAN_BATCHES_MAX)) {
    const remaining = SCAN_BYTES_MAX - scannedBytes;
    if (remaining <= 0 || Number(candidate.payloadBytes) + Number(candidate.monthsBytes) > remaining) throw new IncompleteScan();
    let records: Row[];
    try {
      records = await query(session.tx, `SELECT ${projection(remaining)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR SHARE`, [session.identity.workspaceId, candidate.id]);
    } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
    const row = records[0];
    if (records.length !== 1 || row.id !== candidate.id || row.payloadBytes !== candidate.payloadBytes || row.monthsBytes !== candidate.monthsBytes) throw new InvalidSource();
    const saved = sourceRecord(row, session.identity.workspaceId), parsed = parseMonthlyFinancialBatch(saved);
    scannedBytes += Number(row.payloadBytes) + Number(row.monthsBytes); scannedBatchIds.push(saved.id);
    if (recordProof) scannedBatches.push({ id: saved.id, recordHash: operationsBoardEditionHash({ ...saved, months: JSON.parse(saved.months as string), payload: JSON.parse(saved.payload as string) }, 64 * 1024 * 1024) });
    // Decide the newest complete month/store/site batch before any parent,
    // uploader or live owner filtering. Never fill a missing parent from older.
    for (const source of parsed.rows) {
      if (source.yearMonth > input.month || winners.has(source.yearMonth) || !monthlyFinancialRowMatchesScope(source, { yearMonth: source.yearMonth, storeName: input.storeName, country: input.country })) continue;
      winners.set(source.yearMonth, { month: source.yearMonth, selection: { selected: parsed, scannedBatchIds: [...scannedBatchIds], complete: true }, metadataVisibility: session.manager ? "full" : "scoped" });
    }
    // Unlike the six-month profit board, a complete quarter does not prove
    // all-history coverage. Always reach the fixed candidate set bottom.
  }
  if (candidates.length > SCAN_BATCHES_MAX) throw new IncompleteScan();
  return { scannedBatches, selections: [...winners.values()].sort((a, b) => a.month.localeCompare(b.month)), history: { complete: true, scannedCount: scannedBatchIds.length, visibility: session.manager ? "full" as const : "scoped" as const } };
}

/** Internal manager/background capture, not a public RPC or read response.
 * Never call after per-user authorization pruning, search or pagination.
 * Business write authorization and workspace locking belong to the caller. */
export async function captureOperationsBoardEdition(session: Session, input: MonthlyBoardHistoryScope) {
  const scope = OperationsBoardEditionScopeSchema.parse({ workspaceId: session.identity.workspaceId, storeName: input.storeName, country: input.country });
  if (!session.manager || !positiveId(session.identity.userId) || !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(input.month)) throw new InvalidSource();
  const history = await selectMonthlyBoardHistory(session, input, true);
  const hashes = new Map(history.scannedBatches.map(batch => [batch.id, batch.recordHash]));
  const rows = history.selections.flatMap(selection => selection.selection.selected!.rows.filter(row => monthlyFinancialRowMatchesScope(row, { yearMonth: selection.month, storeName: input.storeName, country: input.country })));
  const sources = history.selections.map(selection => {
    const batchId = selection.selection.selected!.batch.id, recordHash = hashes.get(batchId);
    if (!recordHash || selection.metadataVisibility !== "full" || selection.authorizedRowRefs !== undefined) throw new InvalidSource();
    return { month: selection.month, batchId, recordHash, rowCount: rows.filter(row => row.yearMonth === selection.month).length, origin: selection.selection.selected!.batch.origin };
  });
  return buildOperationsBoardEditionCapture({ scope, month: input.month, scannedBatches: history.scannedBatches, sources, rows });
}
