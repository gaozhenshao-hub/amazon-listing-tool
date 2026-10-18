import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { acquisitionReviewCanonical } from "../../../shared/acquisitionReview";
import type { DbExecutor } from "../../repositories/dbClient";
import { readManualKbImageSnapshotHistory } from "./manualImageWorkflowProjection";

export type ManualKbImageCoverage = { mode: "manual_revision"; status: "verified"; revisionVersion: number;
  confirmedSnapshotId: number; kept: number; excluded: number; total: number }
  | { mode: "manual_revision"; status: "unavailable"; reasonCode: "MANUAL_VERSION_UNVERIFIED" };
type SetIdentity = { id: number; userId: number; workspaceId: number; asin: string; visibility: string;
  originInstanceId: string | null; remoteId: number | null; syncVersion: number | null };
type ImageIdentity = { id: number; imageSetId: number; imageUrl: string; imagePosition: string; positionIndex: number | null;
  aplusModuleType: string | null; aplusModuleClass: string | null };
const unavailable = (): ManualKbImageCoverage => ({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
const same = (left: unknown, right: unknown) => acquisitionReviewCanonical(left) === acquisitionReviewCanonical(right);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function statement(query: string, values: unknown[]): SQL {
  const parts = query.split("?"); if (parts.length !== values.length + 1) throw new Error("MANUAL_KB_QUERY_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function assetIdentity(image: Pick<ImageIdentity, "imageUrl" | "imagePosition" | "positionIndex" | "aplusModuleType" | "aplusModuleClass">) {
  return { imageUrl: image.imageUrl, imagePosition: image.imagePosition, positionIndex: image.positionIndex,
    aplusModuleType: image.aplusModuleType, aplusModuleClass: image.aplusModuleClass };
}
function multiset(values: unknown[]) { return values.map(value => acquisitionReviewCanonical(value)).sort(); }
/** Per-set coverage is never the default/direct candidate count. A durable
 * reader replays the exact historical confirmation, then this same-transaction
 * callback binds the private image set and every delivered image to that proof. */
export async function readManualKbImageCoverage(db: DbExecutor, owner: { userId: number; workspaceId: number }, set: SetIdentity,
  images: ImageIdentity[], readSnapshot: typeof readManualKbImageSnapshotHistory = readManualKbImageSnapshotHistory): Promise<ManualKbImageCoverage> {
  if (!positive(owner.userId) || !positive(owner.workspaceId) || set.userId !== owner.userId || set.workspaceId !== owner.workspaceId || set.visibility !== "private") {
    throw new TRPCError({ code: "FORBIDDEN", message: "MANUAL_KB_IMAGE_SCOPE_UNAVAILABLE" });
  }
  if (set.originInstanceId !== "manual_acquisition_review_v1" || !positive(set.id) || !positive(set.remoteId) || !positive(set.syncVersion)
    || images.length > 300 || new Set(images.map(image => image.id)).size !== images.length || images.some(image => !positive(image.id) || image.imageSetId !== set.id)) return unavailable();
  let coverage: ManualKbImageCoverage | null = null;
  try {
    const proof = await readSnapshot(db, owner.workspaceId, set.remoteId, owner.userId, async (tx, verified) => {
      async function rows(query: string, values: unknown[], maximum: number) {
        const result = await tx.execute(statement(query, values));
        if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum
          || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("MANUAL_KB_READ_INVALID");
        return result[0] as Array<Record<string, unknown>>;
      }
      const current = await rows("SELECT id,userId,workspaceId,asin,visibility,origin_instance_id AS originInstanceId,remote_id AS remoteId,sync_version AS syncVersion FROM kb_image_sets WHERE id=? AND workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [set.id, owner.workspaceId, owner.userId], 1);
      if (current.length !== 1 || current[0].userId !== owner.userId || current[0].workspaceId !== owner.workspaceId || current[0].visibility !== "private") throw new TRPCError({ code: "FORBIDDEN", message: "MANUAL_KB_IMAGE_SCOPE_UNAVAILABLE" });
      if (!same(current[0], { id: set.id, userId: set.userId, workspaceId: set.workspaceId, asin: set.asin, visibility: set.visibility,
        originInstanceId: set.originInstanceId, remoteId: set.remoteId, syncVersion: set.syncVersion }) || verified.revision.version !== set.syncVersion
        || verified.confirmed.id !== set.remoteId || verified.confirmed.asin !== set.asin || verified.identity.userId !== owner.userId || verified.identity.workspaceId !== owner.workspaceId
        || verified.job.consumerType !== "kb_images" || verified.scope.expectedProjectId !== null || verified.envelope.status !== "confirmed") throw new Error("MANUAL_KB_BINDING_CHANGED");
      const currentImages = await rows("SELECT id,imageSetId,imageUrl,imagePosition,positionIndex,aplusModuleType,aplusModuleClass FROM kb_images WHERE imageSetId=? ORDER BY id LIMIT 301 FOR SHARE", [set.id], 300);
      if (currentImages.some(image => image.imageSetId !== set.id) || !same(multiset(currentImages), multiset(images.map(image => ({ id: image.id, imageSetId: image.imageSetId, ...assetIdentity(image) }))))) throw new Error("MANUAL_KB_IMAGES_CHANGED");
      const selected = verified.assets;
      if (!selected.length || selected.some(asset => !["main", "secondary", "aplus", "brand_story"].includes(asset.role))
        || !same(multiset(images.map(assetIdentity)), multiset(selected.map(asset => ({ imageUrl: asset.storageKey, imagePosition: asset.role,
          positionIndex: asset.positionIndex, aplusModuleType: asset.moduleType, aplusModuleClass: asset.moduleClass }))))) throw new Error("MANUAL_KB_IMAGES_UNVERIFIED");
      const decisions = verified.envelope.assetDecisions;
      if (decisions.some(item => item.decision === "pending") || decisions.filter(item => item.decision === "keep").length !== selected.length) throw new Error("MANUAL_KB_DECISIONS_INVALID");
      coverage = { mode: "manual_revision", status: "verified", revisionVersion: set.syncVersion!, confirmedSnapshotId: set.remoteId!, kept: selected.length,
        excluded: decisions.filter(item => item.decision === "delete").length, total: decisions.length };
    });
    return proof && coverage ? coverage : unavailable();
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") throw error;
    return unavailable(); // No partial proof, guessed zero, private error or fallback direct coverage.
  }
}
