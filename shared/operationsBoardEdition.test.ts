import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "./monthlyFinancialRead";
import {
  OperationsBoardEditionScopeSchema, OperationsBoardEditionCaptureSchema, OperationsBoardEditionSchema,
  OperationsBoardEditionStateSchema, OperationsBoardEditionStateResultSchema, OperationsBoardEditionNoteSchema,
  OperationsBoardEditionReadInputSchema, OperationsBoardEditionHistoryInputSchema, OperationsBoardEditionPreviewInputSchema,
  OperationsBoardEditionExecuteInputSchema, OperationsBoardEditionSaveNoteInputSchema, OperationsBoardEditionRecoverInputSchema,
  OperationsBoardEditionReadResultSchema, OperationsBoardEditionHistoryResultSchema, OperationsBoardEditionPreviewResultSchema,
  OperationsBoardEditionWriteResultSchema, operationsBoardEditionCanonical, operationsBoardEditionHash, operationsBoardEditionScopeKey,
  operationsBoardEditionSelectionHash, operationsBoardEditionSourceHash, buildOperationsBoardEditionCapture, operationsBoardEditionPreviewKey,
  operationsBoardEditionRequestHash, assertOperationsBoardEditionState, assertOperationsBoardArchivedEditionUnchanged,
  validateOperationsBoardEditionExecuteAgainstPreview, validateOperationsBoardEditionNoteMutation,
  type OperationsBoardEdition, type OperationsBoardEditionCapture, type OperationsBoardEditionPreviewResult,
  type OperationsBoardEditionReadResult, type OperationsBoardEditionSaveNoteInput, type OperationsBoardEditionNote,
} from "./operationsBoardEdition";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const scope = { workspaceId: 7, storeName: "SYNTHETIC Exact Store", country: "US" };
const requestScope = { storeName: scope.storeName, country: scope.country };
const identity = { userId: 3, workspaceId: 7 };
const base = { expectedWorkspaceId: 7, scope: requestScope };
const operationId = "a7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const stamp = "2026-10-18 08:09:10.123456";
const unknownOrigin = { kind: "unknown", hashBasis: "unknown", sourceRunId: null } as const;
function rows(period = "2026-09", batchId = 41) {
  const payload = [{ yearMonth: period, parentAsin: "SYNTHETIC-PARENT", asin: "SYNTHETIC-CHILD", sku: "SYNTHETIC-SKU", title: "合成产品 <script>not executable</script>", storeName: scope.storeName, site: "美国站", operator: "SYNTHETIC Owner", raw: { currency: "USD", "1:原始说明/完整原文": "合成原文\n保留两行" }, ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, key === "financialProfit" ? -7 : key === "salesQty" ? 0 : null])) }];
  const record: MonthlyFinancialBatchRecord = { id: batchId, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [period], payload, createdAt: stamp, confirmedAt: stamp };
  return parseMonthlyFinancialBatch(record).rows;
}
function capture(period = "2026-09"): OperationsBoardEditionCapture {
  return buildOperationsBoardEditionCapture({ scope, month: "2026-09", scannedBatches: [{ id: 41, recordHash: "b".repeat(64) }], sources: [{ month: period, batchId: 41, recordHash: "b".repeat(64), rowCount: 1, origin: unknownOrigin }], rows: rows(period) });
}

describe("trusted archived batch provenance", () => {
  it.each([
    { kind: "uploaded_file", hashBasis: "original_file_bytes", sourceRunId: null },
    { kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: 31 },
    unknownOrigin,
  ] as const)("keeps a complete server-derived origin %j in both hashes", origin => {
    const value = capture(), previous = value.sourceHash;
    value.sources[0].origin = origin;
    expect(OperationsBoardEditionCaptureSchema.safeParse(resign(value)).success).toBe(true);
    if (origin.kind !== "unknown") expect(value.sourceHash).not.toBe(previous);
  });
  it.each([
    undefined, null,
    { kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: null },
    { kind: "saihu_sync", hashBasis: "original_file_bytes", sourceRunId: 1 },
    { kind: "uploaded_file", hashBasis: "original_file_bytes", sourceRunId: 1 },
    { kind: "uploaded_file", hashBasis: "unknown", sourceRunId: null },
    { kind: "unknown", hashBasis: "unknown", sourceRunId: 1 },
    { kind: "unknown", hashBasis: "mapped_json_bytes", sourceRunId: null },
  ])("does not infer or repair incomplete source origin %j", origin => {
    const value = capture(); (value.sources[0] as unknown as Record<string, unknown>).origin = origin;
    expect(OperationsBoardEditionCaptureSchema.safeParse(value).success).toBe(false);
  });
  it("rejects an origin change without a new server capture proof", () => {
    const value = capture(); value.sources[0].origin = { kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: 31 };
    expect(OperationsBoardEditionCaptureSchema.safeParse(value).success).toBe(false);
  });
  it("rejects conflicting origins for the same batch across historical months", () => {
    const value = capture(), older = { ...rows("2026-08")[0], rowIndex: 1 };
    value.rows.unshift(older); value.sources.unshift({ ...value.sources[0], month: "2026-08", origin: { kind: "uploaded_file", hashBasis: "original_file_bytes", sourceRunId: null } });
    value.coverage.months.unshift("2026-08"); value.coverage.rowCount++;
    expect(OperationsBoardEditionCaptureSchema.safeParse(resign(value)).success).toBe(false);
  });
});
function resign(value: OperationsBoardEditionCapture) {
  value.selectionHash = operationsBoardEditionSelectionHash(value); value.sourceHash = operationsBoardEditionSourceHash(value); return value;
}
function edition(patch: Partial<OperationsBoardEdition> = {}): OperationsBoardEdition {
  const snapshot = capture();
  return { id: 9, scope, month: snapshot.month, revision: 1, version: 4, kind: "original", status: "current", originalEditionId: null, sourceHash: snapshot.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: null, capture: snapshot, ...patch };
}
const state = () => ({ scope, version: 2, currentMonth: "2026-09", currentEditionId: 9, status: "current" as const });
const uninitialized = () => ({ scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" as const });
function summary(value = edition()) { const { capture: _private, ...metadata } = value; return metadata; }
function note(patch: Partial<OperationsBoardEditionNote> = {}): OperationsBoardEditionNote {
  return { editionId: 9, parentAsin: "SYNTHETIC-PARENT", note: "", version: 0, updatedBy: null, updatedAt: null, canEdit: true, editBasis: "responsible", ...patch };
}
function noteInput(): OperationsBoardEditionSaveNoteInput {
  return { ...base, operationId, editionId: 9, parentAsin: "SYNTHETIC-PARENT", note: "合成备注\n保留原文", expectedEditionVersion: 4, expectedSourceHash: capture().sourceHash, expectedNoteVersion: 0 };
}
function preview(): OperationsBoardEditionPreviewResult {
  const value = { identity, scope, request: { ...base, action: "initialize" as const, originalEditionId: null }, state: uninitialized(), original: null, targetMonth: "2026-09", sourceHash: capture().sourceHash, sourceRowCount: 1, capability: { available: true, reasonCode: null }, effects: { movesCurrent: true, preservesOriginal: true as const, copiesNotes: false as const, createsPastEditions: false as const } };
  return { ...value, previewKey: operationsBoardEditionPreviewKey(value) };
}
function execute() { const current = preview(); return { ...current.request, operationId, expectedStateVersion: 0, expectedSourceHash: current.sourceHash!, expectedPreviewKey: current.previewKey! }; }
function read(): OperationsBoardEditionReadResult {
  const original = edition();
  return { identity, scope, request: { ...base, editionId: null }, state: state(), edition: summary(original), status: "ready", reasonCode: null, visibility: "scoped", authorizationHash: "c".repeat(64), rows: original.capture.rows, sources: original.capture.sources, coverage: { complete: true, meaning: "all_currently_authorized_edition_rows", rowCount: 1 }, notes: [note()], viewKey: "d".repeat(64),
    ownership: { version: 1, meaning: "current_authorization_not_historical_membership", visibility: "scoped", operators: [{ userId: 3, displayName: "Current user", relation: "self" }],
      parents: [{ parentAsin: "SYNTHETIC-PARENT", operatorIds: [3], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: "2026-09" }], selectedOperatorId: null } };
}

describe("exact policy-bound requests", () => {
  const cases = [
    ["read", OperationsBoardEditionReadInputSchema, { ...base, editionId: null }],
    ["history", OperationsBoardEditionHistoryInputSchema, { ...base, cursor: null, limit: 25 }],
    ["preview", OperationsBoardEditionPreviewInputSchema, { ...base, action: "initialize", originalEditionId: null }],
    ["execute", OperationsBoardEditionExecuteInputSchema, execute()],
    ["note", OperationsBoardEditionSaveNoteInputSchema, noteInput()],
    ["recover", OperationsBoardEditionRecoverInputSchema, { ...base, operationId, decision: "check" }],
  ] as const;
  it.each(cases)("accepts exact %s input without rewriting it", (_name, schema, value) => { expect(schema.parse(value)).toEqual(value); });
  it("accepts numeric-only operator filtering without accepting partner or name authority", () => {
    expect(OperationsBoardEditionReadInputSchema.parse({ ...base, editionId: null, operatorId: 4 }).operatorId).toBe(4);
    for (const operatorId of ["4", "External A", 0, null, -1, 1.5, 2147483648]) expect(OperationsBoardEditionReadInputSchema.safeParse({ ...base, editionId: null, operatorId }).success).toBe(false);
  });
  it.each(cases)("rejects caller source, authority and pagination-as-capture on %s", (_name, schema, value) => {
    for (const extra of [{ rows: [] }, { capture: capture() }, { userId: 8 }, { role: "admin" }, { canEdit: true }, { partnerId: 8 }, { sourceHash: "a".repeat(64) }, { force: true }]) expect(schema.safeParse({ ...value, ...extra }).success).toBe(false);
    expect(schema.safeParse({ ...value, scope: { ...requestScope, parentAsin: "OTHER" } }).success).toBe(false);
  });
  it("requires canonical country and exact untrimmed store identity", () => {
    for (const country of ["美国", "us", "GB", " US", "US "]) expect(OperationsBoardEditionScopeSchema.safeParse({ ...scope, country }).success).toBe(false);
    expect(OperationsBoardEditionScopeSchema.parse({ ...scope, country: "UK" }).country).toBe("UK");
    expect(OperationsBoardEditionScopeSchema.safeParse({ ...scope, storeName: " Exact Store " }).success).toBe(false);
    expect(operationsBoardEditionScopeKey(scope)).toMatch(/^[a-f0-9]{64}$/u);
    expect(operationsBoardEditionScopeKey(scope)).toBe(operationsBoardEditionHash(scope));
    expect(operationsBoardEditionScopeKey(scope)).not.toBe(operationsBoardEditionScopeKey({ ...scope, storeName: scope.storeName.toLowerCase() }));
  });
  it.each(["bad", operationId.toUpperCase(), ` ${operationId}`, `${operationId} `])("rejects noncanonical UUID %s", value => {
    for (const [schema, input] of [[OperationsBoardEditionExecuteInputSchema, execute()], [OperationsBoardEditionSaveNoteInputSchema, noteInput()], [OperationsBoardEditionRecoverInputSchema, { ...base, operationId, decision: "cancel" }]] as const) expect(schema.safeParse({ ...input, operationId: value }).success).toBe(false);
  });
  it("accepts clear and exactly 3000 characters without trimming source notes", () => {
    for (const note of ["", "\n  合成备注  \n", "中".repeat(3000)]) expect(OperationsBoardEditionSaveNoteInputSchema.parse({ ...noteInput(), note }).note).toBe(note);
    expect(OperationsBoardEditionSaveNoteInputSchema.safeParse({ ...noteInput(), note: "中".repeat(3001) }).success).toBe(false);
  });
  it("does not turn missing or malformed revisions into an initialization", () => {
    expect(OperationsBoardEditionPreviewInputSchema.safeParse({ ...base, action: "publishRevision", originalEditionId: null }).success).toBe(false);
    expect(OperationsBoardEditionPreviewInputSchema.safeParse({ ...base, action: "initialize", originalEditionId: 9 }).success).toBe(false);
    expect(OperationsBoardEditionPreviewInputSchema.parse({ ...base, action: "publishRevision", originalEditionId: 9 }).originalEditionId).toBe(9);
  });
});

describe("complete immutable financial source captures", () => {
  it("keeps actual parsed raw rows, negative/zero/null metrics and complete details", () => {
    const value = capture(); expect(OperationsBoardEditionCaptureSchema.parse(value)).toEqual(value);
    expect(value.rows[0].metrics).toMatchObject({ financialProfit: -7, salesQty: 0, salesAmount: null });
    expect(value.rows[0].raw["1:原始说明/完整原文"]).toContain("\n");
  });
  it("preserves repeated business identities when physical original row references differ", () => {
    const original = capture(), second = clone(original.rows[0]); second.rowIndex = 1;
    original.rows.push(second); original.sources[0].rowCount = 2; original.coverage.rowCount = 2;
    const checked = OperationsBoardEditionCaptureSchema.parse(resign(original));
    expect(checked.rows.map(row => [row.asin, row.sku, row.rowIndex])).toEqual([["SYNTHETIC-CHILD", "SYNTHETIC-SKU", 0], ["SYNTHETIC-CHILD", "SYNTHETIC-SKU", 1]]);
    expect(checked.coverage.rowCount).toBe(2);
  });
  it("captures more than six months without substituting a page or recent window", () => {
    const all = Array.from({ length: 9 }, (_, index) => rows(`2026-${String(index + 1).padStart(2, "0")}`, 41 + index)).flat();
    const value = buildOperationsBoardEditionCapture({ scope, month: "2026-09", rows: all, scannedBatches: Array.from({ length: 9 }, (_, index) => ({ id: 49 - index, recordHash: "a".repeat(64) })), sources: all.map(row => ({ month: row.yearMonth, batchId: row.batchId, recordHash: "a".repeat(64), rowCount: 1, origin: unknownOrigin })) });
    expect(value.coverage.months).toHaveLength(9); expect(value.rows).toHaveLength(9);
  });
  it.each(["rows", "counts", "month", "scope", "batch", "hash", "candidate order", "candidate duplicate", "source duplicate", "duplicate row", "incomplete"])("rejects %s capture mismatch even after a dishonest rehash", kind => {
    const value = clone(capture());
    if (kind === "rows") value.rows = [];
    if (kind === "counts") value.sources[0].rowCount = 2;
    if (kind === "month") value.rows[0].yearMonth = "2026-10";
    if (kind === "scope") value.rows[0].storeName = "Other Store";
    if (kind === "batch") value.sources[0].batchId = 42;
    if (kind === "hash") value.sources[0].recordHash = "c".repeat(64);
    if (kind === "candidate order") value.scannedBatches.push({ id: 42, recordHash: "c".repeat(64) });
    if (kind === "candidate duplicate") value.scannedBatches.push(value.scannedBatches[0]);
    if (kind === "source duplicate") value.sources.push(value.sources[0]);
    if (kind === "duplicate row") { value.rows.push(value.rows[0]); value.sources[0].rowCount = 2; value.coverage.rowCount = 2; }
    if (kind === "incomplete") (value.coverage as unknown as { complete: boolean }).complete = false;
    expect(OperationsBoardEditionCaptureSchema.safeParse(resign(value)).success).toBe(false);
  });
  it("binds every full row, candidate, source, workspace and exact scope into hashes", () => {
    const original = capture();
    for (const mutate of [(v: OperationsBoardEditionCapture) => { v.rows[0].raw.original = "changed"; }, (v: OperationsBoardEditionCapture) => { v.scope.workspaceId = 8; }, (v: OperationsBoardEditionCapture) => { v.scannedBatches.push({ id: 40, recordHash: "c".repeat(64) }); }]) {
      const changed = clone(original); mutate(changed); expect(OperationsBoardEditionCaptureSchema.safeParse(changed).success).toBe(false);
      resign(changed); expect(changed.sourceHash).not.toBe(original.sourceHash);
    }
  });
  it("rejects scan overflow rather than claiming the first 200 are complete", () => {
    const value = capture(); value.scannedBatches = Array.from({ length: 201 }, (_, index) => ({ id: 241 - index, recordHash: "b".repeat(64) }));
    expect(OperationsBoardEditionCaptureSchema.safeParse(resign(value)).success).toBe(false);
  });
  it("canonicalizes native JSON key order without dropping values", () => {
    expect(operationsBoardEditionHash({ b: 2, a: { y: 1, x: -7 } })).toBe(operationsBoardEditionHash({ a: { x: -7, y: 1 }, b: 2 }));
    expect(operationsBoardEditionHash([1, 2])).not.toBe(operationsBoardEditionHash([2, 1]));
  });
  it.each([undefined, NaN, Infinity, new Date(0), { x: undefined }, { get x() { throw new Error("must not evaluate"); } }, Object.assign([1], { extra: 2 })])("rejects nonplain/lossy JSON %#", value => {
    expect(() => operationsBoardEditionHash(value)).toThrow("JSON_LIMIT");
  });
  it("enforces exact UTF8 budgets and rejects cyclic values", () => {
    expect(() => operationsBoardEditionCanonical("中", 5)).not.toThrow(); expect(() => operationsBoardEditionCanonical("中", 4)).toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => operationsBoardEditionHash(cycle)).toThrow();
  });
});

describe("state, original archives and revisions", () => {
  it("represents current_empty using current-month source absence, not total row count", () => {
    const oldRows = capture("2026-08"), empty = edition({ capture: oldRows, sourceHash: oldRows.sourceHash });
    expect(oldRows.rows).toHaveLength(1);
    expect(() => assertOperationsBoardEditionState({ ...state(), status: "current_empty" }, empty)).not.toThrow();
    expect(() => assertOperationsBoardEditionState(state(), empty)).toThrow("STATE_CAPTURE_MISMATCH");
    expect(() => assertOperationsBoardEditionState({ ...state(), status: "current_empty" }, edition())).toThrow();
  });
  it("initialization is absence, never a fabricated older current edition", () => {
    expect(() => assertOperationsBoardEditionState(uninitialized(), null)).not.toThrow();
    expect(() => assertOperationsBoardEditionState(uninitialized(), edition())).toThrow();
    expect(OperationsBoardEditionStateSchema.safeParse({ ...uninitialized(), currentMonth: "2026-08" }).success).toBe(false);
  });
  it("will not display an immutable archive as current after revocation", () => {
    const archived = edition({ status: "archived", archivedAt: stamp });
    expect(() => assertOperationsBoardEditionState(state(), archived)).toThrow();
    expect(OperationsBoardEditionSchema.parse(archived).status).toBe("archived");
  });
  it("rejects any edit to an archived original, including source or ownership raw text", () => {
    const archived = edition({ status: "archived", archivedAt: stamp }); expect(() => assertOperationsBoardArchivedEditionUnchanged(archived, clone(archived))).not.toThrow();
    for (const patch of [{ version: 5 }, { updatedAt: "2026-10-19 08:09:10.123456" }, { id: 10 }]) expect(() => assertOperationsBoardArchivedEditionUnchanged(archived, { ...archived, ...patch })).toThrow("ARCHIVE_IMMUTABLE");
  });
  it("a separately stored revision requires the original link and never becomes current", () => {
    const revision = edition({ id: 10, kind: "revision", revision: 2, originalEditionId: 9, status: "archived", archivedAt: stamp });
    expect(OperationsBoardEditionSchema.parse(revision)).toEqual(revision);
    for (const patch of [{ originalEditionId: null }, { originalEditionId: 10 }, { status: "current", archivedAt: null }, { revision: 1 }]) expect(OperationsBoardEditionSchema.safeParse({ ...revision, ...patch }).success).toBe(false);
  });
  it.each(["2026-02-30 00:00:00.000000", "2026-09-01 24:00:00.000000", "2026-09-01T00:00:00Z"])("rejects non-calendar or implicit timezone timestamp %s", createdAt => {
    expect(OperationsBoardEditionSchema.safeParse(edition({ createdAt })).success).toBe(false);
  });
});

describe("explicit preview CAS and durable metadata receipts", () => {
  it("binds initialization to latest-source preview with no historical backfill or note copy", () => {
    const value = preview(); expect(OperationsBoardEditionPreviewResultSchema.parse(value)).toEqual(value);
    expect(() => validateOperationsBoardEditionExecuteAgainstPreview(execute(), value)).not.toThrow();
    for (const key of ["copiesNotes", "createsPastEditions"] as const) expect(OperationsBoardEditionPreviewResultSchema.safeParse({ ...value, effects: { ...value.effects, [key]: true } }).success).toBe(false);
  });
  it.each(["expectedStateVersion", "expectedSourceHash", "expectedPreviewKey", "scope"])("rejects stale or foreign %s at execution", key => {
    const input = execute(); const changed = { ...input, [key]: key === "scope" ? { ...requestScope, country: "CA" } : key === "expectedStateVersion" ? 2 : "e".repeat(64) };
    expect(() => validateOperationsBoardEditionExecuteAgainstPreview(changed, preview())).toThrow();
  });
  it("may preview disabled writes without advertising an available mutation", () => {
    const disabled = { ...preview(), capability: { available: false, reasonCode: "not_enabled" } };
    expect(OperationsBoardEditionPreviewResultSchema.parse(disabled).capability.available).toBe(false);
    expect(() => validateOperationsBoardEditionExecuteAgainstPreview(execute(), disabled)).toThrow("PREVIEW_CONFLICT");
    expect(OperationsBoardEditionStateResultSchema.parse({ identity, scope, request: base, state: uninitialized(), capabilities: { initialize: disabled.capability, publishRevision: disabled.capability } }).state.status).toBe("uninitialized");
  });
  it("uses the same logical request hash for recovery without scope/actor reuse", () => {
    const initial = operationsBoardEditionRequestHash(identity, noteInput());
    expect(operationsBoardEditionRequestHash(identity, clone(noteInput()))).toBe(initial);
    expect(operationsBoardEditionRequestHash({ ...identity, userId: 4 }, noteInput())).not.toBe(initial);
    expect(operationsBoardEditionRequestHash(identity, { ...noteInput(), note: "changed" })).not.toBe(initial);
    expect(() => operationsBoardEditionRequestHash({ ...identity, workspaceId: 8 }, noteInput())).toThrow("REQUEST_SCOPE_MISMATCH");
  });
  it("committed note receipts prove CAS versions; unknown and cancelled never claim a business result", () => {
    const receipt = { identity, scope, operationId, action: "saveNote", status: "committed", requestHash: operationsBoardEditionRequestHash(identity, noteInput()), stateVersion: 2, editionId: 9, editionVersion: 4, sourceHash: capture().sourceHash, parentAsin: "SYNTHETIC-PARENT", noteVersion: 1, reasonCode: null };
    expect(OperationsBoardEditionWriteResultSchema.parse(receipt).noteVersion).toBe(1);
    for (const status of ["unknown", "cancelled"] as const) {
      expect(OperationsBoardEditionWriteResultSchema.safeParse({ ...receipt, status }).success).toBe(false);
      expect(OperationsBoardEditionWriteResultSchema.parse({ identity, scope, operationId, action: null, status, requestHash: null, stateVersion: null, editionId: null, editionVersion: null, sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: status === "cancelled" ? "operation_cancelled" : "outcome_unknown_check_same_operation" }).status).toBe(status);
    }
    expect(OperationsBoardEditionWriteResultSchema.safeParse({ ...receipt, action: "initialize" }).success).toBe(false);
  });
});

describe("notes never acquire write authority from a partner or archive", () => {
  const current = () => ({ identity, role: "ops_specialist", responsibleUserIds: [3], edition: edition(), note: note() });
  it.each(["admin", "super_admin", "ops_specialist"])("accepts a fresh eligible %s current note CAS", role => {
    expect(() => validateOperationsBoardEditionNoteMutation(noteInput(), { ...current(), role, responsibleUserIds: role === "ops_specialist" ? [3] : [] })).not.toThrow();
  });
  it.each(["ops_manager", "ops_specialist", "viewer"])("%s cannot inherit partner or financial-manager edit authority", role => {
    expect(() => validateOperationsBoardEditionNoteMutation(noteInput(), { ...current(), role, responsibleUserIds: [4] })).toThrow("NOTE_EDIT_DENIED");
  });
  it("even admin cannot edit frozen notes", () => {
    expect(() => validateOperationsBoardEditionNoteMutation(noteInput(), { ...current(), role: "admin", edition: edition({ status: "archived", archivedAt: stamp }) })).toThrow("NOTE_EDIT_DENIED");
  });
  it.each(["expectedEditionVersion", "expectedSourceHash", "expectedNoteVersion"])("rejects stale %s without discarding the caller's draft", field => {
    const input = { ...noteInput(), [field]: field === "expectedSourceHash" ? "f".repeat(64) : 8 }, before = clone(input);
    expect(() => validateOperationsBoardEditionNoteMutation(input, current())).toThrow("NOTE_VERSION_CONFLICT"); expect(input).toEqual(before);
  });
  it("rejects forged absence/authority and hidden parent notes", () => {
    expect(OperationsBoardEditionNoteSchema.safeParse(note({ note: "hidden", version: 0 })).success).toBe(false);
    expect(OperationsBoardEditionNoteSchema.safeParse(note({ canEdit: true, editBasis: "readonly" })).success).toBe(false);
    expect(() => validateOperationsBoardEditionNoteMutation({ ...noteInput(), parentAsin: "FOREIGN" }, { ...current(), note: note({ parentAsin: "FOREIGN" }) })).toThrow("NOTE_PARENT_NOT_VISIBLE");
  });
});

describe("sanitized full authorized reads and stable archive history", () => {
  it("returns complete authorized original rows and notes but never the private capture", () => {
    const value = read(); expect(OperationsBoardEditionReadResultSchema.parse(value)).toEqual(value);
    expect(OperationsBoardEditionReadResultSchema.safeParse({ ...value, capture: capture() }).success).toBe(false);
    expect(OperationsBoardEditionReadResultSchema.safeParse({ ...value, scannedBatches: capture().scannedBatches }).success).toBe(false);
  });
  it.each(["row missing", "foreign row", "hidden note", "archived edit", "wrong current", "duplicate sources"])("rejects %s", kind => {
    const value = clone(read());
    if (kind === "row missing") value.rows = [];
    if (kind === "foreign row") value.rows[0].storeName = "Other";
    if (kind === "hidden note") value.notes[0].parentAsin = "FOREIGN";
    if (kind === "archived edit") { value.request.editionId = 9; value.edition!.status = "archived"; value.edition!.archivedAt = stamp; }
    if (kind === "wrong current") value.state.currentEditionId = 8;
    if (kind === "duplicate sources") value.sources.push(value.sources[0]);
    expect(OperationsBoardEditionReadResultSchema.safeParse(value).success).toBe(false);
  });
  it("allows an explicitly empty current month retaining older visible history", () => {
    const value = read(), old = capture("2026-08"); value.state.status = "current_empty"; value.status = "current_empty"; value.rows = old.rows; value.sources = old.sources;
    value.ownership!.parents[0].sourceMonth = "2026-08";
    expect(OperationsBoardEditionReadResultSchema.parse(value).rows).toHaveLength(1);
  });
  it("requires visible read ownership and matching numeric selection coverage", () => {
    const value = read(); expect(OperationsBoardEditionReadResultSchema.safeParse({ ...value, ownership: null }).success).toBe(false);
    value.request.operatorId = 3; value.ownership!.selectedOperatorId = 3;
    expect(OperationsBoardEditionReadResultSchema.safeParse(value).success).toBe(false);
    value.coverage.meaning = "all_currently_authorized_edition_rows_matching_operator";
    expect(OperationsBoardEditionReadResultSchema.safeParse(value).success).toBe(true);
    value.request.operatorId = 4; expect(OperationsBoardEditionReadResultSchema.safeParse(value).success).toBe(false);
  });
  it("requires null ownership for an absent or hidden edition", () => {
    const hidden = { ...read(), edition: null, status: "not_found", reasonCode: "edition_not_found", rows: [], sources: [], notes: [], coverage: { complete: true, meaning: "all_currently_authorized_edition_rows", rowCount: 0 } };
    expect(OperationsBoardEditionReadResultSchema.safeParse(hidden).success).toBe(false);
    expect(OperationsBoardEditionReadResultSchema.safeParse({ ...hidden, ownership: null }).success).toBe(true);
  });
  it("requires a consistent descending history cursor and refuses changed history between pages", () => {
    const archived = (id: number) => summary(edition({ id, status: "archived", archivedAt: stamp }));
    const value = { identity, scope, request: { ...base, cursor: null, limit: 2 }, state: state(), historyVersion: "a".repeat(64), items: [archived(8), archived(7)], page: { hasMore: true, nextCursor: { beforeId: 7, historyVersion: "a".repeat(64) } } };
    expect(OperationsBoardEditionHistoryResultSchema.parse(value)).toEqual(value);
    for (const patch of [{ items: [archived(7), archived(8)] }, { items: [] }, { request: { ...value.request, cursor: { beforeId: 9, historyVersion: "b".repeat(64) } } }, { page: { ...value.page, nextCursor: { beforeId: 8, historyVersion: "a".repeat(64) } } }]) {
      expect(() => OperationsBoardEditionHistoryResultSchema.safeParse({ ...value, ...patch })).not.toThrow();
      expect(OperationsBoardEditionHistoryResultSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    }
  });
});
