import { TRPCError } from "@trpc/server";
import { parse as parseCookie } from "cookie";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { COOKIE_NAME } from "@shared/const";
import { listHeartbeatJobs, updateHeartbeatJob } from "../../../_core/heartbeat";
import { opsLingxingSyncSchedules } from "../../../../drizzle/schema";
import { getDb } from "../../../repositories/dbClient";
import { recordSecurityAuditLog } from "../../../services/securityGovernance";
import { rawExecute } from "../routerContext";

const systemTaskSql = "SELECT id, systemManaged, externalTaskUid, externalScheduleId, workspaceId, dataDomain, inputTemplate FROM emperor_scheduled_tasks WHERE slug = ? LIMIT 1";
const sixFieldCron = z.string().trim().max(64).refine((value) => {
  const parts = value.split(/\s+/);
  return parts.length === 6 && parts[0] === "0" && parts.every((part) => /^[0-9*/,-]+$/.test(part));
}, "Cron必须为6段UTC表达式，秒字段固定为0");
const anomalyThresholdSchema = z.object({
  multiplier: z.number().int().min(2).max(20),
  absoluteIncrease: z.number().int().min(100).max(10_000),
});
const jsonObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function getSystemTask(slug: string) {
  const rows = await rawExecute(systemTaskSql, [slug]);
  return rows[0] as { id: number; systemManaged: number; externalTaskUid: string | null; externalScheduleId: number | null; workspaceId: number | null; dataDomain: string | null; inputTemplate: unknown } | undefined;
}

export const emperorScheduledRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tasks = await rawExecute(
      `SELECT t.*,
        s.enabled AS linkedScheduleEnabled, s.last_status AS linkedLastStatus,
        s.last_run_at AS linkedLastRunAt, s.last_batch_id AS linkedLastBatchId,
        s.schedule_cron_task_uid AS linkedTaskUid
       FROM emperor_scheduled_tasks t
       LEFT JOIN ops_lingxing_sync_schedules s ON t.externalScheduleId = s.id
       WHERE t.systemManaged = 0 OR t.workspaceId = ?
       ORDER BY t.systemManaged DESC, t.name`,
      [ctx.user.defaultWorkspaceId ?? -1],
    );
    const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
    try {
      const heartbeat = await listHeartbeatJobs(sessionToken, { page: 1, pageSize: 100 });
      const jobByUid = new Map(heartbeat.jobs.map((job) => [job.taskUid, job]));
      return tasks.map((task: Record<string, unknown>) => {
        const job = jobByUid.get(String(task.externalTaskUid || task.linkedTaskUid || ""));
        return job ? {
          ...task,
          isActive: job.isEnable ? 1 : 0,
          nextRunAt: job.nextExecutionAt ?? task.nextRunAt,
          externalTaskUid: job.taskUid,
        } : task;
      });
    } catch {
      // 平台状态暂不可用时仍返回已持久化映射，管理入口不会因目录短暂失败消失。
      return tasks;
    }
  }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      skillSlug: z.string(),
      cronExpr: z.string().optional(),
      inputTemplate: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getSystemTask(input.slug);
      if (Number(existing?.systemManaged || 0) === 1) throw new TRPCError({ code: "FORBIDDEN", message: "受系统管理的领星任务只能通过暂停/恢复操作修改" });
      await rawExecute(
        `INSERT INTO emperor_scheduled_tasks (slug,name,description,skillSlug,cronExpr,inputTemplate,isActive,createdByUserId) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),skillSlug=VALUES(skillSlug),cronExpr=VALUES(cronExpr),inputTemplate=VALUES(inputTemplate),isActive=VALUES(isActive)`,
        [input.slug, input.name, input.description||null, input.skillSlug, input.cronExpr||null, input.inputTemplate ? JSON.stringify(input.inputTemplate) : null, input.isActive?1:0, ctx.user.id]
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await getSystemTask(input.slug);
      if (Number(existing?.systemManaged || 0) === 1) throw new TRPCError({ code: "FORBIDDEN", message: "受系统管理的领星任务不可删除，以防产生孤立外部触发器" });
      await rawExecute("DELETE FROM emperor_scheduled_tasks WHERE slug = ?", [input.slug]);
      return { success: true };
    }),

  setSystemTaskEnabled: adminProcedure
    .input(z.object({ slug: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const task = await getSystemTask(input.slug);
      if (!task || Number(task.systemManaged || 0) !== 1 || !task.externalTaskUid || !task.externalScheduleId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到受系统管理的领星定时任务" });
      }
      if (task.workspaceId !== ctx.user.defaultWorkspaceId) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const heartbeat = await updateHeartbeatJob(task.externalTaskUid, { enable: input.enabled }, sessionToken);
      await db.update(opsLingxingSyncSchedules).set({ enabled: input.enabled ? 1 : 0 })
        .where(eq(opsLingxingSyncSchedules.id, task.externalScheduleId));
      await rawExecute(
        "UPDATE emperor_scheduled_tasks SET isActive=?, nextRunAt=? WHERE id=? AND systemManaged=1",
        [input.enabled ? 1 : 0, heartbeat.nextExecutionAt ? new Date(heartbeat.nextExecutionAt) : null, task.id],
      );
      return { success: true, enabled: input.enabled, nextRunAt: heartbeat.nextExecutionAt ?? null, externalTaskUid: task.externalTaskUid };
    }),

  updateSystemTask: adminProcedure
    .input(z.object({
      slug: z.string().min(1).max(128),
      name: z.string().trim().min(2).max(100),
      cronExpr: sixFieldCron,
      isActive: z.boolean(),
      autoApply: z.boolean(),
      anomalyThreshold: anomalyThresholdSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const task = await getSystemTask(input.slug);
      if (!task || Number(task.systemManaged || 0) !== 1 || !task.externalTaskUid || !task.externalScheduleId || !task.dataDomain) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到受系统管理的领星定时任务" });
      }
      if (task.workspaceId !== ctx.user.defaultWorkspaceId) throw new TRPCError({ code: "FORBIDDEN" });
      if (task.dataDomain === "parent_asin_weekly_rollup" && input.autoApply) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "父ASIN周汇总仅生成草稿，不允许开启自动应用" });
      }
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const description = `${input.name}；由皇帝中台统一管理的领星官方MCP任务。${input.autoApply ? "完整性与异常校验通过后自动应用历史事实，异常转人工复核。" : "仅生成待审核草稿，不自动写入业务事实。"}`;
      const heartbeat = await updateHeartbeatJob(task.externalTaskUid, { cron: input.cronExpr, enable: input.isActive, description }, sessionToken);
      await db.update(opsLingxingSyncSchedules).set({
        cronExpression: input.cronExpr,
        enabled: input.isActive ? 1 : 0,
        autoApply: input.autoApply ? 1 : 0,
      }).where(eq(opsLingxingSyncSchedules.id, task.externalScheduleId));
      const template = jsonObject(task.inputTemplate);
      const inputTemplate = { ...template, dataDomain: task.dataDomain, externalTaskUid: task.externalTaskUid, scheduleId: task.externalScheduleId, anomalyThreshold: input.anomalyThreshold };
      await rawExecute(
        "UPDATE emperor_scheduled_tasks SET name=?, description=?, cronExpr=?, inputTemplate=?, isActive=?, nextRunAt=? WHERE id=? AND systemManaged=1",
        [input.name, description, input.cronExpr, JSON.stringify(inputTemplate), input.isActive ? 1 : 0, heartbeat.nextExecutionAt ? new Date(heartbeat.nextExecutionAt) : null, task.id],
      );
      await recordSecurityAuditLog({
        ctx, workspaceId: task.workspaceId, action: "emperor.scheduled_task.update", resourceType: "emperor_scheduled_task", resourceId: input.slug,
        status: "success", riskLevel: "medium", reason: `领星系统任务运营级编辑：${task.dataDomain}`,
        metadata: { dataDomain: task.dataDomain, autoApply: input.autoApply, anomalyThreshold: input.anomalyThreshold, externalTaskUid: task.externalTaskUid },
      });
      return { success: true, name: input.name, cronExpr: input.cronExpr, enabled: input.isActive, autoApply: input.autoApply, anomalyThreshold: input.anomalyThreshold, nextRunAt: heartbeat.nextExecutionAt ?? null };
    }),

  trigger: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_scheduled_tasks WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (Number(rows[0].systemManaged || 0) === 1) {
        throw new TRPCError({ code: "FORBIDDEN", message: "领星同步仅可按受治理计划触发；请在同步页面查看批次和Trace。" });
      }
      await rawExecute("UPDATE emperor_scheduled_tasks SET lastRunAt = NOW(), runCount = runCount + 1 WHERE slug = ?", [input.slug]);
      return { success: true, message: `Task '${rows[0].name}' triggered` };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Gateway Router
// ─────────────────────────────────────────────────────────────────────────────
