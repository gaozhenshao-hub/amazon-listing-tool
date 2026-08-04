import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../dbClient";
import { InsertAnalysisVersion, InsertCompetitorAnalysis, InsertProjectFile, InsertReviewImport, analysisVersions, competitorAnalyses, projectFiles, reviewImports } from "../../../drizzle/schema/project";

// --- Competitor Analysis Helpers --------------------------------

export async function createCompetitorAnalysis(data: InsertCompetitorAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(competitorAnalyses).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, insertId)).limit(1);
  return rows[0];
}

/**
 * Upsert competitor analysis: if same projectId+asin exists, update it; otherwise insert new.
 * This prevents duplicate entries when re-uploading the same SellerSprite file.
 */
export async function upsertCompetitorAnalysis(data: InsertCompetitorAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if an entry with same projectId + asin already exists
  const existing = await db.select({ id: competitorAnalyses.id })
    .from(competitorAnalyses)
    .where(and(
      eq(competitorAnalyses.projectId, data.projectId),
      eq(competitorAnalyses.asin, data.asin)
    ))
    .limit(1);
  
  if (existing.length > 0) {
    // Update existing record
    const { projectId, asin, ...updateData } = data;
    await db.update(competitorAnalyses)
      .set(updateData)
      .where(eq(competitorAnalyses.id, existing[0].id));
    const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, existing[0].id)).limit(1);
    return rows[0];
  } else {
    // Insert new record
    const result = await db.insert(competitorAnalyses).values(data);
    const insertId = result[0].insertId;
    const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, insertId)).limit(1);
    return rows[0];
  }
}

export async function getCompetitorAnalysesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(competitorAnalyses).where(eq(competitorAnalyses.projectId, projectId)).orderBy(desc(competitorAnalyses.createdAt));
}

export async function updateCompetitorAnalysisReviews(id: number, data: { reviewCount?: string; reviewAnalysis?: string; rawData?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(competitorAnalyses).set(data).where(eq(competitorAnalyses.id, id));
  const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, id)).limit(1);
  return rows[0];
}

export async function deleteCompetitorAnalysis(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(competitorAnalyses).where(eq(competitorAnalyses.id, id));
  return { success: true };
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
  return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt));
}

export async function getProjectFilesByType(projectId: number, fileType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.fileType, fileType as any)))
    .orderBy(desc(projectFiles.createdAt));
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
