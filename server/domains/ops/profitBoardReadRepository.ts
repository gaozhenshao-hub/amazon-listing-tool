import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { MonthlyFinancialReadError, parseMonthlyFinancialBatch, monthlyFinancialRowMatchesScope } from "../../../shared/monthlyFinancialRead";
import { ProfitBoardReadInputSchema, ProfitBoardReadError, profitBoardMonths, buildProfitBoardReadResult, buildProfitBoardReadFailure, type ProfitBoardReadInput, type ProfitBoardMonthSelection } from "../../../shared/profitBoardRead";
import { MonthlyBoardReadGuardError, SourceTableMissing, InvalidSource, IncompleteScan, positiveId, SCAN_BYTES_MAX, SCAN_BATCHES_MAX, query, noSuchTable, projection, sourceRecord, authorizeMonths, type Row, type Code, type Session } from "./monthlyBoardReadCore";

export interface ProfitBoardReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
async function selectMonths(session: Session, input: ProfitBoardReadInput): Promise<ProfitBoardMonthSelection[]> {
  const selections: ProfitBoardMonthSelection[] = profitBoardMonths(input.month).map(month => ({ month, selection: { selected: null, scannedBatchIds: [], complete: false }, metadataVisibility: session.manager ? "full" : "scoped" }));
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
    scannedBytes += Number(row.payloadBytes) + Number(row.monthsBytes);
    for (const item of selections) {
      if (item.selection.complete) continue;
      item.selection.scannedBatchIds.push(saved.id);
      if (parsed.rows.some(source => monthlyFinancialRowMatchesScope(source, { yearMonth: item.month, storeName: input.storeName, country: input.country }))) {
        item.selection.selected = parsed; item.selection.complete = true;
      }
    }
    if (selections.every(item => item.selection.complete)) return selections;
  }
  if (candidates.length <= SCAN_BATCHES_MAX) { for (const item of selections) item.selection.complete = true; return selections; }
  throw new IncompleteScan();
}
function sanitized(error: unknown): never {
  if (error instanceof MonthlyBoardReadGuardError) fail(`PROFIT_BOARD_READ_${error.message}`, error.code as Code);
  if (error instanceof TRPCError && /^PROFIT_BOARD_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("PROFIT_BOARD_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("PROFIT_BOARD_READ_FAILED", "INTERNAL_SERVER_ERROR");
}
/** A fresh, bounded, source-only projection. No edition refresh/initialization,
 * notes, schedules, uploader shortcut, name-based member list or model call. */
export function createProfitBoardReadRepository(dependencies: { database?: () => Promise<ProfitBoardReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function get(ctx: TrpcContext, raw: ProfitBoardReadInput) {
    try {
      if (!ctx.user) fail("PROFIT_BOARD_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = ProfitBoardReadInputSchema.safeParse(raw);
      if (!parsed.success) fail("PROFIT_BOARD_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("PROFIT_BOARD_READ_ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("PROFIT_BOARD_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database(); if (!db || typeof db.transaction !== "function") fail("PROFIT_BOARD_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("PROFIT_BOARD_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        const session: Session = { tx, identity: { userId: actor.id as number, workspaceId }, manager: ["super_admin", "admin", "ops_manager"].includes(actor.role as string) };
        try {
          const selections = await selectMonths(session, input);
          await authorizeMonths(session, input, selections);
          return buildProfitBoardReadResult({ identity: session.identity, input, selections });
        } catch (error) {
          if (error instanceof SourceTableMissing) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "missing", reasonCode: "table_missing", missingReason: "月度财务来源表尚未接通，不代表利润为零" });
          if (error instanceof IncompleteScan) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "scan_incomplete", missingReason: "有界扫描未能完整确定六个月来源；不返回部分看板或回退旧批次" });
          if (error instanceof InvalidSource || error instanceof MonthlyFinancialReadError || error instanceof ProfitBoardReadError) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "invalid_source", missingReason: "候选财务批次或看板完整性无法核验；不截断、补零或回退旧来源" });
          throw error;
        }
      });
    } catch (error) { return sanitized(error); }
  }
  return { get };
}
export const profitBoardReadRepository = createProfitBoardReadRepository();
