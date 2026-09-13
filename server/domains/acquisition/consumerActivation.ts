import type { DbExecutor } from "../../repositories/dbClient";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import { createConsumerLink, supersedeConsumerLinks } from "./repository";
import { projectConfirmedSnapshotToKbImages } from "./kbImagesProjection";
import { projectConfirmedSnapshotToLegacyConsumer } from "./legacyConsumerProjection";

export async function activateConfirmedSnapshotForConsumer(input: {
  db: DbExecutor;
  workspaceId: number;
  confirmedSnapshotId: number;
  job: {
    requestedBy: number;
    consumerType: string;
    consumerRef: string;
    requestedCapabilities: unknown;
  };
  activatedBy: number;
}) {
  const capabilities = AmazonAcquisitionCapabilitySchema.array().parse(input.job.requestedCapabilities);
  const projection = input.job.consumerType === "kb_images"
    ? {
      consumerType: "kb_images" as const,
      ...(await projectConfirmedSnapshotToKbImages({
        db: input.db,
        workspaceId: input.workspaceId,
        confirmedSnapshotId: input.confirmedSnapshotId,
        requestedBy: input.job.requestedBy,
        requestedCapabilities: capabilities,
      })),
    }
    : ["kb_listing", "kb_product", "project_competitor", "conversion_collector"].includes(input.job.consumerType)
      ? await projectConfirmedSnapshotToLegacyConsumer({
        db: input.db,
        workspaceId: input.workspaceId,
        confirmedSnapshotId: input.confirmedSnapshotId,
        requestedBy: input.job.requestedBy,
        consumerType: input.job.consumerType as "kb_listing" | "kb_product" | "project_competitor" | "conversion_collector",
        consumerRef: input.job.consumerRef,
      })
      : null;
  for (const capability of capabilities) {
    await supersedeConsumerLinks({
      db: input.db,
      workspaceId: input.workspaceId,
      consumerType: input.job.consumerType,
      consumerRef: input.job.consumerRef,
      capabilityScope: capability,
    });
    await createConsumerLink(input.db, {
      workspaceId: input.workspaceId,
      confirmedSnapshotId: input.confirmedSnapshotId,
      consumerType: input.job.consumerType,
      consumerRef: input.job.consumerRef,
      capabilityScope: capability,
      projectionVersion: projection?.consumerType === "kb_images"
        ? "kb_images_projection_v1"
        : projection
          ? "amazon_legacy_consumer_projection_v1"
          : "amazon_snapshot_projection_v1",
      status: "active",
      createdBy: input.activatedBy,
    });
  }
  return projection;
}
