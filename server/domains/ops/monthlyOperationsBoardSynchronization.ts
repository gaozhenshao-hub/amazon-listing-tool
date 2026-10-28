import { TRPCError } from "@trpc/server";
import type { DbExecutor } from "../../repositories/dbClient";
import { parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { OperationsBoardEditionScopeSchema, operationsBoardEditionScopeKey } from "../../../shared/operationsBoardEdition";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { createOperationsBoardEditionStore } from "./operationsBoardEditionStore";
import { assertOperationsBoardSchema, inspectOperationsBoardSchema } from "./operationsBoardSchemaAdmission";
import { positiveId } from "./monthlyBoardReadCore";

export type MonthlyOperationsBoardTransition = {
  tx: DbExecutor;
  identity: { userId: number; workspaceId: number };
  actor: { id: number; role: string; defaultWorkspaceId: number };
  action: "confirm" | "revoke";
  beforeBatch: MonthlyFinancialBatchRecord;
  afterBatch: MonthlyFinancialBatchRecord;
  /** Complete post-state candidates, descending IDs, under the caller's locks. */
  completedAfter: MonthlyFinancialBatchRecord[];
};
function fail(reason: string): never { throw new TRPCError({ code: "PRECONDITION_FAILED", message: `OPERATIONS_BOARD_SYNC_${reason}` }); }

/** Internal participant of monthly confirm/revoke, never an after-commit task.
 * Caller holds the workspace write lock, fresh actor/membership/policy grants
 * and the batch status update in ONE transaction. An exception must escape to
 * roll back both monthly facts and editions before the operation receipt. */
export function createMonthlyOperationsBoardSynchronization(dependencies: {
  enabled?: () => boolean;
  admit?: typeof assertOperationsBoardSchema;
  inspect?: typeof inspectOperationsBoardSchema;
  store?: typeof createOperationsBoardEditionStore;
} = {}) {
  const enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_BOARD_EDITIONS === "true");
  const admit = dependencies.admit ?? assertOperationsBoardSchema, store = dependencies.store ?? createOperationsBoardEditionStore;
  const inspect = dependencies.inspect ?? inspectOperationsBoardSchema;
  return async (transition: MonthlyOperationsBoardTransition): Promise<void> => {
    const { tx, identity, actor, action, beforeBatch, afterBatch, completedAfter } = transition;
    if (!positiveId(identity.userId) || !positiveId(identity.workspaceId) || actor.id !== identity.userId || actor.defaultWorkspaceId !== identity.workspaceId
      || !["admin", "super_admin", "ops_manager"].includes(actor.role)) fail("CALLER_INVALID");
    if (!positiveId(beforeBatch.id) || beforeBatch.id !== afterBatch.id || beforeBatch.workspaceId !== identity.workspaceId || afterBatch.workspaceId !== identity.workspaceId
      || (action === "confirm" ? beforeBatch.status !== "previewing" || afterBatch.status !== "completed" : action !== "revoke" || !["previewing", "completed"].includes(beforeBatch.status) || afterBatch.status !== "deleted")) fail("TRANSITION_INVALID");
    // Deleting a preview changes no current financial fact or archive.
    if (action === "revoke" && beforeBatch.status === "previewing") return;
    try {
      if (process.env.ENABLE_NORTH_AMERICA_BOARD === "true") {
        const { captureNorthAmericaBoard } = await import("./northAmericaBoardArchive");
        await captureNorthAmericaBoard({ tx, identity, manager: true });
      }
      const syncEnabled = enabled();
      if (syncEnabled) await admit(tx);
      else {
        const structure = await inspect(tx);
        if (structure === "absent") return;
        if (structure !== "ready") fail("SCHEMA_UNVERIFIED");
      }
      const post = syncEnabled ? prepareOperationsBoardHistoryCapture(completedAfter, identity.workspaceId) : null;
      if (syncEnabled && (action === "confirm" ? !completedAfter.some(batch => batch.id === afterBatch.id) : completedAfter.some(batch => batch.id === afterBatch.id))) fail("POST_STATE_INVALID");
      // Derive affected identities only from the original stored batches, not
      // client scope, uploader names, owner filters or a page of preview rows.
      const scopes = new Map<string, ReturnType<typeof OperationsBoardEditionScopeSchema.parse>>();
      for (const batch of [beforeBatch, afterBatch]) for (const row of parseMonthlyFinancialBatch(batch).rows) {
        const scope = OperationsBoardEditionScopeSchema.parse({ workspaceId: identity.workspaceId, storeName: row.storeName, country: row.country });
        scopes.set(operationsBoardEditionScopeKey(scope), scope);
      }
      const editions = store({ tx, identity, role: actor.role });
      for (const scope of [...scopes.values()].sort((a, b) => operationsBoardEditionScopeKey(a).localeCompare(operationsBoardEditionScopeKey(b)))) {
        const existing = await editions.load(scope);
        // First opt-in is the separate explicit administrator action. A monthly
        // import must not manufacture historical editions for an absent scope.
        if (!existing) continue;
        // The caller holds the workspace write lock; load also locks this
        // exact scope in the same transaction. Turning off the UI/worker flag
        // must not silently leave an already-initialized archive stale.
        if (!syncEnabled || !post) fail("DISABLED_FOR_INITIALIZED_SCOPE");
        const latest = post.latestMonth({ storeName: scope.storeName, country: scope.country });
        const month = latest && latest > existing.state.currentMonth! ? latest : existing.state.currentMonth!;
        await editions.refreshExisting(scope, post.capture({ storeName: scope.storeName, country: scope.country, month }));
      }
    } catch (error) {
      if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED" && /^OPERATIONS_BOARD_(?:SYNC|SCHEMA)_/u.test(error.message)) throw error;
      // Do not leak stored financial rows, SQL or adapter errors in an RPC.
      // The caller still receives an error and its transaction must roll back.
      fail("RECONCILIATION_FAILED");
    }
  };
}
export const synchronizeOperationsBoardsAfterMonthlyTransition = createMonthlyOperationsBoardSynchronization();
