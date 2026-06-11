/**
 * 部署配置与同步管理 tRPC Router
 * 
 * 提供部署信息查询、同步管理、使用量统计等功能
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { kbSyncLogs, remoteUsageSnapshots, users, usageStats, systemSettings } from "../../drizzle/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Sync config setting keys
const SYNC_SETTING_KEYS = {
  PEER_API_URL: "peer_api_url",
  PEER_API_KEY: "peer_api_key",
  PEER_SYNC_ENABLED: "peer_sync_enabled",
} as const;

export const deploymentConfigRouter = router({
  // 获取当前部署信息
  getDeploymentInfo: protectedProcedure.query(async () => {
    return {
      companyName: ENV.companyName,
      companyLogo: ENV.companyLogo,
      erpType: ENV.erpType,
      instanceId: ENV.instanceId,
      peerSyncEnabled: ENV.peerSyncEnabled,
      peerApiUrl: ENV.peerApiUrl || null,
      usageReportEnabled: ENV.usageReportEnabled,
    };
  }),

  // 获取同步状态
  getSyncStatus: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { enabled: false, lastSync: null, pendingConflicts: 0, failuresLast24h: 0, syncedCounts: {} };

    // Last successful sync
    const lastSync = await db.select().from(kbSyncLogs)
      .where(eq(kbSyncLogs.syncStatus, "synced"))
      .orderBy(desc(kbSyncLogs.syncedAt))
      .limit(1);

    // Pending conflicts
    const conflicts = await db.select({ count: sql<number>`COUNT(*)` })
      .from(kbSyncLogs)
      .where(eq(kbSyncLogs.syncStatus, "conflict"));

    // Failed syncs in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failures = await db.select({ count: sql<number>`COUNT(*)` })
      .from(kbSyncLogs)
      .where(and(
        eq(kbSyncLogs.syncStatus, "failed"),
        gte(kbSyncLogs.createdAt, oneDayAgo)
      ));

    return {
      enabled: ENV.peerSyncEnabled,
      lastSync: lastSync[0]?.syncedAt || null,
      pendingConflicts: Number(conflicts[0]?.count || 0),
      failuresLast24h: Number(failures[0]?.count || 0),
    };
  }),

  // 获取同步日志
  getSyncLogs: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { logs: [], total: 0 };

      const offset = (input.page - 1) * input.limit;
      const logs = await db.select().from(kbSyncLogs)
        .orderBy(desc(kbSyncLogs.createdAt))
        .limit(input.limit)
        .offset(offset);

      const total = await db.select({ count: sql<number>`COUNT(*)` }).from(kbSyncLogs);

      return {
        logs,
        total: Number(total[0]?.count || 0),
      };
    }),

  // 手动触发同步（通过前端调用后端Express API）
  triggerSync: protectedProcedure.mutation(async () => {
    if (!ENV.peerSyncEnabled || !ENV.peerApiUrl) {
      return { success: false, error: "对端同步未配置" };
    }

    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/sync/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-api-key": ENV.peerApiKey,
        },
        body: JSON.stringify({ apiKey: ENV.peerApiKey }),
      });

      if (!response.ok) {
        return { success: false, error: `同步请求失败: ${response.status}` };
      }

      const result = await response.json();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: `同步出错: ${(error as Error).message}` };
    }
  }),

  // 获取本地使用量统计
  getUsageStats: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      period: z.enum(["day", "week", "month"]).default("day"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { stats: [], summary: null };

      const endDate = input.endDate || new Date().toISOString().split("T")[0];
      const startDate = input.startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split("T")[0];
      })();

      const stats = await db.select().from(usageStats)
        .where(and(
          gte(usageStats.statDate, startDate),
          lte(usageStats.statDate, endDate)
        ))
        .orderBy(desc(usageStats.statDate))
        .limit(100);

      // Summary
      const summary = await db.select({
        totalAiCalls: sql<number>`COALESCE(SUM(${usageStats.aiCallCount}), 0)`,
        totalApiCalls: sql<number>`COALESCE(SUM(${usageStats.apiCallCount}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${usageStats.aiTokensUsed}), 0)`,
        totalStorage: sql<number>`COALESCE(MAX(${usageStats.storageUsedBytes}), 0)`,
      }).from(usageStats)
        .where(and(
          gte(usageStats.statDate, startDate),
          lte(usageStats.statDate, endDate)
        ));

      // Active users count
      const activeUsers = await db.select({ count: sql<number>`COUNT(*)` })
        .from(users)
        .where(eq(users.status, "active"));

      const totalUsers = await db.select({ count: sql<number>`COUNT(*)` })
        .from(users);

      return {
        stats,
        summary: {
          ...summary[0],
          activeUsers: Number(activeUsers[0]?.count || 0),
          totalUsers: Number(totalUsers[0]?.count || 0),
        },
      };
    }),

  // 获取远程使用量快照（查看对端使用情况）
  getRemoteUsageSnapshots: protectedProcedure
    .input(z.object({
      instanceId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { snapshots: [] };

      let query = db.select().from(remoteUsageSnapshots)
        .orderBy(desc(remoteUsageSnapshots.snapshotDate))
        .limit(100);

      const snapshots = await query;

      return { snapshots };
    }),

  // 上报使用量到对端
  reportUsage: protectedProcedure.mutation(async () => {
    if (!ENV.usageReportEnabled || !ENV.usageReportUrl) {
      return { success: false, error: "使用量上报未配置" };
    }

    const db = await getDb();
    if (!db) return { success: false, error: "数据库不可用" };

    const today = new Date().toISOString().split("T")[0];

    // Gather local stats
    const totalUsersResult = await db.select({ count: sql<number>`COUNT(*)` }).from(users);
    const activeUsersResult = await db.select({ count: sql<number>`COUNT(*)` })
      .from(users).where(eq(users.status, "active"));

    const todayStats = await db.select().from(usageStats)
      .where(eq(usageStats.statDate, today))
      .limit(1);

    try {
      const response = await fetch(`${ENV.usageReportUrl}/api/sync/usage-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-api-key": ENV.peerApiKey,
        },
        body: JSON.stringify({
          apiKey: ENV.peerApiKey,
          instanceId: ENV.instanceId,
          instanceName: ENV.companyName,
          date: today,
          stats: {
            totalUsers: Number(totalUsersResult[0]?.count || 0),
            activeUsers: Number(activeUsersResult[0]?.count || 0),
            aiCallCount: todayStats[0]?.aiCallCount || 0,
            aiTokenUsage: todayStats[0]?.aiTokensUsed || 0,
            apiCallCount: todayStats[0]?.apiCallCount || 0,
            storageUsageMb: Math.round((todayStats[0]?.storageUsedBytes || 0) / 1024 / 1024),
          },
        }),
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }),

  // 获取同步API配置
  getSyncConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        peerApiUrl: ENV.peerApiUrl || "",
        peerApiKey: ENV.peerApiKey ? "••••••••" : "",
        peerSyncEnabled: ENV.peerSyncEnabled,
        source: "env" as const,
      };
    }

    // Try to read from DB first
    const rows = await db.select().from(systemSettings).where(
      eq(systemSettings.category, "sync")
    );
    const map: Record<string, string | null> = {};
    for (const row of rows) {
      map[row.settingKey] = row.settingValue;
    }

    const hasDbConfig = Object.keys(map).length > 0;
    return {
      peerApiUrl: map[SYNC_SETTING_KEYS.PEER_API_URL] ?? ENV.peerApiUrl ?? "",
      peerApiKey: (map[SYNC_SETTING_KEYS.PEER_API_KEY] || ENV.peerApiKey) ? "••••••••" : "",
      peerSyncEnabled: map[SYNC_SETTING_KEYS.PEER_SYNC_ENABLED] === "true" || (!hasDbConfig && ENV.peerSyncEnabled),
      source: hasDbConfig ? "database" as const : "env" as const,
    };
  }),

  // 保存同步API配置
  updateSyncConfig: protectedProcedure
    .input(z.object({
      peerApiUrl: z.string().optional(),
      peerApiKey: z.string().optional(),
      peerSyncEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "super_admin" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理员可以修改同步配置" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const userId = ctx.user.id;
      const settings: Record<string, string> = {};

      if (input.peerApiUrl !== undefined) {
        settings[SYNC_SETTING_KEYS.PEER_API_URL] = input.peerApiUrl;
      }
      if (input.peerApiKey !== undefined && input.peerApiKey !== "••••••••") {
        settings[SYNC_SETTING_KEYS.PEER_API_KEY] = input.peerApiKey;
      }
      if (input.peerSyncEnabled !== undefined) {
        settings[SYNC_SETTING_KEYS.PEER_SYNC_ENABLED] = input.peerSyncEnabled ? "true" : "false";
      }

      for (const [key, value] of Object.entries(settings)) {
        const existing = await db.select().from(systemSettings).where(
          eq(systemSettings.settingKey, key)
        );
        if (existing.length > 0) {
          await db.update(systemSettings)
            .set({ settingValue: value, updatedBy: userId, category: "sync" })
            .where(eq(systemSettings.settingKey, key));
        } else {
          await db.insert(systemSettings).values({
            settingKey: key,
            settingValue: value,
            category: "sync",
            updatedBy: userId,
          });
        }
      }

      // Dynamically update ENV so the sync module picks up changes immediately
      if (input.peerApiUrl !== undefined) (ENV as any).peerApiUrl = input.peerApiUrl;
      if (input.peerApiKey !== undefined && input.peerApiKey !== "••••••••") (ENV as any).peerApiKey = input.peerApiKey;
      if (input.peerSyncEnabled !== undefined) (ENV as any).peerSyncEnabled = input.peerSyncEnabled;

      return { success: true };
    }),

  // 测试对端API连接
  testPeerConnection: protectedProcedure.mutation(async () => {
    // Read from DB first, fallback to ENV
    const db = await getDb();
    let peerApiUrl = ENV.peerApiUrl;
    let peerApiKey = ENV.peerApiKey;

    if (db) {
      const rows = await db.select().from(systemSettings).where(
        eq(systemSettings.category, "sync")
      );
      const map: Record<string, string | null> = {};
      for (const row of rows) map[row.settingKey] = row.settingValue;
      if (map[SYNC_SETTING_KEYS.PEER_API_URL]) peerApiUrl = map[SYNC_SETTING_KEYS.PEER_API_URL]!;
      if (map[SYNC_SETTING_KEYS.PEER_API_KEY]) peerApiKey = map[SYNC_SETTING_KEYS.PEER_API_KEY]!;
    }

    if (!peerApiUrl) {
      return { success: false, message: "对端API地址未配置", latency: null };
    }

    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${peerApiUrl}/api/sync/status`, {
        method: "GET",
        headers: {
          "x-sync-api-key": peerApiKey || "",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json() as any;
        return {
          success: true,
          message: `连接成功！对端实例: ${data.instanceId || "未知"}, 公司: ${data.companyName || "未知"}`,
          latency,
          peerInfo: data,
        };
      } else {
        return {
          success: false,
          message: `对端响应异常: HTTP ${response.status} ${response.statusText}`,
          latency,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `连接失败: ${err.message || "未知错误"}`,
        latency: null,
      };
    }
  }),
});
