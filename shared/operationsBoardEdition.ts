import { z } from "zod";
import SHA256 from "crypto-js/sha256";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";
import { MonthlyFinancialBatchMetadataSchema, MonthlyFinancialReadRowSchema, monthlyFinancialJsonBytes, type MonthlyFinancialReadRow } from "./monthlyFinancialRead";

/** Internal captures are complete, pre-authorization source snapshots. They are
 * not accepted by a public mutation and must not be returned to ordinary users. */
export const OPERATIONS_BOARD_EDITION_LIMITS = {
  rows: 60_000, months: 1200, batches: 200, notes: 60_000, noteCharacters: 3000,
  captureBytes: 64 * 1024 * 1024, publicBytes: 12 * 1024 * 1024, historyBytes: 1024 * 1024,
  jsonNodes: 4_000_000, jsonDepth: 28, stringLength: 32768,
} as const;
export const OPERATIONS_BOARD_EDITION_SELECTION_RULE = "newest_completed_batch_per_exact_month_store_country_before_owner_filter" as const;
const id = z.number().int().positive().safe().max(2147483647);
const version = z.number().int().min(0).max(2147483647);
const positiveVersion = version.min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
const month = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u);
const country = text(50).refine(value => normalizeMarketplaceCode(value) === value, "Canonical country required without rewriting identity");
const identity = z.object({ userId: id, workspaceId: id }).strict();
const reason = z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u);
const time = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u).refine(value => {
  const [year, part, day, hour, minute, second] = value.split(/[- :.]/u).slice(0, 6).map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1000 && part >= 1 && part <= 12 && day >= 1 && day <= days[part - 1] && hour <= 23 && minute <= 59 && second <= 59;
});
const issue = (ctx: z.RefinementCtx, message: string) => ctx.addIssue({ code: "custom", message });
export class OperationsBoardEditionError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_EDITION_${code}`); this.name = "OperationsBoardEditionError"; }
}
export function operationsBoardEditionCanonical(value: unknown, maxBytes: number = OPERATIONS_BOARD_EDITION_LIMITS.captureBytes): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > OPERATIONS_BOARD_EDITION_LIMITS.captureBytes) throw new OperationsBoardEditionError("JSON_LIMIT");
  try {
    if (monthlyFinancialJsonBytes(value, OPERATIONS_BOARD_EDITION_LIMITS) > maxBytes) throw new Error();
    const encode = (item: unknown): string => item === null || typeof item !== "object" ? JSON.stringify(item)
      : Array.isArray(item) ? `[${item.map(encode).join(",")}]`
        : `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(",")}}`;
    return encode(value);
  } catch { throw new OperationsBoardEditionError("JSON_LIMIT"); }
}
export function operationsBoardEditionHash(value: unknown, maxBytes?: number): string { return SHA256(operationsBoardEditionCanonical(value, maxBytes)).toString(); }
function bounded(maxBytes: number) {
  return z.unknown().superRefine((value, ctx) => { try { operationsBoardEditionCanonical(value, maxBytes); } catch { issue(ctx, "Complete bounded plain JSON required"); } });
}
const same = (a: unknown, b: unknown) => operationsBoardEditionCanonical(a) === operationsBoardEditionCanonical(b);
const requestScope = z.object({ storeName: text(200), country }).strict();
export const OperationsBoardEditionScopeSchema = requestScope.extend({ workspaceId: id }).strict();
export type OperationsBoardEditionScope = z.infer<typeof OperationsBoardEditionScopeSchema>;
export function operationsBoardEditionScopeKey(scope: OperationsBoardEditionScope): string { return operationsBoardEditionHash(OperationsBoardEditionScopeSchema.parse(scope)); }
const baseInput = { expectedWorkspaceId: id, scope: requestScope };
export const OperationsBoardEditionStateInputSchema = z.object(baseInput).strict();
export type OperationsBoardEditionStateInput = z.infer<typeof OperationsBoardEditionStateInputSchema>;
export const OperationsBoardEditionReadInputSchema = z.object({ ...baseInput, editionId: id.nullable() }).strict();
export type OperationsBoardEditionReadInput = z.infer<typeof OperationsBoardEditionReadInputSchema>;
export const OperationsBoardEditionHistoryCursorSchema = z.object({ beforeId: id, historyVersion: hash }).strict();
export const OperationsBoardEditionHistoryInputSchema = z.object({ ...baseInput, cursor: OperationsBoardEditionHistoryCursorSchema.nullable(), limit: z.number().int().min(1).max(50) }).strict();
export type OperationsBoardEditionHistoryInput = z.infer<typeof OperationsBoardEditionHistoryInputSchema>;
const actionFields = { ...baseInput, action: z.enum(["initialize", "publishRevision"]), originalEditionId: id.nullable() };
function actionTarget(value: { action: string; originalEditionId: number | null }, ctx: z.RefinementCtx) {
  if ((value.action === "initialize") !== (value.originalEditionId === null)) issue(ctx, "Action/original edition mismatch");
}
export const OperationsBoardEditionPreviewInputSchema = z.object(actionFields).strict().superRefine(actionTarget);
export type OperationsBoardEditionPreviewInput = z.infer<typeof OperationsBoardEditionPreviewInputSchema>;
export const OperationsBoardEditionExecuteInputSchema = z.object({ ...actionFields, operationId: uuid, expectedStateVersion: version, expectedSourceHash: hash, expectedPreviewKey: hash }).strict().superRefine(actionTarget);
export type OperationsBoardEditionExecuteInput = z.infer<typeof OperationsBoardEditionExecuteInputSchema>;
export const OperationsBoardEditionSaveNoteInputSchema = z.object({ ...baseInput, operationId: uuid, editionId: id, parentAsin: text(500), note: z.string().max(3000),
  expectedEditionVersion: positiveVersion, expectedSourceHash: hash, expectedNoteVersion: version }).strict();
export type OperationsBoardEditionSaveNoteInput = z.infer<typeof OperationsBoardEditionSaveNoteInputSchema>;
export const OperationsBoardEditionRecoverInputSchema = z.object({ ...baseInput, operationId: uuid, decision: z.enum(["check", "cancel"]) }).strict();
export type OperationsBoardEditionRecoverInput = z.infer<typeof OperationsBoardEditionRecoverInputSchema>;

// This proof is captured from server-parsed saved batch metadata, never from a
// row's raw.source. It participates in both capture hashes and survives archive
// freezing, so live owner mappings cannot mistake an uploaded file for ERP data.
export const OperationsBoardEditionSourceSchema = z.object({ month, batchId: id, recordHash: hash,
  rowCount: z.number().int().min(1).max(10_000), origin: MonthlyFinancialBatchMetadataSchema.shape.origin,
}).strict().superRefine(({ origin }, ctx) => {
  if (origin.kind === "saihu_sync" ? origin.sourceRunId === null || origin.hashBasis !== "mapped_json_bytes"
    : origin.sourceRunId !== null || origin.hashBasis !== (origin.kind === "uploaded_file" ? "original_file_bytes" : "unknown")) issue(ctx, "Trusted source origin mismatch");
});
export type OperationsBoardEditionSource = z.infer<typeof OperationsBoardEditionSourceSchema>;
const scanSchema = z.object({ id, recordHash: hash }).strict();
const captureFields = {
  version: z.literal(1), scope: OperationsBoardEditionScopeSchema, month,
  selectionRule: z.literal(OPERATIONS_BOARD_EDITION_SELECTION_RULE), scannedBatches: z.array(scanSchema).max(200),
  sources: z.array(OperationsBoardEditionSourceSchema).max(1200), rows: z.array(MonthlyFinancialReadRowSchema).max(60_000),
  coverage: z.object({ complete: z.literal(true), kind: z.literal("all_effective_history_through_month"), months: z.array(month).max(1200), rowCount: z.number().int().min(0).max(60_000) }).strict(),
  selectionHash: hash, sourceHash: hash,
};
type CaptureShape = z.infer<z.ZodObject<typeof captureFields>>;
type SelectionProof = Pick<CaptureShape, "scope" | "month" | "selectionRule" | "scannedBatches" | "sources">;
export function operationsBoardEditionSelectionHash(value: SelectionProof): string {
  return operationsBoardEditionHash({ schema: "operations-board-selection/v1", scope: value.scope, month: value.month, selectionRule: value.selectionRule, scannedBatches: value.scannedBatches, sources: value.sources });
}
export function operationsBoardEditionSourceHash(value: { selectionHash: string; rows: MonthlyFinancialReadRow[] }): string {
  return operationsBoardEditionHash({ schema: "operations-board-source/v1", selectionHash: value.selectionHash, rows: value.rows });
}
function validateRows(rows: MonthlyFinancialReadRow[], scope: OperationsBoardEditionScope, through: string, sources: OperationsBoardEditionSource[], ctx: z.RefinementCtx) {
  const selected = new Map(sources.map(source => [source.month, source])), counts = new Map<string, number>(), refs = new Set<string>();
  for (const row of rows) {
    const source = selected.get(row.yearMonth), ref = `${row.batchId}:${row.rowIndex}`;
    if (refs.has(ref)) issue(ctx, "Duplicate original row reference"); refs.add(ref);
    if (row.storeName !== scope.storeName || row.country !== scope.country || normalizeMarketplaceCode(row.site) !== scope.country || row.yearMonth > through || !source || source.batchId !== row.batchId) issue(ctx, "Row is outside exact selected scope");
    // Preserve every original row, including ambiguous/repeated business
    // identities. Only a repeated physical source reference is invalid here.
    counts.set(row.yearMonth, (counts.get(row.yearMonth) ?? 0) + 1);
  }
  if (sources.some(source => counts.get(source.month) !== source.rowCount)) issue(ctx, "Source count is not the complete supplied row set");
}
/** Validates a server-captured proof, not the truth of arbitrary client hashes.
 * The repository must scan the full fixed candidate set in one transaction. */
export const OperationsBoardEditionCaptureSchema = bounded(OPERATIONS_BOARD_EDITION_LIMITS.captureBytes).pipe(z.object(captureFields).strict().superRefine((value, ctx) => {
  const scanned = new Map(value.scannedBatches.map(item => [item.id, item.recordHash]));
  const origins = new Map<number, string>();
  for (const source of value.sources) {
    const origin = operationsBoardEditionCanonical(source.origin);
    if (origins.has(source.batchId) && origins.get(source.batchId) !== origin) issue(ctx, "One saved batch cannot have conflicting source origins");
    origins.set(source.batchId, origin);
  }
  if (scanned.size !== value.scannedBatches.length || value.scannedBatches.some((item, index) => index > 0 && item.id >= value.scannedBatches[index - 1].id)) issue(ctx, "Candidate scan must be complete, unique and descending");
  if (value.sources.some((source, index) => source.month > value.month || index > 0 && source.month <= value.sources[index - 1].month || scanned.get(source.batchId) !== source.recordHash)) issue(ctx, "Selection has no matching fixed candidate proof");
  if (value.coverage.rowCount !== value.rows.length || !same(value.coverage.months, value.sources.map(source => source.month))) issue(ctx, "Full capture coverage mismatch");
  validateRows(value.rows, value.scope, value.month, value.sources, ctx);
  if (value.selectionHash !== operationsBoardEditionSelectionHash(value) || value.sourceHash !== operationsBoardEditionSourceHash(value)) issue(ctx, "Capture content hash mismatch");
}));
export type OperationsBoardEditionCapture = z.infer<typeof OperationsBoardEditionCaptureSchema>;
export function buildOperationsBoardEditionCapture(value: Pick<OperationsBoardEditionCapture, "scope" | "month" | "scannedBatches" | "sources" | "rows">): OperationsBoardEditionCapture {
  const proof = { ...value, selectionRule: OPERATIONS_BOARD_EDITION_SELECTION_RULE }, selectionHash = operationsBoardEditionSelectionHash(proof);
  return OperationsBoardEditionCaptureSchema.parse({ ...proof, version: 1, coverage: { complete: true, kind: "all_effective_history_through_month", months: value.sources.map(source => source.month), rowCount: value.rows.length }, selectionHash, sourceHash: operationsBoardEditionSourceHash({ selectionHash, rows: value.rows }) });
}
const editionFields = { id, scope: OperationsBoardEditionScopeSchema, month, revision: positiveVersion, version: positiveVersion, kind: z.enum(["original", "revision"]),
  status: z.enum(["current", "archived"]), originalEditionId: id.nullable(), sourceHash: hash, createdAt: time, updatedAt: time, archivedAt: time.nullable() };
type EditionMetadata = z.infer<z.ZodObject<typeof editionFields>>;
function validateEdition(value: EditionMetadata, ctx: z.RefinementCtx) {
  if (value.createdAt > value.updatedAt || (value.status === "current") !== (value.archivedAt === null) || value.archivedAt !== null && value.archivedAt < value.createdAt) issue(ctx, "Edition timestamps/status mismatch");
  if (value.kind === "original" ? value.originalEditionId !== null || value.revision !== 1 : value.originalEditionId === null || value.originalEditionId === value.id || value.revision < 2 || value.status !== "archived") issue(ctx, "Immutable original/revision identity mismatch");
}
export const OperationsBoardEditionSummarySchema = z.object(editionFields).strict().superRefine(validateEdition);
export type OperationsBoardEditionSummary = z.infer<typeof OperationsBoardEditionSummarySchema>;
export const OperationsBoardEditionSchema = bounded(OPERATIONS_BOARD_EDITION_LIMITS.captureBytes).pipe(z.object({ ...editionFields, capture: OperationsBoardEditionCaptureSchema }).strict().superRefine((value, ctx) => {
  validateEdition(value, ctx);
  if (!same(value.scope, value.capture.scope) || value.month !== value.capture.month || value.sourceHash !== value.capture.sourceHash) issue(ctx, "Edition capture identity mismatch");
}));
export type OperationsBoardEdition = z.infer<typeof OperationsBoardEditionSchema>;
export const OperationsBoardEditionStateSchema = z.object({ scope: OperationsBoardEditionScopeSchema, version, currentMonth: month.nullable(), currentEditionId: id.nullable(), status: z.enum(["uninitialized", "current", "current_empty"]) }).strict().superRefine((value, ctx) => {
  if (value.status === "uninitialized" ? value.version !== 0 || value.currentMonth !== null || value.currentEditionId !== null : value.version === 0 || value.currentMonth === null || value.currentEditionId === null) issue(ctx, "State pointer mismatch; empty is not an archived fallback");
});
export type OperationsBoardEditionState = z.infer<typeof OperationsBoardEditionStateSchema>;
export function assertOperationsBoardEditionState(state: OperationsBoardEditionState, edition: OperationsBoardEdition | null): void {
  const checked = OperationsBoardEditionStateSchema.parse(state), saved = edition === null ? null : OperationsBoardEditionSchema.parse(edition);
  if (checked.status === "uninitialized" ? saved !== null : saved === null || saved.id !== checked.currentEditionId || saved.month !== checked.currentMonth || saved.status !== "current" || !same(saved.scope, checked.scope)
    || (checked.status === "current_empty") !== !saved.capture.sources.some(source => source.month === checked.currentMonth)) throw new OperationsBoardEditionError("STATE_CAPTURE_MISMATCH");
}
export function assertOperationsBoardArchivedEditionUnchanged(previous: OperationsBoardEdition, next: OperationsBoardEdition): void {
  const before = OperationsBoardEditionSchema.parse(previous), after = OperationsBoardEditionSchema.parse(next);
  if (before.status !== "archived" || !same(before, after)) throw new OperationsBoardEditionError("ARCHIVE_IMMUTABLE");
}
const capability = z.object({ available: z.boolean(), reasonCode: reason.nullable() }).strict().superRefine((value, ctx) => {
  if (value.available !== (value.reasonCode === null)) issue(ctx, "Capability/reason mismatch");
});
export const OperationsBoardEditionNoteSchema = z.object({ editionId: id, parentAsin: text(500), note: z.string().max(3000), version,
  updatedBy: id.nullable(), updatedAt: time.nullable(), canEdit: z.boolean(), editBasis: z.enum(["admin", "responsible", "readonly"]) }).strict().superRefine((value, ctx) => {
  if (value.canEdit !== (value.editBasis !== "readonly") || (value.version === 0 ? value.note !== "" || value.updatedBy !== null || value.updatedAt !== null : value.updatedBy === null || value.updatedAt === null)) issue(ctx, "Note version/edit evidence mismatch");
});
export type OperationsBoardEditionNote = z.infer<typeof OperationsBoardEditionNoteSchema>;
const scopedResponse = { identity, scope: OperationsBoardEditionScopeSchema };
function bindResponse(value: { identity: { workspaceId: number }; scope: OperationsBoardEditionScope; request: OperationsBoardEditionStateInput }, ctx: z.RefinementCtx) {
  if (value.identity.workspaceId !== value.scope.workspaceId || value.request.expectedWorkspaceId !== value.scope.workspaceId || value.request.scope.storeName !== value.scope.storeName || value.request.scope.country !== value.scope.country) issue(ctx, "Response identity/request scope mismatch");
}
export const OperationsBoardEditionStateResultSchema = z.object({ ...scopedResponse, request: OperationsBoardEditionStateInputSchema, state: OperationsBoardEditionStateSchema,
  capabilities: z.object({ initialize: capability, publishRevision: capability }).strict() }).strict().superRefine((value, ctx) => {
  bindResponse(value, ctx); if (!same(value.state.scope, value.scope) || value.state.status !== "uninitialized" && value.capabilities.initialize.available) issue(ctx, "State initialization scope mismatch");
});
export type OperationsBoardEditionStateResult = z.infer<typeof OperationsBoardEditionStateResultSchema>;

/** All currently authorized rows, not the full private capture. No file names,
 * uploader fields, hidden raw rows or complete scan directory are returned. */
export const OperationsBoardEditionReadResultSchema = bounded(OPERATIONS_BOARD_EDITION_LIMITS.publicBytes).pipe(z.object({ ...scopedResponse, request: OperationsBoardEditionReadInputSchema,
  state: OperationsBoardEditionStateSchema, edition: OperationsBoardEditionSummarySchema.nullable(), status: z.enum(["ready", "current_empty", "uninitialized", "not_found", "unavailable"]), reasonCode: reason.nullable(),
  visibility: z.enum(["full", "scoped"]), authorizationHash: hash, rows: z.array(MonthlyFinancialReadRowSchema).max(60_000), sources: z.array(OperationsBoardEditionSourceSchema).max(1200),
  coverage: z.object({ complete: z.literal(true), meaning: z.literal("all_currently_authorized_edition_rows"), rowCount: z.number().int().min(0).max(60_000) }).strict(),
  notes: z.array(OperationsBoardEditionNoteSchema).max(60_000), viewKey: hash,
}).strict().superRefine((value, ctx) => {
  bindResponse(value, ctx); if (!same(value.scope, value.state.scope)) issue(ctx, "Read state scope mismatch");
  const ready = value.status === "ready" || value.status === "current_empty";
  if (ready ? !value.edition || value.reasonCode !== null : value.edition !== null || value.rows.length > 0 || value.sources.length > 0 || value.notes.length > 0 || value.reasonCode === null) issue(ctx, "Read availability mismatch");
  if (value.coverage.rowCount !== value.rows.length) issue(ctx, "Authorized rows must be complete");
  if (value.sources.some((source, index) => index > 0 && source.month <= value.sources[index - 1].month)) issue(ctx, "Visible sources must be unique and chronologically ordered");
  if (!value.edition) return;
  const edition = value.edition;
  if (!same(edition.scope, value.scope) || (value.request.editionId === null ? edition.id !== value.state.currentEditionId || edition.status !== "current" : edition.id !== value.request.editionId)) issue(ctx, "Read edition scope/pointer mismatch");
  if (value.status === "current_empty" && (edition.status !== "current" || value.state.status !== "current_empty" || value.sources.some(source => source.month === edition.month))) issue(ctx, "Empty current cannot masquerade as a historical edition");
  if (edition.status === "current" && value.state.status === "current_empty" && value.status !== "current_empty") issue(ctx, "Current empty must be explicit");
  validateRows(value.rows, value.scope, edition.month, value.sources, ctx);
  const parents = new Set(value.rows.filter(row => row.parentAsin && ["child", "parent_only"].includes(row.allocation)).map(row => row.parentAsin));
  if (new Set(value.notes.map(note => note.parentAsin)).size !== value.notes.length || value.notes.some(note => note.editionId !== edition.id || !parents.has(note.parentAsin) || edition.status === "archived" && note.canEdit)) issue(ctx, "Note outside authorized edition or archived write grant");
}));
export type OperationsBoardEditionReadResult = z.infer<typeof OperationsBoardEditionReadResultSchema>;
export const OperationsBoardEditionHistoryResultSchema = bounded(OPERATIONS_BOARD_EDITION_LIMITS.historyBytes).pipe(z.object({ ...scopedResponse, request: OperationsBoardEditionHistoryInputSchema,
  state: OperationsBoardEditionStateSchema, historyVersion: hash, items: z.array(OperationsBoardEditionSummarySchema).max(50),
  page: z.object({ nextCursor: OperationsBoardEditionHistoryCursorSchema.nullable(), hasMore: z.boolean() }).strict(),
}).strict().superRefine((value, ctx) => {
  bindResponse(value, ctx);
  if (!same(value.state.scope, value.scope) || value.request.cursor !== null && value.request.cursor.historyVersion !== value.historyVersion) issue(ctx, "History changed; pages cannot be mixed");
  const last = value.items.at(-1);
  if (value.items.length > value.request.limit || value.page.hasMore && value.items.length !== value.request.limit
    || value.page.hasMore && (!last || value.page.nextCursor?.beforeId !== last.id || value.page.nextCursor.historyVersion !== value.historyVersion)
    || !value.page.hasMore && value.page.nextCursor !== null) issue(ctx, "History keyset continuation mismatch");
  if (value.items.some((item, index) => item.status !== "archived" || !same(item.scope, value.scope) || index > 0 && item.id >= value.items[index - 1].id || value.request.cursor !== null && item.id >= value.request.cursor.beforeId)) issue(ctx, "History is not exact-scope immutable descending editions");
}));
export type OperationsBoardEditionHistoryResult = z.infer<typeof OperationsBoardEditionHistoryResultSchema>;

const previewFields = { ...scopedResponse, request: OperationsBoardEditionPreviewInputSchema, state: OperationsBoardEditionStateSchema,
  original: OperationsBoardEditionSummarySchema.nullable(), targetMonth: month.nullable(), sourceHash: hash.nullable(), sourceRowCount: z.number().int().min(0).max(60_000).nullable(),
  previewKey: hash.nullable(), capability, effects: z.object({ movesCurrent: z.boolean(), preservesOriginal: z.literal(true), copiesNotes: z.literal(false), createsPastEditions: z.literal(false) }).strict() };
export function operationsBoardEditionPreviewKey(value: { identity: z.infer<typeof identity>; request: OperationsBoardEditionPreviewInput; state: OperationsBoardEditionState; original: OperationsBoardEditionSummary | null; targetMonth: string; sourceHash: string }): string {
  return operationsBoardEditionHash({ schema: "operations-board-preview/v1", identity: value.identity, request: value.request, state: value.state, original: value.original, targetMonth: value.targetMonth, sourceHash: value.sourceHash });
}
export const OperationsBoardEditionPreviewResultSchema = z.object(previewFields).strict().superRefine((value, ctx) => {
  bindResponse(value, ctx); if (!same(value.state.scope, value.scope)) issue(ctx, "Preview state scope mismatch");
  if (value.effects.movesCurrent !== (value.request.action === "initialize")) issue(ctx, "A revision must not move current");
  if (value.request.action === "initialize" ? value.original !== null : value.original !== null && (value.original.id !== value.request.originalEditionId || value.original.kind !== "original" || value.original.status !== "archived" || !same(value.original.scope, value.scope))) issue(ctx, "Revision must bind the immutable original");
  const complete = value.targetMonth !== null && value.sourceHash !== null && value.sourceRowCount !== null && value.previewKey !== null;
  if (value.capability.available && (!complete || value.request.action === "initialize" && (value.state.status !== "uninitialized" || value.sourceRowCount === 0) || value.request.action === "publishRevision" && value.original === null)) issue(ctx, "Available mutation needs complete preview evidence");
  if (complete && value.previewKey !== operationsBoardEditionPreviewKey({ ...value, targetMonth: value.targetMonth!, sourceHash: value.sourceHash! })) issue(ctx, "Preview hash mismatch");
  if (value.original !== null && value.targetMonth !== value.original.month) issue(ctx, "Revision cannot change the original month");
});
export type OperationsBoardEditionPreviewResult = z.infer<typeof OperationsBoardEditionPreviewResultSchema>;
export const OperationsBoardEditionWriteResultSchema = z.object({ ...scopedResponse, operationId: uuid, action: z.enum(["initialize", "publishRevision", "saveNote"]).nullable(),
  status: z.enum(["committed", "cancelled", "unknown"]), requestHash: hash.nullable(), stateVersion: positiveVersion.nullable(), editionId: id.nullable(), editionVersion: positiveVersion.nullable(),
  sourceHash: hash.nullable(), parentAsin: text(500).nullable(), noteVersion: positiveVersion.nullable(), reasonCode: reason.nullable() }).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.workspaceId) issue(ctx, "Receipt workspace mismatch");
  if (value.status === "committed" ? value.action === null || value.requestHash === null || value.stateVersion === null || value.editionId === null || value.editionVersion === null || value.sourceHash === null || value.reasonCode !== null
    || (value.action === "saveNote" ? value.parentAsin === null || value.noteVersion === null : value.parentAsin !== null || value.noteVersion !== null)
    : value.requestHash !== null || value.stateVersion !== null || value.editionId !== null || value.editionVersion !== null || value.sourceHash !== null || value.parentAsin !== null || value.noteVersion !== null || value.reasonCode !== (value.status === "cancelled" ? "operation_cancelled" : "outcome_unknown_check_same_operation")) issue(ctx, "Receipt must prove one final action or preserve unknown/cancel fence");
});
export type OperationsBoardEditionWriteResult = z.infer<typeof OperationsBoardEditionWriteResultSchema>;
/** Only the server's freshly authorized preview may be supplied here. */
export function validateOperationsBoardEditionExecuteAgainstPreview(raw: OperationsBoardEditionExecuteInput, rawPreview: OperationsBoardEditionPreviewResult): void {
  const input = OperationsBoardEditionExecuteInputSchema.parse(raw), preview = OperationsBoardEditionPreviewResultSchema.parse(rawPreview);
  if (!preview.capability.available || input.expectedWorkspaceId !== preview.identity.workspaceId || !same(input.scope, preview.request.scope)
    || input.action !== preview.request.action || input.originalEditionId !== preview.request.originalEditionId || input.expectedStateVersion !== preview.state.version
    || input.expectedSourceHash !== preview.sourceHash || input.expectedPreviewKey !== preview.previewKey) throw new OperationsBoardEditionError("PREVIEW_CONFLICT");
}
/** The caller must load actor/owners and both records in its current locked
 * transaction. No partner IDs, display names or archived owner grant is used. */
export function validateOperationsBoardEditionNoteMutation(raw: OperationsBoardEditionSaveNoteInput, current: {
  identity: z.infer<typeof identity>; role: string; responsibleUserIds: number[]; edition: OperationsBoardEdition; note: OperationsBoardEditionNote;
}): void {
  const input = OperationsBoardEditionSaveNoteInputSchema.parse(raw), actor = identity.parse(current.identity), edition = OperationsBoardEditionSchema.parse(current.edition), note = OperationsBoardEditionNoteSchema.parse(current.note);
  const owners = z.array(id).max(5000).refine(values => new Set(values).size === values.length).parse(current.responsibleUserIds);
  if (actor.workspaceId !== input.expectedWorkspaceId || edition.scope.workspaceId !== actor.workspaceId || edition.scope.storeName !== input.scope.storeName || edition.scope.country !== input.scope.country
    || edition.id !== input.editionId || note.editionId !== edition.id || note.parentAsin !== input.parentAsin) throw new OperationsBoardEditionError("NOTE_SCOPE_MISMATCH");
  if (edition.status !== "current" || !["admin", "super_admin"].includes(current.role) && !owners.includes(actor.userId)) throw new OperationsBoardEditionError("NOTE_EDIT_DENIED");
  if (!edition.capture.rows.some(row => row.parentAsin === input.parentAsin && ["child", "parent_only"].includes(row.allocation))) throw new OperationsBoardEditionError("NOTE_PARENT_NOT_VISIBLE");
  if (edition.version !== input.expectedEditionVersion || edition.sourceHash !== input.expectedSourceHash || note.version !== input.expectedNoteVersion) throw new OperationsBoardEditionError("NOTE_VERSION_CONFLICT");
}
export function operationsBoardEditionRequestHash(actor: z.infer<typeof identity>, raw: OperationsBoardEditionExecuteInput | OperationsBoardEditionSaveNoteInput): string {
  const request = "action" in raw ? OperationsBoardEditionExecuteInputSchema.parse(raw) : OperationsBoardEditionSaveNoteInputSchema.parse(raw), checked = identity.parse(actor);
  if (checked.workspaceId !== request.expectedWorkspaceId) throw new OperationsBoardEditionError("REQUEST_SCOPE_MISMATCH");
  return operationsBoardEditionHash({ schema: "operations-board-operation/v1", identity: checked, request });
}
