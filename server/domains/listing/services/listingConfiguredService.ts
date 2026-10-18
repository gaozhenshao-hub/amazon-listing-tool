import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { ListingConfiguredPreviewInputSchema, ListingConfiguredPreviewResultSchema, ListingConfiguredStartInputSchema, ListingConfiguredOperationInputSchema,
  ListingConfiguredViewSchema, ListingConfiguredApplyInputSchema, ListingConfiguredApplyOperationInputSchema, ListingConfiguredApplyReceiptSchema,
  ListingConfiguredHistoryInputSchema, ListingConfiguredHistoryResultSchema, type ListingConfiguredIdentity, type ListingConfiguredOperationInput } from "../../../../shared/listingConfiguredWorkflow";
import { loadSavedConfiguration } from "../../ai_os/services/assistantConversations";
import { ListingConfiguredConfigurationSchema } from "./listingConfiguredRuntimeContract";
import { listingConfiguredRuntime } from "./listingConfiguredRuntime";
import { listingConfiguredRepository, listingConfiguredCandidate, listingConfiguredOperationScope, type ListingConfiguredPrepare } from "./listingConfiguredRepository";
import { ListingConfiguredError, listingConfiguredFail as fail, type ListingConfiguredExecutor, type ListingConfiguredSource } from "./listingConfiguredSource";
export const listingConfiguredWorkerEnabled = () => process.env.ENABLE_LISTING_CONFIGURED_WRITES === "true" && process.env.ENABLE_LISTING_CONFIGURED_WORKER === "true";
export async function loadListingConfiguredConfiguration(executor: ListingConfiguredExecutor, identity: ListingConfiguredIdentity) {
  const configuration = await loadSavedConfiguration({ executor, identity }, "listing");
  if (!configuration) fail("CONFIGURATION_UNAVAILABLE"); return ListingConfiguredConfigurationSchema.parse(configuration);
}
export function listingConfiguredReason(error: unknown) {
  if (error instanceof ListingConfiguredError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "LISTING_CONFIGURED_INPUT_INVALID" });
  const reason = listingConfiguredReason(error), code = /^[A-Z][A-Z0-9_]{0,159}$/u.test(reason) ? reason : "UNAVAILABLE";
  throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED", message: `LISTING_CONFIGURED_${code}` });
}
export function createListingConfiguredService(deps: Partial<{ repository: typeof listingConfiguredRepository; runtime: typeof listingConfiguredRuntime;
  loadConfiguration: typeof loadListingConfiguredConfiguration; enabled: () => boolean }> = {}) {
  const repo = deps.repository ?? listingConfiguredRepository, runtime = deps.runtime ?? listingConfiguredRuntime, configuration = deps.loadConfiguration ?? loadListingConfiguredConfiguration,
    enabled = deps.enabled ?? listingConfiguredWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: ListingConfiguredIdentity) => Promise<T>) {
    try { if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) fail("ACCESS_DENIED");
      return await body({ userId: ctx.user.id, workspaceId }); } catch (error) { return safe(error); }
  }
  const prepare: ListingConfiguredPrepare = async (executor, source) => {
    if (!enabled()) fail("EXECUTION_DISABLED"); const saved = await configuration(executor, source.identity);
    const prepared = await runtime.prepare({ executor, source, configuration: saved }); return { configuration: saved, ...prepared };
  };
  async function view(identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput, result: Awaited<ReturnType<typeof repo.check>>) {
    const run = result.run; let current: ListingConfiguredSource | null = null;
    if (run) try { current = await repo.readSource(identity, run.source.request); } catch (error) { if (listingConfiguredReason(error) === "ACCESS_DENIED") throw error; }
    return ListingConfiguredViewSchema.parse({ identity, scope, state: run?.state ?? (result.receipt?.status === "cancelled" ? "canceled" : "not_found"), runId: run?.runId ?? null,
      operation: run?.request.operation ?? null, sourceHash: run?.sourceHash ?? null, resultHash: run?.resultHash ?? null, candidate: run ? listingConfiguredCandidate(run) : null,
      sourceCurrent: !!run && current?.sourceHash === run.sourceHash, currentDraftHash: current?.draftHash ?? null,
      completedStages: run?.steps.filter(step => step.returned?.candidate && !step.returned.issues.length).length ?? 0,
      configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null, errorCode: run?.errorCode ?? null });
  }
  return {
    preview(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredPreviewInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      const source = await repo.readSource(identity, input); let prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
      try { prepared = await repo.preview(identity, input, prepare); } catch (error) { if (listingConfiguredReason(error) === "ACCESS_DENIED") throw error; reasonCode = listingConfiguredReason(error); }
      const runtime = prepared?.runtimeSnapshot;
      return ListingConfiguredPreviewResultSchema.parse({ identity, request: input, available: !!prepared, reasonCode,
        sourceHash: prepared?.source.sourceHash ?? source.sourceHash, draftHash: prepared?.source.draftHash ?? source.draftHash,
        runtimeHash: runtime?.snapshotHash ?? null, configuration: prepared ? { revision: prepared.configuration.revision, hash: prepared.configuration.hash } : null,
        maxCalls: runtime?.maxCalls ?? 1, maxCostCents: runtime?.maxCostCents ?? null, executionPolicy: "frozen_routes_known_response_repair_unknown_never_retry",
        existingConfirmedCoreIds: source.cores.map(core => core.id), directionCandidatesAreNotConfirmedCores: true,
        stages: runtime?.entries.map(entry => ({ operation: entry.approval.operation, skillSlug: entry.skill.slug, skillVersion: entry.skill.version,
          skillHash: entry.approval.skillSnapshotHash, models: entry.approval.modelRoutes, maxQualityRepairs: entry.approval.maxQualityRepairs })) ?? [] });
    }); },
    start(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredStartInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      await repo.reserve(identity, input, prepare); const scope = listingConfiguredOperationScope(input); return view(identity, scope, await repo.check(identity, scope)); }); },
    check(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.check(identity, input))); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repo.cancel(identity, input))); },
    apply(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredApplyInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingConfiguredApplyReceiptSchema.parse(await repo.apply(identity, input))); },
    applyCheck(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingConfiguredApplyReceiptSchema.parse(await repo.applyCheck(identity, input)
      ?? { identity, scope: input, status: "not_found", requestHash: null, resultHash: null, afterHash: null, listingId: null, candidateIds: [], reasonCode: "OPERATION_NOT_OBSERVED" })); },
    applyCancel(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredApplyOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingConfiguredApplyReceiptSchema.parse(await repo.applyCancel(identity, input))); },
    history(ctx: TrpcContext, raw: unknown) { const input = ListingConfiguredHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ListingConfiguredHistoryResultSchema.parse({ identity, scope: input, ...await repo.history(identity, input) })); },
  };
}
export const listingConfiguredService = createListingConfiguredService();
