import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AcquisitionReviewIdentitySchema, AcquisitionReviewReadInputSchema, AcquisitionReviewReadResultSchema,
  AcquisitionReviewWriteInputSchema, AcquisitionReviewRecoverInputSchema, AcquisitionReviewWriteResultSchema,
  type AcquisitionReviewIdentity, type AcquisitionReviewReadInput, type AcquisitionReviewWriteInput,
  type AcquisitionReviewRecoverInput, type AcquisitionReviewWriteResult } from "../../../shared/acquisitionReview";
import { resolveStoredObjectUrl } from "../../storage";
import { manualSnapshotObject } from "./manualSnapshotRevision";
import { manualSnapshotReviewRepository, ManualSnapshotReviewError, type ManualSnapshotReviewRepository } from "./manualSnapshotReviewRepository";

type Context = { user: { id: number }; workspaceId?: number | null };
function identityOf(context: Context, input: AcquisitionReviewReadInput): AcquisitionReviewIdentity {
  if (context.workspaceId !== input.expectedWorkspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ACQUISITION_REVIEW_SCOPE_CHANGED" });
  return AcquisitionReviewIdentitySchema.parse({ userId: context.user.id, workspaceId: context.workspaceId });
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ManualSnapshotReviewError) throw new TRPCError({ code: error.code === "ACCESS_DENIED" ? "FORBIDDEN"
    : /CONFLICT|CHANGED|CANCELLED/u.test(error.code) ? "CONFLICT" : "PRECONDITION_FAILED", message: `ACQUISITION_REVIEW_${error.code}` });
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "ACQUISITION_REVIEW_INPUT_INVALID" });
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ACQUISITION_REVIEW_UNAVAILABLE" });
}
function unknown(identity: AcquisitionReviewIdentity, input: AcquisitionReviewWriteInput | AcquisitionReviewRecoverInput): AcquisitionReviewWriteResult {
  return AcquisitionReviewWriteResultSchema.parse({ identity, scope: { expectedWorkspaceId: input.expectedWorkspaceId, expectedProjectId: input.expectedProjectId, snapshotId: input.snapshotId },
    operationId: input.operationId, action: null, status: "unknown", requestHash: null, revisionId: null, revisionVersion: null,
    committedRevisionHash: null, confirmedSnapshotId: null, reasonCode: "OUTCOME_UNKNOWN" });
}
export function createManualSnapshotReviewService(dependencies: { repository?: ManualSnapshotReviewRepository; previewUrl?: (storageUri: string) => Promise<string>;
  imageCapability?: () => { available: boolean; reasonCode: string | null } } = {}) {
  const repository = dependencies.repository ?? manualSnapshotReviewRepository;
  const previewUrl = dependencies.previewUrl ?? resolveStoredObjectUrl;
  async function read(context: Context, raw: AcquisitionReviewReadInput) {
    try {
      const input = AcquisitionReviewReadInputSchema.parse(raw), identity = identityOf(context, input);
      const value = await repository.transaction(identity, input, "read", async session => {
        const { snapshot, job, revision, replay, assets } = session;
        const original = manualSnapshotObject(snapshot.normalizedData), effectiveDraft = replay?.effectiveData ?? original;
        const ready = !["queued", "running"].includes(job.status), enabled = session.enabled();
        const supplementIds = new Set(replay?.revision.supplements.map(item => item.assetId) ?? []);
        const decisions = replay?.revision.assetDecisions ?? assets.map(asset => ({ assetId: asset.id, decision: asset.storageKey && asset.fieldStatus === "pending_review" ? "keep" as const : "pending" as const }));
        const capability = (reasonCode: string | null) => ({ available: reasonCode === null, reasonCode });
        const unavailable = !ready ? "JOB_IN_PROGRESS" : !enabled ? "WRITES_DISABLED" : null;
        const pending = replay?.revision.status === "pending_review";
        const canConfirm = decisions.every(item => item.decision !== "pending") && assets.some(asset => decisions.some(item => item.assetId === asset.id && item.decision === "keep") && (asset.role === "main" || asset.role === "secondary"));
        return { identity, scope: input, snapshot: { id: snapshot.id, jobId: job.id, asin: snapshot.asin, marketplace: snapshot.marketplace,
          status: snapshot.status, jobStatus: job.status, consumerType: job.consumerType, consumerRef: job.consumerRef, sourceHash: snapshot.sourceHash },
          original, effectiveDraft, revision: revision && replay ? { id: revision.id, version: revision.version, hash: revision.revisionHash, status: replay.revision.status, note: revision.note } : null,
          revisionHash: session.stateHash,
          assets: await Promise.all(assets.map(async asset => {
            let url: string | null = null;
            if (asset.storageKey && /^storage:\/\/(?:s3|oss|local)\/acquisition(?:-review)?\//u.test(asset.storageKey)) {
              try { const signed = await previewUrl(asset.storageKey); if (/^https:\/\//u.test(signed) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//u.test(signed)) url = signed; } catch { /* Visible metadata gap; never invent preview. */ }
            }
            return { id: asset.id, role: asset.role, positionIndex: asset.positionIndex, fieldStatus: asset.fieldStatus,
              storageAvailable: Boolean(asset.storageKey && asset.contentHash), contentHash: asset.contentHash,
              decision: decisions.find(item => item.assetId === asset.id)?.decision ?? "pending", origin: supplementIds.has(asset.id) ? "supplement" : "original",
              replacesAssetId: replay?.revision.supplements.find(item => item.assetId === asset.id)?.replacesAssetId ?? null,
              previewUrl: url, width: asset.width, height: asset.height };
          })), capabilities: { save: capability(unavailable), confirm: capability(unavailable ?? (!pending ? "DRAFT_REQUIRED" : replay.revision.consumerLinksHash !== session.consumerLinksHash ? "CONSUMER_CHANGED" : !canConfirm ? "ASSET_DECISIONS_INCOMPLETE" : !session.publishAvailable() ? "PUBLISH_UNAVAILABLE" : null)),
            reject: capability(unavailable ?? (!pending ? "DRAFT_REQUIRED" : null)), image: unavailable ? capability(unavailable)
              : dependencies.imageCapability?.() ?? capability("IMAGE_STORAGE_UNAVAILABLE") } };
      });
      return AcquisitionReviewReadResultSchema.parse(value);
    } catch (error) { return safeError(error); }
  }
  async function execute(context: Context, raw: AcquisitionReviewWriteInput) {
    let identity: AcquisitionReviewIdentity | undefined, input: AcquisitionReviewWriteInput | undefined;
    try {
      input = AcquisitionReviewWriteInputSchema.parse(raw); identity = identityOf(context, input);
      const scope = { expectedWorkspaceId: input.expectedWorkspaceId, expectedProjectId: input.expectedProjectId, snapshotId: input.snapshotId };
      return await repository.transaction(identity, scope, "write", session => session.execute(input!));
    } catch (error) {
      if (identity && input && error instanceof ManualSnapshotReviewError && ["COMMIT_UNKNOWN", "STORAGE_UNKNOWN"].includes(error.code)) return unknown(identity, input);
      return safeError(error);
    }
  }
  async function recover(context: Context, raw: AcquisitionReviewRecoverInput) {
    let identity: AcquisitionReviewIdentity | undefined, input: AcquisitionReviewRecoverInput | undefined;
    try {
      input = AcquisitionReviewRecoverInputSchema.parse(raw); identity = identityOf(context, input);
      const scope = { expectedWorkspaceId: input.expectedWorkspaceId, expectedProjectId: input.expectedProjectId, snapshotId: input.snapshotId };
      return await repository.transaction(identity, scope, "recover", async session => {
        const journal = session.journal(input!.operationId);
        return input!.decision === "cancel" ? journal.cancel() : (await journal.read()).final ?? session.unknown(input!.operationId);
      });
    } catch (error) {
      if (identity && input && error instanceof ManualSnapshotReviewError && ["COMMIT_UNKNOWN", "STORAGE_UNKNOWN"].includes(error.code)) return unknown(identity, input);
      return safeError(error);
    }
  }
  return { read, execute, recover };
}
export const manualSnapshotReviewService = createManualSnapshotReviewService();
