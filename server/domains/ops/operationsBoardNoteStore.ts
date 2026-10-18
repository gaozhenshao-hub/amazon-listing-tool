import { sql, type SQL } from "drizzle-orm";
import {
  OPERATIONS_BOARD_EDITION_LIMITS, OperationsBoardEditionNoteSchema, OperationsBoardEditionSaveNoteInputSchema,
  OperationsBoardEditionScopeSchema, operationsBoardEditionCanonical, operationsBoardEditionScopeKey,
  validateOperationsBoardEditionNoteMutation,
  type OperationsBoardEdition, type OperationsBoardEditionNote, type OperationsBoardEditionSaveNoteInput, type OperationsBoardEditionScope,
} from "../../../shared/operationsBoardEdition";
import { authorizeOperationsBoardCapture, type OperationsBoardAccessSession } from "./operationsBoardAccess";
import { createOperationsBoardEditionStore, type OperationsBoardEditionStoreLoaded } from "./operationsBoardEditionStore";

export class OperationsBoardNoteStoreError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_NOTE_${code}`); this.name = "OperationsBoardNoteStoreError"; }
}
export type OperationsBoardNoteStoreResult = OperationsBoardEditionStoreLoaded & { note: OperationsBoardEditionNote };
type Row = Record<string, unknown>;
type StateMetadata = { id: number; workspaceId: number; scopeKey: string; storeName: string; country: string;
  currentMonth: string; currentEditionId: number; version: number; createdAt: string; updatedAt: string };
const MAX_ID = 2147483647, MAX_NOTE_BYTES = OPERATIONS_BOARD_EDITION_LIMITS.noteCharacters * 4;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_ID;
function fail(code: string): never { throw new OperationsBoardNoteStoreError(code); }
function statement(text: string, values: unknown[] = []): SQL {
  const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}000$/u.test(value)) return false;
  const iso = `${value.slice(0, 10)}T${value.slice(11, 23)}Z`, date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso;
}
const equal = (a: unknown, b: unknown) => operationsBoardEditionCanonical(a) === operationsBoardEditionCanonical(b);
const scopeValues = (scope: OperationsBoardEditionScope) => [scope.workspaceId, operationsBoardEditionScopeKey(scope), scope.storeName, scope.country];
const exactState = "s.workspace_id=? AND BINARY s.scope_key=BINARY ? AND BINARY s.store_name=BINARY ? AND BINARY s.country=BINARY ?";
const noteFrom = "FROM ops_board_notes n JOIN ops_board_editions e ON e.id=n.edition_id AND e.workspace_id=n.workspace_id JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id";
const noteSize = "OCTET_LENGTH(n.note)", noteCharacters = "CHAR_LENGTH(n.note)";

/** Internal same-transaction adapter. The caller must admit the actual schema,
 * obtain a fresh access session and (for save) hold its workspace/actor write
 * locks, then finalize the UUID journal in THIS transaction. This store never
 * opens or commits a transaction, and every thrown error must abort the caller.
 * Capture authorization is reloaded here without any partner sessions: a read
 * pairing or caller-provided array of owner IDs is never editing authority. */
export function createOperationsBoardNoteStore(session: OperationsBoardAccessSession) {
  if (!session?.tx || typeof session.tx.execute !== "function" || !positive(session.identity?.workspaceId) || !positive(session.identity?.userId)) fail("SESSION_INVALID");
  const { tx, identity, role } = session;
  const editions = createOperationsBoardEditionStore({ tx, identity, role, readOnly: !session.write });
  async function rows(text: string, values: unknown[] = []): Promise<Row[]> {
    const result = await tx.execute(statement(text, values));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID");
    return result[0] as Row[];
  }
  async function write(text: string, values: unknown[]) {
    const result = await tx.execute(statement(text, values)), header = Array.isArray(result) ? result[0] : null;
    if (!header || typeof header !== "object" || !("affectedRows" in header) || header.affectedRows !== 1) fail("WRITE_CONFLICT");
  }
  function scopeOf(raw: OperationsBoardEditionScope) {
    const checked = OperationsBoardEditionScopeSchema.safeParse(raw);
    if (!checked.success || checked.data.workspaceId !== identity.workspaceId) fail("SCOPE_INVALID");
    return checked.data;
  }
  function parentOf(parentAsin: string) {
    if (typeof parentAsin !== "string" || !parentAsin || parentAsin !== parentAsin.trim() || parentAsin.length > 500) fail("PARENT_INVALID");
    return parentAsin;
  }
  async function stateMetadata(scope: OperationsBoardEditionScope, expected: OperationsBoardEditionStoreLoaded): Promise<StateMetadata> {
    const found = await rows(`SELECT s.id,s.workspace_id AS workspaceId,s.scope_key AS scopeKey,s.store_name AS storeName,s.country,s.current_month AS currentMonth,s.current_edition_id AS currentEditionId,s.version,DATE_FORMAT(s.created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,DATE_FORMAT(s.updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM ops_board_states s WHERE ${exactState} AND s.id=? LIMIT 2 FOR UPDATE`, [...scopeValues(scope), expected.stateId]);
    const row = found[0];
    if (found.length !== 1 || !row || row.id !== expected.stateId || row.workspaceId !== scope.workspaceId || row.scopeKey !== operationsBoardEditionScopeKey(scope)
      || row.storeName !== scope.storeName || row.country !== scope.country || row.currentMonth !== expected.state.currentMonth
      || row.currentEditionId !== expected.currentEdition.id || row.version !== expected.state.version || !validTime(row.createdAt) || !validTime(row.updatedAt)
      || row.createdAt > row.updatedAt || row.updatedAt < expected.currentEdition.updatedAt) fail("STATE_CONFLICT");
    return row as StateMetadata;
  }
  async function noteOf(scope: OperationsBoardEditionScope, edition: OperationsBoardEdition, parentAsin: string, editBasis: OperationsBoardEditionNote["editBasis"]): Promise<OperationsBoardEditionNote> {
    const values = [...scopeValues(scope), edition.id, parentAsin], lock = session.write ? "FOR UPDATE" : "FOR SHARE";
    const where = `${exactState} AND e.id=? AND BINARY n.parent_asin=BINARY ?`;
    const sizes = await rows(`SELECT n.edition_id AS editionId,n.workspace_id AS workspaceId,n.parent_asin AS parentAsin,${noteSize} AS noteBytes,${noteCharacters} AS noteCharacters ${noteFrom} WHERE ${where} LIMIT 2 ${lock}`, values);
    if (!sizes.length) return OperationsBoardEditionNoteSchema.parse({ editionId: edition.id, parentAsin, note: "", version: 0, updatedBy: null, updatedAt: null, canEdit: editBasis !== "readonly", editBasis });
    const size = sizes[0];
    if (sizes.length !== 1 || size.editionId !== edition.id || size.workspaceId !== identity.workspaceId || size.parentAsin !== parentAsin
      || typeof size.noteBytes !== "number" || !Number.isSafeInteger(size.noteBytes) || size.noteBytes < 0 || size.noteBytes > MAX_NOTE_BYTES
      || typeof size.noteCharacters !== "number" || !Number.isSafeInteger(size.noteCharacters) || size.noteCharacters < 0 || size.noteCharacters > OPERATIONS_BOARD_EDITION_LIMITS.noteCharacters) fail("NOTE_INVALID");
    const found = await rows(`SELECT n.edition_id AS editionId,n.workspace_id AS workspaceId,n.parent_asin AS parentAsin,${noteSize} AS noteBytes,${noteCharacters} AS noteCharacters,IF(${noteSize}<=? AND ${noteCharacters}<=?,n.note,NULL) AS note,n.version,n.updated_by AS updatedBy,DATE_FORMAT(n.updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt ${noteFrom} WHERE ${where} LIMIT 2 ${lock}`,
      [MAX_NOTE_BYTES, OPERATIONS_BOARD_EDITION_LIMITS.noteCharacters, ...values]);
    const row = found[0];
    if (found.length !== 1 || !row || row.workspaceId !== identity.workspaceId || row.editionId !== edition.id || row.parentAsin !== parentAsin
      || row.noteBytes !== size.noteBytes || row.noteCharacters !== size.noteCharacters || typeof row.note !== "string" || Buffer.byteLength(row.note, "utf8") !== size.noteBytes
      || [...row.note].length !== size.noteCharacters || !positive(row.version) || !positive(row.updatedBy) || !validTime(row.updatedAt) || row.updatedAt > edition.updatedAt) fail("NOTE_INVALID");
    const checked = OperationsBoardEditionNoteSchema.safeParse({ editionId: edition.id, parentAsin, note: row.note, version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt, canEdit: editBasis !== "readonly", editBasis });
    if (!checked.success) fail("NOTE_INVALID");
    return checked.data;
  }
  async function authorized(edition: OperationsBoardEdition, parentAsin: string) {
    const access = await authorizeOperationsBoardCapture(session, edition.capture);
    const visible = access.authorizedRows.some(row => row.parentAsin === parentAsin && ["child", "parent_only"].includes(row.allocation));
    const editable = edition.status === "current" && session.write && session.operation === "update" && access.canEditParents.has(parentAsin);
    const editBasis = editable ? role === "admin" || role === "super_admin" ? "admin" as const : "responsible" as const : "readonly" as const;
    return { access, visible, editBasis };
  }
  async function load(rawScope: OperationsBoardEditionScope, editionId: number, rawParentAsin: string): Promise<OperationsBoardEditionNote | null> {
    const scope = scopeOf(rawScope), parentAsin = parentOf(rawParentAsin);
    if (!positive(editionId)) fail("EDITION_ID_INVALID");
    const edition = await editions.get(scope, editionId); if (!edition) return null;
    const access = await authorized(edition, parentAsin); if (!access.visible) return null;
    return noteOf(scope, edition, parentAsin, access.editBasis);
  }
  async function save(raw: OperationsBoardEditionSaveNoteInput): Promise<OperationsBoardNoteStoreResult> {
    const checked = OperationsBoardEditionSaveNoteInputSchema.safeParse(raw); if (!checked.success) fail("INPUT_INVALID");
    const input = checked.data;
    if (!session.write || session.operation !== "update") fail("WRITE_SESSION_REQUIRED");
    if (input.expectedWorkspaceId !== identity.workspaceId) fail("SCOPE_INVALID");
    const scope = scopeOf({ workspaceId: input.expectedWorkspaceId, ...input.scope });
    const current = await editions.load(scope); if (!current) fail("NOT_INITIALIZED");
    if (current.currentEdition.id !== input.editionId || current.currentEdition.status !== "current") fail("CURRENT_EDITION_REQUIRED");
    const permission = await authorized(current.currentEdition, input.parentAsin);
    if (!permission.visible) fail("PARENT_NOT_VISIBLE");
    if (permission.editBasis === "readonly") fail("EDIT_DENIED");
    const beforeNote = await noteOf(scope, current.currentEdition, input.parentAsin, permission.editBasis);
    validateOperationsBoardEditionNoteMutation(input, { identity, role, responsibleUserIds: permission.access.responsibleUserIdsByParent.get(input.parentAsin) ?? [], edition: current.currentEdition, note: beforeNote });
    if ([current.state.version, current.currentEdition.version, beforeNote.version].some(version => version >= MAX_ID)) fail("VERSION_EXHAUSTED");
    const beforeState = await stateMetadata(scope, current), times = await rows("SELECT DATE_FORMAT(CURRENT_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS now");
    if (times.length !== 1 || !validTime(times[0].now)) fail("CLOCK_INVALID");
    const stamp = times[0].now;
    if (stamp < beforeState.updatedAt || stamp < current.currentEdition.updatedAt || beforeNote.updatedAt !== null && stamp < beforeNote.updatedAt) fail("TIME_REVERSED");
    const edition = current.currentEdition, guard = `${exactState} AND s.id=? AND s.version=? AND s.current_edition_id=? AND BINARY s.current_month=BINARY ? AND e.id=s.current_edition_id AND e.version=? AND BINARY e.source_hash=BINARY ? AND e.status='current' AND e.kind='original' AND e.original_edition_id IS NULL AND e.archived_at IS NULL`;
    const guards = [...scopeValues(scope), current.stateId, current.state.version, edition.id, current.state.currentMonth, edition.version, edition.sourceHash];
    const noteVersion = beforeNote.version + 1, editionVersion = edition.version + 1, stateVersion = current.state.version + 1;
    if (beforeNote.version === 0) {
      await write(`INSERT INTO ops_board_notes (edition_id,workspace_id,parent_asin,note,version,updated_by,updated_at) SELECT e.id,s.workspace_id,?,?,1,?,? FROM ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM ops_board_notes existing_note WHERE existing_note.workspace_id=s.workspace_id AND existing_note.edition_id=e.id AND BINARY existing_note.parent_asin=BINARY ?)`,
        [input.parentAsin, input.note, identity.userId, stamp, ...guards, input.parentAsin]);
    } else {
      await write(`UPDATE ops_board_notes n JOIN ops_board_editions e ON e.id=n.edition_id AND e.workspace_id=n.workspace_id JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id SET n.note=?,n.version=?,n.updated_by=?,n.updated_at=? WHERE ${guard} AND BINARY n.parent_asin=BINARY ? AND n.version=? AND n.updated_by=? AND n.updated_at=? AND BINARY n.note=BINARY ?`,
        [input.note, noteVersion, identity.userId, stamp, ...guards, input.parentAsin, beforeNote.version, beforeNote.updatedBy, beforeNote.updatedAt, beforeNote.note]);
    }
    await write(`UPDATE ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id SET e.version=?,e.updated_at=? WHERE ${guard} AND e.updated_at=?`,
      [editionVersion, stamp, ...guards, edition.updatedAt]);
    await write(`UPDATE ops_board_states s SET s.version=?,s.updated_at=? WHERE ${exactState} AND s.id=? AND s.version=? AND s.current_edition_id=? AND BINARY s.current_month=BINARY ? AND s.updated_at=? AND EXISTS (SELECT 1 FROM ops_board_editions current_e WHERE current_e.workspace_id=s.workspace_id AND current_e.state_id=s.id AND current_e.id=? AND current_e.version=? AND BINARY current_e.source_hash=BINARY ? AND current_e.status='current' AND current_e.updated_at=?)`,
      [stateVersion, stamp, ...scopeValues(scope), current.stateId, current.state.version, edition.id, current.state.currentMonth, beforeState.updatedAt, edition.id, editionVersion, edition.sourceHash, stamp]);
    const after = await editions.load(scope);
    if (!after || after.stateId !== current.stateId || !equal(after.state, { ...current.state, version: stateVersion })
      || !equal(after.currentEdition, { ...edition, version: editionVersion, updatedAt: stamp })) fail("EDITION_READBACK_MISMATCH");
    const afterState = await stateMetadata(scope, after);
    if (!equal(afterState, { ...beforeState, version: stateVersion, updatedAt: stamp })) fail("STATE_READBACK_MISMATCH");
    const note = await noteOf(scope, after.currentEdition, input.parentAsin, permission.editBasis);
    if (!equal(note, { ...beforeNote, note: input.note, version: noteVersion, updatedBy: identity.userId, updatedAt: stamp })) fail("NOTE_READBACK_MISMATCH");
    return { ...after, note };
  }
  return { load, save };
}
