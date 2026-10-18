import { beforeEach, describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildOperationsBoardEditionCapture, operationsBoardEditionScopeKey, type OperationsBoardEditionCapture } from "../../../shared/operationsBoardEdition";
import { createOperationsBoardEditionStore, type OperationsBoardEditionExecutor } from "./operationsBoardEditionStore";

type Row = Record<string, unknown>;
const scope = { workspaceId: 7, storeName: "SYNTHETIC Store ? ' exact", country: "US" };
const stamp = "2026-10-18 00:00:00.123000";
const identity = { userId: 3, workspaceId: 7 };
function capture(month = "2026-09", options: { rowsMonth?: string; empty?: boolean; batch?: number; profit?: number } = {}): OperationsBoardEditionCapture {
  const period = options.rowsMonth ?? month, batch = options.batch ?? 41;
  const record: MonthlyFinancialBatchRecord = { id: batch, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.csv", fileHash: "a".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [period], createdAt: stamp, confirmedAt: stamp,
    payload: [{ yearMonth: period, parentAsin: "SYNTHETIC-PARENT", asin: "SYNTHETIC-CHILD", sku: "SYNTHETIC-SKU", title: "合成完整原文", storeName: scope.storeName, site: "美国", operator: "SYNTHETIC", raw: { currency: "USD", original: "不能覆盖归档原文" }, ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, key === "financialProfit" ? options.profit ?? -5 : null])) }] };
  return buildOperationsBoardEditionCapture({ scope, month, scannedBatches: options.empty ? [] : [{ id: batch, recordHash: "b".repeat(64) }],
    sources: options.empty ? [] : [{ month: period, batchId: batch, recordHash: "b".repeat(64), rowCount: 1 }], rows: options.empty ? [] : parseMonthlyFinancialBatch(record).rows });
}
let states: Row[], editions: Row[], notes: Row[], queries: { sql: string; params: unknown[] }[], nextState: number, nextEdition: number, clock: string;
let readNative: boolean, failSql: string | null, failError: Error, affectedOverride: number | null, insertIdOverride: unknown;
let beforeWrite: ((text: string) => void) | null, afterWrite: ((text: string) => void) | null, oversized: boolean, forcedRows: ((text: string, rows: Row[]) => Row[]) | null;
const clone = <T>(value: T): T => structuredClone(value);
const exact = (params: unknown[], offset: number) => states.filter(state => state.workspaceId === params[offset] && state.scopeKey === params[offset + 1] && state.storeName === params[offset + 2] && state.country === params[offset + 3]);
function readEdition(row: Row) {
  const text = String(row.capture), captureBytes = Buffer.byteLength(text);
  return { ...row, captureBytes: oversized ? 64 * 1024 * 1024 + 1 : captureBytes, capture: readNative ? JSON.parse(text) : text };
}
const executor: OperationsBoardEditionExecutor = { async execute(statement: SQL) {
  const query = new MySqlDialect().sqlToQuery(statement), text = query.sql, values = query.params; queries.push(query);
  if (failSql && text.includes(failSql)) throw failError;
  if (text.startsWith("SELECT")) {
    let found: Row[];
    if (text.includes(" AS now")) found = [{ now: clock }];
    else if (text.includes("FROM ops_board_states s") && !text.includes("JOIN")) found = states.filter(row => row.workspaceId === values[0] && (row.scopeKey === values[1] || row.storeName === values[2] && row.country === values[3]));
    else if (text.includes("FROM ops_board_notes")) {
      const matched = exact(values, 0).find(row => row.id === values[4]);
      found = matched ? notes.filter(row => row.workspaceId === matched.workspaceId && row.editionId === values[5]).slice(0, 1) : [];
    } else if (text.includes("FROM ops_board_editions")) {
      const offset = text.includes("IF(") ? 1 : 0, matched = exact(values, offset).find(row => row.id === values[offset + 4]);
      found = matched ? editions.filter(row => row.workspaceId === matched.workspaceId && row.stateId === matched.id && (text.includes("ORDER BY e.revision") ? row.month === values[offset + 5] : row.id === values[offset + 5])) : [];
      found = found.map(readEdition);
      if (text.includes("ORDER BY e.revision")) found.sort((a, b) => Number(a.revision) - Number(b.revision));
    } else throw new Error(`Unexpected fixture read: ${text}`);
    return [clone(forcedRows ? forcedRows(text, found) : found), []];
  }
  beforeWrite?.(text); let inserted = 0, affected = 0;
  if (text.startsWith("INSERT INTO ops_board_states")) {
    inserted = nextState++;
    states.push({ id: inserted, workspaceId: values[0], scopeKey: values[1], storeName: values[2], country: values[3], currentMonth: values[4], currentEditionId: null, version: 1, createdAt: values[5], updatedAt: values[6] }); affected = 1;
  } else if (text.startsWith("INSERT INTO ops_board_editions")) {
    const matched = exact(values, 11).find(row => row.id === values[15]);
    if (matched) {
      inserted = nextEdition++;
      editions.push({ id: inserted, workspaceId: matched.workspaceId, stateId: matched.id, month: values[0], revision: values[1], version: 1, kind: values[2], status: values[3], originalEditionId: values[4], capture: values[5], sourceHash: values[6], createdBy: values[7], createdAt: values[8], updatedAt: values[9], archivedAt: values[10] }); affected = 1;
    }
  } else if (text.startsWith("UPDATE ops_board_editions")) {
    const offset = text.includes("e.capture=?") ? 6 : 4, matched = exact(values, offset).find(row => row.id === values[offset + 4]);
    const row = editions.find(item => matched && item.workspaceId === matched.workspaceId && item.stateId === matched.id && item.id === values[offset + 5] && item.version === values[offset + 6] && item.sourceHash === values[offset + 7] && item.status === "current" && item.kind === "original" && item.originalEditionId === null && item.month === values[offset + 8] && item.revision === 1);
    if (row) { Object.assign(row, offset === 6 ? { version: values[0], status: values[1], capture: values[2], sourceHash: values[3], updatedAt: values[4], archivedAt: values[5] } : { version: values[0], status: values[1], updatedAt: values[2], archivedAt: values[3] }); affected = 1; }
  } else if (text.startsWith("UPDATE ops_board_states")) {
    const row = exact(values, 4).find(item => item.id === values[8] && item.version === values[9] && item.currentEditionId === values[10] && item.currentMonth === values[11]
      && editions.some(edition => edition.workspaceId === item.workspaceId && edition.stateId === item.id && edition.id === values[12] && edition.version === values[13] && edition.sourceHash === values[14] && edition.status === "current"));
    if (row) { Object.assign(row, { currentMonth: values[0], currentEditionId: values[1], version: values[2], updatedAt: values[3] }); affected = 1; }
  } else throw new Error(`Unexpected fixture write: ${text}`);
  afterWrite?.(text);
  return [{ affectedRows: affectedOverride ?? affected, insertId: insertIdOverride === undefined ? inserted : insertIdOverride }, []];
} };
function store(role = "admin") { return createOperationsBoardEditionStore({ tx: executor, identity, role }); }
async function transaction<T>(body: () => Promise<T>): Promise<T> {
  const saved = clone({ states, editions, notes });
  try { return await body(); } catch (error) { ({ states, editions, notes } = saved); throw error; }
}
async function initialized() { return transaction(() => store().initializeExplicitAdmin(scope, capture())); }
async function advanced() { const first = await initialized(); clock = "2026-10-18 01:00:00.123000"; const next = await transaction(() => store("ops_manager").refreshExisting(scope, capture("2026-11", { batch: 42 }))); return { first, next: next! }; }
beforeEach(() => {
  states = []; editions = []; notes = []; queries = []; nextState = 91; nextEdition = 501; clock = stamp;
  readNative = false; failSql = null; failError = new Error("fixture SQL failure"); affectedOverride = null; insertIdOverride = undefined;
  beforeWrite = null; afterWrite = null; oversized = false; forcedRows = null;
});

describe("same-transaction edition SQL lifecycle", () => {
  it("load and get on an absent scope never create anything", async () => {
    expect(await store().load(scope)).toBeNull(); expect(await store().get(scope, 5)).toBeNull();
    expect(states).toEqual([]); expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("refreshing an uninitialized scope does not opt it in or manufacture history", async () => {
    expect(await store("ops_manager").refreshExisting(scope, capture())).toBeNull(); expect(states).toEqual([]); expect(editions).toEqual([]);
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("initializes using real auto-increment IDs and one consistent timestamp", async () => {
    const result = await initialized(); expect(result.stateId).toBe(91); expect(result.currentEdition.id).toBe(501);
    expect(result.state).toMatchObject({ version: 1, currentMonth: "2026-09", currentEditionId: 501, status: "current" });
    expect(result.currentEdition.capture).toEqual(capture()); expect(result.plan.kind).toBe("initialize"); expect(editions).toHaveLength(1);
    expect(result.currentEdition.createdAt).toBe(stamp); expect(queries.filter(query => query.sql.includes(" AS now"))).toHaveLength(1);
    expect(notes).toEqual([]);
  });
  it("initial capture can contain older history without creating historical editions", async () => {
    const old = capture("2026-08", { batch: 40 }), current = capture();
    const combined = buildOperationsBoardEditionCapture({ scope, month: current.month, scannedBatches: [...current.scannedBatches, ...old.scannedBatches], sources: [...old.sources, ...current.sources], rows: [...old.rows, ...current.rows] });
    const result = await transaction(() => store().initializeExplicitAdmin(scope, combined));
    expect(result.currentEdition.capture.rows).toHaveLength(2); expect(editions).toHaveLength(1); expect(editions[0].month).toBe("2026-09");
  });
  it.each(["ops_manager", "ops_specialist", "viewer"])("initialization is explicit admin-only, not %s", async role => {
    await expect(store(role).initializeExplicitAdmin(scope, capture())).rejects.toThrow("ADMIN_REQUIRED"); expect(queries).toHaveLength(0);
  });
  it("allows super_admin initialization, without any separate owner bypass", async () => {
    expect((await transaction(() => store("super_admin").initializeExplicitAdmin(scope, capture()))).state.version).toBe(1);
  });
  it("does not initialize an existing scope or treat no-source capture as current", async () => {
    await initialized(); await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("ALREADY_INITIALIZED");
    expect(editions).toHaveLength(1);
    const other = { ...scope, storeName: "SYNTHETIC No source" }, empty = buildOperationsBoardEditionCapture({ scope: other, month: "2026-09", scannedBatches: [], sources: [], rows: [] });
    await expect(transaction(() => store().initializeExplicitAdmin(other, empty))).rejects.toThrow("LATEST_SOURCE_REQUIRED"); expect(states).toHaveLength(1);
  });
  it("refreshes current complete capture with version/source CAS and preserves notes", async () => {
    const first = await initialized(); notes.push({ workspaceId: 7, editionId: 501, parentAsin: "SYNTHETIC-PARENT", note: "原版备注", version: 4 });
    const savedNotes = clone(notes); clock = "2026-10-18 01:00:00.123000";
    const result = await transaction(() => store("ops_manager").refreshExisting(scope, capture("2026-09", { batch: 42, profit: 88 }), { stateVersion: first.state.version, currentEditionId: 501, sourceHash: first.currentEdition.sourceHash }));
    expect(result?.plan.kind).toBe("refresh"); expect(result?.state.version).toBe(2); expect(result?.currentEdition.version).toBe(2); expect(result?.currentEdition.capture.rows[0].metrics.financialProfit).toBe(88);
    expect(notes).toEqual(savedNotes); expect(editions).toHaveLength(1);
  });
  it("unchanged full capture is read-only noop, no version churn", async () => {
    const first = await initialized(); queries = []; clock = "2026-10-18 01:00:00.123000";
    const next = await store().refreshExisting(scope, capture()); expect(next?.plan.kind).toBe("noop"); expect(next?.state).toEqual(first.state);
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("new month freezes old bytes before later source changes and does not copy notes or invent intervening months", async () => {
    const first = await initialized(); notes.push({ workspaceId: 7, editionId: 501, note: "历史原版保留" }); const oldCapture = clone(first.currentEdition.capture), savedNotes = clone(notes);
    clock = "2026-10-18 01:00:00.123000";
    const next = await transaction(() => store("ops_manager").refreshExisting(scope, capture("2026-12", { batch: 44, profit: 99 })));
    expect(editions.map(row => row.month)).toEqual(["2026-09", "2026-12"]); expect(next?.plan.kind).toBe("advance");
    const archived = await store().get(scope, 501); expect(archived?.status).toBe("archived"); expect(archived?.capture).toEqual(oldCapture);
    expect(notes).toEqual(savedNotes); expect(next?.plan.notes.emptyEditionIds).toEqual([502]);
    expect(queries.find(query => query.sql.startsWith("UPDATE ops_board_editions"))?.sql).not.toContain("e.capture=?");
  });
  it("revoke-to-empty preserves current month with older historical rows and no archive fallback", async () => {
    const { first, next } = await advanced(); const emptyCurrent = capture("2026-11", { rowsMonth: "2026-09" });
    const result = await transaction(() => store().refreshExisting(scope, emptyCurrent));
    expect(result?.state).toMatchObject({ currentMonth: "2026-11", currentEditionId: next.currentEdition.id, status: "current_empty" });
    expect(result?.currentEdition.capture.rows).toHaveLength(1); expect((await store().get(scope, first.currentEdition.id))?.status).toBe("archived");
  });
  it("publishes immutable revisions separately without moving current or copying original notes", async () => {
    const { first, next } = await advanced(); notes.push({ workspaceId: 7, editionId: 501, note: "不复制的原始备注" }); const old = await store().get(scope, 501), savedNotes = clone(notes);
    clock = "2026-10-18 02:00:00.123000";
    const revision = await transaction(() => store().publishRevision(scope, first.currentEdition.id, capture("2026-09", { batch: 45 })));
    expect(revision.state.currentEditionId).toBe(next.currentEdition.id); expect(revision.state.version).toBe(next.state.version + 1);
    expect(revision.currentEdition).toEqual(next.currentEdition); expect(revision.publishedEdition).toMatchObject({ id: 503, revision: 2, kind: "revision", status: "archived", originalEditionId: 501 });
    expect(await store().get(scope, 501)).toEqual(old); expect(notes).toEqual(savedNotes);
    const second = await transaction(() => store().publishRevision(scope, 501, capture("2026-09", { batch: 46 })));
    expect(second.publishedEdition).toMatchObject({ id: 504, revision: 3, originalEditionId: 501 });
  });
  it("rejects revision by manager and does not revise a current edition", async () => {
    await initialized(); await expect(store("ops_manager").publishRevision(scope, 501, capture())).rejects.toThrow("ADMIN_REQUIRED");
    await expect(transaction(() => store().publishRevision(scope, 501, capture()))).rejects.toThrow("REVISION_INVALID"); expect(editions).toHaveLength(1);
  });
  it("native JSON object and text both reconstruct the complete same capture", async () => {
    const first = await initialized(); readNative = true; expect(await store().load(scope)).toEqual({ stateId: first.stateId, state: first.state, currentEdition: first.currentEdition });
  });
});

describe("bounded immutable reads and transaction failure propagation", () => {
  it.each(["stateVersion", "currentEditionId", "sourceHash"])("rejects stale expected %s before any writes", async field => {
    const first = await initialized(); queries = [];
    const expected = { stateVersion: 1, currentEditionId: 501, sourceHash: first.currentEdition.sourceHash, [field]: field === "sourceHash" ? "f".repeat(64) : 9 };
    await expect(transaction(() => store().refreshExisting(scope, capture("2026-09", { batch: 42 }), expected))).rejects.toThrow("EXPECTED_STATE_CONFLICT");
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["version", "sourceHash", "status"])("edition %s changed before write causes rollback", async field => {
    await initialized(); const saved = clone(editions);
    beforeWrite = text => { if (text.startsWith("UPDATE ops_board_editions")) editions[0][field] = field === "version" ? 2 : field === "status" ? "archived" : "e".repeat(64); };
    await expect(transaction(() => store().refreshExisting(scope, capture("2026-09", { batch: 42 })))).rejects.toThrow("WRITE_CONFLICT"); expect(editions).toEqual(saved);
  });
  it.each(["version", "currentEditionId", "currentMonth"])("state %s changed before pointer update aborts edition and state writes", async field => {
    await initialized(); const saved = clone({ states, editions });
    beforeWrite = text => { if (text.startsWith("UPDATE ops_board_states")) states[0][field] = field === "currentMonth" ? "2026-08" : 9; };
    await expect(transaction(() => store().refreshExisting(scope, capture("2026-10", { batch: 42 })))).rejects.toThrow("WRITE_CONFLICT"); expect({ states, editions }).toEqual(saved);
  });
  it("SQL failure propagates unchanged, outer transaction rolls back all reserved rows", async () => {
    failSql = "UPDATE ops_board_states";
    await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toBe(failError);
    expect(states).toEqual([]); expect(editions).toEqual([]);
  });
  it("failure after caller's successful store operation rolls back its writes too", async () => {
    await expect(transaction(async () => { await store().initializeExplicitAdmin(scope, capture()); throw failError; })).rejects.toBe(failError);
    expect(states).toEqual([]); expect(editions).toEqual([]);
    expect(queries.some(query => /\b(?:COMMIT|ROLLBACK|BEGIN)\b/u.test(query.sql))).toBe(false);
  });
  it.each([0, 2])("requires exactly one affected row, not %s", async affected => {
    affectedOverride = affected; await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("WRITE_CONFLICT"); expect(states).toEqual([]);
  });
  it.each([0, "501", null, 2147483648])("never fabricates an auto-increment id from %s", async value => {
    insertIdOverride = value; await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("INSERT_ID_INVALID"); expect(states).toEqual([]);
  });
  it("rejects oversized capture at SQL byte preflight before fetching JSON", async () => {
    await initialized(); oversized = true; queries = [];
    await expect(store().load(scope)).rejects.toThrow("CAPTURE_BUDGET"); expect(queries.some(query => query.sql.includes("IF("))).toBe(false);
  });
  it("guards capture wire projection even after the locked preflight", async () => {
    await initialized(); queries = [];
    forcedRows = (text, result) => text.includes("IF(") ? result.map(row => ({ ...row, capture: null, captureBytes: Number(row.captureBytes) + 1 })) : result;
    await expect(store().load(scope)).rejects.toThrow("EDITION_INVALID"); expect(queries.find(query => query.sql.includes("IF("))?.params[0]).toBe(64 * 1024 * 1024);
  });
  it.each(["invalid_json", "mismatched_hash", "mismatched_workspace"])("rejects corrupt full capture: %s", async kind => {
    await initialized();
    if (kind === "invalid_json") editions[0].capture = "{";
    else if (kind === "mismatched_hash") editions[0].sourceHash = "f".repeat(64);
    else { const current = JSON.parse(String(editions[0].capture)); current.scope.workspaceId = 8; editions[0].capture = JSON.stringify(current); }
    await expect(store().load(scope)).rejects.toThrow("CAPTURE_INVALID");
  });
  it.each(["wrong_hash", "wrong_plaintext", "duplicate", "missing_pointer"])("does not trust hash alone or coerce bad state: %s", async kind => {
    await initialized();
    if (kind === "wrong_hash") states[0].scopeKey = "f".repeat(64);
    if (kind === "wrong_plaintext") states[0].storeName = "SYNTHETIC other";
    if (kind === "duplicate") states.push(clone(states[0]));
    if (kind === "missing_pointer") states[0].currentEditionId = null;
    await expect(store().load(scope)).rejects.toThrow("STATE_INVALID");
  });
  it("does not return another workspace or another exact shop's editions", async () => {
    await initialized(); expect(await store().get({ ...scope, storeName: "SYNTHETIC other" }, 501)).toBeNull();
    await expect(store().load({ ...scope, workspaceId: 8 })).rejects.toThrow("SCOPE_INVALID");
    editions[0].workspaceId = 8; await expect(store().load(scope)).rejects.toThrow("CURRENT_MISSING");
  });
  it("SQL uses bound parameters for scope, JSON and time, never interpolates source text", async () => {
    await initialized(); expect(queries.every(query => !query.sql.includes(scope.storeName) && !query.sql.includes("合成完整原文"))).toBe(true);
    const statements = queries.filter(query => query.sql.includes("ops_board_"));
    expect(statements.every(query => query.params.includes(7) && query.params.includes(operationsBoardEditionScopeKey(scope)))).toBe(true);
    expect(statements.filter(query => query.sql.startsWith("SELECT")).every(query => query.sql.endsWith("FOR UPDATE"))).toBe(true);
  });
  it("readback mismatch aborts and rolls back the whole planned change", async () => {
    await initialized(); const saved = clone({ states, editions });
    afterWrite = text => { if (text.startsWith("UPDATE ops_board_states")) states[0].version = 8; };
    await expect(transaction(() => store().refreshExisting(scope, capture("2026-10", { batch: 42 })))).rejects.toThrow("STATE_READBACK_MISMATCH"); expect({ states, editions }).toEqual(saved);
  });
  it("refuses a new edition with unexpected copied notes", async () => {
    afterWrite = text => { if (text.startsWith("INSERT INTO ops_board_editions")) notes.push({ workspaceId: 7, editionId: 501, note: "unexpected copied note" }); };
    await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("NEW_EDITION_NOTES_NOT_EMPTY"); expect(states).toEqual([]); expect(notes).toEqual([]);
  });
  it("readback verifies the actual creator rather than only its numeric validity", async () => {
    afterWrite = text => { if (text.startsWith("INSERT INTO ops_board_editions")) editions[0].createdBy = 99; };
    await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("EDITION_CREATOR_CHANGED"); expect(states).toEqual([]);
  });
  it("state pointer CAS also binds the actual current edition version and source", async () => {
    await initialized(); const saved = clone({ states, editions });
    beforeWrite = text => { if (text.startsWith("UPDATE ops_board_states")) editions[0].sourceHash = "f".repeat(64); };
    await expect(transaction(() => store().refreshExisting(scope, capture("2026-09", { batch: 42 })))).rejects.toThrow("WRITE_CONFLICT"); expect({ states, editions }).toEqual(saved);
  });
  it("all archive revisions are bounded and validated, not MAX silently ignoring conflicts", async () => {
    await advanced();
    forcedRows = (text, result) => text.includes("ORDER BY e.revision") ? Array.from({ length: 10001 }, () => result[0]) : result;
    await expect(transaction(() => store().publishRevision(scope, 501, capture()))).rejects.toThrow("REVISION_BUDGET"); expect(editions).toHaveLength(2);
  });
  it("duplicate or mislinked historical revision cannot be silently selected", async () => {
    await advanced(); editions.push({ ...clone(editions[0]), id: 503, kind: "revision", revision: 2, originalEditionId: 500 });
    await expect(transaction(() => store().publishRevision(scope, 501, capture()))).rejects.toThrow("REVISION_INVALID");
  });
  it.each(["2026-10-18 00:00:00.123456", "2026-02-30 00:00:00.000000"])("requires a real DATETIME(3) compatible clock: %s", async value => {
    clock = value; await expect(transaction(() => store().initializeExplicitAdmin(scope, capture()))).rejects.toThrow("CLOCK_INVALID"); expect(states).toEqual([]);
  });
  it.each(["refresh", "revision"])("%s rejects a clock newer than current edition but older than the latest revision's state timestamp", async action => {
    await advanced(); clock = "2026-10-18 02:00:00.123000";
    await transaction(() => store().publishRevision(scope, 501, capture("2026-09", { batch: 45 })));
    const saved = clone({ states, editions }); queries = []; clock = "2026-10-18 01:30:00.123000";
    await expect(transaction(() => action === "refresh" ? store().refreshExisting(scope, capture("2026-11", { batch: 46 })) : store().publishRevision(scope, 501, capture("2026-09", { batch: 46 })))).rejects.toThrow("STATE_TIME_REVERSED");
    expect({ states, editions }).toEqual(saved); expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("archives are never SQL update targets and neither lifecycle path writes/deletes notes", async () => {
    await advanced(); await transaction(() => store().publishRevision(scope, 501, capture()));
    expect(queries.filter(query => query.sql.startsWith("UPDATE ops_board_editions")).every(query => query.sql.includes("e.status='current'") && query.sql.includes("e.kind='original'"))).toBe(true);
    expect(queries.some(query => /^(?:DELETE|UPDATE ops_board_notes|INSERT INTO ops_board_notes)/u.test(query.sql))).toBe(false);
  });
});
