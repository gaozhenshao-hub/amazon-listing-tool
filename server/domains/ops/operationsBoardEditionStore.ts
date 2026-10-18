import { sql, type SQL } from "drizzle-orm";
import {
  OPERATIONS_BOARD_EDITION_LIMITS, OperationsBoardEditionCaptureSchema, OperationsBoardEditionSchema,
  OperationsBoardEditionScopeSchema, OperationsBoardEditionStateSchema, OperationsBoardEditionSummarySchema,
  assertOperationsBoardEditionState, operationsBoardEditionCanonical, operationsBoardEditionScopeKey,
  type OperationsBoardEdition, type OperationsBoardEditionCapture, type OperationsBoardEditionScope, type OperationsBoardEditionState,
} from "../../../shared/operationsBoardEdition";
import {
  planOperationsBoardInitialization, planOperationsBoardRefresh, planOperationsBoardRevision,
  type OperationsBoardLifecyclePlan,
} from "./operationsBoardLifecycle";

/** Internal SQL adapter only. The caller MUST hold the workspace lock in
 * a real transaction, admit the actual schema, and authorize the current actor.
 * readOnly uses shared locks and forbids every mutation; writes require the
 * exclusive workspace lock before loading any business rows.
 * No method opens/commits a transaction, performs authorization or catches a SQL
 * failure. A thrown error MUST abort the caller's whole transaction. */
export interface OperationsBoardEditionExecutor { execute(query: SQL): Promise<unknown> }
export class OperationsBoardEditionStoreError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_STORE_${code}`); this.name = "OperationsBoardEditionStoreError"; }
}
export type OperationsBoardEditionStoreLoaded = {
  stateId: number; state: OperationsBoardEditionState; currentEdition: OperationsBoardEdition;
};
export type OperationsBoardEditionStoreExpected = {
  stateVersion: number; currentEditionId: number | null; sourceHash: string | null;
};
export type OperationsBoardEditionStoreResult = OperationsBoardEditionStoreLoaded & {
  plan: OperationsBoardLifecyclePlan; publishedEdition: OperationsBoardEdition | null;
};
type Row = Record<string, unknown>;
type StateRow = { id: number; workspaceId: number; scopeKey: string; storeName: string; country: string;
  currentMonth: string; currentEditionId: number | null; version: number; createdAt: string; updatedAt: string };
const MAX_ID = 2147483647, MAX_REVISIONS = 10_000, MAX_CAPTURE = OPERATIONS_BOARD_EDITION_LIMITS.captureBytes;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_ID;
function fail(code: string): never { throw new OperationsBoardEditionStoreError(code); }
function statement(text: string, values: unknown[] = []): SQL {
  const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw(""));
}
function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}000$/u.test(value)) return false;
  const iso = `${value.slice(0, 10)}T${value.slice(11, 23)}Z`, date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso;
}
const equal = (a: unknown, b: unknown) => operationsBoardEditionCanonical(a) === operationsBoardEditionCanonical(b);
const scopeValues = (scope: OperationsBoardEditionScope) => [scope.workspaceId, operationsBoardEditionScopeKey(scope), scope.storeName, scope.country];
const exactState = "s.workspace_id=? AND BINARY s.scope_key=BINARY ? AND BINARY s.store_name=BINARY ? AND BINARY s.country=BINARY ?";
const editionFrom = "FROM ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id";
const captureSize = "OCTET_LENGTH(CAST(e.capture AS CHAR CHARACTER SET utf8mb4))";
const metadata = "e.id,e.workspace_id AS workspaceId,e.state_id AS stateId,e.month,e.revision,e.version,e.kind,e.status,e.original_edition_id AS originalEditionId,e.source_hash AS sourceHash,e.created_by AS createdBy,DATE_FORMAT(e.created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,DATE_FORMAT(e.updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt,DATE_FORMAT(e.archived_at,'%Y-%m-%d %H:%i:%s.%f') AS archivedAt";

export function createOperationsBoardEditionStore(input: {
  tx: OperationsBoardEditionExecutor; identity: { workspaceId: number; userId: number }; role: string; readOnly?: boolean;
}) {
  const { tx, identity, role } = input;
  const lock = input.readOnly ? "FOR SHARE" : "FOR UPDATE";
  function writable() { if (input.readOnly) fail("READ_ONLY_STORE"); }
  const creators = new Map<number, number>();
  if (!positive(identity.workspaceId) || !positive(identity.userId) || typeof role !== "string" || !role || !tx || typeof tx.execute !== "function") fail("IDENTITY_INVALID");
  function scopeOf(raw: OperationsBoardEditionScope) {
    const parsed = OperationsBoardEditionScopeSchema.safeParse(raw); if (!parsed.success || parsed.data.workspaceId !== identity.workspaceId) fail("SCOPE_INVALID");
    return parsed.data;
  }
  function captureOf(raw: OperationsBoardEditionCapture, scope: OperationsBoardEditionScope) {
    const parsed = OperationsBoardEditionCaptureSchema.safeParse(raw);
    if (!parsed.success || !equal(parsed.data.scope, scope)) fail("CAPTURE_INVALID");
    return parsed.data;
  }
  function admin() { if (role !== "admin" && role !== "super_admin") fail("ADMIN_REQUIRED"); }
  async function rows(text: string, values: unknown[] = []): Promise<Row[]> {
    const result = await tx.execute(statement(text, values));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID");
    return result[0] as Row[];
  }
  async function write(text: string, values: unknown[], inserting = false): Promise<number> {
    writable();
    const result = await tx.execute(statement(text, values)), header = Array.isArray(result) ? result[0] : null;
    if (!header || typeof header !== "object" || !("affectedRows" in header) || header.affectedRows !== 1) fail("WRITE_CONFLICT");
    if (inserting && (!("insertId" in header) || !positive(header.insertId))) fail("INSERT_ID_INVALID");
    return inserting ? (header as { insertId: number }).insertId : 0;
  }
  async function now() {
    const found = await rows("SELECT DATE_FORMAT(CURRENT_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS now");
    if (found.length !== 1 || !validTime(found[0].now)) fail("CLOCK_INVALID");
    return found[0].now;
  }
  async function stateRow(scope: OperationsBoardEditionScope): Promise<StateRow | null> {
    // The exact plaintext alternative detects a corrupt/different hash rather
    // than interpreting it as absent and creating a second scope.
    const found = await rows(`SELECT s.id,s.workspace_id AS workspaceId,s.scope_key AS scopeKey,s.store_name AS storeName,s.country,s.current_month AS currentMonth,s.current_edition_id AS currentEditionId,s.version,DATE_FORMAT(s.created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,DATE_FORMAT(s.updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM ops_board_states s WHERE s.workspace_id=? AND (s.scope_key=? OR (BINARY s.store_name=BINARY ? AND BINARY s.country=BINARY ?)) LIMIT 3 ${lock}`, scopeValues(scope));
    if (!found.length) return null;
    const row = found[0];
    if (found.length !== 1 || !positive(row.id) || row.workspaceId !== scope.workspaceId || row.scopeKey !== operationsBoardEditionScopeKey(scope) || row.storeName !== scope.storeName || row.country !== scope.country
      || typeof row.currentMonth !== "string" || !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(row.currentMonth) || !positive(row.currentEditionId) || !positive(row.version)
      || !validTime(row.createdAt) || !validTime(row.updatedAt) || row.createdAt > row.updatedAt) fail("STATE_INVALID");
    return row as StateRow;
  }
  async function editionRow(scope: OperationsBoardEditionScope, stateId: number, editionId: number): Promise<OperationsBoardEdition | null> {
    if (!positive(editionId)) fail("EDITION_ID_INVALID");
    const params = [...scopeValues(scope), stateId, editionId];
    const sizes = await rows(`SELECT e.id,${captureSize} AS captureBytes ${editionFrom} WHERE ${exactState} AND e.state_id=? AND e.id=? LIMIT 2 ${lock}`, params);
    if (!sizes.length) return null;
    if (sizes.length !== 1 || sizes[0].id !== editionId || typeof sizes[0].captureBytes !== "number" || !Number.isSafeInteger(sizes[0].captureBytes) || sizes[0].captureBytes <= 0 || sizes[0].captureBytes > MAX_CAPTURE) fail("CAPTURE_BUDGET");
    // Both the preflight and wire projection are bounded; no unbounded JSON is
    // fetched first and measured later. The row lock spans both statements.
    const found = await rows(`SELECT ${metadata},${captureSize} AS captureBytes,IF(${captureSize}<=?,e.capture,NULL) AS capture ${editionFrom} WHERE ${exactState} AND e.state_id=? AND e.id=? LIMIT 2 ${lock}`, [MAX_CAPTURE, ...params]);
    const row = found[0];
    if (found.length !== 1 || !row || row.id !== editionId || row.workspaceId !== scope.workspaceId || row.stateId !== stateId || !positive(row.createdBy) || row.captureBytes !== sizes[0].captureBytes || row.capture === null
      || !validTime(row.createdAt) || !validTime(row.updatedAt) || row.archivedAt !== null && !validTime(row.archivedAt)) fail("EDITION_INVALID");
    if (creators.has(editionId) && creators.get(editionId) !== row.createdBy) fail("EDITION_CREATOR_CHANGED");
    creators.set(editionId, row.createdBy);
    let capture: unknown = row.capture;
    if (typeof capture === "string") { try { capture = JSON.parse(capture); } catch { fail("CAPTURE_INVALID"); } }
    const parsed = OperationsBoardEditionSchema.safeParse({ id: row.id, scope, month: row.month, revision: row.revision, version: row.version, kind: row.kind, status: row.status,
      originalEditionId: row.originalEditionId, sourceHash: row.sourceHash, createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt, capture });
    if (!parsed.success) fail("CAPTURE_INVALID");
    return parsed.data;
  }
  async function loaded(scope: OperationsBoardEditionScope): Promise<{ row: StateRow; value: OperationsBoardEditionStoreLoaded } | null> {
    const row = await stateRow(scope); if (!row) return null;
    const currentEdition = await editionRow(scope, row.id, row.currentEditionId!); if (!currentEdition) fail("CURRENT_MISSING");
    const state = OperationsBoardEditionStateSchema.parse({ scope, version: row.version, currentMonth: row.currentMonth, currentEditionId: row.currentEditionId,
      status: currentEdition.capture.sources.some(source => source.month === row.currentMonth) ? "current" : "current_empty" });
    assertOperationsBoardEditionState(state, currentEdition);
    return { row, value: { stateId: row.id, state, currentEdition } };
  }
  function expectedMatches(value: OperationsBoardEditionStoreLoaded | null, expected?: OperationsBoardEditionStoreExpected) {
    if (expected === undefined) return;
    if (!Number.isInteger(expected.stateVersion) || expected.stateVersion < 0 || expected.stateVersion > MAX_ID || expected.currentEditionId !== null && !positive(expected.currentEditionId)
      || expected.sourceHash !== null && (typeof expected.sourceHash !== "string" || !/^[a-f0-9]{64}$/u.test(expected.sourceHash))
      || expected.stateVersion !== (value?.state.version ?? 0) || expected.currentEditionId !== (value?.state.currentEditionId ?? null) || expected.sourceHash !== (value?.currentEdition.sourceHash ?? null)) fail("EXPECTED_STATE_CONFLICT");
  }
  function uninitialized(scope: OperationsBoardEditionScope): OperationsBoardEditionState { return { scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" }; }
  async function reserveEdition(scope: OperationsBoardEditionScope, stateId: number, capture: OperationsBoardEditionCapture, stamp: string, revision = 1, originalId: number | null = null) {
    const status = originalId === null ? "current" : "archived", kind = originalId === null ? "original" : "revision";
    // INSERT ... SELECT binds the new row to the same exact plaintext scope and
    // hash. Its true auto-increment result is then checked by the pure planner.
    const editionId = await write(`INSERT INTO ops_board_editions (workspace_id,state_id,month,revision,version,kind,status,original_edition_id,capture,source_hash,created_by,created_at,updated_at,archived_at) SELECT s.workspace_id,s.id,?,?,1,?,?,?,?,?,?,?,?,? FROM ops_board_states s WHERE ${exactState} AND s.id=?`,
      [capture.month, revision, kind, status, originalId, operationsBoardEditionCanonical(capture), capture.sourceHash, identity.userId, stamp, stamp, originalId === null ? null : stamp, ...scopeValues(scope), stateId], true);
    creators.set(editionId, identity.userId); return editionId;
  }
  async function apply(scope: OperationsBoardEditionScope, previous: StateRow, before: OperationsBoardEdition | null, plan: OperationsBoardLifecyclePlan, stamp: string, original?: OperationsBoardEdition): Promise<OperationsBoardEditionStoreResult> {
    for (const changed of plan.updateEditions) {
      if (!before || before.status !== "current" || changed.id !== before.id || changed.kind !== "original") fail("ARCHIVE_IMMUTABLE");
      const guard = `WHERE ${exactState} AND e.state_id=? AND e.id=? AND e.version=? AND BINARY e.source_hash=BINARY ? AND e.status='current' AND e.kind='original' AND e.original_edition_id IS NULL AND BINARY e.month=BINARY ? AND e.revision=1`;
      const guardValues = [...scopeValues(scope), previous.id, before.id, before.version, before.sourceHash, before.month];
      if (changed.status === "archived") {
        if (changed.sourceHash !== before.sourceHash || !equal(changed.capture, before.capture)) fail("ARCHIVE_CAPTURE_CHANGED");
        // Freezing changes only lifecycle metadata; do not even reserialize the
        // old capture into an UPDATE when the next month arrives.
        await write(`UPDATE ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id SET e.version=?,e.status=?,e.updated_at=?,e.archived_at=? ${guard}`,
          [changed.version, changed.status, changed.updatedAt, changed.archivedAt, ...guardValues]);
      } else await write(`UPDATE ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id SET e.version=?,e.status=?,e.capture=?,e.source_hash=?,e.updated_at=?,e.archived_at=? ${guard}`,
        [changed.version, changed.status, operationsBoardEditionCanonical(changed.capture), changed.sourceHash, changed.updatedAt, changed.archivedAt, ...guardValues]);
    }
    if (plan.kind !== "noop") {
      if (!plan.currentEdition) fail("CURRENT_MISSING");
      await write(`UPDATE ops_board_states s SET s.current_month=?,s.current_edition_id=?,s.version=?,s.updated_at=? WHERE ${exactState} AND s.id=? AND s.version=? AND s.current_edition_id <=> ? AND BINARY s.current_month=BINARY ? AND EXISTS (SELECT 1 FROM ops_board_editions current_e WHERE current_e.workspace_id=s.workspace_id AND current_e.state_id=s.id AND current_e.id=? AND current_e.version=? AND BINARY current_e.source_hash=BINARY ? AND current_e.status='current')`,
        [plan.state.currentMonth, plan.state.currentEditionId, plan.state.version, stamp, ...scopeValues(scope), previous.id, previous.version, previous.currentEditionId, previous.currentMonth, plan.currentEdition.id, plan.currentEdition.version, plan.currentEdition.sourceHash]);
    }
    const after = await loaded(scope);
    if (!after || after.value.stateId !== previous.id || !equal(after.value.state, plan.state) || !equal(after.value.currentEdition, plan.currentEdition)
      || after.row.createdAt !== previous.createdAt || after.row.updatedAt !== (plan.kind === "noop" ? previous.updatedAt : stamp)) fail("STATE_READBACK_MISMATCH");
    for (const changed of plan.updateEditions) if (!equal(await editionRow(scope, previous.id, changed.id), changed)) fail("EDITION_READBACK_MISMATCH");
    let publishedEdition: OperationsBoardEdition | null = null;
    if (plan.insertEdition) {
      publishedEdition = await editionRow(scope, previous.id, plan.insertEdition.id);
      if (!equal(publishedEdition, plan.insertEdition)) fail("EDITION_READBACK_MISMATCH");
      const notes = await rows(`SELECT n.edition_id AS editionId FROM ops_board_notes n JOIN ops_board_editions e ON e.id=n.edition_id AND e.workspace_id=n.workspace_id JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id WHERE ${exactState} AND e.state_id=? AND e.id=? LIMIT 1 FOR UPDATE`, [...scopeValues(scope), previous.id, plan.insertEdition.id]);
      if (notes.length) fail("NEW_EDITION_NOTES_NOT_EMPTY");
    }
    if (original && !equal(await editionRow(scope, previous.id, original.id), original)) fail("ARCHIVE_READBACK_MISMATCH");
    return { ...after.value, plan, publishedEdition };
  }
  async function load(raw: OperationsBoardEditionScope) { return (await loaded(scopeOf(raw)))?.value ?? null; }
  async function get(raw: OperationsBoardEditionScope, editionId: number) {
    const scope = scopeOf(raw), current = await stateRow(scope); return current ? editionRow(scope, current.id, editionId) : null;
  }
  async function initializeExplicitAdmin(raw: OperationsBoardEditionScope, rawCapture: OperationsBoardEditionCapture, expected?: OperationsBoardEditionStoreExpected) {
    writable(); admin(); const scope = scopeOf(raw), capture = captureOf(rawCapture, scope), current = await loaded(scope); expectedMatches(current?.value ?? null, expected);
    if (current) fail("ALREADY_INITIALIZED");
    const stamp = await now();
    const stateId = await write("INSERT INTO ops_board_states (workspace_id,scope_key,store_name,country,current_month,current_edition_id,version,created_at,updated_at) VALUES (?,?,?,?,?,NULL,1,?,?)", [...scopeValues(scope), capture.month, stamp, stamp], true);
    const nextEditionId = await reserveEdition(scope, stateId, capture, stamp);
    const plan = planOperationsBoardInitialization({ role, state: uninitialized(scope), currentEdition: null, capture, now: stamp, nextEditionId });
    return apply(scope, { id: stateId, workspaceId: scope.workspaceId, scopeKey: operationsBoardEditionScopeKey(scope), storeName: scope.storeName, country: scope.country,
      currentMonth: capture.month, currentEditionId: null, version: 1, createdAt: stamp, updatedAt: stamp }, null, plan, stamp);
  }
  async function refreshExisting(raw: OperationsBoardEditionScope, rawCapture: OperationsBoardEditionCapture, expected?: OperationsBoardEditionStoreExpected) {
    writable();
    if (!["admin", "super_admin", "ops_manager"].includes(role)) fail("REFRESH_ROLE_REQUIRED");
    const scope = scopeOf(raw), capture = captureOf(rawCapture, scope), current = await loaded(scope); expectedMatches(current?.value ?? null, expected);
    if (!current) return null;
    const stamp = await now(); if (stamp < current.row.updatedAt) fail("STATE_TIME_REVERSED");
    const nextEditionId = capture.month > current.value.state.currentMonth! ? await reserveEdition(scope, current.row.id, capture, stamp) : undefined;
    const plan = planOperationsBoardRefresh({ ...current.value, capture, now: stamp, nextEditionId });
    return apply(scope, current.row, current.value.currentEdition, plan, stamp);
  }
  async function publishRevision(raw: OperationsBoardEditionScope, originalId: number, rawCapture: OperationsBoardEditionCapture, expected?: OperationsBoardEditionStoreExpected) {
    writable(); admin(); const scope = scopeOf(raw), capture = captureOf(rawCapture, scope), current = await loaded(scope); expectedMatches(current?.value ?? null, expected);
    if (!current) fail("NOT_INITIALIZED");
    const original = await editionRow(scope, current.row.id, originalId); if (!original) fail("ORIGINAL_MISSING");
    const all = await rows(`SELECT ${metadata} ${editionFrom} WHERE ${exactState} AND e.state_id=? AND BINARY e.month=BINARY ? ORDER BY e.revision,e.id LIMIT 10001 FOR UPDATE`, [...scopeValues(scope), current.row.id, original.month]);
    if (!all.length || all.length > MAX_REVISIONS) fail("REVISION_BUDGET");
    const revisions = new Set<number>(); let latestRevision = 0;
    for (const row of all) {
      const parsed = OperationsBoardEditionSummarySchema.safeParse({ id: row.id, scope, month: row.month, revision: row.revision, version: row.version, kind: row.kind, status: row.status, originalEditionId: row.originalEditionId, sourceHash: row.sourceHash, createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt });
      if (!parsed.success || row.workspaceId !== scope.workspaceId || row.stateId !== current.row.id || !positive(row.createdBy) || parsed.data.month !== original.month || parsed.data.status !== "archived"
        || parsed.data.kind === "original" && parsed.data.id !== original.id || parsed.data.kind === "revision" && parsed.data.originalEditionId !== original.id || revisions.has(parsed.data.revision)) fail("REVISION_INVALID");
      revisions.add(parsed.data.revision); latestRevision = Math.max(latestRevision, parsed.data.revision);
    }
    if (!revisions.has(1) || latestRevision !== revisions.size || latestRevision >= MAX_ID) fail("REVISION_INVALID");
    const stamp = await now(); if (stamp < current.row.updatedAt) fail("STATE_TIME_REVERSED");
    const nextEditionId = await reserveEdition(scope, current.row.id, capture, stamp, latestRevision + 1, original.id);
    const plan = planOperationsBoardRevision({ role, ...current.value, originalEdition: original, capture, latestRevision, now: stamp, nextEditionId });
    return apply(scope, current.row, current.value.currentEdition, plan, stamp, original);
  }
  return { load, get, initializeExplicitAdmin, refreshExisting, publishRevision };
}
