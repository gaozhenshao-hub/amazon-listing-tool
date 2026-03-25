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

// Helper: Get all seller SIDs from Lingxing (with cache + retry)
let _sellerCache: { sids: string[], sellers: any[], ts: number } | null = null;
const SELLER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getAllSellerSids(): Promise<{sids: string[], sellers: any[]}> {
  // Return cached result if still valid
  if (_sellerCache && Date.now() - _sellerCache.ts < SELLER_CACHE_TTL && _sellerCache.sids.length > 0) {
    console.log(`[SellerSids] Using cache: ${_sellerCache.sids.length} sellers`);
    return { sids: _sellerCache.sids, sellers: _sellerCache.sellers };
  }
  
  const adapter = getLingxingAdapter();
  // Retry up to 3 times with delay to handle rate limiting
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await adapter.request({ path: "/erp/sc/data/seller/lists" });
      const sellers = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];
      const sids = sellers.map((s: any) => String(s.sid));
      if (sids.length > 0) {
        _sellerCache = { sids, sellers, ts: Date.now() };
        console.log(`[SellerSids] Found ${sids.length} sellers: ${sids.join(',')}`);
        return { sids, sellers };
      }
      // Got 0 sellers (likely rate limited), retry after delay
      console.warn(`[SellerSids] Attempt ${attempt}: Got 0 sellers, retrying in ${attempt * 2}s...`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    } catch (err: any) {
      console.error(`[SellerSids] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  
  // If all retries failed but we have stale cache, use it
  if (_sellerCache && _sellerCache.sids.length > 0) {
    console.warn(`[SellerSids] All retries failed, using stale cache: ${_sellerCache.sids.length} sellers`);
    return { sids: _sellerCache.sids, sellers: _sellerCache.sellers };
  }
  
  console.error(`[SellerSids] All retries failed, no cache available`);
  return { sids: [], sellers: [] };
}

// ============== Operations Dashboard ==============
export const operationsRouter = router({
  // --- Dashboard Overview ---
  getDashboardOverview: protectedProcedure.query(async ({ ctx }) => {
    const adapter = getLingxingAdapter();
    const isMock = adapter.isMockMode();

    // First get all seller SIDs
    const { sids, sellers } = await getAllSellerSids();
    const allSidsStr = sids.join(',');
    const firstSid = sids.length > 0 ? Number(sids[0]) : 1;
    
    // Fetch key data from Lingxing using real SIDs
    // Two profit requests: summary for cards, daily for trend chart
    const [profitSummaryRes, profitDailyRes, inventoryRes, adReportRes] = await Promise.all([
      adapter.request({ path: "/bd/profit/report/open/report/msku/list", body: { startDate: getDateNDaysAgo(30), endDate: getToday(), length: 500, summaryEnabled: true } }),
      adapter.request({ path: "/bd/profit/report/open/report/msku/list", body: { startDate: getDateNDaysAgo(30), endDate: getToday(), length: 500 } }),
      adapter.request({ path: "/erp/sc/routing/fba/fbaStock/fbaList", body: { sid: allSidsStr, length: 200 } }),
      adapter.request({ path: "/pb/openapi/newad/spCampaignReports", body: { sid: firstSid, report_date: getDateNDaysAgo(1), show_detail: 0, offset: 0, length: 200 }, headers: { "X-API-VERSION": "2" } }).catch(() => ({ data: [] })),
    ]);
    const sellerRes = { data: sellers };

    // Calculate summary metrics
    // Normalize data: profit API returns {records:[...]}, FBA returns {total, list:[]}
    // Summary data (aggregated by MSKU) for cards
    const rawProfitSummary = profitSummaryRes.data || [];
    const profitSummaryData = Array.isArray(rawProfitSummary) ? rawProfitSummary : (rawProfitSummary as any).records || (rawProfitSummary as any).list || [];
    // Daily data (per day per MSKU) for trend chart
    const rawProfitDaily = profitDailyRes.data || [];
    const profitDailyData = Array.isArray(rawProfitDaily) ? rawProfitDaily : (rawProfitDaily as any).records || (rawProfitDaily as any).list || [];
    // Use summary data for card calculations
    const profitData = profitSummaryData;
    const rawInventory = inventoryRes.data || [];
    const inventoryData = Array.isArray(rawInventory) ? rawInventory : (rawInventory as any).list || [];
    const rawAd = adReportRes.data || [];
    const adData = Array.isArray(rawAd) ? rawAd : (rawAd as any).records || (rawAd as any).list || [];
    console.log(`[Dashboard] Profit records: ${profitData.length}, Inventory records: ${inventoryData.length}, Ad report records: ${adData.length}`);

    // Real Lingxing profit fields:
    // revenue: totalFbaAndFbmAmount, profit: grossProfit, margin: grossRate
    // orders: totalSalesQuantity, adSpend: totalAdsCost
    // fees: platformFee(-), totalFbaDeliveryFee(-), totalStorageFee(-)
    // cost: cgPriceAbsTotal, cgTransportCostsTotal
    const totalRevenue = profitData.reduce((s: number, d: any) => s + (d.totalFbaAndFbmAmount || d.revenue || 0), 0);
    const totalProfit = profitData.reduce((s: number, d: any) => s + (d.grossProfit || d.totalProfit || d.profit || 0), 0);
    const totalOrders = profitData.reduce((s: number, d: any) => s + (d.totalSalesQuantity || d.order_count || 0), 0);
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

    // FBA inventory fields: sellable_days (可售天数), fulfillable_quantity (可售库存), msku, product_name
    const lowStockCount = inventoryData.filter((i: any) => {
      const days = Number(i.sellable_days) || Number(i.days_of_supply) || 0;
      return days < 14;
    }).length;
    const overstockCount = inventoryData.filter((i: any) => {
      const days = Number(i.sellable_days) || Number(i.days_of_supply) || 0;
      return days > 90;
    }).length;

    // Ad data from campaign reports API (cost, sales fields)
    const totalAdSpend = adData.reduce((s: number, d: any) => s + (Number(d.cost) || 0), 0);
    const totalAdSales = adData.reduce((s: number, d: any) => s + (Number(d.sales) || 0), 0);
    // Fallback: extract ad cost from profit data if ad report is empty
    const profitAdSpend = profitData.reduce((s: number, d: any) => s + Math.abs(d.totalAdsCost || d.adsSpCost || 0), 0);
    const finalAdSpend = totalAdSpend > 0 ? totalAdSpend : profitAdSpend;
    const avgAcos = totalAdSales > 0 ? (finalAdSpend / totalAdSales * 100) : 0;
    console.log(`[Dashboard] Ad spend: $${finalAdSpend.toFixed(2)}, Ad sales: $${totalAdSales.toFixed(2)}, ACoS: ${avgAcos.toFixed(1)}%`);

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
        adSpend30d: Math.round(finalAdSpend * 100) / 100,
        avgAcos: Math.round(avgAcos * 10) / 10,
        sellerCount: (sellerRes.data || []).length,
      },
      // Build trend from daily data: group by date and sum
      profitTrend: (() => {
        const dateMap: Record<string, { revenue: number; profit: number; orders: number }> = {};
        for (const d of profitDailyData) {
          const date = d.postedDateLocale || d.reportDateMonth || d.date || d.statDate || '';
          if (!date) continue;
          if (!dateMap[date]) dateMap[date] = { revenue: 0, profit: 0, orders: 0 };
          dateMap[date].revenue += d.totalFbaAndFbmAmount || d.revenue || 0;
          dateMap[date].profit += d.grossProfit || d.totalProfit || d.profit || 0;
          dateMap[date].orders += d.totalSalesQuantity || d.order_count || 0;
        }
        return Object.entries(dateMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-30)
          .map(([date, v]) => ({
            date,
            revenue: Math.round(v.revenue * 100) / 100,
            profit: Math.round(v.profit * 100) / 100,
            margin: v.revenue > 0 ? Math.round(v.profit / v.revenue * 10000) / 100 : 0,
            orders: v.orders,
          }));
      })(),
      topAlerts: [
        ...inventoryData
          .filter((i: any) => {
            const days = Number(i.sellable_days) || Number(i.days_of_supply) || 0;
            return days < 7;
          })
          .slice(0, 3)
          .map((i: any) => {
            const sku = i.msku || i.seller_sku || i.local_sku || 'Unknown';
            const days = Number(i.sellable_days) || Number(i.days_of_supply) || 0;
            return {
              type: "inventory_critical" as const,
              message: `${sku}: 仅剩${days}天库存，需紧急补货`,
              severity: "critical" as const,
            };
          }),
        ...adData
          .filter((a: any) => {
            const cost = Number(a.cost) || 0;
            const sales = Number(a.sales) || 0;
            return sales > 0 && cost > 0 && (cost / sales) > 0.5;
          })
          .slice(0, 2)
          .map((a: any) => {
            const cost = Number(a.cost) || 0;
            const sales = Number(a.sales) || 0;
            const acos = (cost / sales * 100).toFixed(1);
            return {
              type: "ad_acos_high" as const,
              message: `广告活动 Campaign ${a.campaign_id}: ACoS ${acos}%，超出阈值`,
              severity: "warning" as const,
            };
          }),
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
      sid: z.number().optional(),
      marketplace: z.string().optional().default("US"),
      sortBy: z.enum(["days_of_supply", "fulfillable_qty", "avg_daily_sales"]).optional().default("days_of_supply"),
      sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
      alertFilter: z.enum(["all", "critical", "low", "normal", "overstock"]).optional().default("all"),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // Get real SIDs if not provided
      let sidStr: string;
      if (input.sid) {
        sidStr = String(input.sid);
      } else {
        const { sids } = await getAllSellerSids();
        sidStr = sids.join(',');
      }
      console.log(`[InventoryList] Querying FBA inventory with sid=${sidStr}`);
      const res = await adapter.request({
        path: "/erp/sc/routing/fba/fbaStock/fbaList",
        body: { sid: sidStr, length: 200 },
      });

      // Normalize: FBA API returns {total, list:[...]}
      const rawData = res.data || [];
      const dataList = Array.isArray(rawData) ? rawData : (rawData as any).list || [];
      console.log(`[InventoryList] Got ${dataList.length} items, total=${(rawData as any)?.total || 'N/A'}`);
      if (dataList.length > 0) {
        console.log(`[InventoryList] First item keys: ${Object.keys(dataList[0]).join(', ')}`);
        console.log(`[InventoryList] First item sample: ${JSON.stringify(dataList[0]).substring(0, 500)}`);
      }
      let items = dataList.map((item: any) => {
        // Map real Lingxing FBA fields to our standard fields
        const fulfillableQty = item.afn_fulfillable_quantity || item.total_fulfillable_quantity || 0;
        const inboundQty = (item.afn_inbound_shipped_quantity || 0) + (item.afn_inbound_working_quantity || 0) + (item.afn_inbound_receiving_quantity || 0);
        const daysOfSupply = item.historical_days_of_supply || item.days_of_supply || item.sellable_days || 0;
        const avgDailySales = item.sell_through || item.avg_daily_sales || 0;
        
        let alertLevel: "critical" | "low" | "normal" | "overstock" = "normal";
        if (fulfillableQty === 0 && inboundQty === 0) alertLevel = "critical";
        else if (daysOfSupply <= 7 && daysOfSupply > 0) alertLevel = "critical";
        else if (daysOfSupply <= 14) alertLevel = "low";
        else if (daysOfSupply > 90) alertLevel = "overstock";
        // If no supply data but has stock, mark as normal
        else if (fulfillableQty > 0) alertLevel = "normal";

        return {
          ...item,
          // Standardized field names for frontend
          seller_sku: item.msku || item.sku || '',
          product_name: item.product_name || item.localName || '',
          asin: item.asin || '',
          fnsku: item.fnsku || '',
          fulfillable_qty: fulfillableQty,
          inbound_qty: inboundQty,
          inbound_quantity: inboundQty,
          reserved_qty: (item.reserved_customerorders || 0) + (item.reserved_fc_transfers || 0) + (item.reserved_fc_processing || 0),
          unsellable_qty: item.afn_unsellable_quantity || 0,
          days_of_supply: daysOfSupply,
          avg_daily_sales: avgDailySales,
          store_name: item.wname || item.name || '',
          product_image: item.product_image || item.smallImageUrl || '',
          alertLevel,
        };
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
    .input(z.object({ sid: z.number().optional() }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // Get real SIDs
      const { sids } = await getAllSellerSids();
      const sidList = input.sid ? [input.sid] : sids.map(Number);
      console.log(`[Replenishment] Querying with sid_list=${JSON.stringify(sidList)}`);
      const res = await adapter.request({
        path: "/erp/sc/routing/restocking/analysis/getSummaryList",
        body: { data_type: 1, sid_list: sidList, length: 50 },
      });
      // Normalize: may return {list:[...]} or array
      const rawItems = res.data || [];
      const items = Array.isArray(rawItems) ? rawItems : (rawItems as any).list || (rawItems as any).records || [];
      console.log(`[Replenishment] Got ${items.length} items`);
      if (items.length > 0) {
        console.log(`[Replenishment] First item keys: ${Object.keys(items[0]).join(', ')}`);
      }
      return { items, isMock: adapter.isMockMode() };
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
      const startDate = input.startDate || getDateNDaysAgo(30);
      const endDate = input.endDate || getToday();
      
      // Fetch ALL records with pagination (each page up to 200)
      let allData: any[] = [];
      let offset = 0;
      const pageSize = 200;
      let hasMore = true;
      
      while (hasMore) {
        const res = await adapter.request({
          path: "/bd/profit/report/open/report/msku/list",
          body: {
            startDate,
            endDate,
            length: pageSize,
            offset,
          },
        });
        
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
      // Use MSKU-level profit report for SKU ranking
      const res = await adapter.request({
        path: "/bd/profit/report/open/report/msku/list",
        body: {
          startDate: input.startDate || getDateNDaysAgo(30),
          endDate: input.endDate || getToday(),
          length: 200,
          offset: 0,
          summaryEnabled: true,  // Aggregate by MSKU to avoid duplicate rows per day
        },
      });
      // Normalize: profit API returns {records:[...]} or array
      const rawItems = res.data || [];
      console.log(`[ProfitByProduct] rawItems type=${typeof rawItems}, isArray=${Array.isArray(rawItems)}, keys=${typeof rawItems === 'object' ? Object.keys(rawItems).join(',') : 'N/A'}`);
      const rawList = Array.isArray(rawItems) ? rawItems : (rawItems as any).records || (rawItems as any).list || [];
      
      // Debug: log first 3 records' key identity fields
      if (rawList.length > 0) {
        console.log(`[ProfitByProduct] Total records: ${rawList.length}`);
        // Log ALL keys of first record
        const firstKeys = Object.keys(rawList[0]);
        console.log(`[ProfitByProduct] Record[0] has ${firstKeys.length} keys: ${firstKeys.slice(-30).join(', ')}`);
        // Log the identity fields specifically
        const r = rawList[0];
        console.log(`[ProfitByProduct] Record[0] identity values: msku="${r.msku}", localSku="${r.localSku}", asin="${r.asin}", itemName="${r.itemName}", localName="${r.localName}", storeName="${r.storeName}", totalFbaAndFbmAmount=${r.totalFbaAndFbmAmount}, grossProfit=${r.grossProfit}`);
        // Log the last record (which should have sales data)
        const last = rawList[rawList.length - 1];
        console.log(`[ProfitByProduct] Record[last] identity values: msku="${last.msku}", localSku="${last.localSku}", asin="${last.asin}", itemName="${last.itemName}", totalFbaAndFbmAmount=${last.totalFbaAndFbmAmount}`);
      } else {
        console.log(`[ProfitByProduct] rawList is empty, rawItems preview: ${JSON.stringify(rawItems).slice(0, 300)}`);
      }
      
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
      
      return { items, isMock: adapter.isMockMode() };
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
      sid: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // Get real SID if not provided
      let realSid = input.sid;
      if (!realSid) {
        const { sids } = await getAllSellerSids();
        realSid = sids.length > 0 ? Number(sids[0]) : 1;
      }
      // Get all sids to query campaigns across all stores
      const { sids: allSids } = await getAllSellerSids();
      const sidsToQuery = input.sid ? [input.sid] : allSids.map(Number).slice(0, 5); // Limit to first 5 stores
      console.log(`[AdCampaigns] Querying ad campaigns across sids: ${sidsToQuery.join(',')}`);
      
      // 1. Get campaign list from all stores (names, status, budget)
      const campaignNameMap: Record<string, any> = {};
      const allCampaignList: any[] = [];
      for (const sid of sidsToQuery) {
        try {
          const campaignListRes = await adapter.request({
            path: "/pb/openapi/newad/spCampaigns",
            body: { sid },
            headers: { "X-API-VERSION": "2" },
          });
          const rawCampaigns = campaignListRes.data || [];
          const campaigns = Array.isArray(rawCampaigns) ? rawCampaigns : (rawCampaigns as any).records || (rawCampaigns as any).list || [];
          console.log(`[AdCampaigns] sid=${sid}: Got ${campaigns.length} campaigns`);
          for (const c of campaigns) {
            campaignNameMap[String(c.campaign_id)] = {
              name: c.name || '',
              daily_budget: c.daily_budget || 0,
              state: c.state || 'unknown',
              serving_status: c.serving_status || '',
              targeting_type: c.targeting_type || '',
              campaign_type: c.campaign_type || '',
              start_date: c.start_date || '',
              sid,
            };
            allCampaignList.push({ ...c, sid });
          }
        } catch (err: any) {
          console.warn(`[AdCampaigns] sid=${sid}: Failed to get campaigns: ${err.message}`);
        }
      }
      console.log(`[AdCampaigns] Total campaigns from list API: ${allCampaignList.length}`);
      
      // 2. Get campaign report data from all stores
      const reportDate = input.startDate || getDateNDaysAgo(1);
      console.log(`[AdCampaigns] Querying campaign reports for date=${reportDate}`);
      const reportMap: Record<string, any> = {};
      for (const sid of sidsToQuery) {
        try {
          const reportRes = await adapter.request({
            path: "/pb/openapi/newad/spCampaignReports",
            body: {
              sid,
              report_date: reportDate,
              show_detail: 0,
              offset: 0,
              length: 200,
            },
            headers: { "X-API-VERSION": "2" },
          });
          const rawReport = reportRes.data || [];
          const reportData = Array.isArray(rawReport) ? rawReport : (rawReport as any).records || (rawReport as any).list || [];
          console.log(`[AdCampaigns] sid=${sid}: Got ${reportData.length} campaign reports`);
          for (const r of reportData) {
            const cid = String(r.campaign_id);
            if (reportMap[cid]) {
              // Aggregate if same campaign appears in multiple queries
              reportMap[cid].impressions += Number(r.impressions) || 0;
              reportMap[cid].clicks += Number(r.clicks) || 0;
              reportMap[cid].cost += Number(r.cost) || 0;
              reportMap[cid].sales += Number(r.sales) || 0;
              reportMap[cid].orders += Number(r.orders) || 0;
            } else {
              reportMap[cid] = {
                impressions: Number(r.impressions) || 0,
                clicks: Number(r.clicks) || 0,
                cost: Number(r.cost) || 0,
                sales: Number(r.sales) || 0,
                orders: Number(r.orders) || 0,
                units: Number(r.units) || 0,
              };
            }
          }
        } catch (err: any) {
          console.warn(`[AdCampaigns] sid=${sid}: Failed to get reports: ${err.message}`);
        }
      }
      
      // 3. Merge: start from all unique campaign IDs
      const allCampaignIds = Array.from(new Set([
        ...allCampaignList.map((c: any) => String(c.campaign_id)),
        ...Object.keys(reportMap),
      ]));
      
      const campaigns: any[] = [];
      for (const cid of allCampaignIds) {
        const info = campaignNameMap[cid] || {};
        const report = reportMap[cid] || {};
        const spend = report.cost || 0;
        const sales = report.sales || 0;
        const clicks = report.clicks || 0;
        const impressions = report.impressions || 0;
        const acos = sales > 0 ? Math.round(spend / sales * 10000) / 100 : 0;
        const roas = spend > 0 ? Math.round(sales / spend * 100) / 100 : 0;
        const ctr = impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0;
        const cpc = clicks > 0 ? Math.round(spend / clicks * 100) / 100 : 0;
        
        campaigns.push({
          campaign_id: cid,
          campaign_name: info.name || `Campaign ${cid}`,
          campaign_type: info.campaign_type || 'sponsoredProducts',
          targeting_type: info.targeting_type || '',
          daily_budget: info.daily_budget || 0,
          state: info.state || 'unknown',
          serving_status: info.serving_status || '',
          impressions,
          clicks,
          spend,
          sales,
          orders: report.orders || 0,
          acos,
          roas,
          ctr,
          cpc,
        });
      }
      
      // Sort by spend descending
      campaigns.sort((a, b) => b.spend - a.spend);
      
      console.log(`[AdCampaigns] Final merged campaigns: ${campaigns.length}`);
      return { campaigns, isMock: adapter.isMockMode() };
    }),

  getSearchTerms: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      campaignId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // Get real SID if not provided
      let realSid = input.sid;
      if (!realSid) {
        const { sids } = await getAllSellerSids();
        realSid = sids.length > 0 ? Number(sids[0]) : 1;
      }
      console.log(`[SearchTerms] Querying search terms with sid=${realSid}`);
      const res = await adapter.request({
        path: "/pb/openapi/newad/queryWordReports",
        body: {
          sid: realSid,
          report_date: input.startDate || getDateNDaysAgo(1),
          target_type: "keyword",
        },
        headers: { "X-API-VERSION": "2" },
      });
      
      const rawData = res.data || [];
      const searchTerms = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
      console.log(`[SearchTerms] Got ${searchTerms.length} search terms`);
      return { searchTerms, isMock: adapter.isMockMode() };
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
