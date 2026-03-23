import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";
import {
  inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules,
  adAnalysisTasks, adAutomationRules, searchTermActions,
  competitorMonitors, competitorSnapshots, competitorReports,
  lingxingApiLogs
} from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

// ============== Operations Dashboard ==============
export const operationsRouter = router({
  // --- Dashboard Overview ---
  getDashboardOverview: protectedProcedure.query(async ({ ctx }) => {
    const adapter = getLingxingAdapter();
    const isMock = adapter.isMockMode();

    // Fetch key data from Lingxing (or mock)
    const [sellerRes, profitRes, inventoryRes, adRes] = await Promise.all([
      adapter.request({ path: "/erp/sc/data/seller/lists" }),
      adapter.request({ path: "/erp/sc/data/profit/list", body: { start_date: getDateNDaysAgo(30), end_date: getToday() } }),
      adapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } }),
      adapter.request({ path: "/erp/sc/data/ad_manage/campaign/list", body: {} }),
    ]);

    // Calculate summary metrics
    const profitData = profitRes.data || [];
    const inventoryData = inventoryRes.data || [];
    const adData = adRes.data || [];

    const totalRevenue = profitData.reduce((s: number, d: any) => s + (d.revenue || 0), 0);
    const totalProfit = profitData.reduce((s: number, d: any) => s + (d.profit || 0), 0);
    const totalOrders = profitData.reduce((s: number, d: any) => s + (d.order_count || 0), 0);
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

    const lowStockCount = inventoryData.filter((i: any) => (i.days_of_supply || 0) < 14).length;
    const overstockCount = inventoryData.filter((i: any) => (i.days_of_supply || 0) > 90).length;

    const totalAdSpend = adData.reduce((s: number, d: any) => s + (d.spend || 0), 0);
    const totalAdSales = adData.reduce((s: number, d: any) => s + (d.sales || 0), 0);
    const avgAcos = totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100) : 0;

    return {
      isMock,
      summary: {
        revenue30d: Math.round(totalRevenue * 100) / 100,
        profit30d: Math.round(totalProfit * 100) / 100,
        orders30d: totalOrders,
        avgMargin: Math.round(avgMargin * 10) / 10,
        skuCount: inventoryData.length,
        lowStockCount,
        overstockCount,
        adSpend30d: Math.round(totalAdSpend * 100) / 100,
        avgAcos: Math.round(avgAcos * 10) / 10,
        sellerCount: (sellerRes.data || []).length,
      },
      profitTrend: profitData.slice(-30).map((d: any) => ({
        date: d.date,
        revenue: d.revenue,
        profit: d.profit,
        margin: d.profit_margin,
        orders: d.order_count,
      })),
      topAlerts: [
        ...inventoryData
          .filter((i: any) => (i.days_of_supply || 0) < 7)
          .slice(0, 3)
          .map((i: any) => ({
            type: "inventory_critical" as const,
            message: `${i.seller_sku}: 仅剩${i.days_of_supply}天库存，需紧急补货`,
            severity: "critical" as const,
          })),
        ...adData
          .filter((a: any) => (a.acos || 0) > 50)
          .slice(0, 2)
          .map((a: any) => ({
            type: "ad_acos_high" as const,
            message: `广告活动"${a.campaign_name}": ACoS ${a.acos}%，超出阈值`,
            severity: "warning" as const,
          })),
      ],
    };
  }),

  // --- Lingxing Connection Status ---
  getLingxingStatus: protectedProcedure.query(async () => {
    const adapter = getLingxingAdapter();
    return {
      isMock: adapter.isMockMode(),
      recentLogs: adapter.getRecentLogs().slice(-10),
      cacheSize: 0, // cache stats not exposed
    };
  }),

  toggleMockMode: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const adapter = getLingxingAdapter();
      adapter.setMockMode(input.enabled);
      return { isMock: adapter.isMockMode() };
    }),

  // ============== Inventory Module ==============
  getInventoryList: protectedProcedure
    .input(z.object({
      sid: z.number().optional().default(1),
      marketplace: z.string().optional().default("US"),
      sortBy: z.enum(["days_of_supply", "fulfillable_qty", "avg_daily_sales"]).optional().default("days_of_supply"),
      sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
      alertFilter: z.enum(["all", "critical", "low", "normal", "overstock"]).optional().default("all"),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/routing/storage/fbaInventory",
        body: { sid: input.sid },
      });

      let items = (res.data || []).map((item: any) => {
        const daysOfSupply = item.days_of_supply || 0;
        let alertLevel: "critical" | "low" | "normal" | "overstock" = "normal";
        if (daysOfSupply <= 7) alertLevel = "critical";
        else if (daysOfSupply <= 14) alertLevel = "low";
        else if (daysOfSupply > 90) alertLevel = "overstock";

        return { ...item, alertLevel };
      });

      // Filter
      if (input.alertFilter !== "all") {
        items = items.filter((i: any) => i.alertLevel === input.alertFilter);
      }

      // Sort
      items.sort((a: any, b: any) => {
        const valA = a[input.sortBy] || 0;
        const valB = b[input.sortBy] || 0;
        return input.sortOrder === "asc" ? valA - valB : valB - valA;
      });

      const stats = {
        total: items.length,
        critical: items.filter((i: any) => i.alertLevel === "critical").length,
        low: items.filter((i: any) => i.alertLevel === "low").length,
        normal: items.filter((i: any) => i.alertLevel === "normal").length,
        overstock: items.filter((i: any) => i.alertLevel === "overstock").length,
      };

      return { items, stats, isMock: adapter.isMockMode() };
    }),

  getReplenishmentSuggestions: protectedProcedure
    .input(z.object({ sid: z.number().optional().default(1) }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/routing/storage/replenish/getReplenishmentData",
        body: { sid: input.sid },
      });
      return { items: res.data || [], isMock: adapter.isMockMode() };
    }),

  getInventoryConfig: protectedProcedure
    .input(z.object({ sellerSku: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const configs = await db!.select().from(inventoryConfig)
        .where(and(
          eq(inventoryConfig.userId, ctx.user.id),
          eq(inventoryConfig.sellerSku, input.sellerSku)
        ));
      return configs[0] || null;
    }),

  saveInventoryConfig: protectedProcedure
    .input(z.object({
      sellerSku: z.string(),
      leadTimeDays: z.number().min(1).max(365).optional(),
      safetyStockDays: z.number().min(0).max(180).optional(),
      reviewCycleDays: z.number().min(1).max(90).optional(),
      moq: z.number().min(1).optional(),
      packSize: z.number().min(1).optional(),
      alertDaysLow: z.number().min(1).optional(),
      alertDaysCritical: z.number().min(1).optional(),
      alertDaysOverstock: z.number().min(1).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const existing = await db!.select().from(inventoryConfig)
        .where(and(
          eq(inventoryConfig.userId, ctx.user.id),
          eq(inventoryConfig.sellerSku, input.sellerSku)
        ));

      if (existing.length > 0) {
        await db!.update(inventoryConfig)
          .set({ ...input, userId: ctx.user.id })
          .where(eq(inventoryConfig.id, existing[0].id));
        return { id: existing[0].id, updated: true };
      } else {
        const [result] = await db!.insert(inventoryConfig).values({
          ...input,
          userId: ctx.user.id,
        });
        return { id: result.insertId, updated: false };
      }
    }),

  // AI Replenishment Suggestion
  aiReplenishmentPlan: protectedProcedure
    .input(z.object({
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
    }))
    .mutation(async ({ input }) => {
      const prompt = `你是一位资深的亚马逊FBA库存管理专家。请根据以下SKU数据生成补货建议单。

SKU数据：
${JSON.stringify(input.skuData, null, 2)}

请为每个SKU生成结构化补货建议，包含：
1. urgency: "urgent"(7天内断货) / "soon"(14天内断货) / "plan"(30天内需补) / "ok"(暂不需要)
2. suggested_qty: 建议补货数量（考虑MOQ、安全库存、前置时间）
3. reason: 简短的补货原因说明
4. estimated_stockout_date: 预计断货日期（YYYY-MM-DD格式）
5. notes: 额外建议（如是否需要空运加急等）

请以JSON数组格式返回，每个元素对应一个SKU。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊FBA库存管理AI助手，输出严格的JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "replenishment_plan",
            strict: true,
            schema: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      seller_sku: { type: "string" },
                      urgency: { type: "string" },
                      suggested_qty: { type: "number" },
                      reason: { type: "string" },
                      estimated_stockout_date: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["seller_sku", "urgency", "suggested_qty", "reason", "estimated_stockout_date", "notes"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ============== Profit Module ==============
  getProfitOverview: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      granularity: z.enum(["daily", "weekly", "monthly"]).optional().default("daily"),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/data/profit/list",
        body: {
          start_date: input.startDate || getDateNDaysAgo(30),
          end_date: input.endDate || getToday(),
        },
      });

      const data = res.data || [];

      // Calculate waterfall breakdown (last period totals)
      const totals = data.reduce((acc: any, d: any) => ({
        revenue: acc.revenue + (d.revenue || 0),
        productCost: acc.productCost + (d.product_cost || 0),
        fbaFee: acc.fbaFee + (d.fba_fee || 0),
        referralFee: acc.referralFee + (d.referral_fee || 0),
        adSpend: acc.adSpend + (d.ad_spend || 0),
        otherFee: acc.otherFee + (d.other_fee || 0),
        profit: acc.profit + (d.profit || 0),
      }), { revenue: 0, productCost: 0, fbaFee: 0, referralFee: 0, adSpend: 0, otherFee: 0, profit: 0 });

      // Waterfall chart data
      const waterfall = [
        { name: "销售收入", value: Math.round(totals.revenue * 100) / 100, type: "positive" },
        { name: "产品成本", value: -Math.round(totals.productCost * 100) / 100, type: "negative" },
        { name: "FBA费用", value: -Math.round(totals.fbaFee * 100) / 100, type: "negative" },
        { name: "佣金", value: -Math.round(totals.referralFee * 100) / 100, type: "negative" },
        { name: "广告支出", value: -Math.round(totals.adSpend * 100) / 100, type: "negative" },
        { name: "其他费用", value: -Math.round(totals.otherFee * 100) / 100, type: "negative" },
        { name: "净利润", value: Math.round(totals.profit * 100) / 100, type: "total" },
      ];

      return {
        trend: data.map((d: any) => ({
          date: d.date,
          revenue: d.revenue,
          profit: d.profit,
          margin: d.profit_margin,
          orders: d.order_count,
          adSpend: d.ad_spend,
        })),
        waterfall,
        totals: {
          revenue: Math.round(totals.revenue * 100) / 100,
          profit: Math.round(totals.profit * 100) / 100,
          margin: totals.revenue > 0 ? Math.round(totals.profit / totals.revenue * 1000) / 10 : 0,
          orders: data.reduce((s: number, d: any) => s + (d.order_count || 0), 0),
        },
        isMock: adapter.isMockMode(),
      };
    }),

  getProfitByProduct: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/data/profit/productList",
        body: {
          start_date: input.startDate || getDateNDaysAgo(30),
          end_date: input.endDate || getToday(),
        },
      });
      return { items: res.data || [], isMock: adapter.isMockMode() };
    }),

  aiProfitAnalysis: protectedProcedure
    .input(z.object({
      profitData: z.array(z.record(z.string(), z.unknown())).max(60),
      analysisType: z.enum(["cost_optimization", "anomaly_detection", "trend_forecast"]),
    }))
    .mutation(async ({ input }) => {
      const typePrompts: Record<string, string> = {
        cost_optimization: `分析以下利润数据，找出成本优化机会：
1. 哪些费用项目占比异常偏高？
2. 与行业平均水平相比，哪些指标有优化空间？
3. 给出3-5条具体的成本优化建议，每条包含预期节省金额。`,
        anomaly_detection: `分析以下利润数据，检测异常费用：
1. 是否存在突然增加的费用项目？
2. 利润率是否有异常波动？
3. 标记所有异常数据点，说明可能原因和建议处理方式。`,
        trend_forecast: `分析以下利润数据的趋势：
1. 收入和利润的整体趋势如何？
2. 各费用项目的变化趋势？
3. 预测未来30天的利润走势（保守/正常/乐观三个场景）。`,
      };

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊运营利润分析AI专家。请输出结构化JSON分析结果。" },
          { role: "user", content: `${typePrompts[input.analysisType]}\n\n数据：${JSON.stringify(input.profitData)}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "profit_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string", description: "分析摘要" },
                findings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string" },
                      severity: { type: "string" },
                      suggestion: { type: "string" },
                      estimated_impact: { type: "string" },
                    },
                    required: ["title", "detail", "severity", "suggestion", "estimated_impact"],
                    additionalProperties: false,
                  },
                },
                actionItems: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      priority: { type: "string" },
                      expectedSaving: { type: "string" },
                    },
                    required: ["action", "priority", "expectedSaving"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "findings", "actionItems"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ============== Ads Module ==============
  getAdCampaigns: protectedProcedure
    .input(z.object({
      sid: z.number().optional().default(1),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/data/ad_manage/campaign/list",
        body: {
          sid: input.sid,
          start_date: input.startDate || getDateNDaysAgo(30),
          end_date: input.endDate || getToday(),
        },
      });
      return { campaigns: res.data || [], isMock: adapter.isMockMode() };
    }),

  getSearchTerms: protectedProcedure
    .input(z.object({
      sid: z.number().optional().default(1),
      campaignId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request({
        path: "/erp/sc/data/ad_manage/searchTerm/list",
        body: {
          sid: input.sid,
          campaign_id: input.campaignId,
          start_date: input.startDate || getDateNDaysAgo(30),
          end_date: input.endDate || getToday(),
        },
      });
      return { searchTerms: res.data || [], isMock: adapter.isMockMode() };
    }),

  aiSearchTermAnalysis: protectedProcedure
    .input(z.object({
      searchTerms: z.array(z.record(z.string(), z.unknown())).max(100),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊PPC广告优化AI专家。分析搜索词数据并给出操作建议。输出严格JSON格式。" },
          { role: "user", content: `分析以下搜索词数据，为每个搜索词给出操作建议：

搜索词数据：
${JSON.stringify(input.searchTerms, null, 2)}

对每个搜索词，判断应该执行的操作：
- add_exact: 高转化词，建议添加为精确匹配关键词
- add_phrase: 相关性好的词，建议添加为词组匹配
- negate_exact: 无关词，建议否定精确匹配
- negate_phrase: 无关词组，建议否定词组匹配
- increase_bid: 表现好但曝光不足，建议提高出价
- decrease_bid: ACoS过高，建议降低出价
- keep: 表现正常，保持不变
- monitor: 数据不足，继续观察

判断标准：
- ACoS < 15% 且有转化 → add_exact 或 increase_bid
- ACoS 15-30% 且有转化 → keep 或 add_phrase
- ACoS > 50% → decrease_bid 或 negate
- 花费>$5 无转化 → negate_exact
- 点击<3 → monitor` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "search_term_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                analysis: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      search_term: { type: "string" },
                      suggested_action: { type: "string" },
                      reason: { type: "string" },
                      confidence: { type: "string" },
                      estimated_impact: { type: "string" },
                    },
                    required: ["search_term", "suggested_action", "reason", "confidence", "estimated_impact"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
                topOpportunities: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["analysis", "summary", "topOpportunities"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // Save search term actions (after user reviews AI suggestions)
  saveSearchTermActions: protectedProcedure
    .input(z.object({
      actions: z.array(z.object({
        searchTerm: z.string(),
        keywordText: z.string().optional(),
        matchType: z.string().optional(),
        suggestedAction: z.enum(["add_exact", "add_phrase", "negate_exact", "negate_phrase", "increase_bid", "decrease_bid", "keep", "monitor"]),
        aiReason: z.string().optional(),
        metrics: z.record(z.string(), z.unknown()).optional(),
        userDecision: z.enum(["accepted", "rejected", "modified", "pending"]).optional(),
        userNotes: z.string().optional(),
      })),
      analysisTaskId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const values = input.actions.map(a => ({
        userId: ctx.user.id,
        analysisTaskId: input.analysisTaskId,
        searchTerm: a.searchTerm,
        keywordText: a.keywordText,
        matchType: a.matchType,
        suggestedAction: a.suggestedAction,
        aiReason: a.aiReason,
        metrics: a.metrics,
        userDecision: a.userDecision || ("pending" as const),
        userNotes: a.userNotes,
      }));

      for (const v of values) {
        await db!.insert(searchTermActions).values(v);
      }
      return { saved: values.length };
    }),

  // Ad automation rules CRUD
  getAdRules: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(adAutomationRules)
      .where(eq(adAutomationRules.userId, ctx.user.id))
      .orderBy(desc(adAutomationRules.createdAt));
  }),

  saveAdRule: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      ruleName: z.string().min(1),
      ruleType: z.enum(["negate_keyword", "add_keyword", "adjust_bid", "pause_campaign", "enable_campaign", "adjust_budget", "custom"]),
      condition: z.record(z.string(), z.unknown()),
      action: z.record(z.string(), z.unknown()),
      scope: z.record(z.string(), z.unknown()).optional(),
      isActive: z.number().optional().default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (input.id) {
        await db!.update(adAutomationRules)
          .set({
            ruleName: input.ruleName,
            ruleType: input.ruleType,
            condition: input.condition,
            action: input.action,
            scope: input.scope,
            isActive: input.isActive,
          })
          .where(and(eq(adAutomationRules.id, input.id), eq(adAutomationRules.userId, ctx.user.id)));
        return { id: input.id, updated: true };
      } else {
        const [result] = await db!.insert(adAutomationRules).values({
          userId: ctx.user.id,
          ruleName: input.ruleName,
          ruleType: input.ruleType,
          condition: input.condition,
          action: input.action,
          scope: input.scope,
          isActive: input.isActive,
        });
        return { id: result.insertId, updated: false };
      }
    }),

  deleteAdRule: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(adAutomationRules)
        .where(and(eq(adAutomationRules.id, input.id), eq(adAutomationRules.userId, ctx.user.id)));
      return { deleted: true };
    }),

  // ============== Competitor Module ==============
  getCompetitorMonitors: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(competitorMonitors)
      .where(eq(competitorMonitors.userId, ctx.user.id))
      .orderBy(desc(competitorMonitors.createdAt));
  }),

  saveCompetitorMonitor: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      competitorAsin: z.string().min(10).max(20),
      ownAsin: z.string().optional(),
      marketplace: z.string().optional().default("US"),
      competitorTitle: z.string().optional(),
      competitorBrand: z.string().optional(),
      category: z.string().optional(),
      monitorFrequency: z.enum(["daily", "weekly", "manual"]).optional().default("daily"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (input.id) {
        await db!.update(competitorMonitors)
          .set({ ...input, userId: ctx.user.id })
          .where(and(eq(competitorMonitors.id, input.id), eq(competitorMonitors.userId, ctx.user.id)));
        return { id: input.id, updated: true };
      } else {
        const [result] = await db!.insert(competitorMonitors).values({
          ...input,
          userId: ctx.user.id,
        });
        return { id: result.insertId, updated: false };
      }
    }),

  deleteCompetitorMonitor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(competitorMonitors)
        .where(and(eq(competitorMonitors.id, input.id), eq(competitorMonitors.userId, ctx.user.id)));
      return { deleted: true };
    }),

  // Add competitor data (manual or CSV import)
  addCompetitorSnapshot: protectedProcedure
    .input(z.object({
      monitorId: z.number(),
      price: z.number().optional(),
      bsrRank: z.number().optional(),
      bsrCategory: z.string().optional(),
      reviewCount: z.number().optional(),
      rating: z.number().optional(),
      isInStock: z.number().optional().default(1),
      couponInfo: z.string().optional(),
      dealInfo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [result] = await db!.insert(competitorSnapshots).values({
        monitorId: input.monitorId,
        snapshotDate: getToday(),
        price: String(input.price || 0),
        bsrRank: input.bsrRank,
        bsrCategory: input.bsrCategory,
        reviewCount: input.reviewCount,
        rating: String(input.rating || 0),
        isInStock: input.isInStock,
        couponInfo: input.couponInfo,
        dealInfo: input.dealInfo,
      });
      return { id: result.insertId };
    }),

  getCompetitorSnapshots: protectedProcedure
    .input(z.object({
      monitorId: z.number(),
      limit: z.number().optional().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db!.select().from(competitorSnapshots)
        .where(eq(competitorSnapshots.monitorId, input.monitorId))
        .orderBy(desc(competitorSnapshots.snapshotDate))
        .limit(input.limit);
    }),

  // AI Competitor Analysis Report
  aiCompetitorReport: protectedProcedure
    .input(z.object({
      monitorIds: z.array(z.number()).min(1).max(10),
      reportType: z.enum(["comparison", "trend", "opportunity", "threat"]).optional().default("comparison"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Get monitors and their snapshots
      const monitors = await db!.select().from(competitorMonitors)
        .where(eq(competitorMonitors.userId, ctx.user.id));

      const selectedMonitors = monitors.filter(m => input.monitorIds.includes(m.id));
      if (selectedMonitors.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到选中的竞品" });
      }

      const snapshotData: any[] = [];
      for (const m of selectedMonitors) {
        const snapshots = await db!.select().from(competitorSnapshots)
          .where(eq(competitorSnapshots.monitorId, m.id))
          .orderBy(desc(competitorSnapshots.snapshotDate))
          .limit(30);
        snapshotData.push({ monitor: m, snapshots });
      }

      const typePrompts: Record<string, string> = {
        comparison: "对比分析各竞品的价格、评分、排名差异，找出各自的优劣势。",
        trend: "分析各竞品的价格、排名、评论数的变化趋势，预测未来走势。",
        opportunity: "基于竞品数据，找出市场机会点（如价格空白、功能差异化等）。",
        threat: "识别竞品的威胁行为（如降价、新品上架、评论增长异常等）。",
      };

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊竞品分析AI专家。请输出结构化JSON分析报告。" },
          { role: "user", content: `${typePrompts[input.reportType]}\n\n竞品数据：${JSON.stringify(snapshotData)}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_report",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                findings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string" },
                      impact: { type: "string" },
                      recommendation: { type: "string" },
                    },
                    required: ["title", "detail", "impact", "recommendation"],
                    additionalProperties: false,
                  },
                },
                actionItems: {
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
              },
              required: ["title", "summary", "findings", "actionItems"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      const aiAnalysis = JSON.parse(content);

      // Save report
      const [result] = await db!.insert(competitorReports).values({
        userId: ctx.user.id,
        reportName: aiAnalysis.title || `竞品分析报告 ${getToday()}`,
        monitorIds: input.monitorIds,
        reportType: input.reportType,
        aiAnalysis,
        status: "draft",
      });

      return { id: result.insertId, ...aiAnalysis };
    }),

  getCompetitorReports: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(competitorReports)
      .where(eq(competitorReports.userId, ctx.user.id))
      .orderBy(desc(competitorReports.createdAt));
  }),
});

// Helper functions
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
