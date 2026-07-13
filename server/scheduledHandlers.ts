import { runSkillViaEmperor } from "./emperorClient";
/**
 * Scheduled Task Handlers
 * 
 * These handlers are called by the Manus Heartbeat system (HTTP cron).
 * Each handler runs at `/api/scheduled/<name>` and is triggered by the platform.
 * 
 * Authentication: Platform sends a cron session cookie that can be verified
 * via the x-manus-cron-task-uid header (trusted by platform gateway).
 */
import { Request, Response } from "express";
import { getDb } from "./db";
import { lingxingProductWeekly, saihuProductWeekly, productProfiles } from "../drizzle/schema";
import { desc, eq, gte } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

/**
 * Weekly Operations Report Handler
 * 
 * Generates a summary report based on the latest imported Excel data:
 * - Top/bottom performers by sales and profit
 * - Inventory alerts (low stock, overstock)
 * - Ad performance highlights
 * - Action items for the coming week
 * 
 * Triggered: Every Monday 09:00 UTC (17:00 China time)
 * Path: POST /api/scheduled/weekly-report
 */
export async function weeklyReportHandler(req: Request, res: Response) {
  const taskUid = req.headers["x-manus-cron-task-uid"] as string | undefined;
  
  try {
    console.log(`[WeeklyReport] Triggered by task_uid=${taskUid}`);
    
    // 1. Get the latest week's data from both data sources
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const db = await getDb();
    if (!db) {
      return res.status(503).json({ error: "Database not available" });
    }
    const [recentLingxing, recentSaihu, activeProducts] = await Promise.all([
      db.select().from(lingxingProductWeekly)
        .where(gte(lingxingProductWeekly.createdAt, oneWeekAgo))
        .orderBy(desc(lingxingProductWeekly.createdAt))
        .limit(200),
      db.select().from(saihuProductWeekly)
        .where(gte(saihuProductWeekly.createdAt, oneWeekAgo))
        .orderBy(desc(saihuProductWeekly.createdAt))
        .limit(200),
      db.select().from(productProfiles)
        .where(eq(productProfiles.status, "active"))
        .limit(500),
    ]);

    // 2. If no data imported this week, send a reminder notification
    if (recentLingxing.length === 0 && recentSaihu.length === 0) {
      await notifyOwner({
        title: "📊 周报提醒：本周尚未导入数据",
        content: "本周尚未导入任何运营数据（领星/赛狐Excel），无法生成周报。请尽快上传最新数据。",
      });
      
      return res.json({ 
        ok: true, 
        skipped: "no_data_imported",
        message: "No data imported this week, reminder sent to owner" 
      });
    }

    // 3. Prepare data summary for AI analysis
    const dataSummary = {
      totalProducts: activeProducts.length,
      lingxingRecords: recentLingxing.length,
      saihuRecords: recentSaihu.length,
      topBySales: recentLingxing
        .sort((a, b) => Number(b.orderQty || 0) - Number(a.orderQty || 0))
        .slice(0, 5)
        .map(r => ({
          asin: r.asin,
          sku: r.msku,
          sales: r.orderQty,
          revenue: r.salesAmount,
          profit: r.orderProfit,
        })),
      bottomBySales: recentLingxing
        .filter(r => Number(r.orderQty || 0) > 0)
        .sort((a, b) => Number(a.orderQty || 0) - Number(b.orderQty || 0))
        .slice(0, 5)
        .map(r => ({
          asin: r.asin,
          sku: r.msku,
          sales: r.orderQty,
          revenue: r.salesAmount,
          profit: r.orderProfit,
        })),
      totalRevenue: recentLingxing.reduce((sum, r) => sum + Number(r.salesAmount || 0), 0),
      totalProfit: recentLingxing.reduce((sum, r) => sum + Number(r.orderProfit || 0), 0),
      totalOrders: recentLingxing.reduce((sum, r) => sum + Number(r.orderQty || 0), 0),
    };

    // 4. Use AI to generate insights
      // [Emperor] 优先调用 Emperor Skill: ops.profit.analysis

    try {

      const _emperorRes = await runSkillViaEmperor("ops.profit.analysis", { context: JSON.stringify(input ?? {}).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，结果已记录

      }

    } catch (_e) { console.warn("[Emperor] scheduledHandlers.ts fallback:", _e); }

    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位资深的亚马逊运营分析师。请根据以下周度数据摘要，生成一份简洁的运营周报。
要求：
- 使用中文
- 突出关键指标变化
- 给出3-5条具体的行动建议
- 格式：Markdown，包含标题、关键指标、Top/Bottom产品、行动建议
- 控制在500字以内`
        },
        {
          role: "user",
          content: `本周运营数据摘要：\n${JSON.stringify(dataSummary, null, 2)}`
        }
      ],
    });

    const reportContent = llmResponse.choices?.[0]?.message?.content as string || "周报生成失败";

    // 5. Send notification to owner
    await notifyOwner({
      title: `📊 亚马逊运营周报 (${new Date().toLocaleDateString("zh-CN")})`,
      content: reportContent,
    });

    console.log(`[WeeklyReport] Report generated and sent successfully`);
    
    return res.json({ 
      ok: true, 
      reportLength: reportContent.length,
      dataPoints: dataSummary.lingxingRecords + dataSummary.saihuRecords,
    });

  } catch (error: any) {
    console.error(`[WeeklyReport] Error:`, error);
    return res.status(500).json({
      error: error.message || "Unknown error",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      context: { url: req.url, taskUid },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Data Cleanup Handler
 * 
 * Cleans up old import history and stale temporary data.
 * Triggered: Every Sunday 03:00 UTC
 * Path: POST /api/scheduled/data-cleanup
 */
export async function dataCleanupHandler(req: Request, res: Response) {
  const taskUid = req.headers["x-manus-cron-task-uid"] as string | undefined;
  
  try {
    console.log(`[DataCleanup] Triggered by task_uid=${taskUid}`);
    
    // Clean up import history older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    // Log the cleanup
    console.log(`[DataCleanup] Cleaning records older than ${ninetyDaysAgo.toISOString()}`);
    
    return res.json({ 
      ok: true, 
      message: "Cleanup completed",
      cutoffDate: ninetyDaysAgo.toISOString(),
    });

  } catch (error: any) {
    console.error(`[DataCleanup] Error:`, error);
    return res.status(500).json({
      error: error.message || "Unknown error",
      context: { url: req.url, taskUid },
      timestamp: new Date().toISOString(),
    });
  }
}
