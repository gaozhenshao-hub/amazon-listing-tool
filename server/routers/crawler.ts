import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { parse as parseCookie } from "cookie";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { competitorMonitors, competitorSnapshots, keywordMonitors, keywordSnapshots } from "../../drizzle/schema";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { router } from "../_core/trpc";
import { currentOpsWorkspaceId } from "../domains/ops/workspaceContext";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { requireDb } from "../repositories/dbClient";
import { opsWorkspaceCondition } from "../repositories/ops";
import { startAmazonMonitorJob, startMonitorQualificationJob } from "../domains/acquisition/monitorJob";
import {
  defaultMonitorProviderView,
  getMonitorProviderProfile,
  getQualifiedMonitorProviderProfile,
  sanitizeMonitorProviderProfile,
  upsertMonitorProviderCandidate,
} from "../domains/acquisition/monitorProviderProfileService";
import {
  getMonitorSchedule,
  listMonitorRuns,
  upsertMonitorSchedule,
} from "../domains/acquisition/monitorRepository";

function assertAdmin(user: { role?: string | null }) {
  if (user.role !== "admin" && user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有管理员可以配置或验证监控Provider" });
  }
}

function cronForHours(intervalHours: number) {
  if (intervalHours >= 168) return "0 0 0 * * 1";
  if (intervalHours >= 24) return "0 0 0 * * *";
  return `0 0 */${Math.max(Math.floor(intervalHours), 1)} * * *`;
}

function parseNextRunAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sessionToken(cookieHeader: string | undefined) {
  return parseCookie(cookieHeader || "")[COOKIE_NAME] || "";
}

export const crawlerRouter = router({
  getProviderReadiness: protectedProcedure.query(async () => {
    const db = await requireDb("Amazon monitor provider readiness");
    const workspaceId = currentOpsWorkspaceId();
    const [competitor, keyword] = await Promise.all([
      getMonitorProviderProfile(db, workspaceId, "competitor"),
      getMonitorProviderProfile(db, workspaceId, "keyword"),
    ]);
    return {
      competitor: competitor ? sanitizeMonitorProviderProfile("competitor", competitor) : defaultMonitorProviderView("competitor"),
      keyword: keyword ? sanitizeMonitorProviderProfile("keyword", keyword) : defaultMonitorProviderView("keyword"),
      policy: {
        realRunRequiresExplicitConfirmation: true,
        unqualifiedCapabilitiesFailClosed: true,
        legacyCrawlerFallback: false,
        supportedMarketplace: "US",
      },
    };
  }),

  registerProviderCandidate: protectedProcedure
    .input(z.object({
      kind: z.enum(["competitor", "keyword"]),
      displayName: z.string().trim().min(1).max(200).optional(),
      perRunMaxUsd: z.number().positive().max(1).default(0.1),
      dailyBudgetUsd: z.number().positive().max(100).default(5),
      monthlyBudgetUsd: z.number().positive().max(1000).default(100),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);
      const db = await requireDb("Amazon monitor provider candidate");
      return upsertMonitorProviderCandidate({ db, workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, ...input });
    }),

  qualifyProvider: protectedProcedure
    .input(z.object({
      kind: z.enum(["competitor", "keyword"]),
      asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
      keyword: z.string().trim().min(1).max(500).nullable().optional(),
      maxChargeUsd: z.number().positive().max(1),
      confirmExternalCharge: z.literal(true),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);
      if (input.kind === "keyword" && !input.keyword) throw new TRPCError({ code: "BAD_REQUEST", message: "关键词排名资格验证必须提供测试关键词" });
      return startMonitorQualificationJob({ workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, ...input });
    }),

  crawlCompetitor: protectedProcedure
    .input(z.object({ monitorId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb("Competitor monitor queue");
      const [monitor] = await db.select().from(competitorMonitors).where(opsWorkspaceCondition(competitorMonitors, currentOpsWorkspaceId(), and(
        eq(competitorMonitors.id, input.monitorId),
        eq(competitorMonitors.userId, ctx.user.id),
      ))).limit(1);
      if (!monitor) return { success: false, queued: false, error: "Monitor not found" };
      try {
        const job = await startAmazonMonitorJob({ workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, kind: "competitor", monitorId: monitor.id });
        return { success: true, queued: true, ...job, message: "已进入受控Provider队列，完成后写入历史快照" };
      } catch (error) {
        return { success: false, queued: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  crawlKeyword: protectedProcedure
    .input(z.object({ keywordMonitorId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb("Keyword monitor queue");
      const [monitor] = await db.select().from(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), and(
        eq(keywordMonitors.id, input.keywordMonitorId),
        eq(keywordMonitors.userId, ctx.user.id),
      ))).limit(1);
      if (!monitor) return { success: false, queued: false, error: "Keyword monitor not found" };
      try {
        const job = await startAmazonMonitorJob({ workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, kind: "keyword", monitorId: monitor.id });
        return { success: true, queued: true, ...job, message: "已进入受控关键词排名Provider队列" };
      } catch (error) {
        return { success: false, queued: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  crawlAllCompetitors: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb("Competitor monitor batch queue");
    const monitors = await db.select().from(competitorMonitors).where(opsWorkspaceCondition(competitorMonitors, currentOpsWorkspaceId(), and(
      eq(competitorMonitors.userId, ctx.user.id),
      eq(competitorMonitors.isActive, 1),
    )));
    const results = [] as Array<{ monitorId: number; asin: string; success: boolean; queued: boolean; aiJobRunId?: string; error?: string }>;
    for (const monitor of monitors) {
      try {
        const job = await startAmazonMonitorJob({ workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, kind: "competitor", monitorId: monitor.id });
        results.push({ monitorId: monitor.id, asin: monitor.competitorAsin, success: true, queued: true, aiJobRunId: job.aiJobRunId });
      } catch (error) {
        results.push({ monitorId: monitor.id, asin: monitor.competitorAsin, success: false, queued: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const queuedCount = results.filter(item => item.queued).length;
    return { success: true, total: results.length, queuedCount, successCount: queuedCount, failedCount: results.filter(item => !item.queued).length, results };
  }),

  crawlAllKeywords: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb("Keyword monitor batch queue");
      const monitors = await db.select().from(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), and(
        eq(keywordMonitors.userId, ctx.user.id),
        eq(keywordMonitors.productId, input.productId),
        eq(keywordMonitors.isActive, 1),
      )));
      const results = [] as Array<{ monitorId: number; keyword: string; success: boolean; queued: boolean; aiJobRunId?: string; error?: string }>;
      for (const monitor of monitors) {
        try {
          const job = await startAmazonMonitorJob({ workspaceId: currentOpsWorkspaceId(), userId: ctx.user.id, kind: "keyword", monitorId: monitor.id });
          results.push({ monitorId: monitor.id, keyword: monitor.keyword, success: true, queued: true, aiJobRunId: job.aiJobRunId });
        } catch (error) {
          results.push({ monitorId: monitor.id, keyword: monitor.keyword, success: false, queued: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const queuedCount = results.filter(item => item.queued).length;
      return { success: true, total: results.length, queuedCount, successCount: queuedCount, failedCount: results.filter(item => !item.queued).length, results };
    }),

  getSchedulerStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb("Amazon monitor schedules");
    const workspaceId = currentOpsWorkspaceId();
    const [competitors, keywords] = await Promise.all([
      db.select({ id: competitorMonitors.id }).from(competitorMonitors).where(opsWorkspaceCondition(competitorMonitors, workspaceId, eq(competitorMonitors.userId, ctx.user.id))),
      db.select({ id: keywordMonitors.id }).from(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, workspaceId, eq(keywordMonitors.userId, ctx.user.id))),
    ]);
    const schedules = [] as Array<Awaited<ReturnType<typeof getMonitorSchedule>>>;
    for (const monitor of competitors) schedules.push(await getMonitorSchedule(db, workspaceId, "competitor", monitor.id));
    for (const monitor of keywords) schedules.push(await getMonitorSchedule(db, workspaceId, "keyword", monitor.id));
    const existing = schedules.filter(Boolean);
    return {
      running: existing.some(item => item?.status === "active"),
      runtime: "heartbeat" as const,
      activeCount: existing.filter(item => item?.status === "active").length,
      pausedCount: existing.filter(item => item?.status === "paused").length,
      nextRunAt: existing.flatMap(item => item?.nextRunAt ? [item.nextRunAt] : []).sort((a, b) => a.getTime() - b.getTime())[0] || null,
      note: "任务由Manus Heartbeat持久化执行，不依赖Web进程驻留。",
    };
  }),

  startScheduler: protectedProcedure
    .input(z.object({ intervalHours: z.number().int().min(1).max(168).default(24) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb("Amazon monitor heartbeat setup");
      const workspaceId = currentOpsWorkspaceId();
      const token = sessionToken(ctx.req.headers.cookie);
      const cron = cronForHours(input.intervalHours);
      const [competitors, keywords, competitorProvider, keywordProvider] = await Promise.all([
        db.select().from(competitorMonitors).where(opsWorkspaceCondition(competitorMonitors, workspaceId, and(eq(competitorMonitors.userId, ctx.user.id), eq(competitorMonitors.isActive, 1)))),
        db.select().from(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, workspaceId, and(eq(keywordMonitors.userId, ctx.user.id), eq(keywordMonitors.isActive, 1)))),
        getQualifiedMonitorProviderProfile(db, workspaceId, "competitor"),
        getQualifiedMonitorProviderProfile(db, workspaceId, "keyword"),
      ]);
      const targets = [
        ...competitors.map(monitor => ({ kind: "competitor" as const, monitorId: monitor.id, label: monitor.competitorAsin })),
        ...keywords.map(monitor => ({ kind: "keyword" as const, monitorId: monitor.id, label: monitor.keyword })),
      ];
      const results = [] as Array<{ kind: "competitor" | "keyword"; monitorId: number; success: boolean; error?: string }>;
      for (const target of targets) {
        if ((target.kind === "competitor" && !competitorProvider) || (target.kind === "keyword" && !keywordProvider)) {
          results.push({ ...target, success: false, error: "Provider尚未完成资格验证" });
          continue;
        }
        try {
          const existing = await getMonitorSchedule(db, workspaceId, target.kind, target.monitorId);
          let taskUid = existing?.heartbeatTaskUid || null;
          let nextExecutionAt: string | null | undefined;
          if (taskUid) {
            const updated = await updateHeartbeatJob(taskUid, { cron, path: "/api/scheduled/amazon-monitor", method: "POST", payload: {}, enable: true }, token);
            nextExecutionAt = updated.nextExecutionAt;
          } else {
            const created = await createHeartbeatJob({
              name: `amazon-monitor-${target.kind}-${target.monitorId}`,
              cron,
              path: "/api/scheduled/amazon-monitor",
              method: "POST",
              payload: {},
              description: `Amazon ${target.kind} monitor ${target.label}`,
            }, token);
            taskUid = created.taskUid;
            nextExecutionAt = created.nextExecutionAt;
          }
          await upsertMonitorSchedule({ db, workspaceId, kind: target.kind, monitorId: target.monitorId, ownerUserId: ctx.user.id, frequency: input.intervalHours >= 168 ? "weekly" : "daily", cronExpression: cron, heartbeatTaskUid: taskUid, status: "active", nextRunAt: parseNextRunAt(nextExecutionAt) });
          results.push({ kind: target.kind, monitorId: target.monitorId, success: true });
        } catch (error) {
          results.push({ kind: target.kind, monitorId: target.monitorId, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { success: results.some(item => item.success), runtime: "heartbeat" as const, total: results.length, activeCount: results.filter(item => item.success).length, results };
    }),

  stopScheduler: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb("Amazon monitor heartbeat pause");
    const workspaceId = currentOpsWorkspaceId();
    const token = sessionToken(ctx.req.headers.cookie);
    const [competitors, keywords] = await Promise.all([
      db.select({ id: competitorMonitors.id }).from(competitorMonitors).where(opsWorkspaceCondition(competitorMonitors, workspaceId, eq(competitorMonitors.userId, ctx.user.id))),
      db.select({ id: keywordMonitors.id }).from(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, workspaceId, eq(keywordMonitors.userId, ctx.user.id))),
    ]);
    let pausedCount = 0;
    for (const target of [
      ...competitors.map(item => ({ kind: "competitor" as const, monitorId: item.id })),
      ...keywords.map(item => ({ kind: "keyword" as const, monitorId: item.id })),
    ]) {
      const schedule = await getMonitorSchedule(db, workspaceId, target.kind, target.monitorId);
      if (!schedule?.heartbeatTaskUid) continue;
      await updateHeartbeatJob(schedule.heartbeatTaskUid, { enable: false }, token);
      await upsertMonitorSchedule({ db, workspaceId, kind: target.kind, monitorId: target.monitorId, ownerUserId: ctx.user.id, frequency: schedule.frequency, cronExpression: schedule.cronExpression, heartbeatTaskUid: schedule.heartbeatTaskUid, status: "paused", nextRunAt: null });
      pausedCount += 1;
    }
    return { success: true, runtime: "heartbeat" as const, pausedCount, message: "Heartbeat监控计划已暂停" };
  }),

  getMonitorRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => listMonitorRuns(await requireDb("Amazon monitor run history"), currentOpsWorkspaceId(), input?.limit || 50)),

  getCrawlHistory: protectedProcedure
    .input(z.object({ monitorId: z.number().int().positive(), type: z.enum(["competitor", "keyword"]), limit: z.number().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const db = await requireDb("Amazon monitor history");
      if (input.type === "competitor") {
        return db.select().from(competitorSnapshots).where(opsWorkspaceCondition(competitorSnapshots, currentOpsWorkspaceId(), eq(competitorSnapshots.monitorId, input.monitorId))).orderBy(desc(competitorSnapshots.snapshotDate)).limit(input.limit);
      }
      return db.select().from(keywordSnapshots).where(opsWorkspaceCondition(keywordSnapshots, currentOpsWorkspaceId(), eq(keywordSnapshots.keywordMonitorId, input.monitorId))).orderBy(desc(keywordSnapshots.snapshotDate)).limit(input.limit);
    }),
});
