import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isCheckpointedListingJob, checkpointedListingJobError } from "../../shared/checkpointedListingJob";
import { isDedicatedOnlyAiJob } from "../repositories/ai_os/dedicatedJobPolicy";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { listAiJobsForUser } from "../repositories/ai_os";
import {
  buildAiJobSnapshot,
  cancelAiJob,
  getAiJobRun,
  getAiJobRuntimeStatus,
  getAiJobWorkerHealth,
  listAiJobDeadLetterRuns,
  recoverAiJob,
  resolveAiJobHandler,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../services/aiJobRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../services/emperorSkillRunner";
import { listAiOsOperationalAlerts } from "../domains/ai_os/services/operationalScheduler";
import { recordSecurityAuditLog } from "../services/securityGovernance";
import { ensureWriteAccess, resolveProjectAccess } from "../domains/listing/routerContext";
import { startListingJobForContext } from "../domains/listing/routers/jobControl";
import {
  confirmScopedBusinessAgentOutput,
  ensureScopedBusinessAgentRun,
  SCOPED_BUSINESS_AGENT_CONFIG,
  syncScopedBusinessAgentFailure,
  syncScopedBusinessAgentProgress,
  syncScopedBusinessAgentQueued,
  syncScopedBusinessAgentWaitingHuman,
  type ScopedBusinessAgentKind,
} from "../domains/ai_os/services/scopedBusinessAgent";
import { cancelKeywordJob, confirmKeywordJob, retryKeywordJob } from "../domains/keyword/keywordGenerationJob";
import { auditBusinessJobCheckpointBindings } from "../domains/ai_os/services/businessJobCheckpointBinder";

const DEFAULT_FALLBACK_MODELS = [
  "teamo-gemini-3-8-flash",
  "teamo-deepseek-v4-flash",
  "manus-default",
];

const listingStepSchema = z.enum([
  "listing.sellingpoints.generate",
  "listing.title.generate",
  "listing.bullets.generate",
  "listing.description.generate",
  "listing.searchterms.generate",
  "listing.qa.generate",
]);

const jobQueueOptionsSchema = z.object({
  jobPriority: z.number().int().min(-1000).max(1000).optional(),
  queueName: z.string().trim().min(1).max(64).optional(),
});

const listingJobInput = z.object({
  context: z.string().min(1),
  emphasis: z.string().optional().default(""),
  variables: z.record(z.string(), z.unknown()).optional().default({}),
  modelOverride: z.string().optional(),
  projectId: z.number().optional(),
}).merge(jobQueueOptionsSchema);

const listingStepJobInput = listingJobInput.extend({ skillSlug: listingStepSchema });

const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "canceled"]);

function parseJsonOutput(content: string): unknown {
  const parsed = safeParseSkillJSON(content);
  if (parsed && typeof parsed === "object" && "raw" in parsed) {
    throw new Error("AI output is not valid JSON");
  }
  return parsed;
}

async function runListingFiveSteps(input: z.infer<typeof listingJobInput>, userId: number, workspaceId: number | null) {
  if (!workspaceId) throw new Error("Listing 任务缺少工作区，请重新创建");
  const base = {
    userId,
    workspaceId,
    context: input.context,
    emphasis: input.emphasis,
    modelOverride: input.modelOverride,
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    validate: parseJsonOutput,
  };

  const sellingPoints = await runEmperorSkill({
    ...base,
    skillSlug: "listing.sellingpoints.generate",
    variables: input.variables,
  });

  const title = await runEmperorSkill({
    ...base,
    skillSlug: "listing.title.generate",
    variables: { ...input.variables, sellingPoints: sellingPoints.parsed },
  });

  const bullets = await runEmperorSkill({
    ...base,
    skillSlug: "listing.bullets.generate",
    variables: {
      ...input.variables,
      sellingPoints: sellingPoints.parsed,
      title: title.parsed,
    },
  });

  const description = await runEmperorSkill({
    ...base,
    skillSlug: "listing.description.generate",
    variables: {
      ...input.variables,
      sellingPoints: sellingPoints.parsed,
      title: title.parsed,
      bullets: bullets.parsed,
    },
  });

  const searchTerms = await runEmperorSkill({
    ...base,
    skillSlug: "listing.searchterms.generate",
    variables: {
      ...input.variables,
      title: title.parsed,
      bullets: bullets.parsed,
      description: description.parsed,
    },
  });

  const qa = await runEmperorSkill({
    ...base,
    skillSlug: "listing.qa.generate",
    variables: {
      ...input.variables,
      title: title.parsed,
      bullets: bullets.parsed,
      description: description.parsed,
      searchTerms: searchTerms.parsed,
    },
  });

  return {
    sellingPoints,
    title,
    bullets,
    description,
    searchTerms,
    qa,
    migrationMode: "ai_job" as const,
  };
}

function assertCanReadJob(user: { id: number; role?: string }, job: { userId: number; kind?: string }) {
  if (isDedicatedOnlyAiJob(job.kind)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "IMAGE_TAGGING_USE_DEDICATED_ENDPOINT" });
  }
  if (isCheckpointedListingJob(job.kind)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: checkpointedListingJobError(job.kind, "USE_DEDICATED_ENDPOINT") });
  }
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  if (!isAdmin && job.userId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this AI job" });
  }
}

function scopedAgentKindForJob(job: { kind: string }): ScopedBusinessAgentKind | null {
  if (job.kind === "ad.searchTermAdvice") return "adSearchTerm";
  if (job.kind === "ops.replenishmentPlan") return "opsReplenishment";
  return null;
}

function agentRunIdFromJob(job: { input: unknown }) {
  const value = job.input && typeof job.input === "object" ? (job.input as any).agentRunId : null;
  return typeof value === "string" && value ? value : null;
}

registerAiJobHandler({
  id: "listing.generateFiveSteps",
  match: (job) => job.kind === "listing.generateFiveSteps",
  handler: (job) => runListingFiveSteps(listingJobInput.parse(job.input), job.userId, job.workspaceId),
});

registerAiJobHandler({
  id: "listing.runStep",
  match: (job) => job.procedure === "listingSkill.runStep",
  handler: (job) => {
    const input = listingStepJobInput.parse(job.input);
    if (!job.workspaceId) throw new Error("Listing 任务缺少工作区，请重新创建");
    return runEmperorSkill({
      skillSlug: input.skillSlug,
      userId: job.userId,
      workspaceId: job.workspaceId,
      context: input.context,
      emphasis: input.emphasis,
      variables: input.variables,
      modelOverride: input.modelOverride,
      fallbackModels: DEFAULT_FALLBACK_MODELS,
      validate: parseJsonOutput,
    });
  },
});

export const aiJobsRouter = router({
  get: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const job = await getAiJobRun(input.runId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "AI job not found" });
      assertCanReadJob(ctx.user, job);
      return job;
    }),

  runtimeStatus: adminProcedure
    .query(async () => {
      return {
        ...getAiJobRuntimeStatus(),
        workerHealth: await getAiJobWorkerHealth({ limit: 100 }),
      };
    }),

  workerHealth: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(({ input }) => {
      return getAiJobWorkerHealth({ limit: input?.limit });
    }),

  deadLetters: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await listAiJobDeadLetterRuns({ limit: input?.limit });
      return rows.filter(row => !isCheckpointedListingJob(row.kind) && !isDedicatedOnlyAiJob(row.kind));
    }),

  operationalAlerts: adminProcedure
    .input(z.object({
      status: z.enum(["open", "resolved"]).optional(),
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(({ input }) => listAiOsOperationalAlerts(input || {})),

  list: protectedProcedure
    .input(z.object({
      module: z.string().optional(),
      projectId: z.number().int().positive().optional(),
      status: jobStatusSchema.optional(),
      limit: z.number().min(1).max(100).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await listAiJobsForUser(ctx.user.id, input || {});
      return rows.filter(row => !isCheckpointedListingJob(row.kind) && !isDedicatedOnlyAiJob(row.kind)).map(buildAiJobSnapshot);
    }),

  bindingIntegrity: protectedProcedure
    .input(z.object({
      module: z.string().optional(),
      projectId: z.number().int().positive().optional(),
      limit: z.number().min(1).max(500).optional(),
    }).optional())
    .query(({ ctx, input }) => auditBusinessJobCheckpointBindings({
      userId: ctx.user.id,
      module: input?.module,
      projectId: input?.projectId,
      limit: input?.limit,
    })),

  cancel: protectedProcedure
    .input(z.object({
      runId: z.string().min(1),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const job = await getAiJobRun(input.runId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "AI job not found" });
      assertCanReadJob(ctx.user, job);
      const result = job.module === "keywordWorkflow"
        ? await cancelKeywordJob({ runId: input.runId, userId: ctx.user.id })
        : await cancelAiJob(input.runId, input.reason || "User canceled AI job");
      const scopedKind = scopedAgentKindForJob(job);
      if (scopedKind) {
        await syncScopedBusinessAgentFailure({
          kind: scopedKind,
          userId: job.userId,
          workspaceId: job.workspaceId,
          agentRunId: agentRunIdFromJob(job),
          aiJobRunId: job.runId,
          aiJobAttempt: job.attempt,
          maxAttempts: job.maxAttempts,
          finalAttempt: true,
          failureKind: "cancel",
          error: input.reason || "用户取消 AI 任务",
        }).catch((error) => console.warn("[Scoped Business Agent] Failed to sync cancellation", error));
      }
      await recordSecurityAuditLog({
        ctx,
        workspaceId: job.workspaceId,
        action: "ai_job.cancel",
        resourceType: "ai_job",
        resourceId: job.runId,
        projectId: job.projectId,
        status: "success",
        riskLevel: "medium",
        reason: input.reason,
      });
      return result;
    }),

  retry: protectedProcedure
    .input(z.object({
      runId: z.string().min(1),
      reason: z.string().trim().min(1).max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const job = await getAiJobRun(input.runId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "AI job not found" });
      assertCanReadJob(ctx.user, job);
      if (!resolveAiJobHandler(job)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该任务所属功能已停用，历史记录仍可查看" });
      const result = job.module === "keywordWorkflow"
        ? await retryKeywordJob({ runId: input.runId, userId: ctx.user.id })
        : await recoverAiJob(input.runId, input.reason || "User requested failure recovery");
      const scopedKind = scopedAgentKindForJob(job);
      if (scopedKind) {
        await syncScopedBusinessAgentQueued({
          kind: scopedKind,
          userId: result.userId,
          workspaceId: result.workspaceId,
          agentRunId: agentRunIdFromJob(result),
          aiJobRunId: result.runId,
          aiJobAttempt: 0,
          maxAttempts: result.maxAttempts,
          progress: result.progress,
        }).catch((error) => console.warn("[Scoped Business Agent] Failed to sync recovery", error));
      }
      await recordSecurityAuditLog({
        ctx,
        workspaceId: job.workspaceId,
        action: "ai_job.recover",
        resourceType: "ai_job",
        resourceId: result.runId,
        projectId: job.projectId,
        status: "success",
        riskLevel: "medium",
        reason: input.reason,
        metadata: { recoveryOfRunId: job.runId },
      });
      return result;
    }),

  confirmBusinessOutput: protectedProcedure
    .input(z.object({ runId: z.string().min(1), output: z.unknown().optional() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getAiJobRun(input.runId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "AI job not found" });
      assertCanReadJob(ctx.user, job);
      if (job.status !== "succeeded") throw new TRPCError({ code: "BAD_REQUEST", message: "AI job has not succeeded" });
      if (job.module === "keywordWorkflow") {
        return confirmKeywordJob({ runId: job.runId, userId: ctx.user.id, output: input.output });
      }
      const scopedKind = scopedAgentKindForJob(job);
      if (!scopedKind) throw new TRPCError({ code: "BAD_REQUEST", message: "This job does not use business confirmation" });
      const storedOutput = job.output && typeof job.output === "object" && "parsed" in (job.output as any)
        ? (job.output as any).parsed
        : job.output;
      const agentRunId = await confirmScopedBusinessAgentOutput({
        kind: scopedKind,
        userId: job.userId,
        workspaceId: job.workspaceId,
        agentRunId: agentRunIdFromJob(job),
        output: input.output ?? storedOutput,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId: job.workspaceId,
        action: "ai_job.confirm_output",
        resourceType: "ai_job",
        resourceId: job.runId,
        status: "success",
        riskLevel: "medium",
        metadata: { agentRunId, kind: job.kind },
      });
      return { confirmed: true, agentRunId };
    }),

  startListingFiveSteps: protectedProcedure
    .input(listingJobInput)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
        ensureWriteAccess(project, ctx.user);
        return startListingJobForContext({
          projectId: input.projectId,
          operation: "batch",
          nodeId: "G1",
          emphasis: input.emphasis,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
        });
      }
      throw new TRPCError({ code: "BAD_REQUEST", message: "Listing 后台任务必须关联项目和 Agent Run" });
    }),

  startListingStep: protectedProcedure
    .input(listingStepJobInput)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
        ensureWriteAccess(project, ctx.user);
        const stepMap = {
          "listing.sellingpoints.generate": ["sellingPoints", "G1"],
          "listing.bullets.generate": ["bullets", "G1"],
          "listing.title.generate": ["title", "G2"],
          "listing.description.generate": ["description", "G3"],
          "listing.searchterms.generate": ["searchTerms", "G4"],
          "listing.qa.generate": ["qa", "G5"],
        } as const;
        const [operation, nodeId] = stepMap[input.skillSlug];
        return startListingJobForContext({
          projectId: input.projectId,
          operation,
          nodeId,
          emphasis: input.emphasis,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
        });
      }
      throw new TRPCError({ code: "BAD_REQUEST", message: "Listing 后台任务必须关联项目和 Agent Run" });
    }),
});
