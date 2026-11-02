import type { Request, Response } from "express";
import { sdk } from "../../_core/sdk";
import { requireDb } from "../../repositories/dbClient";
import { startAmazonMonitorJob } from "./monitorJob";
import {
  getMonitorScheduleByTaskUid,
  loadMonitorTarget,
  markMonitorScheduleError,
  markMonitorScheduleQueued,
} from "./monitorRepository";

function executionBucket(frequency: "manual" | "daily" | "weekly", now: Date) {
  if (frequency === "weekly") {
    const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return now.toISOString().slice(0, 10);
}

export async function amazonMonitorHeartbeatHandler(req: Request, res: Response) {
  let taskUid = "unknown";
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    taskUid = user.taskUid;
    const db = await requireDb("Amazon monitor heartbeat");
    const schedule = await getMonitorScheduleByTaskUid(db, taskUid);
    if (!schedule) return res.json({ ok: true, skipped: "orphan" });
    if (schedule.status !== "active") return res.json({ ok: true, skipped: schedule.status });
    const target = await loadMonitorTarget(db, schedule.workspaceId, schedule.monitorKind, schedule.monitorId);
    if (!target || !target.active || target.ownerUserId !== schedule.ownerUserId) {
      await markMonitorScheduleError({ db, scheduleId: schedule.id, error: "监控目标不存在、未启用或所有者不一致" });
      return res.status(409).json({ error: "monitor target unavailable", taskUid });
    }
    const result = await startAmazonMonitorJob({
      workspaceId: schedule.workspaceId,
      userId: schedule.ownerUserId,
      kind: schedule.monitorKind,
      monitorId: schedule.monitorId,
      triggerType: "schedule",
      idempotencyKey: `heartbeat-${taskUid}-${executionBucket(schedule.frequency, new Date())}`,
    });
    await markMonitorScheduleQueued({ db, scheduleId: schedule.id, runId: result.monitorRunId });
    return res.json({ ok: true, queued: true, monitorRunId: result.monitorRunId, reused: result.reused });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(/资格验证|not qualified|not configured/i.test(message) ? 409 : 500).json({
      error: message,
      context: { url: req.originalUrl, taskUid },
      timestamp: new Date().toISOString(),
    });
  }
}
