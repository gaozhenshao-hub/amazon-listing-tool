import {
  OperationsBoardEditionCaptureSchema, OperationsBoardEditionSchema, OperationsBoardEditionStateSchema,
  assertOperationsBoardEditionState, operationsBoardEditionCanonical, operationsBoardEditionScopeKey,
  type OperationsBoardEdition, type OperationsBoardEditionCapture, type OperationsBoardEditionState,
} from "../../../shared/operationsBoardEdition";

const MAX_INT = 2147483647;
export class OperationsBoardLifecycleError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_LIFECYCLE_${code}`); this.name = "OperationsBoardLifecycleError"; }
}

export type OperationsBoardLifecyclePlan = {
  kind: "noop" | "initialize" | "refresh" | "advance" | "publishRevision";
  state: OperationsBoardEditionState;
  currentEdition: OperationsBoardEdition | null;
  /** Existing rows to replace with their validated new version. The store must
   * compare their prior versions while holding the scope lock. */
  updateEditions: OperationsBoardEdition[];
  /** This ID is supplied by the persistent store, never synthesized here. */
  insertEdition: OperationsBoardEdition | null;
  notes: {
    preserveEditionIds: number[];
    readonlyEditionIds: number[];
    emptyEditionIds: number[];
  };
};
type CurrentInput = {
  state: OperationsBoardEditionState;
  currentEdition: OperationsBoardEdition | null;
  capture: OperationsBoardEditionCapture;
  /** Database DATETIME without timezone, formatted to six fractional digits.
   * This is not an assertion that the database session runs in UTC. */
  now: string;
};

function fail(code: string): never { throw new OperationsBoardLifecycleError(code); }
function nextVersion(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_INT) fail("VERSION_OVERFLOW");
  return value + 1;
}
function newId(value: number | undefined, existing: (OperationsBoardEdition | null)[]): number {
  if (!Number.isInteger(value) || value === undefined || value <= 0 || value > MAX_INT || existing.some(edition => edition?.id === value)) fail("INVALID_NEW_EDITION_ID");
  return value;
}
function admin(role: string): void { if (!["admin", "super_admin"].includes(role)) fail("ADMIN_REQUIRED"); }
function checkTime(now: string, editions: (OperationsBoardEdition | null)[]): void {
  if (!/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u.test(now)) fail("INVALID_TIME");
  const iso = `${now.slice(0, 10)}T${now.slice(11, 23)}Z`, date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== iso) fail("INVALID_TIME");
  if (editions.some(edition => edition !== null && (now < edition.updatedAt || edition.archivedAt !== null && (now < edition.archivedAt || edition.archivedAt < edition.updatedAt)))) fail("TIME_REVERSED");
}
function checked(input: CurrentInput) {
  const state = OperationsBoardEditionStateSchema.parse(input.state);
  const currentEdition = input.currentEdition === null ? null : OperationsBoardEditionSchema.parse(input.currentEdition);
  const capture = OperationsBoardEditionCaptureSchema.parse(input.capture);
  assertOperationsBoardEditionState(state, currentEdition);
  if (operationsBoardEditionScopeKey(state.scope) !== operationsBoardEditionScopeKey(capture.scope)) fail("SCOPE_MISMATCH");
  checkTime(input.now, [currentEdition]);
  return { state, currentEdition, capture };
}
function edition(id: number, capture: OperationsBoardEditionCapture, now: string): OperationsBoardEdition {
  return OperationsBoardEditionSchema.parse({ id, scope: capture.scope, month: capture.month, revision: 1, version: 1, kind: "original", status: "current",
    originalEditionId: null, sourceHash: capture.sourceHash, createdAt: now, updatedAt: now, archivedAt: null, capture });
}
function stateFor(state: OperationsBoardEditionState, currentEdition: OperationsBoardEdition): OperationsBoardEditionState {
  return OperationsBoardEditionStateSchema.parse({ scope: state.scope, version: nextVersion(state.version), currentMonth: currentEdition.month,
    currentEditionId: currentEdition.id, status: currentEdition.capture.sources.some(source => source.month === currentEdition.month) ? "current" : "current_empty" });
}
function noop(state: OperationsBoardEditionState, currentEdition: OperationsBoardEdition | null): OperationsBoardLifecyclePlan {
  return { kind: "noop", state, currentEdition, updateEditions: [], insertEdition: null,
    notes: { preserveEditionIds: currentEdition ? [currentEdition.id] : [], readonlyEditionIds: [], emptyEditionIds: [] } };
}

/** Only the explicit, freshly authorized administrator mutation may call this.
 * The caller supplies a complete capture through the latest confirmed month.
 * Historical months remain inside that one capture, not fabricated editions. */
export function planOperationsBoardInitialization(input: CurrentInput & { role: string; nextEditionId: number }): OperationsBoardLifecyclePlan {
  admin(input.role);
  const { state, currentEdition, capture } = checked(input);
  if (state.status !== "uninitialized") fail("ALREADY_INITIALIZED");
  if (capture.sources.length === 0 || capture.sources.at(-1)?.month !== capture.month) fail("LATEST_SOURCE_REQUIRED");
  const created = edition(newId(input.nextEditionId, [currentEdition]), capture, input.now);
  return { kind: "initialize", state: stateFor(state, created), currentEdition: created, updateEditions: [], insertEdition: created,
    notes: { preserveEditionIds: [], readonlyEditionIds: [], emptyEditionIds: [created.id] } };
}

/** Called inside the existing monthly confirm/revoke transaction, after source
 * selection and before its final receipt. Reading must not call any planner.
 * The store must capture through max(currentMonth, latest confirmed scope month).
 * Uninitialized scopes stay absent; this never implicitly opts them in. */
export function planOperationsBoardRefresh(input: CurrentInput & { nextEditionId?: number }): OperationsBoardLifecyclePlan {
  const { state, currentEdition, capture } = checked(input);
  if (state.status === "uninitialized") return noop(state, currentEdition);
  if (currentEdition === null || state.currentMonth === null) fail("CURRENT_REQUIRED");
  const latestSourceMonth = capture.sources.at(-1)?.month;
  const targetMonth = latestSourceMonth && latestSourceMonth > state.currentMonth ? latestSourceMonth : state.currentMonth;
  if (capture.month !== targetMonth) fail("CAPTURE_TARGET_MISMATCH");
  if (targetMonth === state.currentMonth) {
    // Compare the full validated capture, not only counts or selected metrics.
    if (operationsBoardEditionCanonical(capture) === operationsBoardEditionCanonical(currentEdition.capture)) return noop(state, currentEdition);
    const refreshed = OperationsBoardEditionSchema.parse({ ...currentEdition, version: nextVersion(currentEdition.version), sourceHash: capture.sourceHash, capture, updatedAt: input.now });
    return { kind: "refresh", state: stateFor(state, refreshed), currentEdition: refreshed, updateEditions: [refreshed], insertEdition: null,
      notes: { preserveEditionIds: [refreshed.id], readonlyEditionIds: [], emptyEditionIds: [] } };
  }
  // Freeze the PREVIOUS capture, including its original source selection and
  // raw content. Never first refresh it with the later month's source scan.
  const frozen = OperationsBoardEditionSchema.parse({ ...currentEdition, version: nextVersion(currentEdition.version), status: "archived", updatedAt: input.now, archivedAt: input.now });
  const created = edition(newId(input.nextEditionId, [currentEdition]), capture, input.now);
  return { kind: "advance", state: stateFor(state, created), currentEdition: created, updateEditions: [frozen], insertEdition: created,
    notes: { preserveEditionIds: [frozen.id], readonlyEditionIds: [frozen.id], emptyEditionIds: [created.id] } };
}

/** The store obtains latestRevision from all original-linked editions under the
 * same scope lock and reserves a unique ID before executing this plan. Publishing
 * only appends one immutable revision; it never rewrites the original/current. */
export function planOperationsBoardRevision(input: CurrentInput & {
  role: string; originalEdition: OperationsBoardEdition; latestRevision: number; nextEditionId: number;
}): OperationsBoardLifecyclePlan {
  admin(input.role);
  const { state, currentEdition, capture } = checked(input);
  const original = OperationsBoardEditionSchema.parse(input.originalEdition);
  if (state.status === "uninitialized" || original.kind !== "original" || original.status !== "archived" || original.id === currentEdition?.id) fail("ARCHIVED_ORIGINAL_REQUIRED");
  if (operationsBoardEditionScopeKey(original.scope) !== operationsBoardEditionScopeKey(state.scope) || capture.month !== original.month) fail("REVISION_SCOPE_MISMATCH");
  if (state.currentMonth === null || original.month >= state.currentMonth) fail("INVALID_ARCHIVED_MONTH");
  checkTime(input.now, [currentEdition, original]);
  if (!Number.isInteger(input.latestRevision) || input.latestRevision < 1) fail("INVALID_REVISION");
  const revision = OperationsBoardEditionSchema.parse({ id: newId(input.nextEditionId, [currentEdition, original]), scope: original.scope,
    month: original.month, revision: nextVersion(input.latestRevision), version: 1, kind: "revision", status: "archived", originalEditionId: original.id,
    sourceHash: capture.sourceHash, createdAt: input.now, updatedAt: input.now, archivedAt: input.now, capture });
  return { kind: "publishRevision", state: OperationsBoardEditionStateSchema.parse({ ...state, version: nextVersion(state.version) }), currentEdition,
    updateEditions: [], insertEdition: revision,
    notes: { preserveEditionIds: [original.id, ...(currentEdition ? [currentEdition.id] : [])], readonlyEditionIds: [original.id, revision.id], emptyEditionIds: [revision.id] } };
}
