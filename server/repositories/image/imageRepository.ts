import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../dbClient";
import {
  registerImageWorkflowArtifact,
  registerImageWorkflowStepArtifact,
} from "../../domains/ai_os/services/businessArtifactRegistry";
import { ImageWorkflowStep4ImageVersion, InsertCompetitorImageAnalysis, InsertExpressionGroup, InsertExpressionGroupImage, InsertImageWorkflowSession, competitorImageAnalyses, expressionGroupImages, expressionGroups, imageWorkflowSessions, imageWorkflowStep4ImageVersions } from "../../../drizzle/schema/image";

function scheduleImageWorkflowArtifactSync(sessionId: number, sourceType: "ai_output" | "user_edit") {
  void registerImageWorkflowArtifact(sessionId, sourceType).catch((error) => {
    console.warn(`[Image Workflow] Artifact sync failed for session ${sessionId}:`, error);
  });
}

function scheduleImageWorkflowStepArtifactSync(
  sessionId: number,
  step: number,
  sourceType: "ai_output" | "user_edit",
) {
  void registerImageWorkflowStepArtifact(sessionId, step, sourceType).catch((error) => {
    console.warn(`[Image Workflow] Step ${step} artifact sync failed for session ${sessionId}:`, error);
  });
}

/**
 * Step4 会在确认路由中执行带超时边界的正式 Artifact 注册。
 * 此处不能再同步等待同一注册，否则会在业务确认写入之前造成前台 Mutation 长时间卡住。
 */
export function shouldDeferImageWorkflowStepArtifactRegistration(step: number, confirmsStep: boolean) {
  return step === 4 && confirmsStep;
}

async function captureImageProject(
  projectId: number | null | undefined,
  sourceType: "ai_output" | "user_edit" = "user_edit",
) {
  if (!projectId) return;
  const session = await getImageWorkflowSessionByProject(projectId);
  if (session) scheduleImageWorkflowArtifactSync(session.id, sourceType);
}

export async function getImageWorkflowSession(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(imageWorkflowSessions)
    .where(and(eq(imageWorkflowSessions.projectId, projectId), eq(imageWorkflowSessions.userId, userId)))
    .orderBy(desc(imageWorkflowSessions.updatedAt))
    .limit(1);
  return rows[0] || null;
}

// Get session by project only (no userId filter) - for admin/designer cross-project access
export async function getImageWorkflowSessionByProject(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(imageWorkflowSessions)
    .where(eq(imageWorkflowSessions.projectId, projectId))
    .orderBy(desc(imageWorkflowSessions.updatedAt))
    .limit(1);
  return rows[0] || null;
}

export async function getImageWorkflowSessionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, id)).limit(1);
  return rows[0] || null;
}

export async function createImageWorkflowSession(data: InsertImageWorkflowSession) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(imageWorkflowSessions).values(data);
  const rows = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, result.insertId)).limit(1);
  scheduleImageWorkflowArtifactSync(result.insertId, "ai_output");
  return rows[0];
}

export async function updateImageWorkflowSession(id: number, data: Partial<InsertImageWorkflowSession>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(imageWorkflowSessions).set(data).where(eq(imageWorkflowSessions.id, id));
  const rows = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, id)).limit(1);
  const changedKeys = Object.keys(data);
  const changedSteps = [...new Set(changedKeys.flatMap((key) => {
    const match = key.match(/^step(\d+)(AiResult|OptimizedResult|UserEdit|Confirmed)/);
    return match ? [Number(match[1])] : [];
  }))];
  for (const step of changedSteps) {
    const confirmsStep = Number((data as any)[`step${step}Confirmed`] || 0) === 1;
    const changesUserOutput = changedKeys.includes(`step${step}UserEdit`);
    const sourceType = confirmsStep || changesUserOutput ? "user_edit" : "ai_output";
    if (shouldDeferImageWorkflowStepArtifactRegistration(step, confirmsStep)) {
      scheduleImageWorkflowStepArtifactSync(id, step, sourceType);
    } else if (confirmsStep) {
      await registerImageWorkflowStepArtifact(id, step, sourceType);
    } else if (sourceType === "ai_output") {
      await registerImageWorkflowStepArtifact(id, step, sourceType);
    } else {
      scheduleImageWorkflowStepArtifactSync(id, step, sourceType);
    }
  }
  return rows[0];
}

export async function deleteImageWorkflowSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, id));
}

export async function getCurrentStep4ImageVersions(sessionId: number): Promise<ImageWorkflowStep4ImageVersion[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(imageWorkflowStep4ImageVersions)
    .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, sessionId), eq(imageWorkflowStep4ImageVersions.isCurrent, 1), eq(imageWorkflowStep4ImageVersions.status, "confirmed")))
    .orderBy(imageWorkflowStep4ImageVersions.imageIndex, desc(imageWorkflowStep4ImageVersions.version));
}

export async function confirmStep4ImageVersion(input: { sessionId: number; projectId: number; userId: number; imageIndex: number; imageKey: string; content: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.transaction(async (tx) => {
    const latest = await tx.select({ version: imageWorkflowStep4ImageVersions.version }).from(imageWorkflowStep4ImageVersions)
      .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, input.sessionId), eq(imageWorkflowStep4ImageVersions.imageIndex, input.imageIndex)))
      .orderBy(desc(imageWorkflowStep4ImageVersions.version)).limit(1);
    await tx.update(imageWorkflowStep4ImageVersions).set({ isCurrent: 0, status: "superseded" })
      .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, input.sessionId), eq(imageWorkflowStep4ImageVersions.imageIndex, input.imageIndex), eq(imageWorkflowStep4ImageVersions.isCurrent, 1)));
    await tx.insert(imageWorkflowStep4ImageVersions).values({ ...input, version: Number(latest[0]?.version || 0) + 1, status: "confirmed", isCurrent: 1 });
  });
  return (await getCurrentStep4ImageVersions(input.sessionId)).find((row) => row.imageIndex === input.imageIndex) ?? null;
}

export async function unlockStep4ImageVersion(sessionId: number, imageIndex: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(imageWorkflowStep4ImageVersions).set({ isCurrent: 0, status: "unlocked" })
    .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, sessionId), eq(imageWorkflowStep4ImageVersions.imageIndex, imageIndex), eq(imageWorkflowStep4ImageVersions.isCurrent, 1)));
}

/** 整体解锁时，历史逐图确认版本不能继续作为下一次整体确认的覆盖来源。 */
export async function unlockAllStep4ImageVersions(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(imageWorkflowStep4ImageVersions).set({ isCurrent: 0, status: "unlocked" })
    .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, sessionId), eq(imageWorkflowStep4ImageVersions.isCurrent, 1)));
}

// ─── Competitor Image Analyses (Step 0 of Image Workflow) ─────────────────────

export async function getCompetitorImagesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(competitorImageAnalyses)
    .where(eq(competitorImageAnalyses.projectId, projectId))
    .orderBy(competitorImageAnalyses.competitorName, competitorImageAnalyses.sortOrder);
}

export async function insertCompetitorImage(data: InsertCompetitorImageAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(competitorImageAnalyses).values(data);
  await captureImageProject(data.projectId);
  return result;
}

export async function updateCompetitorImage(id: number, data: Partial<InsertCompetitorImageAnalysis>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: competitorImageAnalyses.projectId }).from(competitorImageAnalyses).where(eq(competitorImageAnalyses.id, id));
  await db.update(competitorImageAnalyses).set(data).where(eq(competitorImageAnalyses.id, id));
  await captureImageProject(data.projectId ?? existing?.projectId);
}

export async function deleteCompetitorImage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: competitorImageAnalyses.projectId }).from(competitorImageAnalyses).where(eq(competitorImageAnalyses.id, id));
  await db.delete(competitorImageAnalyses).where(eq(competitorImageAnalyses.id, id));
  await captureImageProject(existing?.projectId);
}

export async function deleteCompetitorImagesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(competitorImageAnalyses).where(eq(competitorImageAnalyses.projectId, projectId));
  await captureImageProject(projectId);
}

// ─── Expression Group (Step 0 by expression direction) ────────────────────────
export async function getExpressionGroupsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  const groups = await db.select().from(expressionGroups)
    .where(eq(expressionGroups.projectId, projectId))
    .orderBy(expressionGroups.sortOrder);
  const images = await db.select().from(expressionGroupImages)
    .where(eq(expressionGroupImages.projectId, projectId))
    .orderBy(expressionGroupImages.sortOrder);
  return groups.map(g => ({
    ...g,
    images: images.filter(img => img.groupId === g.id),
  }));
}

export async function insertExpressionGroup(data: InsertExpressionGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(expressionGroups).values(data);
  await captureImageProject(data.projectId);
  return result;
}

export async function updateExpressionGroup(id: number, data: Partial<InsertExpressionGroup>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: expressionGroups.projectId }).from(expressionGroups).where(eq(expressionGroups.id, id));
  await db.update(expressionGroups).set(data).where(eq(expressionGroups.id, id));
  await captureImageProject(
    data.projectId ?? existing?.projectId,
    data.aiAnalysis !== undefined && data.userEdit === undefined ? "ai_output" : "user_edit",
  );
}

export async function deleteExpressionGroup(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: expressionGroups.projectId }).from(expressionGroups).where(eq(expressionGroups.id, id));
  // Delete images first
  await db.delete(expressionGroupImages).where(eq(expressionGroupImages.groupId, id));
  await db.delete(expressionGroups).where(eq(expressionGroups.id, id));
  await captureImageProject(existing?.projectId);
}

export async function insertExpressionGroupImage(data: InsertExpressionGroupImage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(expressionGroupImages).values(data);
  await captureImageProject(data.projectId);
  return result;
}

export async function deleteExpressionGroupImage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: expressionGroupImages.projectId }).from(expressionGroupImages).where(eq(expressionGroupImages.id, id));
  await db.delete(expressionGroupImages).where(eq(expressionGroupImages.id, id));
  await captureImageProject(existing?.projectId);
}

export async function countExpressionGroupImages(groupId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ count: sql<number>`count(*)` })
    .from(expressionGroupImages)
    .where(eq(expressionGroupImages.groupId, groupId));
  return Number(rows[0]?.count ?? 0);
}
