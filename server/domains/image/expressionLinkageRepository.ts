import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  expressionGroups,
  imageCompetitorAssetFacts,
  imageCompetitorResearchSubjects,
  imageExpressionAnalysisVersions,
  imageExpressionAssetLinks,
  imageExpressionSelectionVersions,
  imageStep0SynthesisVersions,
  imageWorkflowStep0Artifacts,
} from "../../../drizzle/schema/image";
import type { DbExecutor } from "../../repositories/dbClient";

export async function getExpressionGroupForProject(db: DbExecutor, projectId: number, groupId: number) {
  const rows = await db.select().from(expressionGroups).where(and(
    eq(expressionGroups.projectId, projectId),
    eq(expressionGroups.id, groupId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function nextExpressionSelectionVersion(db: DbExecutor, groupId: number) {
  const rows = await db.select({ version: imageExpressionSelectionVersions.version })
    .from(imageExpressionSelectionVersions)
    .where(eq(imageExpressionSelectionVersions.groupId, groupId))
    .orderBy(desc(imageExpressionSelectionVersions.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function supersedeExpressionSelections(db: DbExecutor, workspaceId: number, projectId: number, groupId: number) {
  await db.update(imageExpressionSelectionVersions).set({ status: "superseded" }).where(and(
    eq(imageExpressionSelectionVersions.workspaceId, workspaceId),
    eq(imageExpressionSelectionVersions.projectId, projectId),
    eq(imageExpressionSelectionVersions.groupId, groupId),
    ne(imageExpressionSelectionVersions.status, "superseded"),
  ));
}

export async function createExpressionSelectionVersion(
  db: DbExecutor,
  values: typeof imageExpressionSelectionVersions.$inferInsert,
) {
  const [created] = await db.insert(imageExpressionSelectionVersions).values(values).$returningId();
  return Number(created.id);
}

export async function createExpressionAssetLinks(
  db: DbExecutor,
  values: Array<typeof imageExpressionAssetLinks.$inferInsert>,
) {
  if (!values.length) return;
  await db.insert(imageExpressionAssetLinks).values(values);
}

export async function getLatestExpressionSelection(db: DbExecutor, workspaceId: number, projectId: number, groupId: number) {
  const rows = await db.select().from(imageExpressionSelectionVersions).where(and(
    eq(imageExpressionSelectionVersions.workspaceId, workspaceId),
    eq(imageExpressionSelectionVersions.projectId, projectId),
    eq(imageExpressionSelectionVersions.groupId, groupId),
    ne(imageExpressionSelectionVersions.status, "superseded"),
  )).orderBy(desc(imageExpressionSelectionVersions.version)).limit(1);
  return rows[0] ?? null;
}

export async function getExpressionSelectionById(db: DbExecutor, workspaceId: number, projectId: number, selectionVersionId: number) {
  const rows = await db.select().from(imageExpressionSelectionVersions).where(and(
    eq(imageExpressionSelectionVersions.workspaceId, workspaceId),
    eq(imageExpressionSelectionVersions.projectId, projectId),
    eq(imageExpressionSelectionVersions.id, selectionVersionId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function listExpressionSelectionLinks(db: DbExecutor, workspaceId: number, selectionVersionId: number) {
  return db.select().from(imageExpressionAssetLinks).where(and(
    eq(imageExpressionAssetLinks.workspaceId, workspaceId),
    eq(imageExpressionAssetLinks.selectionVersionId, selectionVersionId),
  )).orderBy(asc(imageExpressionAssetLinks.sortOrder), asc(imageExpressionAssetLinks.id));
}

export async function confirmExpressionSelection(db: DbExecutor, workspaceId: number, projectId: number, selectionVersionId: number, userId: number) {
  await db.update(imageExpressionSelectionVersions).set({
    status: "confirmed",
    confirmedBy: userId,
    confirmedAt: new Date(),
  }).where(and(
    eq(imageExpressionSelectionVersions.workspaceId, workspaceId),
    eq(imageExpressionSelectionVersions.projectId, projectId),
    eq(imageExpressionSelectionVersions.id, selectionVersionId),
    eq(imageExpressionSelectionVersions.status, "draft"),
  ));
}

export async function listSelectedExpressionFacts(db: DbExecutor, workspaceId: number, selectionVersionId: number) {
  return db.select({
    link: imageExpressionAssetLinks,
    fact: imageCompetitorAssetFacts,
    subject: imageCompetitorResearchSubjects,
  }).from(imageExpressionAssetLinks)
    .innerJoin(imageCompetitorAssetFacts, and(
      eq(imageCompetitorAssetFacts.workspaceId, imageExpressionAssetLinks.workspaceId),
      eq(imageCompetitorAssetFacts.subjectId, imageExpressionAssetLinks.subjectId),
      eq(imageCompetitorAssetFacts.acquisitionAssetId, imageExpressionAssetLinks.acquisitionAssetId),
    ))
    .innerJoin(imageCompetitorResearchSubjects, and(
      eq(imageCompetitorResearchSubjects.workspaceId, imageExpressionAssetLinks.workspaceId),
      eq(imageCompetitorResearchSubjects.id, imageExpressionAssetLinks.subjectId),
    ))
    .where(and(
      eq(imageExpressionAssetLinks.workspaceId, workspaceId),
      eq(imageExpressionAssetLinks.selectionVersionId, selectionVersionId),
      eq(imageCompetitorAssetFacts.status, "confirmed"),
      ne(imageCompetitorResearchSubjects.status, "archived"),
    )).orderBy(asc(imageExpressionAssetLinks.sortOrder), asc(imageExpressionAssetLinks.id));
}

export async function nextExpressionAnalysisVersion(db: DbExecutor, groupId: number) {
  const rows = await db.select({ version: imageExpressionAnalysisVersions.version })
    .from(imageExpressionAnalysisVersions).where(eq(imageExpressionAnalysisVersions.groupId, groupId))
    .orderBy(desc(imageExpressionAnalysisVersions.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function createExpressionAnalysisVersion(db: DbExecutor, values: typeof imageExpressionAnalysisVersions.$inferInsert) {
  const [created] = await db.insert(imageExpressionAnalysisVersions).values(values).$returningId();
  return Number(created.id);
}

export async function getLatestExpressionAnalysis(db: DbExecutor, workspaceId: number, projectId: number, groupId: number) {
  const rows = await db.select().from(imageExpressionAnalysisVersions).where(and(
    eq(imageExpressionAnalysisVersions.workspaceId, workspaceId),
    eq(imageExpressionAnalysisVersions.projectId, projectId),
    eq(imageExpressionAnalysisVersions.groupId, groupId),
    ne(imageExpressionAnalysisVersions.status, "superseded"),
  )).orderBy(desc(imageExpressionAnalysisVersions.version)).limit(1);
  return rows[0] ?? null;
}

export async function updateExpressionAnalysis(input: {
  db: DbExecutor;
  workspaceId: number;
  projectId: number;
  groupId: number;
  analysisId: number;
  values: Partial<typeof imageExpressionAnalysisVersions.$inferInsert>;
}) {
  await input.db.update(imageExpressionAnalysisVersions).set(input.values).where(and(
    eq(imageExpressionAnalysisVersions.workspaceId, input.workspaceId),
    eq(imageExpressionAnalysisVersions.projectId, input.projectId),
    eq(imageExpressionAnalysisVersions.groupId, input.groupId),
    eq(imageExpressionAnalysisVersions.id, input.analysisId),
  ));
}

export async function supersedeExpressionAnalyses(db: DbExecutor, workspaceId: number, projectId: number, groupId: number, excludeId?: number) {
  await db.update(imageExpressionAnalysisVersions).set({ status: "superseded" }).where(and(
    eq(imageExpressionAnalysisVersions.workspaceId, workspaceId),
    eq(imageExpressionAnalysisVersions.projectId, projectId),
    eq(imageExpressionAnalysisVersions.groupId, groupId),
    ne(imageExpressionAnalysisVersions.status, "superseded"),
    ...(excludeId ? [ne(imageExpressionAnalysisVersions.id, excludeId)] : []),
  ));
}

export async function listConfirmedExpressionAnalyses(db: DbExecutor, workspaceId: number, projectId: number) {
  return db.select({
    group: expressionGroups,
    analysis: imageExpressionAnalysisVersions,
    selection: imageExpressionSelectionVersions,
  }).from(imageExpressionAnalysisVersions)
    .innerJoin(expressionGroups, eq(expressionGroups.id, imageExpressionAnalysisVersions.groupId))
    .innerJoin(imageExpressionSelectionVersions, eq(imageExpressionSelectionVersions.id, imageExpressionAnalysisVersions.selectionVersionId))
    .where(and(
      eq(imageExpressionAnalysisVersions.workspaceId, workspaceId),
      eq(imageExpressionAnalysisVersions.projectId, projectId),
      eq(imageExpressionAnalysisVersions.status, "confirmed"),
      eq(imageExpressionSelectionVersions.status, "confirmed"),
    )).orderBy(asc(expressionGroups.sortOrder), asc(expressionGroups.id));
}

export async function nextStep0SynthesisVersion(db: DbExecutor, sessionId: number) {
  const rows = await db.select({ version: imageStep0SynthesisVersions.version })
    .from(imageStep0SynthesisVersions).where(eq(imageStep0SynthesisVersions.sessionId, sessionId))
    .orderBy(desc(imageStep0SynthesisVersions.version)).limit(1);
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function createStep0SynthesisVersion(db: DbExecutor, values: typeof imageStep0SynthesisVersions.$inferInsert) {
  const [created] = await db.insert(imageStep0SynthesisVersions).values(values).$returningId();
  return Number(created.id);
}

export async function getLatestStep0Synthesis(db: DbExecutor, workspaceId: number, projectId: number, sessionId: number) {
  const rows = await db.select().from(imageStep0SynthesisVersions).where(and(
    eq(imageStep0SynthesisVersions.workspaceId, workspaceId),
    eq(imageStep0SynthesisVersions.projectId, projectId),
    eq(imageStep0SynthesisVersions.sessionId, sessionId),
    ne(imageStep0SynthesisVersions.status, "superseded"),
  )).orderBy(desc(imageStep0SynthesisVersions.version)).limit(1);
  return rows[0] ?? null;
}

export async function updateStep0Synthesis(input: {
  db: DbExecutor;
  workspaceId: number;
  projectId: number;
  sessionId: number;
  synthesisId: number;
  values: Partial<typeof imageStep0SynthesisVersions.$inferInsert>;
}) {
  await input.db.update(imageStep0SynthesisVersions).set(input.values).where(and(
    eq(imageStep0SynthesisVersions.workspaceId, input.workspaceId),
    eq(imageStep0SynthesisVersions.projectId, input.projectId),
    eq(imageStep0SynthesisVersions.sessionId, input.sessionId),
    eq(imageStep0SynthesisVersions.id, input.synthesisId),
  ));
}

export async function supersedeStep0Synthesis(db: DbExecutor, workspaceId: number, projectId: number, excludeId?: number) {
  await db.update(imageStep0SynthesisVersions).set({ status: "superseded" }).where(and(
    eq(imageStep0SynthesisVersions.workspaceId, workspaceId),
    eq(imageStep0SynthesisVersions.projectId, projectId),
    ne(imageStep0SynthesisVersions.status, "superseded"),
    ...(excludeId ? [ne(imageStep0SynthesisVersions.id, excludeId)] : []),
  ));
}

export async function getLatestConfirmedStep0Artifact(
  db: DbExecutor,
  workspaceId: number,
  projectId: number,
  artifactType: "competitor_gallery" | "expression_summary" | "composite",
) {
  const rows = await db.select().from(imageWorkflowStep0Artifacts).where(and(
    eq(imageWorkflowStep0Artifacts.workspaceId, workspaceId),
    eq(imageWorkflowStep0Artifacts.projectId, projectId),
    eq(imageWorkflowStep0Artifacts.artifactType, artifactType),
    eq(imageWorkflowStep0Artifacts.status, "confirmed"),
  )).orderBy(desc(imageWorkflowStep0Artifacts.version)).limit(1);
  return rows[0] ?? null;
}

export async function countConfirmedSelectionsWithoutAnalysis(db: DbExecutor, workspaceId: number, projectId: number) {
  const selections = await db.select({
    groupId: imageExpressionSelectionVersions.groupId,
    id: imageExpressionSelectionVersions.id,
  }).from(imageExpressionSelectionVersions).where(and(
    eq(imageExpressionSelectionVersions.workspaceId, workspaceId),
    eq(imageExpressionSelectionVersions.projectId, projectId),
    eq(imageExpressionSelectionVersions.status, "confirmed"),
  ));
  const analyses = await db.select({
    groupId: imageExpressionAnalysisVersions.groupId,
    selectionVersionId: imageExpressionAnalysisVersions.selectionVersionId,
  }).from(imageExpressionAnalysisVersions).where(and(
    eq(imageExpressionAnalysisVersions.workspaceId, workspaceId),
    eq(imageExpressionAnalysisVersions.projectId, projectId),
    eq(imageExpressionAnalysisVersions.status, "confirmed"),
  ));
  const confirmedKeys = new Set(analyses.map((item: { groupId: number; selectionVersionId: number }) => `${item.groupId}:${item.selectionVersionId}`));
  return selections.filter((item: { groupId: number; id: number }) => !confirmedKeys.has(`${item.groupId}:${item.id}`)).length;
}
