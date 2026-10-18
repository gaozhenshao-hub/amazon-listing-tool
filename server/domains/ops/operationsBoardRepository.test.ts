import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import {
  operationsBoardEditionCanonical, operationsBoardEditionHash, OperationsBoardEditionWriteResultSchema,
  type OperationsBoardEdition, type OperationsBoardEditionCapture, type OperationsBoardEditionExecuteInput,
  type OperationsBoardEditionNote, type OperationsBoardEditionPreviewInput, type OperationsBoardEditionSaveNoteInput,
  type OperationsBoardEditionWriteResult,
} from "../../../shared/operationsBoardEdition";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { planOperationsBoardInitialization, planOperationsBoardRevision } from "./operationsBoardLifecycle";
import { OperationsBoardOperationJournalError } from "./operationsBoardOperationJournal";
import type { OperationsBoardEditionStoreLoaded } from "./operationsBoardEditionStore";
import type { OperationsBoardAccessSession } from "./operationsBoardAccess";
import { createOperationsBoardRepository, type OperationsBoardDatabase } from "./operationsBoardRepository";

/** Protocol/transaction orchestration fixtures only. These deliberately do not
 * pretend to prove MySQL locking, schema readiness, or persistent durability;
 * the real access, SQL stores and journal have separate behavioral suites. */
type Dependencies = NonNullable<Parameters<typeof createOperationsBoardRepository>[0]>;
type Row = Record<string, unknown>;
const identity = { userId: 3, workspaceId: 7 }, scope = { workspaceId: 7, storeName: "SYNTHETIC Exact Shop", country: "US" };
const base = { expectedWorkspaceId: 7, scope: { storeName: scope.storeName, country: scope.country } };
const operationId = "00000000-0000-4000-8000-000000000001", otherOperationId = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-10-18 12:00:00.000000", parent = "SYNTHETIC-OWNED", hiddenParent = "SYNTHETIC-HIDDEN";
const clone = <T>(value: T): T => structuredClone(value);
function sources(through = "9999-12", marker = "v1") {
  const months = through < "2026-09" ? [through] : ["2026-09", "2026-10"].filter(month => month <= through);
  const records: MonthlyFinancialBatchRecord[] = months.map((month, index) => ({
    id: 41 + index, workspaceId: 7, userId: 9, fileName: "SYNTHETIC_PRIVATE_FILENAME.csv", fileHash: "a".repeat(64), status: "completed",
    totalRows: 2, skippedRows: 0, unallocatedRows: 0, months: [month], createdAt: stamp, confirmedAt: stamp, fileReferenceKind: "storage", sourceRunId: null,
    payload: [parent, hiddenParent].map((parentAsin, row) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, metric === "financialProfit" ? -12 : null])), yearMonth: month,
      parentAsin, asin: `SYNTHETIC-CHILD-${row}`, sku: `SYNTHETIC-SKU-${row}`, title: row ? "SYNTHETIC_PRIVATE_TITLE" : "完整已授权产品", storeName: scope.storeName, site: "US", operator: "SYNTHETIC_OWNER",
      raw: { currency: "USD", original: row ? "SYNTHETIC_PRIVATE_RAW" : "完整可见原行", version: marker } })),
  }));
  return prepareOperationsBoardHistoryCapture(records.reverse(), 7).capture({ ...base.scope, month: through });
}
function edition(id: number, month: string, archived = false): OperationsBoardEdition {
  const capture = sources(month);
  return { id, scope, month, revision: 1, version: 2, kind: "original", status: archived ? "archived" : "current", originalEditionId: null,
    sourceHash: capture.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: archived ? stamp : null, capture };
}
function context(role = "admin"): TrpcContext { return { user: { id: 3, defaultWorkspaceId: 7, role }, workspaceId: 7 } as TrpcContext; }
function fixture() {
  const current = edition(501, "2026-10"), old = edition(499, "2026-09", true);
  let memory: {
    loaded: OperationsBoardEditionStoreLoaded | null; editions: Map<number, OperationsBoardEdition>;
    notes: Map<string, OperationsBoardEditionNote>; receipts: Map<string, OperationsBoardEditionWriteResult>;
  } = { loaded: { stateId: 91, state: { scope, version: 4, currentMonth: current.month, currentEditionId: current.id, status: "current" }, currentEdition: current },
    editions: new Map([[current.id, current], [old.id, old]]), notes: new Map(), receipts: new Map() };
  const controls = { enabled: true, database: true, loseAck: false, finalizeError: false, sourceMarker: "v1", canUpdate: true,
    authorization: "b".repeat(64), ownersFence: 1, role: "admin", invisibleParents: new Set<string>(), hiddenEditions: new Set<string>(), partnerIds: [] as number[], deniedPartners: new Set<number>(), partnerReadError: false };
  const sqlCalls: { sql: string; params: unknown[] }[] = [], transactionEvents: string[] = [];
  let sqlOverride: ((text: string, values: unknown[], rows: Row[]) => Row[]) | null = null;
  const executeSql = vi.fn(async (statement: SQL) => {
    const call = new MySqlDialect().sqlToQuery(statement), { sql: text, params: values } = call; sqlCalls.push(call); let rows: Row[];
    if (text.includes("FROM ops_board_notes")) rows = [...memory.notes.values()].filter(note => note.editionId === values[1] && values.slice(2).includes(note.parentAsin))
      .map(note => ({ ...note, workspaceId: 7, noteBytes: Buffer.byteLength(note.note) }));
    else if (text.includes("FROM ops_board_editions")) rows = [...memory.editions.values()].filter(value => value.status === "archived" && value.id < Number(values[5])).sort((a, b) => b.id - a.id).slice(0, 201)
      .map(value => ({ id: value.id, workspaceId: 7, stateId: 91, captureBytes: Buffer.byteLength(JSON.stringify(value.capture)) }));
    else if (text.includes("FROM ops_inventory_owner_assignments")) rows = [{ id: 1, workspaceId: 7, version: controls.ownersFence }];
    else if (text.includes("FROM operator_name_mappings") || text.includes("FROM workspace_memberships")) rows = [];
    else throw Error(`Unexpected protocol fixture SQL: ${text}`);
    return [clone(sqlOverride ? sqlOverride(text, values, rows) : rows), []];
  });
  const tx = { execute: executeSql } as DbExecutor;
  async function transaction<T>(body: (executor: DbExecutor) => Promise<T>): Promise<T> {
    const before = clone(memory); transactionEvents.push("begin"); let value: T;
    try { value = await body(tx); } catch (error) { memory = before; transactionEvents.push("rollback"); throw error; }
    transactionEvents.push("commit");
    if (controls.loseAck) { controls.loseAck = false; throw Error("SYNTHETIC lost commit acknowledgement"); }
    return value;
  }
  const database = vi.fn(async (): Promise<OperationsBoardDatabase | null> => controls.database ? { transaction } : null);
  const authorize = vi.fn<NonNullable<Dependencies["authorize"]>>(async (executor, input) => {
    if (controls.deniedPartners.has(input.identity.userId)) throw new TRPCError({ code: "FORBIDDEN", message: "OPERATIONS_BOARD_ACCESS_RESOURCE_DENIED" });
    if (controls.partnerReadError && input.identity.userId !== identity.userId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_ACCESS_READ_UNAVAILABLE" });
    const role = input.identity.userId === identity.userId ? controls.role : "ops_specialist";
    if (input.operation === "create" && !["admin", "super_admin"].includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "OPERATIONS_BOARD_ACCESS_ADMIN_REQUIRED" });
    return { tx: executor, identity: input.identity, actor: { id: input.identity.userId, defaultWorkspaceId: 7, role }, role, manager: ["admin", "super_admin", "ops_manager"].includes(role),
      operation: input.operation, write: input.write ?? input.operation !== "read", authorizationEvidence: { workspaceId: 7, membershipId: 73, directoryHash: "c".repeat(64), grants: ["ops_data:read", "ops_board:read"] }, authorizationHash: controls.authorization };
  });
  const authorizeCapture = vi.fn<NonNullable<Dependencies["authorizeCapture"]>>(async (session, capture) => {
    const authorizedRows = controls.hiddenEditions.has(capture.sourceHash) ? [] : capture.rows.filter(row => !controls.invisibleParents.has(row.parentAsin));
    return { authorizedRows, sources: capture.sources.flatMap(source => { const rowCount = authorizedRows.filter(row => row.yearMonth === source.month).length; return rowCount ? [{ ...source, rowCount }] : []; }),
      responsibleUserIdsByParent: new Map([[parent, [3]]]), canEditParents: new Set([parent]), authorizationHash: controls.authorization, visibility: session.manager ? "full" : "scoped" };
  });
  const load = vi.fn(async () => clone(memory.loaded));
  const get = vi.fn(async (_scope: unknown, id: number) => clone(memory.editions.get(id) ?? null));
  const initialize = vi.fn<ReturnType<NonNullable<Dependencies["store"]>>["initializeExplicitAdmin"]>(async (targetScope, capture) => {
    const plan = planOperationsBoardInitialization({ role: controls.role, state: { scope: targetScope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" }, currentEdition: null, capture, now: stamp, nextEditionId: 1001 });
    memory.loaded = { stateId: 91, state: plan.state, currentEdition: plan.currentEdition! }; memory.editions.set(1001, plan.insertEdition!);
    return { ...clone(memory.loaded), plan, publishedEdition: plan.insertEdition };
  });
  const publishRevision = vi.fn<ReturnType<NonNullable<Dependencies["store"]>>["publishRevision"]>(async (_targetScope, originalId, capture) => {
    const plan = planOperationsBoardRevision({ role: controls.role, state: memory.loaded!.state, currentEdition: memory.loaded!.currentEdition, originalEdition: memory.editions.get(originalId)!, capture,
      latestRevision: 1, now: stamp, nextEditionId: 1002 });
    memory.loaded = { ...memory.loaded!, state: plan.state }; memory.editions.set(1002, plan.insertEdition!);
    return { ...clone(memory.loaded), plan, publishedEdition: plan.insertEdition };
  });
  const refreshExisting = vi.fn(async () => { throw Error("Read facade must not refresh"); });
  const store = vi.fn<NonNullable<Dependencies["store"]>>(() => ({ load, get, initializeExplicitAdmin: initialize, publishRevision, refreshExisting }));
  const directForUser = vi.fn(async () => controls.partnerIds.map((userId, index) => ({ id: index + 1, workspaceId: 7, firstUserId: 3, secondUserId: userId, isActive: true, version: 1, updatedBy: 3, updatedAt: stamp })));
  const partners = vi.fn<NonNullable<Dependencies["partners"]>>(() => ({ directForUser, loadAll: async () => [], members: async () => [], setPair: async () => { throw Error("No partner writes through edition facade"); } }));
  const journalRead = vi.fn(), finalized = vi.fn(), cancelled = vi.fn();
  const journal = vi.fn<NonNullable<Dependencies["journal"]>>((_executor, input) => {
    const key = JSON.stringify([input.identity.workspaceId, input.identity.userId, input.operationId]);
    async function read() {
      journalRead(input); const final = memory.receipts.get(key) ?? null;
      if (final && operationsBoardEditionCanonical(final.scope) !== operationsBoardEditionCanonical(input.scope)) throw new OperationsBoardOperationJournalError("SCOPE_MISMATCH");
      return { final: clone(final) };
    }
    async function finalize(receipt: OperationsBoardEditionWriteResult) {
      finalized(receipt); if (controls.finalizeError) throw Error("SYNTHETIC journal write lost acknowledgement");
      const previous = (await read()).final;
      if (previous?.status === "cancelled") throw new OperationsBoardOperationJournalError("OPERATION_CANCELLED");
      if (previous && operationsBoardEditionCanonical(previous) !== operationsBoardEditionCanonical(receipt)) throw new OperationsBoardOperationJournalError("CONTENT_CONFLICT");
      memory.receipts.set(key, clone(receipt)); return receipt;
    }
    async function cancel() {
      cancelled(input); const previous = (await read()).final; if (previous) return previous;
      const final = OperationsBoardEditionWriteResultSchema.parse({ identity: input.identity, scope: input.scope, operationId: input.operationId, action: null, status: "cancelled", requestHash: null,
        stateVersion: null, editionId: null, editionVersion: null, sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: "operation_cancelled" });
      memory.receipts.set(key, final); return final;
    }
    return { assertSchema: async () => {}, read, finalize, cancel };
  });
  const noteSave = vi.fn<ReturnType<NonNullable<Dependencies["notes"]>>["save"]>(async input => {
    const loaded = memory.loaded!, note: OperationsBoardEditionNote = { editionId: input.editionId, parentAsin: input.parentAsin, note: input.note, version: input.expectedNoteVersion + 1,
      updatedBy: 3, updatedAt: stamp, canEdit: true, editBasis: controls.role === "admin" ? "admin" : "responsible" };
    memory.loaded = { ...loaded, state: { ...loaded.state, version: loaded.state.version + 1 }, currentEdition: { ...loaded.currentEdition, version: loaded.currentEdition.version + 1 } };
    memory.editions.set(input.editionId, memory.loaded.currentEdition); memory.notes.set(`${input.editionId}:${input.parentAsin}`, note);
    return { ...clone(memory.loaded), note };
  });
  const notes = vi.fn<NonNullable<Dependencies["notes"]>>(() => ({ load: async () => null, save: noteSave }));
  const capture = vi.fn<NonNullable<Dependencies["capture"]>>(async (_session, input) => sources(input.month, controls.sourceMarker));
  const admit = vi.fn<NonNullable<Dependencies["admit"]>>(async () => {}), permission = vi.fn(async () => {}), canUpdate = vi.fn(async () => controls.canUpdate);
  const repository = createOperationsBoardRepository({ database, enabled: () => controls.enabled, authorize, authorizeCapture, store, partners, journal, notes, capture, admit, permission, canUpdate });
  function uninitialize() { memory.loaded = null; memory.editions.clear(); }
  function noteInput(patch: Partial<OperationsBoardEditionSaveNoteInput> = {}): OperationsBoardEditionSaveNoteInput { return { ...base, operationId, editionId: current.id, parentAsin: parent, note: "SYNTHETIC 用户备注\n完整正文", expectedEditionVersion: current.version, expectedSourceHash: current.sourceHash, expectedNoteVersion: 0, ...patch }; }
  async function execution(action: "initialize" | "publishRevision" = "initialize", id = operationId): Promise<OperationsBoardEditionExecuteInput> {
    const input: OperationsBoardEditionPreviewInput = { ...base, action, originalEditionId: action === "initialize" ? null : old.id }, preview = await repository.preview(context(controls.role), input);
    if (!preview.previewKey || !preview.sourceHash) throw Error("Fixture requires an available source preview");
    return { ...input, operationId: id, expectedStateVersion: preview.state.version, expectedSourceHash: preview.sourceHash, expectedPreviewKey: preview.previewKey };
  }
  return { repository, controls, tx, sqlCalls, transactionEvents, database, authorize, authorizeCapture, store, load, get, initialize, publishRevision, refreshExisting, directForUser, partners,
    journal, journalRead, finalized, cancelled, noteSave, notes, capture, admit, canUpdate, permission, current, old, noteInput, execution, uninitialize,
    memory: () => memory, overrideSql: (override: typeof sqlOverride) => { sqlOverride = override; } };
}

describe("board facade complete authorized reads and explicit lifecycle", () => {
  it("returns only authorized rows and notes with complete per-source visible counts, never the private capture", async () => {
    const f = fixture(); f.controls.role = "ops_specialist"; f.controls.invisibleParents.add(hiddenParent);
    f.memory().notes.set(`501:${hiddenParent}`, { editionId: 501, parentAsin: hiddenParent, note: "SYNTHETIC_PRIVATE_NOTE", version: 1, updatedBy: 4, updatedAt: stamp, canEdit: false, editBasis: "readonly" });
    const result = await f.repository.read(context("ops_specialist"), { ...base, editionId: null });
    expect(result.rows).toHaveLength(2); expect(result.rows.every(row => row.parentAsin === parent)).toBe(true);
    expect(result.coverage).toEqual({ complete: true, meaning: "all_currently_authorized_edition_rows", rowCount: 2 });
    expect(result.sources.map(source => [source.month, source.rowCount])).toEqual([["2026-09", 1], ["2026-10", 1]]);
    expect(result.notes.map(note => note.parentAsin)).toEqual([parent]);
    const serialized = JSON.stringify(result);
    for (const secret of ["SYNTHETIC_PRIVATE_NOTE", "SYNTHETIC_PRIVATE_RAW", "SYNTHETIC_PRIVATE_TITLE", "SYNTHETIC_PRIVATE_FILENAME", "scannedBatches", "selectionRule", '"capture"']) expect(serialized).not.toContain(secret);
    expect(f.sqlCalls.find(call => call.sql.includes("ops_board_notes"))?.params).toEqual([7, 501, parent]);
    expect(f.noteSave).not.toHaveBeenCalled(); expect(f.initialize).not.toHaveBeenCalled(); expect(f.refreshExisting).not.toHaveBeenCalled();
  });
  it("read, state and history use read-only store paths and never initialize, refresh or repair missing editions", async () => {
    const f = fixture(); f.uninitialize();
    expect((await f.repository.state(context(), base)).state.status).toBe("uninitialized");
    expect((await f.repository.read(context(), { ...base, editionId: null })).status).toBe("uninitialized");
    expect((await f.repository.history(context(), { ...base, cursor: null, limit: 10 })).items).toEqual([]);
    expect(f.store.mock.calls.every(([input]) => input.readOnly === true)).toBe(true);
    expect(f.initialize).not.toHaveBeenCalled(); expect(f.publishRevision).not.toHaveBeenCalled(); expect(f.refreshExisting).not.toHaveBeenCalled(); expect(f.noteSave).not.toHaveBeenCalled(); expect(f.journal).not.toHaveBeenCalled();
  });
  it("explicit administrator initialization targets only the latest confirmed month with older rows inside one capture", async () => {
    const f = fixture(); f.uninitialize(); const input = await f.execution();
    expect(f.capture.mock.calls[0][1].month).toBe("9999-12");
    expect(f.initialize).not.toHaveBeenCalled(); const result = await f.repository.execute(context(), input);
    expect(result.status).toBe("committed"); expect(result.editionId).toBe(1001); expect(f.memory().editions.size).toBe(1);
    expect(f.memory().loaded?.currentEdition.month).toBe("2026-10"); expect(f.memory().loaded?.currentEdition.capture.sources.map(source => source.month)).toEqual(["2026-09", "2026-10"]);
    expect(f.initialize.mock.calls[0][2]).toEqual({ stateVersion: 0, currentEditionId: null, sourceHash: null });
    expect(f.authorize.mock.calls.every(([, input]) => input.operation === "create" && input.write === true)).toBe(true);
  });
  it.each(["ops_manager", "ops_specialist"])("does not use an explicit %s preview as an administrator approval", async role => {
    const f = fixture(); f.controls.role = role; f.uninitialize();
    await expect(f.repository.preview(context(role), { ...base, action: "initialize", originalEditionId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.capture).not.toHaveBeenCalled(); expect(f.initialize).not.toHaveBeenCalled();
  });
  it("preview is metadata-only and source changes invalidate its explicit execute CAS", async () => {
    const f = fixture(); f.uninitialize(); const input = await f.execution();
    const preview = await f.repository.preview(context(), { ...base, action: "initialize", originalEditionId: null });
    expect(preview).toMatchObject({ targetMonth: "2026-10", sourceRowCount: 4, effects: { createsPastEditions: false, copiesNotes: false, preservesOriginal: true, movesCurrent: true } });
    expect(JSON.stringify(preview)).not.toMatch(/SYNTHETIC_PRIVATE|"rows"|"capture"|scannedBatches/u);
    f.controls.sourceMarker = "v2"; await expect(f.repository.execute(context(), input)).rejects.toMatchObject({ code: "CONFLICT", message: "OPERATIONS_BOARD_PREVIEW_CONFLICT" });
    expect(f.initialize).not.toHaveBeenCalled(); expect(f.finalized).not.toHaveBeenCalled();
  });
  it("publishes an administrator historical revision without moving current or mutating the original", async () => {
    const f = fixture(), beforeCurrent = clone(f.memory().loaded!.currentEdition), beforeOriginal = clone(f.memory().editions.get(499)); const input = await f.execution("publishRevision");
    expect(f.capture.mock.calls[0][1].month).toBe("2026-09");
    const result = await f.repository.execute(context(), input); expect(result).toMatchObject({ action: "publishRevision", status: "committed", editionId: 1002, stateVersion: 5 });
    expect(f.memory().loaded?.state.currentEditionId).toBe(501); expect(f.memory().loaded?.currentEdition).toEqual(beforeCurrent); expect(f.memory().editions.get(499)).toEqual(beforeOriginal);
    expect(f.memory().editions.get(1002)).toMatchObject({ kind: "revision", status: "archived", revision: 2, originalEditionId: 499 }); expect(f.memory().notes.size).toBe(0);
  });
  it("disabled writes never start a new edition or note, but ordinary reads remain available", async () => {
    const f = fixture(); const note = f.noteInput(); f.controls.enabled = false;
    await expect(f.repository.saveNote(context(), note)).rejects.toThrow("WRITES_NOT_ENABLED"); expect(f.noteSave).not.toHaveBeenCalled();
    expect((await f.repository.read(context(), { ...base, editionId: null })).notes.every(value => !value.canEdit)).toBe(true);
    f.uninitialize(); const preview = await f.repository.preview(context(), { ...base, action: "initialize", originalEditionId: null });
    expect(preview.capability).toEqual({ available: false, reasonCode: "writes_not_enabled" }); expect(f.initialize).not.toHaveBeenCalled(); expect(f.finalized).not.toHaveBeenCalled();
    const input = await f.execution(); await expect(f.repository.execute(context(), input)).rejects.toThrow("WRITES_NOT_ENABLED"); expect(f.initialize).not.toHaveBeenCalled();
  });
});

describe("durable UUID orchestration, unknown acknowledgement and transaction boundary", () => {
  it("all note business writes and final receipt use the same current executor and transaction", async () => {
    const f = fixture(); const input = f.noteInput(), receipt = await f.repository.saveNote(context(), input);
    expect(receipt).toMatchObject({ action: "saveNote", status: "committed", parentAsin: parent, noteVersion: 1, editionVersion: 3, stateVersion: 5 });
    expect(f.notes.mock.calls[0][0].tx).toBe(f.tx); expect(f.journal.mock.calls[0][0]).toBe(f.tx); expect(f.admit.mock.calls[0][0]).toBe(f.tx);
    expect(f.transactionEvents).toEqual(["begin", "commit"]); expect(JSON.stringify(receipt)).not.toContain(input.note);
  });
  it("a lost commit acknowledgement returns unknown and same-UUID check discovers the one committed note without another write", async () => {
    const f = fixture(); f.controls.loseAck = true; const result = await f.repository.saveNote(context(), f.noteInput());
    expect(result).toMatchObject({ operationId, status: "unknown", reasonCode: "outcome_unknown_check_same_operation", noteVersion: null });
    expect(f.memory().loaded?.state.version).toBe(5); expect(f.memory().receipts.size).toBe(1);
    f.controls.enabled = false; const recovered = await f.repository.recover(context(), { ...base, operationId, decision: "check" });
    expect(recovered).toMatchObject({ status: "committed", operationId, noteVersion: 1 }); expect(f.noteSave).toHaveBeenCalledTimes(1); expect(f.finalized).toHaveBeenCalledTimes(1);
    expect(f.authorize.mock.calls.at(-1)?.[1]).toMatchObject({ operation: "read", write: true });
  });
  it("same logical UUID replay returns the existing receipt before any current-source reconstruction even when disabled", async () => {
    const f = fixture(); f.uninitialize(); const input = await f.execution(), receipt = await f.repository.execute(context(), input), captures = f.capture.mock.calls.length;
    f.controls.enabled = false; f.controls.sourceMarker = "different-now";
    expect(await f.repository.execute(context(), input)).toEqual(receipt); expect(f.capture).toHaveBeenCalledTimes(captures); expect(f.initialize).toHaveBeenCalledTimes(1);
  });
  it.each(["payload", "action", "scope"])("does not reuse a committed UUID with different %s", async kind => {
    const f = fixture(); const note = f.noteInput(); await f.repository.saveNote(context(), note);
    if (kind === "payload") await expect(f.repository.saveNote(context(), { ...note, note: "other content" })).rejects.toMatchObject({ code: "CONFLICT" });
    if (kind === "scope") await expect(f.repository.saveNote(context(), { ...note, scope: { ...note.scope, storeName: "OTHER" } })).rejects.toThrow();
    if (kind === "action") await expect(f.repository.execute(context(), { ...base, operationId, action: "initialize", originalEditionId: null, expectedStateVersion: 0, expectedSourceHash: note.expectedSourceHash, expectedPreviewKey: "f".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.noteSave).toHaveBeenCalledTimes(1); expect(f.initialize).not.toHaveBeenCalled(); expect(f.publishRevision).not.toHaveBeenCalled();
  });
  it("check with no receipt is unknown, never claimed to be failed or automatically resubmitted", async () => {
    const f = fixture(); f.controls.enabled = false;
    expect((await f.repository.recover(context(), { ...base, operationId, decision: "check" })).status).toBe("unknown");
    expect(f.memory().receipts.size).toBe(0); expect(f.noteSave).not.toHaveBeenCalled(); expect(f.finalized).not.toHaveBeenCalled(); expect(f.cancelled).not.toHaveBeenCalled(); expect(f.admit).not.toHaveBeenCalled();
  });
  it("a cancellation fence created while disabled prevents a delayed note execute from starting", async () => {
    const f = fixture(); f.controls.enabled = false;
    const receipt = await f.repository.recover(context(), { ...base, operationId, decision: "cancel" }); expect(receipt.status).toBe("cancelled");
    f.controls.enabled = true; expect(await f.repository.saveNote(context(), f.noteInput())).toEqual(receipt);
    expect(f.noteSave).not.toHaveBeenCalled(); expect(f.admit).not.toHaveBeenCalled(); expect(f.finalized).not.toHaveBeenCalled();
  });
  it("cancelling a committed operation returns its success and does not undo a saved note", async () => {
    const f = fixture(); const receipt = await f.repository.saveNote(context(), f.noteInput()); f.controls.enabled = false;
    expect(await f.repository.recover(context(), { ...base, operationId, decision: "cancel" })).toEqual(receipt); expect(f.cancelled).not.toHaveBeenCalled(); expect(f.memory().notes.size).toBe(1);
  });
  it("a final-journal failure rolls back note, edition and state together and check remains unknown", async () => {
    const f = fixture(), before = clone(f.memory()); f.controls.finalizeError = true;
    expect((await f.repository.saveNote(context(), f.noteInput())).status).toBe("unknown"); expect(f.memory()).toEqual(before); expect(f.transactionEvents).toEqual(["begin", "rollback"]);
    expect((await f.repository.recover(context(), { ...base, operationId, decision: "check" })).status).toBe("unknown"); expect(f.noteSave).toHaveBeenCalledTimes(1);
  });
  it("lost cancellation acknowledgement is recovered using the original UUID without a business write", async () => {
    const f = fixture(); f.controls.enabled = false; f.controls.loseAck = true;
    expect((await f.repository.recover(context(), { ...base, operationId, decision: "cancel" })).status).toBe("unknown");
    expect((await f.repository.recover(context(), { ...base, operationId, decision: "check" })).status).toBe("cancelled"); expect(f.noteSave).not.toHaveBeenCalled(); expect(f.cancelled).toHaveBeenCalledTimes(1);
  });
  it("fresh authorization is required even for an already committed receipt", async () => {
    const f = fixture(); await f.repository.saveNote(context(), f.noteInput()); f.controls.deniedPartners.add(3);
    await expect(f.repository.recover(context(), { ...base, operationId, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.journalRead).toHaveBeenCalledTimes(2);
  });
  it("a different actor cannot recover the original actor's UUID receipt", async () => {
    const f = fixture(); await f.repository.saveNote(context(), f.noteInput());
    const other = context(); other.user = { ...other.user!, id: 4 };
    const recovered = await f.repository.recover(other, { ...base, operationId, decision: "check" });
    expect(recovered).toMatchObject({ identity: { userId: 4, workspaceId: 7 }, status: "unknown" }); expect(f.noteSave).toHaveBeenCalledTimes(1); expect(f.memory().receipts.size).toBe(1);
  });
});

describe("history and fresh identity remain bounded and scope-bound", () => {
  it("history skips unauthorized archives without exposing their hashes and uses visible descending keysets", async () => {
    const f = fixture(); f.controls.role = "ops_specialist";
    const hidden = edition(498, "2026-08", true), older = edition(497, "2026-07", true);
    f.memory().editions.set(hidden.id, hidden); f.memory().editions.set(older.id, older); f.controls.hiddenEditions.add(hidden.sourceHash);
    const first = await f.repository.history(context("ops_specialist"), { ...base, cursor: null, limit: 1 });
    expect(first.items.map(item => item.id)).toEqual([499]); expect(JSON.stringify(first)).not.toContain(hidden.sourceHash);
    expect(first.page.nextCursor?.beforeId).toBe(499);
    const next = await f.repository.history(context("ops_specialist"), { ...base, cursor: first.page.nextCursor, limit: 1 });
    expect(next.items.map(item => item.id)).toEqual([497]); expect(JSON.stringify(next)).not.toContain(hidden.sourceHash); expect(next.page.hasMore).toBe(false);
    expect(f.refreshExisting).not.toHaveBeenCalled(); expect(f.sqlCalls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["role", "owners", "pair", "state"])("a changed %s proof rejects an old history cursor instead of mixing pages", async changed => {
    const f = fixture(); f.memory().editions.set(498, { ...f.old, id: 498 });
    const first = await f.repository.history(context(), { ...base, cursor: null, limit: 1 }); expect(first.page.nextCursor).not.toBeNull();
    if (changed === "role") f.controls.authorization = "e".repeat(64);
    if (changed === "owners") f.controls.ownersFence++;
    if (changed === "pair") f.controls.partnerIds.push(4);
    if (changed === "state") f.memory().loaded!.state.version++;
    await expect(f.repository.history(context(), { ...base, cursor: first.page.nextCursor, limit: 1 })).rejects.toMatchObject({ code: "CONFLICT", message: "OPERATIONS_BOARD_HISTORY_CHANGED" });
  });
  it("stable history pages are descending and do not repeat the last visible edition", async () => {
    const f = fixture(); f.memory().editions.set(498, { ...f.old, id: 498 });
    const first = await f.repository.history(context(), { ...base, cursor: null, limit: 1 }), second = await f.repository.history(context(), { ...base, cursor: first.page.nextCursor, limit: 1 });
    expect(first.items.map(item => item.id)).toEqual([499]); expect(second.items.map(item => item.id)).toEqual([498]); expect(second.page).toEqual({ hasMore: false, nextCursor: null });
  });
  it("a denied direct partner is omitted, but an unverifiable partner read fails closed", async () => {
    const f = fixture(); f.controls.partnerIds.push(4); f.controls.deniedPartners.add(4);
    await f.repository.read(context(), { ...base, editionId: null }); expect(f.authorizeCapture.mock.calls[0][2]?.partnerSessions).toEqual([]);
    f.controls.deniedPartners.clear(); f.controls.partnerReadError = true;
    await expect(f.repository.read(context(), { ...base, editionId: null })).rejects.toThrow("READ_UNAVAILABLE");
  });
  it("read passes only freshly authorized same-transaction direct partners to capture visibility", async () => {
    const f = fixture(); f.controls.partnerIds.push(4); await f.repository.read(context(), { ...base, editionId: null });
    const related = f.authorizeCapture.mock.calls[0][2]?.partnerSessions ?? [];
    expect(related).toHaveLength(1); expect(related[0]).toMatchObject({ identity: { userId: 4, workspaceId: 7 }, operation: "read", write: false }); expect(related[0].tx).toBe(f.tx);
    expect(f.partners.mock.calls).toHaveLength(1);
  });
  it("incomplete history scan budget is explicit, not a truncated complete page", async () => {
    const f = fixture(); f.overrideSql((text, _values, rows) => text.includes("FROM ops_board_editions") ? rows.map(row => ({ ...row, captureBytes: 64 * 1024 * 1024 + 1 })) : rows);
    await expect(f.repository.history(context(), { ...base, cursor: null, limit: 1 })).rejects.toThrow("HISTORY_SCAN_INCOMPLETE");
  });
  it("unexpected or duplicate note SQL rows cannot leak into an otherwise authorized response", async () => {
    const f = fixture(); f.controls.invisibleParents.add(hiddenParent);
    f.overrideSql((text, _values, rows) => text.includes("FROM ops_board_notes") ? [{ workspaceId: 7, editionId: 501, parentAsin: hiddenParent, note: "SYNTHETIC_PRIVATE_NOTE", noteBytes: 22, version: 1, updatedBy: 4, updatedAt: stamp }] : rows);
    await expect(f.repository.read(context(), { ...base, editionId: null })).rejects.toThrow("NOTES_INVALID");
  });
  it.each(["null workspace", "different workspace", "missing actor"])("rejects %s before database access", async kind => {
    const f = fixture(), ctx = context(); if (kind === "null workspace") ctx.workspaceId = null; if (kind === "different workspace") ctx.workspaceId = 8; if (kind === "missing actor") ctx.user = null;
    await expect(f.repository.state(ctx, base)).rejects.toMatchObject({ code: kind === "missing actor" ? "UNAUTHORIZED" : "FORBIDDEN" }); expect(f.database).not.toHaveBeenCalled();
  });
  it("an absent required transaction never becomes an empty board", async () => {
    const f = fixture(); f.controls.database = false; await expect(f.repository.read(context(), { ...base, editionId: null })).rejects.toThrow("TRANSACTION_REQUIRED"); expect(f.authorize).not.toHaveBeenCalled();
  });
  it("invalid scope or UUID is rejected before opening a transaction", async () => {
    const f = fixture(); await expect(f.repository.saveNote(context(), f.noteInput({ operationId: "NOT-A-UUID" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(f.repository.state(context(), { ...base, scope: { ...base.scope, country: "美国" } })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.database).not.toHaveBeenCalled();
  });
  it("separate operation IDs remain independent while keeping all receipts metadata-only", async () => {
    const f = fixture(); await f.repository.recover(context(), { ...base, operationId, decision: "cancel" });
    const result = await f.repository.saveNote(context(), f.noteInput({ operationId: otherOperationId })); expect(result.status).toBe("committed"); expect(f.memory().receipts.size).toBe(2);
    expect([...f.memory().receipts.values()].every(value => !JSON.stringify(value).includes("完整正文"))).toBe(true);
    expect(operationsBoardEditionHash(result)).toMatch(/^[a-f0-9]{64}$/u);
  });
});
