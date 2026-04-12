/**
 * Cron Jobs - Auto-sync weekly ops data from Lingxing API
 * Runs every Monday at 2:00 AM (server time) to pull last week's data
 */
import cron from 'node-cron';
import { getDb } from './db';
import { productProfiles, productVariants, productWeeklyOps, productMonthlySummary } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getLingxingAdapter } from './lingxingAdapter';

let cronTask: cron.ScheduledTask | null = null;

/**
 * Sync weekly ops for a single product (lightweight version for batch cron)
 */
async function syncProductWeeklyOps(
  db: any,
  adapter: any,
  productId: number,
  userId: number,
  parentAsin: string,
  weeks: number = 1
): Promise<{ syncedWeeks: number; error?: string }> {
  try {
    const variants = await db.select().from(productVariants)
      .where(eq(productVariants.productId, productId));
    const skus = variants.map((v: any) => v.sku).filter(Boolean) as string[];
    const childAsins = variants.map((v: any) => v.childAsin).filter(Boolean);

    const now = new Date();
    const daysBack = weeks * 7 + 2; // extra 2 days buffer
    const globalStart = new Date(now.getTime() - daysBack * 86400000);
    const startDate = globalStart.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const searchField = skus.length > 0 ? 'seller_sku' : 'asin';
    const searchValue = skus.length > 0 ? skus : (childAsins.length > 0 ? childAsins : [parentAsin]);

    const res = await adapter.requestWithMockFallback({
      path: "/bd/profit/report/open/report/msku/list",
      body: {
        offset: 0, length: 5000,
        startDate, endDate,
        searchField, searchValue,
        monthlyQuery: false,
        summaryEnabled: false,
        orderStatus: "All",
      },
    });
    const raw = res.data || [];
    const profitItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];

    // Group by week
    function getWeekMonday(dateStr: string): string {
      const d = new Date(dateStr);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff)).toISOString().split('T')[0];
    }

    const weekMap = new Map<string, any[]>();
    for (const item of profitItems) {
      const date = item.postedDateLocale || item.statDate || item.date || '';
      if (!date) continue;
      const weekKey = getWeekMonday(date);
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
      weekMap.get(weekKey)!.push(item);
    }

    let synced = 0;
    for (const [weekStart, items] of Array.from(weekMap.entries())) {
      const ws = new Date(weekStart);
      const weekEnd = new Date(ws.getTime() + 6 * 86400000).toISOString().split('T')[0];

      let totalSales = 0, totalRevenue = 0, totalProfit = 0, totalAdSpend = 0;
      for (const item of items) {
        totalSales += Number(item.totalSalesQuantity || item.totalFbaAndFbmQuantity || 0);
        totalRevenue += Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
        totalProfit += Number(item.grossProfit || 0);
        totalAdSpend += Math.abs(Number(item.totalAdsCost || 0));
      }

      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
      const prevWeekStart = new Date(ws.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const prevItems = weekMap.get(prevWeekStart) || [];
      const prevSales = prevItems.reduce((s: number, i: any) => s + Number(i.totalSalesQuantity || i.totalFbaAndFbmQuantity || 0), 0);
      const trend = totalSales > prevSales ? 'up' : totalSales < prevSales ? 'down' : 'stable';

      const [existing] = await db.select().from(productWeeklyOps)
        .where(and(
          eq(productWeeklyOps.productId, productId),
          eq(productWeeklyOps.userId, userId),
          eq(productWeeklyOps.weekStartDate, weekStart),
        ));

      const record = {
        salesTrend: trend as any,
        salesQty: totalSales,
        orderQty: totalSales,
        salesAmount: totalRevenue.toFixed(2),
        orderProfit: totalProfit.toFixed(2),
        orderProfitMargin: profitMargin.toFixed(2),
        adSpend: totalAdSpend.toFixed(2),
        acos: totalRevenue > 0 ? (totalAdSpend / totalRevenue * 100).toFixed(2) : '0',
      };

      if (existing) {
        await db.update(productWeeklyOps).set(record as any).where(eq(productWeeklyOps.id, existing.id));
      } else {
        await db.insert(productWeeklyOps).values({
          ...record as any,
          productId,
          userId,
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
        });
      }
      synced++;
    }

    return { syncedWeeks: synced };
  } catch (err: any) {
    return { syncedWeeks: 0, error: err.message };
  }
}

/**
 * Run the batch sync for all users' active products
 */
async function runAutoSync() {
  console.log(`[AutoSync] Starting weekly auto-sync at ${new Date().toISOString()}`);
  const db = await getDb();
  if (!db) {
    console.error('[AutoSync] Database not available');
    return;
  }

  try {
    const adapter = getLingxingAdapter();

    // Get all active products grouped by user
    const allProducts = await db.select({
      id: productProfiles.id,
      userId: productProfiles.userId,
      parentAsin: productProfiles.parentAsin,
    }).from(productProfiles)
      .where(eq(productProfiles.status, 'active'));

    console.log(`[AutoSync] Found ${allProducts.length} active products to sync`);

    let totalSynced = 0;
    let totalErrors = 0;

    for (const product of allProducts) {
      const result = await syncProductWeeklyOps(
        db, adapter, product.id, product.userId, product.parentAsin, 1
      );
      if (result.error) {
        console.warn(`[AutoSync] Product ${product.id} (${product.parentAsin}) error: ${result.error}`);
        totalErrors++;
      } else {
        totalSynced += result.syncedWeeks;
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[AutoSync] Completed: ${totalSynced} weeks synced, ${totalErrors} errors, ${allProducts.length} products processed`);
  } catch (err: any) {
    console.error(`[AutoSync] Fatal error: ${err.message}`);
  }
}

/**
 * Initialize the cron job
 * Schedule: Every Monday at 2:00 AM (server time)
 */
export function initCronJobs() {
  if (cronTask) {
    cronTask.stop();
  }

  // "0 2 * * 1" = At 02:00 on Monday
  cronTask = cron.schedule('0 2 * * 1', () => {
    runAutoSync().catch(err => {
      console.error(`[AutoSync] Unhandled error: ${err.message}`);
    });
  }, {
    timezone: 'Asia/Shanghai', // Use China timezone for Amazon CN sellers
  });

  console.log('[AutoSync] Cron job initialized: Every Monday at 02:00 (Asia/Shanghai)');
}

/**
 * Manually trigger the auto-sync (for testing or admin use)
 */
export async function triggerManualSync() {
  await runAutoSync();
}

/**
 * Stop the cron job
 */
export function stopCronJobs() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[AutoSync] Cron job stopped');
  }
}
