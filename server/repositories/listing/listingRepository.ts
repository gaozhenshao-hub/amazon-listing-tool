import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../dbClient";
import { registerAdStructureArtifact, registerListingArtifact } from "../../domains/ai_os/services/businessArtifactRegistry";
import { InsertAdStructure, InsertKeyword, InsertListing, InsertListingVersion, InsertNegativeKeyword, InsertReviewAggregation, adStructures, keywords, listings, listingVersions, negativeKeywords, reviewAggregations } from "../../../drizzle/schema/listing";

async function captureListingProject(projectId: number | null | undefined) {
  if (!projectId) return;
  const listing = await getActiveListingByProject(projectId);
  if (listing) await registerListingArtifact(listing.id, "user_edit");
}

// --- Listing Helpers --------------------------------------------

export async function createListing(data: InsertListing) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(listings).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(listings).where(eq(listings.id, insertId)).limit(1);
  await registerListingArtifact(insertId, "ai_output");
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
  await registerListingArtifact(id, "user_edit");
  return rows[0];
}

// --- Keyword Helpers -----------------------------------------

export async function createKeyword(data: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(keywords).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(keywords).where(eq(keywords.id, insertId)).limit(1);
  await captureListingProject(data.projectId);
  return rows[0];
}

export async function bulkCreateKeywords(dataArr: InsertKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataArr.length === 0) return [];
  await db.insert(keywords).values(dataArr);
  await captureListingProject(dataArr[0]?.projectId);
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
  const [existing] = await db.select({ projectId: keywords.projectId }).from(keywords).where(eq(keywords.id, id));
  await db.update(keywords).set(data).where(eq(keywords.id, id));
  const rows = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  await captureListingProject(data.projectId ?? existing?.projectId);
  return rows[0];
}

export async function bulkUpdateKeywords(ids: number[], data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = ids.length > 0 ? await db.select({ projectId: keywords.projectId }).from(keywords).where(eq(keywords.id, ids[0])).limit(1) : [];
  for (const id of ids) {
    await db.update(keywords).set(data).where(eq(keywords.id, id));
  }
  await captureListingProject(data.projectId ?? existing?.projectId);
  return { success: true, count: ids.length };
}

export async function deleteKeyword(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ projectId: keywords.projectId }).from(keywords).where(eq(keywords.id, id));
  await db.delete(keywords).where(eq(keywords.id, id));
  await captureListingProject(existing?.projectId);
  return { success: true };
}

export async function deleteKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(keywords).where(eq(keywords.projectId, projectId));
  await captureListingProject(projectId);
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
  await captureListingProject(data.projectId);
  return rows[0];
}

export async function bulkCreateNegativeKeywords(dataArr: InsertNegativeKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataArr.length === 0) return [];
  await db.insert(negativeKeywords).values(dataArr);
  await captureListingProject(dataArr[0]?.projectId);
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
  const [existing] = await db.select({ projectId: negativeKeywords.projectId }).from(negativeKeywords).where(eq(negativeKeywords.id, id));
  await db.delete(negativeKeywords).where(eq(negativeKeywords.id, id));
  await captureListingProject(existing?.projectId);
  return { success: true };
}

export async function deleteNegativeKeywordsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(negativeKeywords).where(eq(negativeKeywords.projectId, projectId));
  await captureListingProject(projectId);
  return { success: true };
}

// --- Ad Structure CRUD -----------------------------------------

export async function createAdStructure(data: InsertAdStructure) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(adStructures).values(data).$returningId();
  await registerAdStructureArtifact(result.id, "ai_output");
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
  await registerAdStructureArtifact(id, "user_edit");
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
  await captureListingProject(data.projectId);
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
  await captureListingProject(data.projectId);
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
  const [existing] = await db.select({ projectId: reviewAggregations.projectId }).from(reviewAggregations).where(eq(reviewAggregations.id, id));
  await db.update(reviewAggregations).set(data).where(eq(reviewAggregations.id, id));
  const rows = await db.select().from(reviewAggregations).where(eq(reviewAggregations.id, id)).limit(1);
  await captureListingProject(data.projectId ?? existing?.projectId);
  return rows[0];
}

export async function deleteReviewAggregation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(reviewAggregations).where(eq(reviewAggregations.id, id));
}
