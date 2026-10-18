import { describe, expect, it, vi } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { operationsBoardEditionScopeKey } from "../../../shared/operationsBoardEdition";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { createMonthlyOperationsBoardSynchronization, type MonthlyOperationsBoardTransition } from "./monthlyOperationsBoardSynchronization";
import { planOperationsBoardInitialization } from "./operationsBoardLifecycle";
import type { createOperationsBoardEditionStore } from "./operationsBoardEditionStore";

const identity = { workspaceId: 7, userId: 3 }, scope = { workspaceId: 7, storeName: "SYNTHETIC Exact Shop", country: "US" };
const now = "2026-10-18 12:00:00.000000";
function batch(id: number, month = "2026-10", storeName = scope.storeName): MonthlyFinancialBatchRecord {
  const rows = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), yearMonth: month, parentAsin: "SYN-P1", asin: "SYN-C1", sku: "SKU", title: "SYNTHETIC product", storeName, site: "US", operator: null, raw: { currency: "USD", original: "完整原文" } }];
  return { id, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.csv", fileHash: "a".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0,
    months: JSON.stringify([month]), payload: JSON.stringify(rows), createdAt: now, confirmedAt: now, fileReferenceKind: "storage", sourceRunId: null };
}
const request = (patch: Partial<MonthlyOperationsBoardTransition> = {}): MonthlyOperationsBoardTransition => ({ tx: { execute: vi.fn() }, identity,
  actor: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, action: "confirm", beforeBatch: { ...batch(2), status: "previewing", confirmedAt: null }, afterBatch: batch(2), completedAfter: [batch(2), batch(1, "2026-09")], ...patch });
function setup(enabled = true, initialized = true) {
  const initial = planOperationsBoardInitialization({ role: "admin", state: { scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" }, currentEdition: null,
    capture: prepareOperationsBoardHistoryCapture([batch(1, "2026-09")], 7).capture({ ...scope, month: "2026-09" }), now, nextEditionId: 9 });
  const load = vi.fn(async (selected: typeof scope) => initialized && operationsBoardEditionScopeKey(selected) === operationsBoardEditionScopeKey(scope) ? { stateId: 1, state: initial.state, currentEdition: initial.currentEdition! } : null);
  const refreshExisting = vi.fn(async () => null);
  const store = vi.fn(() => ({ load, refreshExisting })) as unknown as typeof createOperationsBoardEditionStore;
  const admit = vi.fn(async () => {}), sync = createMonthlyOperationsBoardSynchronization({ enabled: () => enabled, admit, store });
  return { load, refreshExisting, store, admit, sync };
}
describe("monthly transition's atomic board participant", () => {
  it("passes the exact caller transaction/identity/role and a complete post-state capture", async () => {
    const f = setup(), input = request(); await f.sync(input);
    expect(f.admit).toHaveBeenCalledWith(input.tx); expect(f.store).toHaveBeenCalledWith({ tx: input.tx, identity, role: "ops_manager" });
    expect(f.refreshExisting).toHaveBeenCalledTimes(1);
    const [selected, capture] = (f.refreshExisting.mock.calls as unknown as [typeof scope, ReturnType<ReturnType<typeof prepareOperationsBoardHistoryCapture>["capture"]>][])[0];
    expect(selected).toEqual(scope); expect(capture.month).toBe("2026-10"); expect(capture.rows.map(row => row.yearMonth)).toEqual(["2026-09", "2026-10"]);
  });
  it("does nothing when disabled, including no schema or source reads", async () => {
    const f = setup(false); await f.sync(request({ completedAfter: [batch(1), batch(2)] }));
    expect(f.admit).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("never initializes an absent scope as a side effect of confirming a month", async () => {
    const f = setup(true, false); await f.sync(request()); expect(f.load).toHaveBeenCalledTimes(1); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it("revoke of the final current source preserves current month even with older history", async () => {
    const f = setup(); await f.sync(request({ action: "revoke", beforeBatch: batch(1, "2026-09"), afterBatch: { ...batch(1, "2026-09"), status: "deleted" }, completedAfter: [batch(3, "2026-08")] }));
    const capture = (f.refreshExisting.mock.calls as unknown as [unknown, { month: string; sources: { month: string }[] }][])[0][1];
    expect(capture.month).toBe("2026-09"); expect(capture.sources.map(row => row.month)).toEqual(["2026-08"]);
  });
  it("preview revocation has no financial fact change and does not touch archives", async () => {
    const f = setup(); await f.sync(request({ action: "revoke", afterBatch: { ...batch(2), status: "deleted" } }));
    expect(f.admit).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("does not mistake a later unrelated shop month for this scope's target", async () => {
    const f = setup(); await f.sync(request({ completedAfter: [batch(3, "2027-01", "Other"), batch(2), batch(1, "2026-09")] }));
    const capture = (f.refreshExisting.mock.calls as unknown as [unknown, { month: string; scannedBatches: unknown[] }][])[0][1];
    expect(capture.month).toBe("2026-10"); expect(capture.scannedBatches).toHaveLength(3);
  });
  it.each(["foreign actor", "foreign workspace", "bad role", "wrong target", "missing confirmed", "revoked still present", "unordered", "schema", "store"])("propagates rejection before a parent receipt: %s", async reason => {
    const f = setup(), input = request();
    if (reason === "foreign actor") input.actor.id = 4;
    if (reason === "foreign workspace") input.identity = { ...identity, workspaceId: 8 };
    if (reason === "bad role") input.actor.role = "operator";
    if (reason === "wrong target") input.afterBatch.id = 3;
    if (reason === "missing confirmed") input.completedAfter = [batch(1, "2026-09")];
    if (reason === "revoked still present") { input.action = "revoke"; input.beforeBatch = batch(2); input.afterBatch.status = "deleted"; }
    if (reason === "unordered") input.completedAfter.reverse();
    if (reason === "schema") f.admit.mockRejectedValue(new Error("private schema details"));
    if (reason === "store") f.refreshExisting.mockRejectedValue(new Error("private source content"));
    await expect(f.sync(input)).rejects.toThrow(/^OPERATIONS_BOARD_SYNC_/u);
  });
});
