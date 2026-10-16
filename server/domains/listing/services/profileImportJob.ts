import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROFILE_IMPORT_JOB_KIND, type ProfileImportJobView } from "../../../../shared/profileImportJob";
import type { TrpcContext } from "../../../_core/context";
import type { User } from "../../../../drizzle/schema";
import {
  profileImportJobRepository, profileImportRunId, profileImportHash, profileImportError,
  decodeProfileImportInput, encodeProfileImportJson,
  type ProfileImportBinding, type ProfileImportStoredInput, type ProfileImportJobRow,
  type ProfileImportSession, type ProfileImportLease,
} from "../../../repositories/listing/profileImportJobRepository";
import { actorFromContext, assertResourceAction } from "../../../services/securityGovernance";
import { getEmperorSkillRuntimeSnapshot, runEmperorSkill } from "../../ai_os/services/skillRunner";
import { scheduleAiJobRun, registerAiJobHandler, type AiJobSnapshot } from "../../ai_os/services/jobRunner";
import { ensureListingAgentRun, syncListingNodeJobQueued, syncListingNodeJobWaitingHuman } from "../listingAgentBridge";
import { normalizeRufusProductIdentity } from "../../../routers/projectFileRufusIdentity";
import { convertProfileSourceToText, loadProfileImportSource, profileImportWorkspace } from "./profileImportSource";

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ listingProjectId: id, expectedWorkspaceId: id.nullable() }).strict();
export const startProfileImportJobSchema = scopeSchema.extend({ devProjectId: id, expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const getProfileImportJobSchema = scopeSchema.extend({ runId: z.string().regex(/^profile_[a-f0-9]{64}$/) }).strict();
export const resumeProfileImportJobSchema = getProfileImportJobSchema.extend({ expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Start = z.infer<typeof startProfileImportJobSchema>;
type Scope = { userId: number; workspaceId: number | null; listingProjectId: number };

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) profileImportError("CONFLICT", "PROFILE_IMPORT_CANCELED");
}
function view(row: ProfileImportJobRow, sourceUnchanged = true, agentCanceled = false): ProfileImportJobView {
  const { binding: b, checkpoint: cp } = row.input;
  const unknown = cp.stage === "model_dispatched" && row.status !== "running";
  const canResume = !agentCanceled && sourceUnchanged && ["failed", "canceled"].includes(row.status) && ["reserved", "analysis_ready"].includes(cp.stage);
  return {
    runId: row.runId, listingProjectId: b.listingProjectId, workspaceId: b.workspaceId, userId: b.userId,
    devProjectId: b.devProjectId, sourceHash: b.sourceHash, status: row.status, progress: row.progress,
    stage: unknown ? "model_result_unknown" : cp.stage, fileId: cp.fileId, canResume, createdAt: row.createdAt,
    message: cp.stage === "file_committed" ? "本品属性已保存，仍需事实审核" : agentCanceled ? "所属 Agent 已取消，不能恢复任务" : unknown ? "模型结果未可靠保存，禁止自动重复调用" : !sourceUnchanged ? "产品画像已变化，请重新预览" : canResume ? "可从已保存检查点恢复" : "产品画像转换任务",
  };
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PROFILE_IMPORT_FAILED_REVIEW_REQUIRED" });
}
const defaults = {
  repository: profileImportJobRepository,
  source: loadProfileImportSource,
  permission: assertResourceAction,
  ensureAgent: ensureListingAgentRun,
  schedule: scheduleAiJobRun,
  queued: syncListingNodeJobQueued,
  waiting: syncListingNodeJobWaitingHuman,
  snapshot: getEmperorSkillRuntimeSnapshot,
  skill: runEmperorSkill,
};

/** Real default dependencies; dependency injection is only for focused offline tests. */
export function createProfileImportJobService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function authorize(session: ProfileImportSession, scope: Scope) {
    const user = await session.user(scope.userId);
    if (!user || user.id !== scope.userId || user.status !== "active" || (user.defaultWorkspaceId ?? null) !== scope.workspaceId
      || typeof user.role !== "string") profileImportError("FORBIDDEN", "PROFILE_IMPORT_ACTOR_CHANGED");
    const target = await session.target(scope.listingProjectId);
    const elevated = ["super_admin", "admin", "designer"].includes(user.role);
    if (!target || target.id !== scope.listingProjectId || (target.workspaceId !== null && target.workspaceId !== scope.workspaceId)
      || (!elevated && target.userId !== scope.userId)) profileImportError("NOT_FOUND", "PROFILE_IMPORT_TARGET_UNAVAILABLE");
    // Only the user/scope fields are consumed by source access; no invented HTTP session.
    const ctx = { user: user as User, workspaceId: scope.workspaceId } as TrpcContext;
    await deps.permission({ actor: actorFromContext(ctx), resource: "file", action: "import", workspaceId: scope.workspaceId,
      projectId: scope.listingProjectId, resourceId: scope.listingProjectId, ownerUserId: target.userId as number,
      authorizationRead: { executor: session.executor, strict: true, lock: true } });
    return ctx;
  }
  async function source(session: ProfileImportSession, scope: Scope, devProjectId: number, expectedSourceHash?: string) {
    const ctx = await authorize(session, scope);
    const loaded = await deps.source(ctx, { devProjectId, expectedWorkspaceId: scope.workspaceId, expectedSourceHash }, { executor: session.executor, lock: "share" });
    if (!loaded.profile || !loaded.sourceHash) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_SOURCE_MISSING");
    return { ...loaded, actorRole: ctx.user!.role };
  }
  function requestScope(ctx: TrpcContext, input: z.infer<typeof scopeSchema>): Scope {
    return { userId: ctx.user?.id ?? 0, workspaceId: profileImportWorkspace(ctx, input.expectedWorkspaceId), listingProjectId: input.listingProjectId };
  }
  function assertJobScope(row: ProfileImportJobRow | null, scope: Scope): asserts row is ProfileImportJobRow {
    if (!row || row.userId !== scope.userId || row.workspaceId !== scope.workspaceId || row.projectId !== scope.listingProjectId) profileImportError("NOT_FOUND", "PROFILE_IMPORT_JOB_UNAVAILABLE");
  }
  async function bound(session: ProfileImportSession, row: ProfileImportJobRow, signal?: AbortSignal) {
    assertNotAborted(signal);
    const b = row.input.binding;
    const loaded = await source(session, b, b.devProjectId, b.sourceHash);
    if (loaded.profile!.id !== b.profileId) profileImportError("CONFLICT", "PROFILE_IMPORT_SOURCE_CHANGED");
    await session.assertAgent(row.input);
    // Match the existing fact-source content hash convention. The model, complete
    // inline artifact and file hash all use this one normalized human-authored text.
    const text = convertProfileSourceToText(loaded.profile!, loaded.project.name).replace(/\r\n?/gu, "\n").trim();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_TEXT_TOO_LARGE");
    assertNotAborted(signal);
    return { loaded, text };
  }
  function sync(row: ProfileImportJobRow) {
    const b = row.input.binding;
    return { agentRunId: row.input.agentRunId, nodeId: "N3" as const, projectId: b.listingProjectId,
      userId: b.userId, workspaceId: b.workspaceId, aiJobRunId: row.runId, aiJobAttempt: row.attempt, aiJobMaxAttempts: 1 };
  }
  async function start(ctx: TrpcContext, raw: Start): Promise<ProfileImportJobView> {
    try {
      const input = startProfileImportJobSchema.parse(raw), scope = requestScope(ctx, input);
      const binding = await deps.repository.transaction(async session => {
        const loaded = await source(session, scope, input.devProjectId, input.expectedSourceHash);
        const text = convertProfileSourceToText(loaded.profile!, loaded.project.name);
        if (Buffer.byteLength(text, "utf8") > 1024 * 1024) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_TEXT_TOO_LARGE");
        const binding: ProfileImportBinding = { version: 1, ...scope, devProjectId: input.devProjectId, profileId: loaded.profile!.id, sourceHash: loaded.sourceHash!, converterVersion: 1 };
        return binding;
      });
      // Finish the source-only transaction before locking the anchor. All transactions
      // that acquire both locks use job -> authorization/source, including list/get.
      const previous = await deps.repository.transaction(async session => {
        const row = await session.job(profileImportRunId(binding));
        if (row) { assertJobScope(row, scope); await bound(session, row); }
        return row;
      });
      if (previous) {
        if (previous.status === "queued") await deps.schedule(previous.runId);
        return view(previous);
      }
      const agentRunId = await deps.ensureAgent({ projectId: scope.listingProjectId, userId: scope.userId, workspaceId: scope.workspaceId });
      if (!agentRunId) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_AGENT_UNAVAILABLE");
      let row: ProfileImportJobRow;
      try {
        row = await deps.repository.transaction(async session => {
          const runId = profileImportRunId(binding), existing = await session.job(runId);
          const stored: ProfileImportStoredInput = { version: 1, binding, agentRunId, agentNodeId: "N3",
            checkpoint: { stage: "reserved", analysisJson: null, analysisHash: null, fileId: null, skillRunId: null } };
          if (existing) { assertJobScope(existing, scope); await bound(session, existing); return existing; }
          await source(session, scope, input.devProjectId, binding.sourceHash);
          await session.assertAgent(stored);
          return session.reserve(stored);
        });
      } catch (error) {
        // A unique-key/deadlock race may have committed the other request. Never recreate or change its identity.
        if (!(error instanceof TRPCError) || error.message !== "PROFILE_IMPORT_STORAGE_CONFLICT") throw error;
        row = await deps.repository.transaction(async session => {
          const existing = await session.job(profileImportRunId(binding));
          assertJobScope(existing, scope); await bound(session, existing); return existing;
        });
      }
      await deps.queued(sync(row));
      if (row.status === "queued") await deps.schedule(row.runId);
      return view(row);
    } catch (error) { return safeError(error); }
  }
  async function get(ctx: TrpcContext, raw: z.infer<typeof getProfileImportJobSchema>) {
    try {
      const input = getProfileImportJobSchema.parse(raw), scope = requestScope(ctx, input);
      return await deps.repository.transaction(async session => {
        const row = await session.job(input.runId); assertJobScope(row, scope);
        const loaded = await source(session, scope, row.input.binding.devProjectId);
        const agent = await session.assertAgent(row.input, { allowCanceledRead: true });
        return view(row, loaded.sourceHash === row.input.binding.sourceHash, agent.canceled);
      });
    } catch (error) { return safeError(error); }
  }
  async function list(ctx: TrpcContext, raw: z.infer<typeof scopeSchema>) {
    try {
      const input = scopeSchema.parse(raw), scope = requestScope(ctx, input);
      return await deps.repository.transaction(async session => {
        const rows = await session.list(scope.userId, scope.workspaceId, scope.listingProjectId), result: ProfileImportJobView[] = [];
        const authorizedContext = await authorize(session, scope);
        for (const row of rows) {
          assertJobScope(row, scope);
          let loaded: Awaited<ReturnType<typeof deps.source>>;
          try {
            // The actor and target are already authorized and locked above. Hide only
            // inaccessible historical sources; database/schema/target failures remain fatal.
            loaded = await deps.source(authorizedContext, { devProjectId: row.input.binding.devProjectId, expectedWorkspaceId: scope.workspaceId }, { executor: session.executor, lock: "share" });
          } catch (error) {
            if (error instanceof TRPCError && error.code === "NOT_FOUND") continue;
            throw error;
          }
          if (!loaded.profile) continue;
          const agent = await session.assertAgent(row.input, { allowCanceledRead: true });
          result.push(view(row, loaded.sourceHash === row.input.binding.sourceHash, agent.canceled));
        }
        return result;
      });
    } catch (error) { return safeError(error); }
  }
  async function resume(ctx: TrpcContext, raw: z.infer<typeof resumeProfileImportJobSchema>) {
    try {
      const input = resumeProfileImportJobSchema.parse(raw), scope = requestScope(ctx, input);
      const row = await deps.repository.transaction(async session => {
        const existing = await session.job(input.runId); assertJobScope(existing, scope);
        if (existing.input.binding.sourceHash !== input.expectedSourceHash) profileImportError("CONFLICT", "PROFILE_IMPORT_SOURCE_CHANGED");
        await bound(session, existing);
        if (existing.status === "succeeded" || existing.status === "queued" || existing.status === "running") return existing;
        return session.resume(existing);
      });
      if (row.status === "queued") { await deps.queued(sync(row)); await deps.schedule(row.runId); }
      return view(row);
    } catch (error) { return safeError(error); }
  }
  async function run(job: AiJobSnapshot, { signal }: { signal: AbortSignal }) {
    try {
      if (job.kind !== PROFILE_IMPORT_JOB_KIND || job.module !== "listing" || !job.lockedBy) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JOB_BINDING_INVALID");
      const input = decodeProfileImportInput(job.input), b = input.binding;
      if (job.runId !== profileImportRunId(b) || job.userId !== b.userId || job.projectId !== b.listingProjectId || job.workspaceId !== b.workspaceId) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JOB_BINDING_INVALID");
      const lease: ProfileImportLease = { runId: job.runId, attempt: job.attempt, lockedBy: job.lockedBy, signal };
      const before = await deps.repository.transaction(async session => {
        const row = await session.job(job.runId); assertJobScope(row, b);
        session.assertLease(row, lease); await bound(session, row, signal); session.assertLease(row, lease);
        if (row.input.checkpoint.stage === "model_dispatched") profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_MODEL_RESULT_UNKNOWN");
        return row;
      });
      if (before.input.checkpoint.stage === "reserved") {
        const snapshot = await deps.snapshot("analysis.rufus.attribute", b.workspaceId);
        if (snapshot.status !== "Released" || !snapshot.systemPromptLength || !snapshot.version) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_SKILL_NOT_RELEASED");
        const text = await deps.repository.transaction(async session => {
          const row = await session.job(job.runId); assertJobScope(row, b); session.assertLease(row, lease);
          const current = await bound(session, row, signal);
          if (row.input.checkpoint.stage !== "reserved") profileImportError("CONFLICT", "PROFILE_IMPORT_ALREADY_DISPATCHED");
          session.assertLease(row, lease);
          await session.checkpoint(row, { ...row.input, checkpoint: { ...row.input.checkpoint, stage: "model_dispatched" } }, lease);
          return current.text;
        });
        assertNotAborted(signal);
        const result = await deps.skill({
          skillSlug: "analysis.rufus.attribute", userId: b.userId, workspaceId: b.workspaceId, projectId: b.listingProjectId,
          context: text, variables: { context: text }, migrationSource: "project_file.product_attributes",
          skillVersionPolicy: "pinned", expectedSkillVersion: snapshot.version, expectedSkillPromptHash: snapshot.systemPromptHash,
          signal, maxModelAttempts: 1, fallbackModels: [], validate: (content: string) => {
            let parsed: unknown;
            try { parsed = JSON.parse(content); } catch { return profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_ANALYSIS_INVALID"); }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_ANALYSIS_INVALID");
            const normalized = normalizeRufusProductIdentity(text, parsed);
            encodeProfileImportJson(normalized);
            return normalized;
          },
        }).catch(() => profileImportError("INTERNAL_SERVER_ERROR", "PROFILE_IMPORT_MODEL_FAILED_REVIEW_REQUIRED"));
        const analysisJson = encodeProfileImportJson(result.parsed);
        await deps.repository.transaction(async session => {
          const row = await session.job(job.runId); assertJobScope(row, b); session.assertLease(row, lease);
          await bound(session, row, signal);
          if (row.input.checkpoint.stage !== "model_dispatched") profileImportError("CONFLICT", "PROFILE_IMPORT_STAGE_CHANGED");
          session.assertLease(row, lease);
          await session.checkpoint(row, { ...row.input, checkpoint: { ...row.input.checkpoint, stage: "analysis_ready", analysisJson,
            analysisHash: profileImportHash(analysisJson), skillRunId: result.runId } }, lease);
        });
      }
      const completed = await deps.repository.transaction(async session => {
        const row = await session.job(job.runId); assertJobScope(row, b); session.assertLease(row, lease);
        const { loaded, text } = await bound(session, row, signal);
        const parsed = { type: "text", lineCount: text.split("\n").length, charCount: text.length, source: "product_profile_import",
          provenance: { kind: "dev_product_profile", devProjectId: b.devProjectId, profileId: b.profileId, sourceHash: b.sourceHash,
            projectUpdatedAt: loaded.project.updatedAt.toISOString(), profileUpdatedAt: loaded.profile!.updatedAt.toISOString(),
            previewVersionBound: true, aiSuggestionsIncluded: false, factReviewRequired: true, converterVersion: 1 } };
        session.assertLease(row, lease);
        return session.commitFile(row, text, parsed, lease, loaded.actorRole);
      });
      await deps.waiting({ ...sync(completed), output: { projectFileId: completed.input.checkpoint.fileId, factReviewRequired: true } });
      return view(completed);
    } catch (error) { return safeError(error); }
  }
  return { start, get, list, resume, run };
}
const service = createProfileImportJobService();
export const startProfileImportJob = service.start;
export const getProfileImportJob = service.get;
export const listProfileImportJobs = service.list;
export const resumeProfileImportJob = service.resume;
export const runProfileImportJob = service.run;
registerAiJobHandler({ id: PROFILE_IMPORT_JOB_KIND, match: job => job.kind === PROFILE_IMPORT_JOB_KIND && job.module === "listing", handler: runProfileImportJob });
