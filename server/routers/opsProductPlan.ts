import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { productOpsPlans, productOpsDailyRecords, keywordTrackings, keywordDailyRecords, competitorAdBenchmarks, promotionPhases } from "../../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

export const opsProductPlanRouter = router({

  // ─── CRUD: Product Ops Plans ────────────────────────────────
  listPlans: protectedProcedure
    .input(z.object({ asin: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [eq(productOpsPlans.userId, ctx.user.id)];
      if (input.asin) conditions.push(eq(productOpsPlans.asin, input.asin));
      return db.select().from(productOpsPlans).where(and(...conditions)).orderBy(desc(productOpsPlans.createdAt));
    }),

  getPlan: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [plan] = await db.select().from(productOpsPlans).where(eq(productOpsPlans.id, input.planId));
      return plan || null;
    }),

  createPlan: protectedProcedure
    .input(z.object({
      asin: z.string(),
      planName: z.string(),
      productProfileId: z.number().optional(),
      targetBsr: z.number().optional(),
      targetDailyOrders: z.number().optional(),
      targetAdOrders: z.number().optional(),
      targetOrganicOrders: z.number().optional(),
      targetAcos: z.number().optional(),
      targetProfitMargin: z.number().optional(),
      targetOrganicRatio: z.number().optional(),
      targetConversionRate: z.number().optional(),
      promotionCycleDays: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [result] = await db.insert(productOpsPlans).values({
        userId: ctx.user.id,
        asin: input.asin,
        planName: input.planName,
        productProfileId: input.productProfileId,
        targetBsr: input.targetBsr,
        targetDailyOrders: input.targetDailyOrders?.toString(),
        targetAdOrders: input.targetAdOrders?.toString(),
        targetOrganicOrders: input.targetOrganicOrders?.toString(),
        targetAcos: input.targetAcos?.toString(),
        targetProfitMargin: input.targetProfitMargin?.toString(),
        targetOrganicRatio: input.targetOrganicRatio?.toString(),
        targetConversionRate: input.targetConversionRate?.toString(),
        promotionCycleDays: input.promotionCycleDays,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes,
      });
      return { id: result.insertId };
    }),

  updatePlan: protectedProcedure
    .input(z.object({
      planId: z.number(),
      planName: z.string().optional(),
      targetBsr: z.number().optional(),
      targetDailyOrders: z.number().optional(),
      targetAdOrders: z.number().optional(),
      targetOrganicOrders: z.number().optional(),
      targetAcos: z.number().optional(),
      targetProfitMargin: z.number().optional(),
      targetOrganicRatio: z.number().optional(),
      targetConversionRate: z.number().optional(),
      promotionCycleDays: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.enum(["planning", "active", "completed", "paused"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const updates: any = {};
      if (input.planName !== undefined) updates.planName = input.planName;
      if (input.targetBsr !== undefined) updates.targetBsr = input.targetBsr;
      if (input.targetDailyOrders !== undefined) updates.targetDailyOrders = input.targetDailyOrders.toString();
      if (input.targetAdOrders !== undefined) updates.targetAdOrders = input.targetAdOrders.toString();
      if (input.targetOrganicOrders !== undefined) updates.targetOrganicOrders = input.targetOrganicOrders.toString();
      if (input.targetAcos !== undefined) updates.targetAcos = input.targetAcos.toString();
      if (input.targetProfitMargin !== undefined) updates.targetProfitMargin = input.targetProfitMargin.toString();
      if (input.targetOrganicRatio !== undefined) updates.targetOrganicRatio = input.targetOrganicRatio.toString();
      if (input.targetConversionRate !== undefined) updates.targetConversionRate = input.targetConversionRate.toString();
      if (input.promotionCycleDays !== undefined) updates.promotionCycleDays = input.promotionCycleDays;
      if (input.startDate !== undefined) updates.startDate = input.startDate;
      if (input.endDate !== undefined) updates.endDate = input.endDate;
      if (input.status !== undefined) updates.status = input.status;
      if (input.notes !== undefined) updates.notes = input.notes;
      await db.update(productOpsPlans).set(updates).where(eq(productOpsPlans.id, input.planId));
      return { success: true };
    }),

  deletePlan: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(productOpsPlans).where(eq(productOpsPlans.id, input.planId));
      return { success: true };
    }),

  // ─── Daily Records ────────────────────────────────
  getDailyRecords: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(productOpsDailyRecords)
        .where(eq(productOpsDailyRecords.planId, input.planId))
        .orderBy(asc(productOpsDailyRecords.recordDate));
    }),

  upsertDailyRecord: protectedProcedure
    .input(z.object({
      planId: z.number(),
      recordDate: z.string(),
      actualBsr: z.number().optional(),
      actualImpressions: z.number().optional(),
      actualTotalOrders: z.number().optional(),
      actualAdOrders: z.number().optional(),
      actualOrganicOrders: z.number().optional(),
      actualAcos: z.number().optional(),
      actualProfitMargin: z.number().optional(),
      actualConversionRate: z.number().optional(),
      actualOrganicRatio: z.number().optional(),
      actualUnitPrice: z.number().optional(),
      actualSales: z.number().optional(),
      actualAdSpend: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const existing = await db.select().from(productOpsDailyRecords)
        .where(and(
          eq(productOpsDailyRecords.planId, input.planId),
          eq(productOpsDailyRecords.recordDate, input.recordDate),
        ));

      const values: any = {
        planId: input.planId,
        recordDate: input.recordDate,
        actualBsr: input.actualBsr,
        actualImpressions: input.actualImpressions,
        actualTotalOrders: input.actualTotalOrders,
        actualAdOrders: input.actualAdOrders,
        actualOrganicOrders: input.actualOrganicOrders,
        actualAcos: input.actualAcos?.toString(),
        actualProfitMargin: input.actualProfitMargin?.toString(),
        actualConversionRate: input.actualConversionRate?.toString(),
        actualOrganicRatio: input.actualOrganicRatio?.toString(),
        actualUnitPrice: input.actualUnitPrice?.toString(),
        actualSales: input.actualSales?.toString(),
        actualAdSpend: input.actualAdSpend?.toString(),
        notes: input.notes,
      };

      if (existing.length > 0) {
        await db.update(productOpsDailyRecords).set(values).where(eq(productOpsDailyRecords.id, existing[0].id));
        return { id: existing[0].id, updated: true };
      } else {
        const [result] = await db.insert(productOpsDailyRecords).values(values);
        return { id: result.insertId, updated: false };
      }
    }),

  // ─── Keyword Tracking ────────────────────────────────
  listKeywords: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(keywordTrackings)
        .where(eq(keywordTrackings.planId, input.planId))
        .orderBy(desc(keywordTrackings.isCoreKeyword), asc(keywordTrackings.createdAt));
    }),

  addKeyword: protectedProcedure
    .input(z.object({
      planId: z.number(),
      keyword: z.string(),
      keywordCn: z.string().optional(),
      targetOrganicRank: z.number().optional(),
      targetDailyAdOrders: z.number().optional(),
      isCoreKeyword: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [result] = await db.insert(keywordTrackings).values({
        planId: input.planId,
        keyword: input.keyword,
        keywordCn: input.keywordCn,
        targetOrganicRank: input.targetOrganicRank,
        targetDailyAdOrders: input.targetDailyAdOrders,
        isCoreKeyword: input.isCoreKeyword ? 1 : 0,
      });
      return { id: result.insertId };
    }),

  deleteKeyword: protectedProcedure
    .input(z.object({ keywordId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(keywordTrackings).where(eq(keywordTrackings.id, input.keywordId));
      return { success: true };
    }),

  getKeywordDailyRecords: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(keywordDailyRecords)
        .where(eq(keywordDailyRecords.trackingId, input.trackingId))
        .orderBy(asc(keywordDailyRecords.recordDate));
    }),

  upsertKeywordDailyRecord: protectedProcedure
    .input(z.object({
      trackingId: z.number(),
      recordDate: z.string(),
      actualOrganicRank: z.number().optional(),
      actualAdOrders: z.number().optional(),
      actualAdSpend: z.number().optional(),
      actualImpressions: z.number().optional(),
      actualClicks: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const existing = await db.select().from(keywordDailyRecords)
        .where(and(
          eq(keywordDailyRecords.trackingId, input.trackingId),
          eq(keywordDailyRecords.recordDate, input.recordDate),
        ));

      const values: any = {
        trackingId: input.trackingId,
        recordDate: input.recordDate,
        actualOrganicRank: input.actualOrganicRank,
        actualAdOrders: input.actualAdOrders,
        actualAdSpend: input.actualAdSpend?.toString(),
        actualImpressions: input.actualImpressions,
        actualClicks: input.actualClicks,
      };

      if (existing.length > 0) {
        await db.update(keywordDailyRecords).set(values).where(eq(keywordDailyRecords.id, existing[0].id));
        return { id: existing[0].id };
      } else {
        const [result] = await db.insert(keywordDailyRecords).values(values);
        return { id: result.insertId };
      }
    }),

  // ─── AI运营建议 ────────────────────────────────
  aiOpsSuggestion: protectedProcedure
    .input(z.object({
      asin: z.string(),
      targetBsr: z.number().optional(),
      targetDailyOrders: z.number().optional(),
      targetAcos: z.number().optional(),
      actualBsr: z.number().optional(),
      actualDailyOrders: z.number().optional(),
      actualAcos: z.number().optional(),
      actualConversionRate: z.number().optional(),
      daysInPlan: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位资深亚马逊运营顾问。请基于以下运营计划的目标与实际数据偏差，生成今日运营建议。

## ASIN: ${input.asin}
## 目标 vs 实际
- BSR: 目标${input.targetBsr || "未设定"} vs 实际${input.actualBsr || "未知"}
- 日均订单: 目标${input.targetDailyOrders || "未设定"} vs 实际${input.actualDailyOrders || "未知"}
- ACoS: 目标${input.targetAcos || "未设定"}% vs 实际${input.actualAcos || "未知"}%
- 转化率: 实际${input.actualConversionRate || "未知"}%
- 推广天数: ${input.daysInPlan || "未知"}天`
          },
          { role: "user", content: "请分析目标偏差原因并给出具体的今日运营调整建议。" }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ops_suggestion",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string", description: "一句话概括当前运营状态" },
                gap_analysis: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      metric: { type: "string" },
                      target: { type: "string" },
                      actual: { type: "string" },
                      gap: { type: "string" },
                      severity: { type: "string" },
                    },
                    required: ["metric", "target", "actual", "gap", "severity"],
                    additionalProperties: false,
                  },
                },
                today_actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string" },
                      action: { type: "string" },
                      expected_impact: { type: "string" },
                    },
                    required: ["priority", "action", "expected_impact"],
                    additionalProperties: false,
                  },
                },
                risk_alerts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      risk: { type: "string" },
                      mitigation: { type: "string" },
                    },
                    required: ["risk", "mitigation"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "gap_analysis", "today_actions", "risk_alerts"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ─── Competitor Ad Benchmark (竞品广告对标) ────────────────────────────────
  listBenchmarks: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(competitorAdBenchmarks)
        .where(eq(competitorAdBenchmarks.planId, input.planId))
        .orderBy(asc(competitorAdBenchmarks.createdAt));
    }),

  addBenchmark: protectedProcedure
    .input(z.object({
      planId: z.number(),
      competitorBrand: z.string(),
      competitorAsin: z.string().optional(),
      adType: z.enum(["sp", "sb", "sd", "dsp", "mixed"]).default("mixed"),
      acos: z.string().optional(),
      ctr: z.string().optional(),
      cvr: z.string().optional(),
      cpc: z.string().optional(),
      cpa: z.string().optional(),
      totalSpend: z.string().optional(),
      totalSales: z.string().optional(),
      totalOrders: z.number().optional(),
      totalImpressions: z.number().optional(),
      totalClicks: z.number().optional(),
      dataPeriod: z.string().optional(),
      analysisNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [result] = await db.insert(competitorAdBenchmarks).values(input);
      return { id: result.insertId };
    }),

  updateBenchmark: protectedProcedure
    .input(z.object({
      benchmarkId: z.number(),
      competitorBrand: z.string().optional(),
      competitorAsin: z.string().optional(),
      adType: z.enum(["sp", "sb", "sd", "dsp", "mixed"]).optional(),
      acos: z.string().optional(),
      ctr: z.string().optional(),
      cvr: z.string().optional(),
      cpc: z.string().optional(),
      cpa: z.string().optional(),
      totalSpend: z.string().optional(),
      totalSales: z.string().optional(),
      totalOrders: z.number().optional(),
      totalImpressions: z.number().optional(),
      totalClicks: z.number().optional(),
      dataPeriod: z.string().optional(),
      analysisNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { benchmarkId, ...data } = input;
      await db.update(competitorAdBenchmarks).set(data).where(eq(competitorAdBenchmarks.id, benchmarkId));
      return { success: true };
    }),

  deleteBenchmark: protectedProcedure
    .input(z.object({ benchmarkId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db.delete(competitorAdBenchmarks).where(eq(competitorAdBenchmarks.id, input.benchmarkId));
      return { success: true };
    }),

  aiCompetitorAdAnalysis: protectedProcedure
    .input(z.object({
      asin: z.string(),
      benchmarks: z.array(z.object({
        brand: z.string(),
        acos: z.number().optional(),
        ctr: z.number().optional(),
        cvr: z.number().optional(),
        cpc: z.number().optional(),
        cpa: z.number().optional(),
      })),
      myData: z.object({
        acos: z.number().optional(),
        ctr: z.number().optional(),
        cvr: z.number().optional(),
        cpc: z.number().optional(),
        cpa: z.number().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const benchmarkTable = input.benchmarks.map(b =>
        `${b.brand}: ACoS=${b.acos ?? "N/A"}%, CTR=${b.ctr ?? "N/A"}%, CVR=${b.cvr ?? "N/A"}%, CPC=$${b.cpc ?? "N/A"}, CPA=$${b.cpa ?? "N/A"}`
      ).join("\n");
      const myStr = input.myData
        ? `我方: ACoS=${input.myData.acos ?? "N/A"}%, CTR=${input.myData.ctr ?? "N/A"}%, CVR=${input.myData.cvr ?? "N/A"}%, CPC=$${input.myData.cpc ?? "N/A"}, CPA=$${input.myData.cpa ?? "N/A"}`
        : "我方数据未提供";

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位资深亚马逊广告策略分析师。请基于以下竞品广告对标数据，分析我方ASIN ${input.asin} 的广告竞争力，并给出具体优化建议。\n\n## 竞品数据\n${benchmarkTable}\n\n## 我方数据\n${myStr}\n\n请从五个维度（ACoS、CTR、CVR、CPC、CPA）分析竞争差距，并给出可执行的优化策略。`,
          },
          { role: "user", content: "请输出竞品广告对标分析报告。" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_ad_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string", description: "一句话总结竞争态势" },
                dimension_analysis: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      dimension: { type: "string" },
                      my_value: { type: "string" },
                      avg_competitor: { type: "string" },
                      gap: { type: "string" },
                      verdict: { type: "string" },
                    },
                    required: ["dimension", "my_value", "avg_competitor", "gap", "verdict"],
                    additionalProperties: false,
                  },
                },
                strategies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string" },
                      strategy: { type: "string" },
                      expected_impact: { type: "string" },
                    },
                    required: ["priority", "strategy", "expected_impact"],
                    additionalProperties: false,
                  },
                },
                competitive_advantage: { type: "string", description: "我方核心竞争优势" },
                key_weakness: { type: "string", description: "最需改善的短板" },
              },
              required: ["summary", "dimension_analysis", "strategies", "competitive_advantage", "key_weakness"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ─── Promotion Phases (推广周期管理) ────────────────────────────────
  listPhases: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(promotionPhases)
        .where(eq(promotionPhases.planId, input.planId))
        .orderBy(asc(promotionPhases.sortOrder));
    }),

  addPhase: protectedProcedure
    .input(z.object({
      planId: z.number(),
      phaseName: z.string(),
      phaseType: z.enum(["launch", "growth", "maturity", "optimization", "clearance", "custom"]).default("custom"),
      bsrRangeStart: z.number().optional(),
      bsrRangeEnd: z.number().optional(),
      durationDays: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      adBudgetDaily: z.string().optional(),
      targetAcos: z.string().optional(),
      keyStrategy: z.string().optional(),
      milestones: z.string().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [result] = await db.insert(promotionPhases).values(input);
      return { id: result.insertId };
    }),

  updatePhase: protectedProcedure
    .input(z.object({
      phaseId: z.number(),
      phaseName: z.string().optional(),
      phaseType: z.enum(["launch", "growth", "maturity", "optimization", "clearance", "custom"]).optional(),
      bsrRangeStart: z.number().optional(),
      bsrRangeEnd: z.number().optional(),
      durationDays: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      adBudgetDaily: z.string().optional(),
      targetAcos: z.string().optional(),
      keyStrategy: z.string().optional(),
      milestones: z.string().optional(),
      status: z.enum(["pending", "active", "completed", "skipped"]).optional(),
      progress: z.number().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { phaseId, ...data } = input;
      await db.update(promotionPhases).set(data).where(eq(promotionPhases.id, phaseId));
      return { success: true };
    }),

  deletePhase: protectedProcedure
    .input(z.object({ phaseId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db.delete(promotionPhases).where(eq(promotionPhases.id, input.phaseId));
      return { success: true };
    }),

  initBsrPhases: protectedProcedure
    .input(z.object({ planId: z.number(), currentBsr: z.number().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const bsrPhases = [
        { phaseName: "新品冲刺期", phaseType: "launch" as const, bsrRangeStart: 151, bsrRangeEnd: 200, durationDays: 20, keyStrategy: "大额Coupon+自动广告+手动精准词，快速获取初始评论和销量", sortOrder: 1 },
        { phaseName: "快速爬升期", phaseType: "growth" as const, bsrRangeStart: 101, bsrRangeEnd: 150, durationDays: 30, keyStrategy: "扩大广告覆盖+SB品牌广告+SD再营销，提升品牌曝光", sortOrder: 2 },
        { phaseName: "稳步增长期", phaseType: "growth" as const, bsrRangeStart: 51, bsrRangeEnd: 100, durationDays: 50, keyStrategy: "精准词竞价优化+否定词清理+A/B测试主图和标题", sortOrder: 3 },
        { phaseName: "冲刺头部期", phaseType: "optimization" as const, bsrRangeStart: 31, bsrRangeEnd: 50, durationDays: 60, keyStrategy: "DSP品牌展示+视频广告+站外引流，争夺头部位置", sortOrder: 4 },
        { phaseName: "头部巩固期", phaseType: "maturity" as const, bsrRangeStart: 11, bsrRangeEnd: 30, durationDays: 70, keyStrategy: "防御性广告策略+品牌旗舰店优化+复购激励", sortOrder: 5 },
        { phaseName: "类目霸主期", phaseType: "maturity" as const, bsrRangeStart: 1, bsrRangeEnd: 10, durationDays: 90, keyStrategy: "品牌护城河+全渠道广告矩阵+新品线扩展", sortOrder: 6 },
      ];
      await db.delete(promotionPhases).where(eq(promotionPhases.planId, input.planId));
      for (const phase of bsrPhases) {
        await db.insert(promotionPhases).values({
          planId: input.planId,
          ...phase,
          status: input.currentBsr && input.currentBsr >= phase.bsrRangeStart && input.currentBsr <= phase.bsrRangeEnd ? "active" : "pending",
        });
      }
      return { success: true, count: bsrPhases.length };
    }),

  aiPromotionStrategy: protectedProcedure
    .input(z.object({
      asin: z.string(),
      currentBsr: z.number().optional(),
      phases: z.array(z.object({
        name: z.string(),
        bsrRange: z.string(),
        durationDays: z.number().optional(),
        status: z.string(),
        progress: z.number().optional(),
      })),
      currentPhaseIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const phasesSummary = input.phases.map((p, i) =>
        `${i + 1}. ${p.name} (BSR ${p.bsrRange}, ${p.durationDays || "?"}天, 状态:${p.status}, 进度:${p.progress || 0}%)`
      ).join("\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位资深亚马逊推广策略师。请基于以下推广周期规划，为ASIN ${input.asin}（当前BSR: ${input.currentBsr || "未知"}）生成推广节奏建议。\n\n## 推广阶段\n${phasesSummary}\n\n请分析当前阶段的执行情况，并给出下一步推广策略建议。`,
          },
          { role: "user", content: "请输出推广节奏优化建议。" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "promotion_strategy",
            strict: true,
            schema: {
              type: "object",
              properties: {
                current_phase_assessment: { type: "string", description: "当前阶段执行评估" },
                next_phase_preparation: { type: "string", description: "下一阶段准备建议" },
                daily_actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      priority: { type: "string" },
                      timeline: { type: "string" },
                    },
                    required: ["action", "priority", "timeline"],
                    additionalProperties: false,
                  },
                },
                budget_recommendation: { type: "string", description: "预算分配建议" },
                risk_warning: { type: "string", description: "风险提醒" },
              },
              required: ["current_phase_assessment", "next_phase_preparation", "daily_actions", "budget_recommendation", "risk_warning"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),
});
