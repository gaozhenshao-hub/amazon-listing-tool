import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { KnowledgeQaPreviewInputSchema, KnowledgeQaStartInputSchema, KnowledgeQaOperationInputSchema, KnowledgeQaPageInputSchema, KnowledgeQaHistoryInputSchema,
  KnowledgeQaRenameInputSchema, KnowledgeQaDeleteInputSchema, KnowledgeQaClearInputSchema, KnowledgeQaFeedbackInputSchema,
  KnowledgeQaPreviewSchema, KnowledgeQaViewSchema, KnowledgeQaThreadsSchema, KnowledgeQaHistorySchema, KnowledgeQaCancelSchema,
  knowledgeQaOperation, type KnowledgeQaIdentity, type KnowledgeQaOperationInput } from "../../../shared/knowledgeQa";
import { loadSavedConfiguration } from "../ai_os/services/assistantConversations";
import { createKnowledgeQaRepository, type KnowledgeQaRun, type KnowledgeQaPrepare } from "./knowledgeQaRepository";
import { KnowledgeQaConfigurationSchema } from "./knowledgeQaRuntimeContract";
import { knowledgeQaRuntime } from "./knowledgeQaRuntime";
import { KnowledgeQaError, type KnowledgeQaExecutor } from "./knowledgeQaStorePrimitives";
export const knowledgeQaWorkerEnabled = () => process.env.ENABLE_KNOWLEDGE_QA_WRITES === "true" && process.env.ENABLE_KNOWLEDGE_QA_WORKER === "true";
export const knowledgeQaRepository = createKnowledgeQaRepository();
export async function loadKnowledgeQaConfiguration(executor: KnowledgeQaExecutor, identity: KnowledgeQaIdentity) {
  const saved = await loadSavedConfiguration({ executor, identity }, "knowledge"); if (!saved) throw new KnowledgeQaError("CONFIGURATION_UNAVAILABLE"); return KnowledgeQaConfigurationSchema.parse(saved);
}
export function knowledgeQaReason(error: unknown): string { return error instanceof KnowledgeQaError ? error.code : error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code) ? "ACCESS_DENIED" : "UNAVAILABLE"; }
export function knowledgeQaView(identity: KnowledgeQaIdentity, input: KnowledgeQaOperationInput, run: KnowledgeQaRun | null, canceled = false) {
  return KnowledgeQaViewSchema.parse({ identity, scope: knowledgeQaOperation(input), state: run?.state ?? (canceled ? "canceled" : "not_found"), stage: run?.checkpoints.at(-1)?.stageKey ?? null,
    sourceHash: run?.sourceHash ?? null, runtimeHash: run?.runtimeSnapshot.snapshotHash ?? null, resultHash: run?.resultHash ?? null, question: run?.request.question ?? null, answer: run?.answer ?? null,
    configuration: run ? { revision: run.configuration.revision, hash: run.configuration.hash } : null, reasonCode: run?.errorCode ?? (canceled ? "OPERATION_CANCELED" : run ? null : "OPERATION_NOT_OBSERVED"), createdAt: run?.createdAt ?? null, sourceChanged: !!run?.currentSourceHash && run.currentSourceHash !== run.sourceHash });
}
export function createKnowledgeQaService(deps: Partial<{ repository: typeof knowledgeQaRepository; runtime: Pick<typeof knowledgeQaRuntime, "prepare">; loadConfiguration: typeof loadKnowledgeQaConfiguration; enabled: () => boolean }> = {}) {
  const repo = deps.repository ?? knowledgeQaRepository, runtime = deps.runtime ?? knowledgeQaRuntime, config = deps.loadConfiguration ?? loadKnowledgeQaConfiguration, enabled = deps.enabled ?? knowledgeQaWorkerEnabled;
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, body: (identity: KnowledgeQaIdentity) => Promise<T>): Promise<T> {
    try { if (!ctx.user || workspaceId !== (ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId)) throw new KnowledgeQaError("ACCESS_DENIED"); return await body({ userId: ctx.user.id, workspaceId }); }
    catch (error) { if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "KNOWLEDGE_QA_INPUT_INVALID" }); const reason = knowledgeQaReason(error);
      throw new TRPCError({ code: reason === "ACCESS_DENIED" || reason === "SOURCE_ACCESS_CHANGED" ? "FORBIDDEN" : /CHANGED|CONFLICT|EXISTS/u.test(reason) ? "CONFLICT" : "PRECONDITION_FAILED", message: `KNOWLEDGE_QA_${reason}` }); }
  }
  const prepare = (operationId: string): KnowledgeQaPrepare => async (executor, source) => { if (!enabled()) throw new KnowledgeQaError("EXECUTION_DISABLED"); const configuration = await config(executor, source.identity);
    return { configuration, ...await runtime.prepare({ executor, source, operationId, configuration }) }; };
  return {
    preview(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaPreviewInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => {
      let source = await repo.source(identity, input), prepared: Awaited<ReturnType<typeof repo.preview>> | null = null, reasonCode: string | null = null;
      try { prepared = await repo.preview(identity, input, prepare(input.operationId)); source = prepared.source; } catch (error) { reasonCode = knowledgeQaReason(error); source = await repo.source(identity, input); }
      return KnowledgeQaPreviewSchema.parse({ identity, scope: input, sourceHash: source.sourceHash, runtimeHash: prepared?.runtimeSnapshot.snapshotHash ?? null,
        matchedCount: source.items.length, types: source.types, historyIncluded: source.history.length, historyAvailable: source.coverage.historyAvailable,
        configuration: prepared ? { revision: prepared.configuration.revision, hash: prepared.configuration.hash } : null,
        budget: prepared ? { ...prepared.runtimeSnapshot.budgetPlan, currency: "USD" } : null, capability: { available: prepared !== null, reasonCode } });
    }); },
    start(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaStartInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => { const run = await repo.reserve(identity, input, prepare(input.operationId)); return knowledgeQaView(identity, input, run); }); },
    check(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => { const value = await repo.check(identity, input); return knowledgeQaView(identity, input, value.run, value.canceled); }); },
    cancel(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaOperationInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => { const value = await repo.cancel(identity, input); return KnowledgeQaCancelSchema.parse({ identity, scope: input, state: value.run?.state ?? (value.canceled ? "canceled" : "not_found"), reasonCode: value.run?.errorCode ?? (value.canceled ? "OPERATION_CANCELED" : null) }); }); },
    threads(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaPageInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => KnowledgeQaThreadsSchema.parse({ identity, request: input, ...await repo.threads(identity, input) })); },
    history(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaHistoryInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => { const result = await repo.history(identity, input); return KnowledgeQaHistorySchema.parse({ identity, request: input, thread: result.thread,
      items: result.runs.map(run => knowledgeQaView(identity, run.request, run)), nextBeforeId: result.nextBeforeId }); }); },
    rename(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaRenameInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ({ identity, scope: { expectedWorkspaceId: input.expectedWorkspaceId, threadId: input.threadId }, thread: await repo.rename(identity, input) })); },
    delete(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaDeleteInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ({ identity, scope: input, ...await repo.delete(identity, input) })); },
    clear(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaClearInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ({ identity, ...await repo.clear(identity, input) })); },
    feedback(ctx: TrpcContext, raw: unknown) { const input = KnowledgeQaFeedbackInputSchema.parse(raw); return invoke(ctx, input.expectedWorkspaceId, async identity => ({ identity, scope: knowledgeQaOperation(input), ...await repo.feedback(identity, input) })); },
  };
}
export const knowledgeQaService = createKnowledgeQaService();
