import { z, TRPCError, protectedProcedure, router, getDb, invokeLLM, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const competitorsProcedures = {
// ============== Competitor Module ==============
  getCompetitorMonitors: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(competitorMonitors)
      .where(opsWorkspaceCondition(competitorMonitors, workspaceIdFromContext(ctx), eq(competitorMonitors.userId, ctx.user.id)))
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
          .where(opsWorkspaceCondition(competitorMonitors, workspaceIdFromContext(ctx), and(eq(competitorMonitors.id, input.id), eq(competitorMonitors.userId, ctx.user.id))));
        return { id: input.id, updated: true };
      } else {
        const [result] = await db!.insert(competitorMonitors).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
          ...input,
          userId: ctx.user.id,
        }));
        return { id: result.insertId, updated: false };
      }
    }),

deleteCompetitorMonitor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(competitorMonitors)
        .where(opsWorkspaceCondition(competitorMonitors, workspaceIdFromContext(ctx), and(eq(competitorMonitors.id, input.id), eq(competitorMonitors.userId, ctx.user.id))));
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
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(competitorSnapshots).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
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
      }));
      return { id: result.insertId };
    }),

getCompetitorSnapshots: protectedProcedure
    .input(z.object({
      monitorId: z.number(),
      limit: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db!.select().from(competitorSnapshots)
        .where(opsWorkspaceCondition(competitorSnapshots, workspaceIdFromContext(ctx), eq(competitorSnapshots.monitorId, input.monitorId)))
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
        .where(opsWorkspaceCondition(competitorMonitors, workspaceIdFromContext(ctx), eq(competitorMonitors.userId, ctx.user.id)));

      const selectedMonitors = monitors.filter(m => input.monitorIds.includes(m.id));
      if (selectedMonitors.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到选中的竞品" });
      }

      const snapshotData: any[] = [];
      for (const m of selectedMonitors) {
        const snapshots = await db!.select().from(competitorSnapshots)
          .where(opsWorkspaceCondition(competitorSnapshots, workspaceIdFromContext(ctx), eq(competitorSnapshots.monitorId, m.id)))
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
      const [result] = await db!.insert(competitorReports).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
        userId: ctx.user.id,
        reportName: aiAnalysis.title || `竞品分析报告 ${getToday()}`,
        monitorIds: input.monitorIds,
        reportType: input.reportType,
        aiAnalysis,
        status: "draft",
      }));

      return { id: result.insertId, ...aiAnalysis };
    }),

getCompetitorReports: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(competitorReports)
      .where(opsWorkspaceCondition(competitorReports, workspaceIdFromContext(ctx), eq(competitorReports.userId, ctx.user.id)))
      .orderBy(desc(competitorReports.createdAt));
  })
};
