import { and, desc, eq, gte, sql } from "drizzle-orm";
import { competitorMonitors, competitorSnapshots } from "../../../drizzle/schema/ads";
import { acquisitionProviderProfiles } from "../../../drizzle/schema/acquisition";
import { amazonMonitorRuns, amazonMonitorSchedules } from "../../../drizzle/schema/monitoring";
import { keywordMonitors, keywordSnapshots } from "../../../drizzle/schema/ops";
import type { DbExecutor } from "../../repositories/dbClient";
import type { AmazonMonitorKind, AmazonMonitorResult } from "./monitorProviderContracts";

export async function loadMonitorTarget(db: DbExecutor, workspaceId: number, kind: AmazonMonitorKind, monitorId: number) {
  if (kind === "competitor") {
    const rows = await db.select().from(competitorMonitors).where(and(
      eq(competitorMonitors.workspaceId, workspaceId),
      eq(competitorMonitors.id, monitorId),
    )).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      kind,
      monitorId: row.id,
      ownerUserId: row.userId,
      marketplace: String(row.marketplace || "US").toUpperCase(),
      asin: row.competitorAsin.toUpperCase(),
      keyword: null,
      frequency: row.monitorFrequency || "manual",
      active: row.isActive === 1,
    } as const;
  }
  const rows = await db.select().from(keywordMonitors).where(and(
    eq(keywordMonitors.workspaceId, workspaceId),
    eq(keywordMonitors.id, monitorId),
  )).limit(1);
  const row = rows[0];
  if (!row || !row.targetAsin) return null;
  return {
    kind,
    monitorId: row.id,
    ownerUserId: row.userId,
    marketplace: String(row.marketplace || "US").toUpperCase(),
    asin: row.targetAsin.toUpperCase(),
    keyword: row.keyword,
    frequency: row.monitorFrequency || "manual",
    active: row.isActive === 1,
  } as const;
}

export async function loadMonitorProviderProfileById(db: DbExecutor, workspaceId: number, profileId: number) {
  const rows = await db.select().from(acquisitionProviderProfiles).where(and(
    eq(acquisitionProviderProfiles.workspaceId, workspaceId),
    eq(acquisitionProviderProfiles.id, profileId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function createMonitorRun(
  db: DbExecutor,
  values: typeof amazonMonitorRuns.$inferInsert & { workspaceId: number; idempotencyKey: string },
) {
  const existing = await db.select().from(amazonMonitorRuns).where(and(
    eq(amazonMonitorRuns.workspaceId, values.workspaceId),
    eq(amazonMonitorRuns.idempotencyKey, values.idempotencyKey),
  )).limit(1);
  if (existing[0]) return { run: existing[0], reused: true as const };
  const [created] = await db.insert(amazonMonitorRuns).values(values).$returningId();
  const rows = await db.select().from(amazonMonitorRuns).where(eq(amazonMonitorRuns.id, Number(created.id))).limit(1);
  if (!rows[0]) throw new Error("Amazon monitor run was not persisted");
  return { run: rows[0], reused: false as const };
}

export async function getMonitorRun(db: DbExecutor, workspaceId: number, id: number) {
  const rows = await db.select().from(amazonMonitorRuns).where(and(
    eq(amazonMonitorRuns.workspaceId, workspaceId),
    eq(amazonMonitorRuns.id, id),
  )).limit(1);
  return rows[0] ?? null;
}

export async function updateMonitorRun(db: DbExecutor, workspaceId: number, id: number, values: Partial<typeof amazonMonitorRuns.$inferInsert>) {
  await db.update(amazonMonitorRuns).set(values).where(and(
    eq(amazonMonitorRuns.workspaceId, workspaceId),
    eq(amazonMonitorRuns.id, id),
  ));
}

export async function getMonitorBudgetUsage(db: DbExecutor, workspaceId: number, profileId: number, now = new Date()) {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [daily] = await db.select({ amount: sql<string>`coalesce(sum(${amazonMonitorRuns.chargedUsd}), 0)` }).from(amazonMonitorRuns).where(and(
    eq(amazonMonitorRuns.workspaceId, workspaceId),
    eq(amazonMonitorRuns.providerProfileId, profileId),
    gte(amazonMonitorRuns.createdAt, dayStart),
  ));
  const [monthly] = await db.select({ amount: sql<string>`coalesce(sum(${amazonMonitorRuns.chargedUsd}), 0)` }).from(amazonMonitorRuns).where(and(
    eq(amazonMonitorRuns.workspaceId, workspaceId),
    eq(amazonMonitorRuns.providerProfileId, profileId),
    gte(amazonMonitorRuns.createdAt, monthStart),
  ));
  return { dailyChargedUsd: Number(daily?.amount || 0), monthlyChargedUsd: Number(monthly?.amount || 0) };
}

export async function persistMonitorSnapshot(input: {
  db: DbExecutor;
  workspaceId: number;
  monitorId: number;
  result: AmazonMonitorResult;
}) {
  const snapshotDate = (input.result.kind === "competitor" ? input.result.snapshotAt : input.result.runAt)?.slice(0, 10)
    || new Date().toISOString().slice(0, 10);
  if (input.result.kind === "competitor") {
    const insertResult = await input.db.insert(competitorSnapshots).values({
      workspaceId: input.workspaceId,
      monitorId: input.monitorId,
      snapshotDate,
      price: input.result.price,
      bsrRank: input.result.bsrRank,
      bsrCategory: input.result.bsrCategory,
      reviewCount: null,
      rating: null,
      mainImageUrl: null,
      bulletPoints: null,
      isInStock: null,
      couponInfo: null,
      dealInfo: null,
    });
    await input.db.update(competitorMonitors).set({
      competitorTitle: input.result.title || undefined,
      lastCheckedAt: new Date(),
    }).where(and(eq(competitorMonitors.workspaceId, input.workspaceId), eq(competitorMonitors.id, input.monitorId)));
    return Number((insertResult as any).insertId);
  }
  const insertResult = await input.db.insert(keywordSnapshots).values({
    workspaceId: input.workspaceId,
    keywordMonitorId: input.monitorId,
    snapshotDate,
    organicRank: input.result.organicRank,
    adRank: input.result.adRank,
    searchVolume: input.result.searchVolume,
    pageNumber: input.result.pageNumber,
    totalResults: input.result.resultsScanned,
  });
  await input.db.update(keywordMonitors).set({ lastCheckedAt: new Date() }).where(and(
    eq(keywordMonitors.workspaceId, input.workspaceId),
    eq(keywordMonitors.id, input.monitorId),
  ));
  return Number((insertResult as any).insertId);
}

export async function listMonitorRuns(db: DbExecutor, workspaceId: number, limit = 50) {
  return db.select().from(amazonMonitorRuns).where(eq(amazonMonitorRuns.workspaceId, workspaceId))
    .orderBy(desc(amazonMonitorRuns.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
}

export async function getMonitorSchedule(db: DbExecutor, workspaceId: number, kind: AmazonMonitorKind, monitorId: number) {
  const rows = await db.select().from(amazonMonitorSchedules).where(and(
    eq(amazonMonitorSchedules.workspaceId, workspaceId),
    eq(amazonMonitorSchedules.monitorKind, kind),
    eq(amazonMonitorSchedules.monitorId, monitorId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function upsertMonitorSchedule(input: {
  db: DbExecutor;
  workspaceId: number;
  kind: AmazonMonitorKind;
  monitorId: number;
  ownerUserId: number;
  frequency: "manual" | "daily" | "weekly";
  cronExpression: string | null;
  heartbeatTaskUid: string | null;
  status: "draft" | "active" | "paused" | "error" | "retired";
  nextRunAt?: Date | null;
  lastError?: string | null;
}) {
  await input.db.insert(amazonMonitorSchedules).values({
    workspaceId: input.workspaceId,
    monitorKind: input.kind,
    monitorId: input.monitorId,
    ownerUserId: input.ownerUserId,
    frequency: input.frequency,
    cronExpression: input.cronExpression,
    heartbeatTaskUid: input.heartbeatTaskUid,
    status: input.status,
    nextRunAt: input.nextRunAt ?? null,
    lastError: input.lastError ?? null,
  }).onDuplicateKeyUpdate({ set: {
    ownerUserId: input.ownerUserId,
    frequency: input.frequency,
    cronExpression: input.cronExpression,
    heartbeatTaskUid: input.heartbeatTaskUid,
    status: input.status,
    nextRunAt: input.nextRunAt ?? null,
    lastError: input.lastError ?? null,
  } });
  return getMonitorSchedule(input.db, input.workspaceId, input.kind, input.monitorId);
}

export async function getMonitorScheduleByTaskUid(db: DbExecutor, taskUid: string) {
  const rows = await db.select().from(amazonMonitorSchedules).where(eq(amazonMonitorSchedules.heartbeatTaskUid, taskUid)).limit(1);
  return rows[0] ?? null;
}

export async function markMonitorScheduleQueued(input: { db: DbExecutor; scheduleId: number; runId: number }) {
  await input.db.update(amazonMonitorSchedules).set({
    lastHeartbeatAt: new Date(),
    lastQueuedRunId: input.runId,
    lastError: null,
  }).where(eq(amazonMonitorSchedules.id, input.scheduleId));
}

export async function markMonitorScheduleError(input: { db: DbExecutor; scheduleId: number; error: string }) {
  await input.db.update(amazonMonitorSchedules).set({
    status: "error",
    lastHeartbeatAt: new Date(),
    lastError: input.error.slice(0, 2000),
  }).where(eq(amazonMonitorSchedules.id, input.scheduleId));
}
