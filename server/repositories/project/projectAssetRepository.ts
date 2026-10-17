import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, type DbExecutor } from "../dbClient";
import { competitorRevision, mergeCompetitorUpdate } from "./competitorWritePolicy";
import {
  InsertAnalysisVersion,
  InsertCompetitorAnalysis,
  InsertCompetitorComparisonReport,
  InsertProjectFile,
  InsertReviewImport,
  analysisVersions,
  competitorAnalyses,
  competitorComparisonReports,
  projectFiles,
  reviewImports,
  projects,
  type CompetitorAnalysis,
} from "../../../drizzle/schema/project";

// --- Competitor Analysis Helpers --------------------------------

async function competitorTransaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品写入需要真实数据库事务" });
  return db.transaction(callback);
}

async function lockCompetitorParent(tx: DbExecutor, projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "项目标识无效" });
  const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).for("update");
  if (rows.length !== 1 || rows[0].id !== projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  return rows[0];
}

async function readLockedCompetitor(tx: DbExecutor, id: number, projectId: number): Promise<CompetitorAnalysis> {
  const rows = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, projectId))).limit(1).for("update");
  if (rows.length !== 1 || rows[0].id !== id || rows[0].projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
  return rows[0];
}

type CompetitorWriteGuard = { projectId: number; expectedRevision: string; userId?: number; workspaceId?: number | null };
async function withLockedCompetitor<T>(id: number, guard: CompetitorWriteGuard | undefined, callback: (tx: DbExecutor, row: CompetitorAnalysis) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "竞品标识无效" });
  if (guard && (!/^[a-f0-9]{64}$/u.test(guard.expectedRevision)
    || (Object.hasOwn(guard, "workspaceId") && guard.userId === undefined)
    || (guard.userId !== undefined && (!Number.isSafeInteger(guard.userId) || guard.userId <= 0
      || !Object.hasOwn(guard, "workspaceId") || (guard.workspaceId !== null
        && (!Number.isSafeInteger(guard.workspaceId) || (guard.workspaceId as number) <= 0)))))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "竞品写入校验范围无效" });
  }
  return competitorTransaction(async tx => {
    // Legacy callers do not supply a parent. This discovery read takes no row lock;
    // the authoritative read is repeated only after the parent is locked.
    const projectId = guard?.projectId ?? (await tx.select({ projectId: competitorAnalyses.projectId }).from(competitorAnalyses).where(eq(competitorAnalyses.id, id)).limit(1))[0]?.projectId;
    if (projectId === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
    const parent = await lockCompetitorParent(tx, projectId);
    if (guard?.userId !== undefined && (parent.userId !== guard.userId
      || (parent.workspaceId !== null && parent.workspaceId !== guard.workspaceId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }
    const row = await readLockedCompetitor(tx, id, projectId);
    if (guard && competitorRevision(row) !== guard.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "竞品资料已变化，请刷新后重试" });
    return callback(tx, row);
  });
}

type LegacyAcquisitionGuard = { userId: number; workspaceId: number; rejectCapturedSource: true };
function assertNotCaptured(row: CompetitorAnalysis) {
  if (!row.rawData) return;
  let raw: unknown;
  try { raw = JSON.parse(row.rawData); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_LEGACY_SOURCE_INVALID" }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_LEGACY_SOURCE_INVALID" });
  if (Object.hasOwn(raw, "acquisitionCapture")) throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_LEGACY_CAPTURE_PROTECTED" });
}
/** A queued legacy job checks this before spending on a model; commit repeats
 * the same fence so capture during the call cannot be overwritten. */
export async function assertLegacyCompetitorAcquisitionWritable(projectId: number, asin: string, guard: LegacyAcquisitionGuard) {
  return competitorTransaction(async tx => {
    const parent = await lockCompetitorParent(tx, projectId);
    if (parent.userId !== guard.userId || parent.workspaceId !== guard.workspaceId) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    const matches: CompetitorAnalysis[] = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.projectId, projectId), eq(competitorAnalyses.asin, asin))).limit(2).for("update");
    if (matches.length > 1) throw new TRPCError({ code: "CONFLICT", message: "同项目竞品记录不唯一" });
    if (matches[0]) assertNotCaptured(matches[0]);
  });
}
async function saveCompetitor(data: InsertCompetitorAnalysis, createOnly: boolean, legacyGuard?: LegacyAcquisitionGuard) {
  return competitorTransaction(async tx => {
    const parent = await lockCompetitorParent(tx, data.projectId);
    if (legacyGuard && (parent.userId !== legacyGuard.userId || parent.workspaceId !== legacyGuard.workspaceId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }
    const matches: CompetitorAnalysis[] = await tx.select().from(competitorAnalyses).where(and(
      eq(competitorAnalyses.projectId, data.projectId), eq(competitorAnalyses.asin, data.asin),
    )).limit(2).for("update");
    if (matches.length > 1 || (createOnly && matches.length)) throw new TRPCError({ code: "CONFLICT", message: "同项目竞品记录已存在或不唯一" });
    if (matches[0]) {
      // A previously queued automatic analysis must never overwrite the new
      // selected-generation lane, even when its model completed after capture.
      if (legacyGuard) assertNotCaptured(matches[0]);
      const update = mergeCompetitorUpdate(matches[0], data, { kind: "upsert" });
      if (Object.keys(update).length) await tx.update(competitorAnalyses).set(update).where(and(eq(competitorAnalyses.id, matches[0].id), eq(competitorAnalyses.projectId, data.projectId)));
      return readLockedCompetitor(tx, matches[0].id, data.projectId);
    }
    const result = await tx.insert(competitorAnalyses).values(data);
    const insertId = result[0]?.insertId;
    if (!Number.isSafeInteger(insertId) || insertId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "竞品写入未返回有效标识" });
    return readLockedCompetitor(tx, insertId, data.projectId);
  });
}

export async function createCompetitorAnalysis(data: InsertCompetitorAnalysis) {
  return saveCompetitor(data, true);
}

/**
 * Upsert competitor analysis: if same projectId+asin exists, update it; otherwise insert new.
 * This prevents duplicate entries when re-uploading the same SellerSprite file.
 */
export async function upsertCompetitorAnalysis(data: InsertCompetitorAnalysis, legacyGuard?: LegacyAcquisitionGuard) {
  return saveCompetitor(data, false, legacyGuard);
}

export async function getCompetitorAnalysesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(competitorAnalyses).where(eq(competitorAnalyses.projectId, projectId)).orderBy(desc(competitorAnalyses.createdAt));
}

export async function getCompetitorAnalysisById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateCompetitorAnalysisSummary(
  id: number,
  data: {
    aiSummary?: string | null;
    summary?: string | null;
    summaryStatus?: "draft" | "confirmed";
    summaryConfirmedBy?: number | null;
    summaryConfirmedAt?: Date | null;
    incrementVersion?: boolean;
  },
  guard?: CompetitorWriteGuard,
) {
  return withLockedCompetitor(id, guard, async (tx, row) => {
    const explicitUnlock = data.summaryStatus === "draft" && data.summaryConfirmedBy === null && data.summaryConfirmedAt === null
      && data.summary === undefined && data.aiSummary === undefined;
    const repeatedConfirmation = row.summaryStatus === "confirmed" && data.summaryStatus === "confirmed"
      && data.summary === row.summary && (data.aiSummary === undefined || data.aiSummary === row.aiSummary);
    if (repeatedConfirmation) return row;
    if (row.summaryStatus === "confirmed" && !explicitUnlock) {
      throw new TRPCError({ code: "CONFLICT", message: "已确认的竞品分析需要先解锁才能编辑" });
    }
    if (data.summaryStatus === "draft" && !explicitUnlock) throw new TRPCError({ code: "BAD_REQUEST", message: "解锁必须明确清除确认人和确认时间" });
    const { incrementVersion, ...values } = data;
    const versionChanged = incrementVersion || data.summaryStatus === "confirmed" || explicitUnlock;
    if (versionChanged && (!Number.isSafeInteger(row.summaryVersion) || row.summaryVersion < 1 || row.summaryVersion >= 2147483647)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品摘要版本无效或已达上限" });
    }
    await tx.update(competitorAnalyses).set({ ...values, ...(versionChanged ? { summaryVersion: row.summaryVersion + 1 } : {}) })
      .where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return readLockedCompetitor(tx, id, row.projectId);
  });
}

export async function createCompetitorComparisonReport(data: InsertCompetitorComparisonReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(competitorComparisonReports).values(data);
  return getCompetitorComparisonReportById(result[0].insertId);
}

export async function getLatestCompetitorComparisonReport(projectId: number, selectionKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(and(
      eq(competitorComparisonReports.projectId, projectId),
      eq(competitorComparisonReports.selectionKey, selectionKey),
    ))
    .orderBy(desc(competitorComparisonReports.createdAt), desc(competitorComparisonReports.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLatestConfirmedCompetitorComparisonReport(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(and(
      eq(competitorComparisonReports.projectId, projectId),
      eq(competitorComparisonReports.status, "confirmed"),
    ))
    .orderBy(desc(competitorComparisonReports.updatedAt), desc(competitorComparisonReports.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCompetitorComparisonReportById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(eq(competitorComparisonReports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateCompetitorComparisonReport(
  id: number,
  data: Partial<InsertCompetitorComparisonReport> & { incrementVersion?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { incrementVersion, ...values } = data;
  await db.update(competitorComparisonReports)
    .set({
      ...values,
      ...(incrementVersion ? { version: sql`${competitorComparisonReports.version} + 1` } : {}),
    })
    .where(eq(competitorComparisonReports.id, id));
  return getCompetitorComparisonReportById(id);
}

export async function updateCompetitorAnalysisReviews(id: number, data: { reviewCount?: string; reviewAnalysis?: string | null; rawData?: string }) {
  return withLockedCompetitor(id, undefined, async (tx, row) => {
    const update = mergeCompetitorUpdate(row, data, { kind: "reviews" });
    if (Object.keys(update).length) await tx.update(competitorAnalyses).set(update).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return readLockedCompetitor(tx, id, row.projectId);
  });
}

export async function deleteCompetitorAnalysis(id: number, guard?: CompetitorWriteGuard) {
  return withLockedCompetitor(id, guard, async (tx, row) => {
    await tx.delete(competitorAnalyses).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return { success: true };
  });
}

// --- Review Import Helpers -----------------------------------------

export async function createReviewImport(data: InsertReviewImport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(reviewImports).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, insertId)).limit(1);
  return rows[0];
}

export async function getReviewImportsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(reviewImports).where(eq(reviewImports.projectId, projectId)).orderBy(desc(reviewImports.createdAt));
}

export async function getReviewImportById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateReviewImport(id: number, data: Partial<InsertReviewImport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reviewImports).set(data).where(eq(reviewImports.id, id));
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, id)).limit(1);
  return rows[0];
}

export async function deleteReviewImport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(reviewImports).where(eq(reviewImports.id, id));
  return { success: true };
}

// --- Project File Helpers -------------------------------------

export async function createProjectFile(data: InsertProjectFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectFiles).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, insertId)).limit(1);
  return rows[0];
}

export async function getProjectFilesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt), desc(projectFiles.id));
}

export async function getProjectFilesByType(projectId: number, fileType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.fileType, fileType as any)))
    .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id));
}

export async function getProjectFileById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateProjectFile(id: number, data: Partial<InsertProjectFile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectFiles).set(data).where(eq(projectFiles.id, id));
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
  return rows[0];
}

export async function deleteProjectFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectFiles).where(eq(projectFiles.id, id));
  return { success: true };
}

// --- Analysis Version Helpers ---------------------------------

export async function createAnalysisVersion(data: InsertAnalysisVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(analysisVersions).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(analysisVersions).where(eq(analysisVersions.id, insertId)).limit(1);
  return rows[0];
}

export async function getAnalysisVersionsByFileId(projectFileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(analysisVersions)
    .where(eq(analysisVersions.projectFileId, projectFileId))
    .orderBy(desc(analysisVersions.version));
}

export async function getAnalysisVersionById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(analysisVersions).where(eq(analysisVersions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getLatestVersionNumber(projectFileId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(analysisVersions)
    .where(eq(analysisVersions.projectFileId, projectFileId))
    .orderBy(desc(analysisVersions.version))
    .limit(1);
  return rows.length > 0 ? rows[0].version : 0;
}

export async function deleteAnalysisVersionsByFileId(projectFileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(analysisVersions).where(eq(analysisVersions.projectFileId, projectFileId));
  return { success: true };
}
