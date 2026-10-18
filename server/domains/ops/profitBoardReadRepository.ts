import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { MonthlyFinancialReadError } from "../../../shared/monthlyFinancialRead";
import { ProfitBoardReadInputSchema, ProfitBoardReadError, profitBoardMonths, buildProfitBoardReadResult, buildProfitBoardReadFailure, type ProfitBoardReadInput } from "../../../shared/profitBoardRead";
import { MonthlyBoardReadGuardError, SourceTableMissing, InvalidSource, IncompleteScan, positiveId, query, authorizeMonths, type Code, type Session } from "./monthlyBoardReadCore";
import { selectMonthlyBoardSnapshots } from "./monthlyBoardSnapshotSelection";

export interface ProfitBoardReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
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
          const { selections } = await selectMonthlyBoardSnapshots(session, { months: profitBoardMonths(input.month), storeName: input.storeName, country: input.country });
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
