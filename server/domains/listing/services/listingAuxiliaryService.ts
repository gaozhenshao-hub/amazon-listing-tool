import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { ListingAuxiliaryPreviewInputSchema, ListingAuxiliaryPreviewResultSchema, ListingAuxiliaryStartInputSchema, ListingAuxiliaryOperationInputSchema,
  ListingAuxiliaryViewSchema, ListingAuxiliaryApplyInputSchema, ListingAuxiliaryApplyOperationInputSchema, ListingAuxiliaryApplyReceiptSchema,
  ListingAuxiliaryHistoryInputSchema, ListingAuxiliaryHistoryResultSchema, listingAuxiliaryPreviewRequest, type ListingAuxiliaryIdentity, type ListingAuxiliaryOperationInput } from "../../../../shared/listingAuxiliaryWorkflow";
import { loadSavedConfiguration } from "../../ai_os/services/assistantConversations";
import { ListingAuxiliaryConfigurationSchema } from "./listingAuxiliaryRuntimeContract";
import { listingAuxiliaryRuntime } from "./listingAuxiliaryRuntime";
import { listingAuxiliaryRepository, listingAuxiliaryCandidate, listingAuxiliaryOperationScope, type ListingAuxiliaryPrepare } from "./listingAuxiliaryRepository";
import { ListingAuxiliaryError, listingAuxiliaryFail as fail, type ListingAuxiliaryExecutor, type ListingAuxiliarySource } from "./listingAuxiliarySource";
export const listingAuxiliaryWorkerEnabled = () => process.env.ENABLE_LISTING_AUXILIARY_WRITES === "true" && process.env.ENABLE_LISTING_AUXILIARY_WORKER === "true";
export async function loadListingAuxiliaryConfiguration(executor: ListingAuxiliaryExecutor, identity: ListingAuxiliaryIdentity) {
  const configuration = await loadSavedConfiguration({ executor, identity }, "listing");
  if (!configuration) fail("CONFIGURATION_UNAVAILABLE"); return ListingAuxiliaryConfigurationSchema.parse(configuration);
}
export function listingAuxiliaryReason(error: unknown) {
  if (error instanceof ListingAuxiliaryError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "LISTING_AUXILIARY_INPUT_INVALID" });
  const reason = listingAuxiliaryReason(error), code = /^[A-Z][A-Z0-9_]{0,159}$/u.test(reason) ? reason : "UNAVAILABLE";
  throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED", message: `LISTING_AUXILIARY_${code}` });
}
export function createListingAuxiliaryService(deps: Partial<{ repository: typeof listingAuxiliaryRepository; runtime: typeof listingAuxiliaryRuntime;
  loadConfiguration: typeof loadListingAuxiliaryConfiguration; enabled: () => boolean }> = {}) {
  const repo = deps.repository ?? listingAuxiliaryRepository, runtime = deps.runtime ?? listingAuxiliaryRuntime, configuration = deps.loadConfiguration ?? loadListingAuxiliaryConfiguration,
    enabled = deps.enabled ?? listingAuxiliaryWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: ListingAuxiliaryIdentity) => Promise<T>) {
    try { if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) fail("ACCESS_DENIED");
      return await body({ userId: ctx.user.id, workspaceId }); } catch (error) { return safe(error); }
  }
  const prepare: ListingAuxiliaryPrepare = async (executor, source) => {
    if (!enabled()) fail("EXECUTION_DISABLED"); const saved = await configuration(executor, source.identity);
    const prepared = await runtime.prepare({ executor, source, configuration: saved }); return { configuration: saved, ...prepared };
  };
  async function view(identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput, result: Awaited<ReturnType<typeof repo.check>>) {
    const run = result.run; let current: ListingAuxiliarySource | null = null;
    if (run) try { current = await repo.readSource(identity, run.source.request); } catch (error) { if (listingAuxiliaryReason(error) === "ACCESS_DENIED") throw error; }
    return ListingAuxiliaryViewSchema.parse({ identity, scope, state: run?.state ?? (result.receipt?.status === "cancelled" ? "canceled" : "not_found"), runId: run?.runId ?? null,
      request: run ? listingAuxiliaryPreviewRequest(run.request) : null, draftHash: run?.source.draftHash ?? null, sourceHash: run?.sourceHash ?? null, resultHash: run?.resultHash ?? null, candidate: run ? listingAuxiliaryCandidate(run) : null,
      sourceCurrent: !!run && current?.sourceHash === run.sourceHash,
      completedTargets: run?.steps.filter(step => step.returned?.candidate && !step.returned.issues.length).length ?? 0,
      errorCode: run?.errorCode ?? null });
  }
  return {
    preview(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryPreviewInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      const source = await repo.readSource(identity, input); let prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
      try { prepared = await repo.preview(identity, input, prepare); } catch (error) { if (listingAuxiliaryReason(error) === "ACCESS_DENIED") throw error; reasonCode = listingAuxiliaryReason(error); }
      const runtime = prepared?.runtimeSnapshot;
      return ListingAuxiliaryPreviewResultSchema.parse({ identity, request: input, available: !!prepared, reasonCode,
        sourceHash: prepared?.source.sourceHash ?? source.sourceHash, draftHash: prepared?.source.draftHash ?? source.draftHash,
        runtimeHash: runtime?.snapshotHash ?? null, configuration: prepared ? { revision: prepared.configuration.revision, hash: prepared.configuration.hash } : null,
        maxCalls: runtime?.maxCalls ?? 1, maxCostCents: runtime?.maxCostCents ?? null, executionPolicy: "frozen_routes_known_response_repair_unknown_never_retry",
        limitations: source.limitations,
        stages: runtime?.entries.map(entry => ({ operation: entry.approval.operation, targetCount: runtime.targetCount, skillSlug: entry.skill.slug, skillVersion: entry.skill.version,
          skillHash: entry.approval.skillSnapshotHash, models: entry.approval.modelRoutes, maxQualityRepairs: entry.approval.maxQualityRepairs })) ?? [] });
    }); },
    start(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryStartInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      await repo.reserve(identity, input, prepare); const scope = listingAuxiliaryOperationScope(input); return view(identity, scope, await repo.check(identity, scope)); }); },
    check(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.check(identity, input))); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.cancel(identity, input))); },
    apply(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryApplyInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingAuxiliaryApplyReceiptSchema.parse(await repo.apply(identity, input))); },
    applyCheck(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingAuxiliaryApplyReceiptSchema.parse(await repo.applyCheck(identity, input)
      ?? { identity, scope: input, status: "not_found", requestHash: null, resultHash: null, draftHash: null, reportArtifactId: null, candidateIds: [], reasonCode: "OPERATION_NOT_OBSERVED" })); },
    applyCancel(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingAuxiliaryApplyReceiptSchema.parse(await repo.applyCancel(identity, input))); },
    history(ctx: TrpcContext, raw: unknown) { const input = ListingAuxiliaryHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingAuxiliaryHistoryResultSchema.parse({ identity, scope: input, ...await repo.history(identity, input) })); },
  };
}
export const listingAuxiliaryService = createListingAuxiliaryService();
