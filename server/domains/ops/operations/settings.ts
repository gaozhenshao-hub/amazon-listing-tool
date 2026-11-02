import { failUnavailableDataSource } from "@shared/_core/errors";
import { requireOpsDb } from "../legacy/repository";
import { runOpsSkill } from "../legacy/service";
import { z, TRPCError, protectedProcedure, router, getDb, invokeBusinessSkill, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const settingsProcedures = {
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
    const db = await requireOpsDb();
    const rows = await db!.select().from(userSettings)
      .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), eq(userSettings.userId, ctx.user.id)));
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.settingKey] = r.settingValue || '';
    }
    return result;
  }),

saveUserSetting: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const now = Date.now();
      // Upsert: try to find existing, then insert or update
      const existing = await db!.select().from(userSettings)
        .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), and(eq(userSettings.userId, ctx.user.id), eq(userSettings.settingKey, input.key))));
      if (existing.length > 0) {
        await db!.update(userSettings)
          .set({ settingValue: input.value, updatedAt: now })
          .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), eq(userSettings.id, existing[0].id)));
      } else {
        await db!.insert(userSettings).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
          userId: ctx.user.id,
          settingKey: input.key,
          settingValue: input.value,
          createdAt: now,
          updatedAt: now,
        }));
      }
      return { success: true };
    }),

// ============== ASIN Status Management ==============
  getAsinStatuses: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireOpsDb();
    const rows = await db!.select().from(asinStatusCache)
      .where(opsWorkspaceCondition(asinStatusCache, workspaceIdFromContext(ctx)));
    return rows.map(r => ({
      asin: r.asin,
      msku: r.msku,
      marketplace: r.marketplace,
      status: r.listingStatus,
      lastSyncedAt: r.lastSyncedAt,
    }));
  }),

syncAsinStatuses: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireOpsDb();
    const { sids: allSids } = await getAllSellerSids();
    let synced = 0;
    const now = Date.now();
    
    // Query listing status from Lingxing for each store
    for (const sid of allSids.slice(0, 10)) {
      try {
        const res = failUnavailableDataSource();
        const listingsRaw = res.data || [];
        const listings = Array.isArray(listingsRaw) ? listingsRaw : (listingsRaw as any)?.records || (listingsRaw as any)?.list || [];
        for (const item of listings) {
          const asin = item.asin1 || item.asin;
          if (!asin) continue;
          const status = item.status === 'Active' || item.status === 'active' ? 'active' : 'inactive';
          // Upsert
          const existing = await db!.select().from(asinStatusCache)
            .where(opsWorkspaceCondition(asinStatusCache, workspaceIdFromContext(ctx), and(eq(asinStatusCache.asin, asin), eq(asinStatusCache.sid, String(sid)))));
          if (existing.length > 0) {
            await db!.update(asinStatusCache)
              .set({ listingStatus: status as any, lastSyncedAt: now, updatedAt: now, msku: item.msku || item.seller_sku })
              .where(opsWorkspaceCondition(asinStatusCache, workspaceIdFromContext(ctx), eq(asinStatusCache.id, existing[0].id)));
          } else {
            await db!.insert(asinStatusCache).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
              asin,
              msku: item.msku || item.seller_sku || '',
              sid: String(sid),
              marketplace: 'US',
              listingStatus: status as any,
              lastSyncedAt: now,
              createdAt: now,
              updatedAt: now,
            }));
          }
          synced++;
        }
      } catch (err: any) {
        console.warn(`[SyncAsinStatus] sid=${sid}: ${err.message}`);
      }
    }
    return { synced };
  })
};
