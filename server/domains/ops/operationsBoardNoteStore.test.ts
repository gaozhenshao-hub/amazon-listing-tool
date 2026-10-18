import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildOperationsBoardEditionCapture, operationsBoardEditionScopeKey, type OperationsBoardEditionSaveNoteInput } from "../../../shared/operationsBoardEdition";
import { authorizeOperationsBoardAccess, authorizeOperationsBoardCapture, type OperationsBoardAccessSession } from "./operationsBoardAccess";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { createOperationsBoardNoteStore } from "./operationsBoardNoteStore";

type Row = Record<string, unknown>;
const identity = { userId: 3, workspaceId: 7 }, scope = { workspaceId: 7, storeName: "SYNTHETIC ? ' exact store", country: "US" };
const parent = "SYNTHETIC-PARENT", created = "2026-10-18 00:00:00.123000", stamp = "2026-10-18 01:00:00.123000";
function capture(month = "2026-10", parentAsin: string | null = parent, id = 42, operator = "External Owner") {
  const record: MonthlyFinancialBatchRecord = { id, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.csv", fileHash: "a".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: parentAsin === null ? 1 : 0,
    months: [month], createdAt: created, confirmedAt: created, fileReferenceKind: "storage", sourceRunId: null,
    payload: [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, metric === "financialProfit" ? -12 : null])), yearMonth: month, parentAsin,
      asin: "SYNTHETIC-CHILD", sku: "SYNTHETIC-SKU", title: "完整原文不得改写", storeName: scope.storeName, site: "美国", operator, raw: { currency: "USD", original: "完整来源证据" } }] };
  return prepareOperationsBoardHistoryCapture([record], 7).capture({ storeName: scope.storeName, country: scope.country, month });
}
function makeEdition(id = 501, month = "2026-10", status = "current") {
  const source = capture(month, parent, id === 501 ? 42 : 41);
  return { id, workspaceId: 7, stateId: 91, month, revision: 1, version: 2, kind: "original", status, originalEditionId: null,
    sourceHash: source.sourceHash, createdBy: 3, createdAt: created, updatedAt: created, archivedAt: status === "archived" ? created : null, capture: JSON.stringify(source) };
}
function actor(id = 3, role = "ops_specialist"): Row { return { id, role, status: "active", defaultWorkspaceId: 7 }; }
function member(userId = 3): Row { return { id: 70 + userId, workspaceId: 7, userId, status: "active" }; }
function manual(assigneeUserId: unknown = 3): Row { return { id: 81, workspaceId: 7, parentAsin: parent, storeName: scope.storeName, country: "US", assigneeUserId, isActive: 1 }; }
function note(patch: Row = {}): Row { return { editionId: 501, workspaceId: 7, parentAsin: parent, note: "原备注\n保留空白 ", version: 4, updatedBy: 3, updatedAt: created, ...patch }; }
const clone = <T>(value: T): T => structuredClone(value);
let states: Row[], editions: Row[], notes: Row[], actors: Row[], memberships: Row[], manuals: Row[], mappings: Row[], clock: string;
let calls: { sql: string; params: unknown[] }[], beforeWrite: ((text: string) => void) | null, afterWrite: ((text: string) => void) | null;
let failure: string | null, failError: Error, affectedOverride: number | undefined, forcedRead: ((text: string, found: Row[]) => Row[]) | null, nativeJson: boolean;
const stateMatch = (values: unknown[], offset: number) => states.find(row => row.workspaceId === values[offset] && row.scopeKey === values[offset + 1] && row.storeName === values[offset + 2] && row.country === values[offset + 3]);
function guarded(values: unknown[], offset: number) {
  const state = stateMatch(values, offset), edition = editions.find(row => state && row.workspaceId === state.workspaceId && row.stateId === state.id && row.id === state.currentEditionId);
  if (!state || !edition || state.id !== values[offset + 4] || state.version !== values[offset + 5] || state.currentEditionId !== values[offset + 6]
    || state.currentMonth !== values[offset + 7] || edition.version !== values[offset + 8] || edition.sourceHash !== values[offset + 9]
    || edition.status !== "current" || edition.kind !== "original" || edition.originalEditionId !== null || edition.archivedAt !== null) return null;
  return { state, edition };
}
const tx = { async execute(statement: SQL) {
  const call = new MySqlDialect().sqlToQuery(statement), { sql: text, params: values } = call; calls.push(call);
  if (failure && text.includes(failure)) throw failError;
  if (text.startsWith("SELECT")) {
    let found: Row[];
    if (text.includes("FROM workspaces")) found = [{ id: 7, status: "active" }];
    else if (text.includes("FROM users")) found = actors.filter(row => row.id === values[0]);
    else if (text.includes("FROM role_permissions")) found = [{ id: 12, workspaceId: 7, role: values[0], modules: ["ops"], detailedPermissions: [{ moduleId: "ops", operations: ["read", "edit"] }] }];
    else if (text.includes("FROM workspace_memberships m")) found = memberships.filter(row => row.workspaceId === values[0] && values.slice(1).includes(row.userId)).map(row => {
      const user = actors.find(item => item.id === row.userId);
      return { id: row.id, workspaceId: row.workspaceId, userId: row.userId, membershipStatus: row.status, actorId: user?.id ?? null, actorStatus: user?.status ?? null, defaultWorkspaceId: user?.defaultWorkspaceId ?? null };
    });
    else if (text.includes("FROM workspace_memberships")) found = memberships.filter(row => row.workspaceId === values[0] && row.userId === values[1]);
    else if (text.includes("FROM ops_inventory_owner_assignments")) found = manuals.filter(row => row.workspaceId === values[0] && row.storeName === values[1] && row.isActive === 1 && values.slice(2).includes(row.parentAsin));
    else if (text.includes("FROM operator_name_mappings")) found = mappings.filter(row => row.workspaceId === values[0] && row.isConfirmed === 1 && (text.includes("IN ('saihu','all')") ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)) && values.slice(1).includes(row.externalName));
    else if (text.includes(" AS now")) found = [{ now: clock }];
    else if (text.includes("FROM ops_board_states s") && !text.includes("JOIN")) found = states.filter(row => row.workspaceId === values[0]
      && (text.includes(" OR ") ? row.scopeKey === values[1] || row.storeName === values[2] && row.country === values[3] : row.scopeKey === values[1] && row.storeName === values[2] && row.country === values[3] && row.id === values[4]));
    else if (text.includes("FROM ops_board_notes n")) {
      const offset = text.includes("IF(") ? 2 : 0, state = stateMatch(values, offset);
      const edition = editions.find(row => state && row.workspaceId === state.workspaceId && row.stateId === state.id && row.id === values[offset + 4]);
      found = notes.filter(row => edition && row.workspaceId === edition.workspaceId && row.editionId === edition.id && row.parentAsin === values[offset + 5]).map(row => ({ ...row,
        noteBytes: Buffer.byteLength(String(row.note)), noteCharacters: [...String(row.note)].length }));
    } else if (text.includes("FROM ops_board_editions e")) {
      const offset = text.includes("IF(") ? 1 : 0, state = stateMatch(values, offset);
      found = editions.filter(row => state && state.id === values[offset + 4] && row.workspaceId === state.workspaceId && row.stateId === state.id && row.id === values[offset + 5]).map(row => ({ ...row,
        captureBytes: Buffer.byteLength(String(row.capture)), capture: nativeJson ? JSON.parse(String(row.capture)) : row.capture }));
    } else throw Error(`Unexpected fixture read ${text}`);
    return [clone(forcedRead ? forcedRead(text, found) : found), []];
  }
  beforeWrite?.(text); let affected = 0;
  if (text.startsWith("INSERT INTO ops_board_notes")) {
    const matched = guarded(values, 4);
    if (matched && !notes.some(row => row.workspaceId === matched.state.workspaceId && row.editionId === matched.edition.id && row.parentAsin === values[14])) {
      notes.push({ editionId: matched.edition.id, workspaceId: matched.state.workspaceId, parentAsin: values[0], note: values[1], version: 1, updatedBy: values[2], updatedAt: values[3] }); affected = 1;
    }
  } else if (text.startsWith("UPDATE ops_board_notes")) {
    const matched = guarded(values, 4), row = notes.find(row => matched && row.workspaceId === matched.state.workspaceId && row.editionId === matched.edition.id
      && row.parentAsin === values[14] && row.version === values[15] && row.updatedBy === values[16] && row.updatedAt === values[17] && row.note === values[18]);
    if (row) { Object.assign(row, { note: values[0], version: values[1], updatedBy: values[2], updatedAt: values[3] }); affected = 1; }
  } else if (text.startsWith("UPDATE ops_board_editions")) {
    const matched = guarded(values, 2);
    if (matched && matched.edition.updatedAt === values[12]) { Object.assign(matched.edition, { version: values[0], updatedAt: values[1] }); affected = 1; }
  } else if (text.startsWith("UPDATE ops_board_states")) {
    const state = stateMatch(values, 2), edition = editions.find(row => state && row.workspaceId === state.workspaceId && row.stateId === state.id && row.id === values[11]);
    if (state && edition && state.id === values[6] && state.version === values[7] && state.currentEditionId === values[8] && state.currentMonth === values[9] && state.updatedAt === values[10]
      && edition.version === values[12] && edition.sourceHash === values[13] && edition.status === "current" && edition.updatedAt === values[14]) {
      Object.assign(state, { version: values[0], updatedAt: values[1] }); affected = 1;
    }
  } else throw Error(`Unexpected fixture write ${text}`);
  afterWrite?.(text); return [{ affectedRows: affectedOverride ?? affected }, []];
} };
const permission = vi.fn(async () => {});
const session = (userId = 3, operation: "read" | "update" = "update") => authorizeOperationsBoardAccess(tx, { identity: { ...identity, userId }, operation }, permission);
const request = (patch: Partial<OperationsBoardEditionSaveNoteInput> = {}): OperationsBoardEditionSaveNoteInput => ({ expectedWorkspaceId: 7, scope: { storeName: scope.storeName, country: scope.country },
  operationId: "00000000-0000-4000-8000-000000000001", editionId: 501, parentAsin: parent, note: "新的备注\n  不裁剪 ", expectedEditionVersion: 2,
  expectedSourceHash: String(editions[0].sourceHash), expectedNoteVersion: 0, ...patch });
async function transaction<T>(body: () => Promise<T>): Promise<T> {
  const saved = clone({ states, editions, notes });
  try { return await body(); } catch (error) { ({ states, editions, notes } = saved); throw error; }
}
const save = (input = request()) => transaction(async () => createOperationsBoardNoteStore(await session()).save(input));
const writes = () => calls.filter(call => !call.sql.startsWith("SELECT"));
beforeEach(() => {
  states = [{ id: 91, workspaceId: 7, scopeKey: operationsBoardEditionScopeKey(scope), storeName: scope.storeName, country: scope.country, currentMonth: "2026-10", currentEditionId: 501, version: 5, createdAt: created, updatedAt: created }];
  editions = [makeEdition()]; notes = []; actors = [actor(), actor(4), actor(5, "ops_manager")]; memberships = [member(), member(4), member(5)]; manuals = [];
  mappings = [{ id: 61, workspaceId: 7, externalName: "External Owner", sourceType: "all", systemUserId: 3, isConfirmed: 1 }]; clock = stamp;
  calls = []; beforeWrite = null; afterWrite = null; failure = null; failError = Error("synthetic SQL failure"); affectedOverride = undefined; forcedRead = null; nativeJson = false; permission.mockClear();
});

describe("current responsible notes, not partner or manager editing", () => {
  it("loads an absent note without writes, then saves all three versions atomically", async () => {
    const s = await session(), store = createOperationsBoardNoteStore(s);
    expect(await store.load(scope, 501, parent)).toMatchObject({ version: 0, note: "", canEdit: true, editBasis: "responsible" }); expect(writes()).toHaveLength(0);
    const oldCapture = editions[0].capture, oldHash = editions[0].sourceHash;
    const result = await transaction(() => store.save(request()));
    expect(result.state.version).toBe(6); expect(result.currentEdition.version).toBe(3);
    expect(result.note).toMatchObject({ note: request().note, version: 1, updatedBy: 3, updatedAt: stamp, canEdit: true, editBasis: "responsible" });
    expect(editions[0].capture).toBe(oldCapture); expect(editions[0].sourceHash).toBe(oldHash); expect(states[0].updatedAt).toBe(stamp);
    expect(writes()).toHaveLength(3); expect(writes().some(call => /DELETE|capture=|source_hash=/u.test(call.sql.split(" WHERE ")[0]))).toBe(false);
  });
  it.each(["admin", "super_admin"])("permits %s after genuine current access without needing an owner-name grant", async role => {
    actors[0].role = role; mappings = [];
    expect((await save()).note.editBasis).toBe("admin");
  });
  it("manager all-product visibility does not authorize editing another responsible user's note", async () => {
    actors[0].role = "ops_manager"; mappings[0].systemUserId = 4;
    await expect(save()).rejects.toThrow("EDIT_DENIED"); expect(writes()).toHaveLength(0);
  });
  it("manager may edit their own genuinely mapped parent", async () => { actors[0].role = "ops_manager"; expect((await save()).note.editBasis).toBe("responsible"); });
  it("direct partner read visibility is never borrowed for a note write", async () => {
    mappings[0].systemUserId = 4; const own = await session(), partner = await session(4, "read");
    expect((await authorizeOperationsBoardCapture(own, capture(), { partnerSessions: [partner] })).authorizedRows).toHaveLength(1);
    await expect(transaction(() => createOperationsBoardNoteStore(own).save(request()))).rejects.toThrow("PARENT_NOT_VISIBLE"); expect(writes()).toHaveLength(0);
  });
  it("rejects a fabricated admin session through the real access helper", async () => {
    const real = await session(), fake = { ...real, role: "admin", manager: true };
    await expect(transaction(() => createOperationsBoardNoteStore(fake).save(request()))).rejects.toThrow("SESSION_INVALID"); expect(writes()).toHaveLength(0);
  });
  it("read-only session cannot save even when the current actor is responsible", async () => {
    const store = createOperationsBoardNoteStore(await session(3, "read"));
    expect(await store.load(scope, 501, parent)).toMatchObject({ canEdit: false, editBasis: "readonly" });
    await expect(store.save(request())).rejects.toThrow("WRITE_SESSION_REQUIRED"); expect(writes()).toHaveLength(0);
    expect(calls.filter(call => call.sql.includes("ops_board_")).every(call => call.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it("an active manual assignment takes precedence over a matching source name", async () => {
    manuals = [manual(4)]; await expect(save()).rejects.toThrow("PARENT_NOT_VISIBLE"); expect(writes()).toHaveLength(0);
    manuals[0].assigneeUserId = 3; expect((await save()).note.editBasis).toBe("responsible");
  });
  it.each(["invalid", "duplicate", "inactive", "foreign"])("does not fall back to source names for %s manual authority", async kind => {
    manuals = [manual(kind === "invalid" ? "3" : 4)];
    if (kind === "duplicate") manuals.push({ ...manual(3), id: 82 });
    if (kind === "inactive") actors[1].status = "disabled";
    if (kind === "foreign") actors[1].defaultWorkspaceId = 8;
    await expect(save()).rejects.toThrow("PARENT_NOT_VISIBLE"); expect(writes()).toHaveLength(0);
  });
  it("uses the latest visible month's actual owner rather than an old owner grant", async () => {
    const newer = capture("2026-10", parent, 42, "Other Owner"), older = capture("2026-09", parent, 41);
    const combined = buildOperationsBoardEditionCapture({ scope, month: "2026-10", scannedBatches: [...newer.scannedBatches, ...older.scannedBatches], sources: [...older.sources, ...newer.sources], rows: [...older.rows, ...newer.rows] });
    Object.assign(editions[0], { capture: JSON.stringify(combined), sourceHash: combined.sourceHash }); notes = [note()];
    mappings.push({ ...mappings[0], id: 62, externalName: "Other Owner", systemUserId: 4 });
    // Actor 3 can read its September row, but that does not make it the current
    // October owner or authorize writing the current edition's parent note.
    await expect(save(request({ expectedNoteVersion: 4 }))).rejects.toThrow("EDIT_DENIED"); expect(writes()).toHaveLength(0);
  });
  it("archived notes are readable but immutable, and current saves leave them untouched", async () => {
    editions.push(makeEdition(500, "2026-09", "archived")); notes.push(note({ editionId: 500, note: "历史原版，不复制" })); const old = clone({ edition: editions[1], note: notes[0] });
    const store = createOperationsBoardNoteStore(await session());
    expect(await store.load(scope, 500, parent)).toMatchObject({ note: "历史原版，不复制", canEdit: false, editBasis: "readonly" });
    await expect(store.save(request({ editionId: 500 }))).rejects.toThrow("CURRENT_EDITION_REQUIRED");
    await transaction(() => store.save(request())); expect(editions[1]).toEqual(old.edition); expect(notes[0]).toEqual(old.note);
  });
  it("actual source parent is required, not merely a guessed ASIN or child ASIN", async () => {
    actors[0].role = "admin";
    for (const parentAsin of ["OTHER", "SYNTHETIC-CHILD"]) await expect(save(request({ parentAsin }))).rejects.toThrow("PARENT_NOT_VISIBLE");
    expect(writes()).toHaveLength(0);
  });
});

describe("full note, edition, source and state CAS", () => {
  it("updates a note and preserves exact whitespace, empty clearing and markup as inert text", async () => {
    notes.push(note()); const text = "<script>alert('fixture')</script>\n  原文 ";
    const result = await save(request({ note: text, expectedNoteVersion: 4 })); expect(result.note.note).toBe(text); expect(result.note.version).toBe(5);
    const cleared = await save(request({ note: "", expectedNoteVersion: 5, expectedEditionVersion: 3 }));
    expect(cleared.note).toMatchObject({ note: "", version: 6 }); expect(notes).toHaveLength(1); expect(editions[0].version).toBe(4); expect(states[0].version).toBe(7);
  });
  it.each(["edition", "source", "note"])("rejects stale %s CAS before writing", async kind => {
    const input = request({ ...(kind === "edition" ? { expectedEditionVersion: 1 } : kind === "source" ? { expectedSourceHash: "f".repeat(64) } : { expectedNoteVersion: 1 }) });
    await expect(save(input)).rejects.toThrow("NOTE_VERSION_CONFLICT"); expect(writes()).toHaveLength(0);
  });
  it.each(["store", "country", "workspace"])("never crosses an exact %s scope", async kind => {
    const input = request(kind === "workspace" ? { expectedWorkspaceId: 8 } : { scope: { storeName: kind === "store" ? "OTHER" : scope.storeName, country: kind === "country" ? "CA" : scope.country } });
    await expect(save(input)).rejects.toThrow(kind === "workspace" ? "SCOPE_INVALID" : "NOT_INITIALIZED"); expect(writes()).toHaveLength(0);
  });
  it("scope-key corruption cannot look like an absent state", async () => {
    states[0].scopeKey = "f".repeat(64); await expect(save()).rejects.toThrow("STATE_INVALID"); expect(writes()).toHaveLength(0);
  });
  it.each(["pointer", "source", "stateVersion", "editionVersion", "noteVersion", "noteBody"])("SQL fences a changed %s and lets caller roll back the complete transaction", async kind => {
    if (kind.startsWith("note")) notes.push(note()); const input = request({ expectedNoteVersion: notes.length ? 4 : 0 }), before = clone({ states, editions, notes });
    beforeWrite = text => { if (!/^(INSERT INTO|UPDATE) ops_board_notes/u.test(text)) return;
      if (kind === "pointer") states[0].currentEditionId = 999;
      if (kind === "source") editions[0].sourceHash = "f".repeat(64);
      if (kind === "stateVersion") states[0].version = 6;
      if (kind === "editionVersion") editions[0].version = 3;
      if (kind === "noteVersion") notes[0].version = 5;
      if (kind === "noteBody") notes[0].note = "old writer without version";
    };
    await expect(save(input)).rejects.toThrow("WRITE_CONFLICT"); expect({ states, editions, notes }).toEqual(before);
  });
  it.each(["edition", "state"])("a failed %s metadata write rolls back the earlier note insert", async kind => {
    failure = kind === "edition" ? "UPDATE ops_board_editions" : "UPDATE ops_board_states";
    await expect(save()).rejects.toBe(failError); expect(notes).toEqual([]); expect(editions[0].version).toBe(2); expect(states[0].version).toBe(5);
  });
  it.each([0, 2, -1])("requires exactly one affected row, not %s", async affected => {
    affectedOverride = affected; await expect(save()).rejects.toThrow("WRITE_CONFLICT"); expect(notes).toHaveLength(0);
  });
  it.each(["note", "updatedBy", "capture", "creator", "stateCreated", "stateTime"])("full readback rejects changed %s even when SQL reports one row", async kind => {
    const before = clone({ states, editions, notes });
    afterWrite = text => { if (!text.startsWith("UPDATE ops_board_states")) return;
      if (kind === "note") notes[0].note = "truncated";
      if (kind === "updatedBy") notes[0].updatedBy = 4;
      if (kind === "capture") { const data = JSON.parse(String(editions[0].capture)); data.rows[0].raw.original = "tampered"; editions[0].capture = JSON.stringify(data); }
      if (kind === "creator") editions[0].createdBy = 4;
      if (kind === "stateCreated") states[0].createdAt = "2026-10-17 00:00:00.123000";
      if (kind === "stateTime") states[0].updatedAt = "2026-10-18 02:00:00.123000";
    };
    await expect(save()).rejects.toThrow(); expect({ states, editions, notes }).toEqual(before);
  });
  it.each(["state", "edition", "note"])("cannot increment exhausted %s version", async kind => {
    if (kind === "state") states[0].version = 2147483647;
    if (kind === "edition") editions[0].version = 2147483647;
    if (kind === "note") notes.push(note({ version: 2147483647 }));
    await expect(save(request({ expectedEditionVersion: Number(editions[0].version), expectedNoteVersion: kind === "note" ? 2147483647 : 0 }))).rejects.toThrow("VERSION_EXHAUSTED"); expect(writes()).toHaveLength(0);
  });
  it("rejects clock rollback after a newer historical revision updated only the state", async () => {
    states[0].updatedAt = "2026-10-18 02:00:00.123000";
    await expect(save()).rejects.toThrow("TIME_REVERSED"); expect(writes()).toHaveLength(0);
  });
  it.each(["2026-02-30 00:00:00.000000", "2026-10-18 00:00:00.123456", "2026-10-17 00:00:00.000000"])("rejects invalid or backwards DB timestamp %s", async now => {
    clock = now; await expect(save()).rejects.toThrow(); expect(writes()).toHaveLength(0);
  });
  it("native JSON readback preserves exactly the original canonical capture", async () => { nativeJson = true; expect((await save()).currentEdition.capture).toEqual(capture()); });
});

describe("bounded exact note reads and caller-owned transaction", () => {
  it("returns null for an absent edition or invisible parent without revealing stored note text", async () => {
    const store = createOperationsBoardNoteStore(await session());
    expect(await store.load(scope, 999, parent)).toBeNull(); expect(await store.load(scope, 501, "OTHER")).toBeNull();
    expect(calls.some(call => call.sql.includes("FROM ops_board_notes"))).toBe(false);
  });
  it("accepts the full 3000-character multibyte limit without truncation", async () => {
    const text = "中".repeat(3000); expect((await save(request({ note: text }))).note.note).toBe(text);
    const noteRead = calls.find(call => call.sql.includes("IF(OCTET_LENGTH(n.note)"));
    expect(noteRead?.sql).toContain("CHAR_LENGTH(n.note)<=?"); expect(noteRead?.params.slice(0, 2)).toEqual([12000, 3000]);
  });
  it("rejects oversized input before any SQL and does not silently normalize whitespace", async () => {
    const store = createOperationsBoardNoteStore(await session()); calls = [];
    await expect(store.save(request({ note: "a".repeat(3001) }))).rejects.toThrow("INPUT_INVALID"); expect(calls).toHaveLength(0);
    await expect(store.save(request({ parentAsin: ` ${parent}` }))).rejects.toThrow("INPUT_INVALID"); expect(calls).toHaveLength(0);
  });
  it.each(["bytes", "characters"])("rejects over-budget %s in preflight without fetching the note body", async kind => {
    notes.push(note()); forcedRead = (text, found) => text.includes("FROM ops_board_notes") ? found.map(row => ({ ...row, [kind === "bytes" ? "noteBytes" : "noteCharacters"]: kind === "bytes" ? 12001 : 3001 })) : found;
    await expect(save(request({ expectedNoteVersion: 4 }))).rejects.toThrow("NOTE_INVALID");
    expect(calls.some(call => call.sql.includes("IF(OCTET_LENGTH(n.note)"))).toBe(false);
  });
  it.each(["duplicate", "foreign", "invalidVersion", "badTime", "payloadChanged"])("refuses %s stored note rather than overwriting it", async kind => {
    notes.push(note());
    forcedRead = (text, found) => {
      if (!text.includes("FROM ops_board_notes")) return found;
      if (kind === "duplicate") return [...found, ...found];
      if (kind === "foreign") return found.map(row => ({ ...row, workspaceId: 8 }));
      if (!text.includes("IF(")) return found;
      return found.map(row => ({ ...row, ...(kind === "invalidVersion" ? { version: 0 } : kind === "badTime" ? { updatedAt: "2026-10-18 03:00:00.000000" } : { note: "body changed after preflight" }) }));
    };
    await expect(save(request({ expectedNoteVersion: 4 }))).rejects.toThrow("NOTE_INVALID"); expect(writes()).toHaveLength(0);
  });
  it("all writes bind exact workspace, plaintext scope, hash, pointer and source; no note is interpolated", async () => {
    const text = "'; UPDATE anything SET value=1; --"; await save(request({ note: text }));
    for (const query of writes()) { expect(query.sql).not.toContain(scope.storeName); expect(query.sql).not.toContain(text); expect(query.sql).toContain("s.workspace_id=?");
      expect(query.sql).toContain("BINARY s.scope_key=BINARY ?"); expect(query.sql).toContain("BINARY s.store_name=BINARY ?"); expect(query.sql).toContain("BINARY s.country=BINARY ?"); }
    expect(calls.some(call => /BEGIN|COMMIT|ROLLBACK|DELETE|ALTER|CREATE TABLE/u.test(call.sql))).toBe(false);
    expect(calls[0].sql).toContain("FROM workspaces"); expect(calls[0].sql).toContain("FOR UPDATE"); expect(calls[1].sql).toContain("FROM users");
  });
  it("throws the original SQL failure for caller rollback, without converting it to an empty note", async () => {
    failure = "FROM ops_board_notes"; await expect(save()).rejects.toBe(failError); expect(writes()).toHaveLength(0);
  });
  it("does not accept a caller-constructed owner list on the public request", async () => {
    const input = { ...request(), responsibleUserIds: [3] };
    await expect(save(input)).rejects.toThrow("INPUT_INVALID"); expect(writes()).toHaveLength(0);
  });
  it("requires a complete current access session, not an actor ID-only shortcut", () => {
    expect(() => createOperationsBoardNoteStore({} as OperationsBoardAccessSession)).toThrow("SESSION_INVALID");
  });
});
