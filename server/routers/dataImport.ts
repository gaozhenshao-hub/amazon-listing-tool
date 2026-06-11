/**
 * Data Import Center Router
 * Handles Excel file upload, parsing, preview, and import for
 * Lingxing (领星) and Saihu (赛狐) product data
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dataImports, lingxingProductWeekly, saihuProductWeekly, operatorNameMappings, users, productionConfig } from "../../drizzle/schema";
import { MANAGER_ROLES } from "../../shared/const";
import { eq, desc, and, sql, or } from "drizzle-orm";
import { parseExcelBuffer, parseDateRangeFromFilename, detectSourceType, type SourceType, type DateRange } from "../excelParser";
import { storagePut } from "../storage";

/**
 * Helper: Resolve the effective userId for data queries.
 * Non-admin/manager users need to query data imported by admins, not their own userId.
 * Returns the userId that should be used for querying imported data tables.
 */
export async function resolveDataUserId(db: any, currentUser: { id: number; role: string; name: string | null }): Promise<number> {
  const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(currentUser.role);
  if (isManagerOrAbove) {
    return currentUser.id;
  }
  // For non-admin users, find the admin/super_admin who has imported data
  // First check if the current user has their own imported data
  const [ownData] = await db.select({ count: sql<number>`count(*)` })
    .from(dataImports)
    .where(eq(dataImports.userId, currentUser.id));
  if (ownData?.count > 0) {
    return currentUser.id;
  }
  // Otherwise, find the admin who has imported data
  const adminUsers = await db.select({ id: users.id, role: users.role })
    .from(users)
    .where(and(
      or(
        eq(users.role, "super_admin"),
        eq(users.role, "admin"),
        eq(users.role, "ops_manager")
      ),
      eq(users.status, "active")
    ));
  // Find the admin with the most recent import
  for (const admin of adminUsers) {
    const [adminData] = await db.select({ count: sql<number>`count(*)` })
      .from(dataImports)
      .where(eq(dataImports.userId, admin.id));
    if (adminData?.count > 0) {
      return admin.id;
    }
  }
  // Fallback: return current user's id (will show empty data)
  return currentUser.id;
}

/**
 * Helper: Filter products by operator permission for non-admin users.
 * After operator name mapping is applied, filter to only show products
 * where the operator matches the current user's name.
 */
function filterByOperatorPermission(
  items: { operator: string | null }[],
  currentUser: { role: string; name: string | null }
): typeof items {
  const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(currentUser.role);
  if (isManagerOrAbove || !currentUser.name) {
    return items;
  }
  // Non-admin users only see products assigned to them
  return items.filter(item => {
    if (!item.operator) return false;
    return item.operator === currentUser.name;
  });
}

/**
 * Helper: Apply operator name mappings to replace external names with system user names
 * Queries the operator_name_mappings table and replaces operator fields in-place
 */
async function applyOperatorMappings(
  db: any,
  userId: number,
  items: { operator: string | null }[],
  sourceType: "lingxing" | "saihu"
): Promise<void> {
  // Collect all unique operator names
  const uniqueNames = [...new Set(items.map(i => i.operator).filter(Boolean))] as string[];
  if (uniqueNames.length === 0) return;

  // Load all confirmed mappings for this user
  const allMappings = await db.select().from(operatorNameMappings)
    .where(and(
      eq(operatorNameMappings.userId, userId),
      eq(operatorNameMappings.isConfirmed, 1),
    ));

  // Build a lookup map: externalName -> systemUserName
  const mappingLookup = new Map<string, string>();
  for (const name of uniqueNames) {
    const mapping = allMappings.find((m: any) =>
      m.externalName === name &&
      (m.sourceType === sourceType || m.sourceType === "all")
    );
    if (mapping && mapping.systemUserName) {
      mappingLookup.set(name, mapping.systemUserName);
    }
  }

  // Replace operator names in-place
  let replaced = 0, notFound = 0;
  for (const item of items) {
    if (item.operator && mappingLookup.has(item.operator)) {
      item.operator = mappingLookup.get(item.operator)!;
      replaced++;
    } else if (item.operator) {
      notFound++;
    }
  }
}

export const dataImportRouter = router({
  // ─── Upload & Parse Excel (returns preview) ───
  uploadAndParse: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64 encoded
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const buffer = Buffer.from(input.fileData, "base64");

      // Parse the Excel file
      const result = parseExcelBuffer(buffer, input.fileName);

      // Upload to S3 for storage
      const suffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `data-imports/${ctx.user.id}/${Date.now()}-${suffix}.xlsx`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // Create import record in "previewing" status
      const [importRecord] = await db!.insert(dataImports).values({
        userId: ctx.user.id,
        sourceType: result.sourceType,
        fileName: input.fileName,
        fileUrl,
        weekStartDate: result.dateRange.startDate,
        weekEndDate: result.dateRange.endDate,
        totalRows: result.totalRows,
        status: "previewing",
      });

      return {
        importId: importRecord.insertId,
        sourceType: result.sourceType,
        dateRange: result.dateRange,
        totalRows: result.totalRows,
        previewRows: result.previewRows,
        unmappedColumns: result.unmappedColumns,
        mappedColumnCount: result.headers.length - result.unmappedColumns.length,
      };
    }),

  // ─── Confirm Import (save parsed data to DB) ───
  confirmImport: protectedProcedure
    .input(z.object({
      importId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Get import record
      const [importRecord] = await db!.select().from(dataImports)
        .where(and(eq(dataImports.id, input.importId), eq(dataImports.userId, ctx.user.id)));

      if (!importRecord) throw new Error("导入记录不存在");
      if (importRecord.status === "completed") throw new Error("该文件已导入完成");

      // Update status to importing
      await db!.update(dataImports)
        .set({ status: "importing" })
        .where(eq(dataImports.id, input.importId));

      try {
        // Re-parse the file from S3
        const fileUrl = importRecord.fileUrl;
        if (!fileUrl) throw new Error("文件URL不存在");

        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const result = parseExcelBuffer(buffer, importRecord.fileName);

        // Delete existing data for same user + source + date range (upsert behavior)
        if (result.sourceType === "lingxing") {
          await db!.delete(lingxingProductWeekly).where(
            and(
              eq(lingxingProductWeekly.userId, ctx.user.id),
              eq(lingxingProductWeekly.weekStartDate, result.dateRange.startDate),
              eq(lingxingProductWeekly.weekEndDate, result.dateRange.endDate),
            )
          );
        } else {
          await db!.delete(saihuProductWeekly).where(
            and(
              eq(saihuProductWeekly.userId, ctx.user.id),
              eq(saihuProductWeekly.weekStartDate, result.dateRange.startDate),
              eq(saihuProductWeekly.weekEndDate, result.dateRange.endDate),
            )
          );
        }

        // Insert rows in batches
        let importedRows = 0;
        let skippedRows = 0;
        const batchSize = 50;

        for (let i = 0; i < result.allRows.length; i += batchSize) {
          const batch = result.allRows.slice(i, i + batchSize);
          const dbRows = batch.map(row => ({
            ...row,
            importId: input.importId,
            userId: ctx.user.id,
            weekStartDate: result.dateRange.startDate,
            weekEndDate: result.dateRange.endDate,
          }));

          try {
            if (result.sourceType === "lingxing") {
              await db!.insert(lingxingProductWeekly).values(dbRows as any);
            } else {
              await db!.insert(saihuProductWeekly).values(dbRows as any);
            }
            importedRows += batch.length;
          } catch (err: any) {
            console.error(`[DataImport] Batch insert error at row ${i}:`, err.message);
            skippedRows += batch.length;
          }
        }

        // Update import record
        await db!.update(dataImports)
          .set({
            status: "completed",
            importedRows,
            skippedRows,
          })
          .where(eq(dataImports.id, input.importId));

        return {
          success: true,
          importedRows,
          skippedRows,
          totalRows: result.totalRows,
        };
      } catch (err: any) {
        await db!.update(dataImports)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(dataImports.id, input.importId));
        throw new Error(`导入失败: ${err.message}`);
      }
    }),

  // ─── Get Import History ───
  getHistory: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().default(20),
      sourceType: z.enum(["lingxing", "saihu", "all"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const conditions = [eq(dataImports.userId, ctx.user.id)];
      if (input.sourceType !== "all") {
        conditions.push(eq(dataImports.sourceType, input.sourceType as any));
      }

      const [records, countResult] = await Promise.all([
        db!.select().from(dataImports)
          .where(and(...conditions))
          .orderBy(desc(dataImports.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db!.select({ count: sql<number>`count(*)` }).from(dataImports)
          .where(and(...conditions)),
      ]);

      return {
        records,
        total: countResult[0]?.count || 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ─── Delete Import Record ───
  deleteImport: protectedProcedure
    .input(z.object({ importId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [record] = await db!.select().from(dataImports)
        .where(and(eq(dataImports.id, input.importId), eq(dataImports.userId, ctx.user.id)));

      if (!record) throw new Error("记录不存在");

      // Delete associated data
      if (record.sourceType === "lingxing") {
        await db!.delete(lingxingProductWeekly).where(eq(lingxingProductWeekly.importId, input.importId));
      } else {
        await db!.delete(saihuProductWeekly).where(eq(saihuProductWeekly.importId, input.importId));
      }

      // Delete import record
      await db!.delete(dataImports).where(eq(dataImports.id, input.importId));

      return { success: true };
    }),

  // ─── Get Weekly Data Summary (for product overview) ───
  getWeeklySummary: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["lingxing", "saihu"]),
      weeks: z.number().default(4), // How many recent weeks to fetch
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      // Resolve effective userId for non-admin users
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      if (input.sourceType === "lingxing") {
        // Get distinct week ranges, ordered by date desc
        const weekRanges = await db!.selectDistinct({
          weekStartDate: lingxingProductWeekly.weekStartDate,
          weekEndDate: lingxingProductWeekly.weekEndDate,
        })
          .from(lingxingProductWeekly)
          .where(eq(lingxingProductWeekly.userId, effectiveUserId))
          .orderBy(desc(lingxingProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        // Get all data for these weeks
        const data = await db!.select().from(lingxingProductWeekly)
          .where(and(
            eq(lingxingProductWeekly.userId, effectiveUserId),
            sql`${lingxingProductWeekly.weekStartDate} IN (${sql.join(weekRanges.map((w: { weekStartDate: string }) => sql`${w.weekStartDate}`), sql`,`)})`
          ))
          .orderBy(desc(lingxingProductWeekly.weekStartDate));

        return { weeks: weekRanges, data };
      } else {
        const weekRanges = await db!.selectDistinct({
          weekStartDate: saihuProductWeekly.weekStartDate,
          weekEndDate: saihuProductWeekly.weekEndDate,
        })
          .from(saihuProductWeekly)
          .where(eq(saihuProductWeekly.userId, effectiveUserId))
          .orderBy(desc(saihuProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        const data = await db!.select().from(saihuProductWeekly)
          .where(and(
            eq(saihuProductWeekly.userId, effectiveUserId),
            sql`${saihuProductWeekly.weekStartDate} IN (${sql.join(weekRanges.map((w: { weekStartDate: string }) => sql`${w.weekStartDate}`), sql`,`)})`
          ))
          .orderBy(desc(saihuProductWeekly.weekStartDate));

        return { weeks: weekRanges, data };
      }
    }),

  // ─── Get Available Date Ranges ───
  getAvailableDateRanges: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["lingxing", "saihu"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      // Resolve effective userId for non-admin users
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const table = input.sourceType === "lingxing" ? lingxingProductWeekly : saihuProductWeekly;
      const ranges = await db!.selectDistinct({
        weekStartDate: table.weekStartDate,
        weekEndDate: table.weekEndDate,
      })
        .from(table)
        .where(eq(table.userId, effectiveUserId))
        .orderBy(desc(table.weekStartDate));

      return ranges;
    }),

  // ─── Get Stats for Dashboard ───
  getImportStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      // Resolve effective userId for non-admin users
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const [lingxingCount] = await db!.select({ count: sql<number>`count(DISTINCT week_start_date)` })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId));

      const [saihuCount] = await db!.select({ count: sql<number>`count(DISTINCT week_start_date)` })
        .from(saihuProductWeekly)
        .where(eq(saihuProductWeekly.userId, effectiveUserId));

      const [lingxingProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId));

      const [saihuProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(saihuProductWeekly)
        .where(eq(saihuProductWeekly.userId, effectiveUserId));

      const [latestImport] = await db!.select().from(dataImports)
        .where(and(eq(dataImports.userId, effectiveUserId), eq(dataImports.status, "completed")))
        .orderBy(desc(dataImports.createdAt))
        .limit(1);

      return {
        lingxing: {
          weekCount: lingxingCount?.count || 0,
          productCount: lingxingProducts?.count || 0,
        },
        saihu: {
          weekCount: saihuCount?.count || 0,
          productCount: saihuProducts?.count || 0,
        },
        lastImportAt: latestImport?.createdAt || null,
      };
    }),

  // ─── Product Overview from Imported Data ───
  // Returns data in the same shape as productOps.getProductOverviewWithWeeks
  // so the frontend can switch data sources seamlessly
  getProductOverviewFromImport: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["lingxing", "saihu"]),
      weeks: z.number().default(4),
      marketplace: z.string().default("US"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const weeksToShow = input.weeks;
      // Resolve effective userId (non-admin users use admin's data)
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      let result;
      if (input.sourceType === "lingxing") {
        result = await buildOverviewFromLingxing(db!, effectiveUserId, weeksToShow, input.marketplace);
      } else {
        result = await buildOverviewFromSaihu(db!, effectiveUserId, weeksToShow, input.marketplace);
      }
      // Apply operator-based permission filtering for non-admin users
      return filterByOperatorPermission(result, ctx.user) as typeof result;
    }),

  // ─── Get/Set Production Config ───
  getProductionConfigs: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("US"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const configs = await db!.select().from(productionConfig)
        .where(and(
          eq(productionConfig.userId, effectiveUserId),
          eq(productionConfig.marketplace, input.marketplace)
        ));
      // Return as a map: parentAsin -> config
      const map: Record<string, { productionTimeDays: number; shippingTimeDays: number; notes: string | null }> = {};
      for (const c of configs) {
        map[c.parentAsin] = {
          productionTimeDays: c.productionTimeDays || 15,
          shippingTimeDays: c.shippingTimeDays || 30,
          notes: c.notes,
        };
      }
      return map;
    }),

  updateProductionConfig: protectedProcedure
    .input(z.object({
      parentAsin: z.string(),
      marketplace: z.string().default("US"),
      productionTimeDays: z.number().min(0).max(365),
      shippingTimeDays: z.number().min(0).max(365),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      // Upsert
      const existing = await db!.select().from(productionConfig)
        .where(and(
          eq(productionConfig.userId, effectiveUserId),
          eq(productionConfig.parentAsin, input.parentAsin),
          eq(productionConfig.marketplace, input.marketplace)
        ))
        .limit(1);
      if (existing.length > 0) {
        await db!.update(productionConfig)
          .set({
            productionTimeDays: input.productionTimeDays,
            shippingTimeDays: input.shippingTimeDays,
            notes: input.notes || null,
          })
          .where(eq(productionConfig.id, existing[0].id));
      } else {
        await db!.insert(productionConfig).values({
          userId: effectiveUserId,
          parentAsin: input.parentAsin,
          marketplace: input.marketplace,
          productionTimeDays: input.productionTimeDays,
          shippingTimeDays: input.shippingTimeDays,
          notes: input.notes || null,
        });
      }
      return { success: true };
    }),

  // ─── AI Inventory Status Assessment ───
  getInventoryStatus: protectedProcedure
    .input(z.object({
      parentAsin: z.string(),
      marketplace: z.string().default("US"),
      fbaAvailable: z.number(),
      fbaInbound: z.number(),
      avgDailySales7d: z.number(),
      daysOfStock: z.number(),
      productionTimeDays: z.number(),
      shippingTimeDays: z.number(),
    }))
    .query(async ({ input }) => {
      const { fbaAvailable, fbaInbound, avgDailySales7d, daysOfStock, productionTimeDays, shippingTimeDays } = input;
      const totalLeadTime = productionTimeDays + shippingTimeDays;
      const inboundCoverDays = avgDailySales7d > 0 ? Math.round(fbaInbound / avgDailySales7d) : 0;
      const effectiveDays = daysOfStock + inboundCoverDays;

      let status: "sufficient" | "warning" | "urgent" | "stockout_risk";
      let label: string;
      let color: string;
      let suggestion: string;

      if (avgDailySales7d === 0 && fbaAvailable === 0) {
        status = "stockout_risk";
        label = "断货";
        color = "red";
        suggestion = "产品已断货，无销量数据。建议评估是否需要补货或下架。";
      } else if (effectiveDays <= 7) {
        status = "stockout_risk";
        label = "断货风险";
        color = "red";
        suggestion = `可售天数仅${daysOfStock}天（含在途约${effectiveDays}天），远低于生产+物流周期${totalLeadTime}天。建议立即启动紧急补货或空运。`;
      } else if (effectiveDays <= totalLeadTime) {
        status = "urgent";
        label = "紧急备货";
        color = "orange";
        suggestion = `可售天数${daysOfStock}天（含在途约${effectiveDays}天），已接近生产+物流周期${totalLeadTime}天。建议立即下单生产。`;
      } else if (effectiveDays <= totalLeadTime + 14) {
        status = "warning";
        label = "需备货";
        color = "amber";
        suggestion = `可售天数${daysOfStock}天（含在途约${effectiveDays}天），接近安全库存线。建议近期安排生产计划。`;
      } else {
        status = "sufficient";
        label = "充足";
        color = "green";
        suggestion = `库存充足，可售约${daysOfStock}天（含在途约${effectiveDays}天），无需立即补货。`;
      }

      return {
        status,
        label,
        color,
        suggestion,
        metrics: {
          daysOfStock,
          inboundCoverDays,
          effectiveDays,
          totalLeadTime,
          avgDailySales7d,
        },
      };
    }),

  // ─── Product Detail from Imported Data ───
  // Returns product info + ALL weekly data for a single parentAsin
  // Used by the product detail page in import mode
  getProductDetailFromImport: protectedProcedure
    .input(z.object({
      parentAsin: z.string(),
      sourceType: z.enum(["lingxing", "saihu"]),
      marketplace: z.string().default("ALL"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      // Resolve effective userId (non-admin users use admin's data)
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      if (input.sourceType === "lingxing") {
        return buildProductDetailFromLingxing(db!, effectiveUserId, input.parentAsin, input.marketplace);
      } else {
        return buildProductDetailFromSaihu(db!, effectiveUserId, input.parentAsin, input.marketplace);
      }
    }),
});

// ═══════════════════════════════════════════════════════
// Helper: Build product overview from Lingxing imported data
// Lingxing data is already at parent ASIN level, no aggregation needed
// ═══════════════════════════════════════════════════════
async function buildOverviewFromLingxing(db: any, userId: number, weeksToShow: number, marketplace: string) {
  // Get distinct week ranges
  const weekRanges = await db.selectDistinct({
    weekStartDate: lingxingProductWeekly.weekStartDate,
    weekEndDate: lingxingProductWeekly.weekEndDate,
  })
    .from(lingxingProductWeekly)
    .where(eq(lingxingProductWeekly.userId, userId))
    .orderBy(desc(lingxingProductWeekly.weekStartDate))
    .limit(weeksToShow + 1); // +1 for WoW comparison

  if (weekRanges.length === 0) return [];

  // Get all data for these weeks
  const allData = await db.select().from(lingxingProductWeekly)
    .where(and(
      eq(lingxingProductWeekly.userId, userId),
      sql`${lingxingProductWeekly.weekStartDate} IN (${sql.join(weekRanges.map((w: any) => sql`${w.weekStartDate}`), sql`,`)})`
    ))
    .orderBy(desc(lingxingProductWeekly.weekStartDate));

  // Filter by marketplace (country field)
  const marketplaceMap: Record<string, string> = { US: "US", CA: "CA", MX: "MX", UK: "UK", DE: "DE", FR: "FR", IT: "IT", ES: "ES", JP: "JP", AU: "AU" };
  const filteredData = marketplace === "ALL" ? allData : allData.filter((r: any) => {
    const c = (r.country || "").toUpperCase();
    return c === marketplace || c.includes(marketplace);
  });

  // Group by parentAsin
  const parentAsinMap = new Map<string, any[]>();
  for (const row of filteredData) {
    const key = row.parentAsin || row.asin || "unknown";
    if (!parentAsinMap.has(key)) parentAsinMap.set(key, []);
    parentAsinMap.get(key)!.push(row);
  }

  // Build result for each parent ASIN
  const result: any[] = [];
  for (const [parentAsin, rows] of Array.from(parentAsinMap.entries())) {
    // Get the latest row for product info
    const latestRow = rows.sort((a: any, b: any) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""))[0];

    // Group rows by week
    const weekMap = new Map<string, any>();
    for (const row of rows) {
      const weekKey = row.weekStartDate;
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, row);
    }

    // Build weekly data with WoW comparison
    const sortedWeekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
    const weeksWithComparison = sortedWeekKeys.slice(0, weeksToShow).map((weekKey, idx) => {
      const week = weekMap.get(weekKey)!;
      const prevWeekKey = sortedWeekKeys[idx + 1];
      const prevWeek = prevWeekKey ? weekMap.get(prevWeekKey) : null;

      const salesQty = week.salesQty || 0;
      const orderQty = week.orderQty || 0;
      const salesAmount = pf(week.salesAmount);
      const orderProfit = pf(week.orderProfit);
      const profitMargin = parsePercentStr(week.orderProfitMargin);
      const sessionTotal = week.sessionsTotal || 0;
      const totalCvr = parsePercentStr(week.cvr);
      const adCvr = parsePercentStr(week.adCvr);
      const organicCvr = parsePercentStr(week.organicCvr);
      const adOrders = week.adOrders || 0;
      const organicOrders = week.organicOrders || 0;
      const adClicks = week.adClicks || 0;
      const ctr = parsePercentStr(week.ctr);
      const adImpressions = week.adImpressions || 0;
      const cpc = pf(week.cpc);
      const adSpend = pf(week.adSpend);
      const adSales = pf(week.adSales);
      const acos = parsePercentStr(week.acos);
      const rating = pf(week.rating);
      const reviewCount = week.reviewCount || 0;
      const returnRate = parsePercentStr(week.returnRate);

      return {
        id: week.id,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        salesTrend: null as string | null,
        salesQty, orderQty, salesAmount, orderProfit, profitMargin,
        sessionTotal, totalCvr, adCvr, organicCvr,
        adOrders, organicOrders,
        adClicks, ctr, adImpressions, cpc, adSpend, adSales, acos,
        rating, reviewCount, returnRate,
        wow: prevWeek ? {
          salesQty: calcChange(salesQty, prevWeek.salesQty || 0),
          salesAmount: calcChange(salesAmount, pf(prevWeek.salesAmount)),
          orderProfit: calcChange(orderProfit, pf(prevWeek.orderProfit)),
          sessionTotal: calcChange(sessionTotal, prevWeek.sessionsTotal || 0),
          adSpend: calcChange(adSpend, pf(prevWeek.adSpend)),
          acos: calcChange(acos, parsePercentStr(prevWeek.acos)),
        } : null,
      };
    });

    // Compute salesTrend for the latest week
    if (weeksWithComparison.length > 0 && weeksWithComparison[0].wow) {
      const pct = weeksWithComparison[0].wow.salesQty.pct;
      weeksWithComparison[0].salesTrend = pct !== null ? (pct > 5 ? "up" : pct < -5 ? "down" : "flat") : null;
    }

    // Calculate inventory metrics
    const fbaAvailable = latestRow.fbaAvailable || 0;
    const fbaInbound = latestRow.fbaInbound || 0;
    const fbaInTransit = latestRow.fbaInTransit || 0;
    const fbaTotal = latestRow.fbaTotal || 0;
    const availableStock = latestRow.availableStock || 0;
    const fbaDaysOfSupply = latestRow.fbaDaysOfSupply || 0;
    const stockoutDate = latestRow.stockoutDate || null;
    // 7-day average daily sales = latest week salesQty / 7
    const latestWeekSalesQty = latestRow.salesQty || 0;
    const avgDailySales7d = latestWeekSalesQty / 7;
    // Days of stock = fbaAvailable / avgDailySales7d
    const daysOfStock = avgDailySales7d > 0 ? Math.round(fbaAvailable / avgDailySales7d) : (fbaAvailable > 0 ? 999 : 0);

    result.push({
      id: 0, // no productProfiles id
      parentAsin,
      title: latestRow.title || "",
      chineseName: latestRow.productName || null,
      brand: latestRow.brand || null,
      category: latestRow.category1 || null,
      marketplace: latestRow.country || marketplace,
      imageUrl: null as string | null,
      status: "active",
      operator: latestRow.operator || null,
      storeName: latestRow.storeName || null,
      variantCount: 0,
      skus: latestRow.sku ? [latestRow.sku] : [],
      basicInfo: null,
      weeks: weeksWithComparison,
      monthlySummaries: [],
      // Inventory fields
      inventory: {
        fbaAvailable,
        fbaInbound,
        fbaInTransit,
        fbaTotal,
        availableStock,
        fbaDaysOfSupply,
        stockoutDate,
        avgDailySales7d: Math.round(avgDailySales7d * 10) / 10,
        daysOfStock,
      },
    });
  }

  // Sort by latest week salesAmount desc
  result.sort((a, b) => {
    const aVal = a.weeks[0]?.salesAmount || 0;
    const bVal = b.weeks[0]?.salesAmount || 0;
    return bVal - aVal;
  });

  // Apply operator name mappings (replace external names with system user names)
  await applyOperatorMappings(db, userId, result, "lingxing");

  return result;
}

// ═══════════════════════════════════════════════════════
// Helper: Build product overview from Saihu imported data
// Saihu data is at ASIN level, needs aggregation by parent ASIN
// ═══════════════════════════════════════════════════════
async function buildOverviewFromSaihu(db: any, userId: number, weeksToShow: number, marketplace: string) {
  // Get distinct week ranges
  const weekRanges = await db.selectDistinct({
    weekStartDate: saihuProductWeekly.weekStartDate,
    weekEndDate: saihuProductWeekly.weekEndDate,
  })
    .from(saihuProductWeekly)
    .where(eq(saihuProductWeekly.userId, userId))
    .orderBy(desc(saihuProductWeekly.weekStartDate))
    .limit(weeksToShow + 1);

  if (weekRanges.length === 0) return [];

  // Get all data for these weeks
  const allData = await db.select().from(saihuProductWeekly)
    .where(and(
      eq(saihuProductWeekly.userId, userId),
      sql`${saihuProductWeekly.weekStartDate} IN (${sql.join(weekRanges.map((w: any) => sql`${w.weekStartDate}`), sql`,`)})`
    ))
    .orderBy(desc(saihuProductWeekly.weekStartDate));

  // Filter by marketplace (site field)
  const filteredData = marketplace === "ALL" ? allData : allData.filter((r: any) => {
    const s = (r.site || "").toUpperCase();
    return s === marketplace || s.includes(marketplace);
  });

  // Group by parentAsin → weekStartDate → aggregate child ASINs
  const parentAsinMap = new Map<string, Map<string, any[]>>();
  for (const row of filteredData) {
    const pAsin = row.parentAsin || row.asin || "unknown";
    if (!parentAsinMap.has(pAsin)) parentAsinMap.set(pAsin, new Map());
    const weekMap = parentAsinMap.get(pAsin)!;
    if (!weekMap.has(row.weekStartDate)) weekMap.set(row.weekStartDate, []);
    weekMap.get(row.weekStartDate)!.push(row);
  }

  const result: any[] = [];
  for (const [parentAsin, weekMap] of Array.from(parentAsinMap.entries())) {
    // Get latest week's first row for product info
    const sortedWeekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
    const latestRows = weekMap.get(sortedWeekKeys[0])!;
    const infoRow = latestRows[0];

    // Aggregate each week's child ASINs
    const aggregatedWeekMap = new Map<string, any>();
    for (const [weekKey, childRows] of Array.from(weekMap.entries())) {
      aggregatedWeekMap.set(weekKey, aggregateSaihuRows(childRows, weekKey));
    }

    // Build weekly data with WoW comparison
    const weeksWithComparison = sortedWeekKeys.slice(0, weeksToShow).map((weekKey, idx) => {
      const agg = aggregatedWeekMap.get(weekKey)!;
      const prevWeekKey = sortedWeekKeys[idx + 1];
      const prevAgg = prevWeekKey ? aggregatedWeekMap.get(prevWeekKey) : null;

      return {
        id: 0,
        weekStartDate: weekKey,
        weekEndDate: agg.weekEndDate,
        salesTrend: null as string | null,
        salesQty: agg.salesQty,
        orderQty: agg.orderQty,
        salesAmount: agg.salesAmount,
        orderProfit: agg.grossProfit,
        profitMargin: agg.grossMargin,
        sessionTotal: agg.sessionsTotal,
        totalCvr: agg.cvr,
        adCvr: agg.adCvr,
        organicCvr: agg.organicCvr,
        adOrders: agg.adOrders,
        organicOrders: agg.organicOrders,
        adClicks: agg.adClicks,
        ctr: agg.adClickRate,
        adImpressions: agg.adImpressions,
        cpc: agg.cpc,
        adSpend: agg.adSpend,
        adSales: agg.adSalesAmount,
        acos: agg.acos,
        rating: agg.rating,
        reviewCount: agg.ratingCount,
        returnRate: agg.returnRate,
        wow: prevAgg ? {
          salesQty: calcChange(agg.salesQty, prevAgg.salesQty),
          salesAmount: calcChange(agg.salesAmount, prevAgg.salesAmount),
          orderProfit: calcChange(agg.grossProfit, prevAgg.grossProfit),
          sessionTotal: calcChange(agg.sessionsTotal, prevAgg.sessionsTotal),
          adSpend: calcChange(agg.adSpend, prevAgg.adSpend),
          acos: calcChange(agg.acos, prevAgg.acos),
        } : null,
      };
    });

    // Compute salesTrend
    if (weeksWithComparison.length > 0 && weeksWithComparison[0].wow) {
      const pct = weeksWithComparison[0].wow.salesQty.pct;
      weeksWithComparison[0].salesTrend = pct !== null ? (pct > 5 ? "up" : pct < -5 ? "down" : "flat") : null;
    }

    result.push({
      id: 0,
      parentAsin,
      title: infoRow.title || "",
      chineseName: infoRow.productName || null,
      brand: infoRow.brand || null,
      category: infoRow.category || null,
      marketplace: infoRow.site || marketplace,
      imageUrl: infoRow.imageUrl || null,
      status: "active",
      operator: infoRow.operator || null,
      storeName: infoRow.storeName || null,
      variantCount: latestRows.length,
      skus: latestRows.map((r: any) => r.sku).filter(Boolean),
      basicInfo: null,
      weeks: weeksWithComparison,
      monthlySummaries: [],
    });
  }

  result.sort((a, b) => {
    const aVal = a.weeks[0]?.salesAmount || 0;
    const bVal = b.weeks[0]?.salesAmount || 0;
    return bVal - aVal;
  });

  // Apply operator name mappings (replace external names with system user names)
  await applyOperatorMappings(db, userId, result, "saihu");

  return result;
}

// ─── Aggregate Saihu child ASIN rows into parent ASIN level ───
function aggregateSaihuRows(rows: any[], weekKey: string) {
  // Sum integer/currency fields, weighted-average rate fields
  let salesQty = 0, orderQty = 0, salesAmount = 0, grossProfit = 0;
  let sessionsTotal = 0, adOrders = 0, organicOrders = 0;
  let adClicks = 0, adImpressions = 0, adSpend = 0, adSalesAmount = 0;
  let ratingCount = 0, refundQty = 0, returnQty = 0;
  let organicClicks = 0;
  let ratingSum = 0, ratingWeightSum = 0;
  let weekEndDate = "";

  for (const r of rows) {
    salesQty += r.salesQty || 0;
    orderQty += r.orderQty || 0;
    salesAmount += pf(r.salesAmount);
    grossProfit += pf(r.grossProfit);
    sessionsTotal += r.sessionsTotal || 0;
    adOrders += r.adOrders || 0;
    organicOrders += r.organicOrders || 0;
    adClicks += r.adClicks || 0;
    adImpressions += r.adImpressions || 0;
    adSpend += pf(r.adSpend);
    adSalesAmount += pf(r.adSalesAmount);
    ratingCount += r.ratingCount || 0;
    refundQty += r.refundQty || 0;
    returnQty += r.returnQty || 0;
    organicClicks += r.organicClicks || 0;
    // Weighted rating by ratingCount
    const rc = r.ratingCount || 0;
    const rt = pf(r.rating);
    if (rc > 0 && rt > 0) { ratingSum += rt * rc; ratingWeightSum += rc; }
    if (r.weekEndDate) weekEndDate = r.weekEndDate;
  }

  // Derived rates
  const grossMargin = salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0;
  const cvr = sessionsTotal > 0 ? (orderQty / sessionsTotal) * 100 : 0;
  const adCvr = adClicks > 0 ? (adOrders / adClicks) * 100 : 0;
  const organicCvr = organicClicks > 0 ? (organicOrders / organicClicks) * 100 : 0;
  const adClickRate = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
  const cpc = adClicks > 0 ? adSpend / adClicks : 0;
  const acos = adSalesAmount > 0 ? (adSpend / adSalesAmount) * 100 : 0;
  const rating = ratingWeightSum > 0 ? ratingSum / ratingWeightSum : 0;
  const returnRate = salesQty > 0 ? (returnQty / salesQty) * 100 : 0;

  return {
    weekEndDate,
    salesQty, orderQty, salesAmount, grossProfit, grossMargin,
    sessionsTotal, cvr, adCvr, organicCvr,
    adOrders, organicOrders,
    adClicks, adClickRate, adImpressions, cpc, adSpend, adSalesAmount, acos,
    rating: Math.round(rating * 10) / 10,
    ratingCount, returnRate,
  };
}

// ─── Shared utility functions ───
function pf(val: any): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

/** Parse percent string like "25.5" or "25.5%" → 25.5 */
function parsePercentStr(val: any): number {
  if (val == null || val === "") return 0;
  const s = String(val).replace(/%/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function calcChange(current: number, previous: number): { value: number; pct: number | null } {
  if (previous === 0) return { value: current, pct: null };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return { value: current, pct: Math.round(pct * 100) / 100 };
}

// ═══════════════════════════════════════════════════════
// Helper: Build product detail from Lingxing imported data
// Returns product header info + ALL weekly data for a single parentAsin
// ═══════════════════════════════════════════════════════
async function buildProductDetailFromLingxing(db: any, userId: number, parentAsin: string, marketplace: string) {
  // Get all data for this parentAsin
  const allData = await db.select().from(lingxingProductWeekly)
    .where(and(
      eq(lingxingProductWeekly.userId, userId),
      eq(lingxingProductWeekly.parentAsin, parentAsin),
    ))
    .orderBy(desc(lingxingProductWeekly.weekStartDate));

  // Filter by marketplace if specified
  const filteredData = marketplace === "ALL" ? allData : allData.filter((r: any) => {
    const c = (r.country || "").toUpperCase();
    return c === marketplace || c.includes(marketplace);
  });

  if (filteredData.length === 0) return null;

  // Get the latest row for product info
  const latestRow = filteredData[0];

  // Group rows by week
  const weekMap = new Map<string, any>();
  for (const row of filteredData) {
    const weekKey = row.weekStartDate;
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, row);
  }

  // Build weekly data with WoW comparison (ALL weeks, not limited)
  const sortedWeekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
  const weeks = sortedWeekKeys.map((weekKey, idx) => {
    const week = weekMap.get(weekKey)!;
    const prevWeekKey = sortedWeekKeys[idx + 1];
    const prevWeek = prevWeekKey ? weekMap.get(prevWeekKey) : null;

    const salesQty = week.salesQty || 0;
    const orderQty = week.orderQty || 0;
    const salesAmount = pf(week.salesAmount);
    const orderProfit = pf(week.orderProfit);
    const profitMargin = parsePercentStr(week.orderProfitMargin);
    const sessionTotal = week.sessionsTotal || 0;
    const totalCvr = parsePercentStr(week.cvr);
    const adCvr = parsePercentStr(week.adCvr);
    const organicCvr = parsePercentStr(week.organicCvr);
    const adOrders = week.adOrders || 0;
    const organicOrders = week.organicOrders || 0;
    const adClicks = week.adClicks || 0;
    const ctr = parsePercentStr(week.ctr);
    const adImpressions = week.adImpressions || 0;
    const cpc = pf(week.cpc);
    const adSpend = pf(week.adSpend);
    const adSales = pf(week.adSales);
    const acos = parsePercentStr(week.acos);
    const rating = pf(week.rating);
    const reviewCount = week.reviewCount || 0;
    const returnRate = parsePercentStr(week.returnRate);

    return {
      id: week.id,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      salesTrend: null as string | null,
      salesQty, orderQty, salesAmount, orderProfit, profitMargin,
      sessionTotal, totalCvr, adCvr, organicCvr,
      adOrders, organicOrders,
      adClicks, ctr, adImpressions, cpc, adSpend, adSales, acos,
      rating, reviewCount, returnRate,
      wow: prevWeek ? {
        salesQty: calcChange(salesQty, prevWeek.salesQty || 0),
        salesAmount: calcChange(salesAmount, pf(prevWeek.salesAmount)),
        orderProfit: calcChange(orderProfit, pf(prevWeek.orderProfit)),
        sessionTotal: calcChange(sessionTotal, prevWeek.sessionsTotal || 0),
        adSpend: calcChange(adSpend, pf(prevWeek.adSpend)),
        acos: calcChange(acos, parsePercentStr(prevWeek.acos)),
      } : null,
    };
  });

  // Compute salesTrend for the latest week
  if (weeks.length > 0 && weeks[0].wow) {
    const pct = weeks[0].wow.salesQty.pct;
    weeks[0].salesTrend = pct !== null ? (pct > 5 ? "up" : pct < -5 ? "down" : "flat") : null;
  }

  // Extract child ASINs from the asin field (Lingxing may have comma-separated child ASINs)
  const childAsins = (latestRow.asin || "").split(",").map((a: string) => a.trim()).filter(Boolean);
  const variants = childAsins.map((asin: string) => ({
    id: 0,
    childAsin: asin,
    sku: latestRow.sku || null,
    title: null,
    price: latestRow.price || null,
    status: "active",
  }));

  // Apply operator name mapping to product
  const productObj = {
    id: 0,
    parentAsin,
    title: latestRow.title || "",
    chineseName: latestRow.productName || null,
    brand: latestRow.brand || null,
    category: latestRow.category1 || null,
    marketplace: latestRow.country || marketplace,
    imageUrl: null as string | null,
    status: "active",
    operator: latestRow.operator || null,
    storeName: latestRow.storeName || null,
    variants,
  };
  await applyOperatorMappings(db, userId, [productObj], "lingxing");

  return {
    product: productObj,
    weeks,
    // Extra detail fields from Lingxing
    extraInfo: {
      sku: latestRow.sku || null,
      msku: latestRow.msku || null,
      bsrMain: latestRow.bsrMain || null,
      bsrSub: latestRow.bsrSub || null,
      fbaAvailable: latestRow.fbaAvailable || 0,
      fbaTotal: latestRow.fbaTotal || 0,
      fbaInTransit: latestRow.fbaInTransit || 0,
      fbaDaysOfSupply: latestRow.fbaDaysOfSupply || 0,
      availableStock: latestRow.availableStock || 0,
      category2: latestRow.category2 || null,
      category3: latestRow.category3 || null,
    },
  };
}

// ═══════════════════════════════════════════════════════
// Helper: Build product detail from Saihu imported data
// Saihu data is at ASIN level, needs aggregation by parent ASIN
// ═══════════════════════════════════════════════════════
async function buildProductDetailFromSaihu(db: any, userId: number, parentAsin: string, marketplace: string) {
  // Get all data for this parentAsin
  const allData = await db.select().from(saihuProductWeekly)
    .where(and(
      eq(saihuProductWeekly.userId, userId),
      eq(saihuProductWeekly.parentAsin, parentAsin),
    ))
    .orderBy(desc(saihuProductWeekly.weekStartDate));

  // Filter by marketplace
  const filteredData = marketplace === "ALL" ? allData : allData.filter((r: any) => {
    const s = (r.site || "").toUpperCase();
    return s === marketplace || s.includes(marketplace);
  });

  if (filteredData.length === 0) return null;

  // Group by weekStartDate → aggregate child ASINs
  const weekMap = new Map<string, any[]>();
  for (const row of filteredData) {
    if (!weekMap.has(row.weekStartDate)) weekMap.set(row.weekStartDate, []);
    weekMap.get(row.weekStartDate)!.push(row);
  }

  // Get latest week's first row for product info
  const sortedWeekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
  const latestRows = weekMap.get(sortedWeekKeys[0])!;
  const infoRow = latestRows[0];

  // Aggregate each week's child ASINs
  const aggregatedWeekMap = new Map<string, any>();
  for (const [weekKey, childRows] of Array.from(weekMap.entries())) {
    aggregatedWeekMap.set(weekKey, aggregateSaihuRows(childRows, weekKey));
  }

  // Build weekly data with WoW comparison (ALL weeks)
  const weeks = sortedWeekKeys.map((weekKey, idx) => {
    const agg = aggregatedWeekMap.get(weekKey)!;
    const prevWeekKey = sortedWeekKeys[idx + 1];
    const prevAgg = prevWeekKey ? aggregatedWeekMap.get(prevWeekKey) : null;

    return {
      id: 0,
      weekStartDate: weekKey,
      weekEndDate: agg.weekEndDate,
      salesTrend: null as string | null,
      salesQty: agg.salesQty,
      orderQty: agg.orderQty,
      salesAmount: agg.salesAmount,
      orderProfit: agg.grossProfit,
      profitMargin: agg.grossMargin,
      sessionTotal: agg.sessionsTotal,
      totalCvr: agg.cvr,
      adCvr: agg.adCvr,
      organicCvr: agg.organicCvr,
      adOrders: agg.adOrders,
      organicOrders: agg.organicOrders,
      adClicks: agg.adClicks,
      ctr: agg.adClickRate,
      adImpressions: agg.adImpressions,
      cpc: agg.cpc,
      adSpend: agg.adSpend,
      adSales: agg.adSalesAmount,
      acos: agg.acos,
      rating: agg.rating,
      reviewCount: agg.ratingCount,
      returnRate: agg.returnRate,
      wow: prevAgg ? {
        salesQty: calcChange(agg.salesQty, prevAgg.salesQty),
        salesAmount: calcChange(agg.salesAmount, prevAgg.salesAmount),
        orderProfit: calcChange(agg.grossProfit, prevAgg.grossProfit),
        sessionTotal: calcChange(agg.sessionsTotal, prevAgg.sessionsTotal),
        adSpend: calcChange(agg.adSpend, prevAgg.adSpend),
        acos: calcChange(agg.acos, prevAgg.acos),
      } : null,
    };
  });

  // Compute salesTrend
  if (weeks.length > 0 && weeks[0].wow) {
    const pct = weeks[0].wow.salesQty.pct;
    weeks[0].salesTrend = pct !== null ? (pct > 5 ? "up" : pct < -5 ? "down" : "flat") : null;
  }

  // Build variants from latest week's child ASINs
  const variants = latestRows.map((r: any) => ({
    id: 0,
    childAsin: r.asin || "",
    sku: r.sku || null,
    title: r.title || null,
    price: r.avgPrice ? String(r.avgPrice) : null,
    status: "active",
  }));

  // Apply operator name mapping to product
  const productObj = {
    id: 0,
    parentAsin,
    title: infoRow.title || "",
    chineseName: infoRow.productName || null,
    brand: infoRow.brand || null,
    category: infoRow.category || null,
    marketplace: infoRow.site || marketplace,
    imageUrl: infoRow.imageUrl || null,
    status: "active",
    operator: infoRow.operator || null,
    storeName: infoRow.storeName || null,
    variants,
  };
  await applyOperatorMappings(db, userId, [productObj], "saihu");

  return {
    product: productObj,
    weeks,
    // Extra detail fields from Saihu
    extraInfo: {
      sku: infoRow.sku || null,
      msku: infoRow.msku || null,
      bsrMain: infoRow.bsrMain || null,
      bsrSub: infoRow.bsrSub || null,
      fbaAvailable: infoRow.fbaAvailable || 0,
      fbaInTransit: infoRow.fbaInTransit || 0,
      fbaDaysOfSupply: pf(infoRow.fbaDaysOfSupply),
      listingDate: infoRow.listingDate || null,
      developer: infoRow.developer || null,
    },
  };
}
