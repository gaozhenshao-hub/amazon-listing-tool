import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  OPERATIONS_BOARD_EDITION_LIMITS, OperationsBoardEditionStateInputSchema, OperationsBoardEditionStateResultSchema,
  OperationsBoardEditionReadInputSchema, OperationsBoardEditionReadResultSchema,
  OperationsBoardEditionHistoryInputSchema, OperationsBoardEditionHistoryResultSchema,
  OperationsBoardEditionPreviewInputSchema, OperationsBoardEditionPreviewResultSchema,
  OperationsBoardEditionExecuteInputSchema, OperationsBoardEditionSaveNoteInputSchema, OperationsBoardEditionRecoverInputSchema,
  OperationsBoardEditionNoteSchema, OperationsBoardEditionWriteResultSchema, OperationsBoardEditionSummarySchema,
  OperationsBoardEditionError, operationsBoardEditionHash, operationsBoardEditionScopeKey,
  operationsBoardEditionPreviewKey, operationsBoardEditionRequestHash, validateOperationsBoardEditionExecuteAgainstPreview,
  buildOperationsBoardEditionCapture, type OperationsBoardEdition, type OperationsBoardEditionScope,
  type OperationsBoardEditionStateInput, type OperationsBoardEditionState, type OperationsBoardEditionReadInput,
  type OperationsBoardEditionHistoryInput, type OperationsBoardEditionPreviewInput, type OperationsBoardEditionExecuteInput,
  type OperationsBoardEditionSaveNoteInput, type OperationsBoardEditionRecoverInput, type OperationsBoardEditionWriteResult,
  type OperationsBoardEditionNote, type OperationsBoardEditionSummary,
} from "../../../shared/operationsBoardEdition";
import { authorizeOperationsBoardAccess, authorizeOperationsBoardCapture, canUpdateOperationsBoard, type OperationsBoardAccessSession } from "./operationsBoardAccess";
import { createOperationsBoardEditionStore, OperationsBoardEditionStoreError, OPERATIONS_BOARD_CAPTURE_BYTES_SQL } from "./operationsBoardEditionStore";
import { createOperationsBoardPartnerStore } from "./operationsBoardPartnerStore";
import { createOperationsBoardNoteStore, OperationsBoardNoteStoreError } from "./operationsBoardNoteStore";
import { createOperationsBoardOperationJournal, OperationsBoardOperationJournalError } from "./operationsBoardOperationJournal";
import { assertOperationsBoardSchema } from "./operationsBoardSchemaAdmission";
import { captureOperationsBoardEdition } from "./monthlyBoardHistoryCapture";
import { positiveId, query } from "./monthlyBoardReadCore";
import { filterOperationsBoardEditionRowsByOperator, OperationsBoardEditionOwnershipError } from "../../../shared/operationsBoardEditionOwnership";

export interface OperationsBoardDatabase { transaction<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
type Identity = { workspaceId: number; userId: number };
type Session = OperationsBoardAccessSession;
type Operation = Session["operation"];
type Access = Awaited<ReturnType<typeof authorizeOperationsBoardCapture>>;
type Store = ReturnType<typeof createOperationsBoardEditionStore>;
const admin = (role: string) => role === "admin" || role === "super_admin";
const scopeOf = (session: Session, input: OperationsBoardEditionStateInput): OperationsBoardEditionScope => ({ ...input.scope, workspaceId: session.identity.workspaceId });
const uninitialized = (scope: OperationsBoardEditionScope): OperationsBoardEditionState => ({ scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" });
function summary(edition: OperationsBoardEdition) { const { capture: _private, ...metadata } = edition; return OperationsBoardEditionSummarySchema.parse(metadata); }
function fail(reason: string, code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `OPERATIONS_BOARD_${reason}` });
}
function sanitize(error: unknown): never {
  if (error instanceof OperationsBoardEditionOwnershipError) fail(error.code === "OPERATOR_NOT_VISIBLE" ? "OPERATOR_NOT_VISIBLE" : "OWNERSHIP_INVALID", error.code === "OPERATOR_NOT_VISIBLE" ? "FORBIDDEN" : "PRECONDITION_FAILED");
  if (error instanceof TRPCError && /^OPERATIONS_BOARD_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)) fail("ACCESS_DENIED", error.code as "FORBIDDEN");
  if (error instanceof OperationsBoardEditionError || error instanceof OperationsBoardEditionStoreError || error instanceof OperationsBoardOperationJournalError || error instanceof OperationsBoardNoteStoreError) {
    if (/DENIED|ADMIN_REQUIRED/u.test(error.code)) fail(error.code, "FORBIDDEN");
    if (/CONFLICT|IMMUTABLE|ALREADY_INITIALIZED|NOT_INITIALIZED|ORIGINAL_MISSING|CANCELLED/u.test(error.code)) fail(error.code, "CONFLICT");
    fail(error.code);
  }
  return fail("STORAGE_OR_SOURCE_UNAVAILABLE");
}
function uncertainFailure(error: unknown) {
  if (error instanceof TRPCError && /^OPERATIONS_BOARD_[A-Z_]+$/u.test(error.message)) return false;
  if (error instanceof OperationsBoardEditionError) return false;
  if (error instanceof OperationsBoardEditionStoreError || error instanceof OperationsBoardOperationJournalError || error instanceof OperationsBoardNoteStoreError) {
    return /STORAGE_UNKNOWN|READ_FAILED|READ_INVALID|WRITE_CONFLICT|INSERT_ID_INVALID|UNCONFIRMED|READBACK_MISMATCH|WRITE_FAILED/u.test(error.code);
  }
  return true;
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const value = schema.safeParse(raw); if (!value.success) fail("INPUT_INVALID", "BAD_REQUEST"); return value.data; }
function unknown(identity: Identity, scope: OperationsBoardEditionScope, operationId: string): OperationsBoardEditionWriteResult {
  return OperationsBoardEditionWriteResultSchema.parse({ identity, scope, operationId, action: null, status: "unknown", requestHash: null,
    stateVersion: null, editionId: null, editionVersion: null, sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: "outcome_unknown_check_same_operation" });
}

/** Public archive boundary. All reads are freshly authorized and never create,
 * refresh or repair editions. All writes plus their UUID receipts share one
 * required native transaction; an unknown commit is checked, never retried here.
 * Complete private captures never cross this API, including preview/history. */
export function createOperationsBoardRepository(deps: {
  database?: () => Promise<OperationsBoardDatabase | null>; permission?: typeof assertResourceAction; enabled?: () => boolean;
  authorize?: typeof authorizeOperationsBoardAccess; authorizeCapture?: typeof authorizeOperationsBoardCapture;
  canUpdate?: typeof canUpdateOperationsBoard; admit?: typeof assertOperationsBoardSchema;
  store?: typeof createOperationsBoardEditionStore; partners?: typeof createOperationsBoardPartnerStore;
  journal?: typeof createOperationsBoardOperationJournal; notes?: typeof createOperationsBoardNoteStore;
  capture?: typeof captureOperationsBoardEdition;
} = {}) {
  const database = deps.database ?? getDb, permission = deps.permission ?? assertResourceAction;
  const enabled = deps.enabled ?? (() => process.env.ENABLE_MERGED_OPS_BOARD_EDITIONS === "true");
  const authorize = deps.authorize ?? authorizeOperationsBoardAccess, authorizeCapture = deps.authorizeCapture ?? authorizeOperationsBoardCapture;
  const canUpdate = deps.canUpdate ?? canUpdateOperationsBoard, admit = deps.admit ?? assertOperationsBoardSchema;
  const createStore = deps.store ?? createOperationsBoardEditionStore, createPartners = deps.partners ?? createOperationsBoardPartnerStore;
  const createJournal = deps.journal ?? createOperationsBoardOperationJournal, createNotes = deps.notes ?? createOperationsBoardNoteStore;
  const capture = deps.capture ?? captureOperationsBoardEdition;
  async function transaction<T>(ctx: TrpcContext, input: OperationsBoardEditionStateInput, operation: Operation, write: boolean, body: (session: Session) => Promise<T>) {
    if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED");
    const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
    if (!positiveId(workspaceId) || !positiveId(ctx.user.id) || typeof ctx.user.role !== "string" || !ctx.user.role) fail("ACTOR_INVALID", "FORBIDDEN");
    if (input.expectedWorkspaceId !== workspaceId) fail("WORKSPACE_CHANGED", "FORBIDDEN");
    const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => body(await authorize(tx, { identity: { workspaceId, userId: ctx.user!.id }, expectedRole: ctx.user!.role, operation, write }, permission)));
  }
  function store(session: Session): Store { return createStore({ tx: session.tx, identity: session.identity, role: session.role, readOnly: !session.write }); }
  function journal(session: Session, input: OperationsBoardEditionRecoverInput | OperationsBoardEditionExecuteInput | OperationsBoardEditionSaveNoteInput) {
    return createJournal(session.tx, { identity: session.identity, scope: scopeOf(session, input), operationId: input.operationId, actorRole: session.role });
  }
  async function partners(session: Session) {
    const pairs = await createPartners({ tx: session.tx, identity: session.identity, role: session.role, readOnly: !session.write }).directForUser();
    const sessions: Session[] = [];
    for (const pair of pairs) {
      const userId = pair.firstUserId === session.identity.userId ? pair.secondUserId : pair.firstUserId;
      try { sessions.push(await authorize(session.tx, { identity: { workspaceId: session.identity.workspaceId, userId }, operation: "read", write: false }, permission)); }
      catch (error) {
        // A revoked/disabled partner does not revoke the actor's own grant. An
        // unverified database read, however, cannot be interpreted as a denial.
        if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
      }
    }
    return { sessions, proof: operationsBoardEditionHash({ pairs, sessions: sessions.map(value => ({ identity: value.identity, authorizationHash: value.authorizationHash })) }) };
  }
  async function adminCapability(session: Session) {
    if (!enabled()) return { available: false, reasonCode: "writes_not_enabled" };
    if (!admin(session.role)) return { available: false, reasonCode: "admin_required" };
    try {
      if (!await canUpdate(session, permission)) return { available: false, reasonCode: "access_denied" };
      await permission({ actor: session.actor, workspaceId: session.identity.workspaceId, resource: "ops_board", action: "create", authorizationRead: { executor: session.tx, strict: true, lock: true, lockMode: "share" } });
      return { available: true, reasonCode: null };
    } catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") return { available: false, reasonCode: "access_denied" }; throw error; }
  }
  async function state(ctx: TrpcContext, raw: OperationsBoardEditionStateInput) {
    const input = parse(OperationsBoardEditionStateInputSchema, raw);
    try { return await transaction(ctx, input, "read", false, async session => {
      await admit(session.tx); const scope = scopeOf(session, input), loaded = await store(session).load(scope), capability = await adminCapability(session);
      return OperationsBoardEditionStateResultSchema.parse({ identity: session.identity, scope, request: input, state: loaded?.state ?? uninitialized(scope), capabilities: {
        initialize: loaded ? { available: false, reasonCode: "already_initialized" } : capability,
        publishRevision: loaded ? capability : { available: false, reasonCode: "not_initialized" },
      } });
    }); } catch (error) { return sanitize(error); }
  }
  async function notesFor(session: Session, edition: OperationsBoardEdition, access: Access, editable: boolean): Promise<OperationsBoardEditionNote[]> {
    const parents = [...new Set(access.authorizedRows.filter(row => row.parentAsin && ["child", "parent_only"].includes(row.allocation)).map(row => row.parentAsin))].sort();
    const notes = new Map<string, OperationsBoardEditionNote>();
    const basis = (parent: string) => editable && edition.status === "current" && access.canEditParents.has(parent) ? admin(session.role) ? "admin" as const : "responsible" as const : "readonly" as const;
    for (let index = 0; index < parents.length; index += 500) {
      const group = parents.slice(index, index + 500);
      const rows = await query(session.tx, `SELECT workspace_id AS workspaceId,edition_id AS editionId,parent_asin AS parentAsin,IF(OCTET_LENGTH(note)<=12000,note,NULL) AS note,OCTET_LENGTH(note) AS noteBytes,version,updated_by AS updatedBy,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM ops_board_notes WHERE workspace_id=? AND edition_id=? AND BINARY parent_asin IN (${group.map(() => "?").join(",")}) ORDER BY parent_asin LIMIT 501 FOR SHARE`, [session.identity.workspaceId, edition.id, ...group]);
      if (rows.length > group.length) fail("NOTES_INVALID");
      for (const row of rows) {
        if (row.workspaceId !== session.identity.workspaceId || row.editionId !== edition.id || typeof row.parentAsin !== "string" || !group.includes(row.parentAsin) || notes.has(row.parentAsin)
          || typeof row.note !== "string" || Buffer.byteLength(row.note, "utf8") !== row.noteBytes || row.noteBytes > 12000 || !positiveId(row.version)
          || typeof row.updatedAt !== "string" || row.updatedAt > edition.updatedAt) fail("NOTES_INVALID");
        const editBasis = basis(row.parentAsin);
        notes.set(row.parentAsin, OperationsBoardEditionNoteSchema.parse({ editionId: row.editionId, parentAsin: row.parentAsin, note: row.note,
          version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt, canEdit: editBasis !== "readonly", editBasis }));
      }
    }
    return parents.map(parentAsin => notes.get(parentAsin) ?? OperationsBoardEditionNoteSchema.parse({ editionId: edition.id, parentAsin, note: "", version: 0,
      updatedBy: null, updatedAt: null, editBasis: basis(parentAsin), canEdit: basis(parentAsin) !== "readonly" }));
  }
  async function read(ctx: TrpcContext, raw: OperationsBoardEditionReadInput) {
    const input = parse(OperationsBoardEditionReadInputSchema, raw);
    try { return await transaction(ctx, input, "read", false, async session => {
      await admit(session.tx); const scope = scopeOf(session, input), source = store(session), loaded = await source.load(scope);
      const state = loaded?.state ?? uninitialized(scope), edition = input.editionId === null ? loaded?.currentEdition ?? null : await source.get(scope, input.editionId);
      const base = { identity: session.identity, scope, request: input, state, visibility: session.manager ? "full" as const : "scoped" as const };
      const meaning = input.operatorId === undefined ? "all_currently_authorized_edition_rows" as const : "all_currently_authorized_edition_rows_matching_operator" as const;
      if (!edition) {
        const empty = { ...base, edition: null, status: input.editionId === null ? "uninitialized" as const : "not_found" as const,
          reasonCode: input.editionId === null ? "not_initialized" : "edition_not_found", authorizationHash: session.authorizationHash,
          rows: [], sources: [], coverage: { complete: true as const, meaning, rowCount: 0 }, ownership: null, notes: [] };
        return OperationsBoardEditionReadResultSchema.parse({ ...empty, viewKey: operationsBoardEditionHash(empty) });
      }
      const related = await partners(session), access = await authorizeCapture(session, edition.capture, { partnerSessions: related.sessions, includeOwnership: true });
      if (!session.manager && !access.authorizedRows.length) {
        const hidden = { ...base, edition: null, status: "not_found" as const, reasonCode: "edition_not_found",
          authorizationHash: operationsBoardEditionHash({ access: access.authorizationHash, pairs: related.proof }), rows: [], sources: [],
          coverage: { complete: true as const, meaning, rowCount: 0 }, ownership: null, notes: [] };
        return OperationsBoardEditionReadResultSchema.parse({ ...hidden, viewKey: operationsBoardEditionHash(hidden) });
      }
      if (!access.ownership) fail("OWNERSHIP_UNAVAILABLE");
      const selected = filterOperationsBoardEditionRowsByOperator(access.authorizedRows, access.ownership, session.identity.userId, input.operatorId);
      const selectedSources = access.sources.flatMap(source => {
        const rowCount = selected.rows.filter(row => row.yearMonth === source.month).length; return rowCount ? [{ ...source, rowCount }] : [];
      });
      const editable = enabled() && edition.status === "current" && await canUpdate(session, permission);
      const notes = await notesFor(session, edition, { ...access, authorizedRows: selected.rows }, editable);
      const result = { ...base, edition: summary(edition), status: edition.status === "current" && state.status === "current_empty" ? "current_empty" as const : "ready" as const, reasonCode: null,
        authorizationHash: operationsBoardEditionHash({ access: access.authorizationHash, pairs: related.proof, editable, ownership: selected.ownership }), rows: selected.rows, sources: selectedSources,
        coverage: { complete: true as const, meaning, rowCount: selected.rows.length }, ownership: selected.ownership, notes };
      return OperationsBoardEditionReadResultSchema.parse({ ...result, viewKey: operationsBoardEditionHash(result, OPERATIONS_BOARD_EDITION_LIMITS.publicBytes) });
    }); } catch (error) { return sanitize(error); }
  }
  /** Keyset pages must not mix old owner grants with new ones. This bounded
   * complete fence remains private; no membership/mapping directory is returned.
   * Never substitute only the rows visible on this page for that proof. */
  async function historyFence(session: Session, scope: OperationsBoardEditionScope) {
    const statements = [
      { sql: "SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY store_name=BINARY ? ORDER BY id LIMIT 5001 FOR SHARE", values: [scope.workspaceId, scope.storeName] },
      { sql: "SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed FROM operator_name_mappings WHERE workspaceId=? ORDER BY id LIMIT 5001 FOR SHARE", values: [scope.workspaceId] },
      { sql: "SELECT m.id,m.workspaceId,m.userId,m.status,u.id AS actorId,u.status AS actorStatus,u.role,u.defaultWorkspaceId FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId WHERE m.workspaceId=? ORDER BY m.id LIMIT 5001 FOR SHARE", values: [scope.workspaceId] },
    ];
    const evidence = [];
    for (const item of statements) {
      const rows = await query(session.tx, item.sql, item.values);
      if (rows.length > 5000 || rows.some((row, i) => !positiveId(row.id) || row.workspaceId !== scope.workspaceId || i > 0 && Number(row.id) <= Number(rows[i - 1].id))) fail("HISTORY_AUTHORIZATION_INCOMPLETE");
      evidence.push(rows);
    }
    return operationsBoardEditionHash(evidence);
  }
  async function history(ctx: TrpcContext, raw: OperationsBoardEditionHistoryInput) {
    const input = parse(OperationsBoardEditionHistoryInputSchema, raw);
    try { return await transaction(ctx, input, "read", false, async session => {
      await admit(session.tx); const scope = scopeOf(session, input), source = store(session), loaded = await source.load(scope), related = await partners(session);
      const state = loaded?.state ?? uninitialized(scope), historyVersion = operationsBoardEditionHash({ schema: "operations-board-history/v1", identity: session.identity, scope, state,
        access: session.authorizationHash, pairs: related.proof, owners: await historyFence(session, scope) });
      if (input.cursor && input.cursor.historyVersion !== historyVersion) fail("HISTORY_CHANGED", "CONFLICT");
      const items: OperationsBoardEditionSummary[] = [];
      if (loaded) {
        const candidates = await query(session.tx, `SELECT e.id,e.workspace_id AS workspaceId,e.state_id AS stateId,${OPERATIONS_BOARD_CAPTURE_BYTES_SQL} AS captureBytes FROM ops_board_editions e JOIN ops_board_states s ON s.id=e.state_id AND s.workspace_id=e.workspace_id WHERE s.workspace_id=? AND BINARY s.scope_key=BINARY ? AND BINARY s.store_name=BINARY ? AND BINARY s.country=BINARY ? AND e.state_id=? AND e.status='archived' AND e.id<? ORDER BY e.id DESC LIMIT 201 FOR SHARE`, [scope.workspaceId, operationsBoardEditionScopeKey(scope), scope.storeName, scope.country, loaded.stateId, input.cursor?.beforeId ?? 2147483648]);
        if (candidates.length > 201 || candidates.some((row, index) => !positiveId(row.id) || row.workspaceId !== scope.workspaceId || row.stateId !== loaded.stateId
          || Number(row.id) >= (input.cursor?.beforeId ?? 2147483648) || index > 0 && Number(row.id) >= Number(candidates[index - 1].id)
          || typeof row.captureBytes !== "number" || !Number.isSafeInteger(row.captureBytes) || row.captureBytes <= 0)) fail("HISTORY_INVALID");
        let bytes = 0;
        for (const candidate of candidates.slice(0, 200)) {
          bytes += Number(candidate.captureBytes); if (bytes > OPERATIONS_BOARD_EDITION_LIMITS.captureBytes) fail("HISTORY_SCAN_INCOMPLETE");
          const edition = await source.get(scope, Number(candidate.id)); if (!edition || edition.status !== "archived") fail("HISTORY_INVALID");
          const access = await authorizeCapture(session, edition.capture, { partnerSessions: related.sessions });
          if (session.manager || access.authorizedRows.length) items.push(summary(edition));
          if (items.length > input.limit) break;
        }
        if (candidates.length > 200 && items.length <= input.limit) fail("HISTORY_SCAN_INCOMPLETE");
      }
      const hasMore = items.length > input.limit, visible = items.slice(0, input.limit);
      return OperationsBoardEditionHistoryResultSchema.parse({ identity: session.identity, scope, request: input, state, historyVersion, items: visible,
        page: { hasMore, nextCursor: hasMore ? { beforeId: visible.at(-1)!.id, historyVersion } : null } });
    }); } catch (error) { return sanitize(error); }
  }
  async function prepare(session: Session, input: OperationsBoardEditionPreviewInput) {
    const scope = scopeOf(session, input), source = store(session), loaded = await source.load(scope), state = loaded?.state ?? uninitialized(scope);
    const original = input.action === "publishRevision" && input.originalEditionId !== null ? await source.get(scope, input.originalEditionId) : null;
    let reason: string | null = !enabled() ? "writes_not_enabled" : null;
    if (input.action === "initialize" && loaded) reason = "already_initialized";
    if (input.action === "publishRevision" && (!original || original.kind !== "original" || original.status !== "archived")) reason = "archived_original_required";
    const validOriginal = original?.kind === "original" && original.status === "archived" ? original : null;
    let captured = null;
    if (input.action === "initialize" && !loaded || input.action === "publishRevision" && validOriginal) {
      const all = await capture(session, { ...input.scope, month: validOriginal?.month ?? "9999-12" });
      const target = validOriginal?.month ?? all.sources.at(-1)?.month ?? null;
      if (target) captured = buildOperationsBoardEditionCapture({ scope, month: target, scannedBatches: all.scannedBatches, sources: all.sources, rows: all.rows });
      else reason = "no_confirmed_sources";
    }
    const result = { identity: session.identity, scope, request: input, state, original: validOriginal ? summary(validOriginal) : null,
      targetMonth: captured?.month ?? validOriginal?.month ?? null, sourceHash: captured?.sourceHash ?? null, sourceRowCount: captured?.rows.length ?? null,
      capability: { available: reason === null, reasonCode: reason }, effects: { movesCurrent: input.action === "initialize", preservesOriginal: true as const, copiesNotes: false as const, createsPastEditions: false as const } };
    const previewKey = captured ? operationsBoardEditionPreviewKey({ ...result, targetMonth: captured.month, sourceHash: captured.sourceHash }) : null;
    return { preview: OperationsBoardEditionPreviewResultSchema.parse({ ...result, previewKey }), captured, loaded, source };
  }
  async function preview(ctx: TrpcContext, raw: OperationsBoardEditionPreviewInput) {
    const input = parse(OperationsBoardEditionPreviewInputSchema, raw);
    try { return await transaction(ctx, input, "create", true, async session => { await admit(session.tx); return (await prepare(session, input)).preview; }); }
    catch (error) { return sanitize(error); }
  }
  async function mutation(ctx: TrpcContext, input: OperationsBoardEditionExecuteInput | OperationsBoardEditionSaveNoteInput) {
    const action = "action" in input ? input.action : "saveNote";
    let uncertain: { identity: Identity; scope: OperationsBoardEditionScope } | null = null;
    try { return await transaction(ctx, input, action === "saveNote" ? "update" : "create", true, async session => {
      const scope = scopeOf(session, input), operation = journal(session, input), requestHash = operationsBoardEditionRequestHash(session.identity, input);
      const existing = await operation.read();
      if (existing.final) {
        if (existing.final.status !== "cancelled" && (existing.final.requestHash !== requestHash || existing.final.action !== action)) fail("OPERATION_CONFLICT", "CONFLICT");
        return existing.final;
      }
      if (!enabled()) fail("WRITES_NOT_ENABLED");
      await admit(session.tx);
      let edition: OperationsBoardEdition, state: OperationsBoardEditionState, note: OperationsBoardEditionNote | null = null;
      if ("action" in input) {
        const prepared = await prepare(session, { expectedWorkspaceId: input.expectedWorkspaceId, scope: input.scope, action: input.action, originalEditionId: input.originalEditionId });
        validateOperationsBoardEditionExecuteAgainstPreview(input, prepared.preview);
        if (!prepared.captured) fail("SOURCE_UNAVAILABLE");
        uncertain = { identity: session.identity, scope };
        const expected = { stateVersion: prepared.preview.state.version, currentEditionId: prepared.preview.state.currentEditionId, sourceHash: prepared.loaded?.currentEdition.sourceHash ?? null };
        const saved = input.action === "initialize" ? await prepared.source.initializeExplicitAdmin(scope, prepared.captured, expected)
          : await prepared.source.publishRevision(scope, input.originalEditionId!, prepared.captured, expected);
        if (!saved.publishedEdition) fail("WRITE_UNVERIFIED"); edition = saved.publishedEdition; state = saved.state;
      } else {
        uncertain = { identity: session.identity, scope };
        const saved = await createNotes(session).save(input); edition = saved.currentEdition; state = saved.state; note = saved.note;
      }
      if (!enabled()) fail("WRITES_NOT_ENABLED");
      return operation.finalize(OperationsBoardEditionWriteResultSchema.parse({ identity: session.identity, scope, operationId: input.operationId, action, status: "committed", requestHash,
        stateVersion: state.version, editionId: edition.id, editionVersion: edition.version, sourceHash: edition.sourceHash, parentAsin: note?.parentAsin ?? null, noteVersion: note?.version ?? null, reasonCode: null }));
    }); } catch (error) {
      // An SQL/readback/COMMIT transport error after mutation may have lost the
      // ACK. The only supported next action is this exact UUID's check/cancel.
      if (uncertain && uncertainFailure(error)) {
        const saved = uncertain as { identity: Identity; scope: OperationsBoardEditionScope }; return unknown(saved.identity, saved.scope, input.operationId);
      }
      return sanitize(error);
    }
  }
  async function execute(ctx: TrpcContext, raw: OperationsBoardEditionExecuteInput) { return mutation(ctx, parse(OperationsBoardEditionExecuteInputSchema, raw)); }
  async function saveNote(ctx: TrpcContext, raw: OperationsBoardEditionSaveNoteInput) { return mutation(ctx, parse(OperationsBoardEditionSaveNoteInputSchema, raw)); }
  async function recover(ctx: TrpcContext, raw: OperationsBoardEditionRecoverInput) {
    const input = parse(OperationsBoardEditionRecoverInputSchema, raw); let uncertain: { identity: Identity; scope: OperationsBoardEditionScope } | null = null;
    try { return await transaction(ctx, input, "read", true, async session => {
      // Recovery needs fresh financial/board READ and actor-bound journal, not
      // create/update grants or four business tables. It works after rollback.
      const operation = journal(session, input), existing = await operation.read(); if (existing.final) return existing.final;
      if (input.decision === "check") return unknown(session.identity, scopeOf(session, input), input.operationId);
      uncertain = { identity: session.identity, scope: scopeOf(session, input) }; return operation.cancel();
    }); } catch (error) {
      if (uncertain && !(error instanceof TRPCError)) { const saved = uncertain as { identity: Identity; scope: OperationsBoardEditionScope }; return unknown(saved.identity, saved.scope, input.operationId); }
      return sanitize(error);
    }
  }
  return { state, read, history, preview, execute, saveNote, recover };
}
export const operationsBoardRepository = createOperationsBoardRepository();
