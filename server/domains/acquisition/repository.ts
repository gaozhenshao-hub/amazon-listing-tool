import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  acquisitionConfirmedSnapshots,
  acquisitionJobs,
  acquisitionProviderProfiles,
  acquisitionRawArtifacts,
  acquisitionRuns,
} from "../../../drizzle/schema/acquisition";
import type { DbExecutor } from "../../repositories/dbClient";

export async function findAcquisitionJobByIdempotency(db: DbExecutor, workspaceId: number, idempotencyKey: string) {
  const rows = await db.select().from(acquisitionJobs).where(and(
    eq(acquisitionJobs.workspaceId, workspaceId),
    eq(acquisitionJobs.idempotencyKey, idempotencyKey),
  )).limit(1);
  return rows[0] ?? null;
}

export async function createAcquisitionJob(db: DbExecutor, values: typeof acquisitionJobs.$inferInsert) {
  const [created] = await db.insert(acquisitionJobs).values(values).$returningId();
  return Number(created.id);
}

export async function getAcquisitionJob(db: DbExecutor, workspaceId: number, jobId: number) {
  const rows = await db.select().from(acquisitionJobs).where(and(
    eq(acquisitionJobs.workspaceId, workspaceId),
    eq(acquisitionJobs.id, jobId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function updateAcquisitionJob(
  db: DbExecutor,
  workspaceId: number,
  jobId: number,
  values: Partial<typeof acquisitionJobs.$inferInsert>,
) {
  await db.update(acquisitionJobs).set(values).where(and(
    eq(acquisitionJobs.workspaceId, workspaceId),
    eq(acquisitionJobs.id, jobId),
  ));
}

export async function listAcquisitionJobs(db: DbExecutor, workspaceId: number, limit = 50) {
  return db.select({
    id: acquisitionJobs.id,
    consumerType: acquisitionJobs.consumerType,
    consumerRef: acquisitionJobs.consumerRef,
    marketplace: acquisitionJobs.marketplace,
    asin: acquisitionJobs.asin,
    requestedCapabilities: acquisitionJobs.requestedCapabilities,
    status: acquisitionJobs.status,
    cachePolicy: acquisitionJobs.cachePolicy,
    maxChargeUsd: acquisitionJobs.maxChargeUsd,
    cacheHitSnapshotId: acquisitionJobs.cacheHitSnapshotId,
    requestedAt: acquisitionJobs.requestedAt,
    startedAt: acquisitionJobs.startedAt,
    completedAt: acquisitionJobs.completedAt,
  }).from(acquisitionJobs).where(eq(acquisitionJobs.workspaceId, workspaceId))
    .orderBy(desc(acquisitionJobs.id)).limit(Math.min(Math.max(limit, 1), 100));
}

export async function getActiveAcquisitionProfile(db: DbExecutor, workspaceId: number) {
  const rows = await db.select().from(acquisitionProviderProfiles).where(and(
    eq(acquisitionProviderProfiles.workspaceId, workspaceId),
    eq(acquisitionProviderProfiles.profileKey, "apify-amazon-primary"),
    eq(acquisitionProviderProfiles.status, "active"),
  )).limit(1);
  return rows[0] ?? null;
}

export async function findFreshConfirmedSnapshot(input: {
  db: DbExecutor;
  workspaceId: number;
  marketplace: string;
  asin: string;
  freshAfter: Date;
}) {
  const rows = await input.db.select().from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId),
    eq(acquisitionConfirmedSnapshots.marketplace, input.marketplace),
    eq(acquisitionConfirmedSnapshots.asin, input.asin),
    eq(acquisitionConfirmedSnapshots.isCurrent, 1),
    gte(acquisitionConfirmedSnapshots.confirmedAt, input.freshAfter),
  )).orderBy(desc(acquisitionConfirmedSnapshots.confirmedAt)).limit(1);
  return rows[0] ?? null;
}

export async function nextAcquisitionRunAttempt(db: DbExecutor, jobId: number) {
  const rows = await db.select({ attempt: acquisitionRuns.attempt }).from(acquisitionRuns)
    .where(eq(acquisitionRuns.jobId, jobId)).orderBy(desc(acquisitionRuns.attempt)).limit(1);
  return Number(rows[0]?.attempt ?? 0) + 1;
}

export async function createAcquisitionRun(db: DbExecutor, values: typeof acquisitionRuns.$inferInsert) {
  const [created] = await db.insert(acquisitionRuns).values(values).$returningId();
  return Number(created.id);
}

export async function updateAcquisitionRun(db: DbExecutor, runId: number, values: Partial<typeof acquisitionRuns.$inferInsert>) {
  await db.update(acquisitionRuns).set(values).where(eq(acquisitionRuns.id, runId));
}

export async function getAcquisitionBudgetUsage(db: DbExecutor, workspaceId: number, now: Date) {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [daily] = await db.select({
    amount: sql<string>`coalesce(sum(${acquisitionRuns.chargedUsd}), 0)`,
  }).from(acquisitionRuns).where(and(
    eq(acquisitionRuns.workspaceId, workspaceId),
    gte(acquisitionRuns.createdAt, dayStart),
  ));
  const [monthly] = await db.select({
    amount: sql<string>`coalesce(sum(${acquisitionRuns.chargedUsd}), 0)`,
  }).from(acquisitionRuns).where(and(
    eq(acquisitionRuns.workspaceId, workspaceId),
    gte(acquisitionRuns.createdAt, monthStart),
  ));
  return {
    dailyChargedUsd: Number(daily?.amount ?? 0),
    monthlyChargedUsd: Number(monthly?.amount ?? 0),
  };
}

export async function createRawArtifact(db: DbExecutor, values: typeof acquisitionRawArtifacts.$inferInsert) {
  const [created] = await db.insert(acquisitionRawArtifacts).values(values).$returningId();
  return Number(created.id);
}
