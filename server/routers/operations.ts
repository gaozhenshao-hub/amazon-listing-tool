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
  lingxingApiLogs, userSettings, asinStatusCache, asinPermissions,
  asinTagDefinitions, asinTagAssignments, productProfiles, productVariants
} from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

// Marketplace ID mapping (Lingxing mid -> country code)
const MARKETPLACE_MAP: Record<number, { code: string; name: string; region: string }> = {
  1: { code: 'US', name: '美国', region: 'NA' },
  2: { code: 'CA', name: '加拿大', region: 'NA' },
  3: { code: 'MX', name: '墨西哥', region: 'NA' },
  4: { code: 'UK', name: '英国', region: 'EU' },
  5: { code: 'DE', name: '德国', region: 'EU' },
  6: { code: 'FR', name: '法国', region: 'EU' },
  7: { code: 'IT', name: '意大利', region: 'EU' },
  8: { code: 'ES', name: '西班牙', region: 'EU' },
  9: { code: 'JP', name: '日本', region: 'FE' },
  10: { code: 'AU', name: '澳大利亚', region: 'FE' },
  11: { code: 'IN', name: '印度', region: 'FE' },
  12: { code: 'AE', name: '阿联酋', region: 'ME' },
  13: { code: 'SA', name: '沙特', region: 'ME' },
  14: { code: 'SG', name: '新加坡', region: 'FE' },
  15: { code: 'NL', name: '荷兰', region: 'EU' },
  16: { code: 'SE', name: '瑞典', region: 'EU' },
  17: { code: 'PL', name: '波兰', region: 'EU' },
  18: { code: 'BR', name: '巴西', region: 'SA' },
  19: { code: 'TR', name: '土耳其', region: 'EU' },
  20: { code: 'BE', name: '比利时', region: 'EU' },
};

// Helper: Filter sids by marketplace code
function filterSidsByMarketplace(sellers: any[], marketplaceCode?: string): string[] {
  if (!marketplaceCode || marketplaceCode === 'ALL') {
    return sellers.map((s: any) => String(s.sid));
  }
  const midEntry = Object.entries(MARKETPLACE_MAP).find(([_, v]) => v.code === marketplaceCode);
  if (!midEntry) return sellers.map((s: any) => String(s.sid));
  const targetMid = Number(midEntry[0]);
  const filtered = sellers.filter((s: any) => Number(s.mid) === targetMid);
  return filtered.length > 0 ? filtered.map((s: any) => String(s.sid)) : sellers.map((s: any) => String(s.sid));
}

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
      const rawSellers = res.data || [];
      const sellers = Array.isArray(rawSellers) ? rawSellers : (rawSellers as any)?.records || (rawSellers as any)?.list || [];
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
  getDashboardOverview: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const adapter = getLingxingAdapter();
    const isMock = adapter.isMockMode();

    // First get all seller SIDs, then filter by marketplace
    const { sids: allSids, sellers } = await getAllSellerSids();
    const mp = input?.marketplace || 'US';
    const sids = filterSidsByMarketplace(sellers, mp);
    const allSidsStr = sids.join(',');
    const firstSid = sids.length > 0 ? Number(sids[0]) : 1;
    
    // Fetch key data from Lingxing using real SIDs
    // Two profit requests: summary for cards, daily for trend chart
    const [profitSummaryRes, profitDailyRes, inventoryRes, adReportRes] = await Promise.all([
      adapter.requestWithMockFallback({ path: "/bd/profit/report/open/report/msku/list", body: { offset: 0, length: 1000, startDate: getDateNDaysAgo(30), endDate: getYesterday(), monthlyQuery: false, orderStatus: "All", summaryEnabled: true } }),
      adapter.requestWithMockFallback({ path: "/bd/profit/report/open/report/msku/list", body: { offset: 0, length: 1000, startDate: getDateNDaysAgo(30), endDate: getYesterday(), monthlyQuery: false, orderStatus: "All" } }),
      adapter.requestWithMockFallback({ path: "/erp/sc/data/fba/FbaStockLists", body: { offset: 0, length: 500 } }),
      adapter.requestWithMockFallback({ path: "/ph/openaps/newad/spAdvertiseHourData", body: { report_date: getYesterday(), offset: 0, length: 1000 } }).catch(() => ({ data: [] })),
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
    const inventoryData = Array.isArray(rawInventory) ? rawInventory : (rawInventory as any).records || (rawInventory as any).list || [];
    const rawAd = adReportRes.data || [];
    const adData = Array.isArray(rawAd) ? rawAd : (rawAd as any).records || (rawAd as any).list || [];
    console.log(`[Dashboard] Profit records: ${profitData.length}, Inventory records: ${inventoryData.length}, Ad report records: ${adData.length}`);

    // Real Lingxing profit fields:
    // revenue: totalFbaAndFbmAmount, profit: grossProfit, margin: grossRate
    // orders: totalSalesQuantity, adSpend: totalAdsCost
    // fees: platformFee(-), totalFbaDeliveryFee(-), totalStorageFee(-)
    // cost: cgPriceAbsTotal, cgTransportCostsTotal
    // Field mapping per Lingxing API docs: totalSalesAmount=销售额, grossProfit=毛利润, totalSalesQuantity=销量
    const totalRevenue = profitData.reduce((s: number, d: any) => s + Number(d.totalSalesAmount || d.totalFbaAndFbmAmount || 0), 0);
    const totalProfit = profitData.reduce((s: number, d: any) => s + Number(d.grossProfit || 0), 0);
    const totalOrders = profitData.reduce((s: number, d: any) => s + Number(d.totalSalesQuantity || 0), 0);
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
    const profitAdSpend = profitData.reduce((s: number, d: any) => s + Math.abs(Number(d.totalAdsCost || 0)), 0);
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
          dateMap[date].revenue += Number(d.totalSalesAmount || d.totalFbaAndFbmAmount || 0);
          dateMap[date].profit += Number(d.grossProfit || 0);
          dateMap[date].orders += Number(d.totalSalesQuantity || 0);
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
    .query(async ({ ctx, input }) => {
      const adapter = getLingxingAdapter();
      // Get real SIDs filtered by marketplace
      let sidStr: string;
      if (input.sid) {
        sidStr = String(input.sid);
      } else {
        const { sids, sellers } = await getAllSellerSids();
        const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
        sidStr = filteredSids.join(',');
      }
      console.log(`[InventoryList] Querying FBA inventory with sid=${sidStr}`);
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/fba/FbaStockLists",
        body: { offset: 0, length: 500 },
      });

      // Normalize: FBA v2 API returns {records:[...]} or array
      const rawData = res.data || [];
      const dataList = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
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

      // Enrich with operator and store info from product_profiles
      try {
        const db = await getDb();
        // Get all product profiles for this user
        const profiles = await db!.select({
          parentAsin: productProfiles.parentAsin,
          operator: productProfiles.operator,
          storeName: productProfiles.storeName,
        }).from(productProfiles).where(eq(productProfiles.userId, ctx.user.id));
        const profileMap = new Map(profiles.map(p => [p.parentAsin, p]));
        
        // Build childAsin → parentAsin mapping via product_profiles + product_variants join
        const variantProfiles = await db!.select({
          childAsin: productVariants.childAsin,
          parentAsin: productProfiles.parentAsin,
          operator: productProfiles.operator,
          storeName: productProfiles.storeName,
        }).from(productVariants)
          .innerJoin(productProfiles, eq(productVariants.productId, productProfiles.id))
          .where(eq(productProfiles.userId, ctx.user.id));
        
        const childProfileMap = new Map(variantProfiles.map(vp => [vp.childAsin, vp]));
        
        items = items.map((item: any) => {
          // Try direct parentAsin match first
          let profile = profileMap.get(item.asin);
          // If not found, try childAsin mapping
          if (!profile) {
            const childProfile = childProfileMap.get(item.asin);
            if (childProfile) {
              profile = profileMap.get(childProfile.parentAsin) || {
                parentAsin: childProfile.parentAsin,
                operator: childProfile.operator,
                storeName: childProfile.storeName,
              };
            }
          }
          return {
            ...item,
            operator: profile?.operator || item.operator || '',
            store_name: item.store_name || profile?.storeName || '',
          };
        });
      } catch (err) {
        console.warn('[InventoryList] Failed to enrich operator info:', err);
      }

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
      const res = await adapter.requestWithMockFallback({
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
      
      // Filter out discontinued/inactive ASINs from replenishment suggestions
      // Check asinStatusCache for status, also filter items with 0 daily sales and 0 inventory
      const db = await getDb();
      const asinStatuses = db ? await db.select().from(asinStatusCache) : [];
      const discontinuedAsins = new Set(
        asinStatuses
          .filter((s: any) => s.status === 'discontinued' || s.status === 'inactive')
          .map((s: any) => s.asin)
      );
      
      const filteredItems = items.filter((item: any) => {
        const asin = item.asin || item.parent_asin || '';
        // Skip if ASIN is marked as discontinued
        if (asin && discontinuedAsins.has(asin)) {
          return false;
        }
        return true;
      });
      
      console.log(`[Replenishment] After filtering discontinued: ${filteredItems.length} items (removed ${items.length - filteredItems.length})`);
      return { items: filteredItems, isMock: adapter.isMockMode() };
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

  // ============== AWD & Enhanced Inventory ==============
  
  // AWD库存查询
  getAwdInventory: protectedProcedure
    .input(z.object({ marketplace: z.string().optional().default("US") }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/fba/awdStockLists",
        body: { offset: 0, length: 200 },
      });
      const rawData = res.data || [];
      const items = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
      return {
        items: items.map((item: any) => ({
          sku: item.sku || item.msku || '',
          asin: item.asin || '',
          product_name: item.product_name || '',
          awd_quantity: item.awd_quantity || item.available_quantity || 0,
          awd_inbound_quantity: item.awd_inbound_quantity || 0,
          awd_reserved_quantity: item.awd_reserved_quantity || 0,
          awd_warehouse: item.awd_warehouse || item.warehouse_id || '',
          status: item.status || 'unknown',
          last_updated: item.last_updated || '',
        })),
        isMock: adapter.isMockMode(),
      };
    }),

  // 本地仓库存查询
  getLocalWarehouseInventory: protectedProcedure
    .input(z.object({ marketplace: z.string().optional().default("US") }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/inventory/getWarehouseStockDetail",
        body: { offset: 0, length: 200 },
      });
      const rawData = res.data || [];
      const items = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
      return {
        items: items.map((item: any) => ({
          sku: item.sku || item.msku || '',
          asin: item.asin || '',
          product_name: item.product_name || '',
          warehouse_name: item.warehouse_name || '',
          available_qty: item.available_qty || 0,
          reserved_qty: item.reserved_qty || 0,
          defective_qty: item.defective_qty || 0,
          total_qty: item.total_qty || 0,
          batch_no: item.batch_no || '',
          unit_cost: item.unit_cost || 0,
          total_value: item.total_value || 0,
        })),
        isMock: adapter.isMockMode(),
      };
    }),

  // 全渠道库存汇总（FBA + AWD + 本地仓）
  getOmniChannelInventory: protectedProcedure
    .input(z.object({ marketplace: z.string().optional().default("US") }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // 并行获取三个渠道的库存
      const [fbaRes, awdRes, localRes] = await Promise.all([
        adapter.requestWithMockFallback({ path: "/erp/sc/data/fba/FbaStockLists", body: { offset: 0, length: 500 } }),
        adapter.requestWithMockFallback({ path: "/erp/sc/data/fba/awdStockLists", body: { offset: 0, length: 200 } }),
        adapter.requestWithMockFallback({ path: "/erp/sc/data/inventory/getWarehouseStockDetail", body: { offset: 0, length: 200 } }),
      ]);
      
      const fbaItems = Array.isArray(fbaRes.data) ? fbaRes.data : ((fbaRes.data as any)?.records || []);
      const awdItems = Array.isArray(awdRes.data) ? awdRes.data : ((awdRes.data as any)?.records || []);
      const localItems = Array.isArray(localRes.data) ? localRes.data : ((localRes.data as any)?.records || []);
      
      // 按SKU聚合
      const skuMap = new Map<string, any>();
      
      for (const item of fbaItems) {
        const sku = item.msku || item.sku || '';
        if (!sku) continue;
        const existing = skuMap.get(sku) || { sku, asin: item.asin || '', product_name: item.product_name || item.localName || '', fba_qty: 0, awd_qty: 0, local_qty: 0, inbound_qty: 0, total_qty: 0 };
        existing.fba_qty += (item.afn_fulfillable_quantity || item.total_fulfillable_quantity || 0);
        existing.inbound_qty += (item.afn_inbound_shipped_quantity || 0) + (item.afn_inbound_working_quantity || 0);
        skuMap.set(sku, existing);
      }
      
      for (const item of awdItems) {
        const sku = item.sku || item.msku || '';
        if (!sku) continue;
        const existing = skuMap.get(sku) || { sku, asin: item.asin || '', product_name: item.product_name || '', fba_qty: 0, awd_qty: 0, local_qty: 0, inbound_qty: 0, total_qty: 0 };
        existing.awd_qty += (item.awd_quantity || item.available_quantity || 0);
        if (!existing.asin && item.asin) existing.asin = item.asin;
        if (!existing.product_name && item.product_name) existing.product_name = item.product_name;
        skuMap.set(sku, existing);
      }
      
      for (const item of localItems) {
        const sku = item.sku || item.msku || '';
        if (!sku) continue;
        const existing = skuMap.get(sku) || { sku, asin: item.asin || '', product_name: item.product_name || '', fba_qty: 0, awd_qty: 0, local_qty: 0, inbound_qty: 0, total_qty: 0 };
        existing.local_qty += (item.available_qty || 0);
        if (!existing.asin && item.asin) existing.asin = item.asin;
        if (!existing.product_name && item.product_name) existing.product_name = item.product_name;
        skuMap.set(sku, existing);
      }
      
      const aggregated = Array.from(skuMap.values()).map(item => ({
        ...item,
        total_qty: item.fba_qty + item.awd_qty + item.local_qty + item.inbound_qty,
      }));
      
      const summary = {
        total_skus: aggregated.length,
        total_fba: aggregated.reduce((s: number, i: any) => s + i.fba_qty, 0),
        total_awd: aggregated.reduce((s: number, i: any) => s + i.awd_qty, 0),
        total_local: aggregated.reduce((s: number, i: any) => s + i.local_qty, 0),
        total_inbound: aggregated.reduce((s: number, i: any) => s + i.inbound_qty, 0),
        total_all: aggregated.reduce((s: number, i: any) => s + i.total_qty, 0),
      };
      
      return { items: aggregated, summary, isMock: adapter.isMockMode() };
    }),

  // 增强版AI补货建议（含AWD+本地仓+停售ASIN过滤）
  aiEnhancedReplenishment: protectedProcedure
    .input(z.object({
      skuData: z.array(z.object({
        seller_sku: z.string(),
        product_name: z.string().optional(),
        asin: z.string().optional(),
        fulfillable_qty: z.number(),
        awd_qty: z.number().optional().default(0),
        local_qty: z.number().optional().default(0),
        inbound_qty: z.number().optional().default(0),
        avg_daily_sales: z.number(),
        avg_7d_sales: z.number().optional(),
        days_of_supply: z.number(),
        lead_time_days: z.number().optional().default(30),
        safety_stock_days: z.number().optional().default(14),
        is_peak_season: z.boolean().optional().default(false),
        product_status: z.string().optional().default("active"),
      })).max(20),
    }))
    .mutation(async ({ input }) => {
      // 过滤停售ASIN
      const activeSkus = input.skuData.filter(s => s.product_status !== 'discontinued' && s.product_status !== 'inactive');
      if (activeSkus.length === 0) {
        return { suggestions: [], message: "所有SKU均已停售，无需补货" };
      }

      const prompt = `你是一位资深的亚马逊FBA库存管理专家。请基于以下单个ASIN的全渠道库存数据计算最优补货方案。

## 全渠道库存数据
${activeSkus.map((s, i) => `
### SKU ${i + 1}: ${s.seller_sku}
- 产品状态: ${s.product_status}
- FBA可售库存: ${s.fulfillable_qty} 件
- AWD库存: ${s.awd_qty} 件
- 本地仓库存: ${s.local_qty} 件
- 在途库存: ${s.inbound_qty} 件
- 近30天日均销量: ${s.avg_daily_sales} 件/天
- 近7天日均销量: ${s.avg_7d_sales || s.avg_daily_sales} 件/天
- 头程运输天数: ${s.lead_time_days} 天
- 安全库存天数: ${s.safety_stock_days} 天
- 是否旺季: ${s.is_peak_season ? '是' : '否'}
`).join('')}

## 分析要求
1. 综合考虑FBA+AWD+本地仓+在途的全渠道库存
2. 如果AWD有库存，优先建议从AWD转运到FBA（周期短）
3. 如果本地仓有库存，建议从本地仓发货
4. 旺季需要额外增加20%安全库存
5. 考虑运输方式：紧急用空运，常规用海运

## 输出格式（JSON）
每个SKU返回:
- seller_sku: SKU编号
- risk_level: "紧急"/"警告"/"正常"/"充足"
- sellable_days: 全渠道可售天数
- fba_sellable_days: 仅FBA可售天数
- recommended_action: "紧急补货"/"AWD转运"/"本地仓发货"/"新采购"/"暂不需要"
- recommended_qty: 建议补货数量
- source: "本地仓"/"AWD"/"新采购"
- shipping_method: "空运"/"海运"/"AWD转运"
- estimated_stockout_date: "预计断货日期"
- reasoning: "分析说明（100字以内）"
- priority_score: 1-10优先级评分`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊FBA全渠道库存管理AI助手，输出严格的JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "enhanced_replenishment",
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
                      risk_level: { type: "string" },
                      sellable_days: { type: "number" },
                      fba_sellable_days: { type: "number" },
                      recommended_action: { type: "string" },
                      recommended_qty: { type: "number" },
                      source: { type: "string" },
                      shipping_method: { type: "string" },
                      estimated_stockout_date: { type: "string" },
                      reasoning: { type: "string" },
                      priority_score: { type: "number" },
                    },
                    required: ["seller_sku", "risk_level", "sellable_days", "fba_sellable_days", "recommended_action", "recommended_qty", "source", "shipping_method", "estimated_stockout_date", "reasoning", "priority_score"],
                    additionalProperties: false,
                  },
                },
                summary: {
                  type: "object",
                  properties: {
                    urgent_count: { type: "number" },
                    total_restock_qty: { type: "number" },
                    estimated_total_cost: { type: "string" },
                    key_insight: { type: "string" },
                  },
                  required: ["urgent_count", "total_restock_qty", "estimated_total_cost", "key_insight"],
                  additionalProperties: false,
                },
              },
              required: ["suggestions", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // 补货建议图表数据
  getReplenishChart: protectedProcedure
    .input(z.object({ sku: z.string().optional(), asin: z.string().optional() }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/fba/replenish/chart",
        body: { sku: input.sku, asin: input.asin },
      });
      return { data: res.data, isMock: adapter.isMockMode() };
    }),

  // ============== Profit Module ==============
  getProfitOverview: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      granularity: z.enum(["daily", "weekly", "monthly"]).optional().default("daily"),
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
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
        const res = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/msku/list",
          body: {
            sid: firstSid,
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
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const startDate = input.startDate || getDateNDaysAgo(30);
      const endDate = input.endDate || getToday();
      
      // Paginate to fetch ALL MSKU records with summaryEnabled
      let allRecords: any[] = [];
      let offset = 0;
      const pageSize = 200;
      let hasMore = true;
      
      while (hasMore) {
        const res = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/msku/list",
          body: {
            startDate,
            endDate,
            length: pageSize,
            offset,
            summaryEnabled: true,
          },
        });
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
      reportDate: z.string().optional(), // Single date YYYY-MM-DD, matches Lingxing hour data API
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      marketplace: z.string().optional(),
      adState: z.enum(['all', 'enabled', 'paused', 'archived']).optional().default('all'),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      // Get real SIDs filtered by marketplace
      const { sids: allSids, sellers } = await getAllSellerSids();
      const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
      let realSid = input.sid || (filteredSids.length > 0 ? Number(filteredSids[0]) : 1);
      const sidsToQuery = input.sid ? [input.sid] : filteredSids.map(Number).slice(0, 5);
      console.log(`[AdCampaigns] Querying ad campaigns across sids: ${sidsToQuery.join(',')}`);
      
      // 1. Get campaign list from all stores (names, status, budget)
      const campaignNameMap: Record<string, any> = {};
      const allCampaignList: any[] = [];
      for (const sid of sidsToQuery) {
        try {
          const campaignListRes = await adapter.requestWithMockFallback({
            path: "/pb/openapi/newad/spCampaigns",
            body: { sid },
            headers: { "X-API-VERSION": "2" },
          });
          const rawCampaigns = campaignListRes.data || [];
          const campaigns = Array.isArray(rawCampaigns) ? rawCampaigns : (rawCampaigns as any).records || (rawCampaigns as any).list || [];
          console.log(`[AdCampaigns] sid=${sid}: Got ${campaigns.length} campaigns`);
          for (const c of campaigns) {
            campaignNameMap[String(c.campaign_id)] = {
              name: c.name || c.campaign_name || '',
              daily_budget: c.daily_budget || 0,
              state: c.state || c.status || 'unknown',
              serving_status: c.serving_status || '',
              targeting_type: c.targeting_type || '',
              campaign_type: c.campaign_type || '',
              start_date: c.start_date || '',
              portfolio_id: c.portfolio_id || '',
              portfolio_name: c.portfolio_name || '',
              sid,
            };
            allCampaignList.push({ ...c, sid });
          }
        } catch (err: any) {
          console.warn(`[AdCampaigns] sid=${sid}: Failed to get campaigns: ${err.message}`);
        }
      }
      console.log(`[AdCampaigns] Total campaigns from list API: ${allCampaignList.length}`);
      
      // 2. Get campaign hour data using spCampaignHourData API
      // This API returns hourly data per campaign_id per date, with cost/sales/clicks/etc.
      // Use single reportDate for efficient querying (1 date = 1 API call per campaign)
      const queryDate = input.reportDate || getDateNDaysAgo(1);
      const queryDates = [queryDate];
      console.log(`[AdCampaigns] Querying spCampaignHourData for ${queryDates.length} days: ${queryDates[0]} ~ ${queryDates[queryDates.length - 1]}`);
      const reportMap: Record<string, any> = {};
      const campaignProfileMap: Record<string, string> = {}; // campaign_id -> profile_id
      
      // Build tasks: campaign_id x date combos
      const allCampaignIdsForReport = allCampaignList.map((c: any) => String(c.campaign_id));
      const uniqueCampaignIds = Array.from(new Set(allCampaignIdsForReport));
      
      // To avoid too many API calls, batch by date (each call returns all hours for one campaign on one date)
      // Limit concurrent requests: max 50 campaigns x dates at a time
      const MAX_REPORT_TASKS = 300;
      const reportTasks: { campaignId: string; reportDate: string }[] = [];
      for (const cid of uniqueCampaignIds) {
        for (const reportDate of queryDates) {
          reportTasks.push({ campaignId: cid, reportDate });
          if (reportTasks.length >= MAX_REPORT_TASKS) break;
        }
        if (reportTasks.length >= MAX_REPORT_TASKS) break;
      }
      console.log(`[AdCampaigns] Fetching ${reportTasks.length} hour-data tasks in parallel (${uniqueCampaignIds.length} campaigns x ${queryDates.length} days, capped at ${MAX_REPORT_TASKS})`);
      
      // Execute in batches of 30 to respect rate limits
      const BATCH_SIZE = 30;
      let rejectedCount = 0;
      let fulfilledCount = 0;
      let totalReportRows = 0;
      
      for (let batchStart = 0; batchStart < reportTasks.length; batchStart += BATCH_SIZE) {
        const batch = reportTasks.slice(batchStart, batchStart + BATCH_SIZE);
        const reportResults = await Promise.allSettled(
          batch.map(({ campaignId, reportDate }) =>
            adapter.requestWithMockFallback({
              path: "/pb/openaps/newad/spCampaignHourData",
              body: { campaign_id: Number(campaignId), report_date: reportDate },
            }).then(res => ({ campaignId, reportDate, res }))
          )
        );
        
        for (const result of reportResults) {
          if (result.status === 'rejected') {
            rejectedCount++;
            continue;
          }
          fulfilledCount++;
          const { campaignId, reportDate, res } = result.value;
          const rawReport = res.data || [];
          const reportData = Array.isArray(rawReport) ? rawReport : (rawReport as any).records || (rawReport as any).list || [];
          
          // Debug: log first successful response
          if (fulfilledCount === 1 && reportData.length > 0) {
            const sample = reportData[0];
            console.log(`[AdCampaigns] HourData sample keys: ${Object.keys(sample).join(', ')}`);
            console.log(`[AdCampaigns] HourData sample: cost=${sample.cost}, clicks=${sample.clicks}, impressions=${sample.impressions}, sales=${sample.sales}, orders=${sample.orders}`);
          }
          
          // Aggregate hourly data into campaign totals
          for (const r of reportData) {
            const cid = String(r.campaign_id || campaignId);
            if (r.profile_id) campaignProfileMap[cid] = String(r.profile_id);
            totalReportRows++;
            if (reportMap[cid]) {
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
        }
      }
      
      console.log(`[AdCampaigns] HourData fetch complete: fulfilled=${fulfilledCount}, rejected=${rejectedCount}, totalHourRows=${totalReportRows}`);
      const reportMapEntries = Object.entries(reportMap);
      console.log(`[AdCampaigns] reportMap has ${reportMapEntries.length} campaigns with data`);
      if (reportMapEntries.length > 0) {
        const [sampleCid, sampleData] = reportMapEntries[0];
        console.log(`[AdCampaigns] reportMap sample cid=${sampleCid}: cost=${sampleData.cost}, sales=${sampleData.sales}, clicks=${sampleData.clicks}, impressions=${sampleData.impressions}`);
      }
      
      // 2.5 Find campaigns in reports that are missing names, try to fetch by profile_id
      const missingCampaignIds = Object.keys(reportMap).filter(cid => !campaignNameMap[cid]);
      if (missingCampaignIds.length > 0) {
        // Use profile_ids collected during report query (no re-query needed)
        const missingProfileIds = new Set<string>();
        for (const cid of missingCampaignIds) {
          const pid = campaignProfileMap[cid];
          if (pid) missingProfileIds.add(pid);
        }
        
        // Query spCampaigns by profile_id for missing campaigns
        for (const profileId of Array.from(missingProfileIds)) {
          try {
            console.log(`[AdCampaigns] Fetching campaigns by profile_id=${profileId} for ${missingCampaignIds.length} missing names`);
            const profileRes = await adapter.requestWithMockFallback({
              path: "/pb/openapi/newad/spCampaigns",
              body: { profile_id: Number(profileId), offset: 0, length: 200 },
              headers: { "X-API-VERSION": "2" },
            });
            const profileCampaigns = profileRes.data || [];
            const campaigns2 = Array.isArray(profileCampaigns) ? profileCampaigns : (profileCampaigns as any).records || (profileCampaigns as any).list || [];
            console.log(`[AdCampaigns] profile_id=${profileId}: Got ${campaigns2.length} campaigns`);
            for (const c of campaigns2) {
              const cid = String(c.campaign_id);
              if (!campaignNameMap[cid]) {
                campaignNameMap[cid] = {
                  name: c.name || c.campaign_name || '',
                  daily_budget: c.daily_budget || 0,
                  state: c.state || c.status || 'unknown',
                  serving_status: c.serving_status || '',
                  targeting_type: c.targeting_type || '',
                  campaign_type: c.campaign_type || '',
                  start_date: c.start_date || '',
                  portfolio_id: c.portfolio_id || '',
                  portfolio_name: c.portfolio_name || '',
                  sid: 0,
                };
              }
            }
          } catch (err: any) {
            console.warn(`[AdCampaigns] profile_id=${profileId}: Failed: ${err.message}`);
          }
        }
        
        const stillMissing = missingCampaignIds.filter(cid => !campaignNameMap[cid]);
        console.log(`[AdCampaigns] After profile_id lookup: ${missingCampaignIds.length - stillMissing.length} names resolved, ${stillMissing.length} still missing`);
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
          portfolio_id: info.portfolio_id || '',
          portfolio_name: info.portfolio_name || '',
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
      
      // Filter by adState if specified
      let filteredCampaigns = campaigns;
      if (input.adState && input.adState !== 'all') {
        filteredCampaigns = campaigns.filter(c => c.state === input.adState);
      }
      
      // Sort by spend descending
      filteredCampaigns.sort((a, b) => b.spend - a.spend);
      
      // Build Portfolio+Campaign two-level structure
      const portfolioMap: Record<string, { id: string; name: string; campaigns: any[]; impressions: number; clicks: number; spend: number; sales: number; orders: number }> = {};
      for (const c of filteredCampaigns) {
        const pid = c.portfolio_id || 'ungrouped';
        const pname = c.portfolio_name || '未分组';
        if (!portfolioMap[pid]) {
          portfolioMap[pid] = { id: pid, name: pname, campaigns: [], impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
        }
        portfolioMap[pid].campaigns.push(c);
        portfolioMap[pid].impressions += c.impressions;
        portfolioMap[pid].clicks += c.clicks;
        portfolioMap[pid].spend += c.spend;
        portfolioMap[pid].sales += c.sales;
        portfolioMap[pid].orders += c.orders;
      }
      // Convert to array and compute portfolio-level metrics
      const portfolios = Object.values(portfolioMap).map(p => ({
        ...p,
        acos: p.sales > 0 ? Math.round(p.spend / p.sales * 10000) / 100 : 0,
        roas: p.spend > 0 ? Math.round(p.sales / p.spend * 100) / 100 : 0,
        ctr: p.impressions > 0 ? Math.round(p.clicks / p.impressions * 10000) / 100 : 0,
        cpc: p.clicks > 0 ? Math.round(p.spend / p.clicks * 100) / 100 : 0,
        campaignCount: p.campaigns.length,
      })).sort((a, b) => b.spend - a.spend);
      
      console.log(`[AdCampaigns] Final: ${filteredCampaigns.length} campaigns in ${portfolios.length} portfolios (state=${input.adState})`);
      return { campaigns: filteredCampaigns, allCampaigns: campaigns, portfolios, isMock: adapter.isMockMode() };
    }),

  getSearchTerms: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      campaignId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional(), // aggregate over N days (default 7)
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sids: allSids, sellers } = await getAllSellerSids();
      const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = input.sid ? [input.sid] : filteredSids.map(Number).slice(0, 5);
      const days = input.days || 7;
      
      // Aggregate search terms over multiple days for more reliable data
      const termAggMap: Record<string, {
        query: string;
        target_text: string;
        match_type: string;
        campaign_id: string;
        ad_group_id: string;
        impressions: number;
        clicks: number;
        cost: number;
        sales: number;
        orders: number;
        units: number;
        days_seen: number;
      }> = {};
      
      // Parallel: build all sid+day combos and fetch concurrently
      const termTasks = sidsToQuery.flatMap(sid =>
        Array.from({ length: days }, (_, i) => ({ sid, reportDate: getDateNDaysAgo(i + 1) }))
      );
      console.log(`[SearchTerms] Fetching ${termTasks.length} search term tasks in parallel (${sidsToQuery.length} sids x ${days} days)`);
      const termResults = await Promise.allSettled(
        termTasks.map(({ sid, reportDate }) =>
          adapter.requestWithMockFallback({
            path: "/pb/openapi/newad/queryWordReports",
            body: { sid, report_date: reportDate, target_type: "keyword", offset: 0, length: 200 },
            headers: { "X-API-VERSION": "2" },
          }).then(res => ({ sid, reportDate, res }))
        )
      );
      for (const result of termResults) {
        if (result.status === 'rejected') continue;
        const { res } = result.value;
        const rawData = res.data || [];
        const items = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
        for (const item of items) {
          const key = `${item.query}||${item.campaign_id}||${item.match_type}`;
          if (termAggMap[key]) {
            termAggMap[key].impressions += Number(item.impressions) || 0;
            termAggMap[key].clicks += Number(item.clicks) || 0;
            termAggMap[key].cost += Number(item.cost) || 0;
            termAggMap[key].sales += Number(item.sales) || 0;
            termAggMap[key].orders += Number(item.orders) || 0;
            termAggMap[key].units += Number(item.units) || 0;
            termAggMap[key].days_seen += 1;
          } else {
            termAggMap[key] = {
              query: item.query || '',
              target_text: item.target_text || '',
              match_type: item.match_type || '',
              campaign_id: String(item.campaign_id || ''),
              ad_group_id: String(item.ad_group_id || ''),
              impressions: Number(item.impressions) || 0,
              clicks: Number(item.clicks) || 0,
              cost: Number(item.cost) || 0,
              sales: Number(item.sales) || 0,
              orders: Number(item.orders) || 0,
              units: Number(item.units) || 0,
              days_seen: 1,
            };
          }
        }
      }
      console.log(`[SearchTerms] Parallel fetch complete: ${termResults.filter(r => r.status === 'fulfilled').length}/${termTasks.length} succeeded`);
      
      // Convert to array and compute derived metrics
      const searchTerms = Object.values(termAggMap).map(t => {
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0;
        const convRate = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
        
        // Auto-classify search terms
        let category: 'high_performer' | 'low_performer' | 'potential' | 'waste' | 'new_term' = 'new_term';
        if (t.clicks < 3 && t.cost < 2) {
          category = 'new_term'; // Too little data
        } else if (t.orders > 0 && acos <= 25) {
          category = 'high_performer';
        } else if (t.orders > 0 && acos > 25 && acos <= 50) {
          category = 'potential';
        } else if (t.cost >= 5 && t.orders === 0) {
          category = 'waste';
        } else if (acos > 50) {
          category = 'low_performer';
        } else {
          category = 'potential';
        }
        
        return {
          ...t,
          acos,
          ctr,
          cpc,
          convRate,
          category,
        };
      });
      
      // Sort by cost descending (highest spend first)
      searchTerms.sort((a, b) => b.cost - a.cost);
      
      // Compute category stats
      const categoryStats = {
        high_performer: searchTerms.filter(t => t.category === 'high_performer').length,
        potential: searchTerms.filter(t => t.category === 'potential').length,
        low_performer: searchTerms.filter(t => t.category === 'low_performer').length,
        waste: searchTerms.filter(t => t.category === 'waste').length,
        new_term: searchTerms.filter(t => t.category === 'new_term').length,
        total: searchTerms.length,
      };
      
      console.log(`[SearchTerms] Aggregated ${searchTerms.length} unique terms over ${days} days. Categories: ${JSON.stringify(categoryStats)}`);
      return { searchTerms, categoryStats, days, isMock: adapter.isMockMode() };
    }),

  aiSearchTermAnalysis: protectedProcedure
    .input(z.object({
      searchTerms: z.array(z.record(z.string(), z.unknown())).max(100),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊PPC广告优化AI专家。分析搜索词数据并给出操作建议。输出严格JSON格式。" },
          { role: "user", content: `分析以下搜索词数据（已按花费降序排列），为每个搜索词给出操作建议。

搜索词数据（包含关键指标）：
${JSON.stringify(input.searchTerms.map(t => ({
  query: (t as any).query,
  impressions: (t as any).impressions,
  clicks: (t as any).clicks,
  cost: (t as any).cost,
  sales: (t as any).sales,
  orders: (t as any).orders,
  acos: (t as any).acos,
  ctr: (t as any).ctr,
  convRate: (t as any).convRate,
  category: (t as any).category,
  match_type: (t as any).match_type,
})))}

对每个搜索词，结合其分类(category)和关键指标，判断应该执行的操作：
- add_exact: 高转化词，建议添加为精确匹配关键词
- add_phrase: 相关性好的词，建议添加为词组匹配
- negate_exact: 无关词，建议否定精确匹配
- negate_phrase: 无关词组，建议否定词组匹配
- increase_bid: 表现好但曝光不足，建议提高出价
- decrease_bid: ACoS过高，建议降低出价
- keep: 表现正常，保持不变
- monitor: 数据不足，继续观察

判断标准：
- category=high_performer (ACoS≤25%且有转化) → add_exact 或 increase_bid
- category=potential (ACoS 25-50%有转化) → keep 或 decrease_bid
- category=low_performer (ACoS>50%) → decrease_bid 或 negate
- category=waste (花费>$5无转化) → negate_exact
- category=new_term (数据不足) → monitor
- 特别注意：花费最高的词需要重点分析，给出具体的出价调整建议

请同时给出整体分析总结和核心机会点。` },
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

  // ============== Marketplace & Settings ==============
  getMarketplaces: protectedProcedure.query(async () => {
    const { sellers } = await getAllSellerSids();
    // Group sellers by marketplace
    const mpMap: Record<string, { code: string; name: string; region: string; sids: string[]; storeNames: string[] }> = {};
    for (const s of sellers) {
      const mid = Number(s.mid);
      const mp = MARKETPLACE_MAP[mid];
      if (!mp) continue;
      if (!mpMap[mp.code]) {
        mpMap[mp.code] = { ...mp, sids: [], storeNames: [] };
      }
      mpMap[mp.code].sids.push(String(s.sid));
      mpMap[mp.code].storeNames.push(s.name || `Store ${s.sid}`);
    }
    return Object.values(mpMap).sort((a, b) => b.sids.length - a.sids.length);
  }),

  getUserSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const rows = await db!.select().from(userSettings)
      .where(eq(userSettings.userId, ctx.user.id));
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.settingKey] = r.settingValue || '';
    }
    return result;
  }),

  saveUserSetting: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const now = Date.now();
      // Upsert: try to find existing, then insert or update
      const existing = await db!.select().from(userSettings)
        .where(and(eq(userSettings.userId, ctx.user.id), eq(userSettings.settingKey, input.key)));
      if (existing.length > 0) {
        await db!.update(userSettings)
          .set({ settingValue: input.value, updatedAt: now })
          .where(eq(userSettings.id, existing[0].id));
      } else {
        await db!.insert(userSettings).values({
          userId: ctx.user.id,
          settingKey: input.key,
          settingValue: input.value,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { success: true };
    }),

  // ============== ASIN Status Management ==============
  getAsinStatuses: protectedProcedure.query(async () => {
    const db = await getDb();
    const rows = await db!.select().from(asinStatusCache);
    return rows.map(r => ({
      asin: r.asin,
      msku: r.msku,
      marketplace: r.marketplace,
      status: r.listingStatus,
      lastSyncedAt: r.lastSyncedAt,
    }));
  }),

  syncAsinStatuses: protectedProcedure.mutation(async () => {
    const adapter = getLingxingAdapter();
    const db = await getDb();
    const { sids: allSids } = await getAllSellerSids();
    let synced = 0;
    const now = Date.now();
    
    // Query listing status from Lingxing for each store
    for (const sid of allSids.slice(0, 10)) {
      try {
        const res = await adapter.requestWithMockFallback({
          path: "/erp/sc/data/mws/listing",
          body: { sid: Number(sid), offset: 0, length: 200 },
        });
        const listingsRaw = res.data || [];
        const listings = Array.isArray(listingsRaw) ? listingsRaw : (listingsRaw as any)?.records || (listingsRaw as any)?.list || [];
        for (const item of listings) {
          const asin = item.asin1 || item.asin;
          if (!asin) continue;
          const status = item.status === 'Active' || item.status === 'active' ? 'active' : 'inactive';
          // Upsert
          const existing = await db!.select().from(asinStatusCache)
            .where(and(eq(asinStatusCache.asin, asin), eq(asinStatusCache.sid, String(sid))));
          if (existing.length > 0) {
            await db!.update(asinStatusCache)
              .set({ listingStatus: status as any, lastSyncedAt: now, updatedAt: now, msku: item.msku || item.seller_sku })
              .where(eq(asinStatusCache.id, existing[0].id));
          } else {
            await db!.insert(asinStatusCache).values({
              asin,
              msku: item.msku || item.seller_sku || '',
              sid: String(sid),
              marketplace: 'US',
              listingStatus: status as any,
              lastSyncedAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
          synced++;
        }
      } catch (err: any) {
        console.warn(`[SyncAsinStatus] sid=${sid}: ${err.message}`);
      }
    }
    return { synced };
  }),

  // ============== Search Term Translation ==============
  translateSearchTerms: protectedProcedure
    .input(z.object({ terms: z.array(z.string()).max(50) }))
    .mutation(async ({ input }) => {
      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a translation assistant. Translate the following English Amazon search terms to Chinese. Return a JSON object where keys are the original English terms and values are the Chinese translations. Be concise and accurate. Focus on the product/shopping intent."
            },
            {
              role: "user",
              content: `Translate these search terms to Chinese:\n${input.terms.join('\n')}`
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "translations",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  translations: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  }
                },
                required: ["translations"],
                additionalProperties: false,
              }
            }
          }
        });
        const content = response.choices?.[0]?.message?.content;
        if (content && typeof content === 'string') {
          const parsed = JSON.parse(content);
          return parsed.translations || {};
        }
        return {};
      } catch (err: any) {
        console.error(`[TranslateSearchTerms] Error: ${err.message}`);
        return {};
      }
    }),

  // ============== ASIN Tag Management ==============
  listTagDefinitions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(asinTagDefinitions)
      .where(eq(asinTagDefinitions.userId, ctx.user.id));
  }),

  createTagDefinition: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(50),
      color: z.string().default('#6366f1'),
      hideFromInventory: z.number().min(0).max(1).default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(asinTagDefinitions).values({
        userId: ctx.user.id,
        name: input.name,
        color: input.color,
        hideFromInventory: input.hideFromInventory,
      });
      return { id: result.insertId };
    }),

  updateTagDefinition: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(50).optional(),
      color: z.string().optional(),
      hideFromInventory: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.hideFromInventory !== undefined) updateData.hideFromInventory = input.hideFromInventory;
      await db!.update(asinTagDefinitions)
        .set(updateData)
        .where(and(eq(asinTagDefinitions.id, input.id), eq(asinTagDefinitions.userId, ctx.user.id)));
      return { success: true };
    }),

  deleteTagDefinition: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Delete all assignments first
      await db!.delete(asinTagAssignments)
        .where(and(eq(asinTagAssignments.tagId, input.id), eq(asinTagAssignments.userId, ctx.user.id)));
      // Then delete the definition
      await db!.delete(asinTagDefinitions)
        .where(and(eq(asinTagDefinitions.id, input.id), eq(asinTagDefinitions.userId, ctx.user.id)));
      return { success: true };
    }),

  listTagAssignments: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(asinTagAssignments)
      .where(eq(asinTagAssignments.userId, ctx.user.id));
  }),

  assignTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asin: z.string(),
      msku: z.string().optional(),
      sid: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Check if already assigned
      const existing = await db!.select().from(asinTagAssignments)
        .where(and(
          eq(asinTagAssignments.userId, ctx.user.id),
          eq(asinTagAssignments.tagId, input.tagId),
          eq(asinTagAssignments.asin, input.asin),
        ));
      if (existing.length > 0) return { id: existing[0].id };
      const [result] = await db!.insert(asinTagAssignments).values({
        userId: ctx.user.id,
        tagId: input.tagId,
        asin: input.asin,
        msku: input.msku,
        sid: input.sid,
      });
      return { id: result.insertId };
    }),

  removeTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asin: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(asinTagAssignments)
        .where(and(
          eq(asinTagAssignments.userId, ctx.user.id),
          eq(asinTagAssignments.tagId, input.tagId),
          eq(asinTagAssignments.asin, input.asin),
        ));
      return { success: true };
    }),

  batchAssignTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asins: z.array(z.object({
        asin: z.string(),
        msku: z.string().optional(),
        sid: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let count = 0;
      for (const item of input.asins) {
        const existing = await db!.select().from(asinTagAssignments)
          .where(and(
            eq(asinTagAssignments.userId, ctx.user.id),
            eq(asinTagAssignments.tagId, input.tagId),
            eq(asinTagAssignments.asin, item.asin),
          ));
        if (existing.length === 0) {
          await db!.insert(asinTagAssignments).values({
            userId: ctx.user.id,
            tagId: input.tagId,
            asin: item.asin,
            msku: item.msku,
            sid: item.sid,
          });
          count++;
        }
      }
      return { count };
    }),
});

// Helper functions
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
