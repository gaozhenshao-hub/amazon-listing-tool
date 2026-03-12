import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  InsertProject, projects,
  InsertCompetitorAnalysis, competitorAnalyses,
  InsertListing, listings,
  InsertImageAnalysis, imageAnalyses,
  InsertReviewImport, reviewImports,
  InsertProjectFile, projectFiles,
  InsertAnalysisVersion, analysisVersions,
  InsertKeyword, keywords,
  InsertNegativeKeyword, negativeKeywords,
  InsertAdStructure, adStructures,
  InsertListingVersion, listingVersions,
  InsertReviewAggregation, reviewAggregations,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User Helpers ───────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Project Helpers ────────────────────────────────────────────

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(projects).where(eq(projects.id, insertId)).limit(1);
  return rows[0];
}

export async function getProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).limit(1);
  return rows[0] ?? null;
}

export async function updateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return getProjectById(id, userId);
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete related data first
  await db.delete(competitorAnalyses).where(eq(competitorAnalyses.projectId, id));
  await db.delete(listings).where(eq(listings.projectId, id));
  await db.delete(imageAnalyses).where(eq(imageAnalyses.projectId, id));
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return { success: true };
}

// ─── Competitor Analysis Helpers ────────────────────────────────

export async function createCompetitorAnalysis(data: InsertCompetitorAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(competitorAnalyses).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, insertId)).limit(1);
  return rows[0];
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

// ─── Listing Helpers ────────────────────────────────────────────

export async function createListing(data: InsertListing) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(listings).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(listings).where(eq(listings.id, insertId)).limit(1);
  return rows[0];
}

export async function getListingsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(listings).where(eq(listings.projectId, projectId)).orderBy(desc(listings.createdAt));
}

export async function getActiveListingByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(listings)
    .where(and(eq(listings.projectId, projectId), eq(listings.isActive, 1)))
    .orderBy(desc(listings.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function getListingById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateListing(id: number, data: Partial<InsertListing>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(listings).set(data).where(eq(listings.id, id));
  const rows = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return rows[0];
}

// ─── Image Analysis Helpers ─────────────────────────────────────

export async function createImageAnalysis(data: InsertImageAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(imageAnalyses).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(imageAnalyses).where(eq(imageAnalyses.id, insertId)).limit(1);
  return rows[0];
}

export async function getImageAnalysesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(imageAnalyses).where(eq(imageAnalyses.projectId, projectId)).orderBy(desc(imageAnalyses.createdAt));
}

// ─── Review Import Helpers ─────────────────────────────────────

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

// ─── Project File Helpers ─────────────────────────────────────

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

// ─── Analysis Version Helpers ─────────────────────────────────

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

// ─── Keyword Helpers ─────────────────────────────────────────

export async function createKeyword(data: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(keywords).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(keywords).where(eq(keywords.id, insertId)).limit(1);
  return rows[0];
}

export async function bulkCreateKeywords(dataArr: InsertKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataArr.length === 0) return [];
  await db.insert(keywords).values(dataArr);
  return { success: true, count: dataArr.length };
}

export async function getKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(keywords)
    .where(and(eq(keywords.projectId, projectId), eq(keywords.isNegative, 0)))
    .orderBy(desc(keywords.updatedAt));
}

export async function getKeywordById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateKeyword(id: number, data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(keywords).set(data).where(eq(keywords.id, id));
  const rows = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return rows[0];
}

export async function bulkUpdateKeywords(ids: number[], data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const id of ids) {
    await db.update(keywords).set(data).where(eq(keywords.id, id));
  }
  return { success: true, count: ids.length };
}

export async function deleteKeyword(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(keywords).where(eq(keywords.id, id));
  return { success: true };
}

export async function deleteKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(keywords).where(eq(keywords.projectId, projectId));
  return { success: true };
}

export async function getKeywordStats(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const all = await db.select().from(keywords).where(eq(keywords.projectId, projectId));
  const total = all.length;
  const byStatus: Record<string, number> = {};
  const byStrategy: Record<string, number> = {};
  const byRoot: Record<string, number> = {};
  const negativeCount = all.filter(k => k.isNegative === 1).length;
  for (const kw of all) {
    byStatus[kw.status] = (byStatus[kw.status] || 0) + 1;
    if (kw.strategyCategory) byStrategy[kw.strategyCategory] = (byStrategy[kw.strategyCategory] || 0) + 1;
    if (kw.rootCategory) byRoot[kw.rootCategory] = (byRoot[kw.rootCategory] || 0) + 1;
  }
  return { total, negativeCount, byStatus, byStrategy, byRoot };
}

// ─── Negative Keyword Helpers ────────────────────────────────

export async function createNegativeKeyword(data: InsertNegativeKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(negativeKeywords).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(negativeKeywords).where(eq(negativeKeywords.id, insertId)).limit(1);
  return rows[0];
}

export async function bulkCreateNegativeKeywords(dataArr: InsertNegativeKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataArr.length === 0) return [];
  await db.insert(negativeKeywords).values(dataArr);
  return { success: true, count: dataArr.length };
}

export async function getNegativeKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(negativeKeywords)
    .where(eq(negativeKeywords.projectId, projectId))
    .orderBy(desc(negativeKeywords.createdAt));
}

export async function deleteNegativeKeyword(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(negativeKeywords).where(eq(negativeKeywords.id, id));
  return { success: true };
}

export async function deleteNegativeKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(negativeKeywords).where(eq(negativeKeywords.projectId, projectId));
  return { success: true };
}

// ─── Ad Structure CRUD ─────────────────────────────────────────

export async function createAdStructure(data: InsertAdStructure) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(adStructures).values(data).$returningId();
  return result;
}

export async function getAdStructuresByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(adStructures).where(eq(adStructures.projectId, projectId)).orderBy(desc(adStructures.createdAt));
}

export async function getAdStructureById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(adStructures).where(eq(adStructures.id, id));
  return rows[0] || null;
}

export async function updateAdStructure(id: number, data: Partial<InsertAdStructure>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adStructures).set(data).where(eq(adStructures.id, id));
  return { success: true };
}

export async function deleteAdStructure(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(adStructures).where(eq(adStructures.id, id));
  return { success: true };
}

// ─── Listing Version History ───

export async function createListingVersion(data: InsertListingVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(listingVersions).values(data);
  return { id: result[0].insertId, ...data };
}

export async function getListingVersionsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(listingVersions).where(eq(listingVersions.projectId, projectId)).orderBy(desc(listingVersions.id));
}

export async function getListingVersionById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(listingVersions).where(eq(listingVersions.id, id));
  return rows[0] || null;
}

export async function getLatestListingVersionNumber(listingId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ versionNumber: listingVersions.versionNumber })
    .from(listingVersions)
    .where(eq(listingVersions.listingId, listingId))
    .orderBy(desc(listingVersions.versionNumber))
    .limit(1);
  return rows[0]?.versionNumber || 0;
}


// ─── Review Aggregation Helpers ────────────────────────────────
export async function createReviewAggregation(data: InsertReviewAggregation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(reviewAggregations).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(reviewAggregations).where(eq(reviewAggregations.id, insertId)).limit(1);
  return rows[0];
}

export async function getReviewAggregationByProject(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(reviewAggregations)
    .where(eq(reviewAggregations.projectId, projectId))
    .orderBy(desc(reviewAggregations.updatedAt))
    .limit(1);
  return rows[0] || null;
}

export async function updateReviewAggregation(id: number, data: Partial<InsertReviewAggregation>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(reviewAggregations).set(data).where(eq(reviewAggregations.id, id));
  const rows = await db.select().from(reviewAggregations).where(eq(reviewAggregations.id, id)).limit(1);
  return rows[0];
}

export async function deleteReviewAggregation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(reviewAggregations).where(eq(reviewAggregations.id, id));
}

