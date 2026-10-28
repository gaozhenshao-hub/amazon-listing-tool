import { and, eq, inArray, sql, isNull } from "drizzle-orm";
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
import { AmazonImageLayoutSchema } from "../../../shared/amazonImageLayout";
import { imageSubtypeFromLayout, validImageBelongSubtype } from "../../../shared/imageBelong";

import { collectionDisplayAsin, knowledgeCollectionVersion } from "../../../shared/knowledgeCollection";

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
  consumerRef?: string;
  repairedAssetIds?: number[];
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
  const allAssets = await input.db.select().from(acquisitionAssetCandidates).where(and(
    eq(acquisitionAssetCandidates.workspaceId, input.workspaceId),
    eq(acquisitionAssetCandidates.snapshotId, confirmed.snapshotId),
  ));
  const assets = allAssets.filter((asset: AcquisitionAssetCandidate) => (
    confirmedAssetIds.has(asset.id) && Boolean(asset.storageKey) && rolesToReplace.includes(asset.role)
  ));

  const refresh = input.consumerRef?.match(/^kb-refresh:([1-9]\d*):([A-Z0-9]{10}):[a-f0-9-]{36}$/);
  if (refresh && refresh[2] !== confirmed.asin) throw new Error("重新采集的 ASIN 不匹配");
  const refreshId = refresh ? Number(refresh[1]) : null;
  const collectionVersion = knowledgeCollectionVersion(input.consumerRef);
  const displayAsin = collectionDisplayAsin(confirmed.asin, collectionVersion);
  const [existingSet] = await input.db.select().from(kbImageSets).where(and(
    eq(kbImageSets.workspaceId, input.workspaceId),
    refreshId ? eq(kbImageSets.id,refreshId) : eq(kbImageSets.asin, displayAsin),
  )).limit(1).for("update");
  if(existingSet?.recycleId)throw new Error("图片集已放入回收站，不可覆盖");
  if(refreshId){
    if(!existingSet || (existingSet.sourceAsin || existingSet.asin.replace(/^新\d*/,""))!==confirmed.asin)throw new Error("重新采集的图片集不存在");
    if(existingSet.userId!==input.requestedBy){
      const [actors]=await input.db.execute(sql`SELECT id FROM users WHERE id=${input.requestedBy} AND role IN ('admin','super_admin') LIMIT 1`);
      if(!actors.length)throw new Error("没有重新采集权限");
    }
  }
  let imageSetId = existingSet?.id;
  const oldLayout = AmazonImageLayoutSchema.safeParse(existingSet?.sourceLayout);
  const nextLayout = AmazonImageLayoutSchema.safeParse(data.sourceLayout);
  const updatedSections = new Set(rolesToReplace.filter(role => role === "aplus" || role === "brand_story"));
  const modules = [
    ...(oldLayout.success ? oldLayout.data.modules.filter(module => !updatedSections.has(module.section)) : []),
    ...(nextLayout.success ? nextLayout.data.modules.filter(module => updatedSections.has(module.section)) : []),
  ];
  const setValues = {
    ...(data.videos ? { videos: data.videos.map(video => {
      const asset = allAssets.find((asset: AcquisitionAssetCandidate) => asset.role === "video" && asset.sourceUrlHash === video.hash && asset.moduleClass === video.moduleId);
      const ready = asset && confirmedAssetIds.has(asset.id) && asset.storageKey && asset.thumbnailStorageKey;
      return { ...video, videoUrl: ready ? asset.storageKey : null, posterUrl: asset?.thumbnailStorageKey ?? null, status: ready ? "ready" as const : "failed" as const };
    }) } : {}),
    sourceAsin: confirmed.asin,
    collectionVersion: refreshId ? existingSet!.collectionVersion : collectionVersion,
    ...(refreshId ? {setCategory:null,setStyle:null,setPrimaryColor:null,setAccentColor:null} : {}),
    sourceLayout: modules.length ? {version: 1 as const, modules} : null,
    productTitle: data.title?.slice(0, 512) ?? existingSet?.productTitle ?? null,
    brand: data.brand?.slice(0, 128) ?? existingSet?.brand ?? null,
    category: data.category?.slice(0, 128) ?? existingSet?.category ?? null,
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
      asin: displayAsin,
      visibility: "team",
      ...setValues,
    }).$returningId();
    imageSetId = Number(created.id);
  }
  if (!imageSetId) throw new Error("kb image set projection failed");

  const previous: Array<typeof kbImages.$inferSelect> = rolesToReplace.length ? await input.db.select().from(kbImages).where(and(
    eq(kbImages.imageSetId, imageSetId),
    isNull(kbImages.recycleId),
    inArray(kbImages.imagePosition, rolesToReplace as Array<"main" | "secondary" | "aplus" | "brand_story">),
  )) : [];
  const retained = new Set<number>();
  for (const asset of assets) {
    if (input.repairedAssetIds && !input.repairedAssetIds.includes(asset.id)) continue;
    // Preserve image identity and human/AI labels when the source is unchanged.
    const match = previous.find(image => !retained.has(image.id) && image.imagePosition === asset.role
      && (image.sourceUrlHash === asset.sourceUrlHash || image.imageUrl === asset.storageKey
        || Boolean(asset.contentHash && image.imageUrl.includes(asset.contentHash))));
    const location = {
      imageSetId,
      imageUrl: asset.storageKey!,
      sourceUrlHash: asset.sourceUrlHash,
      thumbnailUrl: asset.thumbnailStorageKey ?? null,
      imagePosition: asset.role as "main" | "secondary" | "aplus" | "brand_story",
      positionIndex: asset.positionIndex,
    };
    if (match) {
      retained.add(match.id);
      const subtype = imageSubtypeFromLayout(data.sourceLayout, asset.role, asset.sourceUrlHash);
      await input.db.update(kbImages).set({...location, ...(refreshId ? {tagImageTypeMain:null,tagImageTypeSub:null,tagSellingPointCategory:null,tagSellingPointDetail:null,tagComposition:null,tagsConfirmed:0,analysisConfirmed:0,aiDimensionAnalysis:null,userEditedDimensionAnalysis:null,labelRevision:match.labelRevision+1} : {}), ...(!match.tagsConfirmed && !match.analysisConfirmed && subtype
        ? {tagImageBelongSub:subtype,aplusModuleType:subtype} : {})}).where(and(eq(kbImages.id, match.id), eq(kbImages.imageSetId, imageSetId)));
    } else await input.db.insert(kbImages).values({
      ...location,
      tagImageBelong: imageBelongForRole(asset.role),
      tagImageBelongSub: imageSubtypeFromLayout(data.sourceLayout, asset.role, asset.sourceUrlHash)
        || validImageBelongSubtype(imageBelongForRole(asset.role) || "", asset.moduleType),
      aplusModuleType: asset.moduleType,
      aplusModuleClass: asset.moduleClass,
      tagsConfirmed: 0,
      analysisConfirmed: 0,
    });
  }
  const obsolete = previous.filter(image => !retained.has(image.id)).map(image => image.id);
  if (obsolete.length && !input.repairedAssetIds) {
    await input.db.delete(kbImages).where(and(eq(kbImages.imageSetId, imageSetId), inArray(kbImages.id, obsolete)));
  }
  if(refreshId)await input.db.execute(sql`UPDATE kb_videos SET labelStatus='unlabeled',aiAnalysis=NULL,userEditedAnalysis=NULL,labelRevision=labelRevision+1 WHERE imageSetId=${imageSetId} AND workspaceId=${input.workspaceId} AND recycleId IS NULL`);
  await input.db.execute(sql`UPDATE acquisition_jobs j
    JOIN acquisition_source_snapshots s ON s.job_id=j.id AND s.workspace_id=j.workspace_id
    JOIN acquisition_confirmed_snapshots c ON c.snapshot_id=s.id AND c.workspace_id=j.workspace_id
    SET j.ingested_set_id=${imageSetId} WHERE c.id=${input.confirmedSnapshotId} AND j.workspace_id=${input.workspaceId} AND j.consumer_type='kb_images'`);
  return { imageSetId, workspaceId: input.workspaceId, userId: existingSet?.userId ?? input.requestedBy,
    projectedImageCount: assets.length, replacedRoles: rolesToReplace };
}
