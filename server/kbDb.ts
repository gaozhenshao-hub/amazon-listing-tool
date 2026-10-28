import { libraryFacets, type FacetSelection } from "../shared/libraryFacets";
import { sharedImageTags, imageTaggingUnits } from "../shared/imageTaggingUnits";
import { tagOwner, tagOwnerJoin } from "./domains/knowledge/sharedImageTagsSql";
import { getDb } from "./repositories/dbClient";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import { eq, and, desc, like, or, sql, inArray, ne } from "drizzle-orm";
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

function scopeCondition(table: any, userId: number, workspaceId: number, scope: Scope) {
  const workspace = eq(table.workspaceId, workspaceId);
  if (scope === "mine") return and(workspace, eq(table.userId, userId));
  const shared = and(eq(table.status, "confirmed"), ne(table.visibility, "private"));
  if (scope === "shared") return and(workspace, shared);
  // "all" includes a caller's own records plus explicitly shared, confirmed
  // records from colleagues in the same workspace. It must not expose drafts.
  return and(workspace, or(eq(table.userId, userId), shared));
}

/**
 * Image sets are readable by their owner, or when a confirmed set is explicitly
 * shared. Keep this separate from the generic helper above: `scope=all` is an
 * end-user option on the image routes and must not turn into every workspace
 * record (including another user's private work in progress).
 */
function imageSetReadCondition(userId: number, workspaceId: number) {
  return and(
    eq(kbImageSets.workspaceId, workspaceId), sql`${kbImageSets.recycleId} IS NULL`,
    or(
      eq(kbImageSets.userId, userId),
      and(eq(kbImageSets.status, "confirmed"), ne(kbImageSets.visibility, "private")),
    ),
  );
}

function imageSetScopeCondition(userId: number, workspaceId: number, scope: Scope) {
  const workspace = and(eq(kbImageSets.workspaceId, workspaceId), sql`${kbImageSets.recycleId} IS NULL`);
  const shared = and(eq(kbImageSets.status, "confirmed"), ne(kbImageSets.visibility, "private"));
  if (scope === "mine") return and(workspace, eq(kbImageSets.userId, userId));
  if (scope === "shared") return and(workspace, shared);
  return and(workspace, or(eq(kbImageSets.userId, userId), shared));
}

function ownedImageSetCondition(id: number, userId: number, workspaceId: number) {
  return and(
    eq(kbImageSets.id, id),
    eq(kbImageSets.userId, userId),
    eq(kbImageSets.workspaceId, workspaceId), sql`${kbImageSets.recycleId} IS NULL`,
  );
}

function imageSetIdsMatching(condition: any) {
  return sql`${kbImages.imageSetId} IN (SELECT ${kbImageSets.id} FROM ${kbImageSets} WHERE ${condition})`;
}

function imageInOwnedSetCondition(imageId: number, imageSetId: number, userId: number, workspaceId: number) {
  return and(
    eq(kbImages.id, imageId), sql`${kbImages.recycleId} IS NULL`,
    eq(kbImages.imageSetId, imageSetId),
    imageSetIdsMatching(ownedImageSetCondition(imageSetId, userId, workspaceId)),
  );
}

function imageInReadableSetCondition(imageId: number, userId: number, workspaceId: number) {
  return and(
    eq(kbImages.id, imageId), sql`${kbImages.recycleId} IS NULL`,
    imageSetIdsMatching(imageSetReadCondition(userId, workspaceId)),
  );
}

function imageInOwnedWorkspaceCondition(imageId: number, userId: number, workspaceId: number) {
  return and(
    eq(kbImages.id, imageId), sql`${kbImages.recycleId} IS NULL`,
    imageSetIdsMatching(and(
      eq(kbImageSets.userId, userId),
      eq(kbImageSets.workspaceId, workspaceId), sql`${kbImageSets.recycleId} IS NULL`,
    )),
  );
}

// ═══════════════════════════════════════════════════
// ─── Product Innovations ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listProductInnovations(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbProductInnovations).where(scopeCondition(kbProductInnovations, userId, workspaceId, scope)).orderBy(desc(kbProductInnovations.updatedAt));
}
export async function getProductInnovation(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbProductInnovations).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId), eq(kbProductInnovations.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function getProductInnovationById(id: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbProductInnovations).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function findProductInnovationByAsin(asin: string, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbProductInnovations.id, status: kbProductInnovations.status })
    .from(kbProductInnovations)
    .where(and(eq(kbProductInnovations.asin, asin), eq(kbProductInnovations.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
export async function createProductInnovation(data: InsertKbProductInnovation) {
  const _d = await db();
  const [result] = await _d.insert(kbProductInnovations).values(data);
  return result.insertId;
}
export async function updateProductInnovation(id: number, userId: number, workspaceId: number, data: Partial<InsertKbProductInnovation>) {
  const _d = await db();
  await _d.update(kbProductInnovations).set(data).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId), eq(kbProductInnovations.workspaceId, workspaceId)));
}
export async function deleteProductInnovation(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  await _d.delete(kbProductInnovations).where(and(eq(kbProductInnovations.id, id), eq(kbProductInnovations.userId, userId), eq(kbProductInnovations.workspaceId, workspaceId)));
}

// ═══════════════════════════════════════════════════
// ─── Listing Copywriting ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listListingCopywriting(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbListingCopywriting).where(scopeCondition(kbListingCopywriting, userId, workspaceId, scope)).orderBy(desc(kbListingCopywriting.updatedAt));
}
export async function getListingCopywriting(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbListingCopywriting).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId), eq(kbListingCopywriting.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function getListingCopywritingById(id: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbListingCopywriting).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function findListingCopywritingByAsin(asin: string, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbListingCopywriting.id, status: kbListingCopywriting.status })
    .from(kbListingCopywriting)
    .where(and(eq(kbListingCopywriting.asin, asin), eq(kbListingCopywriting.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
export async function createListingCopywriting(data: InsertKbListingCopywriting) {
  const _d = await db();
  const [result] = await _d.insert(kbListingCopywriting).values(data);
  return result.insertId;
}
export async function updateListingCopywriting(id: number, userId: number, workspaceId: number, data: Partial<InsertKbListingCopywriting>) {
  const _d = await db();
  await _d.update(kbListingCopywriting).set(data).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId), eq(kbListingCopywriting.workspaceId, workspaceId)));
}
export async function deleteListingCopywriting(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  await _d.delete(kbListingCopywriting).where(and(eq(kbListingCopywriting.id, id), eq(kbListingCopywriting.userId, userId), eq(kbListingCopywriting.workspaceId, workspaceId)));
}

// ═══════════════════════════════════════════════════
// ─── Image Sets & Images ──────────────────────────
// ═══════════════════════════════════════════════════
export async function listImageSets(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbImageSets).where(imageSetScopeCondition(userId, workspaceId, scope)).orderBy(desc(kbImageSets.updatedAt));
}

/** Lightweight set fields for list views — excludes large text blobs */
const SET_LIST_FIELDS = {
  id: kbImageSets.id,
  userId: kbImageSets.userId,
  workspaceId: kbImageSets.workspaceId,
  asin: kbImageSets.asin,
  productTitle: kbImageSets.productTitle,
  category: kbImageSets.category,
  brand: kbImageSets.brand,
  overallScore: kbImageSets.overallScore,
  setStyle: kbImageSets.setStyle,
  setPrimaryColor: kbImageSets.setPrimaryColor,
  setAccentColor: kbImageSets.setAccentColor,
  setCategory: kbImageSets.setCategory,
  setTargetAudience: kbImageSets.setTargetAudience,
  setCategoryScene: kbImageSets.setCategoryScene,
  status: kbImageSets.status,
  reviewStatus: kbImageSets.reviewStatus,
  reviewedBy: kbImageSets.reviewedBy,
  reviewedAt: kbImageSets.reviewedAt,
  submittedAt: kbImageSets.submittedAt,
  visibility: kbImageSets.visibility,
  confirmedAt: kbImageSets.confirmedAt,
  originInstanceId: kbImageSets.originInstanceId,
  remoteId: kbImageSets.remoteId,
  syncVersion: kbImageSets.syncVersion,
  lastSyncedAt: kbImageSets.lastSyncedAt,
  createdAt: kbImageSets.createdAt,
  updatedAt: kbImageSets.updatedAt,
  // Excluded for list performance: overallAnalysis, userEditedOverallAnalysis, setStyleParams, reviewNote
  overallAnalysis: sql<string | null>`NULL`.as('overallAnalysis'),
  userEditedOverallAnalysis: sql<string | null>`NULL`.as('userEditedOverallAnalysis'),
  setStyleParams: sql<string | null>`NULL`.as('setStyleParams'),
  reviewNote: sql<string | null>`NULL`.as('reviewNote'),
} as const;

export async function listImageSetsWithThumbnails(userId: number, workspaceId: number, scope: Scope = "mine", options: { thumbnails?: boolean; setIds?: number[] } = {}) {
  const _d = await db();
  const sets = await _d.select(SET_LIST_FIELDS).from(kbImageSets).where(and(imageSetScopeCondition(userId, workspaceId, scope), options.setIds ? inArray(kbImageSets.id, options.setIds) : undefined)).orderBy(desc(kbImageSets.updatedAt));
  if (sets.length === 0) return [];
  const setIds = sets.map(s => s.id);
  // Fetch first 5 images per set in a single query (ordered by positionIndex)
  const allImages = options.thumbnails === false ? [] : await _d.select({
    id: kbImages.id,
    imageSetId: kbImages.imageSetId,
    imageUrl: sql<string>`coalesce(${kbImages.thumbnailUrl}, ${kbImages.imageUrl})`,
    sourceUrlHash: kbImages.sourceUrlHash,
    imagePosition: kbImages.imagePosition,
    positionIndex: kbImages.positionIndex,
  }).from(kbImages).where(and(sql`${kbImages.recycleId} IS NULL`,inArray(kbImages.imageSetId, setIds), sql`${kbImages.id} IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY imageSetId ORDER BY CASE imagePosition WHEN 'main' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, positionIndex, id) AS rn FROM kb_images WHERE recycleId IS NULL AND imageSetId IN (${sql.join(setIds.map(id => sql`${id}`), sql`, `)})) ranked WHERE rn <= 5)`)).orderBy(kbImages.imageSetId, kbImages.positionIndex);
  // Group by setId and take first 5
  const imagesBySet: Record<number, typeof allImages> = {};
  for (const img of allImages) {
    if (img.imageSetId === null) continue;
    if (!imagesBySet[img.imageSetId]) imagesBySet[img.imageSetId] = [];
    if (imagesBySet[img.imageSetId].length < 5) imagesBySet[img.imageSetId].push(img);
  }
  return sets.map(s => ({ ...s, thumbnailImages: imagesBySet[s.id] || [] }));
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
/** Read a set only when it belongs to the current workspace and is owned or shared. */
export async function getReadableImageSet(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbImageSets)
    .where(and(eq(kbImageSets.id, id), imageSetReadCondition(userId, workspaceId)));
  return rows[0] ?? null;
}
/** Write/delete access is limited to the set owner in the current workspace. */
export async function getOwnedImageSet(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbImageSets).where(ownedImageSetCondition(id, userId, workspaceId));
  return rows[0] ?? null;
}
export async function findImageSetByAsin(asin: string, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbImageSets.id })
    .from(kbImageSets)
    .where(and(eq(kbImageSets.asin, asin), eq(kbImageSets.workspaceId, workspaceId)))
    .limit(1);
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
export async function updateOwnedImageSet(id: number, userId: number, workspaceId: number, data: Partial<InsertKbImageSet>) {
  const _d = await db();
  await _d.update(kbImageSets).set(data).where(ownedImageSetCondition(id, userId, workspaceId));
}
export async function deleteImageSet(id: number, userId: number) {
  const _d = await db();
  // Delete all images in the set first
  await _d.delete(kbImages).where(eq(kbImages.imageSetId, id));
  await _d.delete(kbImageSets).where(and(eq(kbImageSets.id, id), eq(kbImageSets.userId, userId)));
}
/**
 * Delete only an owned set. The child delete repeats the ownership/workspace
 * predicate so a stale or forged set id cannot erase another tenant's images.
 */
export async function deleteOwnedImageSet(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const condition = ownedImageSetCondition(id, userId, workspaceId);
  const rows = await _d.select({ id: kbImageSets.id }).from(kbImageSets).where(condition).limit(1);
  if (!rows[0]) return false;
  await _d.delete(kbImages).where(and(eq(kbImages.imageSetId, id), imageSetIdsMatching(condition)));
  await _d.delete(kbImageSets).where(condition);
  return true;
}
export async function listImagesBySet(imageSetId: number) {
  const _d = await db();
  return _d.select().from(kbImages).where(and(eq(kbImages.imageSetId, imageSetId), sql`${kbImages.recycleId} IS NULL`)).orderBy(kbImages.positionIndex);
}
/** Lightweight version: excludes large analysis text fields for fast initial dialog load */
export async function listImagesBySetLight(imageSetId: number) {
  const _d = await db();
  const images = await _d.select({
    id: kbImages.id,
    imageSetId: kbImages.imageSetId,
    imageUrl: kbImages.imageUrl,
    sourceUrlHash: kbImages.sourceUrlHash,
    imagePosition: kbImages.imagePosition,
    positionIndex: kbImages.positionIndex,
    tagCategory: kbImages.tagCategory,
    tagColorScheme: kbImages.tagColorScheme,
    tagImageType: kbImages.tagImageType,
    tagDesignStyle: kbImages.tagDesignStyle,
    tagImageBelong: kbImages.tagImageBelong,
    tagImageBelongSub: kbImages.tagImageBelongSub,
    tagImageTypeMain: kbImages.tagImageTypeMain,
    tagImageTypeSub: kbImages.tagImageTypeSub,
    tagSellingPointCategory: kbImages.tagSellingPointCategory,
    tagSellingPointDetail: kbImages.tagSellingPointDetail,
    tagComposition: kbImages.tagComposition,
    tagColorSchemeV2: kbImages.tagColorSchemeV2,
    tagDesignStyleV2: kbImages.tagDesignStyleV2,
    aplusModuleType: kbImages.aplusModuleType,
    aplusModuleClass: kbImages.aplusModuleClass,
    singleImageScore: kbImages.singleImageScore,
    highlights: kbImages.highlights,
    tagsConfirmed: kbImages.tagsConfirmed,
    analysisConfirmed: kbImages.analysisConfirmed,
    createdAt: kbImages.createdAt,
    updatedAt: kbImages.updatedAt,
    // Excluded for performance: aiDimensionAnalysis, userEditedDimensionAnalysis
    aiDimensionAnalysis: sql<string | null>`NULL`.as('aiDimensionAnalysis'),
    userEditedDimensionAnalysis: sql<string | null>`NULL`.as('userEditedDimensionAnalysis'),
  }).from(kbImages).where(and(eq(kbImages.imageSetId, imageSetId), sql`${kbImages.recycleId} IS NULL`)).orderBy(kbImages.positionIndex);
  return images.map(image=>({...image,imageSetId}));
}
/** Get a single image's analysis data on-demand (lazy load) */
export async function getImageWithAnalysis(imageId: number) {
  const _d = await db();
  const rows = await _d.select({
    id: kbImages.id,
    aiDimensionAnalysis: kbImages.aiDimensionAnalysis,
    userEditedDimensionAnalysis: kbImages.userEditedDimensionAnalysis,
  }).from(kbImages).where(eq(kbImages.id, imageId));
  return rows[0] ?? null;
}
export async function getReadableImageWithAnalysis(imageId: number, userId: number, workspaceId: number) {
  const d = await db();
  const rows = await d.select({ id: kbImages.id,
    aiDimensionAnalysis: tagOwner.aiDimensionAnalysis,
    userEditedDimensionAnalysis: tagOwner.userEditedDimensionAnalysis,
  }).from(kbImages).innerJoin(kbImageSets, eq(kbImages.imageSetId, kbImageSets.id))
    .leftJoin(tagOwner, tagOwnerJoin).where(imageInReadableSetCondition(imageId, userId, workspaceId)).limit(1);
  return rows[0] ?? null;
}
/** Resolve an image URL only when its parent set is owned or explicitly shared in this workspace. */
export async function getReadableImage(imageId: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({
    id: kbImages.id,
    imageSetId: kbImages.imageSetId,
    imageUrl: kbImages.imageUrl,
    sourceUrlHash: kbImages.sourceUrlHash,
    imagePosition: kbImages.imagePosition,
  }).from(kbImages).where(imageInReadableSetCondition(imageId, userId, workspaceId)).limit(1);
  return rows[0] ?? null;
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
export async function getOwnedImage(imageId: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbImages.id, imageSetId: kbImages.imageSetId }).from(kbImages)
    .where(imageInOwnedWorkspaceCondition(imageId, userId, workspaceId)).limit(1);
  return rows[0] ?? null;
}
// Administrators may maintain shared labels; private and cross-workspace sets stay isolated.
function tagEditorCondition(imageId: number, userId: number, workspaceId: number, admin: boolean) {
  return admin ? imageInReadableSetCondition(imageId, userId, workspaceId) : imageInOwnedWorkspaceCondition(imageId, userId, workspaceId);
}
export async function getImageForTagEditing(imageId: number, userId: number, workspaceId: number, admin: boolean) {
  const d = await db();
  const rows = await d.select({ id: kbImages.id }).from(kbImages).where(tagEditorCondition(imageId, userId, workspaceId, admin)).limit(1);
  return rows[0] ?? null;
}
export async function updateImageTagsForEditor(imageId: number, userId: number, workspaceId: number, admin: boolean, tags: Partial<InsertKbImage>) {
  const d = await db();
  return d.transaction(async tx => {
    // Lock the set as well: acquisition may change the module structure while an editor is open.
    const [row] = await tx.select({setId: kbImages.imageSetId, layout: kbImageSets.sourceLayout})
      .from(kbImages).innerJoin(kbImageSets, eq(kbImages.imageSetId, kbImageSets.id))
      .where(tagEditorCondition(imageId, userId, workspaceId, admin)).limit(1).for("update");
    if (!row || row.setId === null) throw new Error("图片不存在或无权限");
    const images = await tx.select().from(kbImages).where(and(eq(kbImages.imageSetId, row.setId),sql`${kbImages.recycleId} IS NULL`));
    const target = sharedImageTags(images, row.layout).find(image => image.id === imageId);
    if (!target?.tagOwnerId) throw new Error("模块首图待补充，暂不能编辑标签");
    if (Object.keys(tags).length) await tx.update(kbImages).set(tags).where(tagEditorCondition(target.tagOwnerId, userId, workspaceId, admin));

    return target.tagOwnerId;
  });
}
export async function updateOwnedImage(imageId: number, userId: number, workspaceId: number, data: Partial<InsertKbImage>) {
  const _d = await db();
  await _d.update(kbImages).set(data).where(imageInOwnedWorkspaceCondition(imageId, userId, workspaceId));
}

/** AI results must not replace labels confirmed while the model was running. */
export async function updateUnconfirmedOwnedImage(imageId: number, userId: number, workspaceId: number, imageUrl: string, data: Partial<InsertKbImage>) {
  const _d = await db();
  await _d.update(kbImages).set(data).where(and(
    imageInOwnedWorkspaceCondition(imageId, userId, workspaceId),
    eq(kbImages.imageUrl, imageUrl), eq(kbImages.tagsConfirmed, 0), eq(kbImages.analysisConfirmed, 0),
  ));
}
export async function getImageInOwnedSet(imageId: number, imageSetId: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbImages.id }).from(kbImages)
    .where(imageInOwnedSetCondition(imageId, imageSetId, userId, workspaceId)).limit(1);
  return rows[0] ?? null;
}
export async function updateImageInOwnedSet(imageId: number, imageSetId: number, userId: number, workspaceId: number, data: Partial<InsertKbImage>) {
  const _d = await db();
  await _d.update(kbImages).set(data).where(imageInOwnedSetCondition(imageId, imageSetId, userId, workspaceId));
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
export async function deleteImageInOwnedSet(imageId: number, imageSetId: number, userId: number, workspaceId: number) {
  const _d = await db();
  await _d.delete(kbImages).where(imageInOwnedSetCondition(imageId, imageSetId, userId, workspaceId));
}
export async function reorderImages(imageOrders: { id: number; positionIndex: number }[]) {
  const _d = await db();
  for (const item of imageOrders) {
    await _d.update(kbImages).set({ positionIndex: item.positionIndex }).where(eq(kbImages.id, item.id));
  }
}
export async function reorderImagesInOwnedSet(imageSetId: number, userId: number, workspaceId: number, imageOrders: { id: number; positionIndex: number }[]) {
  const _d = await db();
  for (const item of imageOrders) {
    await _d.update(kbImages).set({ positionIndex: item.positionIndex })
      .where(imageInOwnedSetCondition(item.id, imageSetId, userId, workspaceId));
  }
}
function imageBrowseBase(userId:number,workspaceId:number,scope:Scope,filters?:{query?:string}) {
  const ownOrShared = scope === "mine" ? eq(kbImages.userId,userId) : scope === "shared" ? eq(kbImages.visibility,"team") : or(eq(kbImages.userId,userId),eq(kbImages.visibility,"team"));
  const independent = and(sql`${kbImages.imageSetId} IS NULL`,eq(kbImages.workspaceId,workspaceId),sql`${kbImages.uploadHash} IS NOT NULL`,ownOrShared);
  const category=sql<string|null>`IF(${kbImages.imageSetId} IS NULL,${kbImages.tagCategory},${kbImageSets.setCategory})`;
  const style=sql<string|null>`IF(${kbImages.imageSetId} IS NULL,${kbImages.tagDesignStyleV2},${kbImageSets.setStyle})`;
  const primaryColor=sql<string|null>`IF(${kbImages.imageSetId} IS NULL,${kbImages.tagColorSchemeV2},${kbImageSets.setPrimaryColor})`;
  const accentColor=sql<string|null>`IF(${kbImages.imageSetId} IS NULL,${kbImages.tagAccentColor},${kbImageSets.setAccentColor})`;
  const conditions: any[] = [sql`${kbImages.recycleId} IS NULL`, ne(kbImages.imagePosition,"brand_story"), sql`${kbImages.id} = ${tagOwner.id}`];
  conditions.push(or(independent,imageSetIdsMatching(imageSetScopeCondition(userId, workspaceId, scope))));
  if (filters?.query?.trim()) {
    const pattern = `%${filters.query.trim()}%`;
    conditions.push(sql`(${kbImages.uploadTitle} LIKE ${pattern} OR ${kbImages.imageSetId} IN (SELECT id FROM kb_image_sets WHERE asin LIKE ${pattern} OR productTitle LIKE ${pattern} OR brand LIKE ${pattern}))`);
  }
  return {category,style,primaryColor,accentColor,conditions};
}
export async function listAllImages(userId: number, workspaceId: number, scope: Scope = "mine", filters?: { page?: number; query?: string; groupBy?: string; tagCategory?: string; tagColorScheme?: string; tagImageType?: string; tagDesignStyle?: string; imagePosition?: string; tagImageBelong?: string; tagImageBelongSub?: string; tagImageTypeMain?: string; tagImageTypeSub?: string; tagSellingPointCategory?: string; tagSellingPointDetail?: string; tagComposition?: string; tagColorSchemeV2?: string; tagAccentColor?: string; tagDesignStyleV2?: string }) {
  const _d = await db();
  const {category,style,primaryColor,accentColor,conditions}=imageBrowseBase(userId,workspaceId,scope,filters);
  // tagCategory: check both single image AND parent set's setCategory
  if (filters?.tagCategory) {
    conditions.push(eq(category,filters.tagCategory));
  }
  if (filters?.tagColorScheme) conditions.push(eq(primaryColor, filters.tagColorScheme));
  if (filters?.tagImageType) conditions.push(eq(tagOwner.tagImageType, filters.tagImageType));
  if (filters?.tagDesignStyle) conditions.push(eq(style, filters.tagDesignStyle));
  if (filters?.imagePosition) conditions.push(eq(kbImages.imagePosition, filters.imagePosition as any));
  // V2 filters
  if (filters?.tagImageBelong) conditions.push(eq(tagOwner.tagImageBelong, filters.tagImageBelong));
  if (filters?.tagImageBelongSub) conditions.push(eq(tagOwner.tagImageBelongSub, filters.tagImageBelongSub));
  if (filters?.tagImageTypeMain) conditions.push(eq(tagOwner.tagImageTypeMain, filters.tagImageTypeMain));
  if (filters?.tagImageTypeSub) conditions.push(eq(tagOwner.tagImageTypeSub, filters.tagImageTypeSub));
  if (filters?.tagSellingPointCategory) conditions.push(eq(tagOwner.tagSellingPointCategory, filters.tagSellingPointCategory));
  if (filters?.tagSellingPointDetail) conditions.push(eq(tagOwner.tagSellingPointDetail, filters.tagSellingPointDetail));
  if (filters?.tagComposition) conditions.push(eq(tagOwner.tagComposition, filters.tagComposition));
  // Set-level tag inheritance: colorSchemeV2 and designStyleV2 check both single image AND parent set
  if (filters?.tagColorSchemeV2) {
    conditions.push(eq(primaryColor,filters.tagColorSchemeV2));
  }
  if (filters?.tagDesignStyleV2) {
    conditions.push(eq(style,filters.tagDesignStyleV2));
  }
  if (filters?.tagAccentColor) conditions.push(eq(accentColor,filters.tagAccentColor === "__none" ? "" : filters.tagAccentColor));
  const groupFields = {type:tagOwner.tagImageTypeMain,style,category,primaryColor,accentColor,belong:tagOwner.tagImageBelong,sellingPoint:tagOwner.tagSellingPointCategory,composition:tagOwner.tagComposition};
  const grouping=groupFields[filters?.groupBy as keyof typeof groupFields];

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  // Exclude large analysis fields for waterfall view performance
  const result = await _d.select({
    id: kbImages.id,
    tagOwnerId: tagOwner.id,
    sourceLayout: kbImageSets.sourceLayout,
    asin:kbImageSets.asin,productTitle:sql<string|null>`IF(${kbImages.imageSetId} IS NULL,${kbImages.uploadTitle},${kbImageSets.productTitle})`,
    canEditTags:sql<boolean>`IF(${kbImages.imageSetId} IS NULL,${kbImages.userId},${kbImageSets.userId}) = ${userId}`,
    labelStatus:kbImages.labelStatus,labelRevision:kbImages.labelRevision,labelError:kbImages.labelError,
    thumbnailUrl:kbImages.thumbnailUrl,
    imageSetId: kbImages.imageSetId,
    imageUrl: kbImages.imageUrl,
    sourceUrlHash: kbImages.sourceUrlHash,
    imagePosition: kbImages.imagePosition,
    positionIndex: kbImages.positionIndex,
    tagCategory: category,
    tagColorScheme: primaryColor,
    tagImageType: tagOwner.tagImageType,
    tagDesignStyle: style,
    tagImageBelong: tagOwner.tagImageBelong,
    tagImageBelongSub: tagOwner.tagImageBelongSub,
    tagImageTypeMain: tagOwner.tagImageTypeMain,
    tagImageTypeSub: tagOwner.tagImageTypeSub,
    tagSellingPointCategory: tagOwner.tagSellingPointCategory,
    tagSellingPointDetail: tagOwner.tagSellingPointDetail,
    tagComposition: tagOwner.tagComposition,
    tagAccentColor: accentColor,
    tagColorSchemeV2: primaryColor,
    tagDesignStyleV2: style,
    aplusModuleType: kbImages.aplusModuleType,
    aplusModuleClass: kbImages.aplusModuleClass,
    singleImageScore: tagOwner.singleImageScore,
    tagsConfirmed: tagOwner.tagsConfirmed,
    analysisConfirmed: tagOwner.analysisConfirmed,
    createdAt: kbImages.createdAt,
    updatedAt: kbImages.updatedAt,
    // Excluded for waterfall performance: aiDimensionAnalysis, userEditedDimensionAnalysis, highlights
    aiDimensionAnalysis: sql<string | null>`NULL`.as('aiDimensionAnalysis'),
    userEditedDimensionAnalysis: sql<string | null>`NULL`.as('userEditedDimensionAnalysis'),
    highlights: sql<string | null>`NULL`.as('highlights'),
  }).from(kbImages).leftJoin(kbImageSets, eq(kbImages.imageSetId, kbImageSets.id)).leftJoin(tagOwner, tagOwnerJoin).where(where).orderBy(...(grouping ? [sql`${grouping} IS NULL`,grouping] : []),desc(kbImages.createdAt), desc(kbImages.id))
    .limit(96).offset((Math.max(1, filters?.page ?? 1) - 1) * 96);
  if (!result.length) return [];
  const members = await _d.select({id:kbImages.id,imageSetId:kbImages.imageSetId,imagePosition:kbImages.imagePosition,
    sourceUrlHash:kbImages.sourceUrlHash,positionIndex:kbImages.positionIndex,imageUrl:kbImages.imageUrl,thumbnailUrl:kbImages.thumbnailUrl})
    .from(kbImages).where(and(sql`${kbImages.recycleId} IS NULL`,inArray(kbImages.imageSetId,[...new Set(result.flatMap(i=>i.imageSetId ? [i.imageSetId] : []))]),eq(kbImages.imagePosition,"aplus")));
  return result.map(({sourceLayout,...image}) => {
    const unit=image.imagePosition === "aplus" ? imageTaggingUnits(members.filter(i=>i.imageSetId===image.imageSetId),sourceLayout).find(unit=>unit.primary.id===image.id) : undefined;
    return {...image,module:unit?.module ?? null,moduleImages:unit?.module ? unit.images : []};
  });
}

// ═══════════════════════════════════════════════════
// ─── Operation Skills (SOP) ───────────────────────
// ═══════════════════════════════════════════════════
export async function listOperationSkills(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbOperationSkills).where(scopeCondition(kbOperationSkills, userId, workspaceId, scope)).orderBy(desc(kbOperationSkills.updatedAt));
}
export async function getOperationSkill(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbOperationSkills).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId), eq(kbOperationSkills.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function getOperationSkillById(id: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbOperationSkills).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function createOperationSkill(data: InsertKbOperationSkill) {
  const _d = await db();
  const [result] = await _d.insert(kbOperationSkills).values(data);
  return result.insertId;
}
export async function updateOperationSkill(id: number, userId: number, workspaceId: number, data: Partial<InsertKbOperationSkill>) {
  const _d = await db();
  await _d.update(kbOperationSkills).set(data).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId), eq(kbOperationSkills.workspaceId, workspaceId)));
}
export async function deleteOperationSkill(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  await _d.delete(kbOperationSkills).where(and(eq(kbOperationSkills.id, id), eq(kbOperationSkills.userId, userId), eq(kbOperationSkills.workspaceId, workspaceId)));
}

// ═══════════════════════════════════════════════════
// ─── Videos ───────────────────────────────────────
// ═══════════════════════════════════════════════════
export async function listVideos(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  return _d.select().from(kbVideos).where(scopeCondition(kbVideos, userId, workspaceId, scope)).orderBy(desc(kbVideos.updatedAt));
}
export async function getVideo(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbVideos).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId), eq(kbVideos.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function getVideoById(id: number, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select().from(kbVideos).where(and(eq(kbVideos.id, id), eq(kbVideos.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
export async function findVideoByAsin(asin: string, workspaceId: number) {
  const _d = await db();
  const rows = await _d.select({ id: kbVideos.id })
    .from(kbVideos)
    .where(and(eq(kbVideos.asin, asin), eq(kbVideos.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
export async function createVideo(data: InsertKbVideo) {
  const _d = await db();
  const [result] = await _d.insert(kbVideos).values(data);
  return result.insertId;
}
export async function updateVideo(id: number, userId: number, workspaceId: number, data: Partial<InsertKbVideo>) {
  const _d = await db();
  await _d.update(kbVideos).set(data).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId), eq(kbVideos.workspaceId, workspaceId)));
}
export async function deleteVideo(id: number, userId: number, workspaceId: number) {
  const _d = await db();
  await _d.delete(kbVideos).where(and(eq(kbVideos.id, id), eq(kbVideos.userId, userId), eq(kbVideos.workspaceId, workspaceId)));
}

// ═══════════════════════════════════════════════════
// ─── Cross-module Search (scope-aware) ───────────
// ═══════════════════════════════════════════════════
export async function searchKnowledgeBase(userId: number, workspaceId: number, query: string, scope: Scope = "mine") {
  const _d = await db();
  const q = `%${query}%`;

  function buildWhere(table: any, searchFields: any[]) {
    const sc = scopeCondition(table, userId, workspaceId, scope);
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
export async function getKbStats(userId: number, workspaceId: number, scope: Scope = "mine") {
  const _d = await db();
  const [products, listings, imageSets, skills, videos] = await Promise.all([
    _d.select({ count: sql<number>`count(*)` }).from(kbProductInnovations).where(scopeCondition(kbProductInnovations, userId, workspaceId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbListingCopywriting).where(scopeCondition(kbListingCopywriting, userId, workspaceId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbImageSets).where(scopeCondition(kbImageSets, userId, workspaceId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbOperationSkills).where(scopeCondition(kbOperationSkills, userId, workspaceId, scope)),
    _d.select({ count: sql<number>`count(*)` }).from(kbVideos).where(scopeCondition(kbVideos, userId, workspaceId, scope)),
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

/** Shared, successfully stored collections only; never count another user's private draft. */
export async function imageContributions(workspaceId: number) {
  const d = await db();
  const [rows] = await d.execute(sql`SELECT s.userId, COALESCE(u.name, '未命名成员') AS name,
    COUNT(DISTINCT UPPER(s.asin)) AS asinCount,
    COUNT(DISTINCT CONCAT(UPPER(s.asin), ':', i.imageUrl)) AS imageCount
    FROM kb_image_sets s JOIN kb_images i ON i.imageSetId=s.id LEFT JOIN users u ON u.id=s.userId
    WHERE s.workspaceId=${workspaceId} AND s.status='confirmed' AND s.visibility IN ('team','public')
      AND (s.origin_instance_id IS NULL OR s.origin_instance_id='unified_amazon_acquisition')
    GROUP BY s.userId,u.name ORDER BY asinCount DESC,imageCount DESC,s.userId ASC`);
  return (rows as unknown as Array<{userId:number;name:string;asinCount:number;imageCount:number}>).map(row=>({...row,asinCount:Number(row.asinCount),imageCount:Number(row.imageCount)}));
}

export async function imageBrowseFacets(userId:number,workspaceId:number,scope:Scope,input:{query?:string;filters:FacetSelection;groupBy?:string}) {
  const {category,style,primaryColor,accentColor,conditions}=imageBrowseBase(userId,workspaceId,scope,input);
  const fields={category,style,primaryColor,accentColor,type:tagOwner.tagImageTypeMain,typeSub:tagOwner.tagImageTypeSub,
    belong:tagOwner.tagImageBelong,belongSub:tagOwner.tagImageBelongSub,sellingPoint:tagOwner.tagSellingPointCategory,
    sellingPointDetail:tagOwner.tagSellingPointDetail,composition:tagOwner.tagComposition};
  const rows=await (await db()).select(fields).from(kbImages).leftJoin(kbImageSets,eq(kbImages.imageSetId,kbImageSets.id)).leftJoin(tagOwner,tagOwnerJoin).where(and(...conditions));
  return libraryFacets(rows,input.filters,Object.keys(fields),input.groupBy);
}
