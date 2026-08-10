import { eq, and, desc, sql, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  devProjects, InsertDevProject, DevProject,
  devProjectProgress,
  devUploadedFiles, InsertDevUploadedFile,
  devProducts, InsertDevProduct,
  devReviews, InsertDevReview,
  devTagDimensions, InsertDevTagDimension,
  devExternalData, InsertDevExternalData,
  devAnalysisReports, InsertDevAnalysisReport,
  devProjectScores, InsertDevProjectScore,
  devProductProfiles, InsertDevProductProfile,
  devProductManuals, InsertDevProductManual,
  devTestReports, InsertDevTestReport,
  devBomItems, InsertDevBomItem,
  devMoldCosts, InsertDevMoldCost,
  devTimePlans, InsertDevTimePlan,
  devSuppliers, InsertDevSupplier,
  devBomSummary, InsertDevBomSummary,
  devProfitCalculations, InsertDevProfitCalculation,
  devGlobalSuppliers, InsertDevGlobalSupplier,
  devAnalysisStages, InsertDevAnalysisStage,
  devProductTags, InsertDevProductTag,
  devOffsiteAnalyses, InsertDevOffsiteAnalysis,
  devManualAssets, InsertDevManualAsset,
} from "../../../../drizzle/schema";
import { getDb } from "../../../repositories/dbClient";
import { resolveCurrentDevAnalysisArtifact } from "../../ai_os/services/businessArtifactRegistry";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function withDevProjectWorkspace<T extends { projectId?: number | null; workspaceId?: number | null }>(
  db: DbClient,
  data: T,
): Promise<T> {
  if (data.workspaceId !== undefined && data.workspaceId !== null) return data;
  if (typeof data.projectId !== "number") return data;
  const rows = await db.select({ workspaceId: devProjects.workspaceId })
    .from(devProjects)
    .where(eq(devProjects.id, data.projectId))
    .limit(1);
  return { ...data, workspaceId: rows[0]?.workspaceId ?? null };
}

// ─── Dev Project Helpers ───────────────────────────────────────

export async function getDevProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devProjects).where(eq(devProjects.userId, userId)).orderBy(desc(devProjects.updatedAt));
}

export async function getDevProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devProjects).where(and(eq(devProjects.id, id), eq(devProjects.userId, userId)));
  return rows[0] || null;
}

export async function getDevProjectByWorkspace(id: number, workspaceId: number | null, actorUserId: number) {
  const db = await getDb();
  if (!db) return null;
  const workspaceCondition = workspaceId === null
    ? and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId))
    : or(
        eq(devProjects.workspaceId, workspaceId),
        and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId)),
      );
  const rows = await db.select().from(devProjects).where(and(eq(devProjects.id, id), workspaceCondition));
  return rows[0] || null;
}

export async function getDevProjectsForWorkspace(
  workspaceId: number | null,
  actorUserId: number,
  includeWorkspaceProjects: boolean,
) {
  const db = await getDb();
  if (!db) return [];
  const condition = workspaceId === null
    ? and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId))
    : includeWorkspaceProjects
      ? or(
          eq(devProjects.workspaceId, workspaceId),
          and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId)),
        )
      : and(
          eq(devProjects.userId, actorUserId),
          or(eq(devProjects.workspaceId, workspaceId), isNull(devProjects.workspaceId)),
        );
  const rows = await db.select().from(devProjects).where(condition).orderBy(desc(devProjects.updatedAt));
  const userIds = Array.from(new Set(rows.map((row) => row.userId)));
  if (userIds.length === 0) return [];
  const { users } = await import("../../../../drizzle/schema");
  const userRows = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = Object.fromEntries(userRows.map((user) => [user.id, user.name || "未知"]));
  return rows.map((row) => ({ ...row, ownerName: userMap[row.userId] || "未知用户" }));
}

export async function getDevProjectStatsForWorkspace(
  workspaceId: number | null,
  actorUserId: number,
  includeWorkspaceProjects: boolean,
) {
  const projects = await getDevProjectsForWorkspace(workspaceId, actorUserId, includeWorkspaceProjects);
  const stats = { total: 0, draft: 0, data_collection: 0, analyzing: 0, scoring: 0, completed: 0, archived: 0 };
  for (const project of projects) {
    stats.total += 1;
    stats[project.status] += 1;
  }
  return stats;
}

export async function createDevProject(data: InsertDevProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(devProjects).values(data);
  return { id: result.insertId, ...data };
}

export async function updateDevProject(id: number, userId: number, data: Partial<InsertDevProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devProjects).set(data).where(and(eq(devProjects.id, id), eq(devProjects.userId, userId)));
  return { id, ...data };
}

// Admin-level update: bypasses userId constraint (for approval/revocation by admins)
export async function updateDevProjectAdmin(id: number, data: Partial<InsertDevProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devProjects).set(data).where(eq(devProjects.id, id));
  return { id, ...data };
}

export async function deleteDevProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devProjectProgress).where(eq(devProjectProgress.projectId, id));
  await db.delete(devProjects).where(and(eq(devProjects.id, id), eq(devProjects.userId, userId)));
  return { success: true };
}

export async function getDevProjectStats(userId: number | null) {
  const db = await getDb();
  if (!db) return { total: 0, draft: 0, analyzing: 0, completed: 0, archived: 0 };
  const query = db.select({
    status: devProjects.status,
    count: sql<number>`count(*)`,
  }).from(devProjects);
  // If userId is null, get stats for all projects (admin mode)
  const rows = userId
    ? await query.where(eq(devProjects.userId, userId)).groupBy(devProjects.status)
    : await query.groupBy(devProjects.status);
  const stats = { total: 0, draft: 0, data_collection: 0, analyzing: 0, scoring: 0, completed: 0, archived: 0 };
  for (const row of rows) {
    const s = row.status as keyof typeof stats;
    if (s in stats) stats[s] = Number(row.count);
    stats.total += Number(row.count);
  }
  return stats;
}

// ─── Dev Uploaded Files ────────────────────────────────────────

export async function deleteOldFilesByName(projectId: number, fileType: string, filename: string) {
  const db = await getDb();
  if (!db) return 0;
  // Find existing files with same project, type, and filename
  const existing = await db.select({ id: devUploadedFiles.id })
    .from(devUploadedFiles)
    .where(
      and(
        eq(devUploadedFiles.projectId, projectId),
        eq(devUploadedFiles.fileType, fileType as any),
        eq(devUploadedFiles.filename, filename)
      )
    );
  if (existing.length === 0) return 0;
  // Delete old file records
  const ids = existing.map(f => f.id);
  for (const id of ids) {
    await db.delete(devUploadedFiles).where(eq(devUploadedFiles.id, id));
  }
  return existing.length;
}

export async function createDevUploadedFile(data: InsertDevUploadedFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const [result] = await db.insert(devUploadedFiles).values(values);
  return { id: result.insertId };
}

export async function getDevFilesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devUploadedFiles).where(eq(devUploadedFiles.projectId, projectId)).orderBy(desc(devUploadedFiles.createdAt));
}

export async function updateDevFile(id: number, data: Partial<InsertDevUploadedFile>, projectId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devUploadedFiles).set(data).where(
    projectId === undefined
      ? eq(devUploadedFiles.id, id)
      : and(eq(devUploadedFiles.id, id), eq(devUploadedFiles.projectId, projectId)),
  );
}

export async function confirmDevFilesByType(projectId: number, fileType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devUploadedFiles).set({
    confirmed: 1,
    confirmedAt: new Date(),
  }).where(
    and(eq(devUploadedFiles.projectId, projectId), eq(devUploadedFiles.fileType, fileType as any))
  );
}

export async function unconfirmDevFilesByType(projectId: number, fileType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devUploadedFiles).set({
    confirmed: 0,
    confirmedAt: null,
  }).where(
    and(eq(devUploadedFiles.projectId, projectId), eq(devUploadedFiles.fileType, fileType as any))
  );
}

export async function updateDevFileRowsByType(projectId: number, fileType: string, totalRows: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devUploadedFiles).set({
    totalRows,
    status: "parsed",
  }).where(
    and(eq(devUploadedFiles.projectId, projectId), eq(devUploadedFiles.fileType, fileType as any))
  );
}

export async function getDataConfirmationStatus(projectId: number) {
  const db = await getDb();
  if (!db) return { sales: false, bullet_points: false, reviews: false, history_sales: false };
  const files = await db.select().from(devUploadedFiles).where(eq(devUploadedFiles.projectId, projectId));
  const status: Record<string, { confirmed: boolean; confirmedAt: Date | null; fileCount: number; totalRows: number }> = {};
  for (const ft of ["sales", "bullet_points", "reviews", "history_sales"]) {
    const typeFiles = files.filter(f => f.fileType === ft);
    const confirmedFiles = typeFiles.filter(f => f.confirmed === 1);
    status[ft] = {
      confirmed: confirmedFiles.length > 0,
      confirmedAt: confirmedFiles[0]?.confirmedAt ?? null,
      fileCount: typeFiles.length,
      totalRows: typeFiles.reduce((sum, f) => sum + (f.totalRows || 0), 0),
    };
  }
  return status;
}

// ─── Dev Products ──────────────────────────────────────────────

export async function getDevProductsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devProducts).where(eq(devProducts.projectId, projectId)).orderBy(desc(devProducts.monthlySales));
}

export async function upsertDevProducts(projectId: number, products: InsertDevProduct[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const p of products) {
    const values = await withDevProjectWorkspace(db, { ...p, projectId });
    const existing = await db.select().from(devProducts).where(
      and(eq(devProducts.projectId, projectId), eq(devProducts.asin, p.asin ?? ""))
    );
    if (existing.length > 0) {
      // Only update fields that have non-null, non-empty values
      // This prevents partial uploads (e.g. bullet_points file) from wiping out
      // data saved by earlier uploads (e.g. sales file with monthlySales, bsr, etc.)
      const updateData: Record<string, any> = {};
      for (const [key, value] of Object.entries(values)) {
        if (key === 'projectId' || key === 'asin') continue; // skip identity fields
        if (value !== null && value !== undefined && value !== '' && value !== 0) {
          updateData[key] = value;
        }
      }
      if (Object.keys(updateData).length > 0) {
        await db.update(devProducts).set(updateData).where(eq(devProducts.id, existing[0].id));
      }
    } else {
      await db.insert(devProducts).values(values);
    }
  }
}

export async function updateDevProduct(id: number, data: Partial<InsertDevProduct>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devProducts).set(data).where(eq(devProducts.id, id));
}

// ─── Dev Reviews ───────────────────────────────────────────────

export async function getDevReviewsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devReviews).where(eq(devReviews.projectId, projectId)).orderBy(desc(devReviews.createdAt));
}

export async function insertDevReviews(reviews: InsertDevReview[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (reviews.length === 0) return;
  const values = await Promise.all(reviews.map((review) => withDevProjectWorkspace(db, review)));
  await db.insert(devReviews).values(values);
}

export async function getDevReviewStats(projectId: number) {
  const db = await getDb();
  if (!db) return { total: 0, positive: 0, neutral: 0, negative: 0 };
  const rows = await db.select({
    rating: devReviews.rating,
    count: sql<number>`count(*)`,
  }).from(devReviews).where(eq(devReviews.projectId, projectId)).groupBy(devReviews.rating);
  let total = 0, positive = 0, neutral = 0, negative = 0;
  for (const r of rows) {
    const c = Number(r.count);
    total += c;
    if ((r.rating ?? 0) >= 4) positive += c;
    else if ((r.rating ?? 0) === 3) neutral += c;
    else negative += c;
  }
  return { total, positive, neutral, negative };
}

// ─── Dev Tag Dimensions ────────────────────────────────────────

export async function getDevTagDimensions(userId: number, workspaceId?: number | null) {
  const db = await getDb();
  if (!db) return [];
  const workspaceCondition = workspaceId === undefined
    ? eq(devTagDimensions.userId, userId)
    : workspaceId === null
      ? and(eq(devTagDimensions.userId, userId), isNull(devTagDimensions.workspaceId))
      : and(
          eq(devTagDimensions.userId, userId),
          or(eq(devTagDimensions.workspaceId, workspaceId), isNull(devTagDimensions.workspaceId)),
        );
  return db.select().from(devTagDimensions).where(workspaceCondition);
}

export async function createDevTagDimension(data: InsertDevTagDimension) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(devTagDimensions).values(data);
  return { id: result.insertId };
}

export async function deleteDevTagDimension(id: number, userId: number, workspaceId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const workspaceCondition = workspaceId === undefined
    ? undefined
    : workspaceId === null
      ? isNull(devTagDimensions.workspaceId)
      : or(eq(devTagDimensions.workspaceId, workspaceId), isNull(devTagDimensions.workspaceId));
  await db.delete(devTagDimensions).where(and(
    eq(devTagDimensions.id, id),
    eq(devTagDimensions.userId, userId),
    workspaceCondition,
  ));
}

// ─── Dev External Data ─────────────────────────────────────────

export async function getDevExternalData(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devExternalData).where(eq(devExternalData.projectId, projectId)).orderBy(desc(devExternalData.createdAt));
}

export async function createDevExternalData(data: InsertDevExternalData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const [result] = await db.insert(devExternalData).values(values);
  return { id: result.insertId };
}

export async function updateDevExternalData(id: number, data: Partial<InsertDevExternalData>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devExternalData).set(data).where(eq(devExternalData.id, id));
}

// ─── Dev Analysis Reports ──────────────────────────────────────

export async function getDevReports(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devAnalysisReports).where(eq(devAnalysisReports.projectId, projectId)).orderBy(desc(devAnalysisReports.createdAt));
}

export async function getDevReport(projectId: number, reportType: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devAnalysisReports).where(
    and(eq(devAnalysisReports.projectId, projectId), eq(devAnalysisReports.reportType, reportType as any))
  );
  return rows[0] || null;
}

export async function upsertDevReport(data: InsertDevAnalysisReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devAnalysisReports).where(
    and(eq(devAnalysisReports.projectId, data.projectId), eq(devAnalysisReports.reportType, data.reportType))
  );
  if (existing.length > 0) {
    await db.update(devAnalysisReports).set(values).where(eq(devAnalysisReports.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devAnalysisReports).values(values);
  return { id: result.insertId };
}

// ─── Dev Project Scores ────────────────────────────────────────

export async function getDevProjectScore(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devProjectScores).where(eq(devProjectScores.projectId, projectId));
  return rows[0] || null;
}

export async function upsertDevProjectScore(data: InsertDevProjectScore) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devProjectScores).where(eq(devProjectScores.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProjectScores).set(values).where(eq(devProjectScores.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProjectScores).values(values);
  return { id: result.insertId };
}

// ─── Dev Product Profiles ──────────────────────────────────────

export async function getDevProductProfile(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devProductProfiles).where(eq(devProductProfiles.projectId, projectId));
  return rows[0] || null;
}

export async function upsertDevProductProfile(data: InsertDevProductProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devProductProfiles).where(eq(devProductProfiles.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProductProfiles).set(values).where(eq(devProductProfiles.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProductProfiles).values(values);
  return { id: result.insertId };
}

// ─── Dev Product Manuals ───────────────────────────────────────

export async function getDevManual(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devProductManuals).where(eq(devProductManuals.projectId, projectId));
  return rows[0] || null;
}

export async function upsertDevManual(data: InsertDevProductManual) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devProductManuals).where(eq(devProductManuals.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProductManuals).set(values).where(eq(devProductManuals.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProductManuals).values(values);
  return { id: result.insertId };
}

// ─── Dev Test Reports ──────────────────────────────────────────

export async function getDevTestReport(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devTestReports).where(eq(devTestReports.projectId, projectId));
  return rows[0] || null;
}

export async function upsertDevTestReport(data: InsertDevTestReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devTestReports).where(eq(devTestReports.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devTestReports).set(values).where(eq(devTestReports.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devTestReports).values(values);
  return { id: result.insertId };
}

// ─── Dev BOM Items ─────────────────────────────────────────────

export async function getDevBomItems(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devBomItems).where(eq(devBomItems.projectId, projectId));
}

export async function saveDevBomItem(data: InsertDevBomItem & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  if (values.id) {
    await db.update(devBomItems).set(values).where(eq(devBomItems.id, values.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devBomItems).values(values);
  return { id: result.insertId };
}

export async function deleteDevBomItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devBomItems).where(eq(devBomItems.id, id));
}

// ─── Dev Mold Costs ────────────────────────────────────────────

export async function getDevMoldCosts(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devMoldCosts).where(eq(devMoldCosts.projectId, projectId));
}

export async function saveDevMoldCost(data: InsertDevMoldCost & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  if (values.id) {
    await db.update(devMoldCosts).set(values).where(eq(devMoldCosts.id, values.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devMoldCosts).values(values);
  return { id: result.insertId };
}

export async function deleteDevMoldCost(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devMoldCosts).where(eq(devMoldCosts.id, id));
}

// ─── Dev Time Plans ────────────────────────────────────────────

export async function getDevTimePlans(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devTimePlans).where(eq(devTimePlans.projectId, projectId)).orderBy(devTimePlans.startOffset);
}

export async function saveDevTimePlan(data: InsertDevTimePlan & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  if (values.id) {
    await db.update(devTimePlans).set(values).where(eq(devTimePlans.id, values.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devTimePlans).values(values);
  return { id: result.insertId };
}

export async function deleteDevTimePlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devTimePlans).where(eq(devTimePlans.id, id));
}

// ─── Dev Suppliers (Project-level) ─────────────────────────────

export async function getDevSuppliers(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devSuppliers).where(eq(devSuppliers.projectId, projectId));
}

export async function saveDevSupplier(data: InsertDevSupplier & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  if (values.id) {
    await db.update(devSuppliers).set(values).where(eq(devSuppliers.id, values.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devSuppliers).values(values);
  return { id: result.insertId };
}

export async function deleteDevSupplier(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devSuppliers).where(eq(devSuppliers.id, id));
}

// ─── Dev BOM Summary ───────────────────────────────────────────

export async function getDevBomSummary(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devBomSummary).where(eq(devBomSummary.projectId, projectId));
  return rows[0] || null;
}

export async function upsertDevBomSummary(data: InsertDevBomSummary) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const existing = await db.select().from(devBomSummary).where(eq(devBomSummary.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devBomSummary).set(values).where(eq(devBomSummary.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devBomSummary).values(values);
  return { id: result.insertId };
}

// ─── Dev Profit Calculations ───────────────────────────────────

export async function getDevProfitCalculations(userId: number, workspaceId?: number | null, projectId?: number) {
  const db = await getDb();
  if (!db) return [];
  const workspaceCondition = workspaceId === undefined
    ? undefined
    : workspaceId === null
      ? isNull(devProfitCalculations.workspaceId)
      : or(eq(devProfitCalculations.workspaceId, workspaceId), isNull(devProfitCalculations.workspaceId));
  return db.select().from(devProfitCalculations).where(and(
    eq(devProfitCalculations.userId, userId),
    workspaceCondition,
    projectId === undefined ? undefined : eq(devProfitCalculations.projectId, projectId),
  )).orderBy(desc(devProfitCalculations.updatedAt));
}

export async function saveDevProfitCalculation(data: InsertDevProfitCalculation & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  if (values.id) {
    await db.update(devProfitCalculations).set(values).where(and(
      eq(devProfitCalculations.id, values.id),
      eq(devProfitCalculations.userId, values.userId),
    ));
    return { id: data.id };
  }
  const [result] = await db.insert(devProfitCalculations).values(values);
  return { id: result.insertId };
}

export async function deleteDevProfitCalculation(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devProfitCalculations).where(and(eq(devProfitCalculations.id, id), eq(devProfitCalculations.userId, userId)));
}

// ─── Dev Global Suppliers ──────────────────────────────────────

export async function getDevGlobalSuppliers(userId: number, workspaceId?: number | null) {
  const db = await getDb();
  if (!db) return [];
  const workspaceCondition = workspaceId === undefined
    ? eq(devGlobalSuppliers.userId, userId)
    : workspaceId === null
      ? and(eq(devGlobalSuppliers.userId, userId), isNull(devGlobalSuppliers.workspaceId))
      : and(
          eq(devGlobalSuppliers.userId, userId),
          or(eq(devGlobalSuppliers.workspaceId, workspaceId), isNull(devGlobalSuppliers.workspaceId)),
        );
  return db.select().from(devGlobalSuppliers).where(workspaceCondition).orderBy(desc(devGlobalSuppliers.updatedAt));
}

export async function saveDevGlobalSupplier(data: InsertDevGlobalSupplier & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.id) {
    const workspaceCondition = data.workspaceId === undefined
      ? undefined
      : data.workspaceId === null
        ? isNull(devGlobalSuppliers.workspaceId)
        : or(eq(devGlobalSuppliers.workspaceId, data.workspaceId), isNull(devGlobalSuppliers.workspaceId));
    await db.update(devGlobalSuppliers).set(data).where(and(
      eq(devGlobalSuppliers.id, data.id),
      eq(devGlobalSuppliers.userId, data.userId),
      workspaceCondition,
    ));
    return { id: data.id };
  }
  const [result] = await db.insert(devGlobalSuppliers).values(data);
  return { id: result.insertId };
}

export async function deleteDevGlobalSupplier(id: number, userId: number, workspaceId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const workspaceCondition = workspaceId === undefined
    ? undefined
    : workspaceId === null
      ? isNull(devGlobalSuppliers.workspaceId)
      : or(eq(devGlobalSuppliers.workspaceId, workspaceId), isNull(devGlobalSuppliers.workspaceId));
  await db.delete(devGlobalSuppliers).where(and(
    eq(devGlobalSuppliers.id, id),
    eq(devGlobalSuppliers.userId, userId),
    workspaceCondition,
  ));
}

// ─── Dev Analysis Stages ──────────────────────────────────────

export async function getDevAnalysisStages(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  const stages = await db.select().from(devAnalysisStages).where(eq(devAnalysisStages.projectId, projectId));
  return Promise.all(stages.map(async (stage) => {
    if (stage.status !== "confirmed") return stage;
    const artifact = await resolveCurrentDevAnalysisArtifact(stage.id).catch(() => null);
    if (!artifact) return stage;
    return {
      ...stage,
      rawResult: null,
      editedResult: typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content),
    };
  }));
}

export async function getDevAnalysisStage(projectId: number, stageType: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devAnalysisStages).where(
    and(eq(devAnalysisStages.projectId, projectId), eq(devAnalysisStages.stageType, stageType as any))
  );
  const stage = rows[0] || null;
  if (!stage || stage.status !== "confirmed") return stage;
  const artifact = await resolveCurrentDevAnalysisArtifact(stage.id).catch(() => null);
  if (!artifact) return stage;
  return {
    ...stage,
    rawResult: null,
    editedResult: typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content),
  };
}

export async function upsertDevAnalysisStage(data: InsertDevAnalysisStage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const updateSet = Object.fromEntries(
    Object.entries(values).filter(([key, value]) => (
      !["id", "projectId", "stageType", "createdAt", "rowVersion"].includes(key) && value !== undefined
    )),
  );
  await db.insert(devAnalysisStages).values(values).onDuplicateKeyUpdate({
    set: {
      ...updateSet,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
    } as any,
  });
  const [stage] = await db.select().from(devAnalysisStages).where(
    and(eq(devAnalysisStages.projectId, data.projectId), eq(devAnalysisStages.stageType, data.stageType)),
  ).limit(1);
  if (!stage) throw new Error("Analysis stage upsert did not return a row");
  return stage;
}

export async function claimDevAnalysisStageRun(input: {
  projectId: number;
  userId: number;
  stageType: InsertDevAnalysisStage["stageType"];
  runId?: string;
  staleAfterSeconds?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const runId = input.runId || `devstage_${randomUUID()}`;
  const staleAfterSeconds = Math.max(60, Math.min(input.staleAfterSeconds ?? 900, 86_400));
  const staleBefore = new Date(Date.now() - staleAfterSeconds * 1_000);
  const values = await withDevProjectWorkspace(db, {
    workspaceId: undefined as number | null | undefined,
    projectId: input.projectId,
    userId: input.userId,
    stageType: input.stageType,
    status: "running" as const,
    rawResult: null,
    editedResult: null,
    runId,
    runProgress: 5,
    runError: null,
    runStartedAt: new Date(),
    runCompletedAt: null,
    confirmedAt: null,
    rowVersion: 1,
    lastMutationKey: `run:${runId}`,
  });
  const claimable = sql`(
    ${devAnalysisStages.status} NOT IN ('running', 'generating')
    OR ${devAnalysisStages.runStartedAt} IS NULL
    OR ${devAnalysisStages.runStartedAt} < ${staleBefore}
    OR ${devAnalysisStages.runId} = ${runId}
  )`;

  await db.insert(devAnalysisStages).values(values).onDuplicateKeyUpdate({
    set: {
      workspaceId: sql`IF(${claimable}, ${values.workspaceId ?? null}, ${devAnalysisStages.workspaceId})`,
      userId: sql`IF(${claimable}, ${input.userId}, ${devAnalysisStages.userId})`,
      status: sql`IF(${claimable}, 'running', ${devAnalysisStages.status})`,
      rawResult: sql`${devAnalysisStages.rawResult}`,
      editedResult: sql`${devAnalysisStages.editedResult}`,
      runId: sql`IF(${claimable}, ${runId}, ${devAnalysisStages.runId})`,
      runProgress: sql`IF(${claimable}, 5, ${devAnalysisStages.runProgress})`,
      runError: sql`IF(${claimable}, NULL, ${devAnalysisStages.runError})`,
      runStartedAt: sql`IF(${claimable}, NOW(), ${devAnalysisStages.runStartedAt})`,
      runCompletedAt: sql`IF(${claimable}, NULL, ${devAnalysisStages.runCompletedAt})`,
      confirmedAt: sql`IF(${claimable}, NULL, ${devAnalysisStages.confirmedAt})`,
      rowVersion: sql`IF(${claimable}, ${devAnalysisStages.rowVersion} + 1, ${devAnalysisStages.rowVersion})`,
      lastMutationKey: sql`IF(${claimable}, ${`run:${runId}`}, ${devAnalysisStages.lastMutationKey})`,
    },
  });

  const [stage] = await db.select().from(devAnalysisStages).where(and(
    eq(devAnalysisStages.projectId, input.projectId),
    eq(devAnalysisStages.stageType, input.stageType),
  )).limit(1);
  if (!stage) throw new Error("Analysis stage claim did not return a row");
  return { ...stage, claimed: stage.runId === runId, requestedRunId: runId };
}

export async function updateDevAnalysisStageForRun(
  projectId: number,
  stageType: string,
  runId: string,
  data: Partial<InsertDevAnalysisStage>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devAnalysisStages).set({
    ...data,
    rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
  }).where(and(
    eq(devAnalysisStages.projectId, projectId),
    eq(devAnalysisStages.stageType, stageType as any),
    eq(devAnalysisStages.runId, runId),
  ));
  const rows = await db.select().from(devAnalysisStages).where(and(
    eq(devAnalysisStages.projectId, projectId),
    eq(devAnalysisStages.stageType, stageType as any),
    eq(devAnalysisStages.runId, runId),
  )).limit(1);
  return rows[0] || null;
}

export async function failDevAnalysisStageRun(
  projectId: number,
  stageType: InsertDevAnalysisStage["stageType"],
  runId: string,
  error: unknown,
) {
  return updateDevAnalysisStageForRun(projectId, stageType, runId, {
    status: sql`IF(${devAnalysisStages.rawResult} IS NULL AND ${devAnalysisStages.editedResult} IS NULL, 'pending', 'generated')` as any,
    runProgress: 0,
    runError: (error instanceof Error ? error.message : String(error || "分析失败")).slice(0, 1_000),
    runCompletedAt: new Date(),
  });
}

export async function confirmDevAnalysisStage(projectId: number, stageType: string, editedResult?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const update: Partial<InsertDevAnalysisStage> = {
    status: "confirmed",
    confirmedAt: new Date(),
  };
  if (editedResult !== undefined) update.editedResult = editedResult;
  await db.update(devAnalysisStages).set(update).where(
    and(eq(devAnalysisStages.projectId, projectId), eq(devAnalysisStages.stageType, stageType as any))
  );
}

export async function unlockDevAnalysisStage(projectId: number, stageType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devAnalysisStages).set({
    status: "generated",
    confirmedAt: null,
  }).where(
    and(eq(devAnalysisStages.projectId, projectId), eq(devAnalysisStages.stageType, stageType as any))
  );
}

export async function invalidateDevAnalysisStages(projectId: number, stageTypes: string[]) {
  if (stageTypes.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devAnalysisStages).set({
    status: "generated",
    confirmedAt: null,
  }).where(and(
    eq(devAnalysisStages.projectId, projectId),
    inArray(devAnalysisStages.stageType, stageTypes as any[]),
  ));
}

// --- Dev Product Tags ---

export async function getDevProductTags(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devProductTags).where(eq(devProductTags.projectId, projectId));
}

export async function getDevProductTagsByAsin(projectId: number, asin: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devProductTags).where(
    and(eq(devProductTags.projectId, projectId), eq(devProductTags.asin, asin))
  );
}

// NOTE: bulkInsertDevProductTags and updateDevProductTag removed — attribute tagging now handled by devTagging router.

export async function confirmAllDevProductTags(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devProductTags).set({ confirmed: 1 }).where(eq(devProductTags.projectId, projectId));
}

export async function deleteDevProductTagsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devProductTags).where(eq(devProductTags.projectId, projectId));
}

// ─── Enhanced Review Helpers ──────────────────────────────────

export async function getDevReviewsByAsin(projectId: number, asin: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devReviews).where(
    and(eq(devReviews.projectId, projectId), eq(devReviews.asin, asin))
  );
}

export async function getDevAllReviews(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devReviews).where(eq(devReviews.projectId, projectId));
}


// ─── Off-site Analysis Helpers ────────────────────────────────
export async function createOffsiteAnalysis(data: InsertDevOffsiteAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  const result = await db.insert(devOffsiteAnalyses).values(values);
  return result[0].insertId;
}

export async function getOffsiteAnalysesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devOffsiteAnalyses)
    .where(eq(devOffsiteAnalyses.projectId, projectId))
    .orderBy(devOffsiteAnalyses.createdAt);
}

export async function getOffsiteAnalysesBySource(projectId: number, sourceType: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devOffsiteAnalyses)
    .where(and(
      eq(devOffsiteAnalyses.projectId, projectId),
      eq(devOffsiteAnalyses.sourceType, sourceType as any)
    ))
    .orderBy(devOffsiteAnalyses.createdAt);
}

export async function getOffsiteAnalysisById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devOffsiteAnalyses)
    .where(eq(devOffsiteAnalyses.id, id));
  return rows[0] ?? null;
}

export async function updateOffsiteAnalysis(id: number, data: Partial<{
  status: string;
  rawData: any;
  aiAnalysis: string;
  aiAnalysisConfirmed: number;
  editedAnalysis: string;
  errorMessage: string;
  updatedAt: number;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devOffsiteAnalyses).set(data as any).where(eq(devOffsiteAnalyses.id, id));
}

export async function deleteOffsiteAnalysis(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devOffsiteAnalyses).where(eq(devOffsiteAnalyses.id, id));
}

// ─── Dev Manual Assets ────────────────────────────────────────

export async function getDevManualAssets(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devManualAssets).where(eq(devManualAssets.projectId, projectId)).orderBy(devManualAssets.sortOrder);
}

export async function getDevManualAssetsByType(projectId: number, assetType: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devManualAssets).where(
    and(eq(devManualAssets.projectId, projectId), eq(devManualAssets.assetType, assetType as any))
  );
}

export async function upsertDevManualAsset(data: InsertDevManualAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = await withDevProjectWorkspace(db, data);
  // For logo/cover/content_bg/qrcode, replace existing
  if (["logo", "cover", "content_bg", "qrcode"].includes(values.assetType)) {
    const existing = await db.select().from(devManualAssets).where(
      and(eq(devManualAssets.projectId, values.projectId), eq(devManualAssets.assetType, values.assetType as any))
    );
    if (existing.length > 0) {
      await db.update(devManualAssets).set(values).where(eq(devManualAssets.id, existing[0].id));
      return { id: existing[0].id };
    }
  }
  const [result] = await db.insert(devManualAssets).values(values);
  return { id: result.insertId };
}

export async function deleteDevManualAsset(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devManualAssets).where(eq(devManualAssets.id, id));
}

// ─── Admin: get all dev projects ───
export async function getAllDevProjects() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(devProjects).orderBy(desc(devProjects.updatedAt));
  const userIds = Array.from(new Set(rows.map(r => r.userId)));
  let userMap: Record<number, string> = {};
  if (userIds.length > 0) {
    const { users } = await import("../../../../drizzle/schema");
    const userRows = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    userMap = Object.fromEntries(userRows.map(u => [u.id, u.name || '未知']));
  }
  return rows.map(r => ({ ...r, ownerName: userMap[r.userId] || '未知用户' }));
}

export async function getDevProjectByIdAdmin(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(devProjects).where(eq(devProjects.id, id));
  return rows[0] || null;
}
