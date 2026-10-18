import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { DevelopmentMarketOperationSchema, DevelopmentMarketStartSchema, DevelopmentMarketApplyOperationSchema, DevelopmentMarketApplySchema,
  DevelopmentMarketPreviewSchema, DevelopmentMarketViewSchema, DevelopmentMarketApplyReceiptSchema,
  type DevelopmentMarketIdentity, type DevelopmentMarketOperation, type DevelopmentMarketApplyOperation } from "../../../../shared/developmentMarket";
import { ConfiguredBusinessSavedConfigurationSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { ConfiguredBusinessRuntimeError } from "../../ai_os/services/configuredBusinessRuntime";
import { loadSavedConfiguration } from "../../ai_os/services/assistantConversations";
import { createDevelopmentMarketRepository, type DevelopmentMarketPrepare, type DevelopmentMarketReceipt } from "./developmentMarketRepository";
import { DevelopmentMarketError, type DevelopmentMarketExecutor } from "./developmentMarketCore";
import { developmentMarketSourceContext } from "./developmentMarketSource";
import { developmentMarketRuntime } from "./developmentMarketRuntime";

export const developmentMarketEnabled = () => process.env.ENABLE_DEVELOPMENT_MARKET_WRITES === "true" && process.env.ENABLE_DEVELOPMENT_MARKET_WORKER === "true";
export const developmentMarketRepository = createDevelopmentMarketRepository();
export async function loadDevelopmentMarketConfiguration(executor: DevelopmentMarketExecutor, identity: DevelopmentMarketIdentity) {
  const saved = await loadSavedConfiguration({ executor, identity }, "development");
  if (!saved) throw new DevelopmentMarketError("CONFIGURATION_UNAVAILABLE");
  return ConfiguredBusinessSavedConfigurationSchema.parse(saved);
}
export function developmentMarketReason(error: unknown): string {
  if (error instanceof DevelopmentMarketError || error instanceof ConfiguredBusinessRuntimeError) return error.code;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return "ACCESS_DENIED";
  return "UNAVAILABLE";
}
function safe(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "DEVELOPMENT_MARKET_INPUT_INVALID" });
  const code = developmentMarketReason(error);
  throw new TRPCError({ code: code === "ACCESS_DENIED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(code) ? "CONFLICT" : "PRECONDITION_FAILED",
    message: `DEVELOPMENT_MARKET_${/^[A-Z][A-Z0-9_]{0,159}$/u.test(code) ? code : "UNAVAILABLE"}` });
}
/** HTTP prepares and journals only. It never calls a model and never marks a
 * generated interpretation as human-confirmed. Existing stage confirmation is
 * deliberately left to the original analysis page. */
export function createDevelopmentMarketService(dependencies: Partial<{ repository: typeof developmentMarketRepository;
  runtime: Pick<typeof developmentMarketRuntime, "prepare">; loadConfiguration: typeof loadDevelopmentMarketConfiguration; enabled: () => boolean }> = {}) {
  const repository = dependencies.repository ?? developmentMarketRepository, runtime = dependencies.runtime ?? developmentMarketRuntime,
    configuration = dependencies.loadConfiguration ?? loadDevelopmentMarketConfiguration, enabled = dependencies.enabled ?? developmentMarketEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: DevelopmentMarketIdentity) => Promise<T>): Promise<T> {
    try {
      if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) throw new DevelopmentMarketError("ACCESS_DENIED");
      return await body({ workspaceId, userId: ctx.user.id });
    } catch (error) { return safe(error); }
  }
  function prepare(input: DevelopmentMarketOperation): DevelopmentMarketPrepare { return async (tx, source) => {
    if (!enabled()) throw new DevelopmentMarketError("EXECUTION_DISABLED");
    const saved = await configuration(tx, source.identity), value = await runtime.prepare({ executor: tx, identity: source.identity,
      operationId: input.operationId, configuration: saved, source, sourceHash: source.sourceHash, sourceContext: developmentMarketSourceContext(source) });
    return { configuration: saved, runtimeSnapshot: value.runtimeSnapshot };
  }; }
  async function view(identity: DevelopmentMarketIdentity, input: DevelopmentMarketOperation, state: Awaited<ReturnType<typeof repository.check>>) {
    const run = state.run; let current = null;
    if (run) try { current = await repository.readSource(identity, input); } catch (error) { if (developmentMarketReason(error) === "ACCESS_DENIED") throw error; }
    return DevelopmentMarketViewSchema.parse({ identity, scope: input, runId: run?.runId ?? null,
      state: run?.state ?? (state.receipt?.status === "canceled" ? "canceled" : "not_found"), sourceHash: run?.sourceHash ?? null,
      currentSourceHash: current?.sourceHash ?? null, sourceChanged: run ? !current || current.sourceHash !== run.sourceHash : false,
      runtimeHash: run?.runtimeSnapshot.snapshotHash ?? null, configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null,
      resultHash: run?.resultHash ?? null, result: run?.result ?? null, reasonCode: run?.reasonCode ?? null, appliedOperationId: run?.appliedOperationId ?? null });
  }
  function receipt(identity: DevelopmentMarketIdentity, input: DevelopmentMarketApplyOperation, saved: DevelopmentMarketReceipt | null) {
    return DevelopmentMarketApplyReceiptSchema.parse({ identity, scope: input, status: saved?.status ?? "not_found", requestHash: saved?.requestHash ?? null,
      resultHash: saved?.resultHash ?? null, stageId: saved?.stageId ?? null, stageRevision: saved?.stageRevision ?? null, reasonCode: null });
  }
  return {
    preview(ctx: TrpcContext, raw: unknown) {
      const input = DevelopmentMarketOperationSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, async identity => {
        let source = await repository.readSource(identity, input), plan: Awaited<ReturnType<typeof repository.preview>> | null = null, reasonCode: string | null = null;
        try { plan = await repository.preview(identity, input, prepare(input)); source = plan.source; }
        catch (error) { reasonCode = developmentMarketReason(error); source = await repository.readSource(identity, input); }
        return DevelopmentMarketPreviewSchema.parse({ identity, scope: input, sourceHash: source.sourceHash, title: source.project.name,
          productCount: source.products.length, panoramaVersion: source.panorama.version, asOf: source.asOf, stats: source.stats,
          configuration: plan ? { revision: plan.configuration.revision, hash: plan.configuration.hash } : null, runtimeHash: plan?.runtimeSnapshot.snapshotHash ?? null,
          skillSlug: plan?.runtimeSnapshot.skill.slug ?? null, modelSlug: plan?.runtimeSnapshot.model.model.slug ?? null,
          maxCostCents: plan?.runtimeSnapshot.budgetPlan.maxCostCentsTotal ?? null, available: plan !== null, reasonCode });
      });
    },
    start(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketStartSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      const operation = { expectedWorkspaceId: input.expectedWorkspaceId, devProjectId: input.devProjectId, operationId: input.operationId };
      await repository.reserve(identity, input, prepare(input)); return view(identity, operation, await repository.check(identity, operation));
    }); },
    check(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketOperationSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repository.check(identity, input))); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketOperationSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => view(identity, input, await repository.cancel(identity, input))); },
    apply(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketApplySchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, { expectedWorkspaceId: input.expectedWorkspaceId, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: input.runOperationId }, await repository.apply(identity, input))); },
    applyCheck(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketApplyOperationSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, input, await repository.applyCheck(identity, input))); },
    applyCancel(ctx: TrpcContext, raw: unknown) { const input = DevelopmentMarketApplyOperationSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => receipt(identity, input, await repository.applyCancel(identity, input))); },
  };
}
export const developmentMarketService = createDevelopmentMarketService();
