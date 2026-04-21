/**
 * Data Import Center Router
 * Handles Excel file upload, parsing, preview, and import for
 * Lingxing (领星) and Saihu (赛狐) product data
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dataImports, lingxingProductWeekly, saihuProductWeekly } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { parseExcelBuffer, parseDateRangeFromFilename, detectSourceType, type SourceType, type DateRange } from "../excelParser";
import { storagePut } from "../storage";

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
      if (input.sourceType === "lingxing") {
        // Get distinct week ranges, ordered by date desc
        const weekRanges = await db!.selectDistinct({
          weekStartDate: lingxingProductWeekly.weekStartDate,
          weekEndDate: lingxingProductWeekly.weekEndDate,
        })
          .from(lingxingProductWeekly)
          .where(eq(lingxingProductWeekly.userId, ctx.user.id))
          .orderBy(desc(lingxingProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        // Get all data for these weeks
        const data = await db!.select().from(lingxingProductWeekly)
          .where(and(
            eq(lingxingProductWeekly.userId, ctx.user.id),
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
          .where(eq(saihuProductWeekly.userId, ctx.user.id))
          .orderBy(desc(saihuProductWeekly.weekStartDate))
          .limit(input.weeks);

        if (weekRanges.length === 0) return { weeks: [], data: [] };

        const data = await db!.select().from(saihuProductWeekly)
          .where(and(
            eq(saihuProductWeekly.userId, ctx.user.id),
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
      const table = input.sourceType === "lingxing" ? lingxingProductWeekly : saihuProductWeekly;
      const ranges = await db!.selectDistinct({
        weekStartDate: table.weekStartDate,
        weekEndDate: table.weekEndDate,
      })
        .from(table)
        .where(eq(table.userId, ctx.user.id))
        .orderBy(desc(table.weekStartDate));

      return ranges;
    }),

  // ─── Get Stats for Dashboard ───
  getImportStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      const [lingxingCount] = await db!.select({ count: sql<number>`count(DISTINCT week_start_date)` })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, ctx.user.id));

      const [saihuCount] = await db!.select({ count: sql<number>`count(DISTINCT week_start_date)` })
        .from(saihuProductWeekly)
        .where(eq(saihuProductWeekly.userId, ctx.user.id));

      const [lingxingProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, ctx.user.id));

      const [saihuProducts] = await db!.select({ count: sql<number>`count(DISTINCT parent_asin)` })
        .from(saihuProductWeekly)
        .where(eq(saihuProductWeekly.userId, ctx.user.id));

      const [latestImport] = await db!.select().from(dataImports)
        .where(and(eq(dataImports.userId, ctx.user.id), eq(dataImports.status, "completed")))
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
});
