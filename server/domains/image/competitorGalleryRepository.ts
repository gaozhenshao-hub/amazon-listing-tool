import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  acquisitionAssetCandidates,
  acquisitionConfirmedSnapshots,
} from "../../../drizzle/schema/acquisition";
import {
  imageCompetitorAssetFacts,
  imageCompetitorGalleryAnalysisVersions,
  imageCompetitorResearchSubjects,
  imageWorkflowStep0Artifacts,
} from "../../../drizzle/schema/image";
import type { DbExecutor } from "../../repositories/dbClient";

export async function listAvailableConfirmedSnapshots(db: DbExecutor, workspaceId: number) {
  return db.select({
    id: acquisitionConfirmedSnapshots.id,
    asin: acquisitionConfirmedSnapshots.asin,
    marketplace: acquisitionConfirmedSnapshots.marketplace,
    confirmedData: acquisitionConfirmedSnapshots.confirmedData,
    confirmedAssetIds: acquisitionConfirmedSnapshots.confirmedAssetIds,
    confirmedAt: acquisitionConfirmedSnapshots.confirmedAt,
  }).from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
    eq(acquisitionConfirmedSnapshots.isCurrent, 1),
  )).orderBy(desc(acquisitionConfirmedSnapshots.confirmedAt)).limit(100);
}

export async function getConfirmedSnapshot(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number) {
  const rows = await db.select().from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
    eq(acquisitionConfirmedSnapshots.id, confirmedSnapshotId),
    eq(acquisitionConfirmedSnapshots.isCurrent, 1),
  )).limit(1);
  return rows[0] ?? null;
}

export async function listConfirmedAssets(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number) {
  const snapshot = await getConfirmedSnapshot(db, workspaceId, confirmedSnapshotId);
  if (!snapshot) return [];
  const ids = (Array.isArray(snapshot.confirmedAssetIds) ? snapshot.confirmedAssetIds : [])
    .map(Number).filter((id: number) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  return db.select().from(acquisitionAssetCandidates).where(and(
    eq(acquisitionAssetCandidates.workspaceId, workspaceId),
    eq(acquisitionAssetCandidates.reviewStatus, "approved"),
    inArray(acquisitionAssetCandidates.id, ids),
  )).orderBy(acquisitionAssetCandidates.role, acquisitionAssetCandidates.positionIndex);
}

export async function listCompetitorResearchSubjects(db: DbExecutor, workspaceId: number, projectId: number) {
  return db.select().from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    ne(imageCompetitorResearchSubjects.status, "archived"),
  )).orderBy(imageCompetitorResearchSubjects.sortOrder, imageCompetitorResearchSubjects.id);
}

export async function getCompetitorResearchSubject(db: DbExecutor, workspaceId: number, projectId: number, subjectId: number) {
  const rows = await db.select().from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    eq(imageCompetitorResearchSubjects.id, subjectId),
    ne(imageCompetitorResearchSubjects.status, "archived"),
  )).limit(1);
  return rows[0] ?? null;
}

export async function upsertCompetitorResearchSubject(input: {
  db: DbExecutor;
  workspaceId: number;
  projectId: number;
  userId: number;
  confirmedSnapshotId: number;
  marketplace: string;
  asin: string;
  displayName: string;
  role: "primary" | "benchmark" | "supplemental";
}) {
  if (input.role === "primary") {
    await input.db.update(imageCompetitorResearchSubjects).set({ role: "benchmark" }).where(and(
      eq(imageCompetitorResearchSubjects.workspaceId, input.workspaceId),
      eq(imageCompetitorResearchSubjects.projectId, input.projectId),
      eq(imageCompetitorResearchSubjects.role, "primary"),
    ));
  }
  await input.db.insert(imageCompetitorResearchSubjects).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    confirmedSnapshotId: input.confirmedSnapshotId,
    marketplace: input.marketplace,
    asin: input.asin,
    displayName: input.displayName,
    role: input.role,
    status: "ready",
  }).onDuplicateKeyUpdate({
    set: { displayName: input.displayName, role: input.role, status: "ready", updatedAt: new Date() },
  });
  const rows = await input.db.select().from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, input.workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, input.projectId),
    eq(imageCompetitorResearchSubjects.confirmedSnapshotId, input.confirmedSnapshotId),
  )).limit(1);
  return rows[0];
}

export async function updateCompetitorResearchSubject(
  db: DbExecutor,
  workspaceId: number,
  projectId: number,
  subjectId: number,
  values: Partial<typeof imageCompetitorResearchSubjects.$inferInsert>,
) {
  await db.update(imageCompetitorResearchSubjects).set(values).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    eq(imageCompetitorResearchSubjects.id, subjectId),
  ));
}

export async function listCompetitorAssetFacts(db: DbExecutor, workspaceId: number, subjectId: number) {
  return db.select().from(imageCompetitorAssetFacts).where(and(
    eq(imageCompetitorAssetFacts.workspaceId, workspaceId),
    eq(imageCompetitorAssetFacts.subjectId, subjectId),
  )).orderBy(imageCompetitorAssetFacts.positionIndex, imageCompetitorAssetFacts.id);
}

export async function upsertCompetitorAssetFact(db: DbExecutor, values: typeof imageCompetitorAssetFacts.$inferInsert) {
  await db.insert(imageCompetitorAssetFacts).values(values).onDuplicateKeyUpdate({ set: {
    inputContentHash: values.inputContentHash,
    assetRole: values.assetRole,
    positionIndex: values.positionIndex,
    status: values.status,
    aiFacts: values.aiFacts,
    confidence: values.confidence,
    analyzedByJobRunId: values.analyzedByJobRunId,
    updatedAt: new Date(),
  } });
}

export async function updateCompetitorAssetFactEdit(input: {
  db: DbExecutor;
  workspaceId: number;
  projectId: number;
  subjectId: number;
  factId: number;
  userEdit: unknown;
}) {
  await input.db.update(imageCompetitorAssetFacts).set({ userEdit: input.userEdit, status: "review_required" }).where(and(
    eq(imageCompetitorAssetFacts.workspaceId, input.workspaceId),
    eq(imageCompetitorAssetFacts.projectId, input.projectId),
    eq(imageCompetitorAssetFacts.subjectId, input.subjectId),
    eq(imageCompetitorAssetFacts.id, input.factId),
  ));
}

export async function nextCompetitorGalleryAnalysisVersion(db: DbExecutor, subjectId: number) {
  const rows = await db.select({ version: imageCompetitorGalleryAnalysisVersions.version })
    .from(imageCompetitorGalleryAnalysisVersions)
    .where(eq(imageCompetitorGalleryAnalysisVersions.subjectId, subjectId))
    .orderBy(desc(imageCompetitorGalleryAnalysisVersions.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function createCompetitorGalleryAnalysisVersion(db: DbExecutor, values: typeof imageCompetitorGalleryAnalysisVersions.$inferInsert) {
  const [created] = await db.insert(imageCompetitorGalleryAnalysisVersions).values(values).$returningId();
  return Number(created.id);
}

export async function getLatestCompetitorGalleryAnalysis(db: DbExecutor, workspaceId: number, subjectId: number) {
  const rows = await db.select().from(imageCompetitorGalleryAnalysisVersions).where(and(
    eq(imageCompetitorGalleryAnalysisVersions.workspaceId, workspaceId),
    eq(imageCompetitorGalleryAnalysisVersions.subjectId, subjectId),
  )).orderBy(desc(imageCompetitorGalleryAnalysisVersions.version)).limit(1);
  return rows[0] ?? null;
}

export async function updateCompetitorGalleryAnalysis(input: {
  db: DbExecutor;
  workspaceId: number;
  projectId: number;
  subjectId: number;
  analysisId: number;
  values: Partial<typeof imageCompetitorGalleryAnalysisVersions.$inferInsert>;
}) {
  await input.db.update(imageCompetitorGalleryAnalysisVersions).set(input.values).where(and(
    eq(imageCompetitorGalleryAnalysisVersions.workspaceId, input.workspaceId),
    eq(imageCompetitorGalleryAnalysisVersions.projectId, input.projectId),
    eq(imageCompetitorGalleryAnalysisVersions.subjectId, input.subjectId),
    eq(imageCompetitorGalleryAnalysisVersions.id, input.analysisId),
  ));
}

export async function supersedeConfirmedGalleryAnalyses(db: DbExecutor, workspaceId: number, subjectId: number, excludeId: number) {
  await db.update(imageCompetitorGalleryAnalysisVersions).set({ status: "superseded" }).where(and(
    eq(imageCompetitorGalleryAnalysisVersions.workspaceId, workspaceId),
    eq(imageCompetitorGalleryAnalysisVersions.subjectId, subjectId),
    eq(imageCompetitorGalleryAnalysisVersions.status, "confirmed"),
    ne(imageCompetitorGalleryAnalysisVersions.id, excludeId),
  ));
}

export async function markCompetitorFactsConfirmed(db: DbExecutor, workspaceId: number, subjectId: number) {
  await db.update(imageCompetitorAssetFacts).set({ status: "confirmed" }).where(and(
    eq(imageCompetitorAssetFacts.workspaceId, workspaceId),
    eq(imageCompetitorAssetFacts.subjectId, subjectId),
    ne(imageCompetitorAssetFacts.status, "excluded"),
  ));
}

export async function listConfirmedGalleryAnalysesForProject(db: DbExecutor, workspaceId: number, projectId: number) {
  const rows = await db.select({
    subject: imageCompetitorResearchSubjects,
    analysis: imageCompetitorGalleryAnalysisVersions,
  }).from(imageCompetitorResearchSubjects)
    .innerJoin(imageCompetitorGalleryAnalysisVersions, and(
      eq(imageCompetitorGalleryAnalysisVersions.subjectId, imageCompetitorResearchSubjects.id),
      eq(imageCompetitorGalleryAnalysisVersions.status, "confirmed"),
    ))
    .where(and(
      eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
      eq(imageCompetitorResearchSubjects.projectId, projectId),
      ne(imageCompetitorResearchSubjects.status, "archived"),
    )).orderBy(imageCompetitorResearchSubjects.sortOrder, imageCompetitorResearchSubjects.id);
  return rows;
}

export async function nextStep0ArtifactVersion(db: DbExecutor, sessionId: number, artifactType: "competitor_gallery" | "expression_summary" | "composite") {
  const rows = await db.select({ version: imageWorkflowStep0Artifacts.version }).from(imageWorkflowStep0Artifacts)
    .where(and(eq(imageWorkflowStep0Artifacts.sessionId, sessionId), eq(imageWorkflowStep0Artifacts.artifactType, artifactType)))
    .orderBy(desc(imageWorkflowStep0Artifacts.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function createStep0Artifact(db: DbExecutor, values: typeof imageWorkflowStep0Artifacts.$inferInsert) {
  const [created] = await db.insert(imageWorkflowStep0Artifacts).values(values).$returningId();
  return Number(created.id);
}

export async function supersedeStep0Artifacts(db: DbExecutor, workspaceId: number, projectId: number, artifactType: "competitor_gallery" | "expression_summary" | "composite") {
  await db.update(imageWorkflowStep0Artifacts).set({ status: "superseded" }).where(and(
    eq(imageWorkflowStep0Artifacts.workspaceId, workspaceId),
    eq(imageWorkflowStep0Artifacts.projectId, projectId),
    eq(imageWorkflowStep0Artifacts.artifactType, artifactType),
    eq(imageWorkflowStep0Artifacts.status, "confirmed"),
  ));
}

export async function getPrimaryGalleryConfirmationCount(db: DbExecutor, workspaceId: number, projectId: number) {
  const rows = await db.select({ count: sql<number>`count(*)` }).from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    eq(imageCompetitorResearchSubjects.role, "primary"),
    eq(imageCompetitorResearchSubjects.status, "confirmed"),
  ));
  return Number(rows[0]?.count ?? 0);
}
