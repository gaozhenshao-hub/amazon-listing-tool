import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { VideoWorkflowOptionsInputSchema, VideoWorkflowOptionsResultSchema, VideoWorkflowStartInputSchema, VideoWorkflowOperationInputSchema,
  VideoWorkflowApplyInputSchema, VideoWorkflowApplyOperationInputSchema, VideoWorkflowApplyReceiptSchema, VideoWorkflowViewSchema, parseVideoWorkflowCandidate,
  VideoWorkflowHistoryInputSchema, VideoWorkflowHistoryResultSchema,
  type VideoWorkflowIdentity, type VideoWorkflowOperationInput, type VideoWorkflowOperation, type VideoWorkflowSource } from "../../../shared/videoWorkflow";
import { loadSavedConfiguration } from "../ai_os/services/assistantConversations";
import { createVideoConfiguredRuntime, VIDEO_CONFIGURED_DEFINITIONS, VideoConfiguredRuntimeError, VideoConfiguredSavedConfigurationSchema } from "./videoConfiguredRuntime";
import { createVideoWorkflowRepository, type VideoWorkflowPrepare } from "./videoWorkflowRepository";
import { VideoWorkflowRepositoryError, type VideoWorkflowExecutor } from "./videoWorkflowSource";

export const videoWorkflowWorkerEnabled = () => process.env.ENABLE_VIDEO_WORKFLOW_WRITES === "true" && process.env.ENABLE_VIDEO_WORKFLOW_WORKER === "true";
export const videoWorkflowRepository = createVideoWorkflowRepository();
export const videoWorkflowRuntimes = Object.fromEntries(Object.entries(VIDEO_CONFIGURED_DEFINITIONS).map(([operation, definition]) => [operation,
  createVideoConfiguredRuntime({ definition, parseCandidate: value => parseVideoWorkflowCandidate(operation as VideoWorkflowOperation, value) })])) as Record<VideoWorkflowOperation, ReturnType<typeof createVideoConfiguredRuntime<Record<string, unknown>>>>;
export async function loadVideoWorkflowConfiguration(executor: VideoWorkflowExecutor, identity: VideoWorkflowIdentity) {
  const saved = await loadSavedConfiguration({ executor, identity }, "video");
  if (!saved) throw new VideoWorkflowRepositoryError("CONFIGURATION_UNAVAILABLE"); return VideoConfiguredSavedConfigurationSchema.parse(saved);
}
export function videoWorkflowReason(error: unknown): string {
  if (error instanceof VideoWorkflowRepositoryError || error instanceof VideoConfiguredRuntimeError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "VIDEO_WORKFLOW_INPUT_INVALID" });
  const code = videoWorkflowReason(error); throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED",
    message: `VIDEO_WORKFLOW_${/^[A-Z][A-Z0-9_]{0,159}$/u.test(code) ? code : "UNAVAILABLE"}` });
}
export function createVideoWorkflowService(deps: Partial<{ repository: typeof videoWorkflowRepository; runtimes: typeof videoWorkflowRuntimes;
  loadConfiguration: typeof loadVideoWorkflowConfiguration; enabled: () => boolean }> = {}) {
  const repo = deps.repository ?? videoWorkflowRepository, runtimes = deps.runtimes ?? videoWorkflowRuntimes, configuration = deps.loadConfiguration ?? loadVideoWorkflowConfiguration,
    enabled = deps.enabled ?? videoWorkflowWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: VideoWorkflowIdentity) => Promise<T>) {
    try { if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) throw new VideoWorkflowRepositoryError("ACCESS_DENIED");
      return await body({ userId: ctx.user.id, workspaceId }); } catch (error) { return safe(error); }
  }
  const preparation = (operationId: string): VideoWorkflowPrepare => async (executor, source) => {
    if (!enabled()) throw new VideoWorkflowRepositoryError("EXECUTION_DISABLED");
    const saved = await configuration(executor, source.identity), result = await runtimes[source.operation].prepare({ executor, identity: source.identity, operationId,
      configuration: saved, sourceHash: source.sourceHash, sourceContext: source.context });
    return { configuration: saved, runtimeSnapshot: result.runtimeSnapshot };
  };
  async function view(identity: VideoWorkflowIdentity, scope: VideoWorkflowOperationInput, result: Awaited<ReturnType<typeof repo.check>>) {
    const run = result.run; let current: VideoWorkflowSource | null = null;
    if (run) try { current = await repo.readSource(identity, run.request); } catch (error) { if (videoWorkflowReason(error) === "ACCESS_DENIED") throw error; }
    return VideoWorkflowViewSchema.parse({ identity, scope, state: run?.state ?? (result.receipt?.status === "cancelled" ? "canceled" : "not_found"), runId: run?.runId ?? null,
      operation: run?.request.operation ?? null, sourceHash: run?.sourceHash ?? null, resultHash: run?.resultHash ?? null, candidate: run?.candidate ?? null,
      sourceCurrent: run !== null && current?.sourceHash === run?.sourceHash, configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null, errorCode: run?.errorCode ?? null });
  }
  return {
    history(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity =>
      VideoWorkflowHistoryResultSchema.parse({ identity, scope: input, ...await repo.history(identity, input) })); },
    options(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowOptionsInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      const source = await repo.readSource(identity, input); let prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
      try { prepared = await repo.preview(identity, input, preparation(input.operationId)); } catch (error) { if (videoWorkflowReason(error) === "ACCESS_DENIED") throw error; reasonCode = videoWorkflowReason(error); }
      return VideoWorkflowOptionsResultSchema.parse({ identity, request: input, available: prepared !== null, reasonCode, sourceHash: prepared?.source.sourceHash ?? source.sourceHash,
        runtimeHash: prepared?.runtimeSnapshot.snapshotHash ?? null, configuration: prepared ? { revision: prepared.configuration.revision, hash: prepared.configuration.hash } : null,
        maxCalls: 1, maxCostCents: prepared?.runtimeSnapshot.budgetPlan.maxCostCentsTotal ?? null, mediaProcessing: "text_and_structured_references_only", legacyTasks: "original_legacy_protocol_no_configuration_overlay" });
    }); },
    start(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowStartInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      await repo.reserve(identity, input, preparation(input.operationId)); const scope = { expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, videoScriptId: input.videoScriptId, operationId: input.operationId };
      return view(identity, scope, await repo.check(identity, scope)); }); },
    check(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.check(identity, input))); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.cancel(identity, input))); },
    apply(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowApplyInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => VideoWorkflowApplyReceiptSchema.parse(await repo.apply(identity, input))); },
    applyCheck(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => VideoWorkflowApplyReceiptSchema.parse(await repo.applyCheck(identity, input)
      ?? { identity, scope: input, status: "not_found", requestHash: null, resultHash: null, afterHash: null, version: null, reasonCode: "OPERATION_NOT_OBSERVED" })); },
    applyCancel(ctx: TrpcContext, raw: unknown) { const input = VideoWorkflowApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => VideoWorkflowApplyReceiptSchema.parse(await repo.applyCancel(identity, input))); },
  };
}
export const videoWorkflowService = createVideoWorkflowService();
