import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { workspaceIdFromContext } from "../../../services/securityGovernance";
import { getSkillBySlug, normalizeSkillVersionForDb, parseManifest, rawExecute } from "../routerContext";
import {
  createSkillEvalCase,
  getSkillReleaseGateDecision,
  listSkillEvalCases,
  listSkillReplayResults,
  listSkillVersionSnapshots,
  recordSkillEvalResult,
  replaySkillEvalCase,
  upsertSkillReleaseGate,
} from "../services/skillQualityGates";
import {
  activateSkillRolloutPlan,
  approveSkillRolloutPlan,
  createSkillRolloutPlan,
  listSkillRolloutDecisions,
  listSkillRolloutPlans,
  stopSkillRolloutPlan,
} from "../services/skillRollout";
import {
  createHarnessReviewRequest,
  createParallelPlan,
  approveParallelPlanDraft,
  listExecutionPresets,
  listHarnessReviewRequests,
  listParallelPlans,
  recordHarnessFeedback,
  resolveHarnessReviewRequest,
  seedExecutionPresets,
  previewParallelPlan,
} from "../services/harnessCompletion";
import { prepareSkillRunRecovery } from "../services/directRunRecovery";

export const emperorSkillsRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }) => {
      let sql = "SELECT id,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,modelOverride,when_to_use,timeout_seconds,execution_mode,allowed_tools,disallowed_tools,model_override,createdAt,updatedAt FROM emperor_skills WHERE 1=1";
      const params: any[] = [];
      if (input.category) { sql += " AND category = ?"; params.push(input.category); }
      if (input.status) { sql += " AND status = ?"; params.push(input.status); }
      if (input.search) {
        sql += " AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)";
        params.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`);
      }
      sql += " ORDER BY category, name";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const skills = await rawExecute(sql, params);

      let countSql = "SELECT COUNT(*) as cnt FROM emperor_skills WHERE 1=1";
      const countParams: any[] = [];
      if (input.category) { countSql += " AND category = ?"; countParams.push(input.category); }
      if (input.status) { countSql += " AND status = ?"; countParams.push(input.status); }
      if (input.search) {
        countSql += " AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)";
        countParams.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`);
      }
      const countRows = await rawExecute(countSql, countParams);
      const total = countRows[0]?.cnt || 0;
      return { skills, total, page: input.page, pageSize: input.pageSize };
    }),

  categories: protectedProcedure.query(async () => {
    return rawExecute("SELECT category, COUNT(*) as count FROM emperor_skills GROUP BY category ORDER BY count DESC");
  }),

  prepareRunRecovery: protectedProcedure
    .input(z.object({ runId: z.string().min(1).max(80), expectedStateVersion: z.number().int().min(0).optional() }))
    .mutation(async ({ ctx, input }) => prepareSkillRunRecovery({
      runId: input.runId,
      userId: ctx.user.id,
      workspaceId: workspaceIdFromContext(ctx),
      isAdmin: (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin",
      expectedStateVersion: input.expectedStateVersion,
    })),

  qualityOverview: protectedProcedure
    .input(z.object({ skillSlug: z.string().optional(), skillVersion: z.string().optional() }).optional())
    .query(async ({ input }) => ({
      cases: await listSkillEvalCases(input?.skillSlug, "approved"),
      gate: input?.skillSlug ? await getSkillReleaseGateDecision(input.skillSlug, input.skillVersion) : null,
    })),

  evalCases: protectedProcedure
    .input(z.object({ skillSlug: z.string().optional(), status: z.string().optional() }).optional())
    .query(({ input }) => listSkillEvalCases(input?.skillSlug, input?.status)),

  versionSnapshots: protectedProcedure
    .input(z.object({ skillSlug: z.string().optional() }).optional())
    .query(({ input }) => listSkillVersionSnapshots(input?.skillSlug)),

  createEvalCase: adminProcedure
    .input(z.object({
      skillSlug: z.string().min(1), name: z.string().min(1).max(255), description: z.string().nullable().optional(),
      status: z.enum(["draft", "approved", "retired"]).optional(), tags: z.array(z.string()).optional(),
      inputContext: z.record(z.string(), z.any()), expectedConstraints: z.record(z.string(), z.any()).optional(), rubric: z.record(z.string(), z.any()),
      sourceArtifactId: z.string().nullable().optional(), sourceRunId: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => createSkillEvalCase({ ...input, userId: ctx.user.id })),

  recordEvalResult: adminProcedure
    .input(z.object({
      caseId: z.string().min(1), skillSlug: z.string().min(1), snapshotId: z.string().nullable().optional(), skillVersion: z.string().nullable().optional(),
      score: z.number().min(0).max(100).nullable().optional(), passed: z.boolean(), humanApproved: z.boolean().optional(), feedback: z.string().nullable().optional(),
      dimensionScores: z.record(z.string(), z.number()).optional(), outputSummary: z.record(z.string(), z.any()).optional(), sourceArtifactId: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => recordSkillEvalResult({ ...input, evaluatorUserId: ctx.user.id })),

  replayEvalCase: adminProcedure
    .input(z.object({ caseId: z.string().min(1), snapshotId: z.string().min(1) }))
    .mutation(({ input, ctx }) => replaySkillEvalCase({ ...input, userId: ctx.user.id })),

  replayResults: protectedProcedure
    .input(z.object({ skillSlug: z.string().optional(), snapshotId: z.string().optional() }).optional())
    .query(({ input }) => listSkillReplayResults(input?.skillSlug, input?.snapshotId)),

  releaseGate: protectedProcedure
    .input(z.object({ skillSlug: z.string().min(1), skillVersion: z.string().optional() }))
    .query(({ input }) => getSkillReleaseGateDecision(input.skillSlug, input.skillVersion)),

  updateReleaseGate: adminProcedure
    .input(z.object({
      skillSlug: z.string().min(1), mode: z.enum(["advisory", "enforced"]), minApprovedCases: z.number().int().min(0).max(100),
      minAverageScore: z.number().min(0).max(100), minPassRate: z.number().min(0).max(100), requireHumanApproval: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSkillReleaseGate({ ...input, userId: ctx.user.id });
      return getSkillReleaseGateDecision(input.skillSlug);
    }),

  rolloutPlans: protectedProcedure
    .input(z.object({ skillSlug: z.string().optional() }).optional())
    .query(({ input }) => listSkillRolloutPlans(input?.skillSlug)),

  rolloutDecisions: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(({ input }) => listSkillRolloutDecisions(input.planId)),

  createRolloutPlan: adminProcedure
    .input(z.object({
      skillSlug: z.string().min(1), snapshotId: z.string().min(1), rolloutPercent: z.number().int().min(0).max(50).optional(),
      allowedUserIds: z.array(z.number().int().positive()).max(100).optional(), allowedProjectIds: z.array(z.number().int().positive()).max(100).optional(),
      decisionNote: z.string().min(5).max(4000),
    }))
    .mutation(({ input, ctx }) => createSkillRolloutPlan({ ...input, userId: ctx.user.id })),

  approveRolloutPlan: adminProcedure
    .input(z.object({ planId: z.string().min(1), decisionNote: z.string().min(5).max(4000) }))
    .mutation(({ input, ctx }) => approveSkillRolloutPlan({ ...input, userId: ctx.user.id })),

  activateRolloutPlan: adminProcedure
    .input(z.object({ planId: z.string().min(1), rolloutPercent: z.number().int().min(1).max(50), decisionNote: z.string().min(5).max(4000) }))
    .mutation(({ input, ctx }) => activateSkillRolloutPlan({ ...input, userId: ctx.user.id })),

  stopRolloutPlan: adminProcedure
    .input(z.object({ planId: z.string().min(1), status: z.enum(["paused", "rolled_back", "completed"]), decisionNote: z.string().min(5).max(4000) }))
    .mutation(({ input, ctx }) => stopSkillRolloutPlan({ ...input, userId: ctx.user.id })),

  executionPresets: protectedProcedure
    .query(({ ctx }) => listExecutionPresets((ctx.user as any).defaultWorkspaceId ?? null)),

  seedExecutionPresets: adminProcedure
    .mutation(({ ctx }) => seedExecutionPresets(ctx.user.id)),

  reviewRequests: protectedProcedure
    .input(z.object({ agentRunId: z.string().optional() }).optional())
    .query(({ ctx, input }) => listHarnessReviewRequests((ctx.user as any).defaultWorkspaceId ?? null, input?.agentRunId)),

  createReviewRequest: adminProcedure
    .input(z.object({
      agentRunId: z.string().nullable().optional(), nodeId: z.string().nullable().optional(),
      requestType: z.enum(["review_required", "approval_required", "selection_required"]).optional(),
      title: z.string().min(2).max(255), candidateSummary: z.any().optional(), requestedReason: z.string().max(4000).nullable().optional(),
    }))
    .mutation(({ ctx, input }) => createHarnessReviewRequest({
      ...input, workspaceId: (ctx.user as any).defaultWorkspaceId ?? null, requestedBy: ctx.user.id,
    })),

  resolveReviewRequest: adminProcedure
    .input(z.object({
      reviewId: z.string().min(1), status: z.enum(["approved", "rejected", "selected", "canceled"]), reason: z.string().min(2).max(4000), decision: z.any().optional(),
    }))
    .mutation(({ ctx, input }) => resolveHarnessReviewRequest({ ...input, userId: ctx.user.id })),

  recordFeedbackSignal: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive().nullable().optional(), domain: z.string().min(1).max(32), artifactKey: z.string().nullable().optional(), selectionId: z.string().nullable().optional(),
      selectedArtifactId: z.string().nullable().optional(), candidateArtifactIds: z.array(z.string()).max(100).optional(), editDiff: z.any().optional(), selectionReason: z.string().max(4000).nullable().optional(),
      outcomeStatus: z.enum(["pending", "accepted", "revised", "rejected", "published"]).optional(), outcomeMetadata: z.any().optional(),
    }))
    .mutation(({ ctx, input }) => recordHarnessFeedback({
      ...input, workspaceId: (ctx.user as any).defaultWorkspaceId ?? null, userId: ctx.user.id,
    })),

  parallelPlans: protectedProcedure
    .input(z.object({ agentRunId: z.string().optional() }).optional())
    .query(({ input }) => listParallelPlans(input?.agentRunId)),

  previewParallelPlan: adminProcedure
    .input(z.object({ agentRunId: z.string().min(1), branchNodeIds: z.array(z.string().min(1)).min(2).max(8) }))
    .query(({ input }) => previewParallelPlan(input)),

  createParallelPlan: adminProcedure
    .input(z.object({
      agentRunId: z.string().min(1), parentNodeId: z.string().nullable().optional(), mergeNodeId: z.string().nullable().optional(),
      maxConcurrency: z.number().int().min(1).max(4), branchNodeIds: z.array(z.string().min(1)).min(2).max(8), policy: z.any().optional(),
    }))
    .mutation(({ ctx, input }) => createParallelPlan({
      ...input, workspaceId: (ctx.user as any).defaultWorkspaceId ?? null, userId: ctx.user.id,
    })),

  approveParallelPlanDraft: adminProcedure
    .input(z.object({ parallelPlanId: z.string().min(1), reviewId: z.string().min(1), reason: z.string().min(2).max(4000) }))
    .mutation(({ ctx, input }) => approveParallelPlanDraft({ ...input, userId: ctx.user.id })),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const skill = await getSkillBySlug(input.slug);
      if (!skill) throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      return parseManifest(skill);
    }),

  create: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      systemPrompt: z.string().optional(),
      userPromptTemplate: z.string().optional(),
      modelOverride: z.string().nullable().optional(),
      status: z.enum(["Draft","Validated","Approved","Released","Deprecated"]).optional().default("Draft"),
      // cc-haha 新字段
      whenToUse: z.string().optional(),
      timeoutSeconds: z.number().optional().default(120),
      executionMode: z.enum(["inline","fork","background"]).optional().default("inline"),
      allowedTools: z.array(z.string()).optional(),
      disallowedTools: z.array(z.string()).optional(),
      version: z.union([z.string(), z.number()]).optional().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const manifest = {
        implementation: {
          systemPrompt: input.systemPrompt || "",
          userPromptTemplate: input.userPromptTemplate || "{{context}}",
        }
      };
      await rawExecute(
        `INSERT INTO emperor_skills (slug,name,description,category,modelOverride,status,manifest,isSystem,callCount,version,when_to_use,timeout_seconds,execution_mode,allowed_tools,disallowed_tools) VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?,?,?)`,
        [
          input.slug, input.name, input.description||null, input.category||"通用",
          input.modelOverride||null, input.status||"Draft", JSON.stringify(manifest),
          normalizeSkillVersionForDb(input.version),
          input.whenToUse||null,
          input.timeoutSeconds||120,
          input.executionMode||"inline",
          input.allowedTools ? JSON.stringify(input.allowedTools) : null,
          input.disallowedTools ? JSON.stringify(input.disallowedTools) : null,
        ]
      );
      const created = await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [input.slug]);
      if (created[0]) await captureSkillVersionSnapshot({ skill: created[0], userId: ctx.user.id, source: "create" });
      return { success: true };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["Draft","Validated","Approved","Released","Deprecated"]).optional(),
      modelOverride: z.string().nullable().optional(),
      systemPrompt: z.string().optional(),
      userPromptTemplate: z.string().optional(),
      manifest: z.any().optional(),
      // cc-haha 新字段
      whenToUse: z.string().nullable().optional(),
      timeoutSeconds: z.number().nullable().optional(),
      executionMode: z.enum(["inline","fork","background"]).optional(),
      allowedTools: z.array(z.string()).nullable().optional(),
      disallowedTools: z.array(z.string()).nullable().optional(),
      version: z.union([z.string(), z.number()]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { slug, systemPrompt, userPromptTemplate, whenToUse, timeoutSeconds, executionMode, allowedTools, disallowedTools, version, ...updates } = input;
      const beforeRows = await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [slug]);
      if (!beforeRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      if (updates.status === "Released") {
        const candidateVersion = version === undefined ? String(beforeRows[0].version ?? "1") : String(version);
        const gate = await getSkillReleaseGateDecision(slug, candidateVersion);
        if (gate.mode === "enforced" && !gate.allowed) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `发布门禁未通过：${gate.reasons.join("；")}` });
        }
      }
      const sets: string[] = [];
      const params: any[] = [];
      if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
      if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
      if (updates.category !== undefined) { sets.push("category = ?"); params.push(updates.category); }
      if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
      if (updates.modelOverride !== undefined) { sets.push("modelOverride = ?"); params.push(updates.modelOverride); }
      if (updates.manifest !== undefined) { sets.push("manifest = ?"); params.push(JSON.stringify(updates.manifest)); }
      else if (systemPrompt !== undefined || userPromptTemplate !== undefined) {
        const existing = await rawExecute("SELECT manifest FROM emperor_skills WHERE slug = ? LIMIT 1", [slug]);
        const existingManifest = existing[0]?.manifest ? (typeof existing[0].manifest === "string" ? JSON.parse(existing[0].manifest) : existing[0].manifest) : {};
        if (systemPrompt !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.systemPrompt = systemPrompt; }
        if (userPromptTemplate !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.userPromptTemplate = userPromptTemplate; }
        sets.push("manifest = ?"); params.push(JSON.stringify(existingManifest));
      }
      // cc-haha 新字段
      if (whenToUse !== undefined) { sets.push("when_to_use = ?"); params.push(whenToUse); }
      if (timeoutSeconds !== undefined) { sets.push("timeout_seconds = ?"); params.push(timeoutSeconds); }
      if (executionMode !== undefined) { sets.push("execution_mode = ?"); params.push(executionMode); }
      if (allowedTools !== undefined) { sets.push("allowed_tools = ?"); params.push(allowedTools ? JSON.stringify(allowedTools) : null); }
      if (disallowedTools !== undefined) { sets.push("disallowed_tools = ?"); params.push(disallowedTools ? JSON.stringify(disallowedTools) : null); }
      if (version !== undefined) { sets.push("version = ?"); params.push(normalizeSkillVersionForDb(version)); }
      if (sets.length === 0) return { success: true };
      params.push(slug);
      await rawExecute(`UPDATE emperor_skills SET ${sets.join(", ")} WHERE slug = ?`, params);
      const updated = await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [slug]);
      if (updated[0]) await captureSkillVersionSnapshot({ skill: updated[0], userId: ctx.user.id, source: updates.status === "Released" ? "release" : "update" });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_skills WHERE slug = ?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Skill Engine Router (Run Skills)
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedModel {
  modelId: string;
  provider: string;
  baseUrl?: string;
  apiKeyRef?: string;
}
async function resolveModel(skill: any, modelOverrideSlug?: string): Promise<ResolvedModel> {
  const fromRow = (row: any): ResolvedModel => ({
    modelId: row.modelId,
    provider: row.provider,
    baseUrl: row.baseUrl || undefined,
    apiKeyRef: row.apiKeyRef || undefined,
  });
  if (modelOverrideSlug) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [modelOverrideSlug]);
    if (rows[0]) return fromRow(rows[0]);
  }
  if (skill.modelOverride) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [skill.modelOverride]);
    if (rows[0]) return fromRow(rows[0]);
  }
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  const modelPolicy = manifest?.implementation?.modelPolicy;
  if (modelPolicy) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE modelId = ? AND isActive = 1 LIMIT 1", [modelPolicy]);
    if (rows[0]) return fromRow(rows[0]);
  }
  // Fallback: try default model
  const defaultRows = await rawExecute("SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 LIMIT 1");
  if (defaultRows[0]) return fromRow(defaultRows[0]);
  return { modelId: "manus-default", provider: "manus_builtin" };
}
