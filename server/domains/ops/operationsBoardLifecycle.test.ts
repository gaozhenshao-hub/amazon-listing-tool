import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import {
  buildOperationsBoardEditionCapture, operationsBoardEditionCanonical, OperationsBoardEditionSchema, assertOperationsBoardEditionState,
  type OperationsBoardEdition, type OperationsBoardEditionCapture, type OperationsBoardEditionState,
} from "../../../shared/operationsBoardEdition";
import { planOperationsBoardInitialization as initialize, planOperationsBoardRefresh as refresh, planOperationsBoardRevision as revise } from "./operationsBoardLifecycle";

const scope = { workspaceId: 7, storeName: "SYNTHETIC exact store", country: "US" };
const stamp = "2026-10-18 08:09:10.123456", later = "2026-10-19 10:11:12.654321";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function capture(month = "2026-09", sourceMonths = [month], amount = 12): OperationsBoardEditionCapture {
  const rows = sourceMonths.flatMap((period, index) => {
    const payload = [{ yearMonth: period, parentAsin: "SYNTHETIC-P", asin: "SYNTHETIC-C", sku: "SYNTHETIC-SKU", title: "原始标题不得丢失",
      storeName: scope.storeName, site: "美国站", operator: "SYNTHETIC display not authorization", raw: { currency: "USD", "原始完整字段": "原文\n换行" },
      ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, key === "financialProfit" ? amount : null])) }];
    const record: MonthlyFinancialBatchRecord = { id: 41 + index, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.xlsx", fileHash: "a".repeat(64), status: "completed",
      totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [period], payload, createdAt: stamp, confirmedAt: stamp };
    return parseMonthlyFinancialBatch(record).rows;
  });
  return buildOperationsBoardEditionCapture({ scope, month, rows, scannedBatches: sourceMonths.map((_month, index) => ({ id: 41 + index, recordHash: "b".repeat(64) })).reverse(),
    sources: sourceMonths.map((month, index) => ({ month, batchId: 41 + index, recordHash: "b".repeat(64), rowCount: 1, origin: { kind: "unknown", hashBasis: "unknown", sourceRunId: null } })) });
}
function edition(snapshot = capture(), patch: Partial<OperationsBoardEdition> = {}): OperationsBoardEdition {
  return { id: 9, scope, month: snapshot.month, revision: 1, version: 4, kind: "original", status: "current", originalEditionId: null,
    sourceHash: snapshot.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: null, capture: snapshot, ...patch };
}
function state(current = edition()): OperationsBoardEditionState {
  return { scope, version: 3, currentMonth: current.month, currentEditionId: current.id,
    status: current.capture.sources.some(source => source.month === current.month) ? "current" : "current_empty" };
}
function initial() { return { role: "admin", state: { scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" as const }, currentEdition: null, capture: capture(), now: stamp, nextEditionId: 11 }; }
function current() { return { state: state(), currentEdition: edition(), capture: capture(), now: later }; }
function revision() {
  const active = edition(capture("2026-10"), { id: 11 });
  return { role: "admin", state: state(active), currentEdition: active, originalEdition: edition(capture(), { status: "archived" as const, archivedAt: stamp }), capture: capture(),
    latestRevision: 1, now: later, nextEditionId: 12 };
}
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

describe("explicit latest-month initialization", () => {
  it("creates exactly one current edition and no older editions or copied notes", () => {
    const input = initial(); input.capture = capture("2026-09", ["2026-01", "2026-05", "2026-09"]);
    const plan = initialize(input);
    expect(plan.kind).toBe("initialize"); expect(plan.updateEditions).toEqual([]); expect(plan.insertEdition?.id).toBe(11);
    expect(plan.state).toMatchObject({ version: 1, currentMonth: "2026-09", currentEditionId: 11, status: "current" });
    expect(plan.currentEdition?.capture.rows).toHaveLength(3);
    expect(plan.notes).toEqual({ preserveEditionIds: [], readonlyEditionIds: [], emptyEditionIds: [11] });
    expect(() => assertOperationsBoardEditionState(plan.state, plan.currentEdition)).not.toThrow();
  });
  it.each(["admin", "super_admin"])("accepts freshly authorized %s", role => { expect(initialize({ ...initial(), role }).kind).toBe("initialize"); });
  it.each(["ops_manager", "member", "Admin", "", "ops_specialist"])("refuses nonadministrator %s", role => { expect(() => initialize({ ...initial(), role })).toThrow("ADMIN_REQUIRED"); });
  it("does not initialize on the automatic source-update path", () => {
    const plan = refresh(initial()); expect(plan).toMatchObject({ kind: "noop", state: initial().state, currentEdition: null, insertEdition: null, updateEditions: [] });
    expect(plan.notes).toEqual({ preserveEditionIds: [], readonlyEditionIds: [], emptyEditionIds: [] });
  });
  it("refuses empty and artificially later initialization months", () => {
    expect(() => initialize({ ...initial(), capture: capture("2026-10", []) })).toThrow("LATEST_SOURCE_REQUIRED");
    expect(() => initialize({ ...initial(), capture: capture("2026-10", ["2026-09"]) })).toThrow("LATEST_SOURCE_REQUIRED");
  });
  it("cannot reinitialize an existing current or current_empty pointer", () => {
    expect(() => initialize({ ...current(), role: "admin", nextEditionId: 11 })).toThrow("ALREADY_INITIALIZED");
    const empty = edition(capture("2026-09", []));
    expect(() => initialize({ ...initial(), state: state(empty), currentEdition: empty })).toThrow("ALREADY_INITIALIZED");
  });
});

describe("current source replacement, late reporting and revocation", () => {
  it("does no write or version/timestamp bump for identical complete content", () => {
    const input = current(), plan = refresh(input);
    expect(plan).toEqual({ kind: "noop", state: input.state, currentEdition: input.currentEdition, updateEditions: [], insertEdition: null,
      notes: { preserveEditionIds: [9], readonlyEditionIds: [], emptyEditionIds: [] } });
  });
  it("replaces same-month source in place and retains notes without reinitializing them", () => {
    const source = capture("2026-09", ["2026-09"], -8), plan = refresh({ ...current(), capture: source });
    expect(plan.kind).toBe("refresh"); expect(plan.state).toEqual({ ...state(), version: 4 });
    expect(plan.currentEdition).toMatchObject({ id: 9, version: 5, sourceHash: source.sourceHash, createdAt: stamp, updatedAt: later, archivedAt: null });
    expect(plan.updateEditions).toEqual([plan.currentEdition]); expect(plan.insertEdition).toBeNull();
    expect(plan.notes).toEqual({ preserveEditionIds: [9], readonlyEditionIds: [], emptyEditionIds: [] });
  });
  it("refreshes complete historical source rows without touching any archived edition", () => {
    const plan = refresh({ ...current(), capture: capture("2026-09", ["2025-12", "2026-01", "2026-09"]) });
    expect(plan.kind).toBe("refresh"); expect(plan.updateEditions.map(item => item.id)).toEqual([9]);
    expect(plan.currentEdition?.capture.coverage.months).toEqual(["2025-12", "2026-01", "2026-09"]); expect(plan.insertEdition).toBeNull();
  });
  it.each([{ remaining: ["2026-08"] }, { remaining: [] }])("keeps current pointer empty after current-month revocation, older sources %j", ({ remaining }) => {
    const plan = refresh({ ...current(), capture: capture("2026-09", remaining) });
    expect(plan.state).toMatchObject({ currentMonth: "2026-09", currentEditionId: 9, status: "current_empty", version: 4 });
    expect(plan.currentEdition?.capture.sources.map(source => source.month)).toEqual(remaining);
    expect(plan.currentEdition?.month).toBe("2026-09"); expect(plan.insertEdition).toBeNull();
    expect(plan.notes.preserveEditionIds).toEqual([9]); expect(() => assertOperationsBoardEditionState(plan.state, plan.currentEdition)).not.toThrow();
  });
  it("reconfirmed current-month source restores the same pointer and retained notes", () => {
    const empty = edition(capture("2026-09", ["2026-08"]));
    const plan = refresh({ ...current(), state: state(empty), currentEdition: empty });
    expect(plan.state).toMatchObject({ currentMonth: "2026-09", currentEditionId: 9, status: "current" }); expect(plan.notes.emptyEditionIds).toEqual([]);
  });
  it("uses complete capture content rather than matching row counts or summary metrics", () => {
    const changed = capture(); changed.scannedBatches.push({ id: 40, recordHash: "c".repeat(64) });
    const source = buildOperationsBoardEditionCapture(changed);
    expect(source.rows).toEqual(capture().rows); expect(refresh({ ...current(), capture: source }).kind).toBe("refresh");
  });
});

describe("later confirmed months freeze the prior original exactly once", () => {
  it("jumps directly to the next available month without inventing missing months", () => {
    const plan = refresh({ ...current(), capture: capture("2026-12", ["2026-08", "2026-09", "2026-12"], 99), nextEditionId: 11 });
    expect(plan.kind).toBe("advance"); expect(plan.state).toMatchObject({ currentMonth: "2026-12", currentEditionId: 11, version: 4 });
    expect(plan.updateEditions).toHaveLength(1); expect(plan.insertEdition?.month).toBe("2026-12");
    const frozen = plan.updateEditions[0];
    expect(frozen).toMatchObject({ id: 9, version: 5, status: "archived", archivedAt: later, updatedAt: later, createdAt: stamp });
    expect(operationsBoardEditionCanonical(frozen.capture)).toBe(operationsBoardEditionCanonical(edition().capture));
    expect(frozen.sourceHash).toBe(edition().sourceHash); expect(frozen.capture.rows[0].metrics.financialProfit).toBe(12);
    expect(plan.notes).toEqual({ preserveEditionIds: [9], readonlyEditionIds: [9], emptyEditionIds: [11] });
    expect(() => assertOperationsBoardEditionState(plan.state, plan.currentEdition)).not.toThrow();
  });
  it("archives current_empty as-is when a later source arrives", () => {
    const empty = edition(capture("2026-09", [])), plan = refresh({ ...current(), state: state(empty), currentEdition: empty, capture: capture("2026-11"), nextEditionId: 11 });
    expect(plan.kind).toBe("advance"); expect(plan.updateEditions[0].capture.rows).toEqual([]); expect(plan.updateEditions[0].sourceHash).toBe(empty.sourceHash);
  });
  it("is idempotent after applying an advance, with no second archived original", () => {
    const first = refresh({ ...current(), capture: capture("2026-12"), nextEditionId: 11 });
    const second = refresh({ state: first.state, currentEdition: first.currentEdition, capture: first.currentEdition!.capture, now: later });
    expect(second.kind).toBe("noop"); expect(second.updateEditions).toEqual([]); expect(second.insertEdition).toBeNull();
  });
  it.each([undefined, 0, -1, 9, 2.5, 2147483648, NaN])("requires an explicitly allocated valid new ID (%s)", nextEditionId => {
    expect(() => refresh({ ...current(), capture: capture("2026-10"), nextEditionId })).toThrow("INVALID_NEW_EDITION_ID");
  });
  it.each([capture("2026-08"), capture("2026-10", ["2026-09"]), capture("2026-11", ["2026-10"])])("rejects backward or artificially ahead capture targets %#", value => {
    expect(() => refresh({ ...current(), capture: value, nextEditionId: 11 })).toThrow("CAPTURE_TARGET_MISMATCH");
  });
});

describe("administrator revisions append without rewriting frozen originals", () => {
  it("links an independently captured revision to the original and leaves current untouched", () => {
    const input = revision(); input.capture = capture("2026-09", ["2026-08", "2026-09"], 999);
    const originalBytes = operationsBoardEditionCanonical(input.originalEdition), currentBytes = operationsBoardEditionCanonical(input.currentEdition);
    const plan = revise(freeze(input));
    expect(plan.kind).toBe("publishRevision"); expect(plan.updateEditions).toEqual([]);
    expect(plan.insertEdition).toMatchObject({ id: 12, originalEditionId: 9, revision: 2, version: 1, month: "2026-09", status: "archived", kind: "revision", archivedAt: later });
    expect(plan.state).toEqual({ ...input.state, version: input.state.version + 1 });
    expect(operationsBoardEditionCanonical(plan.currentEdition)).toBe(currentBytes); expect(operationsBoardEditionCanonical(input.originalEdition)).toBe(originalBytes);
    expect(plan.notes).toEqual({ preserveEditionIds: [9, 11], readonlyEditionIds: [9, 12], emptyEditionIds: [12] });
  });
  it("uses the maximum saved revision rather than resetting or editing one", () => { expect(revise({ ...revision(), latestRevision: 7 }).insertEdition?.revision).toBe(8); });
  it("can publish an explicitly empty revision after all original-month sources are revoked", () => {
    const plan = revise({ ...revision(), capture: capture("2026-09", []) }); expect(plan.insertEdition?.capture.rows).toEqual([]);
    expect(plan.insertEdition?.status).toBe("archived"); expect(plan.currentEdition?.id).toBe(11);
  });
  it("requires fresh administrator role even when current reads are allowed", () => { expect(() => revise({ ...revision(), role: "ops_manager" })).toThrow("ADMIN_REQUIRED"); });
  it("rejects current, revision, or future-month targets as an archived original", () => {
    expect(() => revise({ ...revision(), originalEdition: edition() })).toThrow("ARCHIVED_ORIGINAL_REQUIRED");
    const priorRevision = { ...revision().originalEdition, id: 10, kind: "revision" as const, revision: 2, originalEditionId: 9 };
    expect(() => revise({ ...revision(), originalEdition: priorRevision })).toThrow("ARCHIVED_ORIGINAL_REQUIRED");
    const future = edition(capture("2026-11"), { status: "archived", archivedAt: stamp });
    expect(() => revise({ ...revision(), originalEdition: future, capture: future.capture })).toThrow("INVALID_ARCHIVED_MONTH");
  });
  it("rejects contradictory records that reuse the current ID as an archived original", () => {
    expect(() => revise({ ...revision(), originalEdition: { ...revision().originalEdition, id: 11 } })).toThrow("ARCHIVED_ORIGINAL_REQUIRED");
  });
  it("does not change the target month or exact original scope", () => {
    expect(() => revise({ ...revision(), capture: capture("2026-08") })).toThrow("REVISION_SCOPE_MISMATCH");
    const otherScope = { ...scope, country: "CA" }, otherCapture = buildOperationsBoardEditionCapture({ ...capture("2026-09", []), scope: otherScope });
    const otherOriginal = edition(otherCapture, { scope: otherScope, status: "archived", archivedAt: stamp });
    expect(() => revise({ ...revision(), originalEdition: otherOriginal })).toThrow("REVISION_SCOPE_MISMATCH");
  });
  it.each([0, -1, 1.5, NaN, 2147483647])("rejects invalid/overflow latestRevision %s", latestRevision => { expect(() => revise({ ...revision(), latestRevision })).toThrow(); });
  it.each([9, 11])("does not reuse original/current ID %s", nextEditionId => { expect(() => revise({ ...revision(), nextEditionId })).toThrow("INVALID_NEW_EDITION_ID"); });
});

describe("failure atomicity preconditions and immutable inputs", () => {
  it.each(["2026-02-30 00:00:00.000000", "2026-10-18 25:00:00.000000", "2026-10-18T09:00:00Z", "2026-10-18 09:00:00.000", "bad"])("rejects invalid database timestamp %s", now => {
    expect(() => refresh({ ...current(), now })).toThrow("INVALID_TIME");
  });
  it("rejects time travel even for a no-op or the immutable original", () => {
    expect(() => refresh({ ...current(), now: "2026-10-18 08:09:10.123455" })).toThrow("TIME_REVERSED");
    const originalEdition = { ...revision().originalEdition, archivedAt: "2026-10-20 08:09:10.000000" };
    expect(() => revise({ ...revision(), originalEdition })).toThrow("TIME_REVERSED");
  });
  it("rejects scope and state/capture inconsistencies rather than repairing them silently", () => {
    expect(() => refresh({ ...current(), state: { ...state(), currentEditionId: 99 } })).toThrow("STATE_CAPTURE_MISMATCH");
    const alien = buildOperationsBoardEditionCapture({ ...capture("2026-09", []), scope: { ...scope, storeName: "Other" } });
    expect(() => refresh({ ...current(), capture: alien })).toThrow("SCOPE_MISMATCH");
    expect(() => refresh({ ...current(), currentEdition: null })).toThrow("STATE_CAPTURE_MISMATCH");
  });
  it("rejects state or edition version overflow before returning a write plan", () => {
    const changed = capture("2026-09", ["2026-09"], 55);
    expect(() => refresh({ ...current(), state: { ...state(), version: 2147483647 }, capture: changed })).toThrow("VERSION_OVERFLOW");
    expect(() => refresh({ ...current(), currentEdition: { ...edition(), version: 2147483647 }, capture: changed })).toThrow("VERSION_OVERFLOW");
    expect(() => revise({ ...revision(), state: { ...revision().state, version: 2147483647 } })).toThrow("VERSION_OVERFLOW");
  });
  it("keeps a max-version unchanged read/source refresh a true no-op", () => {
    expect(refresh({ ...current(), state: { ...state(), version: 2147483647 }, currentEdition: { ...edition(), version: 2147483647 } }).kind).toBe("noop");
  });
  it("does not mutate any passed source/state object and returns valid independent records", () => {
    const input = freeze({ ...current(), capture: capture("2026-10"), nextEditionId: 11 });
    const before = operationsBoardEditionCanonical(input), plan = refresh(input);
    expect(operationsBoardEditionCanonical(input)).toBe(before); expect(OperationsBoardEditionSchema.parse(plan.insertEdition)).toEqual(plan.insertEdition);
    expect(plan.updateEditions[0].capture).not.toBe(input.currentEdition.capture);
    const changedOutput = clone(plan); changedOutput.updateEditions[0].capture.rows[0].raw["原始完整字段"] = "changed";
    expect(input.currentEdition.capture.rows[0].raw["原始完整字段"]).toBe("原文\n换行");
  });
});
