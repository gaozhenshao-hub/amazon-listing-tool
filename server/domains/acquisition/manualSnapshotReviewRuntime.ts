import { TRPCError } from "@trpc/server";
import { AcquisitionReviewIdentitySchema, type AcquisitionReviewImageInput, type AcquisitionReviewImageRecoverInput } from "../../../shared/acquisitionReview";
import { createManualSnapshotConsumerPublisher } from "./manualSnapshotConsumerPublication";
import { createManualSnapshotImageRecovery } from "./manualSnapshotImageRecovery";
import { manualSnapshotImageStorage } from "./manualSnapshotImageStorage";
import { projectManualSnapshotToImageWorkflow } from "./manualImageWorkflowProjection";
import { createManualSnapshotReviewRepository, ManualSnapshotReviewError } from "./manualSnapshotReviewRepository";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";

/** One actual repository for review, publication and image recovery. No hidden
 * model invocation, legacy activation, new database or storage fallback. */
const repository = createManualSnapshotReviewRepository({ publish: createManualSnapshotConsumerPublisher({ imageWorkflow: projectManualSnapshotToImageWorkflow }) });
export const configuredManualSnapshotReview = createManualSnapshotReviewService({ repository,
  imageCapability: () => { try { manualSnapshotImageStorage.assertAvailable(); return { available: true, reasonCode: null }; }
    catch { return { available: false, reasonCode: "IMAGE_STORAGE_UNAVAILABLE" }; } },
});
const imageRecovery = createManualSnapshotImageRecovery({ repository, storage: manualSnapshotImageStorage });
type Context = { user: { id: number }; workspaceId?: number | null };
async function imageOperation(context: Context, input: AcquisitionReviewImageInput | AcquisitionReviewImageRecoverInput, recovery: boolean) {
  if (context.workspaceId !== input.expectedWorkspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ACQUISITION_REVIEW_SCOPE_CHANGED" });
  const identity = AcquisitionReviewIdentitySchema.parse({ userId: context.user.id, workspaceId: context.workspaceId });
  try { return recovery ? await imageRecovery.recover(identity, input) : await imageRecovery.upload(identity, input as AcquisitionReviewImageInput); }
  catch (error) {
    const reason = error instanceof ManualSnapshotReviewError ? `ACQUISITION_REVIEW_${error.code}`
      : error instanceof Error && /^ACQUISITION_(?:IMAGE|REVIEW)_[A-Z0-9_]+$/u.test(error.message) ? error.message : "ACQUISITION_REVIEW_IMAGE_UNAVAILABLE";
    throw new TRPCError({ code: /ACCESS_DENIED/u.test(reason) ? "FORBIDDEN" : /CONFLICT|CHANGED/u.test(reason) ? "CONFLICT" : "PRECONDITION_FAILED", message: reason });
  }
}
export const configuredManualSnapshotImages = {
  upload: (context: Context, input: AcquisitionReviewImageInput) => imageOperation(context, input, false),
  recover: (context: Context, input: AcquisitionReviewImageRecoverInput) => imageOperation(context, input, true),
};
