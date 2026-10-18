import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { MonthlyFinancialReadError, parseMonthlyFinancialBatch, monthlyFinancialRowMatchesScope } from "../../../shared/monthlyFinancialRead";
import { OperationsBoardOwnershipError } from "../../../shared/operationsBoardOwnership";
import { resolveOperationsBoardOwnership, unavailableOperationsBoardOwnership } from "./operationsBoardOwnership";
import { ProductBoardReadInputSchema, ProductBoardReadError, buildProductBoardReadResult, buildProductBoardReadFailure, type ProductBoardReadInput, type ProductBoardMonthSelection } from "../../../shared/productBoardRead";
import { MonthlyBoardReadGuardError, SourceTableMissing, InvalidSource, IncompleteScan, positiveId, SCAN_BYTES_MAX, SCAN_BATCHES_MAX, query, noSuchTable, projection, sourceRecord, authorizeMonths, type Row, type Code, type Session } from "./monthlyBoardReadCore";

export interface ProductBoardReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
async function selectAllHistory(session: Session, input: ProductBoardReadInput) {
  const winners = new Map<string, ProductBoardMonthSelection>();
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
  return { selections: [...winners.values()].sort((a, b) => a.month.localeCompare(b.month)), history: { complete: true, scannedCount: scannedBatchIds.length, visibility: session.manager ? "full" as const : "scoped" as const } };
}
function sanitized(error: unknown): never {
  if (error instanceof MonthlyBoardReadGuardError) fail(`PRODUCT_BOARD_READ_${error.message}`, error.code as Code);
  if (error instanceof TRPCError && /^PRODUCT_BOARD_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("PRODUCT_BOARD_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("PRODUCT_BOARD_READ_FAILED", "INTERNAL_SERVER_ERROR");
}
/** A fresh, bounded, source-only projection. No edition refresh/initialization,
 * notes, schedules, uploader shortcut, name-based member list or model call. */
export function createProductBoardReadRepository(dependencies: { database?: () => Promise<ProductBoardReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function get(ctx: TrpcContext, raw: ProductBoardReadInput) {
    try {
      if (!ctx.user) fail("PRODUCT_BOARD_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = ProductBoardReadInputSchema.safeParse(raw);
      if (!parsed.success) fail("PRODUCT_BOARD_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("PRODUCT_BOARD_READ_ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("PRODUCT_BOARD_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database(); if (!db || typeof db.transaction !== "function") fail("PRODUCT_BOARD_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("PRODUCT_BOARD_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        const session: Session = { tx, identity: { userId: actor.id as number, workspaceId }, manager: ["super_admin", "admin", "ops_manager"].includes(actor.role as string) };
        try {
          const { selections, history } = await selectAllHistory(session, input);
          await authorizeMonths(session, input, selections);
          const ownership = await resolveOperationsBoardOwnership(session, input, selections).catch(error => {
            // This directory narrows already authorized rows; it never grants
            // access. A missing registry must not disable a manager's existing
            // unfiltered read, but a selected operator can never fall back to all.
            if (session.manager && input.operatorId === undefined && error instanceof MonthlyBoardReadGuardError && error.message === "OWNER_REGISTRY_UNAVAILABLE") {
              return unavailableOperationsBoardOwnership(session, input, selections);
            }
            throw error;
          });
          return buildProductBoardReadResult({ identity: session.identity, input, selections, history, ownership });
        } catch (error) {
          if (error instanceof SourceTableMissing) return buildProductBoardReadFailure({ identity: session.identity, input, status: "missing", reasonCode: "table_missing", missingReason: "月度财务来源表尚未接通，不代表利润为零" });
          if (error instanceof IncompleteScan) return buildProductBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "scan_incomplete", missingReason: "有界扫描未能完整确定全部历史来源；不以近三个月冒充总计、不返回部分看板" });
          if (error instanceof InvalidSource || error instanceof MonthlyFinancialReadError || error instanceof ProductBoardReadError || error instanceof OperationsBoardOwnershipError) return buildProductBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "invalid_source", missingReason: "候选财务批次、负责人筛选或看板完整性无法核验；不截断、补零或回退旧来源" });
          throw error;
        }
      });
    } catch (error) { return sanitized(error); }
  }
  return { get };
}
export const productBoardReadRepository = createProductBoardReadRepository();
