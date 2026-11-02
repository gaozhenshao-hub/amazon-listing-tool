import { failUnavailableDataSource } from "@shared/_core/errors";
import { requireOpsDb } from "../legacy/repository";
import { runOpsSkill } from "../legacy/service";
import { z, TRPCError, protectedProcedure, router, getDb, invokeBusinessSkill, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";

export const profitProcedures = {
// ============== Profit Module ==============
  getProfitOverview: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      granularity: z.enum(["daily", "weekly", "monthly"]).optional().default("daily"),
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const startDate = input.startDate || getDateNDaysAgo(30);
      const endDate = input.endDate || getToday();
      
      // Get seller SIDs filtered by marketplace
      const { sellers } = await getAllSellerSids();
      const mp = input.marketplace || 'US';
      const sids = filterSidsByMarketplace(sellers, mp);
      const firstSid = sids.length > 0 ? Number(sids[0]) : 1;
      
      // Fetch ALL records with pagination (each page up to 200)
      let allData: any[] = [];
      let offset = 0;
      const pageSize = 200;
      let hasMore = true;
      
      while (hasMore) {
        const res = failUnavailableDataSource();
        
        const rawData = res.data || [];
        const records = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
        const total = (rawData as any).total || 0;
        
        allData = allData.concat(records);
        offset += pageSize;
        hasMore = records.length >= pageSize && allData.length < total;
        
        // Safety limit: max 5 pages (1000 records)
        if (offset >= 1000) break;
      }
      
      console.log(`[ProfitOverview] Fetched ${allData.length} total records across ${Math.ceil(offset / pageSize)} pages`);
      
      // Group by date for trend chart
      const dateMap = new Map<string, any>();
      for (const d of allData) {
        const date = d.postedDateLocale || d.reportDateMonth || d.statDate || d.date || '';
        if (!date) continue;
        
        if (!dateMap.has(date)) {
          dateMap.set(date, {
            date,
            revenue: 0, profit: 0, orders: 0, adSpend: 0,
            productCost: 0, fbaFee: 0, referralFee: 0, storageFee: 0,
            shippingCost: 0, otherFee: 0,
          });
        }
        const agg = dateMap.get(date)!;
        agg.revenue += (d.totalFbaAndFbmAmount || 0);
        agg.profit += (d.grossProfit || 0);
        agg.orders += (d.totalFbaAndFbmQuantity || d.totalSalesQuantity || 0);
        agg.adSpend += Math.abs(d.totalAdsCost || 0);
        agg.productCost += Math.abs(d.cgPriceTotal || d.cgPriceAbsTotal || 0);
        agg.fbaFee += Math.abs(d.totalFbaDeliveryFee || d.fbaDeliveryFee || 0);
        agg.referralFee += Math.abs(d.platformFee || 0);
        agg.storageFee += Math.abs(d.totalStorageFee || d.fbaStorageFee || 0);
        agg.shippingCost += Math.abs(d.cgTransportCostsTotal || 0);
        agg.otherFee += Math.abs(d.totalPlatformOtherFee || 0);
      }
      
      // Sort trend by date
      const trendData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      
      // Calculate totals from all records
      const totals = {
        revenue: 0, productCost: 0, fbaFee: 0, referralFee: 0,
        adSpend: 0, storageFee: 0, shippingCost: 0, otherFee: 0, profit: 0, orders: 0,
      };
      for (const d of trendData) {
        totals.revenue += d.revenue;
        totals.profit += d.profit;
        totals.orders += d.orders;
        totals.productCost += d.productCost;
        totals.fbaFee += d.fbaFee;
        totals.referralFee += d.referralFee;
        totals.adSpend += d.adSpend;
        totals.storageFee += d.storageFee;
        totals.shippingCost += d.shippingCost;
        totals.otherFee += d.otherFee;
      }
      
      console.log(`[ProfitOverview] Trend dates: ${trendData.length}, Total revenue: $${totals.revenue.toFixed(2)}, profit: $${totals.profit.toFixed(2)}, orders: ${totals.orders}`);

      // Waterfall chart data
      const waterfall = [
        { name: "销售收入", value: Math.round(totals.revenue * 100) / 100, type: "positive" },
        { name: "采购成本", value: -Math.round(totals.productCost * 100) / 100, type: "negative" },
        { name: "头程运费", value: -Math.round(totals.shippingCost * 100) / 100, type: "negative" },
        { name: "FBA配送费", value: -Math.round(totals.fbaFee * 100) / 100, type: "negative" },
        { name: "平台佣金", value: -Math.round(totals.referralFee * 100) / 100, type: "negative" },
        { name: "仓储费", value: -Math.round(totals.storageFee * 100) / 100, type: "negative" },
        { name: "广告支出", value: -Math.round(totals.adSpend * 100) / 100, type: "negative" },
        { name: "其他费用", value: -Math.round(totals.otherFee * 100) / 100, type: "negative" },
        { name: "毛利润", value: Math.round(totals.profit * 100) / 100, type: "total" },
      ];

      return {
        trend: trendData.map((d: any) => ({
          date: d.date,
          revenue: Math.round(d.revenue * 100) / 100,
          profit: Math.round(d.profit * 100) / 100,
          margin: d.revenue > 0 ? Math.round(d.profit / d.revenue * 1000) / 10 : 0,
          orders: d.orders,
          adSpend: Math.round(d.adSpend * 100) / 100,
        })),
        waterfall,
        totals: {
          revenue: Math.round(totals.revenue * 100) / 100,
          profit: Math.round(totals.profit * 100) / 100,
          margin: totals.revenue > 0 ? Math.round(totals.profit / totals.revenue * 1000) / 10 : 0,
          orders: totals.orders,
        },
        isMock: true,
      };
    }),

getProfitByProduct: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const startDate = input.startDate || getDateNDaysAgo(30);
      const endDate = input.endDate || getToday();
      
      // Paginate to fetch ALL MSKU records with summaryEnabled
      let allRecords: any[] = [];
      let offset = 0;
      const pageSize = 200;
      let hasMore = true;
      
      while (hasMore) {
        const res = failUnavailableDataSource();
        const rawItems = res.data || [];
        const records = Array.isArray(rawItems) ? rawItems : (rawItems as any).records || (rawItems as any).list || [];
        const total = (rawItems as any).total || 0;
        
        allRecords = allRecords.concat(records);
        offset += pageSize;
        hasMore = records.length >= pageSize && allRecords.length < total;
        
        // Safety limit: max 10 pages (2000 MSKUs)
        if (offset >= 2000) break;
      }
      
      const rawList = allRecords;
      console.log(`[ProfitByProduct] Fetched ${rawList.length} MSKUs across ${Math.ceil(offset / pageSize)} pages`);
      
      // Map Lingxing API fields to frontend expected fields
      const items = rawList.map((d: any) => {
        const revenue = Number(d.totalFbaAndFbmAmount) || Number(d.totalSalesAmount) || Number(d.platformIncome) || 0;
        const profit = Number(d.grossProfit) || 0;
        const margin = revenue > 0 ? Math.round(profit / revenue * 1000) / 10 : 0;
        return {
          seller_sku: d.localSku || d.msku || d.localName || '-',
          asin: d.asin || d.parentAsin || '',
          product_name: d.itemName || d.localName || d.msku || d.asin || '-',
          image: d.smallImageUrl || '',
          revenue: Math.round(revenue * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          profit_margin: margin,
          orders: Number(d.totalSalesQuantity) || Number(d.totalFbaAndFbmQuantity) || 0,
          adSpend: Math.abs(Number(d.totalAdsCost) || 0),
          fbaFee: Math.abs(Number(d.totalFbaDeliveryFee) || 0),
          referralFee: Math.abs(Number(d.platformFee) || 0),
          productCost: Math.abs(Number(d.cgPriceAbsTotal) || Number(d.cgPriceTotal) || 0),
          storeName: d.storeName || '',
          brandName: d.brandName || '',
        };
      }).sort((a: any, b: any) => b.revenue - a.revenue);
      
      return { items, isMock: true };
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


      const response = await runOpsSkill({
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
    })
};
