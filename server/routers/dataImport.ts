import { currentOpsWorkspaceId } from "../domains/ops/workspaceContext";
import { opsWorkspaceCondition } from "../repositories/ops";
/**
 * Data Import Center Router
 * Handles Excel file upload, parsing, preview, and import for
 * Lingxing (领星) and Saihu (赛狐) product data
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { getDb } from "../repositories/dbClient";
import { dataImports, lingxingProductWeekly, opsAsinDailySnapshots, opsAsinLifecycleStatuses, opsInventoryPlanningParameters, opsLocalInventoryAdjustments, opsMonthlyFinancialProfits, saihuProductWeekly, operatorNameMappings, users, productionConfig, productProfiles } from "../../drizzle/schema";
import { MANAGER_ROLES } from "../../shared/const";
import { eq, desc, and, sql, or, isNull, ne } from "drizzle-orm";
import { parseExcelBuffer, parseDateRangeFromFilename, detectSourceType, type SourceType, type DateRange } from "../excelParser";
import { storagePut } from "../storage";
import { safeHttpRequest } from "../infrastructure/http/safeHttpClient";
import { summarizeParentAsinWeeks, summarizeVariantSales } from "../domains/ops/productOverview/dailyAggregation";
import { calculateInventoryPlan } from "../domains/ops/inventoryPlanning/calculator";
import { evaluateThreeMonthZeroDiscontinuation, evaluateThreeMonthZeroWeeklyDiscontinuation } from "../domains/ops/lifecycle/zeroValueDiscontinuation";
import { mergeErpProducts } from "@shared/erpProductMerge";

function matchesLingxingMarketplace(row: { country?: string | null; storeName?: string | null }, marketplace: string) {
  if (marketplace === "ALL") return true;
  const requested = marketplace.toUpperCase();
  const country = (row.country || "").toUpperCase();
  const storeName = (row.storeName || "").toUpperCase();
  const countryAliases: Record<string, string[]> = { US: ["US", "美国"], CA: ["CA", "加拿大"], UK: ["UK", "英国"], DE: ["DE", "德国"], FR: ["FR", "法国"], IT: ["IT", "意大利"], ES: ["ES", "西班牙"], JP: ["JP", "日本"] };
  return [requested, ...(countryAliases[requested] || [])].some(alias => country.includes(alias) || storeName.includes(`-${alias}`));
}

async function refreshZeroValueDiscontinuationStatuses(db: any, workspaceId: number) {
  const snapshots = (await db.select().from(opsAsinDailySnapshots)
    .where(eq(opsAsinDailySnapshots.workspaceId, workspaceId)))
    .filter((snapshot) => snapshot.sourceType !== "lx_inventory_mcp");
  const legacyWeekly = await db.select().from(lingxingProductWeekly).where(or(
    isNull(lingxingProductWeekly.workspaceId), eq(lingxingProductWeekly.workspaceId, workspaceId),
  ));
  const weeklyByKey = new Map<string, any[]>();
  for (const row of legacyWeekly) {
    const key = `${row.asin}::${row.storeName}::${row.country}`;
    weeklyByKey.set(key, [...(weeklyByKey.get(key) || []), row]);
  }
  const grouped = new Map<string, any[]>();
  for (const row of snapshots) {
    const key = `${row.asin}::${row.storeName}::${row.country}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  for (const rows of grouped.values()) {
    const latest = [...rows].sort((a, b) => a.reportDate.localeCompare(b.reportDate)).at(-1)!;
    const dailyDecision = evaluateThreeMonthZeroDiscontinuation(rows.map(row => ({
      reportDate: row.reportDate, salesQty: row.salesQty || 0, orderProfit: Number(row.orderProfit || 0),
      totalInventory: (row.fbaAvailable || row.availableStock || 0) + (row.fbaInTransit || 0),
    })));
    const weeklyDecision = evaluateThreeMonthZeroWeeklyDiscontinuation((weeklyByKey.get(`${latest.asin}::${latest.storeName}::${latest.country}`) || []).map(row => ({
      weekStartDate: row.weekStartDate, weekEndDate: row.weekEndDate, salesQty: row.salesQty || 0,
      orderProfit: Number(row.orderProfit || 0), totalInventory: (row.fbaAvailable || 0) + (row.fbaInTransit || 0),
    })));
    const [existing] = await db.select().from(opsAsinLifecycleStatuses).where(and(
      eq(opsAsinLifecycleStatuses.workspaceId, workspaceId), eq(opsAsinLifecycleStatuses.asin, latest.asin),
      eq(opsAsinLifecycleStatuses.storeName, latest.storeName), eq(opsAsinLifecycleStatuses.country, latest.country),
    )).limit(1);
    const decision = dailyDecision.shouldDiscontinue ? dailyDecision : weeklyDecision;
    if (!decision.shouldDiscontinue) continue;
    // 人工恢复为在售是明确的经营决策；后续同一批零值证据不应立即覆盖该决策。
    if (existing?.status === "active" && existing.restoredAt) continue;
    const evidence = { status: "discontinued" as const, reason: "three_months_zero", parentAsin: latest.parentAsin,
      evidenceStartDate: decision.evidenceStartDate, evidenceEndDate: decision.evidenceEndDate, evidenceDays: decision.evidenceDays,
      evidenceSalesQty: decision.salesQty, evidenceProfit: String(decision.profit), evidenceMaxInventory: decision.maxInventory,
      changedBy: null, changedAt: new Date(), restoredAt: null, restoreReason: null };
    if (existing) await db.update(opsAsinLifecycleStatuses).set(evidence).where(and(
      eq(opsAsinLifecycleStatuses.id, existing.id),
      eq(opsAsinLifecycleStatuses.workspaceId, workspaceId),
    ));
    else await db.insert(opsAsinLifecycleStatuses).values({ workspaceId, userId: latest.userId, asin: latest.asin, storeName: latest.storeName, country: latest.country, ...evidence });
  }
}

/**
 * Helper: Resolve the effective userId for data queries.
 * Non-admin/manager users need to query data imported by admins, not their own userId.
 * Returns the userId that should be used for querying imported data tables.
 */
export async function resolveDataUserId(
  db: any,
  currentUser: { id: number; role: string; name: string | null; defaultWorkspaceId?: number | null },
): Promise<number> {
  const workspaceId = currentUser.defaultWorkspaceId;
  if (!workspaceId) return currentUser.id;
  const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(currentUser.role);
  if (isManagerOrAbove) {
    return currentUser.id;
  }
  // For non-admin users, find the admin/super_admin who has imported data
  // First check if the current user has their own imported data
  const [ownData] = await db.select({ count: sql<number>`count(*)` })
    .from(dataImports)
    .where(and(eq(dataImports.userId, currentUser.id), eq(dataImports.workspaceId, workspaceId)));
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
      eq(users.status, "active"),
      eq(users.defaultWorkspaceId, workspaceId)
    ));
  // Find the admin with the most recent import
  for (const admin of adminUsers) {
    const [adminData] = await db.select({ count: sql<number>`count(*)` })
      .from(dataImports)
      .where(and(eq(dataImports.userId, admin.id), eq(dataImports.workspaceId, workspaceId)));
    if (adminData?.count > 0) {
      return admin.id;
    }
  }
  // Fallback: return current user's id (will show empty data)
  return currentUser.id;
}

/**
 * Split operator field into individual names.
 * Supports separators: / 、 , ，  (slash, Chinese enumeration comma, comma, Chinese comma, space)
 */
function splitOperatorNames(operator: string | null): string[] {
  if (!operator) return [];
  return operator.split(/[\/、,，]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Helper: Filter products by operator permission for non-admin users.
 * After operator name mapping is applied, filter to only show products
 * where the operator matches the current user's name.
 * Supports multi-operator fields (e.g. "张三/李四").
 */
function filterByOperatorPermission(
  items: { operator: string | null }[],
  currentUser: { role: string; name: string | null }
): typeof items {
  const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(currentUser.role);
  if (isManagerOrAbove || !currentUser.name) {
    return items;
  }
  // Non-admin users only see products assigned to them (any of the operators matches)
  return items.filter(item => {
    if (!item.operator) return false;
    const names = splitOperatorNames(item.operator);
    return names.includes(currentUser.name!);
  });
}

/**
 * Helper: Apply operator name mappings to replace external names with system user names
 * Queries the operator_name_mappings table and replaces operator fields in-place
 */
async function applyOperatorMappings(
  db: any,
  items: { operator: string | null }[],
  sourceType: "lingxing" | "saihu"
): Promise<void> {
  // Collect all unique individual operator names (split multi-name fields)
  const allRawNames = items.flatMap(i => splitOperatorNames(i.operator));
  const uniqueNames = [...new Set(allRawNames)];
  if (uniqueNames.length === 0) return;

  // Operator mappings are shared by the current workspace.
  const allMappings = await db.select().from(operatorNameMappings)
    .where(opsWorkspaceCondition(
      operatorNameMappings,
      currentOpsWorkspaceId(),
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

  // Replace operator names in-place, handling multi-name fields
  for (const item of items) {
    if (!item.operator) continue;
    const parts = splitOperatorNames(item.operator);
    const mapped = parts.map(p => mappingLookup.get(p) ?? p);
    item.operator = mapped.join("/");
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
        dataGranularity: result.dataGranularity,
        totalRows: result.totalRows,
        status: "previewing",
      });

      // Extract all unique individual operator names from the full dataset (split multi-name fields)
      const allOperatorNames = [...new Set(
        result.allRows
          .flatMap((r: Record<string, any>) => splitOperatorNames(r.operator || null))
          .filter(Boolean)
      )];

      return {
        importId: importRecord.insertId,
          sourceType: result.sourceType,
          dataGranularity: result.dataGranularity,
        dateRange: result.dateRange,
        totalRows: result.totalRows,
        previewRows: result.previewRows,
        unmappedColumns: result.unmappedColumns,
        mappedColumnCount: result.headers.length - result.unmappedColumns.length,
        allOperatorNames,
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
        .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(eq(dataImports.id, input.importId), eq(dataImports.userId, ctx.user.id))));

      if (!importRecord) throw new Error("导入记录不存在");
      if (importRecord.status === "completed") throw new Error("该文件已导入完成");

      // Update status to importing
      await db!.update(dataImports)
        .set({ status: "importing" })
        .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, input.importId)));

      try {
        // Re-parse the file from S3
        const fileUrl = importRecord.fileUrl;
        if (!fileUrl) throw new Error("文件URL不存在");

        const response = await safeHttpRequest(fileUrl, {
          timeoutMs: 30_000,
          maxRedirects: 3,
          maxResponseBytes: 50 * 1024 * 1024,
          auditContext: {
            workspaceId: currentOpsWorkspaceId(),
            operation: "ops.data_import.download",
          },
        });
        if (!response.ok) throw new Error(`文件下载失败: HTTP ${response.status}`);
        const buffer = response.body;
        const result = parseExcelBuffer(buffer, importRecord.fileName);

        // A repeated daily file replaces the active snapshot batch for the same source period,
        // while the old import record and original file remain auditable.
        if (result.sourceType === "lingxing" && result.dataGranularity === "daily") {
          const [replacedImport] = await db!.select({ id: dataImports.id }).from(dataImports)
            .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(
              eq(dataImports.userId, ctx.user.id),
              eq(dataImports.sourceType, "lingxing"),
              eq(dataImports.dataGranularity, "daily"),
              eq(dataImports.weekStartDate, result.dateRange.startDate),
              eq(dataImports.weekEndDate, result.dateRange.endDate),
              eq(dataImports.status, "completed"),
              ne(dataImports.id, input.importId),
            )))
            .orderBy(desc(dataImports.createdAt))
            .limit(1);
          if (replacedImport) {
            await db!.delete(opsAsinDailySnapshots).where(opsWorkspaceCondition(
              opsAsinDailySnapshots,
              currentOpsWorkspaceId(),
              eq(opsAsinDailySnapshots.importId, replacedImport.id),
            ));
            await db!.update(dataImports).set({ supersededAt: new Date() })
              .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, replacedImport.id)));
            await db!.update(dataImports).set({ replacesImportId: replacedImport.id })
              .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, input.importId)));
          }
        } else if (result.sourceType === "lingxing") {
          await db!.delete(lingxingProductWeekly).where(
            opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), and(
              eq(lingxingProductWeekly.userId, ctx.user.id),
              eq(lingxingProductWeekly.weekStartDate, result.dateRange.startDate),
              eq(lingxingProductWeekly.weekEndDate, result.dateRange.endDate),
            ))
          );
        } else {
          await db!.delete(saihuProductWeekly).where(
            opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), and(
              eq(saihuProductWeekly.userId, ctx.user.id),
              eq(saihuProductWeekly.weekStartDate, result.dateRange.startDate),
              eq(saihuProductWeekly.weekEndDate, result.dateRange.endDate),
            ))
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
            if (result.sourceType === "lingxing" && result.dataGranularity === "daily") {
              const dailyRows = batch
                .map(row => mapLingxingDailyRow(row, input.importId, ctx.user.id))
                .filter((row): row is NonNullable<typeof row> => row !== null);
              if (dailyRows.length > 0) {
                await db!.insert(opsAsinDailySnapshots).values(dailyRows as any);
                importedRows += dailyRows.length;
              }
              skippedRows += batch.length - dailyRows.length;
            } else if (result.sourceType === "lingxing") {
              await db!.insert(lingxingProductWeekly).values(dbRows as any);
              importedRows += batch.length;
            } else {
              await db!.insert(saihuProductWeekly).values(dbRows as any);
              importedRows += batch.length;
            }
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
          .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, input.importId)));

        if (result.sourceType === "lingxing" && result.dataGranularity === "daily") {
          await refreshZeroValueDiscontinuationStatuses(db!, currentOpsWorkspaceId());
        }

        return {
          success: true,
          importedRows,
          skippedRows,
          totalRows: result.totalRows,
        };
      } catch (err: any) {
        await db!.update(dataImports)
          .set({ status: "failed", errorMessage: err.message })
          .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, input.importId)));
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
          .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(...conditions)))
          .orderBy(desc(dataImports.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db!.select({ count: sql<number>`count(*)` }).from(dataImports)
          .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(...conditions))),
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
        .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(eq(dataImports.id, input.importId), eq(dataImports.userId, ctx.user.id))));

      if (!record) throw new Error("记录不存在");

      // Delete associated data
      if (record.sourceType === "lingxing") {
        await db!.delete(lingxingProductWeekly).where(opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), eq(lingxingProductWeekly.importId, input.importId)));
      } else {
        await db!.delete(saihuProductWeekly).where(opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), eq(saihuProductWeekly.importId, input.importId)));
      }

      // Delete import record
      await db!.delete(dataImports).where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), eq(dataImports.id, input.importId)));

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
          .where(or(
            isNull(lingxingProductWeekly.workspaceId),
            opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(
              eq(lingxingProductWeekly.userId, effectiveUserId),
              isNull(lingxingProductWeekly.userId)
            ))
          ))
          .orderBy(desc(lingxingProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        // Get all data for these weeks
        const data = await db!.select().from(lingxingProductWeekly)
          .where(and(
            or(
              isNull(lingxingProductWeekly.workspaceId),
              opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(
                eq(lingxingProductWeekly.userId, effectiveUserId),
                isNull(lingxingProductWeekly.userId)
              ))
            ),
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
          .where(or(
            isNull(saihuProductWeekly.workspaceId),
            opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(
              eq(saihuProductWeekly.userId, effectiveUserId),
              isNull(saihuProductWeekly.userId)
            ))
          ))
          .orderBy(desc(saihuProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        const data = await db!.select().from(saihuProductWeekly)
          .where(and(
            or(
              isNull(saihuProductWeekly.workspaceId),
              opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(
                eq(saihuProductWeekly.userId, effectiveUserId),
                isNull(saihuProductWeekly.userId)
              ))
            ),
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
        .where(or(isNull(table.userId), eq(table.userId, effectiveUserId)))
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
        .where(or(isNull(lingxingProductWeekly.workspaceId), opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(eq(lingxingProductWeekly.userId, effectiveUserId), isNull(lingxingProductWeekly.userId)))));

      const [saihuCount] = await db!.select({ count: sql<number>`count(DISTINCT week_start_date)` })
        .from(saihuProductWeekly)
        .where(or(isNull(saihuProductWeekly.workspaceId), opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(eq(saihuProductWeekly.userId, effectiveUserId), isNull(saihuProductWeekly.userId)))));

      const [lingxingProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(lingxingProductWeekly)
        .where(or(isNull(lingxingProductWeekly.workspaceId), opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(eq(lingxingProductWeekly.userId, effectiveUserId), isNull(lingxingProductWeekly.userId)))));

      const [saihuProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(saihuProductWeekly)
        .where(or(isNull(saihuProductWeekly.workspaceId), opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(eq(saihuProductWeekly.userId, effectiveUserId), isNull(saihuProductWeekly.userId)))));

      const [latestImport] = await db!.select().from(dataImports)
        .where(opsWorkspaceCondition(dataImports, currentOpsWorkspaceId(), and(eq(dataImports.userId, effectiveUserId), eq(dataImports.status, "completed"))))
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
      sourceType: z.enum(["erp", "lingxing", "saihu"]),
      weeks: z.number().default(4),
      marketplace: z.string().default("US"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const weeksToShow = input.weeks;
      // Resolve effective userId (non-admin users use admin's data)
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      let result: any[];
      if (input.sourceType === "erp") {
        const [lingxingProducts, saihuProducts] = await Promise.all([
          buildOverviewFromLingxing(db!, effectiveUserId, weeksToShow, input.marketplace),
          buildOverviewFromSaihu(db!, effectiveUserId, weeksToShow, input.marketplace),
        ]);
        // 日粒度领星数据和赛狐周度数据统一呈现；同店铺、同站点的同父 ASIN
        // 优先保留领星记录，避免双 ERP 导入时重复累计。
        result = mergeErpProducts([
          { source: "lingxing", products: lingxingProducts },
          { source: "saihu", products: saihuProducts },
        ]);
      } else if (input.sourceType === "lingxing") {
        result = await buildOverviewFromLingxing(db!, effectiveUserId, weeksToShow, input.marketplace);
      } else {
        result = await buildOverviewFromSaihu(db!, effectiveUserId, weeksToShow, input.marketplace);
      }
      // Apply operator-based permission filtering for non-admin users
      return filterByOperatorPermission(result, ctx.user) as typeof result;
    }),

  getLingxingDailyOverview: protectedProcedure
    .input(z.object({ weeks: z.number().min(1).max(4).default(4), marketplace: z.string().default("ALL") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const rows = await db!.select().from(opsAsinDailySnapshots)
        .where(opsWorkspaceCondition(opsAsinDailySnapshots, currentOpsWorkspaceId(), eq(opsAsinDailySnapshots.userId, effectiveUserId)));
      const filtered = rows.filter(row => row.sourceType !== "lx_inventory_mcp" && matchesLingxingMarketplace(row, input.marketplace));
      const overview = summarizeParentAsinWeeks(filtered as any, input.weeks);
      const profileOperatorRows = await db!.select({
        parentAsin: productProfiles.parentAsin,
        storeName: productProfiles.storeName,
        operator: productProfiles.operator,
      }).from(productProfiles).where(or(
        isNull(productProfiles.workspaceId),
        opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), eq(productProfiles.userId, effectiveUserId))
      ));
      const operatorRows = await db!.select({
        parentAsin: lingxingProductWeekly.parentAsin,
        storeName: lingxingProductWeekly.storeName,
        country: lingxingProductWeekly.country,
        operator: lingxingProductWeekly.operator,
      }).from(lingxingProductWeekly).where(opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), eq(lingxingProductWeekly.userId, effectiveUserId)));
      const operatorByProfileKey = new Map<string, string>();
      for (const row of profileOperatorRows) {
        if (!row.operator) continue;
        const key = [row.parentAsin, row.storeName || ""].join("|");
        if (!operatorByProfileKey.has(key)) operatorByProfileKey.set(key, row.operator);
      }
      const operatorByParentKey = new Map<string, string>();
      for (const row of operatorRows) {
        if (!row.operator) continue;
        const key = [row.parentAsin, row.storeName, row.country].join("|");
        if (!operatorByParentKey.has(key)) operatorByParentKey.set(key, row.operator);
      }
      for (const item of overview as Array<{ parentAsin: string; storeName: string; country: string; operator?: string | null }>) {
        item.operator = item.operator
          || operatorByProfileKey.get([item.parentAsin, item.storeName || ""].join("|"))
          || operatorByParentKey.get([item.parentAsin, item.storeName, item.country].join("|"))
          || null;
      }
      await applyOperatorMappings(db, overview as any, "lingxing");
      return filterByOperatorPermission(overview as any, ctx.user);
    }),

  getLingxingDailyVariants: protectedProcedure
    .input(z.object({ parentAsin: z.string(), weeks: z.number().min(1).max(4).default(4), marketplace: z.string().default("ALL") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const rows = await db!.select().from(opsAsinDailySnapshots)
        .where(opsWorkspaceCondition(opsAsinDailySnapshots, currentOpsWorkspaceId(), and(
          eq(opsAsinDailySnapshots.userId, effectiveUserId),
          eq(opsAsinDailySnapshots.parentAsin, input.parentAsin),
        )));
      const filtered = rows.filter(row => row.sourceType !== "lx_inventory_mcp" && matchesLingxingMarketplace(row, input.marketplace));
      return summarizeVariantSales(filtered as any, input.weeks);
    }),

  getMonthlyFinancialProfits: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
      return db!.select().from(opsMonthlyFinancialProfits).where(and(eq(opsMonthlyFinancialProfits.workspaceId, workspaceId), eq(opsMonthlyFinancialProfits.userId, ctx.user.id))).orderBy(desc(opsMonthlyFinancialProfits.yearMonth));
    }),

  saveMonthlyFinancialProfits: protectedProcedure
    .input(z.object({ parentAsin: z.string().min(1), entries: z.array(z.object({ yearMonth: z.string().regex(/^\d{4}-\d{2}$/), financialProfit: z.number() })).min(1).max(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
      for (const entry of input.entries) {
        const [existing] = await db!.select().from(opsMonthlyFinancialProfits).where(and(eq(opsMonthlyFinancialProfits.workspaceId, workspaceId), eq(opsMonthlyFinancialProfits.userId, ctx.user.id), eq(opsMonthlyFinancialProfits.parentAsin, input.parentAsin), eq(opsMonthlyFinancialProfits.yearMonth, entry.yearMonth))).limit(1);
        if (existing) await db!.update(opsMonthlyFinancialProfits).set({ financialProfit: String(entry.financialProfit) }).where(and(
          eq(opsMonthlyFinancialProfits.id, existing.id),
          eq(opsMonthlyFinancialProfits.workspaceId, workspaceId),
        ));
        else await db!.insert(opsMonthlyFinancialProfits).values({ workspaceId, userId: ctx.user.id, parentAsin: input.parentAsin, yearMonth: entry.yearMonth, financialProfit: String(entry.financialProfit) });
      }
      return { status: "saved" as const, count: input.entries.length };
    }),

  // ─── Inventory Planning from Daily ASIN Snapshots ───
  getInventoryPlanningFromImport: protectedProcedure
    .input(z.object({ asOfDate: z.string().optional(), marketplace: z.string().default("ALL") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
      if (!workspaceId) return { asOfDate: null, rows: [] };
      // 产品总览上传的数据是同一工作空间共享的业务事实，不应因登录用户或导入人不同而分裂。
      // 规划始终使用工作空间内全部领星日快照，再以最新报告日期建立同一数据基准日。
      const snapshots = await db!.select().from(opsAsinDailySnapshots)
        .where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
      const scopedSnapshots = snapshots.filter(row => matchesLingxingMarketplace(row, input.marketplace));
      const inventorySnapshots = scopedSnapshots.filter(row => row.sourceType === "lx_inventory_mcp");
      const inventoryPlanningSource = inventorySnapshots.length ? inventorySnapshots : scopedSnapshots;
      const asOfDate = input.asOfDate || inventoryPlanningSource.reduce((latest, row) => row.reportDate > latest ? row.reportDate : latest, "");
      if (!asOfDate) return { asOfDate: null, rows: [] };

      const lifecycleStatuses = await db!.select().from(opsAsinLifecycleStatuses)
        .where(eq(opsAsinLifecycleStatuses.workspaceId, workspaceId));
      const lifecycleByKey = new Map(lifecycleStatuses.map(status => [`${status.asin}::${status.storeName}::${status.country}`, status]));

      let locals: any[] = [];
      let parameters: any[] = [];
      try {
        [locals, parameters] = await Promise.all([
          db!.select().from(opsLocalInventoryAdjustments)
            .where(and(
              eq(opsLocalInventoryAdjustments.workspaceId, workspaceId),
              eq(opsLocalInventoryAdjustments.userId, ctx.user.id),
              eq(opsLocalInventoryAdjustments.status, "confirmed"),
            )),
          db!.select().from(opsInventoryPlanningParameters)
            .where(and(
              eq(opsInventoryPlanningParameters.workspaceId, workspaceId),
              eq(opsInventoryPlanningParameters.userId, ctx.user.id),
              eq(opsInventoryPlanningParameters.isActive, 1),
            )),
        ]);
      } catch (error) {
        console.error("[InventoryPlanning] optional local inventory or parameter query failed", { workspaceId, userId: ctx.user.id, error });
      }

      const latestRows = inventoryPlanningSource.filter(row => row.reportDate === asOfDate);
      const planningRows = latestRows.map(latest => {
        const lifecycle = lifecycleByKey.get(`${latest.asin}::${latest.storeName}::${latest.country}`);
        const history = scopedSnapshots.filter(row => row.sourceType !== "lx_inventory_mcp" && row.asin === latest.asin && row.storeName === latest.storeName && row.country === latest.country);
        const local = locals
          .filter(item => item.asin === latest.asin && item.storeName === latest.storeName && item.country === latest.country && item.effectiveDate <= asOfDate)
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id)[0];
        const parameter = parameters.find(item => item.scopeType === "asin" && item.asin === latest.asin && item.storeName === latest.storeName && item.country === latest.country)
          || parameters.find(item => item.scopeType === "store_country" && item.storeName === latest.storeName && item.country === latest.country)
          || parameters.find(item => item.scopeType === "workspace");
        const plan = calculateInventoryPlan({
          asOfDate,
          fbaAvailable: latest.fbaAvailable || latest.availableStock || 0,
          fbaInTransit: latest.fbaInTransit || 0,
          localInventory: local?.localQty || 0,
          salesHistory: history.map(row => ({ reportDate: row.reportDate, salesQty: row.salesQty || 0, totalInventory: (row.fbaAvailable || row.availableStock || 0) + (row.fbaInTransit || 0) + (local?.localQty || 0), isActive: true })),
          productionDays: parameter?.productionDays ?? 30,
          shippingDays: parameter?.shippingDays ?? 30,
          bufferDays: parameter?.bufferDays ?? 10,
          targetCoverDays: parameter?.targetCoverDays ?? 30,
          moq: parameter?.moq ?? 0,
          packSize: parameter?.packSize ?? 1,
        });
        const productCost = parameter?.productCost == null ? null : Number(parameter.productCost);
        const estimatedFirstLegCost = parameter?.estimatedFirstLegCost == null ? null : Number(parameter.estimatedFirstLegCost);
        const actualFirstLegCost = parameter?.actualFirstLegCost == null ? null : Number(parameter.actualFirstLegCost);
        const estimatedFbaFee = parameter?.estimatedFbaFee == null ? null : Number(parameter.estimatedFbaFee);
        const actualFbaFee = parameter?.actualFbaFee == null ? null : Number(parameter.actualFbaFee);
        const sellingPrice = parameter?.sellingPrice == null ? null : Number(parameter.sellingPrice);
        const estimatedDimensions = parameter?.estimatedDimensions ?? null;
        const actualDimensions = parameter?.actualDimensions ?? null;
        const estimatedWeight = parameter?.estimatedWeight == null ? null : Number(parameter.estimatedWeight);
        const actualWeight = parameter?.actualWeight == null ? null : Number(parameter.actualWeight);
        const estimatedBreakEven = sellingPrice !== null && productCost !== null && estimatedFirstLegCost !== null && estimatedFbaFee !== null
          ? sellingPrice * 0.85 - productCost - estimatedFirstLegCost - estimatedFbaFee
          : null;
        const actualBreakEven = sellingPrice !== null && productCost !== null && actualFirstLegCost !== null && actualFbaFee !== null
          ? sellingPrice * 0.85 - productCost - actualFirstLegCost - actualFbaFee
          : null;
        return {
          asin: latest.asin, sku: latest.msku || latest.sku || null, parentAsin: latest.parentAsin, storeName: latest.storeName, country: latest.country,
          productName: latest.productName || latest.title || null, operator: latest.operator || null, localInventory: local?.localQty || 0,
          localInventoryConfirmedAt: local?.confirmedAt || null, parameterScope: parameter?.scopeType || "workspace",
          productionDays: parameter?.productionDays ?? 30, shippingDays: parameter?.shippingDays ?? 30, bufferDays: parameter?.bufferDays ?? 10,
          productCost, estimatedFirstLegCost, actualFirstLegCost, estimatedFbaFee, actualFbaFee, sellingPrice, estimatedDimensions, actualDimensions, estimatedWeight, actualWeight, dimensionUnit: parameter?.dimensionUnit ?? "in", weightUnit: parameter?.weightUnit ?? "lb", currency: parameter?.currency ?? "USD",
          estimatedBreakEven, actualBreakEven,
          lifecycleStatus: lifecycle?.status || "active",
          lifecycleReason: lifecycle?.reason || null,
          lifecycleEvidenceStartDate: lifecycle?.evidenceStartDate || null,
          lifecycleEvidenceEndDate: lifecycle?.evidenceEndDate || null,
          lifecycleEvidenceDays: lifecycle?.evidenceDays || 0,
          lifecycleRestoredAt: lifecycle?.restoredAt || null,
          lifecycleRestoreReason: lifecycle?.restoreReason || null,
          ...plan,
        };
      });
      await applyOperatorMappings(db, planningRows as any, "lingxing");
      return { asOfDate, rows: planningRows };
    }),

  restoreAsinLifecycleStatus: protectedProcedure
    .input(z.object({
      asin: z.string().min(1),
      storeName: z.string().min(1),
      country: z.string().min(1),
      reason: z.string().trim().min(2, "请填写恢复在售的原因").max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
      const [existing] = await db!.select().from(opsAsinLifecycleStatuses).where(and(
        eq(opsAsinLifecycleStatuses.workspaceId, workspaceId),
        eq(opsAsinLifecycleStatuses.asin, input.asin),
        eq(opsAsinLifecycleStatuses.storeName, input.storeName),
        eq(opsAsinLifecycleStatuses.country, input.country),
      )).limit(1);
      if (!existing || existing.status !== "discontinued") {
        throw new Error("未找到可恢复的停售状态记录");
      }
      const restoredAt = new Date();
      await db!.update(opsAsinLifecycleStatuses).set({
        status: "active",
        changedBy: ctx.user.id,
        changedAt: restoredAt,
        restoredAt,
        restoreReason: input.reason,
      }).where(and(eq(opsAsinLifecycleStatuses.workspaceId, workspaceId), eq(opsAsinLifecycleStatuses.id, existing.id)));
      return { restored: true, restoredAt };
    }),

  confirmLocalInventory: protectedProcedure
    .input(z.object({ asin: z.string().min(1), storeName: z.string().min(1), country: z.string().min(1), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), localQty: z.number().int().min(0), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const current = await db!.select().from(opsLocalInventoryAdjustments)
        .where(opsWorkspaceCondition(opsLocalInventoryAdjustments, currentOpsWorkspaceId(), and(
          eq(opsLocalInventoryAdjustments.userId, ctx.user.id), eq(opsLocalInventoryAdjustments.asin, input.asin), eq(opsLocalInventoryAdjustments.storeName, input.storeName), eq(opsLocalInventoryAdjustments.country, input.country), eq(opsLocalInventoryAdjustments.effectiveDate, input.effectiveDate), eq(opsLocalInventoryAdjustments.status, "confirmed"),
        )));
      const [created] = await db!.insert(opsLocalInventoryAdjustments).values({ ...input, userId: ctx.user.id, status: "confirmed", confirmedBy: ctx.user.id, confirmedAt: new Date() }).$returningId();
      if (current.length) {
        await db!.update(opsLocalInventoryAdjustments).set({ status: "superseded", supersededById: created.id }).where(opsWorkspaceCondition(opsLocalInventoryAdjustments, currentOpsWorkspaceId(), inArray(opsLocalInventoryAdjustments.id, current.map(row => row.id))));
      }
      return { id: created.id, status: "confirmed" as const };
    }),

  saveInventoryPlanningParameters: protectedProcedure
    .input(z.object({
      scopeType: z.enum(["workspace", "store_country", "parent_asin", "asin"]),
      asin: z.string().optional(), parentAsin: z.string().optional(), storeName: z.string().optional(), country: z.string().optional(),
      productionDays: z.number().int().min(0).max(365).default(30), shippingDays: z.number().int().min(0).max(365).default(30), bufferDays: z.number().int().min(0).max(365).default(10), targetCoverDays: z.number().int().min(1).max(365).default(30), moq: z.number().int().min(0).default(0), packSize: z.number().int().min(1).default(1),
      productCost: z.number().min(0).optional(), estimatedFirstLegCost: z.number().min(0).optional(), actualFirstLegCost: z.number().min(0).optional(), estimatedFbaFee: z.number().min(0).optional(), actualFbaFee: z.number().min(0).optional(), sellingPrice: z.number().min(0).optional(), estimatedDimensions: z.string().max(120).optional(), actualDimensions: z.string().max(120).optional(), estimatedWeight: z.number().min(0).optional(), actualWeight: z.number().min(0).optional(), dimensionUnit: z.enum(["in", "cm"]).default("in"), weightUnit: z.enum(["lb", "kg"]).default("lb"), currency: z.literal("USD").default("USD"),
    }).superRefine((value, issue) => {
      if (value.scopeType === "store_country" && (!value.storeName || !value.country)) issue.addIssue({ code: "custom", message: "店铺和国家不能为空" });
      if (value.scopeType === "parent_asin" && (!value.parentAsin || !value.storeName || !value.country)) issue.addIssue({ code: "custom", message: "父 ASIN、店铺和国家不能为空" });
      if (value.scopeType === "asin" && (!value.asin || !value.storeName || !value.country)) issue.addIssue({ code: "custom", message: "ASIN、店铺和国家不能为空" });
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const existing = await db!.select().from(opsInventoryPlanningParameters)
        .where(opsWorkspaceCondition(opsInventoryPlanningParameters, currentOpsWorkspaceId(), and(
          eq(opsInventoryPlanningParameters.userId, ctx.user.id), eq(opsInventoryPlanningParameters.scopeType, input.scopeType),
          input.asin ? eq(opsInventoryPlanningParameters.asin, input.asin) : isNull(opsInventoryPlanningParameters.asin),
          input.parentAsin ? eq(opsInventoryPlanningParameters.parentAsin, input.parentAsin) : isNull(opsInventoryPlanningParameters.parentAsin),
          input.storeName ? eq(opsInventoryPlanningParameters.storeName, input.storeName) : isNull(opsInventoryPlanningParameters.storeName),
          input.country ? eq(opsInventoryPlanningParameters.country, input.country) : isNull(opsInventoryPlanningParameters.country),
        ))).limit(1);
      if (existing[0]) {
        await db!.update(opsInventoryPlanningParameters).set({ ...input, isActive: 1 }).where(opsWorkspaceCondition(opsInventoryPlanningParameters, currentOpsWorkspaceId(), eq(opsInventoryPlanningParameters.id, existing[0].id)));
        return { id: existing[0].id, status: "updated" as const };
      }
      const [created] = await db!.insert(opsInventoryPlanningParameters).values({ ...input, userId: ctx.user.id, isActive: 1 }).$returningId();
      return { id: created.id, status: "created" as const };
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
        .where(opsWorkspaceCondition(productionConfig, currentOpsWorkspaceId(), and(
          eq(productionConfig.userId, effectiveUserId),
          eq(productionConfig.marketplace, input.marketplace)
        )));
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
        .where(opsWorkspaceCondition(productionConfig, currentOpsWorkspaceId(), and(
          eq(productionConfig.userId, effectiveUserId),
          eq(productionConfig.parentAsin, input.parentAsin),
          eq(productionConfig.marketplace, input.marketplace)
        )))
        .limit(1);
      if (existing.length > 0) {
        await db!.update(productionConfig)
          .set({
            productionTimeDays: input.productionTimeDays,
            shippingTimeDays: input.shippingTimeDays,
            notes: input.notes || null,
          })
          .where(opsWorkspaceCondition(productionConfig, currentOpsWorkspaceId(), eq(productionConfig.id, existing[0].id)));
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

function mapLingxingDailyRow(row: Record<string, any>, importId: number, userId: number) {
  const reportDate = String(row.reportDate || "").trim();
  const asin = String(row.asin || "").trim();
  const parentAsin = String(row.parentAsin || asin).trim();
  const storeName = String(row.storeName || "").trim();
  const country = String(row.country || "").trim();
  if (!reportDate || !asin || !parentAsin || !storeName || !country) return null;
  const integer = (value: unknown) => Number.parseInt(String(value ?? 0), 10) || 0;
  const decimal = (value: unknown) => String(Number.parseFloat(String(value ?? 0)) || 0);
  const sourceRowHash = createHash("sha256")
    .update([reportDate, asin, parentAsin, storeName, country, JSON.stringify(row)].join("|"))
    .digest("hex");
  return {
    importId, userId, reportDate, asin, parentAsin, storeName, country, sourceRowHash,
    msku: row.msku || null, sku: row.sku || null, title: row.title || null,
    productName: row.productName || null, brand: row.brand || null,
    category1: row.category1 || null, category2: row.category2 || null, category3: row.category3 || null,
    operator: row.operator || null, createdTime: row.createdTime || null,
    salesQty: integer(row.salesQty), orderQty: integer(row.orderQty),
    salesAmount: decimal(row.salesAmount), netSalesAmount: decimal(row.netSalesAmount),
    orderProfit: decimal(row.orderProfit), adSpend: decimal(row.adSpend), adSales: decimal(row.adSales),
    adOrders: integer(row.adOrders), organicOrders: integer(row.organicOrders),
    sessionsTotal: integer(row.sessionsTotal), adClicks: integer(row.adClicks), adImpressions: integer(row.adImpressions),
    returnQty: integer(row.returnQty), fbaAvailable: integer(row.fbaAvailable),
    fbaInTransit: integer(row.fbaInTransit), fbaPlanInbound: integer(row.fbaPlanInbound),
    fbaTotal: integer(row.fbaTotal), availableStock: integer(row.availableStock),
    fbmAvailable: integer(row.fbmAvailable), awdAvailable: integer(row.awdAvailable),
    awdInTransit: integer(row.awdInTransit), overseasAvailable: integer(row.overseasAvailable),
    sourceLocalAvailable: integer(row.localAvailable),
  };
}

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
    .where(or(
      isNull(lingxingProductWeekly.workspaceId),
      opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(
        eq(lingxingProductWeekly.userId, userId),
        isNull(lingxingProductWeekly.userId)
      ))
    ))
    .orderBy(desc(lingxingProductWeekly.weekStartDate))
    .limit(weeksToShow + 1); // +1 for WoW comparison

  if (weekRanges.length === 0) return [];

  // Get all data for these weeks
  const allData = await db.select().from(lingxingProductWeekly)
    .where(and(
      or(
        isNull(lingxingProductWeekly.workspaceId),
        opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(
          eq(lingxingProductWeekly.userId, userId),
          isNull(lingxingProductWeekly.userId)
        ))
      ),
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
  await applyOperatorMappings(db, result, "lingxing");

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
    .where(or(
      isNull(saihuProductWeekly.workspaceId),
      opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(
        eq(saihuProductWeekly.userId, userId),
        isNull(saihuProductWeekly.userId)
      ))
    ))
    .orderBy(desc(saihuProductWeekly.weekStartDate))
    .limit(weeksToShow + 1);

  if (weekRanges.length === 0) return [];

  // Get all data for these weeks
  const allData = await db.select().from(saihuProductWeekly)
    .where(and(
      or(
        isNull(saihuProductWeekly.workspaceId),
        opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(
          eq(saihuProductWeekly.userId, userId),
          isNull(saihuProductWeekly.userId)
        ))
      ),
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
  await applyOperatorMappings(db, result, "saihu");

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
      or(
        isNull(lingxingProductWeekly.workspaceId),
        opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), or(
          eq(lingxingProductWeekly.userId, userId),
          isNull(lingxingProductWeekly.userId)
        ))
      ),
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
  await applyOperatorMappings(db, [productObj], "lingxing");

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
      or(
        isNull(saihuProductWeekly.workspaceId),
        opsWorkspaceCondition(saihuProductWeekly, currentOpsWorkspaceId(), or(
          eq(saihuProductWeekly.userId, userId),
          isNull(saihuProductWeekly.userId)
        ))
      ),
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
  await applyOperatorMappings(db, [productObj], "saihu");

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
