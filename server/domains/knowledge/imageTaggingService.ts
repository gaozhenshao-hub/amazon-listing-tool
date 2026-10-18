import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ImageTaggingPreviewInputSchema, ImageTaggingSubmitInputSchema, ImageTaggingOperationInputSchema,
  ImageTaggingApplyInputSchema, ImageTaggingApplyOperationInputSchema, ImageTaggingHistoryInputSchema,
  ImageTaggingPreviewSchema, ImageTaggingJobViewSchema, ImageTaggingApplyReceiptSchema, ImageTaggingHistorySchema,
  imageTaggingEligibility, type ImageTaggingPreviewInput, type ImageTaggingSource,
  type ImageTaggingOperationInput, type ImageTaggingApplyOperationInput } from "../../../shared/imageTagging";
import type { TrpcContext } from "../../_core/context";
import { loadSavedConfiguration } from "../ai_os/services/assistantConversations";
import { createImageTaggingRepository, ImageTaggingRepositoryError, imageTaggingSourceMatchesRun,
  type ImageTaggingPrepare, type ImageTaggingExecutor, type ImageTaggingApplyReceipt } from "./imageTaggingRepository";
import { imageTaggingSourceCapture } from "./imageTaggingSource";
import { imageTaggingRuntime, ImageTaggingRuntimeError } from "./imageTaggingRuntime";
import { ImageTaggingSavedConfigurationSchema } from "./imageTaggingRuntimeContract";
import { imageTaggingImages } from "./imageTaggingImages";

export const imageTaggingWorkerEnabled = () => process.env.ENABLE_IMAGE_TAGGING_WRITES === "true" && process.env.ENABLE_IMAGE_TAGGING_WORKER === "true";
export const imageTaggingRepository = createImageTaggingRepository({ capture: imageTaggingSourceCapture.capture });
export async function loadImageTaggingConfiguration(executor: ImageTaggingExecutor, identity: { userId: number; workspaceId: number }) {
  const value = await loadSavedConfiguration({ executor, identity }, "tagger");
  if (!value) throw new ImageTaggingRepositoryError("CONFIGURATION_UNAVAILABLE");
  return ImageTaggingSavedConfigurationSchema.parse(value);
}
function reason(error: unknown): string {
  if (error instanceof ImageTaggingRepositoryError || error instanceof ImageTaggingRuntimeError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "IMAGE_TAGGING_INPUT_INVALID" });
  const code = reason(error);
  throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /(?:CHANGED|CONFLICT|EXISTS)/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED",
    message: `IMAGE_TAGGING_${/^[A-Z][A-Z0-9_]{0,159}$/u.test(code) ? code : "UNAVAILABLE"}` });
}
/** Explicit business adapter, not a global Skill runner override. HTTP never
 * calls a model, and apply never replaces an AI body or set-level label. */
export function createImageTaggingService(dependencies: Partial<{ repository: typeof imageTaggingRepository;
  runtime: Pick<typeof imageTaggingRuntime, "prepare">; loadConfiguration: typeof loadImageTaggingConfiguration;
  images: Pick<typeof imageTaggingImages, "preview">; enabled: () => boolean }> = {}) {
  const repo = dependencies.repository ?? imageTaggingRepository, runtime = dependencies.runtime ?? imageTaggingRuntime,
    configuration = dependencies.loadConfiguration ?? loadImageTaggingConfiguration, images = dependencies.images ?? imageTaggingImages,
    enabled = dependencies.enabled ?? imageTaggingWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: { userId: number; workspaceId: number }) => Promise<T>): Promise<T> {
    try {
      if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) throw new ImageTaggingRepositoryError("ACCESS_DENIED");
      return await body({ userId: ctx.user.id, workspaceId });
    } catch (error) { return safe(error); }
  }
  function prepare(input: ImageTaggingPreviewInput): ImageTaggingPrepare {
    return async (tx, source) => {
      if (!enabled()) throw new ImageTaggingRepositoryError("EXECUTION_DISABLED");
      const saved = await configuration(tx, source.identity), imageCount = source.images.filter(image => imageTaggingEligibility(image, input.mode) === "pending").length;
      try {
        const value = await runtime.prepare({ executor: tx, identity: source.identity, operationId: input.operationId,
          configuration: saved, sourceHash: source.sourceHash, imageCount });
        return { configuration: saved, runtimeSnapshot: value.runtimeSnapshot };
      } catch (error) { throw new ImageTaggingRepositoryError(reason(error)); }
    };
  }
  async function current(identity: { userId: number; workspaceId: number }, input: ImageTaggingOperationInput): Promise<ImageTaggingSource | null> {
    try { return await repo.readSource(identity, input); }
    catch (error) { if (reason(error) === "ACCESS_DENIED") throw error; return null; }
  }
  async function view(identity: { userId: number; workspaceId: number }, input: ImageTaggingOperationInput,
    value: Awaited<ReturnType<typeof repo.check>>) {
    const run = value.run, source = run ? await current(identity, input) : null;
    const partial = run?.stages.some(stage => stage.candidateHash !== null) && run.state === "failed";
    return ImageTaggingJobViewSchema.parse({ identity, scope: input, runId: run?.runId ?? null,
      state: run ? run.state === "unknown" ? "outcome_unknown" : partial ? "partial" : run.state : value.receipt?.status === "canceled" ? "canceled" : "not_found",
      sourceHash: run?.sourceHash ?? null, currentSourceHash: source?.sourceHash ?? null, sourceChanged: run ? source === null || !imageTaggingSourceMatchesRun(run, source) : false,
      runtimeHash: run?.runtimeSnapshot.snapshotHash ?? null, resultHash: run?.resultHash ?? null,
      configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null,
      maxCostCents: run?.runtimeSnapshot.budgetPlan.maxCostCentsTotal ?? null, reasonCode: run?.errorCode ?? null,
      images: run?.stages.map(stage => ({ imageId: stage.imageId, state: stage.state === "candidate" ? "succeeded" : stage.state === "unknown" ? "outcome_unknown" : stage.state,
        candidate: run.candidates.find(candidate => candidate.imageId === stage.imageId)?.candidate ?? null,
        candidateHash: stage.candidateHash, reasonCode: stage.errorCode, afterImageRevision: stage.afterImageRevision })) ?? [] });
  }
  function receipt(identity: { userId: number; workspaceId: number }, input: ImageTaggingApplyOperationInput, value: ImageTaggingApplyReceipt | null) {
    return ImageTaggingApplyReceiptSchema.parse({ identity, scope: input,
      status: value ? value.status === "canceled" ? "cancelled" : "committed" : "not_found", requestHash: value?.requestHash ?? null,
      afterSourceHash: value?.afterSourceHash ?? null, appliedCount: value?.status === "committed" ? value.acceptedImageIds.length : null,
      excludedCount: value?.status === "committed" ? value.excludedImageIds.length : null, reasonCode: null });
  }
  return {
    preview(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingPreviewInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => {
        let source = await repo.readSource(identity, input), prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
        try { prepared = await repo.preview(identity, input, prepare(input)); source = prepared.source; }
        catch (error) {
          reasonCode = reason(error);
          // Preparation checks stricter run/agent authority. Do not let its
          // failure authorize delivery from an earlier, now-revoked read.
          // A KB-only reader may still inspect the complete fresh source.
          source = await repo.readSource(identity, input);
        }
        const runtimeSnapshot = prepared?.runtimeSnapshot, saved = prepared?.configuration;
        return ImageTaggingPreviewSchema.parse({ identity, scope: input, sourceHash: source.sourceHash, title: source.set.title,
          configuration: saved ? { revision: saved.revision, hash: saved.hash } : null, runtimeHash: runtimeSnapshot?.snapshotHash ?? null,
          skillSlug: runtimeSnapshot?.skill.slug ?? null, modelSlug: runtimeSnapshot?.model.model.slug ?? null,
          budget: runtimeSnapshot ? { currency: "USD", maxCalls: runtimeSnapshot.imageCount,
            maxCostCentsPerImage: runtimeSnapshot.budgetPlan.maxCostCentsPerImage, maxCostCentsTotal: runtimeSnapshot.budgetPlan.maxCostCentsTotal,
            maxImageBytes: 8388608, note: "授权费用上限，不是实际账单；已派发但结果未知的图片不会自动重试" } : null,
          capability: { available: prepared !== null, reasonCode },
          images: await Promise.all(source.images.map(async image => ({ imageId: image.id, revisionHash: image.revisionHash,
            imagePosition: image.imagePosition, positionIndex: image.positionIndex, tags: image.tags,
            eligibility: imageTaggingEligibility(image, input.mode), previewUrl: await images.preview(image) }))) });
      });
    },
    start(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingSubmitInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => {
        await repo.reserve(identity, input, prepare(input));
        const operation = { expectedWorkspaceId: input.expectedWorkspaceId, imageSetId: input.imageSetId, operationId: input.operationId };
        return view(identity, operation, await repo.check(identity, operation));
      });
    },
    check(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.check(identity, input)));
    },
    cancel(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.cancel(identity, input)));
    },
    history(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingHistoryInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => ImageTaggingHistorySchema.parse({ identity, scope: input, ...await repo.history(identity, input) }));
    },
    apply(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingApplyInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, { expectedWorkspaceId: input.expectedWorkspaceId,
        imageSetId: input.imageSetId, operationId: input.operationId, runOperationId: input.runOperationId }, await repo.apply(identity, input)));
    },
    applyCheck(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingApplyOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, input, await repo.applyCheck(identity, input)));
    },
    applyCancel(ctx: TrpcContext, raw: unknown) {
      const input = ImageTaggingApplyOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, input, await repo.applyCancel(identity, input)));
    },
  };
}
export const imageTaggingService = createImageTaggingService();
