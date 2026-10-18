import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../../shared/const";
import { AgentLibraryKeySchema, AgentLibraryRulesSchema, type AgentLibraryKey } from "../../../../shared/agentLibraryContracts";
import { AssistantConfigurationSchema } from "../../../../shared/assistantConfigurations";
import { AssistantConversationCreateThreadInputSchema, AssistantConversationThreadsInputSchema, AssistantConversationHistoryInputSchema, AssistantConversationSubmitInputSchema, AssistantConversationOperationInputSchema, validateAssistantConversationReply, validateAssistantConversationRoute } from "../../../../shared/assistantConversation";
import { AssistantConversationOptionsInputSchema, AssistantConversationAttachmentInputSchema, AssistantConversationOptionsResultSchema, AssistantConversationThreadResultSchema, AssistantConversationThreadsResultSchema, AssistantConversationHistoryResultSchema, AssistantConversationOperationResultSchema, AssistantConversationAttachmentsResultSchema, AssistantConversationAttachmentResultSchema, AssistantConversationAttachmentMetadataSchema, AssistantConversationPublicThreadSchema, AssistantConversationPublicTurnSchema } from "../../../../shared/assistantConversationRead";
import type { TrpcContext } from "../../../_core/context";
import { assertResourceAction, workspaceIdFromContext } from "../../../services/securityGovernance";
import { assistantConversationRepository, AssistantConversationStorageError, assistantConversationCanonical, assistantConversationRequestHash, type AssistantConversationSession, type AssistantConversationThread, type AssistantConversationTurn } from "../repositories/assistantConversations";
import { configurationSession } from "../repositories/assistantConfigurations";
import { configurationHash } from "./assistantConfigurations";
import { parseAssistantConversationAttachments, AssistantConversationAttachmentError, type ParsedAssistantConversationAttachment } from "./assistantConversationAttachments";
import { assistantConversationRuntime, AssistantConversationRuntimeError } from "./assistantConversationRuntime";
import type { AssistantConversationSavedConfiguration, AssistantConversationHistoryContext, AssistantConversationIdentity } from "./assistantConversationContext";

type Session = AssistantConversationSession;
type Action = "read" | "create" | "run" | "cancel" | "upload" | "export";
type Row = Record<string, unknown>;
const id = z.number().int().positive().max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const savedSchema = z.object({ workspaceId: id, agentKey: AgentLibraryKeySchema, revision: id, hash, config: AssistantConfigurationSchema }).strict();
const snapshotSchema = AssistantConversationSubmitInputSchema.omit({ files: true }).extend({ files: z.array(z.object({ name: z.string().min(1).max(180), sha256: hash, sizeBytes: id.max(3 * 1024 * 1024) }).strict()).max(3) }).strict();
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(value => new Set(value).size === value.length);
const name = z.string().min(1).max(100).refine(value => value === value.trim());
const details = z.array(z.object({ moduleId: name, operations, subModules: z.array(z.object({ subModuleId: name, operations }).strict()).max(100).refine(value => new Set(value.map(item => item.subModuleId)).size === value.length).optional() }).strict()).max(100).refine(value => new Set(value.map(item => item.moduleId)).size === value.length);
function fail(code: string, conflict = false): never { throw new AssistantConversationStorageError(code, conflict); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) fail("DATA_INVALID"); return result.data; }
function json(value: unknown, max: number): unknown { try { const text = typeof value === "string" ? value : assistantConversationCanonical(value, max); if (Buffer.byteLength(text) > max) fail("DATA_LIMIT"); const result: unknown = JSON.parse(text); assistantConversationCanonical(result, max); return result; } catch (error) { if (error instanceof AssistantConversationStorageError) throw error; return fail("DATA_INVALID"); } }
async function rows(session: Session, text: string, values: unknown[] = []): Promise<Row[]> { const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID"); const statement = sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); const result = await session.executor.execute(statement); if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("DATA_INVALID"); return result[0]; }
/** FOR SHARE/UPDATE is an authorization fence only on transactional tables.
 * This is read-only runtime admission, never a migration or an engine rewrite. */
async function transactionalTables(session: Session, tables: readonly string[]) { const found = await rows(session, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, [...tables]); if (found.length !== tables.length || new Set(found.map(row => row.tableName)).size !== tables.length || found.some(row => !tables.includes(String(row.tableName)) || row.engine !== "InnoDB")) fail("TRANSACTION_SCHEMA_UNAVAILABLE"); }
function safeInside(error: unknown): never {
  if (error instanceof AssistantConversationStorageError) throw error;
  if (error instanceof AssistantConversationRuntimeError) fail(`RUNTIME_${error.code}`);
  if (error instanceof AssistantConversationAttachmentError) fail(`ATTACHMENT_${error.code}`);
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED");
  if (error instanceof TRPCError && error.code === "CONFLICT") fail("CONFIGURATION_CONFLICT", true);
  // Raw SQL/provider/parser errors and their possibly private messages never leave this boundary.
  fail("SERVICE_UNAVAILABLE");
}
function safeOutside(error: unknown): never { if (error instanceof AssistantConversationStorageError) throw new TRPCError({ code: error.conflict ? "CONFLICT" : ["ACCESS_DENIED", "DIRECTORY_DENIED", "MEMBERSHIP_UNAVAILABLE", "ACTOR_UNAVAILABLE", "WORKSPACE_UNAVAILABLE"].includes(error.code) ? "FORBIDDEN" : "PRECONDITION_FAILED", message: error.message }); if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "ASSISTANT_CONVERSATION_INPUT_INVALID" }); throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_CONVERSATION_UNAVAILABLE" }); }
function publicThread(thread: AssistantConversationThread) { return AssistantConversationPublicThreadSchema.parse({ threadId: thread.threadId, title: thread.title, version: thread.version, activeOperationId: thread.activeTurn, createdAt: thread.createdAt, updatedAt: thread.updatedAt }); }
function assertThread(thread: AssistantConversationThread, agentKey: AgentLibraryKey) { if (thread.agentKey !== agentKey) fail("SCOPE_MISMATCH"); return thread; }
function assertTurn(turn: AssistantConversationTurn, thread: AssistantConversationThread) { if (turn.threadId !== thread.threadId || turn.agentKey !== thread.agentKey || turn.workspaceId !== thread.workspaceId || turn.userId !== thread.userId) fail("SCOPE_MISMATCH"); return turn; }

const count = z.number().int().nonnegative();
const coverageSchema = z.object({ status: z.enum(["complete", "partial"]), scope: z.enum(["image_pixels", "text_only"]), text: z.object({ extractedCharacters: count, includedCharacters: count, limit: count, truncated: z.boolean() }).strict().nullable(), pdf: z.object({ totalPages: count, parsedPages: z.array(id).max(30), limit: count }).strict().nullable(), workbook: z.object({ totalSheets: count, parsedSheets: count, sheetLimit: count, rowLimit: count, sheets: z.array(z.object({ name: z.string().max(1000), totalRows: count, parsedRows: count, truncated: z.boolean() }).strict()).max(5) }).strict().nullable(), office: z.object({ entries: count, expandedBytes: count }).strict().nullable() }).strict();
const extractionSchema = z.object({ kind: z.enum(["image", "document"]), image: z.object({ format: z.enum(["png", "jpeg", "webp", "gif"]), width: id, height: id, frames: id, totalPixels: id, orientation: count.nullable() }).strict().nullable(), extractedText: z.string().refine(value => Array.from(value).length <= 40000).nullable(), coverage: coverageSchema, warnings: z.array(z.object({ code: z.string().max(100), message: z.string().max(1000) }).strict()).max(100), modelContext: z.object({ contentIsUntrusted: z.literal(true), currentImageInput: z.enum(["original_image", "none"]), historyImages: z.literal("reattach_required"), documentInput: z.enum(["extracted_text_only", "none"]), description: z.string().max(4000) }).strict() }).strict().superRefine((value, context) => { if (value.kind === "image" ? !value.image || value.extractedText !== null || value.coverage.scope !== "image_pixels" : value.image !== null || value.extractedText === null || value.coverage.scope !== "text_only") context.addIssue({ code: "custom", message: "Extraction kind mismatch" }); });
type Attachment = Awaited<ReturnType<Session["attachments"]>>[number];
function attachmentMetadata(file: Attachment) { const value = parse(extractionSchema, file.extraction); return AssistantConversationAttachmentMetadataSchema.parse({ ordinal: file.ordinal, name: file.fileName, mime: file.mimeType, sizeBytes: file.byteSize, sha256: file.contentHash, kind: value.kind, coverage: value.coverage, warnings: value.warnings }); }
function requestOf(turn: AssistantConversationTurn) { if (turn.sequence === null) return null; const request = parse(snapshotSchema, turn.request); if (request.operationId !== turn.operationId || request.threadId !== turn.threadId || request.agentKey !== turn.agentKey || request.expectedWorkspaceId !== turn.workspaceId || request.mode !== turn.mode || request.expectedThreadVersion !== turn.expectedThreadVersion) fail("SCOPE_MISMATCH"); return request; }
function configurationOf(turn: AssistantConversationTurn): AssistantConversationSavedConfiguration { const saved = parse(savedSchema, turn.configuration), request = requestOf(turn); if (saved.workspaceId !== turn.workspaceId || saved.agentKey !== turn.agentKey || configurationHash(saved.config) !== saved.hash || !request || request.expectedConfiguration.revision !== saved.revision || request.expectedConfiguration.hash !== saved.hash) fail("CONFIGURATION_INVALID"); return saved; }
function storedAttachments(files: ParsedAssistantConversationAttachment[]) { return files.map(file => ({ fileName: file.name, mimeType: file.mime, bytes: file.originalBytes, contentHash: file.sha256, extraction: { kind: file.kind, image: file.image, extractedText: file.extractedText, coverage: file.coverage, warnings: file.warnings, modelContext: file.modelContext } })); }
function logicalFingerprint(identity: { workspaceId: number; userId: number }, request: z.infer<typeof AssistantConversationSubmitInputSchema>) {
  const files = request.files.map(file => { const bytes = Buffer.from(file.base64, "base64"); if (!bytes.length || bytes.length > 3 * 1024 * 1024 || bytes.toString("base64") !== file.base64) fail("ATTACHMENT_INVALID_BASE64"); return { name: file.name, bytes, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length }; });
  const snapshot = { ...request, files: files.map(({ name, sha256, sizeBytes }) => ({ name, sha256, sizeBytes })) };
  const requestHash = assistantConversationRequestHash(identity, { operationId: request.operationId, threadId: request.threadId, expectedThreadVersion: request.expectedThreadVersion, mode: request.mode, request: snapshot, configuration: null, runtime: null, attachments: files.map(file => ({ fileName: file.name, mimeType: "application/octet-stream", bytes: file.bytes, contentHash: file.sha256, extraction: null })) });
  return { snapshot, requestHash };
}

export function createAssistantConversationService(dependencies: {
  repository?: typeof assistantConversationRepository;
  permission?: typeof assertResourceAction;
  runtime?: Pick<typeof assistantConversationRuntime, "availability" | "prepare">;
  parseAttachments?: typeof parseAssistantConversationAttachments;
  writesEnabled?: () => boolean;
  workerEnabled?: () => boolean;
} = {}) {
  const repository = dependencies.repository ?? assistantConversationRepository, permission = dependencies.permission ?? assertResourceAction, runtime = dependencies.runtime ?? assistantConversationRuntime, parseAttachments = dependencies.parseAttachments ?? parseAssistantConversationAttachments;
  const writesEnabled = dependencies.writesEnabled ?? (() => process.env.ENABLE_ASSISTANT_CONVERSATION_WRITES === "true"), workerEnabled = dependencies.workerEnabled ?? (() => process.env.ENABLE_ASSISTANT_CONVERSATION_WORKER === "true");
  const runtimeEnabled = () => writesEnabled() === true && workerEnabled() === true;
  async function directory(session: Session, action: Action) {
    if (session.actor.role === "super_admin") return;
    const records = await rows(session, "SELECT id,workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions,OCTET_LENGTH(detailedPermissions) AS detailBytes FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL,id LIMIT 3 FOR SHARE", [session.actor.role, session.identity.workspaceId]);
    if (records.length > 2 || new Set(records.map(row => row.workspaceId)).size !== records.length || records.some(row => !id.safeParse(row.id).success || row.role !== session.actor.role || row.workspaceId !== null && row.workspaceId !== session.identity.workspaceId)) fail("DIRECTORY_INVALID");
    const record = records.find(row => row.workspaceId === session.identity.workspaceId) ?? records.find(row => row.workspaceId === null);
    if (!record) { if (!ROLE_MODULE_ACCESS[session.actor.role]?.includes("emperor")) fail("DIRECTORY_DENIED"); return; }
    if (record.detailBytes !== null && (!Number.isSafeInteger(Number(record.detailBytes)) || Number(record.detailBytes) > 65536 || record.detailedPermissions === null)) fail("DIRECTORY_INVALID");
    const modules = parse(z.array(name).max(100).refine(value => new Set(value).size === value.length), json(record.modules, 65536));
    const detailed = record.detailedPermissions === null ? [] : parse(details, json(record.detailedPermissions, 65536));
    if (!modules.includes("emperor")) fail("DIRECTORY_DENIED");
    const module = detailed.find(value => value.moduleId === "emperor"); if (!module) return;
    for (const sub of ["emperor_agents", "emperor_conversations"]) { const available = module.subModules?.find(value => value.subModuleId === sub)?.operations ?? module.operations; if (!available.includes("read") || !["read", "export"].includes(action) && sub === "emperor_conversations" && !available.includes("edit") || action === "run" && sub === "emperor_agents" && !available.includes("edit")) fail("DIRECTORY_DENIED"); }
  }
  async function authorizeSession(session: Session, agentKey: AgentLibraryKey, action: Action, threadId?: string): Promise<void> {
    try {
      AgentLibraryKeySchema.parse(agentKey); await transactionalTables(session, ["role_permissions", "security_access_policies"]); await directory(session, action);
      const common = { actor: session.actor, workspaceId: session.identity.workspaceId, authorizationRead: { executor: session.executor, strict: true as const, lock: true as const } };
      await permission({ ...common, resource: "agent", action: "read", resourceId: agentKey });
      await permission({ ...common, resource: "conversation", action: "read", ...(threadId ? { resourceId: threadId } : {}) });
      if (action !== "read") await permission({ ...common, resource: "conversation", action, ...(threadId ? { resourceId: threadId } : {}) });
      if (action === "run") await permission({ ...common, resource: "agent", action: "run", resourceId: agentKey });
    } catch (error) { safeInside(error); }
  }
  async function loadSavedConfiguration(session: Session, agentKey: AgentLibraryKey): Promise<AssistantConversationSavedConfiguration | null> {
    try {
      // A returned configuration is used to prepare/revalidate the locked model
      // and Skill registry in this same transaction, including worker hooks.
      await transactionalTables(session, ["emperor_assistant_configurations", "emperor_assistant_configuration_versions", "emperor_skills", "emperor_model_providers"]);
      const ws = session.identity.workspaceId;
      const candidates = await rows(session, "SELECT revision,OCTET_LENGTH(config) AS bytes FROM emperor_assistant_configurations WHERE workspaceId=? AND BINARY agentKey=BINARY ? LIMIT 2 FOR UPDATE", [ws, agentKey]);
      if (!candidates.length) return null;
      if (candidates.length !== 1 || !id.safeParse(candidates[0].revision).success || !Number.isSafeInteger(Number(candidates[0].bytes)) || Number(candidates[0].bytes) < 2 || Number(candidates[0].bytes) > 512 * 1024) fail("CONFIGURATION_INVALID");
      const versions = await rows(session, "SELECT revision,OCTET_LENGTH(config) AS bytes FROM emperor_assistant_configuration_versions WHERE workspaceId=? AND BINARY agentKey=BINARY ? AND revision=? LIMIT 2 FOR SHARE", [ws, agentKey, candidates[0].revision]);
      if (versions.length !== 1 || versions[0].revision !== candidates[0].revision || !Number.isSafeInteger(Number(versions[0].bytes)) || Number(versions[0].bytes) < 2 || Number(versions[0].bytes) > 512 * 1024) fail("CONFIGURATION_INVALID");
      const configSession = configurationSession(session.executor, true), current = await configSession.current(ws, agentKey), history = await configSession.version(ws, agentKey, Number(candidates[0].revision));
      if (current.length !== 1 || history.length !== 1) fail("CONFIGURATION_INVALID");
      const result = current.map(row => ({ workspaceId: row.workspaceId, agentKey: row.agentKey, revision: row.revision, hash: row.configHash, config: json(row.config, 512 * 1024) }))[0];
      const saved = parse(savedSchema, result), historical = history[0];
      if (!isDeepStrictEqual(saved, result) || saved.workspaceId !== ws || saved.agentKey !== agentKey || saved.revision !== candidates[0].revision || saved.hash !== configurationHash(saved.config) || historical.workspaceId !== ws || historical.agentKey !== agentKey || historical.revision !== saved.revision || historical.configHash !== saved.hash || !isDeepStrictEqual(json(historical.config, 512 * 1024), saved.config)) fail("CONFIGURATION_INVALID");
      return saved;
    } catch (error) { safeInside(error); }
  }
  async function publicTurn(session: Session, turn: AssistantConversationTurn) {
    const request = requestOf(turn), saved = request ? configurationOf(turn) : null;
    const reply = turn.replyResult === null ? null : validateAssistantConversationReply(turn.mode!, turn.replyResult);
    const selectedSkillSlug = request?.selection.kind === "explicit" ? request.selection.skillSlug : turn.routeResult === null ? null : validateAssistantConversationRoute(turn.routeResult, saved!.config.skills.filter(value => value.enabled).map(value => value.slug));
    const proposedRules = turn.proposal === null ? null : parse(AgentLibraryRulesSchema, turn.proposal);
    if (proposedRules !== null && (turn.mode !== "coach" || !isDeepStrictEqual(proposedRules, reply?.proposedRules))) fail("RESULT_INVALID");
    return AssistantConversationPublicTurnSchema.parse({ operationId: turn.operationId, threadId: turn.threadId, sequence: turn.sequence, mode: turn.mode, message: request?.message ?? null, reply: reply?.reply ?? null, state: turn.state, errorCode: turn.errorCode, selectedSkillSlug, configurationRevision: saved?.revision ?? null, configurationHash: saved?.hash ?? null, attachments: (await session.attachments(turn.threadId, turn.operationId)).map(attachmentMetadata), proposedRules, createdAt: turn.createdAt, updatedAt: turn.updatedAt, completedAt: turn.completedAt });
  }
  async function loadHistoryContext(session: Session, threadId: string, beforeSequence?: number): Promise<{ history: AssistantConversationHistoryContext[]; hasOlderHistory: boolean }> {
    const thread = await session.thread(threadId), history: AssistantConversationHistoryContext[] = []; let before = beforeSequence;
    for (let scanned = 0; scanned < 1000; scanned += 10) {
      const page = await session.history(threadId, { limit: 10, ...(before === undefined ? {} : { beforeSequence: before }) });
      for (let i = 0; i < page.items.length; i++) { const turn = assertTurn(page.items[i], thread); if (turn.state !== "succeeded") continue;
        const request = requestOf(turn); if (!request || turn.sequence === null) fail("HISTORY_INVALID");
        const reply = validateAssistantConversationReply(turn.mode!, turn.replyResult), files = await session.attachments(threadId, turn.operationId);
        const documents: AssistantConversationHistoryContext["documents"] = []; let imageCount = 0;
        for (const file of files) { const data = parse(extractionSchema, file.extraction); if (data.kind === "image") imageCount++; else documents.push({ name: file.fileName, sha256: file.contentHash, sizeBytes: file.byteSize, mime: file.mimeType, extractedText: data.extractedText!, coverage: data.coverage, warnings: data.warnings }); }
        history.push({ ...session.identity, agentKey: AgentLibraryKeySchema.parse(thread.agentKey), threadId, operationId: turn.operationId, sequence: turn.sequence, status: "succeeded", message: request.message, reply: reply.reply, imageCount, documents });
        if (history.length === 6) return { history: history.reverse(), hasOlderHistory: i < page.items.length - 1 || page.nextBeforeSequence !== null };
      }
      if (page.nextBeforeSequence === null) return { history: history.reverse(), hasOlderHistory: false };
      if (before !== undefined && page.nextBeforeSequence >= before) fail("HISTORY_INVALID"); before = page.nextBeforeSequence;
    }
    return fail("HISTORY_CONTEXT_LIMIT");
  }
  async function hydrateTurn(session: Session, turn: AssistantConversationTurn) {
    const thread = await session.thread(turn.threadId); assertTurn(turn, thread);
    const snapshot = requestOf(turn); if (!snapshot) fail("TURN_UNAVAILABLE");
    const files = await session.attachments(turn.threadId, turn.operationId); if (files.length !== snapshot.files.length) fail("ATTACHMENT_INVALID");
    const attachments: ParsedAssistantConversationAttachment[] = [];
    for (const meta of files) { const original = await session.attachmentBytes(turn.threadId, turn.operationId, meta.ordinal), data = parse(extractionSchema, original.extraction), expected = snapshot.files[meta.ordinal]; if (expected.name !== original.fileName || expected.sha256 !== original.contentHash || expected.sizeBytes !== original.byteSize) fail("ATTACHMENT_INVALID"); attachments.push({ ...data, originalBytes: original.bytes, name: original.fileName, sha256: original.contentHash, sizeBytes: original.byteSize, mime: original.mimeType }); }
    const request = parse(AssistantConversationSubmitInputSchema, { ...snapshot, files: attachments.map(file => ({ name: file.name, base64: file.originalBytes.toString("base64") })) });
    if (logicalFingerprint(session.identity, request).requestHash !== turn.requestHash) fail("REQUEST_HASH_MISMATCH", true);
    return { identity: { ...session.identity, agentKey: request.agentKey, threadId: turn.threadId } satisfies AssistantConversationIdentity, request, savedConfiguration: configurationOf(turn), attachments };
  }
  function owner(ctx: TrpcContext, expectedWorkspaceId: number) { const workspaceId = workspaceIdFromContext(ctx); if (!ctx.user || !id.safeParse(ctx.user.id).success) fail("ACCESS_DENIED"); if (!id.safeParse(workspaceId).success || workspaceId !== expectedWorkspaceId) fail("WORKSPACE_CHANGED"); return { workspaceId: workspaceId!, userId: ctx.user.id }; }
  async function invoke<T>(ctx: TrpcContext, expected: number, write: boolean, body: (session: Session) => Promise<T>) { try { const identity = owner(ctx, expected); return await repository[write ? "transaction" : "read"](identity, async session => { try { return await body(session); } catch (error) { safeInside(error); } }); } catch (error) { safeOutside(error); } }
  const identity = (session: Session, agentKey: AgentLibraryKey) => ({ ...session.identity, agentKey });
  async function operation(session: Session, agentKey: AgentLibraryKey, thread: AssistantConversationThread, turn: AssistantConversationTurn | null) { if (turn) assertTurn(turn, thread); return AssistantConversationOperationResultSchema.parse({ identity: identity(session, agentKey), thread: publicThread(thread), operation: turn ? await publicTurn(session, turn) : null, reasonCode: turn ? null : "OPERATION_UNKNOWN", runtimeEnabled: runtimeEnabled() }); }
  async function capability(session: Session, agentKey: AgentLibraryKey, action: Action) { try { await authorizeSession(session, agentKey, action); return { available: true, reasonCode: null }; } catch (error) { if (error instanceof AssistantConversationStorageError && ["ACCESS_DENIED", "DIRECTORY_DENIED"].includes(error.code)) return { available: false, reasonCode: error.code }; throw error; } }
  return {
    authorizeSession, loadSavedConfiguration, loadHistoryContext, hydrateTurn,
    async options(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationOptionsInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => {
      await authorizeSession(session, input.agentKey, "read"); const saved = await loadSavedConfiguration(session, input.agentKey);
      // Availability has no thread/body/storage side effects. This sentinel is never a persisted thread or an authorization resource.
      const available = saved ? await runtime.availability({ executor: session.executor, identity: { ...identity(session, input.agentKey), threadId: "00000000-0000-4000-8000-000000000000" }, savedConfiguration: saved }) : { available: false, reasonCode: "CONFIGURATION_UNAVAILABLE", model: null, skills: [], executionKind: "conversation_only" as const };
      const create = await capability(session, input.agentKey, "create"), submit = await capability(session, input.agentKey, "run"), cancel = await capability(session, input.agentKey, "cancel"), upload = await capability(session, input.agentKey, "upload"), download = await capability(session, input.agentKey, "export");
      if (create.available && !writesEnabled()) Object.assign(create, { available: false, reasonCode: "WRITES_DISABLED" });
      if (submit.available && (!runtimeEnabled() || !available.available)) Object.assign(submit, { available: false, reasonCode: !writesEnabled() ? "WRITES_DISABLED" : !workerEnabled() ? "WORKER_DISABLED" : available.reasonCode ?? "RUNTIME_UNAVAILABLE" });
      if (upload.available && !submit.available) Object.assign(upload, { available: false, reasonCode: submit.reasonCode });
      return AssistantConversationOptionsResultSchema.parse({ identity: identity(session, input.agentKey), configuration: saved ? { revision: saved.revision, hash: saved.hash, name: saved.config.name, enabled: saved.config.enabled, modelSlug: saved.config.modelSlug, modelName: available.model?.name ?? null, vision: available.model?.vision ?? null } : null, skills: available.skills, capabilities: { create, submit, cancel, upload, download, confirmRules: { available: false, reasonCode: "RULE_CONFIRMATION_NOT_CONNECTED" } }, executionKind: "conversation_only", businessExecutionAvailable: false, runtimeEnabled: runtimeEnabled() });
    }); },
    async createThread(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationCreateThreadInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, true, async session => { await authorizeSession(session, input.agentKey, "create", input.threadId); if (!writesEnabled()) fail("WRITES_DISABLED"); const thread = await session.createThread({ threadId: input.threadId, agentKey: input.agentKey, title: input.title }); return AssistantConversationThreadResultSchema.parse({ identity: identity(session, input.agentKey), thread: publicThread(assertThread(thread, input.agentKey)) }); }); },
    async threads(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationThreadsInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => { await authorizeSession(session, input.agentKey, "read"); const result = await session.threads(input); for (const thread of result.items) { assertThread(thread, input.agentKey); await authorizeSession(session, input.agentKey, "read", thread.threadId); } return AssistantConversationThreadsResultSchema.parse({ identity: identity(session, input.agentKey), items: result.items.map(publicThread), nextBeforeId: result.nextBeforeId }); }); },
    async history(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => { await authorizeSession(session, input.agentKey, "read", input.threadId); const result = await session.history(input.threadId, input); assertThread(result.thread, input.agentKey); return AssistantConversationHistoryResultSchema.parse({ identity: identity(session, input.agentKey), thread: publicThread(result.thread), items: await Promise.all(result.items.map(turn => publicTurn(session, assertTurn(turn, result.thread)))), nextBeforeSequence: result.nextBeforeSequence, runtimeEnabled: runtimeEnabled() }); }); },
    async submit(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationSubmitInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, true, async session => {
      await authorizeSession(session, input.agentKey, "run", input.threadId); if (input.files.length) await authorizeSession(session, input.agentKey, "upload", input.threadId);
      const thread = assertThread(await session.thread(input.threadId), input.agentKey), previous = await session.turn(input.operationId), fingerprint = logicalFingerprint(session.identity, input);
      // This check precedes mutable configuration, history, parser and runtime resolution. Lost ACK cannot enqueue or pay twice.
      if (previous) { assertTurn(previous, thread); if (previous.requestHash === null) { if (previous.state !== "canceled" || previous.sequence !== null) fail("TURN_INVALID"); return operation(session, input.agentKey, thread, previous); } if (previous.requestHash !== fingerprint.requestHash) fail("OPERATION_CONTENT_CONFLICT", true); return operation(session, input.agentKey, thread, previous); }
      if (!writesEnabled()) fail("WRITES_DISABLED"); if (!workerEnabled()) fail("WORKER_DISABLED");
      if (thread.version !== input.expectedThreadVersion || thread.activeTurn !== null) fail("THREAD_CONFLICT", true);
      const saved = await loadSavedConfiguration(session, input.agentKey); if (!saved) fail("CONFIGURATION_UNAVAILABLE");
      if (saved.revision !== input.expectedConfiguration.revision || saved.hash !== input.expectedConfiguration.hash) fail("CONFIGURATION_CONFLICT", true);
      const attachments = await parseAttachments(input.files), history = await loadHistoryContext(session, input.threadId);
      const prepared = await runtime.prepare({ executor: session.executor, identity: { ...identity(session, input.agentKey), threadId: input.threadId }, request: input, savedConfiguration: saved, attachments, ...history });
      if (prepared.requestHash !== fingerprint.requestHash || !isDeepStrictEqual(prepared.requestSnapshot, fingerprint.snapshot)) fail("REQUEST_HASH_MISMATCH", true);
      const queued = await session.enqueue({ operationId: input.operationId, threadId: input.threadId, expectedThreadVersion: input.expectedThreadVersion, mode: input.mode, request: prepared.requestSnapshot, configuration: saved, runtime: prepared.runtimeSnapshot, attachments: storedAttachments(attachments), requestHash: prepared.requestHash }); return operation(session, input.agentKey, queued.thread, queued.turn);
    }); },
    async check(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => { await authorizeSession(session, input.agentKey, "read", input.threadId); const thread = assertThread(await session.thread(input.threadId), input.agentKey); return operation(session, input.agentKey, thread, await session.turn(input.operationId)); }); },
    async cancel(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, true, async session => { await authorizeSession(session, input.agentKey, "cancel", input.threadId); assertThread(await session.thread(input.threadId), input.agentKey); const turn = await session.cancel(input); return operation(session, input.agentKey, await session.thread(input.threadId), turn); }); },
    async attachments(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => { await authorizeSession(session, input.agentKey, "read", input.threadId); const thread = assertThread(await session.thread(input.threadId), input.agentKey), turn = await session.turn(input.operationId); if (!turn) fail("TURN_UNAVAILABLE"); assertTurn(turn, thread); return AssistantConversationAttachmentsResultSchema.parse({ identity: identity(session, input.agentKey), threadId: input.threadId, operationId: input.operationId, items: (await session.attachments(input.threadId, input.operationId)).map(attachmentMetadata) }); }); },
    async attachment(ctx: TrpcContext, raw: unknown) { const input = AssistantConversationAttachmentInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, false, async session => { await authorizeSession(session, input.agentKey, "export", input.threadId); const thread = assertThread(await session.thread(input.threadId), input.agentKey), turn = await session.turn(input.operationId); if (!turn) fail("TURN_UNAVAILABLE"); assertTurn(turn, thread); const file = await session.attachmentBytes(input.threadId, input.operationId, input.ordinal); return AssistantConversationAttachmentResultSchema.parse({ identity: identity(session, input.agentKey), threadId: input.threadId, operationId: input.operationId, file: attachmentMetadata(file), base64: file.bytes.toString("base64") }); }); },
  };
}
export const assistantConversationService = createAssistantConversationService();
export const { authorizeSession, loadSavedConfiguration, loadHistoryContext, hydrateTurn } = assistantConversationService;
