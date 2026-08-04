import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { databaseSlowQuerySamples } from "../../../drizzle/schema/ai_os";
import { requireDb } from "../dbClient";

const PICOSECONDS_PER_MILLISECOND = 1_000_000_000;

export type SlowQuerySampleOptions = {
  minimumAverageMs?: number;
  limit?: number;
};

export function normalizeSlowQuerySampleOptions(input: SlowQuerySampleOptions = {}) {
  const rawMinimum = Number(input.minimumAverageMs ?? process.env.DB_SLOW_QUERY_MIN_AVG_MS ?? 250);
  const rawLimit = Number(input.limit ?? process.env.DB_SLOW_QUERY_SAMPLE_LIMIT ?? 50);
  return {
    minimumAverageMs: Math.min(Math.max(Number.isFinite(rawMinimum) ? rawMinimum : 250, 1), 60 * 60_000),
    limit: Math.min(Math.max(Math.floor(Number.isFinite(rawLimit) ? rawLimit : 50), 1), 200),
  };
}

export function buildSlowQuerySamplingSql(input: SlowQuerySampleOptions = {}) {
  const options = normalizeSlowQuerySampleOptions(input);
  return `SELECT
    SCHEMA_NAME AS schemaName,
    DIGEST AS digest,
    DIGEST_TEXT AS digestText,
    COUNT_STAR AS executionCount,
    AVG_TIMER_WAIT / ${PICOSECONDS_PER_MILLISECOND} AS avgTimerWaitMs,
    MAX_TIMER_WAIT / ${PICOSECONDS_PER_MILLISECOND} AS maxTimerWaitMs,
    SUM_ROWS_EXAMINED AS totalRowsExamined,
    SUM_ROWS_SENT AS totalRowsSent,
    FIRST_SEEN AS firstSeen,
    LAST_SEEN AS lastSeen
  FROM performance_schema.events_statements_summary_by_digest
  WHERE SCHEMA_NAME = DATABASE()
    AND DIGEST IS NOT NULL
    AND DIGEST_TEXT IS NOT NULL
    AND COUNT_STAR > 0
    AND AVG_TIMER_WAIT / ${PICOSECONDS_PER_MILLISECOND} >= ${options.minimumAverageMs}
    AND DIGEST_TEXT NOT LIKE '%performance_schema.events_statements_summary_by_digest%'
  ORDER BY AVG_TIMER_WAIT DESC
  LIMIT ${options.limit}`;
}

function normalizeRows(result: any): any[] {
  if (Array.isArray(result)) return Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function unavailableReason(error: unknown) {
  const message = String((error as Error)?.message || error || "");
  if (/performance_schema|command denied|access denied|doesn't exist|unknown table/i.test(message)) {
    return "performance_schema_unavailable";
  }
  if (/database not available|DATABASE_URL/i.test(message)) return "database_unavailable";
  if (/database_slow_query_samples/i.test(message)) return "migration_required";
  return "sampling_failed";
}

export async function sampleDatabaseSlowQueries(input: SlowQuerySampleOptions = {}) {
  const options = normalizeSlowQuerySampleOptions(input);
  try {
    const db = await requireDb("Slow query sampler");
    const result = await db.execute(sql.raw(buildSlowQuerySamplingSql(options)));
    const rows = normalizeRows(result);
    const sampledAt = new Date();
    const samples = rows.map((row) => ({
      sampleId: `dbsq_${randomUUID()}`,
      databaseSchema: String(row.schemaName || "unknown").slice(0, 128),
      digest: String(row.digest || "unknown").slice(0, 128),
      digestText: String(row.digestText || "").slice(0, 16_000),
      executionCount: numeric(row.executionCount),
      avgTimerWaitMs: numeric(row.avgTimerWaitMs).toFixed(3),
      maxTimerWaitMs: numeric(row.maxTimerWaitMs).toFixed(3),
      totalRowsExamined: numeric(row.totalRowsExamined),
      totalRowsSent: numeric(row.totalRowsSent),
      firstSeen: dateOrNull(row.firstSeen),
      lastSeen: dateOrNull(row.lastSeen),
      sampledAt,
      source: "performance_schema" as const,
      metadata: {
        normalizedDigest: true,
        minimumAverageMs: options.minimumAverageMs,
      },
    }));

    if (samples.length > 0) await db.insert(databaseSlowQuerySamples).values(samples);

    return {
      available: true as const,
      sampledAt: sampledAt.toISOString(),
      sampleCount: samples.length,
      options,
      samples: samples.map((sample) => ({
        ...sample,
        firstSeen: sample.firstSeen?.toISOString() || null,
        lastSeen: sample.lastSeen?.toISOString() || null,
        sampledAt: sample.sampledAt.toISOString(),
      })),
    };
  } catch (error) {
    return {
      available: false as const,
      sampledAt: new Date().toISOString(),
      sampleCount: 0,
      options,
      reason: unavailableReason(error),
      samples: [],
    };
  }
}

export async function listDatabaseSlowQuerySamples(input: { days?: number; limit?: number } = {}) {
  const days = Math.min(Math.max(Math.floor(Number(input.days || 30)), 1), 365);
  const limit = Math.min(Math.max(Math.floor(Number(input.limit || 100)), 1), 500);
  const db = await requireDb("Slow query sample history");
  const result = await db.execute(sql.raw(
    `SELECT sampleId, databaseSchema, digest, digestText, executionCount, avgTimerWaitMs,
            maxTimerWaitMs, totalRowsExamined, totalRowsSent, firstSeen, lastSeen, sampledAt, source, metadata
     FROM database_slow_query_samples
     WHERE sampledAt >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
     ORDER BY avgTimerWaitMs DESC, sampledAt DESC
     LIMIT ${limit}`,
  ));
  return normalizeRows(result).map((row) => ({
    ...row,
    executionCount: numeric(row.executionCount),
    avgTimerWaitMs: numeric(row.avgTimerWaitMs),
    maxTimerWaitMs: numeric(row.maxTimerWaitMs),
    totalRowsExamined: numeric(row.totalRowsExamined),
    totalRowsSent: numeric(row.totalRowsSent),
  }));
}
