import { z } from "zod";
import { AcquisitionReviewIdentitySchema } from "./acquisitionReview";
const id = z.number().int().min(1).max(2147483647);
export const AcquisitionReviewLocationInputSchema = z.union([
  z.object({ expectedWorkspaceId: id, jobId: id }).strict(),
  z.object({ expectedWorkspaceId: id, snapshotId: id }).strict(),
]);
export const AcquisitionReviewLocationResultSchema = z.object({
  identity: AcquisitionReviewIdentitySchema, jobId: id,
  status: z.enum(["queued", "running", "review_required", "confirmed", "failed", "canceled"]),
  snapshotId: id.nullable(), projectId: id.nullable(),
}).strict();
export type AcquisitionReviewLocationInput = z.infer<typeof AcquisitionReviewLocationInputSchema>;
export type AcquisitionReviewLocationResult = z.infer<typeof AcquisitionReviewLocationResultSchema>;
