import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
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
  const admit = vi.fn(async () => {}), inspect = vi.fn(async (): Promise<"absent" | "ready"> => "ready");
  const sync = createMonthlyOperationsBoardSynchronization({ enabled: () => enabled, admit, inspect, store });
  return { load, refreshExisting, store, admit, inspect, sync };
}
describe("monthly transition's atomic board participant", () => {
  it("passes the exact caller transaction/identity/role and a complete post-state capture", async () => {
    const f = setup(), input = request(); await f.sync(input);
    expect(f.admit).toHaveBeenCalledWith(input.tx); expect(f.store).toHaveBeenCalledWith({ tx: input.tx, identity, role: "ops_manager" });
    expect(f.refreshExisting).toHaveBeenCalledTimes(1);
    const [selected, capture] = (f.refreshExisting.mock.calls as unknown as [typeof scope, ReturnType<ReturnType<typeof prepareOperationsBoardHistoryCapture>["capture"]>][])[0];
    expect(selected).toEqual(scope); expect(capture.month).toBe("2026-10"); expect(capture.rows.map(row => row.yearMonth)).toEqual(["2026-09", "2026-10"]);
  });
  it("permits independent monthly writes only after proven complete schema absence when disabled", async () => {
    const f = setup(false), input = request(); f.inspect.mockResolvedValue("absent"); await f.sync(input);
    expect(f.inspect).toHaveBeenCalledWith(input.tx); expect(f.admit).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("never initializes an absent scope as a side effect of confirming a month", async () => {
    const f = setup(true, false); await f.sync(request()); expect(f.load).toHaveBeenCalledTimes(1); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it("revoke of the final current source preserves current month even with older history", async () => {
    const f = setup(); await f.sync(request({ action: "revoke", beforeBatch: batch(1, "2026-09"), afterBatch: { ...batch(1, "2026-09"), status: "deleted" }, completedAfter: [batch(3, "2026-08")] }));
    const capture = (f.refreshExisting.mock.calls as unknown as [unknown, { month: string; sources: { month: string }[] }][])[0][1];
    expect(capture.month).toBe("2026-09"); expect(capture.sources.map(row => row.month)).toEqual(["2026-08"]);
  });
  it.each([true, false])("preview revocation never touches archives with flag %s", async enabled => {
    const f = setup(enabled); await f.sync(request({ action: "revoke", afterBatch: { ...batch(2), status: "deleted" } }));
    expect(f.admit).not.toHaveBeenCalled(); expect(f.inspect).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
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

describe("disabled synchronization cannot stale initialized scopes", () => {
  it("allows exact ready schema with only uninitialized affected scopes without any writes", async () => {
    const f = setup(false, false), input = request(); await f.sync(input);
    expect(f.inspect).toHaveBeenCalledWith(input.tx); expect(f.admit).not.toHaveBeenCalled();
    expect(f.store).toHaveBeenCalledWith({ tx: input.tx, identity, role: "ops_manager" });
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledWith(scope); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it.each(["confirm", "revoke"] as const)("rejects %s for an initialized scope before a caller can finalize", async action => {
    const f = setup(false), finalize = vi.fn();
    const input = action === "confirm" ? request() : request({ action, beforeBatch: batch(2), afterBatch: { ...batch(2), status: "deleted" }, completedAfter: [batch(1, "2026-09")] });
    const invoke = async () => { await f.sync(input); finalize(); };
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE", cause: undefined });
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledWith(scope); expect(f.refreshExisting).not.toHaveBeenCalled(); expect(finalize).not.toHaveBeenCalled();
  });
  it("checks the union of before/after stored scopes in canonical lock order, not just the first scope", async () => {
    const f = setup(false, false), input = request(), secondScope = { ...scope, storeName: "SYNTHETIC Other Shop" };
    input.afterBatch = batch(2, "2026-10", secondScope.storeName);
    const sorted = [scope, secondScope].sort((a, b) => operationsBoardEditionScopeKey(a).localeCompare(operationsBoardEditionScopeKey(b)));
    const initialized = await setup().load(scope);
    f.load.mockImplementation(async selected => operationsBoardEditionScopeKey(selected) === operationsBoardEditionScopeKey(sorted[1]) ? initialized : null);
    await expect(f.sync(input)).rejects.toThrow("OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE");
    expect(f.load.mock.calls.map(([selected]) => selected)).toEqual(sorted); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it("does not block an unrelated shop merely because another shop has initialized an archive", async () => {
    const f = setup(false), other = batch(2, "2026-10", "SYNTHETIC Other Shop");
    await f.sync(request({ beforeBatch: { ...other, status: "previewing" }, afterBatch: other }));
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledWith({ ...scope, storeName: "SYNTHETIC Other Shop" }); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it("current_empty still counts as initialized and cannot silently become stale", async () => {
    const f = setup(false), initialized = (await f.load(scope))!; f.load.mockClear();
    f.load.mockResolvedValue({ ...initialized, state: { ...initialized.state, status: "current_empty" } });
    await expect(f.sync(request())).rejects.toThrow("OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE"); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it.each(["foreign actor", "foreign workspace", "bad role", "wrong target", "wrong status"])("does not skip caller/transition validation even with absent tables: %s", async reason => {
    const f = setup(false), input = request(); f.inspect.mockResolvedValue("absent");
    if (reason === "foreign actor") input.actor.id = 9;
    if (reason === "foreign workspace") input.identity = { ...identity, workspaceId: 8 };
    if (reason === "bad role") input.actor.role = "operator";
    if (reason === "wrong target") input.afterBatch.id = 4;
    if (reason === "wrong status") input.afterBatch.status = "previewing";
    await expect(f.sync(input)).rejects.toThrow(/^OPERATIONS_BOARD_SYNC_(?:CALLER|TRANSITION)_INVALID$/u);
    expect(f.inspect).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it.each(["MIGRATION_REQUIRED", "INCOMPATIBLE", "READ_UNAVAILABLE", "METADATA_INVALID"])("preserves sanitized schema rejection %s before scope reads", async reason => {
    const f = setup(false); f.inspect.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: `OPERATIONS_BOARD_SCHEMA_${reason}` }));
    await expect(f.sync(request())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: `OPERATIONS_BOARD_SCHEMA_${reason}` });
    expect(f.store).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "unknown", {}])("does not treat unknown inspection output %j as absence", async result => {
    const f = setup(false); f.inspect.mockResolvedValue(result as "absent");
    await expect(f.sync(request())).rejects.toThrow("OPERATIONS_BOARD_SYNC_SCHEMA_UNVERIFIED"); expect(f.store).not.toHaveBeenCalled();
  });
  it.each(["inspect", "load", "invalid stored source"])("sanitizes %s failure and performs no refresh", async stage => {
    const f = setup(false), input = request();
    if (stage === "inspect") f.inspect.mockRejectedValue(new Error("private schema credentials"));
    if (stage === "load") f.load.mockRejectedValue(new Error("private stored capture"));
    if (stage === "invalid stored source") input.afterBatch.payload = "not JSON: private content";
    const error = await f.sync(input).catch(caught => caught);
    expect(error).toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SYNC_RECONCILIATION_FAILED", cause: undefined });
    expect(JSON.stringify(error)).not.toMatch(/private|credentials/u); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
});
