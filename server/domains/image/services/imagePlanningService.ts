import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { ImagePlanningPreviewInputSchema, ImagePlanningStartInputSchema, ImagePlanningOperationInputSchema,
  ImagePlanningApplyInputSchema, ImagePlanningApplyOperationInputSchema, ImagePlanningHistoryInputSchema,
  ImagePlanningPreviewSchema, ImagePlanningJobViewSchema, ImagePlanningApplyReceiptSchema, ImagePlanningHistorySchema,
  type ImagePlanningIdentity, type ImagePlanningOperationInput, type ImagePlanningSource } from "../../../../shared/imagePlanning";
import { loadSavedConfiguration } from "../../ai_os/services/assistantConversations";
import { ImagePlanningSavedConfigurationSchema } from "./imagePlanningRuntimeContract";
import { createImagePlanningRepository, ImagePlanningRepositoryError, type ImagePlanningPrepare } from "./imagePlanningRepository";
import { imagePlanningRuntime, ImagePlanningRuntimeError } from "./imagePlanningRuntime";
import type { ImagePlanningExecutor } from "./imagePlanningSource";

export const imagePlanningWorkerEnabled = () => process.env.ENABLE_IMAGE_PLANNING_WRITES === "true" && process.env.ENABLE_IMAGE_PLANNING_WORKER === "true";
export const imagePlanningRepository = createImagePlanningRepository();
export async function loadImagePlanningConfiguration(executor: ImagePlanningExecutor, identity: ImagePlanningIdentity) {
  const value = await loadSavedConfiguration({ executor, identity }, "images");
  if (!value) throw new ImagePlanningRepositoryError("CONFIGURATION_UNAVAILABLE");
  return ImagePlanningSavedConfigurationSchema.parse(value);
}
export function imagePlanningReason(error: unknown): string {
  if (error instanceof ImagePlanningRepositoryError || error instanceof ImagePlanningRuntimeError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "IMAGE_PLANNING_INPUT_INVALID" });
  const code = imagePlanningReason(error);
  throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED", message: `IMAGE_PLANNING_${/^[A-Z][A-Z0-9_]{0,159}$/u.test(code) ? code : "UNAVAILABLE"}` });
}
/** HTTP only previews or journals commands. Provider dispatch belongs solely to
 * the dedicated worker; apply writes an unconfirmed draft, never approval. */
export function createImagePlanningService(deps: Partial<{ repository: typeof imagePlanningRepository; runtime: Pick<typeof imagePlanningRuntime, "prepare">;
  loadConfiguration: typeof loadImagePlanningConfiguration; enabled: () => boolean }> = {}) {
  const repo = deps.repository ?? imagePlanningRepository, runtime = deps.runtime ?? imagePlanningRuntime,
    configuration = deps.loadConfiguration ?? loadImagePlanningConfiguration, enabled = deps.enabled ?? imagePlanningWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, work: (identity: ImagePlanningIdentity) => Promise<T>): Promise<T> {
    try {
      if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) throw new ImagePlanningRepositoryError("ACCESS_DENIED");
      return await work({ userId: ctx.user.id, workspaceId });
    } catch (error) { return safe(error); }
  }
  const preparation = (operationId: string): ImagePlanningPrepare => async (tx, source) => {
    if (!enabled()) throw new ImagePlanningRepositoryError("EXECUTION_DISABLED");
    const saved = await configuration(tx, source.identity);
    const prepared = await runtime.prepare({ executor: tx, source, configuration: saved, operationId });
    return { configuration: saved, runtimeSnapshot: prepared.runtimeSnapshot };
  };
  async function view(identity: ImagePlanningIdentity, scope: ImagePlanningOperationInput, result: Awaited<ReturnType<typeof repo.check>>) {
    let current: ImagePlanningSource | null = null;
    if (result.run) {
      try { current = await repo.readSource(identity, scope); }
      catch (error) { if (imagePlanningReason(error) === "ACCESS_DENIED") throw error; }
    }
    const run = result.run;
    return ImagePlanningJobViewSchema.parse({ identity, scope, runId: run?.runId ?? null,
      state: run?.state ?? (result.receipt?.status === "cancelled" ? "canceled" : "not_found"),
      sourceHash: run?.sourceHash ?? null, currentSourceHash: current?.sourceHash ?? null, sourceChanged: run ? current?.sourceHash !== run.sourceHash : false,
      runtimeHash: run?.runtimeSnapshot.snapshotHash ?? null, resultHash: run?.resultHash ?? null, candidate: run?.candidate ?? null,
      configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null,
      maxCostCents: run?.runtimeSnapshot.budgetPlan.maxCostCentsTotal ?? null, reasonCode: run?.errorCode ?? null });
  }
  return {
    preview(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningPreviewInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      let source = await repo.readSource(identity, input), prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
      try { prepared = await repo.preview(identity, input, preparation(input.operationId)); source = prepared.source; }
      catch (error) { reasonCode = imagePlanningReason(error); source = await repo.readSource(identity, input); }
      const snapshot = prepared?.runtimeSnapshot;
      return ImagePlanningPreviewSchema.parse({ identity, scope: input, sourceHash: source.sourceHash, sourceRevision: source.sourceRevision, scopeRevision: source.scopeRevision,
        title: String(source.project.productName ?? source.project.name ?? "图片大纲"), coverage: source.coverage,
        counts: { confirmedSteps: source.confirmedSteps.length, files: source.files.length, competitors: source.competitors.length, comparisons: source.comparisons.length, keywordAnalyses: source.keywordAnalyses.length },
        configuration: snapshot ? { revision: snapshot.configuration.revision, hash: snapshot.configuration.hash } : null,
        runtimeHash: snapshot?.snapshotHash ?? null, skillSlug: snapshot?.skill.slug ?? null, modelSlug: snapshot?.model.model.slug ?? null,
        maxCostCents: snapshot?.budgetPlan.maxCostCentsTotal ?? null, maxCalls: 1, capability: { available: prepared !== null, reasonCode } });
    }); },
    start(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningStartInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      await repo.reserve(identity, input, preparation(input.operationId)); const scope = ImagePlanningOperationInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, sessionId: input.sessionId, operationId: input.operationId });
      return view(identity, scope, await repo.check(identity, scope));
    }); },
    check(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.check(identity, input))); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.cancel(identity, input))); },
    history(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ImagePlanningHistorySchema.parse({ identity, scope: input, ...await repo.history(identity, input) })); },
    apply(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningApplyInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ImagePlanningApplyReceiptSchema.parse(await repo.apply(identity, input))); },
    applyCheck(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ImagePlanningApplyReceiptSchema.parse(await repo.applyCheck(identity, input)
      ?? { identity, scope: input, status: "not_found", requestHash: null, afterSourceHash: null, resultHash: null, reasonCode: "OPERATION_NOT_OBSERVED" })); },
    applyCancel(ctx: TrpcContext, raw: unknown) { const input = ImagePlanningApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ImagePlanningApplyReceiptSchema.parse(await repo.applyCancel(identity, input))); },
  };
}
export const imagePlanningService = createImagePlanningService();
