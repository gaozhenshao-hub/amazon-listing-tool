import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";

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
  entityType: "job" | "agent_run" | "agent_node" | "skill" | "tool";
  entityId: string;
  metricName: string;
  metricValue?: number | null;
  status?: string | null;
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
       (entityType,entityId,metricName,metricValue,status,userId,projectId,agentSlug,nodeId,skillSlug,toolSlug,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
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
