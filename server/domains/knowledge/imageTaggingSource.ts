import { getTableConfig } from "drizzle-orm/mysql-core";
import { kbImageSets, kbImages } from "../../../drizzle/schema/image";
import { ImageTaggingIdentitySchema, ImageTaggingSourceSchema, imageTaggingCanonical, imageTaggingHash,
  IMAGE_TAGGING_TAG_FIELDS, type ImageTaggingSource } from "../../../shared/imageTagging";
import { readManualKbImageSnapshotInTransaction, type ManualSnapshotPersistentProof } from "../acquisition/manualImageWorkflowProjection";
import { imageTaggingStatement, type ImageTaggingExecutor } from "./imageTaggingRepository";

const fail = (code: string): never => { throw new Error(`IMAGE_TAGGING_${code}`); };
async function rows(tx: ImageTaggingExecutor, query: string, params: unknown[], max: number) {
  const result = await tx.execute(imageTaggingStatement(query, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > max
    || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) return fail("SOURCE_READ_INVALID");
  return result[0] as Record<string, unknown>[];
}
// SQL fingerprints include every persisted column (including human edits and
// complete AI bodies) without copying large/private bodies into job metadata.
function revision(table: typeof kbImages | typeof kbImageSets) {
  const columns = getTableConfig(table).columns.map(column => `\`${column.name}\``);
  return `LOWER(SHA2(CAST(JSON_ARRAY(${columns.join(",")}) AS CHAR CHARACTER SET utf8mb4),256)) AS revisionHash`;
}
const setSelect = `id,userId,workspaceId,asin,productTitle AS title,status,visibility,origin_instance_id AS originInstanceId,remote_id AS remoteId,sync_version AS syncVersion,${revision(kbImageSets)}`;
const imageSelect = `id,imageSetId,imageUrl,imagePosition,positionIndex,tagsConfirmed,analysisConfirmed,aplusModuleType,aplusModuleClass,${IMAGE_TAGGING_TAG_FIELDS.map(key => `\`${key}\``).join(",")},${revision(kbImages)}`;
function multiset(value: unknown[]) { return value.map(item => imageTaggingCanonical(item)).sort(); }
function assetIdentity(image: Record<string, unknown>) {
  return { imageUrl: image.imageUrl, imagePosition: image.imagePosition, positionIndex: image.positionIndex,
    aplusModuleType: image.aplusModuleType, aplusModuleClass: image.aplusModuleClass };
}
/** Not an authorization substitute. Repository establishes fresh membership,
 * resource permissions and schema admission in this exact transaction first. */
export function createImageTaggingSourceCapture(dependencies: { manualProof?: typeof readManualKbImageSnapshotInTransaction } = {}) {
  const manualProof = dependencies.manualProof ?? readManualKbImageSnapshotInTransaction;
  return {
    async capture(tx: ImageTaggingExecutor, rawIdentity: { userId: number; workspaceId: number }, imageSetId: number): Promise<ImageTaggingSource> {
      const identity = ImageTaggingIdentitySchema.parse(rawIdentity);
      if (!Number.isSafeInteger(imageSetId) || imageSetId < 1 || imageSetId > 2147483647) return fail("SOURCE_SCOPE_INVALID");
      // Unlocked hint chooses lock order, never authorizes returned contents.
      const [hint] = await rows(tx, "SELECT id,origin_instance_id AS originInstanceId,remote_id AS remoteId FROM kb_image_sets WHERE id=? AND workspaceId=? AND userId=?", [imageSetId, identity.workspaceId, identity.userId], 1);
      if (!hint) return fail("SOURCE_UNAVAILABLE");
      let captured: ImageTaggingSource | null = null;
      async function locked(proof?: ManualSnapshotPersistentProof) {
        const [set] = await rows(tx, `SELECT ${setSelect} FROM kb_image_sets WHERE id=? AND workspaceId=? AND userId=? LIMIT 2 FOR UPDATE`, [imageSetId, identity.workspaceId, identity.userId], 1);
        if (!set || set.id !== imageSetId || set.userId !== identity.userId || set.workspaceId !== identity.workspaceId
          || !["pending_review", "confirmed"].includes(String(set.status))) return fail("SOURCE_UNAVAILABLE");
        const images = await rows(tx, `SELECT ${imageSelect} FROM kb_images WHERE imageSetId=? ORDER BY id LIMIT 301 FOR UPDATE`, [imageSetId], 300);
        if (!images.length || images.some(image => image.imageSetId !== imageSetId || typeof image.tagsConfirmed !== "number" || ![0, 1].includes(image.tagsConfirmed)
          || typeof image.analysisConfirmed !== "number" || ![0, 1].includes(image.analysisConfirmed))) return fail("SOURCE_UNAVAILABLE");
        if (set.originInstanceId === "manual_acquisition_review_v1") {
          if (!proof || set.visibility !== "private" || proof.publicationState !== "active" || proof.confirmed.id !== set.remoteId
            || proof.revision.version !== set.syncVersion || proof.confirmed.asin !== set.asin || proof.identity.userId !== identity.userId
            || proof.identity.workspaceId !== identity.workspaceId || proof.job.consumerType !== "kb_images"
            || proof.assets.some(asset => typeof asset.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(asset.contentHash))
            || imageTaggingCanonical(multiset(images.map(assetIdentity))) !== imageTaggingCanonical(multiset(proof.assets.map(asset => ({ imageUrl: asset.storageKey,
              imagePosition: asset.role, positionIndex: asset.positionIndex, aplusModuleType: asset.moduleType, aplusModuleClass: asset.moduleClass }))))) return fail("MANUAL_SOURCE_UNVERIFIED");
        } else if (proof || hint.originInstanceId === "manual_acquisition_review_v1") return fail("SOURCE_CHANGED");
        const body = { version: 1 as const, identity, imageSetId, set,
          images: images.map(image => ({ id: image.id, imageSetId: image.imageSetId, imageUrl: image.imageUrl, imagePosition: image.imagePosition,
            positionIndex: image.positionIndex, revisionHash: image.revisionHash,
            originalContentHash: proof?.assets.find(asset => asset.storageKey === image.imageUrl && asset.role === image.imagePosition && asset.positionIndex === image.positionIndex)?.contentHash ?? null,
            tagsConfirmed: image.tagsConfirmed === 1,
            analysisConfirmed: image.analysisConfirmed === 1, tags: Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, image[key]])) })) };
        captured = ImageTaggingSourceSchema.parse({ ...body, sourceHash: imageTaggingHash(body) });
      }
      if (hint.originInstanceId === "manual_acquisition_review_v1") {
        if (!Number.isSafeInteger(hint.remoteId) || Number(hint.remoteId) < 1) return fail("MANUAL_SOURCE_UNVERIFIED");
        const proof = await manualProof(tx, identity.workspaceId, Number(hint.remoteId), identity.userId, async (_executor, verified) => locked(verified));
        if (!proof || !captured) return fail("MANUAL_SOURCE_UNVERIFIED");
      } else await locked();
      if (!captured) return fail("SOURCE_UNAVAILABLE");
      return captured;
    },
  };
}
export const imageTaggingSourceCapture = createImageTaggingSourceCapture();
