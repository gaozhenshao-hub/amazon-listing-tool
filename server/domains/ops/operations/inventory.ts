import { z, TRPCError, protectedProcedure, router, getDb, invokeLLM, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const inventoryProcedures = {
// --- Dashboard Overview ---
  getDashboardOverview: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const db = await getDb();
    const mp = input?.marketplace || 'ALL';

    // ── Profit & Sales data: from imported Excel (lingxing_product_weekly) ──
    const effectiveUserId = await resolveDataUserId(db!, ctx.user);

    // Get all available weeks, take the most recent 12 weeks for trend
    const weekRanges = await db!.selectDistinct({
      weekStartDate: lingxingProductWeekly.weekStartDate,
      weekEndDate: lingxingProductWeekly.weekEndDate,
    })
      .from(lingxingProductWeekly)
      .where(opsWorkspaceCondition(lingxingProductWeekly, workspaceIdFromContext(ctx), eq(lingxingProductWeekly.userId, effectiveUserId)))
      .orderBy(desc(lingxingProductWeekly.weekStartDate))
      .limit(12);

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalOrders = 0;
    let totalAdSpendFromExcel = 0;
    let totalAdSalesFromExcel = 0;
    let profitTrend: { date: string; revenue: number; profit: number; margin: number; orders: number; adSpend: number }[] = [];
    let permittedData: any[] = [];

    if (weekRanges.length > 0) {
      // Get all data for these weeks
      const allWeeklyData = await db!.select().from(lingxingProductWeekly)
        .where(opsWorkspaceCondition(lingxingProductWeekly, workspaceIdFromContext(ctx), and(
          eq(lingxingProductWeekly.userId, effectiveUserId),
          sql`${lingxingProductWeekly.weekStartDate} IN (${sql.join(weekRanges.map((w: any) => sql`${w.weekStartDate}`), sql`,`)})`
        )));

      // Filter by marketplace if needed
      const filteredData = mp === 'ALL' ? allWeeklyData : allWeeklyData.filter((r: any) => {
        const c = (r.country || '').toUpperCase();
        return c === mp || c.includes(mp);
      });

      // Apply operator-based permission filtering for non-admin users
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      permittedData = filteredData;
      if (!isManagerOrAbove && ctx.user.name) {
        // Need to apply operator name mappings first
        const allMappings = await db!.select().from(operatorNameMappings)
          .where(opsWorkspaceCondition(operatorNameMappings, workspaceIdFromContext(ctx), and(
            eq(operatorNameMappings.userId, effectiveUserId),
            eq(operatorNameMappings.isConfirmed, 1),
          )));
        const mappingLookup = new Map<string, string>();
        for (const m of allMappings) {
          if (m.externalName && m.systemUserName) {
            mappingLookup.set(m.externalName.toLowerCase(), m.systemUserName);
          }
        }
        permittedData = filteredData.filter((r: any) => {
          if (!r.operator) return false;
          const mapped = mappingLookup.get(r.operator.toLowerCase()) || r.operator;
          return mapped === ctx.user.name;
        });
      }

      // Aggregate by week for trend chart
      const weekMap: Record<string, { revenue: number; profit: number; orders: number; adSpend: number; adSales: number }> = {};
      for (const row of permittedData) {
        const weekKey = row.weekStartDate;
        if (!weekMap[weekKey]) weekMap[weekKey] = { revenue: 0, profit: 0, orders: 0, adSpend: 0, adSales: 0 };
        weekMap[weekKey].revenue += parseFloat(String(row.salesAmount || 0));
        weekMap[weekKey].profit += parseFloat(String(row.orderProfit || row.settlementProfit || 0));
        weekMap[weekKey].orders += (row.salesQty || 0);
        weekMap[weekKey].adSpend += parseFloat(String(row.adSpend || 0));
        weekMap[weekKey].adSales += parseFloat(String(row.adSales || 0));
      }

      // Build sorted trend array
      profitTrend = Object.entries(weekMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, v]) => {
          const weekEnd = weekRanges.find((w: any) => w.weekStartDate === weekStart)?.weekEndDate || weekStart;
          return {
            date: `${weekStart.slice(5)}~${weekEnd.slice(5)}`,
            revenue: Math.round(v.revenue * 100) / 100,
            profit: Math.round(v.profit * 100) / 100,
            margin: v.revenue > 0 ? Math.round(v.profit / v.revenue * 10000) / 100 : 0,
            orders: v.orders,
            adSpend: Math.round(v.adSpend * 100) / 100,
          };
        });

      // Calculate summary from the most recent 4 weeks (approximately 30 days)
      const recentWeekKeys = Object.keys(weekMap).sort((a, b) => b.localeCompare(a)).slice(0, 4);
      for (const wk of recentWeekKeys) {
        const v = weekMap[wk];
        totalRevenue += v.revenue;
        totalProfit += v.profit;
        totalOrders += v.orders;
        totalAdSpendFromExcel += v.adSpend;
        totalAdSalesFromExcel += v.adSales;
      }
    }

    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
    const avgAcos = totalAdSalesFromExcel > 0 ? (totalAdSpendFromExcel / totalAdSalesFromExcel * 100) : 0;

    // ── Inventory & SKU data: also from imported Excel (latest week) ──
    let skuCount = 0;
    let lowStockCount = 0;
    let overstockCount = 0;
    const inventoryAlerts: { type: string; message: string; severity: string }[] = [];

    if (weekRanges.length > 0) {
      // Use the most recent week's data for inventory snapshot
      const latestWeekStart = weekRanges[0].weekStartDate;
      const latestWeekData = (permittedData || []).filter((r: any) => r.weekStartDate === latestWeekStart);

      // Count unique parent ASINs as SKU count
      const uniqueAsins = new Set(latestWeekData.map((r: any) => r.parentAsin || r.asin).filter(Boolean));
      skuCount = uniqueAsins.size;

      // Inventory alerts based on fbaDaysOfSupply
      for (const row of latestWeekData) {
        const days = row.fbaDaysOfSupply || 0;
        if (days > 0 && days < 14) lowStockCount++;
        if (days > 90) overstockCount++;
        if (days > 0 && days < 7) {
          const asin = row.parentAsin || row.asin || 'Unknown';
          inventoryAlerts.push({
            type: "inventory_critical",
            message: `${asin}: 仅剩${days}天库存，需紧急补货`,
            severity: "critical",
          });
        }
      }
    }

    console.log(`[Dashboard] Excel data: ${profitTrend.length} weeks trend, Revenue: $${totalRevenue.toFixed(2)}, Profit: $${totalProfit.toFixed(2)}, SKUs: ${skuCount}, LowStock: ${lowStockCount}`);

    return {
      isMock: false, // No longer using mock/real Lingxing API distinction
      dataSource: 'excel' as const, // Indicate data is from imported Excel
      summary: {
        revenue30d: Math.round(totalRevenue * 100) / 100,
        profit30d: Math.round(totalProfit * 100) / 100,
        orders30d: totalOrders,
        avgMargin: Math.round(avgMargin * 10) / 10,
        skuCount,
        lowStockCount,
        overstockCount,
        adSpend30d: Math.round(totalAdSpendFromExcel * 100) / 100,
        avgAcos: Math.round(avgAcos * 10) / 10,
        sellerCount: 0, // Not applicable for Excel data
      },
      profitTrend,
      topAlerts: inventoryAlerts.slice(0, 5),
    };
  }),

// --- Lingxing Connection Status ---
  getLingxingStatus: protectedProcedure.query(async () => {
    return {
      isMock: true,
      recentLogs: [].slice(-10),
      cacheSize: 0, // cache stats not exposed
    };
  }),

toggleMockMode: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      /* lingxing deprecated */
      return { isMock: true };
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
      // Get real SIDs filtered by marketplace
      let sidStr: string;
      if (input.sid) {
        sidStr = String(input.sid);
      } else {
        const { sids, sellers } = await getAllSellerSids();
        const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
        sidStr = filteredSids.join(',');
      }
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });

      // Normalize: FBA v2 API returns {records:[...]} or array
      const rawData = res.data || [];
      const dataList = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
      if (dataList.length > 0) {
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
        }).from(productProfiles).where(opsWorkspaceCondition(productProfiles, workspaceIdFromContext(ctx), eq(productProfiles.userId, ctx.user.id)));
        const profileMap = new Map(profiles.map(p => [p.parentAsin, p]));
        
        // Build childAsin → parentAsin mapping via product_profiles + product_variants join
        const variantProfiles = await db!.select({
          childAsin: productVariants.childAsin,
          parentAsin: productProfiles.parentAsin,
          operator: productProfiles.operator,
          storeName: productProfiles.storeName,
        }).from(productVariants)
          .innerJoin(productProfiles, eq(productVariants.productId, productProfiles.id))
          .where(opsWorkspaceCondition(productProfiles, workspaceIdFromContext(ctx), eq(productProfiles.userId, ctx.user.id)));
        
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

      return { items, stats, isMock: true };
    }),

getReplenishmentSuggestions: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      // Get real SIDs
      const { sids } = await getAllSellerSids();
      const sidList = input.sid ? [input.sid] : sids.map(Number);
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      // Normalize: may return {list:[...]} or array
      const rawItems = res.data || [];
      const items = Array.isArray(rawItems) ? rawItems : (rawItems as any).list || (rawItems as any).records || [];
      if (items.length > 0) {
      }
      
      // Filter out discontinued/inactive ASINs from replenishment suggestions
      // Check asinStatusCache for status, also filter items with 0 daily sales and 0 inventory
      const db = await getDb();
      const asinStatuses = db ? await db.select().from(asinStatusCache)
        .where(opsWorkspaceCondition(asinStatusCache, workspaceIdFromContext(ctx))) : [];
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
      
      return { items: filteredItems, isMock: true };
    }),

getInventoryConfig: protectedProcedure
    .input(z.object({ sellerSku: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const configs = await db!.select().from(inventoryConfig)
        .where(opsWorkspaceCondition(inventoryConfig, workspaceIdFromContext(ctx), and(
          eq(inventoryConfig.userId, ctx.user.id),
          eq(inventoryConfig.sellerSku, input.sellerSku)
        )));
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
        .where(opsWorkspaceCondition(inventoryConfig, workspaceIdFromContext(ctx), and(
          eq(inventoryConfig.userId, ctx.user.id),
          eq(inventoryConfig.sellerSku, input.sellerSku)
        )));

      if (existing.length > 0) {
        await db!.update(inventoryConfig)
          .set({ ...input, userId: ctx.user.id })
          .where(opsWorkspaceCondition(inventoryConfig, workspaceIdFromContext(ctx), eq(inventoryConfig.id, existing[0].id)));
        return { id: existing[0].id, updated: true };
      } else {
        const [result] = await db!.insert(inventoryConfig).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
          ...input,
          userId: ctx.user.id,
        }));
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
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
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
        isMock: true,
      };
    }),

// 本地仓库存查询
  getLocalWarehouseInventory: protectedProcedure
    .input(z.object({ marketplace: z.string().optional().default("US") }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
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
        isMock: true,
      };
    }),

// 全渠道库存汇总（FBA + AWD + 本地仓）
  getOmniChannelInventory: protectedProcedure
    .input(z.object({ marketplace: z.string().optional().default("US") }))
    .query(async ({ input }) => {
      // 并行获取三个渠道的库存
      const [fbaRes, awdRes, localRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
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
      
      return { items: aggregated, summary, isMock: true };
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
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { data: res.data, isMock: true };
    })
};
