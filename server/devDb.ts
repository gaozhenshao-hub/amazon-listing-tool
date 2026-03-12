import { eq, and, desc, sql } from "drizzle-orm";
import {
  devProjects, InsertDevProject, DevProject,
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
} from "../drizzle/schema";
import { getDb } from "./db";

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

export async function deleteDevProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devProjects).where(and(eq(devProjects.id, id), eq(devProjects.userId, userId)));
  return { success: true };
}

export async function getDevProjectStats(userId: number) {
  const db = await getDb();
  if (!db) return { total: 0, draft: 0, analyzing: 0, completed: 0, archived: 0 };
  const rows = await db.select({
    status: devProjects.status,
    count: sql<number>`count(*)`,
  }).from(devProjects).where(eq(devProjects.userId, userId)).groupBy(devProjects.status);
  const stats = { total: 0, draft: 0, data_collection: 0, analyzing: 0, scoring: 0, completed: 0, archived: 0 };
  for (const row of rows) {
    const s = row.status as keyof typeof stats;
    if (s in stats) stats[s] = Number(row.count);
    stats.total += Number(row.count);
  }
  return stats;
}

// ─── Dev Uploaded Files ────────────────────────────────────────

export async function createDevUploadedFile(data: InsertDevUploadedFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(devUploadedFiles).values(data);
  return { id: result.insertId };
}

export async function getDevFilesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devUploadedFiles).where(eq(devUploadedFiles.projectId, projectId)).orderBy(desc(devUploadedFiles.createdAt));
}

export async function updateDevFile(id: number, data: Partial<InsertDevUploadedFile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(devUploadedFiles).set(data).where(eq(devUploadedFiles.id, id));
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
    const existing = await db.select().from(devProducts).where(
      and(eq(devProducts.projectId, projectId), eq(devProducts.asin, p.asin ?? ""))
    );
    if (existing.length > 0) {
      await db.update(devProducts).set(p).where(eq(devProducts.id, existing[0].id));
    } else {
      await db.insert(devProducts).values({ ...p, projectId });
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
  await db.insert(devReviews).values(reviews);
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

export async function getDevTagDimensions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devTagDimensions).where(eq(devTagDimensions.userId, userId));
}

export async function createDevTagDimension(data: InsertDevTagDimension) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(devTagDimensions).values(data);
  return { id: result.insertId };
}

export async function deleteDevTagDimension(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devTagDimensions).where(and(eq(devTagDimensions.id, id), eq(devTagDimensions.userId, userId)));
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
  const [result] = await db.insert(devExternalData).values(data);
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
  const existing = await db.select().from(devAnalysisReports).where(
    and(eq(devAnalysisReports.projectId, data.projectId), eq(devAnalysisReports.reportType, data.reportType))
  );
  if (existing.length > 0) {
    await db.update(devAnalysisReports).set(data).where(eq(devAnalysisReports.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devAnalysisReports).values(data);
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
  const existing = await db.select().from(devProjectScores).where(eq(devProjectScores.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProjectScores).set(data).where(eq(devProjectScores.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProjectScores).values(data);
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
  const existing = await db.select().from(devProductProfiles).where(eq(devProductProfiles.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProductProfiles).set(data).where(eq(devProductProfiles.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProductProfiles).values(data);
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
  const existing = await db.select().from(devProductManuals).where(eq(devProductManuals.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devProductManuals).set(data).where(eq(devProductManuals.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devProductManuals).values(data);
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
  const existing = await db.select().from(devTestReports).where(eq(devTestReports.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devTestReports).set(data).where(eq(devTestReports.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devTestReports).values(data);
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
  if (data.id) {
    await db.update(devBomItems).set(data).where(eq(devBomItems.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devBomItems).values(data);
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
  if (data.id) {
    await db.update(devMoldCosts).set(data).where(eq(devMoldCosts.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devMoldCosts).values(data);
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
  if (data.id) {
    await db.update(devTimePlans).set(data).where(eq(devTimePlans.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devTimePlans).values(data);
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
  if (data.id) {
    await db.update(devSuppliers).set(data).where(eq(devSuppliers.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devSuppliers).values(data);
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
  const existing = await db.select().from(devBomSummary).where(eq(devBomSummary.projectId, data.projectId));
  if (existing.length > 0) {
    await db.update(devBomSummary).set(data).where(eq(devBomSummary.id, existing[0].id));
    return { id: existing[0].id };
  }
  const [result] = await db.insert(devBomSummary).values(data);
  return { id: result.insertId };
}

// ─── Dev Profit Calculations ───────────────────────────────────

export async function getDevProfitCalculations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devProfitCalculations).where(eq(devProfitCalculations.userId, userId)).orderBy(desc(devProfitCalculations.updatedAt));
}

export async function saveDevProfitCalculation(data: InsertDevProfitCalculation & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.id) {
    await db.update(devProfitCalculations).set(data).where(eq(devProfitCalculations.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devProfitCalculations).values(data);
  return { id: result.insertId };
}

export async function deleteDevProfitCalculation(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devProfitCalculations).where(and(eq(devProfitCalculations.id, id), eq(devProfitCalculations.userId, userId)));
}

// ─── Dev Global Suppliers ──────────────────────────────────────

export async function getDevGlobalSuppliers(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(devGlobalSuppliers).where(eq(devGlobalSuppliers.userId, userId)).orderBy(desc(devGlobalSuppliers.updatedAt));
}

export async function saveDevGlobalSupplier(data: InsertDevGlobalSupplier & { id?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.id) {
    await db.update(devGlobalSuppliers).set(data).where(eq(devGlobalSuppliers.id, data.id));
    return { id: data.id };
  }
  const [result] = await db.insert(devGlobalSuppliers).values(data);
  return { id: result.insertId };
}

export async function deleteDevGlobalSupplier(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(devGlobalSuppliers).where(and(eq(devGlobalSuppliers.id, id), eq(devGlobalSuppliers.userId, userId)));
}
