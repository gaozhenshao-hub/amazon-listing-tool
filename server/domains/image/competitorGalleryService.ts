import { and, desc, eq, ne } from "drizzle-orm";
import {
  type AcquisitionAssetCandidate,
  type AcquisitionConfirmedSnapshot,
} from "../../../drizzle/schema/acquisition";
import {
  type ImageCompetitorAssetFact,
  type ImageCompetitorGalleryAnalysisVersion,
  type ImageCompetitorResearchSubject,
  imageCompetitorAssetFacts,
  imageCompetitorGalleryAnalysisVersions,
  imageCompetitorResearchSubjects,
} from "../../../drizzle/schema/image";
import { requireDb } from "../../repositories/dbClient";
import { resolveStoredObjectUrl } from "../../storage";
import * as imageDb from "./repository";
import {
  CompetitorGalleryAnalysisSchema,
  CompetitorImageFactSchema,
  confirmEvidenceBackedAnalysis,
} from "./competitorGalleryContracts";
import {
  createStep0Artifact,
  getCompetitorResearchSubject,
  getConfirmedSnapshot,
  getLatestCompetitorGalleryAnalysis,
  listAvailableConfirmedSnapshots,
  listCompetitorAssetFacts,
  listCompetitorResearchSubjects,
  listConfirmedAssets,
  listConfirmedGalleryAnalysesForProject,
  markCompetitorFactsConfirmed,
  nextStep0ArtifactVersion,
  supersedeConfirmedGalleryAnalyses,
  supersedeStep0Artifacts,
  updateCompetitorAssetFactEdit,
  updateCompetitorGalleryAnalysis,
  updateCompetitorResearchSubject,
  upsertCompetitorResearchSubject,
} from "./competitorGalleryRepository";

function workspaceIdOrThrow(workspaceId?: number | null) {
  const value = Number(workspaceId || 0);
  if (value <= 0) throw new Error("当前工作空间不可用");
  return value;
}

function confirmedDataSummary(data: unknown) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return {
    title: String(value.title || ""),
    brand: String(value.brand || ""),
    category: String(value.category || ""),
  };
}

export async function listCompetitorSnapshotOptions(workspaceId?: number | null) {
  const db = await requireDb("competitor snapshot options");
  const rows = await listAvailableConfirmedSnapshots(db, workspaceIdOrThrow(workspaceId));
  return rows.map((row: Pick<AcquisitionConfirmedSnapshot, "id" | "asin" | "marketplace" | "confirmedData" | "confirmedAssetIds" | "confirmedAt">) => ({
    id: row.id,
    asin: row.asin,
    marketplace: row.marketplace,
    confirmedAt: row.confirmedAt,
    assetCount: Array.isArray(row.confirmedAssetIds) ? row.confirmedAssetIds.length : 0,
    ...confirmedDataSummary(row.confirmedData),
  }));
}

export async function addCompetitorResearchSubject(input: {
  workspaceId?: number | null;
  projectId: number;
  userId: number;
  confirmedSnapshotId: number;
  role: "primary" | "benchmark" | "supplemental";
  displayName?: string;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("competitor research subject");
  const snapshot = await getConfirmedSnapshot(db, workspaceId, input.confirmedSnapshotId);
  if (!snapshot) throw new Error("只能添加当前工作空间的已确认采集Snapshot");
  const assets = await listConfirmedAssets(db, workspaceId, snapshot.id);
  if (!assets.length) throw new Error("该确认Snapshot没有可用于分析的已批准图片");
  const summary = confirmedDataSummary(snapshot.confirmedData);
  return upsertCompetitorResearchSubject({
    db,
    workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    confirmedSnapshotId: snapshot.id,
    marketplace: snapshot.marketplace,
    asin: snapshot.asin,
    displayName: input.displayName?.trim() || summary.title || snapshot.asin,
    role: input.role,
  });
}

export async function listCompetitorGallerySubjects(input: { workspaceId?: number | null; projectId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("competitor gallery subjects");
  const subjects = await listCompetitorResearchSubjects(db, workspaceId, input.projectId);
  return Promise.all(subjects.map(async (subject: ImageCompetitorResearchSubject) => {
    const [assets, facts, analysis] = await Promise.all([
      listConfirmedAssets(db, workspaceId, subject.confirmedSnapshotId),
      listCompetitorAssetFacts(db, workspaceId, subject.id),
      getLatestCompetitorGalleryAnalysis(db, workspaceId, subject.id),
    ]);
    const factByAsset = new Map(facts.map((fact: ImageCompetitorAssetFact) => [fact.acquisitionAssetId, fact]));
    return {
      ...subject,
      assets: await Promise.all(assets.map(async (asset: AcquisitionAssetCandidate) => ({
        id: asset.id,
        role: asset.role,
        positionIndex: asset.positionIndex,
        width: asset.width,
        height: asset.height,
        imageUrl: asset.storageKey ? await resolveStoredObjectUrl(asset.storageKey) : null,
        fact: factByAsset.get(asset.id) || null,
      }))),
      analysis,
    };
  }));
}

export async function setPrimaryCompetitorSubject(input: { workspaceId?: number | null; projectId: number; subjectId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("primary competitor subject");
  const subject = await getCompetitorResearchSubject(db, workspaceId, input.projectId, input.subjectId);
  if (!subject) throw new Error("竞品研究对象不存在");
  await db.transaction(async (tx) => {
    await tx.update(imageCompetitorResearchSubjects).set({ role: "benchmark" }).where(and(
      eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
      eq(imageCompetitorResearchSubjects.projectId, input.projectId),
      eq(imageCompetitorResearchSubjects.role, "primary"),
      ne(imageCompetitorResearchSubjects.id, input.subjectId),
    ));
    await tx.update(imageCompetitorResearchSubjects).set({ role: "primary" }).where(eq(imageCompetitorResearchSubjects.id, input.subjectId));
  });
  return { success: true };
}

export async function saveCompetitorAssetFact(input: {
  workspaceId?: number | null; projectId: number; subjectId: number; factId: number; fact: unknown;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("competitor image fact review");
  const parsed = CompetitorImageFactSchema.parse(input.fact);
  await updateCompetitorAssetFactEdit({ db, workspaceId, projectId: input.projectId, subjectId: input.subjectId, factId: input.factId, userEdit: parsed });
  return { success: true };
}

export async function saveCompetitorGalleryAnalysis(input: {
  workspaceId?: number | null; projectId: number; subjectId: number; analysisId: number; analysis: unknown;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("competitor gallery review");
  const current = await getLatestCompetitorGalleryAnalysis(db, workspaceId, input.subjectId);
  if (!current || current.id !== input.analysisId || current.projectId !== input.projectId) throw new Error("分析版本不存在");
  if (current.status === "confirmed" || current.status === "superseded") throw new Error("已确认分析不可修改");
  const parsed = CompetitorGalleryAnalysisSchema.parse(input.analysis);
  confirmEvidenceBackedAnalysis({ analysis: parsed, allowedAssetIds: Array.isArray(current.evidenceAssetIds) ? current.evidenceAssetIds.map(Number) : [] });
  await updateCompetitorGalleryAnalysis({ db, workspaceId, projectId: input.projectId, subjectId: input.subjectId, analysisId: input.analysisId, values: { userEdit: parsed, status: "review_required" } });
  return { success: true };
}

export async function confirmCompetitorGalleryAnalysis(input: {
  workspaceId?: number | null; projectId: number; subjectId: number; analysisId: number; userId: number;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("competitor gallery confirmation");
  const session = await imageDb.getImageWorkflowSessionByProject(input.projectId);
  if (!session) throw new Error("图片工作流会话不存在");
  await db.transaction(async (tx) => {
    const subject = await getCompetitorResearchSubject(tx, workspaceId, input.projectId, input.subjectId);
    if (!subject) throw new Error("竞品研究对象不存在");
    const current = await getLatestCompetitorGalleryAnalysis(tx, workspaceId, input.subjectId);
    if (!current || current.id !== input.analysisId) throw new Error("分析版本不存在");
    if (current.status === "confirmed") return;
    if (current.status !== "review_required") throw new Error("只有待审核分析可以确认");
    const parsed = CompetitorGalleryAnalysisSchema.parse(current.userEdit || current.analysis);
    const allowedAssetIds = Array.isArray(current.evidenceAssetIds) ? current.evidenceAssetIds.map(Number) : [];
    confirmEvidenceBackedAnalysis({ analysis: parsed, allowedAssetIds });
    await supersedeConfirmedGalleryAnalyses(tx, workspaceId, input.subjectId, current.id);
    await updateCompetitorGalleryAnalysis({ db: tx, workspaceId, projectId: input.projectId, subjectId: input.subjectId, analysisId: current.id, values: {
      status: "confirmed", userEdit: parsed, confirmedBy: input.userId, confirmedAt: new Date(),
    } });
    await markCompetitorFactsConfirmed(tx, workspaceId, input.subjectId);
    await updateCompetitorResearchSubject(tx, workspaceId, input.projectId, input.subjectId, { status: "confirmed", currentAnalysisVersion: current.version });
    const confirmed = await listConfirmedGalleryAnalysesForProject(tx, workspaceId, input.projectId);
    const artifactType = "competitor_gallery" as const;
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, artifactType);
    const artifactVersion = await nextStep0ArtifactVersion(tx, session.id, artifactType);
    await createStep0Artifact(tx, {
      workspaceId,
      projectId: input.projectId,
      sessionId: session.id,
      artifactType,
      version: artifactVersion,
      status: "confirmed",
      content: confirmed.map((item: { subject: ImageCompetitorResearchSubject; analysis: ImageCompetitorGalleryAnalysisVersion }) => ({
        subjectId: item.subject.id,
        asin: item.subject.asin,
        displayName: item.subject.displayName,
        role: item.subject.role,
        analysisVersion: item.analysis.version,
        analysis: item.analysis.userEdit || item.analysis.analysis,
      })),
      evidenceRefs: confirmed.map((item: { subject: ImageCompetitorResearchSubject; analysis: ImageCompetitorGalleryAnalysisVersion }) => ({ subjectId: item.subject.id, assetIds: item.analysis.evidenceAssetIds })),
      createdBy: input.userId,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    });
  });
  return { success: true };
}

export async function archiveCompetitorResearchSubject(input: { workspaceId?: number | null; projectId: number; subjectId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("archive competitor subject");
  await updateCompetitorResearchSubject(db, workspaceId, input.projectId, input.subjectId, { status: "archived" });
  return { success: true };
}

export async function requireConfirmedPrimaryGallery(workspaceId: number, projectId: number) {
  const db = await requireDb("confirmed primary competitor gallery");
  const subjects = await db.select({ id: imageCompetitorResearchSubjects.id }).from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    ne(imageCompetitorResearchSubjects.status, "archived"),
  ));
  if (!subjects.length) return;
  const confirmedPrimary = await db.select({ id: imageCompetitorResearchSubjects.id }).from(imageCompetitorResearchSubjects).where(and(
    eq(imageCompetitorResearchSubjects.workspaceId, workspaceId),
    eq(imageCompetitorResearchSubjects.projectId, projectId),
    eq(imageCompetitorResearchSubjects.role, "primary"),
    eq(imageCompetitorResearchSubjects.status, "confirmed"),
  )).limit(1);
  if (!confirmedPrimary.length) throw new Error("请先完成主要竞争对手整套图片分析并确认");
}
