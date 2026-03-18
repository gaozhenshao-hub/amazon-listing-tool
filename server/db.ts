import { eq, desc, and, or, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  InsertProject, projects,
  InsertCompetitorAnalysis, competitorAnalyses,
  InsertListing, listings,

  InsertReviewImport, reviewImports,
  InsertProjectFile, projectFiles,
  InsertAnalysisVersion, analysisVersions,
  InsertKeyword, keywords,
  InsertNegativeKeyword, negativeKeywords,
  InsertAdStructure, adStructures,
  InsertListingVersion, listingVersions,
  InsertReviewAggregation, reviewAggregations,
  InsertLoginLog, loginLogs,
  rolePermissions,
  notifications, InsertNotification,
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

// --- Review Import Helpers ---

export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {};
    if (user.openId) values.openId = user.openId;
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "phone", "department", "jobTitle"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      (values as any)[field] = normalized;
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
    } else if (user.openId && user.openId === ENV.ownerOpenId) {
      values.role = 'super_admin';
      updateSet.role = 'super_admin';
    }
    if (user.password !== undefined) {
      values.password = user.password;
      updateSet.password = user.password;
    }
    if (user.status !== undefined) {
      values.status = user.status;
      updateSet.status = user.status;
    }
    if (user.mustChangePassword !== undefined) {
      values.mustChangePassword = user.mustChangePassword;
      updateSet.mustChangePassword = user.mustChangePassword;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    if (user.openId) {
      await db.insert(users).values(values).onDuplicateKeyUpdate({
        set: updateSet,
      });
    } else {
      // Password-based user without openId
      await db.insert(users).values(values);
    }
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

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmailOrPhone(identifier: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(
    or(eq(users.email, identifier), eq(users.phone, identifier))
  ).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    phone: users.phone,
    role: users.role,
    department: users.department,
    jobTitle: users.jobTitle,
    status: users.status,
    mustChangePassword: users.mustChangePassword,
    invitedBy: users.invitedBy,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(users.createdAt);
}

export async function updateUserById(userId: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set(data).where(eq(users.id, userId));
}

export async function updateLoginAttempts(userId: number, attempts: number, lockedUntil: Date | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({
    failedLoginAttempts: attempts,
    lockedUntil,
  }).where(eq(users.id, userId));
}

export async function insertLoginLog(log: InsertLoginLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(loginLogs).values(log);
}

export async function getLoginLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loginLogs).orderBy(desc(loginLogs.createdAt)).limit(limit);
}

// --- Project Helpers ----------------------------------------------------

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
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return { success: true };
}

// --- Competitor Analysis Helpers --------------------------------

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

// --- Listing Helpers --------------------------------------------

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

// --- Keyword Helpers -----------------------------------------

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

// --- Negative Keyword Helpers --------------------------------

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

// --- Ad Structure CRUD -----------------------------------------

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

// --- Listing Version History ---

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


// --- Review Aggregation Helpers --------------------------------
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

// --- Image Workflow Sessions --------------------------------------
import { imageWorkflowSessions, InsertImageWorkflowSession } from "../drizzle/schema";

export async function getImageWorkflowSession(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(imageWorkflowSessions)
    .where(and(eq(imageWorkflowSessions.projectId, projectId), eq(imageWorkflowSessions.userId, userId)))
    .orderBy(desc(imageWorkflowSessions.updatedAt))
    .limit(1);
  return rows[0] || null;
}

export async function createImageWorkflowSession(data: InsertImageWorkflowSession) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(imageWorkflowSessions).values(data);
  const rows = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, result.insertId)).limit(1);
  return rows[0];
}

export async function updateImageWorkflowSession(id: number, data: Partial<InsertImageWorkflowSession>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(imageWorkflowSessions).set(data).where(eq(imageWorkflowSessions.id, id));
  const rows = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, id)).limit(1);
  return rows[0];
}

export async function deleteImageWorkflowSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, id));
}

// --- Role Permissions Helpers --------------------------------------

export async function getAllRolePermissions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rolePermissions).orderBy(rolePermissions.role);
}

export async function getRolePermission(role: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  return rows[0] || null;
}

export async function upsertRolePermission(
  role: string,
  modules: string[],
  description: string | null,
  updatedBy: number | null,
  detailedPerms?: any[] | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getRolePermission(role);
  const setData: any = {
    modules: JSON.stringify(modules),
    description,
    updatedBy,
  };
  if (detailedPerms !== undefined) {
    setData.detailedPermissions = detailedPerms ? JSON.stringify(detailedPerms) : null;
  }
  if (existing) {
    await db.update(rolePermissions).set(setData).where(eq(rolePermissions.role, role));
  } else {
    await db.insert(rolePermissions).values({
      role,
      modules: JSON.stringify(modules),
      detailedPermissions: detailedPerms ? JSON.stringify(detailedPerms) : null,
      description,
      updatedBy,
    });
  }
}

// --- Notifications ---
export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(notifications).values(data);
  return { id: result[0].insertId };
}

export async function createBulkNotifications(items: InsertNotification[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (items.length === 0) return;
  await db.insert(notifications).values(items);
}

export async function getNotificationsByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
  return rows.length;
}

export async function markNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(notifications).set({ isRead: 1 })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(notifications).set({ isRead: 1 })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
}

// Get admin/manager users for notification targeting
export async function getAdminUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(
      or(
        eq(users.role, "super_admin"),
        eq(users.role, "admin"),
        eq(users.role, "ops_manager")
      ),
      eq(users.status, "active")
    ));
}

// --- Admin: get all projects (for super_admin/admin) ---
export async function getAllProjects() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({
    id: projects.id,
    name: projects.name,
    brand: projects.brand,
    productName: projects.productName,
    category: projects.category,
    targetMarket: projects.targetMarket,
    status: projects.status,
    userId: projects.userId,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  }).from(projects).orderBy(desc(projects.updatedAt));

  // Enrich with user info
  const userIds = Array.from(new Set(rows.map(r => r.userId)));
  let userMap: Record<number, string> = {};
  if (userIds.length > 0) {
    const userRows = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    userMap = Object.fromEntries(userRows.map(u => [u.id, u.name || '未知']));
  }

  return rows.map(r => ({
    ...r,
    ownerName: userMap[r.userId] || '未知用户',
  }));
}

export async function getProjectByIdAdmin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0] ?? null;
}
