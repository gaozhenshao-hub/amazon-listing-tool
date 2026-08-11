import { TRPCError } from "@trpc/server";
import { z } from "zod";
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
import { cancelVideoGenerationJob, retryVideoGenerationJob } from "../domains/video/videoGenerationJob";
import { auditBusinessJobCheckpointBindings } from "../domains/ai_os/services/businessJobCheckpointBinder";

const DEFAULT_FALLBACK_MODELS = [
  "claude-sonnet-5",
  "gemini-3-6-flash",
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

const adSearchTermJobInput = z.object({
  searchTerms: z.array(z.record(z.string(), z.unknown())).max(50),
  categoryId: z.number(),
  categoryLabel: z.string().optional(),
  campaignId: z.string().optional(),
  agentRunId: z.string().min(1).optional(),
}).merge(jobQueueOptionsSchema);

const opsReplenishmentJobInput = z.object({
  skuData: z.array(z.object({
    seller_sku: z.string(),
    product_name: z.string().optional(),
    fulfillable_qty: z.number(),
    avg_daily_sales: z.number(),
    days_of_supply: z.number(),
    lead_time_days: z.number().optional().default(30),
    safety_stock_days: z.number().optional().default(14),
    moq: z.number().optional().default(100),
  })).max(20),
  agentRunId: z.string().min(1).optional(),
}).merge(jobQueueOptionsSchema);

const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "canceled"]);

function parseJsonOutput(content: string): unknown {
  const parsed = safeParseSkillJSON(content);
  if (parsed && typeof parsed === "object" && "raw" in parsed) {
    throw new Error("AI output is not valid JSON");
  }
  return parsed;
}

async function runListingFiveSteps(input: z.infer<typeof listingJobInput>, userId: number) {
  const base = {
    userId,
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

function anonymizeSearchTerms(searchTerms: Array<Record<string, unknown>>) {
  return searchTerms.map((term, idx) => {
    const { asin, advertised_asin, sku, campaign_id, ad_group_id, ...metrics } = term as Record<string, unknown>;
    return {
      ...metrics,
      product_id: `Product_${String(idx + 1).padStart(3, "0")}`,
    };
  });
}

function normalizeAdAdviceOutput(parsed: unknown) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const record = parsed as Record<string, any>;
  if (Array.isArray(record.advice)) return record;
  if (Array.isArray(record.recommendations)) {
    return {
      category_summary: record.summary || "AI 已生成搜索词优化建议。",
      top_actions: record.recommendations.slice(0, 5).map((item: any) => item.reason || item.action).filter(Boolean),
      advice: record.recommendations.map((item: any) => ({
        search_term: item.keyword || item.search_term || "",
        problem_analysis: item.reason || "",
        ad_purpose: item.action || "",
        ad_strategy: Array.isArray(item.strategy)
          ? item.strategy.join("；")
          : [item.suggestedBid ? `建议出价：${item.suggestedBid}` : item.action].filter(Boolean).join("；"),
        expected_result: item.expected_result || "",
        priority: item.priority || "medium",
        suggested_action: item.suggested_action || item.action || "monitor",
      })),
    };
  }
  return record;
}

async function runAdSearchTermAdvice(input: z.infer<typeof adSearchTermJobInput>, job: AiJobSnapshot, signal: AbortSignal) {
  const anonymizedTerms = anonymizeSearchTerms(input.searchTerms);
  const categoryLabel = input.categoryLabel || `分类 ${input.categoryId}`;
  const context = [
    `分类：${categoryLabel}`,
    input.campaignId ? `广告活动：${input.campaignId}` : "",
    "请为搜索词生成可执行广告优化建议，输出 JSON。",
    "",
    JSON.stringify(anonymizedTerms),
  ].filter(Boolean).join("\n");

  const result = await runEmperorSkill({
    skillSlug: "ad.searchterm.advice",
    userId: job.userId,
    workspaceId: job.workspaceId,
    context,
    variables: {
      categoryId: input.categoryId,
      categoryLabel,
      campaignId: input.campaignId,
      searchTerms: anonymizedTerms,
    },
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    validate: (content) => safeParseSkillJSON(content),
    signal,
  });

  return {
    ...result,
    parsed: normalizeAdAdviceOutput(result.parsed),
  };
}

function normalizeReplenishmentOutput(parsed: unknown, skuData: z.infer<typeof opsReplenishmentJobInput>["skuData"]) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const record = parsed as Record<string, any>;
  if (Array.isArray(record.suggestions)) return record;
  if (Array.isArray(record.actions)) {
    return {
      suggestions: skuData.map((sku, index) => {
        const action = record.actions[index] || record.actions[0] || {};
        return {
          seller_sku: sku.seller_sku,
          urgency: record.riskLevel === "高" ? "urgent" : record.riskLevel === "中" ? "soon" : "plan",
          suggested_qty: Number(action.suggested_qty || sku.moq || 0),
          reason: action.action || record.reorderRecommendation || record.status || "建议结合库存周转继续观察。",
          estimated_stockout_date: action.deadline || "",
          notes: action.priority || record.summary || "",
        };
      }),
    };
  }
  return record;
}

async function runOpsReplenishmentPlan(input: z.infer<typeof opsReplenishmentJobInput>, job: AiJobSnapshot, signal: AbortSignal) {
  const context = [
    "你是一位资深亚马逊 FBA 库存管理专家。请根据 SKU 数据生成结构化补货建议。",
    "输出 JSON，优先包含 suggestions 数组。",
    "",
    JSON.stringify(input.skuData, null, 2),
  ].join("\n");

  const result = await runEmperorSkill({
    skillSlug: "ops.inventory.analysis",
    userId: job.userId,
    workspaceId: job.workspaceId,
    context,
    variables: {
      skuData: input.skuData,
    },
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    validate: (content) => safeParseSkillJSON(content),
    signal,
  });

  return {
    ...result,
    parsed: normalizeReplenishmentOutput(result.parsed, input.skuData),
  };
}

function assertCanReadJob(user: { id: number; role?: string }, job: { userId: number }) {
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

async function runScopedBusinessJob<TInput extends { agentRunId?: string }, TResult extends { parsed?: unknown }>(input: {
  job: AiJobSnapshot;
  signal: AbortSignal;
  kind: ScopedBusinessAgentKind;
  parsedInput: TInput;
  execute: (parsedInput: TInput, job: AiJobSnapshot, signal: AbortSignal) => Promise<TResult>;
}) {
  const agentRunId = input.parsedInput.agentRunId || (await ensureScopedBusinessAgentRun({
    kind: input.kind,
    userId: input.job.userId,
    workspaceId: input.job.workspaceId,
  })).runId;
  try {
    await updateAiJobProgress(input.job.runId, 15, {
      expectedWorkerId: input.job.lockedBy || undefined,
      expectedAttempt: input.job.attempt,
    });
    await syncScopedBusinessAgentProgress({
      kind: input.kind,
      userId: input.job.userId,
      workspaceId: input.job.workspaceId,
      agentRunId,
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      maxAttempts: input.job.maxAttempts,
      progress: 15,
    });
    const result = await input.execute(input.parsedInput, input.job, input.signal);
    await updateAiJobProgress(input.job.runId, 90, {
      expectedWorkerId: input.job.lockedBy || undefined,
      expectedAttempt: input.job.attempt,
    });
    await syncScopedBusinessAgentWaitingHuman({
      kind: input.kind,
      userId: input.job.userId,
      workspaceId: input.job.workspaceId,
      agentRunId,
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      output: result.parsed ?? result,
    });
    return result;
  } catch (error) {
    const abortReason = input.signal.aborted ? String(input.signal.reason || "") : "";
    const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
    const finalAttempt = input.job.attempt >= input.job.maxAttempts || (input.signal.aborted && !retryableTimeout);
    await syncScopedBusinessAgentFailure({
      kind: input.kind,
      userId: input.job.userId,
      workspaceId: input.job.workspaceId,
      agentRunId,
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      maxAttempts: input.job.maxAttempts,
      finalAttempt,
      error,
      failureKind: input.signal.aborted ? (retryableTimeout ? "timeout" : "cancel") : "error",
    }).catch((syncError) => console.warn("[Scoped Business Agent] Failed to sync job failure", syncError));
    throw error;
  }
}

registerAiJobHandler({
  id: "listing.generateFiveSteps",
  match: (job) => job.kind === "listing.generateFiveSteps",
  handler: (job) => runListingFiveSteps(listingJobInput.parse(job.input), job.userId),
});

registerAiJobHandler({
  id: "listing.runStep",
  match: (job) => job.procedure === "listingSkill.runStep",
  handler: (job) => {
    const input = listingStepJobInput.parse(job.input);
    return runEmperorSkill({
      skillSlug: input.skillSlug,
      userId: job.userId,
      context: input.context,
      emphasis: input.emphasis,
      variables: input.variables,
      modelOverride: input.modelOverride,
      fallbackModels: DEFAULT_FALLBACK_MODELS,
      validate: parseJsonOutput,
    });
  },
});

registerAiJobHandler({
  id: "ad.searchTermAdvice",
  match: (job) => job.kind === "ad.searchTermAdvice",
  handler: (job, context) => runScopedBusinessJob({
    job,
    signal: context.signal,
    kind: "adSearchTerm",
    parsedInput: adSearchTermJobInput.parse(job.input),
    execute: runAdSearchTermAdvice,
  }),
});

registerAiJobHandler({
  id: "ops.replenishmentPlan",
  match: (job) => job.kind === "ops.replenishmentPlan",
  handler: (job, context) => runScopedBusinessJob({
    job,
    signal: context.signal,
    kind: "opsReplenishment",
    parsedInput: opsReplenishmentJobInput.parse(job.input),
    execute: runOpsReplenishmentPlan,
  }),
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
    .query(({ input }) => {
      return listAiJobDeadLetterRuns({ limit: input?.limit });
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
      return rows.map(buildAiJobSnapshot);
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
        : job.module === "videoScript"
          ? await cancelVideoGenerationJob({ runId: input.runId, userId: ctx.user.id })
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
      const result = job.module === "keywordWorkflow"
        ? await retryKeywordJob({ runId: input.runId, userId: ctx.user.id })
        : job.module === "videoScript"
          ? await retryVideoGenerationJob({ runId: input.runId, userId: ctx.user.id })
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
        const project = await resolveProjectAccess(input.projectId, ctx.user);
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
        const project = await resolveProjectAccess(input.projectId, ctx.user);
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

  startAdSearchTermAdvice: protectedProcedure
    .input(adSearchTermJobInput)
    .mutation(async ({ ctx, input }) => {
      const agent = await ensureScopedBusinessAgentRun({
        kind: "adSearchTerm",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        inputs: { categoryId: input.categoryId, campaignId: input.campaignId || null },
      });
      const job = await startRegisteredAiJob({
        kind: "ad.searchTermAdvice",
        module: "adAnalysis",
        procedure: "adAnalysis.aiSearchTermAdvice",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        skillSlug: "ad.searchterm.advice",
        input: {
          ...input,
          agentRunId: agent.runId,
          agentNodeId: SCOPED_BUSINESS_AGENT_CONFIG.adSearchTerm.nodeId,
        },
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
        maxAttempts: 3,
        timeoutSeconds: 420,
      });
      await syncScopedBusinessAgentQueued({
        kind: "adSearchTerm",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        agentRunId: agent.runId,
        aiJobRunId: job.runId,
        aiJobAttempt: 0,
        maxAttempts: job.maxAttempts,
        progress: job.progress,
      });
      return { ...job, agentRunId: agent.runId };
    }),

  startOpsReplenishmentPlan: protectedProcedure
    .input(opsReplenishmentJobInput)
    .mutation(async ({ ctx, input }) => {
      const agent = await ensureScopedBusinessAgentRun({
        kind: "opsReplenishment",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        inputs: { skuCount: input.skuData.length },
      });
      const job = await startRegisteredAiJob({
        kind: "ops.replenishmentPlan",
        module: "operations",
        procedure: "operations.aiReplenishmentPlan",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        skillSlug: "ops.inventory.analysis",
        input: {
          ...input,
          agentRunId: agent.runId,
          agentNodeId: SCOPED_BUSINESS_AGENT_CONFIG.opsReplenishment.nodeId,
        },
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
        maxAttempts: 3,
        timeoutSeconds: 420,
      });
      await syncScopedBusinessAgentQueued({
        kind: "opsReplenishment",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        agentRunId: agent.runId,
        aiJobRunId: job.runId,
        aiJobAttempt: 0,
        maxAttempts: job.maxAttempts,
        progress: job.progress,
      });
      return { ...job, agentRunId: agent.runId };
    }),
});
