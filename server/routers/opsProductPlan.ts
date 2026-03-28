import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { productOpsPlans, productOpsDailyRecords, keywordTrackings, keywordDailyRecords } from "../../drizzle/schema";
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
});
