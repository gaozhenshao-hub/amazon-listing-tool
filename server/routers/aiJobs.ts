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
  registerAiJobHandler,
  startRegisteredAiJob,
} from "../services/aiJobRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../services/emperorSkillRunner";

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

async function runAdSearchTermAdvice(input: z.infer<typeof adSearchTermJobInput>, userId: number) {
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
    userId,
    context,
    variables: {
      categoryId: input.categoryId,
      categoryLabel,
      campaignId: input.campaignId,
      searchTerms: anonymizedTerms,
    },
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    validate: (content) => safeParseSkillJSON(content),
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

async function runOpsReplenishmentPlan(input: z.infer<typeof opsReplenishmentJobInput>, userId: number) {
  const context = [
    "你是一位资深亚马逊 FBA 库存管理专家。请根据 SKU 数据生成结构化补货建议。",
    "输出 JSON，优先包含 suggestions 数组。",
    "",
    JSON.stringify(input.skuData, null, 2),
  ].join("\n");

  const result = await runEmperorSkill({
    skillSlug: "ops.inventory.analysis",
    userId,
    context,
    variables: {
      skuData: input.skuData,
    },
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    validate: (content) => safeParseSkillJSON(content),
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
  handler: (job) => runAdSearchTermAdvice(adSearchTermJobInput.parse(job.input), job.userId),
});

registerAiJobHandler({
  id: "ops.replenishmentPlan",
  match: (job) => job.kind === "ops.replenishmentPlan",
  handler: (job) => runOpsReplenishmentPlan(opsReplenishmentJobInput.parse(job.input), job.userId),
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

  list: protectedProcedure
    .input(z.object({
      module: z.string().optional(),
      status: jobStatusSchema.optional(),
      limit: z.number().min(1).max(100).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await listAiJobsForUser(ctx.user.id, input || {});
      return rows.map(buildAiJobSnapshot);
    }),

  cancel: protectedProcedure
    .input(z.object({
      runId: z.string().min(1),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const job = await getAiJobRun(input.runId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "AI job not found" });
      assertCanReadJob(ctx.user, job);
      return cancelAiJob(input.runId, input.reason || "User canceled AI job");
    }),

  startListingFiveSteps: protectedProcedure
    .input(listingJobInput)
    .mutation(async ({ ctx, input }) => {
      return startRegisteredAiJob({
        kind: "listing.generateFiveSteps",
        module: "listing",
        procedure: "listingSkill.generateFiveSteps",
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
        skillSlug: "listing.*",
        input,
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
      });
    }),

  startListingStep: protectedProcedure
    .input(listingStepJobInput)
    .mutation(async ({ ctx, input }) => {
      return startRegisteredAiJob({
        kind: `listing.${input.skillSlug}`,
        module: "listing",
        procedure: "listingSkill.runStep",
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
        skillSlug: input.skillSlug,
        input,
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
      });
    }),

  startAdSearchTermAdvice: protectedProcedure
    .input(adSearchTermJobInput)
    .mutation(async ({ ctx, input }) => {
      return startRegisteredAiJob({
        kind: "ad.searchTermAdvice",
        module: "adAnalysis",
        procedure: "adAnalysis.aiSearchTermAdvice",
        userId: ctx.user.id,
        skillSlug: "ad.searchterm.advice",
        input,
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
      });
    }),

  startOpsReplenishmentPlan: protectedProcedure
    .input(opsReplenishmentJobInput)
    .mutation(async ({ ctx, input }) => {
      return startRegisteredAiJob({
        kind: "ops.replenishmentPlan",
        module: "operations",
        procedure: "operations.aiReplenishmentPlan",
        userId: ctx.user.id,
        skillSlug: "ops.inventory.analysis",
        input,
        progress: 5,
        priority: input.jobPriority ?? 0,
        queueName: input.queueName,
      });
    }),
});
