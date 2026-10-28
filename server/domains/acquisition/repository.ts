import { and, desc, eq, gte, sql, isNull, like } from "drizzle-orm";
import {
  acquisitionAssetCandidates,
  acquisitionConfirmedSnapshots,
  acquisitionConsumerLinks,
  acquisitionJobs,
  acquisitionProviderProfiles,
  acquisitionRawArtifacts,
  acquisitionRuns,
  acquisitionSnapshotRevisions,
  acquisitionSourceSnapshots,
} from "../../../drizzle/schema/acquisition";
import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  assessConfirmedSnapshotCoverage,
  isCapabilitySubsetCovered,
  type CapabilityCoverage,
} from "./capabilityCoverage";

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

type ListedAcquisitionJob = Pick<typeof acquisitionJobs.$inferSelect, "id" | "consumerType" | "consumerRef" | "marketplace" | "asin" | "requestedCapabilities" | "status" | "cachePolicy" | "cacheHitSnapshotId" | "requestedAt" | "startedAt" | "completedAt"> & {
  acceptedMissing: number;
  missingMainVideos: number;
  missingAplusVideos: number;
};

// Read the latest source, as the detail screen does. Cache expiry retains these
// result rows, so an unresolved video remains visible after previews expire.
function missingVideoCount(moduleType: "主图视频" | "A+视频") {
  return sql<number>`(SELECT COUNT(*) FROM acquisition_asset_candidates a
    WHERE a.workspace_id=acquisition_jobs.workspace_id AND a.role='video'
      AND REPLACE(a.module_type,' ','')=${moduleType}
      AND (a.storage_key IS NULL OR a.thumbnail_storage_key IS NULL)
      AND a.snapshot_id=COALESCE(
        (SELECT s.id FROM acquisition_source_snapshots s
          WHERE s.workspace_id=acquisition_jobs.workspace_id AND s.job_id=acquisition_jobs.id
          ORDER BY s.id DESC LIMIT 1),
        (SELECT c.snapshot_id FROM acquisition_confirmed_snapshots c
          WHERE c.workspace_id=acquisition_jobs.workspace_id AND c.id=acquisition_jobs.cache_hit_snapshot_id
            AND c.asin=acquisition_jobs.asin AND c.marketplace=acquisition_jobs.marketplace AND c.revision_id IS NULL)
      ))`.mapWith(Number);
}

export async function listAcquisitionJobs(db: DbExecutor, workspaceId: number, limit = 50, userId?: number, scope?: "knowledge" | "competitor", projectId?: number): Promise<ListedAcquisitionJob[]> {
  return db.select({
    id: acquisitionJobs.id,
    consumerType: acquisitionJobs.consumerType,
    consumerRef: acquisitionJobs.consumerRef,
    marketplace: acquisitionJobs.marketplace,
    asin: acquisitionJobs.asin,
    requestedCapabilities: acquisitionJobs.requestedCapabilities,
    status: acquisitionJobs.status,
    cachePolicy: acquisitionJobs.cachePolicy,
    cacheHitSnapshotId: acquisitionJobs.cacheHitSnapshotId,
    requestedAt: acquisitionJobs.requestedAt,
    startedAt: acquisitionJobs.startedAt,
    completedAt: acquisitionJobs.completedAt,
    acceptedMissing: acquisitionJobs.acceptedMissing,
    missingMainVideos: missingVideoCount("主图视频").as("missingMainVideos"),
    missingAplusVideos: missingVideoCount("A+视频").as("missingAplusVideos"),
  }).from(acquisitionJobs).where(and(
    eq(acquisitionJobs.workspaceId, workspaceId), isNull(acquisitionJobs.deletedAt),
    userId ? eq(acquisitionJobs.requestedBy, userId) : undefined,
    scope === "knowledge" ? eq(acquisitionJobs.consumerType, "kb_images") : undefined,
    scope === "competitor" ? eq(acquisitionJobs.consumerType, "project_competitor") : undefined,
    projectId ? like(acquisitionJobs.consumerRef, `project-competitor:${projectId}:%`) : undefined,
  ))
    // Keep unresolved knowledge tasks visible even after newer successful runs
    // exceed the history page size. Other consumers retain chronological order.
    .orderBy(...(scope === "knowledge" ? [sql`CASE
      WHEN ${acquisitionJobs.status} IN ('failed','review_required') THEN 0
      WHEN ${acquisitionJobs.status} = 'confirmed' AND ${acquisitionJobs.acceptedMissing} = 0 AND (\`missingMainVideos\` + \`missingAplusVideos\`) > 0 THEN 0
      WHEN ${acquisitionJobs.status} IN ('queued','running') THEN 1
      WHEN ${acquisitionJobs.status} = 'canceled' THEN 2
      ELSE 3 END`] : []), desc(acquisitionJobs.id)).limit(Math.min(Math.max(limit, 1), 100));
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

/**
 * Reads the saved source evidence before reusing a confirmed snapshot. A
 * current snapshot can remain a useful gallery record while still missing A+;
 * only a true requested-capability subset is a cache hit.
 */
export async function findFreshConfirmedSnapshotCoveringCapabilities(input: {
  db: DbExecutor;
  workspaceId: number;
  marketplace: string;
  asin: string;
  freshAfter: Date;
  requestedCapabilities: readonly AmazonAcquisitionCapability[];
}) {
  const candidates = await input.db.select().from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId),
    eq(acquisitionConfirmedSnapshots.marketplace, input.marketplace),
    eq(acquisitionConfirmedSnapshots.asin, input.asin),
    eq(acquisitionConfirmedSnapshots.isCurrent, 1),
    gte(acquisitionConfirmedSnapshots.confirmedAt, input.freshAfter),
  )).orderBy(desc(acquisitionConfirmedSnapshots.confirmedAt)).limit(10);

  let firstIncomplete: { snapshot: typeof acquisitionConfirmedSnapshots.$inferSelect; coverage: CapabilityCoverage[] } | null = null;
  for (const candidate of candidates) {
    const snapshot = await getSourceSnapshot(input.db, input.workspaceId, candidate.snapshotId);
    if (!snapshot) continue;
    const assets = await listAssetCandidates(input.db, input.workspaceId, snapshot.id);
    const coverage = assessConfirmedSnapshotCoverage({
      fieldStatuses: candidate.fieldStatuses,
      confirmedAssetIds: candidate.confirmedAssetIds,
      assets,
    }, input.requestedCapabilities);
    if (isCapabilitySubsetCovered(coverage)) return { snapshot: candidate, coverage, complete: true as const };
    firstIncomplete ??= { snapshot: candidate, coverage };
  }
  return firstIncomplete ? { ...firstIncomplete, complete: false as const } : null;
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


export async function createRawArtifact(db: DbExecutor, values: typeof acquisitionRawArtifacts.$inferInsert) {
  const [created] = await db.insert(acquisitionRawArtifacts).values(values).$returningId();
  return Number(created.id);
}

export async function createSourceSnapshot(db: DbExecutor, values: typeof acquisitionSourceSnapshots.$inferInsert) {
  const [created] = await db.insert(acquisitionSourceSnapshots).values(values).$returningId();
  return Number(created.id);
}

export async function updateSourceSnapshot(
  db: DbExecutor,
  workspaceId: number,
  snapshotId: number,
  values: Partial<typeof acquisitionSourceSnapshots.$inferInsert>,
) {
  await db.update(acquisitionSourceSnapshots).set(values).where(and(
    eq(acquisitionSourceSnapshots.workspaceId, workspaceId),
    eq(acquisitionSourceSnapshots.id, snapshotId),
  ));
}

export async function getSourceSnapshot(db: DbExecutor, workspaceId: number, snapshotId: number) {
  const rows = await db.select().from(acquisitionSourceSnapshots).where(and(
    eq(acquisitionSourceSnapshots.workspaceId, workspaceId),
    eq(acquisitionSourceSnapshots.id, snapshotId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function getSourceSnapshotByJob(db: DbExecutor, workspaceId: number, jobId: number) {
  const rows = await db.select().from(acquisitionSourceSnapshots).where(and(
    eq(acquisitionSourceSnapshots.workspaceId, workspaceId),
    eq(acquisitionSourceSnapshots.jobId, jobId),
  )).orderBy(desc(acquisitionSourceSnapshots.id)).limit(1);
  return rows[0] ?? null;
}

export async function createAssetCandidate(db: DbExecutor, values: typeof acquisitionAssetCandidates.$inferInsert) {
  const [created] = await db.insert(acquisitionAssetCandidates).values(values).$returningId();
  return Number(created.id);
}

export async function listAssetCandidates(db: DbExecutor, workspaceId: number, snapshotId: number) {
  return db.select().from(acquisitionAssetCandidates).where(and(
    eq(acquisitionAssetCandidates.workspaceId, workspaceId),
    eq(acquisitionAssetCandidates.snapshotId, snapshotId),
  )).orderBy(acquisitionAssetCandidates.role, acquisitionAssetCandidates.positionIndex);
}

export async function updateAssetCandidateReview(input: {
  db: DbExecutor;
  workspaceId: number;
  snapshotId: number;
  assetId: number;
  reviewStatus: "approved" | "rejected";
  reviewedBy: number;
}) {
  await input.db.update(acquisitionAssetCandidates).set({
    reviewStatus: input.reviewStatus,
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date(),
  }).where(and(
    eq(acquisitionAssetCandidates.workspaceId, input.workspaceId),
    eq(acquisitionAssetCandidates.snapshotId, input.snapshotId),
    eq(acquisitionAssetCandidates.id, input.assetId),
  ));
}

export async function nextSnapshotRevisionVersion(db: DbExecutor, snapshotId: number) {
  const rows = await db.select({ version: acquisitionSnapshotRevisions.version })
    .from(acquisitionSnapshotRevisions)
    .where(eq(acquisitionSnapshotRevisions.snapshotId, snapshotId))
    .orderBy(desc(acquisitionSnapshotRevisions.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function createSnapshotRevision(db: DbExecutor, values: typeof acquisitionSnapshotRevisions.$inferInsert) {
  const [created] = await db.insert(acquisitionSnapshotRevisions).values(values).$returningId();
  return Number(created.id);
}

export async function getLatestSnapshotRevision(db: DbExecutor, workspaceId: number, snapshotId: number) {
  const rows = await db.select().from(acquisitionSnapshotRevisions).where(and(
    eq(acquisitionSnapshotRevisions.workspaceId, workspaceId),
    eq(acquisitionSnapshotRevisions.snapshotId, snapshotId),
  )).orderBy(desc(acquisitionSnapshotRevisions.version)).limit(1);
  return rows[0] ?? null;
}

export async function nextConfirmationVersion(db: DbExecutor, snapshotId: number) {
  const rows = await db.select({ version: acquisitionConfirmedSnapshots.confirmationVersion })
    .from(acquisitionConfirmedSnapshots)
    .where(eq(acquisitionConfirmedSnapshots.snapshotId, snapshotId))
    .orderBy(desc(acquisitionConfirmedSnapshots.confirmationVersion)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function clearCurrentConfirmedSnapshot(db: DbExecutor, workspaceId: number, marketplace: string, asin: string) {
  await db.update(acquisitionConfirmedSnapshots).set({ isCurrent: 0 }).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
    eq(acquisitionConfirmedSnapshots.marketplace, marketplace),
    eq(acquisitionConfirmedSnapshots.asin, asin),
    eq(acquisitionConfirmedSnapshots.isCurrent, 1),
  ));
}

export async function createConfirmedSnapshot(db: DbExecutor, values: typeof acquisitionConfirmedSnapshots.$inferInsert) {
  const [created] = await db.insert(acquisitionConfirmedSnapshots).values(values).$returningId();
  return Number(created.id);
}

export async function supersedeConsumerLinks(input: {
  db: DbExecutor;
  workspaceId: number;
  consumerType: string;
  consumerRef: string;
  capabilityScope: string;
}) {
  await input.db.update(acquisitionConsumerLinks).set({ status: "superseded" }).where(and(
    eq(acquisitionConsumerLinks.workspaceId, input.workspaceId),
    eq(acquisitionConsumerLinks.consumerType, input.consumerType),
    eq(acquisitionConsumerLinks.consumerRef, input.consumerRef),
    eq(acquisitionConsumerLinks.capabilityScope, input.capabilityScope),
    eq(acquisitionConsumerLinks.status, "active"),
  ));
}

export async function createConsumerLink(db: DbExecutor, values: typeof acquisitionConsumerLinks.$inferInsert) {
  await db.insert(acquisitionConsumerLinks).values(values).onDuplicateKeyUpdate({
    set: { status: "active", projectionVersion: values.projectionVersion, updatedAt: new Date() },
  });
}
