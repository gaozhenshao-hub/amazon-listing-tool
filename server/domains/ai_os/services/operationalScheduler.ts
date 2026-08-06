import { randomUUID } from "node:crypto";
import { notifyOwner } from "../../../_core/notification";
import {
  listOperationalAlerts,
  markOperationalAlertNotified,
  resolveInactiveOperationalAlerts,
  upsertOperationalAlert,
} from "../../../repositories/ai_os";
import {
  listDataLifecyclePolicies,
  runDataLifecycleArchive,
} from "./artifactLifecycle";
import {
  buildDatabaseObservabilitySection,
  buildWorkerQueueHealth,
  recordAiOsMetric,
} from "./observability";

export type OperationalAlertCandidate = {
  fingerprint: string;
  category: "worker" | "failed_job" | "archive";
  severity: "warning" | "critical";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

type WorkerHealthInput = Awaited<ReturnType<typeof buildWorkerQueueHealth>>;
type ArchiveHealthInput = Awaited<ReturnType<typeof buildDatabaseObservabilitySection>>["archiveHealth"];

export function deriveOperationalAlerts(input: {
  worker: WorkerHealthInput;
  archive: ArchiveHealthInput;
  now?: Date;
  requireWorker?: boolean;
  failedJobThreshold?: number;
}): OperationalAlertCandidate[] {
  const now = input.now || new Date();
  const candidates: OperationalAlertCandidate[] = [];
  const requireWorker = input.requireWorker ?? true;
  if (requireWorker && input.worker.healthyCount === 0) {
    candidates.push({
      fingerprint: "worker:no-healthy-worker",
      category: "worker",
      severity: "critical",
      title: "AI Worker 不可用",
      message: "没有检测到健康的 AI Worker，请检查 Worker 进程、数据库连接和心跳配置。",
      metadata: { staleCount: input.worker.staleCount, workerCount: input.worker.workers.length },
    });
  } else if (input.worker.staleCount > 0) {
    candidates.push({
      fingerprint: "worker:stale-heartbeat",
      category: "worker",
      severity: "warning",
      title: "AI Worker 心跳过期",
      message: `检测到 ${input.worker.staleCount} 个 Worker 心跳过期，请检查进程健康状态。`,
      metadata: { staleCount: input.worker.staleCount },
    });
  }

  const recentCutoff = now.getTime() - 60 * 60_000;
  const recentDeadLetters = input.worker.deadLetters.filter((item) => {
    const timestamp = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return timestamp >= recentCutoff;
  });
  const failedThreshold = Math.max(input.failedJobThreshold || 1, 1);
  if (recentDeadLetters.length >= failedThreshold) {
    candidates.push({
      fingerprint: "failed_job:recent-dead-letters",
      category: "failed_job",
      severity: recentDeadLetters.length >= 5 ? "critical" : "warning",
      title: "AI Job 出现不可恢复失败",
      message: `最近一小时有 ${recentDeadLetters.length} 个 Job 进入死信队列，请在 Job 历史中查看并恢复。`,
      metadata: { count: recentDeadLetters.length },
    });
  }

  const recentArchiveFailure = input.archive.latestRuns.find((item) => {
    const timestamp = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return item.status === "failed" && timestamp >= now.getTime() - 24 * 60 * 60_000;
  });
  if (recentArchiveFailure) {
    candidates.push({
      fingerprint: "archive:recent-failure",
      category: "archive",
      severity: "critical",
      title: "数据归档任务失败",
      message: `归档策略 ${recentArchiveFailure.policySlug} 执行失败，请检查数据库权限和归档运行记录。`,
      metadata: { policySlug: recentArchiveFailure.policySlug, error: recentArchiveFailure.errorMessage },
    });
  }
  return candidates;
}

async function persistAndNotify(candidates: OperationalAlertCandidate[]) {
  const cooldownMs = Math.min(
    Math.max(Number(process.env.AI_OS_ALERT_COOLDOWN_MS || 6 * 60 * 60_000), 60_000),
    7 * 24 * 60 * 60_000,
  );
  for (const candidate of candidates) {
    const row = await upsertOperationalAlert({
      alertId: `alert_${randomUUID()}`,
      ...candidate,
    });
    const notifiedAt = row?.notifiedAt ? new Date(row.notifiedAt).getTime() : 0;
    if (notifiedAt && Date.now() - notifiedAt < cooldownMs) continue;
    try {
      await notifyOwner({ title: candidate.title, content: candidate.message });
      await markOperationalAlertNotified(candidate.fingerprint);
    } catch (error) {
      console.warn(`[AI OS Alert] ${candidate.title}:`, error);
    }
    void recordAiOsMetric({
      entityType: "job",
      entityId: candidate.fingerprint,
      metricName: "operations.alert",
      metricValue: 1,
      status: candidate.severity,
      metadata: candidate,
    });
  }
  await resolveInactiveOperationalAlerts(candidates.map((item) => item.fingerprint));
}

export async function runAiOsOperationalHealthCheck() {
  const [worker, database] = await Promise.all([
    buildWorkerQueueHealth(1),
    buildDatabaseObservabilitySection(1),
  ]);
  const requireWorker = process.env.REQUIRE_AI_JOB_WORKER !== "false"
    && process.env.NODE_ENV === "production";
  const candidates = deriveOperationalAlerts({
    worker,
    archive: database.archiveHealth,
    requireWorker,
    failedJobThreshold: Number(process.env.AI_OS_FAILED_JOB_ALERT_THRESHOLD || 1),
  });
  await persistAndNotify(candidates);
  return { checkedAt: new Date().toISOString(), candidates, worker, archive: database.archiveHealth };
}

export async function runScheduledDataLifecycleSweep() {
  const batchSize = Math.min(Math.max(Number(process.env.DATA_LIFECYCLE_BATCH_SIZE || 1000), 1), 5000);
  const results: Array<{ policySlug: string; ok: boolean; result?: unknown; error?: string }> = [];
  for (const policy of listDataLifecyclePolicies()) {
    try {
      const result = await runDataLifecycleArchive({ policySlug: policy.slug, mode: "archive", batchSize });
      results.push({ policySlug: policy.slug, ok: true, result });
    } catch (error) {
      results.push({ policySlug: policy.slug, ok: false, error: String((error as Error)?.message || error) });
    }
  }
  return {
    completedAt: new Date().toISOString(),
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

export async function listAiOsOperationalAlerts(input: { status?: "open" | "resolved"; limit?: number } = {}) {
  return listOperationalAlerts(input);
}

export function startAiOsOperationalScheduler() {
  const healthIntervalMs = Math.min(
    Math.max(Number(process.env.AI_OS_HEALTH_CHECK_INTERVAL_MS || 5 * 60_000), 60_000),
    24 * 60 * 60_000,
  );
  const archiveIntervalMs = Math.min(
    Math.max(Number(process.env.DATA_LIFECYCLE_SWEEP_INTERVAL_MS || 24 * 60 * 60_000), 60 * 60_000),
    7 * 24 * 60 * 60_000,
  );
  const healthTimer = setInterval(() => void runAiOsOperationalHealthCheck().catch((error) => {
    console.error("[AI OS] operational health check failed:", error);
  }), healthIntervalMs);
  const archiveTimer = setInterval(() => void runScheduledDataLifecycleSweep().catch((error) => {
    console.error("[AI OS] lifecycle sweep failed:", error);
  }), archiveIntervalMs);
  const initialHealth = setTimeout(() => void runAiOsOperationalHealthCheck().catch(() => undefined), 30_000);
  const initialArchive = setTimeout(() => void runScheduledDataLifecycleSweep().catch(() => undefined), 60_000);
  for (const timer of [healthTimer, archiveTimer, initialHealth, initialArchive]) (timer as any).unref?.();
  return () => {
    clearInterval(healthTimer);
    clearInterval(archiveTimer);
    clearTimeout(initialHealth);
    clearTimeout(initialArchive);
  };
}
