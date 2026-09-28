import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { acquisitionConfirmedSnapshots } from "../../../drizzle/schema/acquisition";
import { projects } from "../../../drizzle/schema/project";
import { NormalizedAmazonSnapshotSchema } from "./contracts";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  listCompetitorResearchSubjects,
  upsertCompetitorResearchSubject,
} from "../image/competitorGalleryRepository";

const ImageWorkflowConsumerRefSchema = z.string()
  .regex(/^project:\d+:competitor-gallery$/, "invalid image workflow consumer reference");

export function parseImageWorkflowConsumerRef(consumerRef: string) {
  const value = ImageWorkflowConsumerRefSchema.parse(consumerRef);
  const [, projectId] = value.split(":");
  return { projectId: Number(projectId) };
}

export async function projectConfirmedSnapshotToImageWorkflow(input: {
  db: DbExecutor;
  workspaceId: number;
  confirmedSnapshotId: number;
  requestedBy: number;
  consumerRef: string;
}) {
  const { projectId } = parseImageWorkflowConsumerRef(input.consumerRef);
  const [confirmed, project] = await Promise.all([
    input.db.select().from(acquisitionConfirmedSnapshots).where(and(
      eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId),
      eq(acquisitionConfirmedSnapshots.id, input.confirmedSnapshotId),
      eq(acquisitionConfirmedSnapshots.isCurrent, 1),
    )).limit(1),
    input.db.select().from(projects).where(and(
      eq(projects.workspaceId, input.workspaceId),
      eq(projects.id, projectId),
    )).limit(1),
  ]);
  if (!confirmed) throw new Error("confirmed snapshot not found");
  if (!project) throw new Error("image workflow project target not found");

  const snapshot = NormalizedAmazonSnapshotSchema.parse(confirmed.confirmedData);
  const existing = await listCompetitorResearchSubjects(input.db, input.workspaceId, projectId);
  const current = existing.find((subject: any) => subject.confirmedSnapshotId === confirmed.id);
  if (current) {
    return {
      consumerType: "image_workflow" as const,
      projectId,
      subjectId: current.id,
      confirmedSnapshotId: confirmed.id,
      created: false,
    };
  }

  const role = existing.some((subject: any) => subject.role === "primary") ? "benchmark" : "primary";
  const subject = await upsertCompetitorResearchSubject({
    db: input.db,
    workspaceId: input.workspaceId,
    projectId,
    userId: input.requestedBy,
    confirmedSnapshotId: confirmed.id,
    marketplace: confirmed.marketplace,
    asin: confirmed.asin,
    displayName: snapshot.title || confirmed.asin,
    role,
  });
  if (!subject) throw new Error("image workflow competitor subject projection failed");

  return {
    consumerType: "image_workflow" as const,
    projectId,
    subjectId: subject.id,
    confirmedSnapshotId: confirmed.id,
    created: true,
  };
}
