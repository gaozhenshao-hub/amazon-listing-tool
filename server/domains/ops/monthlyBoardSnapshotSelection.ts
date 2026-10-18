import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { parseMonthlyFinancialBatch, monthlyFinancialRowMatchesScope, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { SourceTableMissing, InvalidSource, IncompleteScan, positiveId, SCAN_BYTES_MAX, SCAN_BATCHES_MAX, query, noSuchTable, projection, sourceRecord, type Row, type Session, type MonthlyBoardMonthSelection } from "./monthlyBoardReadCore";

/** Internal transaction-owned proof, never an RPC response. Original records
 * include unrelated rows and uploader metadata and must not leave this layer. */
export type MonthlyBoardSnapshotCapture = { selections: MonthlyBoardMonthSelection[]; proof: {
  candidates: Row[]; records: MonthlyFinancialBatchRecord[];
  stopReason: "all_months_selected" | "candidate_set_exhausted";
} };
/** The fixed candidate set and original whole-month/store/site winner rule are
 * shared by the existing six-month board and an explicit pair of AI months.
 * Parent, currency and actor ownership must be applied only after selection. */
export async function selectMonthlyBoardSnapshots(session: Session, input: { months: string[]; storeName: string; country: string }): Promise<MonthlyBoardSnapshotCapture> {
  if (!input.months.length || input.months.length > 7 || new Set(input.months).size !== input.months.length || input.months.some(month => !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(month)) || !input.storeName || input.storeName !== input.storeName.trim() || input.storeName.length > 200 || normalizeMarketplaceCode(input.country) !== input.country) throw new InvalidSource();
  const records: MonthlyFinancialBatchRecord[] = [];
  const selections: MonthlyBoardMonthSelection[] = input.months.map(month => ({ month, selection: { selected: null, scannedBatchIds: [], complete: false }, metadataVisibility: session.manager ? "full" : "scoped" }));
  let candidates: Row[];
  try {
    // Fix and lock the candidate identities in one statement. Repeating
    // locking keyset reads could otherwise admit a newly completed old import
    // between months, even inside one transaction at READ COMMITTED.
    candidates = await query(session.tx, `SELECT id,workspaceId,status,
      OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes,
      OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes
      FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE`, [session.identity.workspaceId]);
  } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
  if (candidates.length > SCAN_BATCHES_MAX + 1 || candidates.some((row, index) => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.status !== "completed"
    || index > 0 && Number(row.id) >= Number(candidates[index - 1].id) || typeof row.payloadBytes !== "number" || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0
    || typeof row.monthsBytes !== "number" || !Number.isSafeInteger(row.monthsBytes) || row.monthsBytes < 0)) throw new InvalidSource();
  let scannedBytes = 0;
  for (let count = 0; count < Math.min(candidates.length, SCAN_BATCHES_MAX); count++) {
    const candidate = candidates[count];
    const remaining = SCAN_BYTES_MAX - scannedBytes;
    if (remaining <= 0 || Number(candidate.payloadBytes) + Number(candidate.monthsBytes) > remaining) throw new IncompleteScan();
    let selected: Row[];
    try {
      // Never add newly inserted/completed candidates, nor use uploader,
      // parent or ownership predicates to change a whole-scope winner.
      selected = await query(session.tx, `SELECT ${projection(remaining)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR SHARE`, [session.identity.workspaceId, candidate.id]);
    } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
    const row = selected[0];
    if (selected.length !== 1 || row.id !== candidate.id || row.payloadBytes !== candidate.payloadBytes || row.monthsBytes !== candidate.monthsBytes) throw new InvalidSource();
    const saved = sourceRecord(row, session.identity.workspaceId), parsed = parseMonthlyFinancialBatch(saved);
    records.push(saved);
    scannedBytes += Number(row.payloadBytes) + Number(row.monthsBytes);
    for (const item of selections) {
      if (item.selection.complete) continue;
      item.selection.scannedBatchIds.push(saved.id);
      if (parsed.rows.some(source => monthlyFinancialRowMatchesScope(source, { yearMonth: item.month, storeName: input.storeName, country: input.country }))) {
        item.selection.selected = parsed; item.selection.complete = true;
      }
    }
    if (selections.every(item => item.selection.complete)) return { selections, proof: { candidates, records, stopReason: "all_months_selected" } };
  }
  if (candidates.length <= SCAN_BATCHES_MAX) { for (const item of selections) item.selection.complete = true; return { selections, proof: { candidates, records, stopReason: "candidate_set_exhausted" } }; }
  throw new IncompleteScan();
}
