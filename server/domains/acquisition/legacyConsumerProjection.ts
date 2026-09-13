import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  acquisitionAssetCandidates,
  acquisitionConfirmedSnapshots,
  type AcquisitionAssetCandidate,
} from "../../../drizzle/schema/acquisition";
import { kbListingCopywriting, kbProductInnovations } from "../../../drizzle/schema/knowledge";
import { projects } from "../../../drizzle/schema/project";
import { NormalizedAmazonSnapshotSchema } from "./contracts";
import {
  parseLegacySnapshotConsumerRef,
  type LegacySnapshotConsumerType,
} from "./legacyConsumerContracts";
import type { DbExecutor } from "../../repositories/dbClient";

const ConfirmedAssetIdsSchema = z.array(z.number().int().positive());

function confirmedField(fieldStatuses: unknown, field: string): boolean {
  if (!fieldStatuses || typeof fieldStatuses !== "object" || Array.isArray(fieldStatuses)) return false;
  const evidence = (fieldStatuses as Record<string, unknown>)[field];
  return Boolean(evidence && typeof evidence === "object" && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).status === "confirmed");
}

export async function loadConfirmedSnapshotForConsumer(input: {
  db: DbExecutor;
  workspaceId: number;
  confirmedSnapshotId: number;
}) {
  const [confirmed] = await input.db.select().from(acquisitionConfirmedSnapshots).where(and(
    eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId),
    eq(acquisitionConfirmedSnapshots.id, input.confirmedSnapshotId),
  )).limit(1);
  if (!confirmed) throw new Error("confirmed snapshot not found");
  const data = NormalizedAmazonSnapshotSchema.parse(confirmed.confirmedData);
  const confirmedAssetIds = new Set(ConfirmedAssetIdsSchema.parse(confirmed.confirmedAssetIds));
  const assets = (await input.db.select().from(acquisitionAssetCandidates).where(and(
    eq(acquisitionAssetCandidates.workspaceId, input.workspaceId),
    eq(acquisitionAssetCandidates.snapshotId, confirmed.snapshotId),
  ))).filter((asset: AcquisitionAssetCandidate) => confirmedAssetIds.has(asset.id) && Boolean(asset.storageKey));
  return { confirmed, data, assets };
}

function acquisitionReference(input: {
  confirmedSnapshotId: number;
  contentHash: string;
  confirmationVersion: number;
}) {
  return JSON.stringify({
    source: "unified_amazon_acquisition",
    confirmedSnapshotId: input.confirmedSnapshotId,
    contentHash: input.contentHash,
    confirmationVersion: input.confirmationVersion,
  });
}

function catalogProjection(data: ReturnType<typeof NormalizedAmazonSnapshotSchema.parse>, fieldStatuses: unknown) {
  return {
    ...(confirmedField(fieldStatuses, "title") ? { productTitle: data.title } : {}),
    ...(confirmedField(fieldStatuses, "brand") ? { brand: data.brand } : {}),
    ...(confirmedField(fieldStatuses, "category") ? { category: data.category } : {}),
  };
}

export type LegacyConsumerProjection =
  | { consumerType: "kb_listing"; recordId: number; workspaceId: number; userId: number; asin: string; confirmedSnapshotId: number }
  | { consumerType: "kb_product"; recordId: number; workspaceId: number; userId: number; asin: string; confirmedSnapshotId: number }
  | { consumerType: "project_competitor"; projectId: number; workspaceId: number; userId: number; asin: string; confirmedSnapshotId: number }
  | { consumerType: "conversion_collector"; workspaceId: number; userId: number; asin: string; confirmedSnapshotId: number };

export async function projectConfirmedSnapshotToLegacyConsumer(input: {
  db: DbExecutor;
  workspaceId: number;
  confirmedSnapshotId: number;
  requestedBy: number;
  consumerType: LegacySnapshotConsumerType;
  consumerRef: string;
}): Promise<LegacyConsumerProjection> {
  const target = parseLegacySnapshotConsumerRef(input.consumerType, input.consumerRef);
  const { confirmed, data, assets } = await loadConfirmedSnapshotForConsumer(input);
  const sourceRef = acquisitionReference({
    confirmedSnapshotId: confirmed.id,
    contentHash: confirmed.contentHash,
    confirmationVersion: confirmed.confirmationVersion,
  });
  const syncFields = {
    originInstanceId: "unified_amazon_acquisition",
    remoteId: confirmed.id,
    syncVersion: confirmed.confirmationVersion,
    lastSyncedAt: new Date(),
  };

  if (target.type === "kb_listing") {
    const [record] = await input.db.select().from(kbListingCopywriting).where(and(
      eq(kbListingCopywriting.workspaceId, input.workspaceId),
      eq(kbListingCopywriting.id, target.recordId),
    )).limit(1);
    if (!record || record.asin !== confirmed.asin) throw new Error("kb listing consumer target mismatch");
    const values: Partial<typeof kbListingCopywriting.$inferInsert> = {
      ...catalogProjection(data, confirmed.fieldStatuses),
      ...(confirmedField(confirmed.fieldStatuses, "title") ? { titleText: data.title } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "bulletPoints") ? { bulletPoints: JSON.stringify(data.bulletPoints) } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "description") ? { longDescription: data.description } : {}),
      crawledData: sourceRef,
      status: "analyzing",
      ...syncFields,
    };
    await input.db.update(kbListingCopywriting).set(values).where(and(
      eq(kbListingCopywriting.workspaceId, input.workspaceId),
      eq(kbListingCopywriting.id, target.recordId),
    ));
    return { consumerType: target.type, recordId: target.recordId, workspaceId: input.workspaceId, userId: record.userId, asin: confirmed.asin, confirmedSnapshotId: confirmed.id };
  }

  if (target.type === "kb_product") {
    const [record] = await input.db.select().from(kbProductInnovations).where(and(
      eq(kbProductInnovations.workspaceId, input.workspaceId),
      eq(kbProductInnovations.id, target.recordId),
    )).limit(1);
    if (!record || record.asin !== confirmed.asin) throw new Error("kb product consumer target mismatch");
    const gallery = (assets as AcquisitionAssetCandidate[])
      .filter((asset: AcquisitionAssetCandidate) => asset.role === "main" || asset.role === "secondary")
      .sort((a: AcquisitionAssetCandidate, b: AcquisitionAssetCandidate) => a.positionIndex - b.positionIndex)
      .map((asset: AcquisitionAssetCandidate) => asset.storageKey!);
    const values: Partial<typeof kbProductInnovations.$inferInsert> = {
      ...catalogProjection(data, confirmed.fieldStatuses),
      ...(confirmedField(confirmed.fieldStatuses, "price") ? { price: data.price ? `${data.price.value} ${data.price.currency}` : null } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "rating") ? { rating: data.rating } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "reviewCount") ? { reviewCount: data.reviewCount === null ? null : String(data.reviewCount) } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "bulletPoints") ? { bulletPoints: JSON.stringify(data.bulletPoints) } : {}),
      ...(confirmedField(confirmed.fieldStatuses, "imageGallery") ? { imageUrls: JSON.stringify(gallery) } : {}),
      productUrl: `https://www.amazon.com/dp/${confirmed.asin}`,
      crawledData: sourceRef,
      status: "analyzing",
      ...syncFields,
    };
    await input.db.update(kbProductInnovations).set(values).where(and(
      eq(kbProductInnovations.workspaceId, input.workspaceId),
      eq(kbProductInnovations.id, target.recordId),
    ));
    return { consumerType: target.type, recordId: target.recordId, workspaceId: input.workspaceId, userId: record.userId, asin: confirmed.asin, confirmedSnapshotId: confirmed.id };
  }

  if (target.type === "project_competitor") {
    if (target.asin !== confirmed.asin) throw new Error("project competitor ASIN mismatch");
    const [project] = await input.db.select().from(projects).where(and(
      eq(projects.id, target.projectId),
      eq(projects.workspaceId, input.workspaceId),
    )).limit(1);
    if (!project) throw new Error("project competitor target not found");
    await input.db.update(projects).set({ status: "analyzing" }).where(eq(projects.id, target.projectId));
    return { consumerType: target.type, projectId: target.projectId, workspaceId: input.workspaceId, userId: project.userId, asin: confirmed.asin, confirmedSnapshotId: confirmed.id };
  }

  if (target.asin !== confirmed.asin) throw new Error("conversion collector ASIN mismatch");
  return { consumerType: target.type, workspaceId: input.workspaceId, userId: input.requestedBy, asin: confirmed.asin, confirmedSnapshotId: confirmed.id };
}
