import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";
import {
  auditDatabasePerformanceBaselines,
  collectCoreTableRowCounts,
  getMigrationRegressionBaseline,
  type CoreTableRowCountResult,
  type DatabaseExplainAuditResult,
} from "../../../repositories/dbGovernance";
import {
  listDatabaseSlowQuerySamples,
  sampleDatabaseSlowQueries,
} from "../../../repositories/database";

const METRIC_STORE_RETRY_MS = 60_000;
let aiOsMetricStoreUnavailableUntil = 0;

async function rawExecute(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  if (params.length === 0) {
    const result: any = await db.execute(drizzleSql.raw(sqlStr));
    return Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  }
  const parts = sqlStr.split("?");
  const chunks: any[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    chunks.push(drizzleSql.raw(parts[i]));
    if (i < params.length) chunks.push(drizzleSql`${params[i]}`);
  }
  const result: any = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson(value: unknown, fallback: unknown = null): unknown {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function numeric(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function boundedDays(value: unknown): number {
  const days = Math.floor(numeric(value, 30));
  return Math.min(Math.max(days, 1), 365);
}

function generateEvaluationId(): string {
  return `eval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isMissingDatabase(error: unknown): boolean {
  return error instanceof TRPCError
    && error.code === "INTERNAL_SERVER_ERROR"
    && /Database not available/i.test(error.message);
}

function shouldAttemptMetricStore(): boolean {
  return Date.now() >= aiOsMetricStoreUnavailableUntil;
}

function markMetricStoreUnavailable(error: unknown) {
  aiOsMetricStoreUnavailableUntil = Date.now() + METRIC_STORE_RETRY_MS;
  if (!isMissingDatabase(error)) console.warn("[AI OS Metrics] Metric store temporarily unavailable:", error);
}

export async function recordAiOsMetric(input: {
  entityType: "job" | "agent_run" | "agent_node" | "skill" | "tool" | "database";
  entityId: string;
  metricName: string;
  metricValue?: number | null;
  status?: string | null;
  workspaceId?: number | null;
  userId?: number | null;
  projectId?: number | null;
  agentSlug?: string | null;
  nodeId?: string | null;
  skillSlug?: string | null;
  toolSlug?: string | null;
  metadata?: unknown;
}) {
  if (!shouldAttemptMetricStore()) return { recorded: false };
  try {
    await rawExecute(
      `INSERT INTO emperor_ai_os_metrics
       (workspaceId,entityType,entityId,metricName,metricValue,status,userId,projectId,agentSlug,nodeId,skillSlug,toolSlug,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.workspaceId ?? null,
        input.entityType,
        input.entityId,
        input.metricName,
        input.metricValue ?? null,
        input.status || null,
        input.userId ?? null,
        input.projectId ?? null,
        input.agentSlug || null,
        input.nodeId || null,
        input.skillSlug || null,
        input.toolSlug || null,
        stringifyJson(input.metadata ?? {}),
      ],
    );
    return { recorded: true };
  } catch (error) {
    markMetricStoreUnavailable(error);
    return { recorded: false };
  }
}

function gradeQualityScore(score: number): string {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "weak";
  return "poor";
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function isStructuredOutput(value: unknown): boolean {
  if (value && typeof value === "object") return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function scoreAiOutputQuality(input: {
  output: unknown;
  status?: string | null;
  expectedKeys?: string[];
  retryCount?: number | null;
  fallbackCount?: number | null;
  humanEditRate?: number | null;
}) {
  const text = outputText(input.output).trim();
  const checks: Array<{ key: string; pass: boolean; points: number; message: string }> = [];
  let score = 50;

  const addCheck = (key: string, pass: boolean, points: number, message: string) => {
    checks.push({ key, pass, points: pass ? points : 0, message });
    if (pass) score += points;
  };

  addCheck("non_empty", text.length > 0 && text !== "null" && text !== "undefined", 15, "输出不为空");
  addCheck("useful_length", text.length >= 80, 10, "输出长度足够支撑人工评审");
  addCheck("structured", isStructuredOutput(input.output), 15, "输出具备结构化形态");
  addCheck("not_error_like", !/(error|exception|traceback|undefined|null result|failed)/i.test(text.slice(0, 500)), 10, "输出不像错误栈或失败占位");

  const expectedKeys = (input.expectedKeys || []).filter(Boolean);
  if (expectedKeys.length > 0) {
    const record = input.output && typeof input.output === "object" && !Array.isArray(input.output)
      ? input.output as Record<string, unknown>
      : {};
    const present = expectedKeys.filter((key) => record[key] !== undefined && record[key] !== null);
    const coverage = present.length / expectedKeys.length;
    const points = Math.round(coverage * 20);
    score += points;
    checks.push({
      key: "expected_keys",
      pass: coverage >= 0.8,
      points,
      message: `关键字段覆盖 ${present.length}/${expectedKeys.length}`,
    });
  }

  const retryCount = Math.max(numeric(input.retryCount, 0), numeric(input.fallbackCount, 0));
  if (retryCount > 0) score -= Math.min(retryCount * 5, 15);
  const humanEditRate = input.humanEditRate === undefined || input.humanEditRate === null ? null : Math.min(Math.max(numeric(input.humanEditRate), 0), 1);
  if (humanEditRate !== null) score -= Math.round(humanEditRate * 20);
  if (input.status && !["succeeded", "completed", "confirmed"].includes(input.status)) score = Math.min(score, 35);

  const boundedScore = Math.min(Math.max(Math.round(score), 0), 100);
  return {
    score: boundedScore,
    grade: gradeQualityScore(boundedScore),
    rubric: {
      version: "heuristic.v1",
      dimensions: ["non_empty", "useful_length", "structured", "not_error_like", "expected_keys", "retry_penalty", "human_edit_penalty"],
    },
    details: {
      checks,
      textLength: text.length,
      retryCount,
      humanEditRate,
    },
  };
}

export async function recordAiOsEvaluation(input: {
  entityType: "skill" | "agent_run" | "agent_node" | "job" | "tool" | "artifact";
  entityId: string;
  output?: unknown;
  status?: string | null;
  score?: number | null;
  grade?: string | null;
  evaluationType?: string;
  evaluator?: string;
  expectedKeys?: string[];
  retryCount?: number | null;
  fallbackCount?: number | null;
  humanEditRate?: number | null;
  workspaceId?: number | null;
  userId?: number | null;
  projectId?: number | null;
  agentSlug?: string | null;
  nodeId?: string | null;
  skillSlug?: string | null;
  toolSlug?: string | null;
  metadata?: unknown;
}) {
  if (!shouldAttemptMetricStore()) return { recorded: false };
  const computed = input.score === undefined || input.score === null
    ? scoreAiOutputQuality({
      output: input.output,
      status: input.status,
      expectedKeys: input.expectedKeys,
      retryCount: input.retryCount,
      fallbackCount: input.fallbackCount,
      humanEditRate: input.humanEditRate,
    })
    : {
      score: Math.min(Math.max(Math.round(input.score), 0), 100),
      grade: input.grade || gradeQualityScore(Number(input.score)),
      rubric: { version: "external.v1" },
      details: input.metadata || {},
    };

  const evaluationId = generateEvaluationId();
  try {
    await rawExecute(
      `INSERT INTO emperor_ai_os_evaluations
       (workspaceId,evaluationId,entityType,entityId,evaluationType,score,grade,status,evaluator,userId,projectId,agentSlug,nodeId,skillSlug,toolSlug,rubric,details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.workspaceId ?? null,
        evaluationId,
        input.entityType,
        input.entityId,
        input.evaluationType || "heuristic_quality",
        computed.score,
        computed.grade,
        input.status || null,
        input.evaluator || "system.heuristic",
        input.userId ?? null,
        input.projectId ?? null,
        input.agentSlug || null,
        input.nodeId || null,
        input.skillSlug || null,
        input.toolSlug || null,
        stringifyJson(computed.rubric),
        stringifyJson({ ...computed.details, metadata: input.metadata || null }),
      ],
    );
    void recordAiOsMetric({
      entityType: input.entityType === "artifact" ? "agent_node" : input.entityType,
      entityId: input.entityId,
      metricName: `${input.entityType}.quality_score`,
      metricValue: computed.score,
      status: input.status || null,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      agentSlug: input.agentSlug || null,
      nodeId: input.nodeId || null,
      skillSlug: input.skillSlug || null,
      toolSlug: input.toolSlug || null,
      metadata: { evaluationId, grade: computed.grade, evaluationType: input.evaluationType || "heuristic_quality" },
    });
    return { recorded: true, evaluationId, ...computed };
  } catch (error) {
    markMetricStoreUnavailable(error);
    return { recorded: false, ...computed };
  }
}

export async function listAiOsMetrics(input: {
  entityType?: string;
  entityId?: string;
  metricName?: string;
  limit?: number;
} = {}) {
  if (!shouldAttemptMetricStore()) return [];
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.entityType) {
    clauses.push("entityType=?");
    params.push(input.entityType);
  }
  if (input.entityId) {
    clauses.push("entityId=?");
    params.push(input.entityId);
  }
  if (input.metricName) {
    clauses.push("metricName=?");
    params.push(input.metricName);
  }
  params.push(Math.min(Math.max(input.limit || 100, 1), 500));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    return await rawExecute(
      `SELECT * FROM emperor_ai_os_metrics ${where} ORDER BY createdAt DESC LIMIT ?`,
      params,
    );
  } catch (error) {
    markMetricStoreUnavailable(error);
    return [];
  }
}

export async function listAiOsEvaluations(input: {
  entityType?: string;
  entityId?: string;
  agentSlug?: string;
  skillSlug?: string;
  limit?: number;
} = {}) {
  if (!shouldAttemptMetricStore()) return [];
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.entityType) {
    clauses.push("entityType=?");
    params.push(input.entityType);
  }
  if (input.entityId) {
    clauses.push("entityId=?");
    params.push(input.entityId);
  }
  if (input.agentSlug) {
    clauses.push("agentSlug=?");
    params.push(input.agentSlug);
  }
  if (input.skillSlug) {
    clauses.push("skillSlug=?");
    params.push(input.skillSlug);
  }
  params.push(Math.min(Math.max(input.limit || 100, 1), 500));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const rows = await rawExecute(
      `SELECT * FROM emperor_ai_os_evaluations ${where} ORDER BY createdAt DESC LIMIT ?`,
      params,
    );
    return rows.map((row) => ({
      ...row,
      score: numeric(row.score),
      rubric: parseJson(row.rubric, null),
      details: parseJson(row.details, null),
    }));
  } catch (error) {
    markMetricStoreUnavailable(error);
    return [];
  }
}

async function queryRows(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  if (!shouldAttemptMetricStore()) return [];
  try {
    return await rawExecute(sqlStr, params);
  } catch (error) {
    markMetricStoreUnavailable(error);
    return [];
  }
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function firstRow(rows: any[]): Record<string, any> {
  return rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, any> : {};
}

function isDatabaseUnavailableLike(error: unknown): boolean {
  const message = String((error as Error)?.message || error || "");
  return /database not available|database not set|DATABASE_URL/i.test(message);
}

async function safeObservabilitySection<T>(
  label: string,
  fallback: T,
  producer: () => Promise<T>,
): Promise<T> {
  try {
    return await producer();
  } catch (error) {
    if (!isDatabaseUnavailableLike(error)) {
      console.warn(`[AI OS Observability] ${label} unavailable:`, error);
    }
    return fallback;
  }
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWorkerStaleAfterMs(): number {
  const configured = Number(process.env.AI_JOB_WORKER_STALE_MS || process.env.AI_JOB_HEARTBEAT_STALE_MS || 120_000);
  return Math.min(Math.max(Number.isFinite(configured) ? configured : 120_000, 15_000), 30 * 60_000);
}

export async function buildWorkerQueueHealth(days = 30) {
  const checkedAt = new Date();
  const staleAfterMs = getWorkerStaleAfterMs();
  const workerRows = await queryRows(
    `SELECT workerId, hostname, pid, role, status, concurrency, runningCount, lastHeartbeatAt, startedAt, stoppedAt, metadata, updatedAt
     FROM ai_job_workers
     ORDER BY lastHeartbeatAt DESC
     LIMIT 100`,
  );
  const queueRows = await queryRows(
    `SELECT status,
            queueName,
            COUNT(*) as jobCount,
            AVG(TIMESTAMPDIFF(SECOND, createdAt, NOW())) as avgAgeSeconds,
            MAX(TIMESTAMPDIFF(SECOND, createdAt, NOW())) as maxAgeSeconds,
            SUM(CASE WHEN status='running' AND leaseUntil IS NOT NULL AND leaseUntil < NOW() THEN 1 ELSE 0 END) as staleLeaseCount
     FROM ai_jobs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) OR status IN ('queued','running')
     GROUP BY status, queueName
     ORDER BY status ASC, queueName ASC`,
    [boundedDays(days)],
  );
  const deadLetterRows = await queryRows(
    `SELECT runId, kind, module, procedure, status, attempt, maxAttempts, userId, projectId, skillSlug, errorMessage, createdAt
     FROM ai_job_dead_letters
     ORDER BY createdAt DESC
     LIMIT 20`,
  );

  const workers = workerRows.map((row) => {
    const lastHeartbeatAt = asDate(row.lastHeartbeatAt);
    const heartbeatAgeMs = lastHeartbeatAt ? checkedAt.getTime() - lastHeartbeatAt.getTime() : null;
    const status = String(row.status || "unknown");
    const stale = heartbeatAgeMs === null || heartbeatAgeMs > staleAfterMs;
    const effectiveStatus = stale && status === "active" ? "unhealthy" : status;
    return {
      workerId: String(row.workerId || ""),
      hostname: row.hostname || null,
      pid: row.pid ?? null,
      role: String(row.role || "worker"),
      status,
      effectiveStatus,
      concurrency: numeric(row.concurrency, 1),
      runningCount: numeric(row.runningCount),
      lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
      heartbeatAgeMs,
      stale,
      startedAt: asDate(row.startedAt)?.toISOString() || null,
      stoppedAt: asDate(row.stoppedAt)?.toISOString() || null,
      metadata: parseJson(row.metadata, {}),
      updatedAt: asDate(row.updatedAt)?.toISOString() || null,
    };
  });

  const healthyCount = workers.filter((worker) => worker.effectiveStatus === "active").length;
  const unhealthyCount = workers.filter((worker) => worker.effectiveStatus === "unhealthy").length;
  const staleCount = workers.filter((worker) => worker.stale).length;
  return {
    checkedAt: checkedAt.toISOString(),
    staleAfterMs,
    healthyCount,
    unhealthyCount,
    staleCount,
    drainingCount: workers.filter((worker) => worker.effectiveStatus === "draining").length,
    stoppedCount: workers.filter((worker) => worker.effectiveStatus === "stopped").length,
    queue: queueRows.map((row) => ({
      status: String(row.status || "unknown"),
      queueName: String(row.queueName || "default"),
      jobCount: numeric(row.jobCount),
      avgAgeSeconds: Math.round(numeric(row.avgAgeSeconds)),
      maxAgeSeconds: Math.round(numeric(row.maxAgeSeconds)),
      staleLeaseCount: numeric(row.staleLeaseCount),
    })),
    deadLetters: deadLetterRows.map((row) => ({
      runId: String(row.runId || ""),
      kind: String(row.kind || ""),
      module: String(row.module || ""),
      procedure: row.procedure || null,
      status: String(row.status || ""),
      attempt: numeric(row.attempt),
      maxAttempts: numeric(row.maxAttempts, 1),
      userId: row.userId ?? null,
      projectId: row.projectId ?? null,
      skillSlug: row.skillSlug || null,
      errorMessage: row.errorMessage || null,
      createdAt: asDate(row.createdAt)?.toISOString() || null,
    })),
    workers,
  };
}

async function buildArchiveHealth(days: number) {
  const rows = await queryRows(
    `SELECT COUNT(*) as totalRuns,
            SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) as succeededRuns,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedRuns,
            SUM(CASE WHEN status='dry_run' THEN 1 ELSE 0 END) as dryRunCount,
            SUM(candidateCount) as candidateCount,
            SUM(archivedCount) as archivedCount,
            SUM(deletedCount) as deletedCount,
            AVG(CASE WHEN startedAt IS NOT NULL AND completedAt IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, startedAt, completedAt) / 1000 ELSE NULL END) as avgDurationMs
     FROM ai_data_archive_runs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const latestRows = await queryRows(
    `SELECT archiveRunId, policySlug, tableName, status, mode, candidateCount, archivedCount, deletedCount, errorMessage, createdAt, completedAt
     FROM ai_data_archive_runs
     ORDER BY createdAt DESC
     LIMIT 20`,
  );
  const archive = firstRow(rows);
  const totalRuns = numeric(archive.totalRuns);
  const terminalRuns = numeric(archive.succeededRuns) + numeric(archive.failedRuns);
  return {
    totalRuns,
    succeededRuns: numeric(archive.succeededRuns),
    failedRuns: numeric(archive.failedRuns),
    dryRunCount: numeric(archive.dryRunCount),
    successRate: percentage(numeric(archive.succeededRuns), terminalRuns),
    candidateCount: numeric(archive.candidateCount),
    archivedCount: numeric(archive.archivedCount),
    deletedCount: numeric(archive.deletedCount),
    avgDurationMs: Math.round(numeric(archive.avgDurationMs)),
    latestRuns: latestRows.map((row) => ({
      archiveRunId: String(row.archiveRunId || ""),
      policySlug: String(row.policySlug || ""),
      tableName: String(row.tableName || ""),
      status: String(row.status || ""),
      mode: String(row.mode || ""),
      candidateCount: numeric(row.candidateCount),
      archivedCount: numeric(row.archivedCount),
      deletedCount: numeric(row.deletedCount),
      errorMessage: row.errorMessage || null,
      createdAt: asDate(row.createdAt)?.toISOString() || null,
      completedAt: asDate(row.completedAt)?.toISOString() || null,
    })),
  };
}

async function buildRowCountTrends(days: number) {
  const rows = await queryRows(
    `SELECT entityId as tableName,
            DATE(createdAt) as sampleDate,
            MAX(metricValue) as rowCount
     FROM emperor_ai_os_metrics
     WHERE entityType='database'
       AND metricName='db.table.row_count'
       AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY entityId, DATE(createdAt)
     ORDER BY sampleDate ASC, entityId ASC`,
    [days],
  );
  return rows.map((row) => ({
    tableName: String(row.tableName || ""),
    sampleDate: String(row.sampleDate || ""),
    rowCount: numeric(row.rowCount),
  }));
}

export async function buildDatabaseObservabilitySection(days = 30) {
  const bounded = boundedDays(days);
  const rowCounts = await safeObservabilitySection<CoreTableRowCountResult[]>(
    "row count baseline",
    [],
    () => collectCoreTableRowCounts(),
  );
  const explainAudits = await safeObservabilitySection<DatabaseExplainAuditResult[]>(
    "EXPLAIN baseline",
    [],
    () => auditDatabasePerformanceBaselines(),
  );
  const archiveHealth = await buildArchiveHealth(bounded);
  const rowCountTrends = await buildRowCountTrends(bounded);
  const slowQueries = await safeObservabilitySection<any[]>(
    "slow query samples",
    [],
    () => listDatabaseSlowQuerySamples({ days: bounded, limit: 100 }),
  );
  const failedExplainCount = explainAudits.filter((item) => !item.usesExpectedIndex).length;

  return {
    rowCounts,
    rowCountTrends,
    explainAudits: explainAudits.map((item) => ({
      ...item,
      explainRows: item.explainRows.slice(0, 8),
    })),
    explainSummary: {
      totalChecks: explainAudits.length,
      passedChecks: explainAudits.length - failedExplainCount,
      failedChecks: failedExplainCount,
      passRate: percentage(explainAudits.length - failedExplainCount, explainAudits.length),
    },
    archiveHealth,
    slowQueries,
    migrationRegression: getMigrationRegressionBaseline(),
  };
}

export async function recordDatabaseBaselineSnapshot(input: {
  workspaceId?: number | null;
  userId?: number | null;
} = {}) {
  const [rowCounts, explainAudits, slowQuerySampling] = await Promise.all([
    collectCoreTableRowCounts(),
    auditDatabasePerformanceBaselines(),
    sampleDatabaseSlowQueries(),
  ]);

  for (const item of rowCounts) {
    await recordAiOsMetric({
      entityType: "database",
      entityId: item.table,
      metricName: "db.table.row_count",
      metricValue: item.rowCount,
      status: "ok",
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      metadata: {
        domain: item.domain,
        purpose: item.purpose,
        highGrowth: item.highGrowth,
        checkedAt: item.checkedAt,
      },
    });
  }

  for (const item of explainAudits) {
    await recordAiOsMetric({
      entityType: "database",
      entityId: item.slug,
      metricName: "db.explain.expected_index",
      metricValue: item.usesExpectedIndex ? 1 : 0,
      status: item.usesExpectedIndex ? "ok" : "warning",
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      metadata: {
        domain: item.domain,
        table: item.table,
        purpose: item.purpose,
        expectedIndexNames: item.expectedIndexNames,
        observedKeys: item.observedKeys,
        possibleKeys: item.possibleKeys,
        checkedAt: item.checkedAt,
      },
    });
  }

  return {
    recordedAt: new Date().toISOString(),
    rowCountSamples: rowCounts.length,
    explainSamples: explainAudits.length,
    failedExplainChecks: explainAudits.filter((item) => !item.usesExpectedIndex).length,
    slowQuerySampling,
  };
}

export { sampleDatabaseSlowQueries };

export async function buildAiOsObservabilityDashboard(input: {
  days?: number;
  agentSlug?: string;
} = {}) {
  const days = boundedDays(input.days);
  const agentFilter = input.agentSlug ? " AND agentSlug=?" : "";
  const agentParams = input.agentSlug ? [days, input.agentSlug] : [days];
  const skillRows = await queryRows(
    `SELECT COUNT(*) as totalRuns,
            SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) as succeededRuns,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedRuns,
            AVG(durationMs) as avgDurationMs,
            SUM(inputTokens) as inputTokens,
            SUM(outputTokens) as outputTokens,
            SUM(costCents) as costCents
     FROM emperor_skill_runs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const agentRows = await queryRows(
    `SELECT COUNT(*) as totalRuns,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completedRuns,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedRuns,
            SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) as canceledRuns,
            AVG(CASE WHEN startedAt IS NOT NULL AND completedAt IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, startedAt, completedAt) / 1000 ELSE NULL END) as avgDurationMs
     FROM emperor_agent_runs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)${agentFilter}`,
    agentParams,
  );
  const checkpointRows = await queryRows(
    `SELECT COUNT(*) as totalNodes,
            SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) as confirmedNodes,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedNodes,
            SUM(CASE WHEN status='waiting_human' THEN 1 ELSE 0 END) as waitingHumanNodes,
            SUM(CASE WHEN userEdit IS NOT NULL THEN 1 ELSE 0 END) as humanEditedNodes,
            SUM(retryCount) as retryCount,
            AVG(CASE WHEN startedAt IS NOT NULL AND completedAt IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, startedAt, completedAt) / 1000 ELSE NULL END) as avgDurationMs
     FROM emperor_agent_checkpoints
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)${agentFilter}`,
    agentParams,
  );
  const jobRows = await queryRows(
    `SELECT COUNT(*) as totalJobs,
            SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) as succeededJobs,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedJobs,
            SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) as canceledJobs,
            SUM(attempt) as attemptCount,
            AVG(CASE WHEN startedAt IS NOT NULL AND completedAt IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, startedAt, completedAt) / 1000 ELSE NULL END) as avgDurationMs
     FROM ai_jobs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const evaluationRows = await queryRows(
    `SELECT entityType,
            COUNT(*) as evaluationCount,
            AVG(score) as avgScore,
            MIN(score) as minScore,
            SUM(CASE WHEN score < 60 THEN 1 ELSE 0 END) as lowScoreCount
     FROM emperor_ai_os_evaluations
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)${agentFilter}
     GROUP BY entityType
     ORDER BY entityType ASC`,
    agentParams,
  );
  const metricRows = await queryRows(
    `SELECT metricName,
            COUNT(*) as sampleCount,
            AVG(metricValue) as avgValue,
            SUM(metricValue) as sumValue
     FROM emperor_ai_os_metrics
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)${agentFilter}
     GROUP BY metricName
     ORDER BY sampleCount DESC
     LIMIT 50`,
    agentParams,
  );
  const toolFailureRows = await queryRows(
    `SELECT failureKind, COUNT(*) as count
     FROM emperor_tool_runs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) AND failureKind IS NOT NULL
     GROUP BY failureKind
     ORDER BY count DESC`,
    [days],
  );
  const toolRows = await queryRows(
    `SELECT COUNT(*) as totalRuns,
            SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) as succeededRuns,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failedRuns,
            SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) as blockedRuns,
            SUM(CASE WHEN retryable=1 THEN 1 ELSE 0 END) as retryableRuns,
            SUM(attemptCount) as attemptCount,
            AVG(durationMs) as avgDurationMs
     FROM emperor_tool_runs
     WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );

  const skill = firstRow(skillRows);
  const agent = firstRow(agentRows);
  const checkpoint = firstRow(checkpointRows);
  const job = firstRow(jobRows);
  const tool = firstRow(toolRows);
  const totalSkillRuns = numeric(skill.totalRuns);
  const totalAgentRuns = numeric(agent.totalRuns);
  const totalNodes = numeric(checkpoint.totalNodes);
  const totalJobs = numeric(job.totalJobs);
  const totalToolRuns = numeric(tool.totalRuns);
  const totalQualitySamples = evaluationRows.reduce((sum, row) => sum + numeric(row.evaluationCount), 0);
  const weightedScore = evaluationRows.reduce((sum, row) => sum + numeric(row.avgScore) * numeric(row.evaluationCount), 0);
  const lowQualitySamples = evaluationRows.reduce((sum, row) => sum + numeric(row.lowScoreCount), 0);
  const workerQueue = await buildWorkerQueueHealth(days);
  const database = await buildDatabaseObservabilitySection(days);

  return {
    window: { days, agentSlug: input.agentSlug || null },
    summary: {
      skill: {
        totalRuns: totalSkillRuns,
        succeededRuns: numeric(skill.succeededRuns),
        failedRuns: numeric(skill.failedRuns),
        failureRate: percentage(numeric(skill.failedRuns), totalSkillRuns),
        avgDurationMs: Math.round(numeric(skill.avgDurationMs)),
        inputTokens: numeric(skill.inputTokens),
        outputTokens: numeric(skill.outputTokens),
        totalTokens: numeric(skill.inputTokens) + numeric(skill.outputTokens),
        costCents: numeric(skill.costCents),
      },
      agent: {
        totalRuns: totalAgentRuns,
        completedRuns: numeric(agent.completedRuns),
        failedRuns: numeric(agent.failedRuns),
        canceledRuns: numeric(agent.canceledRuns),
        failureRate: percentage(numeric(agent.failedRuns), totalAgentRuns),
        avgDurationMs: Math.round(numeric(agent.avgDurationMs)),
      },
      node: {
        totalNodes,
        confirmedNodes: numeric(checkpoint.confirmedNodes),
        failedNodes: numeric(checkpoint.failedNodes),
        waitingHumanNodes: numeric(checkpoint.waitingHumanNodes),
        humanEditedNodes: numeric(checkpoint.humanEditedNodes),
        confirmationRate: percentage(numeric(checkpoint.confirmedNodes), totalNodes),
        humanEditRate: percentage(numeric(checkpoint.humanEditedNodes), totalNodes),
        retryCount: numeric(checkpoint.retryCount),
        retryRate: percentage(numeric(checkpoint.retryCount), totalNodes),
        avgDurationMs: Math.round(numeric(checkpoint.avgDurationMs)),
      },
      job: {
        totalJobs,
        succeededJobs: numeric(job.succeededJobs),
        failedJobs: numeric(job.failedJobs),
        canceledJobs: numeric(job.canceledJobs),
        failureRate: percentage(numeric(job.failedJobs), totalJobs),
        retryRate: percentage(numeric(job.attemptCount), totalJobs),
        avgDurationMs: Math.round(numeric(job.avgDurationMs)),
      },
      tool: {
        totalRuns: totalToolRuns,
        succeededRuns: numeric(tool.succeededRuns),
        failedRuns: numeric(tool.failedRuns),
        blockedRuns: numeric(tool.blockedRuns),
        retryableRuns: numeric(tool.retryableRuns),
        failureRate: percentage(numeric(tool.failedRuns), totalToolRuns),
        retryRate: percentage(numeric(tool.attemptCount), totalToolRuns),
        avgDurationMs: Math.round(numeric(tool.avgDurationMs)),
      },
      quality: {
        evaluationCount: totalQualitySamples,
        avgScore: totalQualitySamples > 0 ? Math.round((weightedScore / totalQualitySamples) * 100) / 100 : 0,
        lowScoreCount: lowQualitySamples,
        lowScoreRate: percentage(lowQualitySamples, totalQualitySamples),
      },
    },
    evaluations: evaluationRows.map((row) => ({
      entityType: String(row.entityType),
      evaluationCount: numeric(row.evaluationCount),
      avgScore: Math.round(numeric(row.avgScore) * 100) / 100,
      minScore: Math.round(numeric(row.minScore) * 100) / 100,
      lowScoreCount: numeric(row.lowScoreCount),
    })),
    metrics: metricRows.map((row) => ({
      metricName: String(row.metricName),
      sampleCount: numeric(row.sampleCount),
      avgValue: Math.round(numeric(row.avgValue) * 100) / 100,
      sumValue: Math.round(numeric(row.sumValue) * 100) / 100,
    })),
    toolFailures: toolFailureRows.map((row) => ({
      failureKind: String(row.failureKind || "unknown"),
      count: numeric(row.count),
    })),
    workerQueue,
    database,
    generatedAt: new Date().toISOString(),
  };
}
