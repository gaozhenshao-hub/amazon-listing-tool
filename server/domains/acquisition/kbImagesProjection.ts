import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  acquisitionConfirmedSnapshots,
  acquisitionAssetCandidates,
  type AcquisitionAssetCandidate,
} from "../../../drizzle/schema/acquisition";
import { kbImageSets, kbImages } from "../../../drizzle/schema/image";
import type { AmazonAcquisitionCapability, AcquisitionAssetRole } from "../../../shared/acquisition";
import { NormalizedAmazonSnapshotSchema, AmazonAcquisitionCapabilitySchema } from "./contracts";
import type { DbExecutor } from "../../repositories/dbClient";

const ConfirmedAssetIdsSchema = z.array(z.number().int().positive());

const capabilityProjection = {
  image_gallery: { field: "imageGallery", roles: ["main", "secondary"] },
  aplus: { field: "aplus", roles: ["aplus"] },
  brand_story: { field: "brandStory", roles: ["brand_story"] },
} as const;

type ProjectableCapability = keyof typeof capabilityProjection;

function isFieldConfirmed(fieldStatuses: unknown, field: string): boolean {
  if (!fieldStatuses || typeof fieldStatuses !== "object" || Array.isArray(fieldStatuses)) return false;
  const evidence = (fieldStatuses as Record<string, unknown>)[field];
  return Boolean(evidence && typeof evidence === "object" && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).status === "confirmed");
}

export function projectionRolesForCapabilities(
  capabilities: readonly AmazonAcquisitionCapability[],
  fieldStatuses: unknown,
): AcquisitionAssetRole[] {
  const roles = new Set<AcquisitionAssetRole>();
  for (const capability of capabilities) {
    if (!(capability in capabilityProjection)) continue;
    const config = capabilityProjection[capability as ProjectableCapability];
    if (!isFieldConfirmed(fieldStatuses, config.field)) continue;
    for (const role of config.roles) roles.add(role);
  }
  return [...roles];
}

function imageBelongForRole(role: AcquisitionAssetRole): string | null {
  if (role === "main") return "主图";
  if (role === "secondary") return "套图";
  if (role === "aplus") return "A+";
  if (role === "brand_story") return "品牌故事";
  return null;
}

export async function projectConfirmedSnapshotToKbImages(input: {
  db: DbExecutor;
  workspaceId: number;
  confirmedSnapshotId: number;
  requestedBy: number;
  requestedCapabilities: unknown;
}) {
  const [confirmed] = await input.db.select().from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId),
    eq(acquisitionConfirmedSnapshots.id, input.confirmedSnapshotId),
  )).limit(1);
  if (!confirmed) throw new Error("confirmed snapshot not found");

  const data = NormalizedAmazonSnapshotSchema.parse(confirmed.confirmedData);
  const capabilities = z.array(AmazonAcquisitionCapabilitySchema).parse(input.requestedCapabilities);
  const rolesToReplace = projectionRolesForCapabilities(capabilities, confirmed.fieldStatuses);
  const confirmedAssetIds = new Set(ConfirmedAssetIdsSchema.parse(confirmed.confirmedAssetIds));
  const assets = (await input.db.select().from(acquisitionAssetCandidates).where(and(
    eq(acquisitionAssetCandidates.workspaceId, input.workspaceId),
    eq(acquisitionAssetCandidates.snapshotId, confirmed.snapshotId),
  ))).filter((asset: AcquisitionAssetCandidate) => (
    confirmedAssetIds.has(asset.id) && Boolean(asset.storageKey) && rolesToReplace.includes(asset.role)
  ));

  const [existingSet] = await input.db.select().from(kbImageSets).where(and(
    eq(kbImageSets.workspaceId, input.workspaceId),
    eq(kbImageSets.asin, confirmed.asin),
  )).limit(1);
  let imageSetId = existingSet?.id;
  const setValues = {
    productTitle: data.title?.slice(0, 512) ?? null,
    brand: data.brand?.slice(0, 128) ?? null,
    category: data.category?.slice(0, 128) ?? null,
    status: "confirmed" as const,
    reviewStatus: "approved" as const,
    reviewedBy: input.requestedBy,
    reviewedAt: new Date(),
    confirmedAt: new Date(),
    originInstanceId: "unified_amazon_acquisition",
    remoteId: confirmed.id,
    syncVersion: confirmed.confirmationVersion,
    lastSyncedAt: new Date(),
  };
  if (imageSetId) {
    await input.db.update(kbImageSets).set(setValues).where(and(
      eq(kbImageSets.workspaceId, input.workspaceId),
      eq(kbImageSets.id, imageSetId),
    ));
  } else {
    const [created] = await input.db.insert(kbImageSets).values({
      workspaceId: input.workspaceId,
      userId: input.requestedBy,
      asin: confirmed.asin,
      visibility: "team",
      ...setValues,
    }).$returningId();
    imageSetId = Number(created.id);
  }
  if (!imageSetId) throw new Error("kb image set projection failed");

  if (rolesToReplace.length > 0) {
    await input.db.delete(kbImages).where(and(
      eq(kbImages.imageSetId, imageSetId),
      inArray(kbImages.imagePosition, rolesToReplace as Array<"main" | "secondary" | "aplus" | "brand_story">),
    ));
  }
  if (assets.length > 0) {
    await input.db.insert(kbImages).values(assets.map((asset: AcquisitionAssetCandidate) => ({
      imageSetId,
      imageUrl: asset.storageKey!,
      imagePosition: asset.role as "main" | "secondary" | "aplus" | "brand_story",
      positionIndex: asset.positionIndex,
      tagImageBelong: imageBelongForRole(asset.role),
      tagImageBelongSub: asset.role === "aplus" ? asset.moduleType : null,
      aplusModuleType: asset.moduleType,
      aplusModuleClass: asset.moduleClass,
      tagsConfirmed: 0,
      analysisConfirmed: 0,
    })));
  }
  return { imageSetId, projectedImageCount: assets.length, replacedRoles: rolesToReplace };
}
