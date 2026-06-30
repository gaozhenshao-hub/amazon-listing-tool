import { getDb } from "./db";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import { eq, and, desc, like, or, sql, inArray } from "drizzle-orm";
import {
  kbProductInnovations, InsertKbProductInnovation,
  kbListingCopywriting, InsertKbListingCopywriting,
  kbImageSets, InsertKbImageSet,
  kbImages, InsertKbImage,
  kbOperationSkills, InsertKbOperationSkill,
  kbVideos, InsertKbVideo,
} from "../drizzle/schema";

// ═══════════════════════════════════════════════════
// ─── Scope Helper ────────────────────────────────
// ═══════════════════════════════════════════════════
type Scope = "mine" | "shared" | "all";

function scopeCondition(table: any, userId: number, scope: Scope) {
  if (scope === "mine") return eq(table.userId, userId);
  if (scope === "shared") return eq(table.status, "confirmed");
  // "all" — admin: show everything
  return sql`1=1`;
}

// ═══════════════════════════════════════════════════
// ─── Product Innovations ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listProductInnovations(userId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbProductInnovations).where(scopeCondition(kbProductInnovations, userId, scope)).orderBy(desc(kbProductInnovations.updatedAt));
}
export async function getProductInnovation(id: number, userId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbProductInnovations).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId)));
  return rows[0] ?? null;
}
export async function getProductInnovationById(id: number) {
  const _d = await db();
  const rows = await _d.select().from(kbProductInnovations).where(eq(kbProductInnovations.id, id));
  return rows[0] ?? null;
}
export async function createProductInnovation(data: InsertKbProductInnovation) {
  const _d = await db();
  const [result] = await _d.insert(kbProductInnovations).values(data);
  return result.insertId;
}
export async function updateProductInnovation(id: number, userId: number, data: Partial<InsertKbProductInnovation>) {
  const _d = await db();
  await _d.update(kbProductInnovations).set(data).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId)));
}
export async function deleteProductInnovation(id: number, userId: number) {
  const _d = await db();
  await _d.delete(kbProductInnovations).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId)));
}

// ═══════════════════════════════════════════════════
// ─── Listing Copywriting ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listListingCopywriting(userId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbListingCopywriting).where(scopeCondition(kbListingCopywriting, userId, scope)).orderBy(desc(kbListingCopywriting.updatedAt));
}
export async function getListingCopywriting(id: number, userId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbListingCopywriting).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId)));
  return rows[0] ?? null;
}
export async function getListingCopywritingById(id: number) {
  const _d = await db();
  const rows = await _d.select().from(kbListingCopywriting).where(eq(kbListingCopywriting.id, id));
  return rows[0] ?? null;
}
export async function createListingCopywriting(data: InsertKbListingCopywriting) {
  const _d = await db();
  const [result] = await _d.insert(kbListingCopywriting).values(data);
  return result.insertId;
}
export async function updateListingCopywriting(id: number, userId: number, data: Partial<InsertKbListingCopywriting>) {
  const _d = await db();
  await _d.update(kbListingCopywriting).set(data).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId)));
}
export async function deleteListingCopywriting(id: number, userId: number) {
  const _d = await db();
  await _d.delete(kbListingCopywriting).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId)));
}

// ═══════════════════════════════════════════════════
// ─── Image Sets & Images ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listImageSets(userId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbImageSets).where(scopeCondition(kbImageSets, userId, scope)).orderBy(desc(kbImageSets.updatedAt));
}
export async function getImageSet(id: number, userId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbImageSets).where(and(eq(kbImageSets.id, id), eq(kbImageSets.userId, userId)));
  return rows[0] ?? null;
}
export async function getImageSetById(id: number) {
  const _d = await db();
  const rows = await _d.select().from(kbImageSets).where(eq(kbImageSets.id, id));
  return rows[0] ?? null;
}
export async function createImageSet(data: InsertKbImageSet) {
  const _d = await db();
  const [result] = await _d.insert(kbImageSets).values(data);
  return result.insertId;
}
export async function updateImageSet(id: number, userId: number, data: Partial<InsertKbImageSet>) {
  const _d = await db();
  await _d.update(kbImageSets).set(data).where(and(eq(kbImageSets.id, id), eq(kbImageSets.userId, userId)));
}
export async function deleteImageSet(id: number, userId: number) {
  const _d = await db();
  // Delete all images in the set first
  await _d.delete(kbImages).where(eq(kbImages.imageSetId, id));
  await _d.delete(kbImageSets).where(and(eq(kbImageSets.id, id), eq(kbImageSets.userId, userId)));
}
export async function listImagesBySet(imageSetId: number) {
  const _d = await db();
  return _d.select().from(kbImages).where(eq(kbImages.imageSetId, imageSetId)).orderBy(kbImages.positionIndex);
}
export async function createImage(data: InsertKbImage) {
  const _d = await db();
  const [result] = await _d.insert(kbImages).values(data);
  return result.insertId;
}
export async function updateImage(id: number, data: Partial<InsertKbImage>) {
  const _d = await db();
  await _d.update(kbImages).set(data).where(eq(kbImages.id, id));
}
export async function deleteImagesByPosition(imageSetId: number, positions: string[]) {
  const _d = await db();
  if (positions.length === 0) return;
  await _d.delete(kbImages).where(
    and(
      eq(kbImages.imageSetId, imageSetId),
      inArray(kbImages.imagePosition, positions as any)
    )
  );
}
export async function deleteImage(id: number) {
  const _d = await db();
  await _d.delete(kbImages).where(eq(kbImages.id, id));
}
export async function reorderImages(imageOrders: { id: number; positionIndex: number }[]) {
  const _d = await db();
  for (const item of imageOrders) {
    await _d.update(kbImages).set({ positionIndex: item.positionIndex }).where(eq(kbImages.id, item.id));
  }
}
export async function listAllImages(userId: number, scope: Scope = "mine", filters?: { tagCategory?: string; tagColorScheme?: string; tagImageType?: string; tagDesignStyle?: string; imagePosition?: string; tagImageBelong?: string; tagImageTypeMain?: string; tagImageTypeSub?: string; tagSellingPointCategory?: string; tagSellingPointDetail?: string; tagComposition?: string; tagColorSchemeV2?: string; tagDesignStyleV2?: string }) {
  const _d = await db();
  const conditions: any[] = [];
  if (scope === "mine") {
    conditions.push(sql`${kbImages.imageSetId} IN (SELECT id FROM kb_image_sets WHERE userId = ${userId})`);
  } else if (scope === "shared") {
    conditions.push(sql`${kbImages.imageSetId} IN (SELECT id FROM kb_image_sets WHERE status = 'confirmed')`);
  }
  // "all" — no filter on ownership
  if (filters?.tagCategory) conditions.push(eq(kbImages.tagCategory, filters.tagCategory));
  if (filters?.tagColorScheme) conditions.push(eq(kbImages.tagColorScheme, filters.tagColorScheme));
  if (filters?.tagImageType) conditions.push(eq(kbImages.tagImageType, filters.tagImageType));
  if (filters?.tagDesignStyle) conditions.push(eq(kbImages.tagDesignStyle, filters.tagDesignStyle));
  if (filters?.imagePosition) conditions.push(eq(kbImages.imagePosition, filters.imagePosition as any));
  // V2 filters
  if (filters?.tagImageBelong) conditions.push(sql`${kbImages}.tag_image_belong = ${filters.tagImageBelong}`);
  if (filters?.tagImageTypeMain) conditions.push(sql`${kbImages}.tag_image_type_main = ${filters.tagImageTypeMain}`);
  if (filters?.tagImageTypeSub) conditions.push(sql`${kbImages}.tag_image_type_sub = ${filters.tagImageTypeSub}`);
  if (filters?.tagSellingPointCategory) conditions.push(sql`${kbImages}.tag_selling_point_category = ${filters.tagSellingPointCategory}`);
  if (filters?.tagSellingPointDetail) conditions.push(sql`${kbImages}.tagSellingPointDetail LIKE CONCAT('%', ${filters.tagSellingPointDetail}, '%')`);
  if (filters?.tagComposition) conditions.push(sql`${kbImages}.tag_composition = ${filters.tagComposition}`);
  if (filters?.tagColorSchemeV2) conditions.push(sql`${kbImages}.tag_color_scheme_v2 = ${filters.tagColorSchemeV2}`);
  if (filters?.tagDesignStyleV2) conditions.push(sql`${kbImages}.tag_design_style_v2 = ${filters.tagDesignStyleV2}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return _d.select().from(kbImages).where(where).orderBy(desc(kbImages.createdAt));
}

// ═══════════════════════════════════════════════════
// ─── Operation Skills (SOP) ───────────────────────
// ═══════════════════════════════════════════════════
export async function listOperationSkills(userId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbOperationSkills).where(scopeCondition(kbOperationSkills, userId, scope)).orderBy(desc(kbOperationSkills.updatedAt));
}
export async function getOperationSkill(id: number, userId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbOperationSkills).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId)));
  return rows[0] ?? null;
}
export async function getOperationSkillById(id: number) {
  const _d = await db();
  const rows = await _d.select().from(kbOperationSkills).where(eq(kbOperationSkills.id, id));
  return rows[0] ?? null;
}
export async function createOperationSkill(data: InsertKbOperationSkill) {
  const _d = await db();
  const [result] = await _d.insert(kbOperationSkills).values(data);
  return result.insertId;
}
export async function updateOperationSkill(id: number, userId: number, data: Partial<InsertKbOperationSkill>) {
  const _d = await db();
  await _d.update(kbOperationSkills).set(data).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId)));
}
export async function deleteOperationSkill(id: number, userId: number) {
  const _d = await db();
  await _d.delete(kbOperationSkills).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId)));
}

// ═══════════════════════════════════════════════════
// ─── Videos ───────────────────────────────────────
// ═══════════════════════════════════════════════════
export async function listVideos(userId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbVideos).where(scopeCondition(kbVideos, userId, scope)).orderBy(desc(kbVideos.updatedAt));
}
export async function getVideo(id: number, userId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbVideos).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId)));
  return rows[0] ?? null;
}
export async function getVideoById(id: number) {
  const _d = await db();
  const rows = await _d.select().from(kbVideos).where(eq(kbVideos.id, id));
  return rows[0] ?? null;
}
export async function createVideo(data: InsertKbVideo) {
  const _d = await db();
  const [result] = await _d.insert(kbVideos).values(data);
  return result.insertId;
}
export async function updateVideo(id: number, userId: number, data: Partial<InsertKbVideo>) {
  const _d = await db();
  await _d.update(kbVideos).set(data).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId)));
}
export async function deleteVideo(id: number, userId: number) {
  const _d = await db();
  await _d.delete(kbVideos).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId)));
}

// ═══════════════════════════════════════════════════
// ─── Cross-module Search (scope-aware) ───────────
// ═══════════════════════════════════════════════════
export async function searchKnowledgeBase(userId: number, query: string, scope: Scope = "mine") {
  const _d = await db();
  const q = `%${query}%`;

  function buildWhere(table: any, searchFields: any[]) {
    const sc = scopeCondition(table, userId, scope);
    return and(sc, or(...searchFields));
  }

  const [products, listings, imageSets, skills, videos] = await Promise.all([
    _d.select({ id: kbProductInnovations.id, type: sql<string>`'product'`, title: kbProductInnovations.productTitle, asin: kbProductInnovations.asin, status: kbProductInnovations.status, userId: kbProductInnovations.userId, updatedAt: kbProductInnovations.updatedAt })
      .from(kbProductInnovations)
      .where(buildWhere(kbProductInnovations, [like(kbProductInnovations.productTitle, q), like(kbProductInnovations.asin, q), like(kbProductInnovations.category, q)])),
    _d.select({ id: kbListingCopywriting.id, type: sql<string>`'listing'`, title: kbListingCopywriting.productTitle, asin: kbListingCopywriting.asin, status: kbListingCopywriting.status, userId: kbListingCopywriting.userId, updatedAt: kbListingCopywriting.updatedAt })
      .from(kbListingCopywriting)
      .where(buildWhere(kbListingCopywriting, [like(kbListingCopywriting.productTitle, q), like(kbListingCopywriting.asin, q), like(kbListingCopywriting.category, q)])),
    _d.select({ id: kbImageSets.id, type: sql<string>`'image'`, title: kbImageSets.productTitle, asin: kbImageSets.asin, status: kbImageSets.status, userId: kbImageSets.userId, updatedAt: kbImageSets.updatedAt })
      .from(kbImageSets)
      .where(buildWhere(kbImageSets, [like(kbImageSets.productTitle, q), like(kbImageSets.asin, q), like(kbImageSets.category, q)])),
    _d.select({ id: kbOperationSkills.id, type: sql<string>`'skill'`, title: kbOperationSkills.title, asin: sql<string>`''`, status: kbOperationSkills.status, userId: kbOperationSkills.userId, updatedAt: kbOperationSkills.updatedAt })
      .from(kbOperationSkills)
      .where(buildWhere(kbOperationSkills, [like(kbOperationSkills.title, q), like(kbOperationSkills.extractedContent, q)])),
    _d.select({ id: kbVideos.id, type: sql<string>`'video'`, title: kbVideos.videoTitle, asin: sql`COALESCE(${kbVideos.asin}, '')`, status: kbVideos.status, userId: kbVideos.userId, updatedAt: kbVideos.updatedAt })
      .from(kbVideos)
      .where(buildWhere(kbVideos, [like(kbVideos.videoTitle, q), like(kbVideos.asin, q)])),
  ]);
  return [...products, ...listings, ...imageSets, ...skills, ...videos].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// ═══════════════════════════════════════════════════
// ─── Stats (scope-aware) ─────────────────────────
// ═══════════════════════════════════════════════════
export async function getKbStats(userId: number, scope: Scope = "mine") {
  const _d = await db();
  const [products, listings, imageSets, skills, videos] = await Promise.all([
    _d.select({ count: sql<number>`count(*)` }).from(kbProductInnovations).where(scopeCondition(kbProductInnovations, userId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbListingCopywriting).where(scopeCondition(kbListingCopywriting, userId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbImageSets).where(scopeCondition(kbImageSets, userId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbOperationSkills).where(scopeCondition(kbOperationSkills, userId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbVideos).where(scopeCondition(kbVideos, userId, scope)),
  ]);
  return {
    productCount: products[0]?.count ?? 0,
    listingCount: listings[0]?.count ?? 0,
    imageSetCount: imageSets[0]?.count ?? 0,
    skillCount: skills[0]?.count ?? 0,
    videoCount: videos[0]?.count ?? 0,
    totalCount: (products[0]?.count ?? 0) + (listings[0]?.count ?? 0) + (imageSets[0]?.count ?? 0) + (skills[0]?.count ?? 0) + (videos[0]?.count ?? 0),
  };
}
