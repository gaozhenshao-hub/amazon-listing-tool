import type { DbExecutor } from "../../repositories/dbClient";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import { createConsumerLink, supersedeConsumerLinks } from "./repository";
import { projectConfirmedSnapshotToKbImages } from "./kbImagesProjection";

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
    ? await projectConfirmedSnapshotToKbImages({
      db: input.db,
      workspaceId: input.workspaceId,
      confirmedSnapshotId: input.confirmedSnapshotId,
      requestedBy: input.job.requestedBy,
      requestedCapabilities: capabilities,
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
      projectionVersion: projection ? "kb_images_projection_v1" : "amazon_snapshot_projection_v1",
      status: "active",
      createdBy: input.activatedBy,
    });
  }
  return projection;
}
