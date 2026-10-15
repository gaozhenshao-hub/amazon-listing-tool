import { TRPCError } from "@trpc/server";
import { AGENT_LIBRARY_KEYS } from "../../../../shared/agentLibraryContracts";
import { AssistantScopePreconditionSchema, AssistantKeyInputSchema, AssistantSaveInputSchema, AssistantRollbackInputSchema, AssistantHistoryInputSchema, AssistantVersionInputSchema } from "../../../../shared/assistantConfigurations";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import type { TrpcContext } from "../../../_core/context";
import { actorFromContext, assertResourceAction, workspaceIdFromContext } from "../../../services/securityGovernance";
import { assistantConfigurationService } from "../services/assistantConfigurations";

async function authorize(ctx: TrpcContext, action: "read" | "update", expectedWorkspaceId: number, agentKey?: string) {
  // Scope comes only from the authenticated context; no request/global fallback.
  const workspaceId = workspaceIdFromContext(ctx);
  if (typeof workspaceId !== "number" || !Number.isSafeInteger(workspaceId) || workspaceId <= 0 || workspaceId > 2_147_483_647) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_WORKSPACE_REQUIRED" });
  }
  // This is a stale-request precondition, never an input-selected target scope.
  if (expectedWorkspaceId !== workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_WORKSPACE_CHANGED" });
  await assertResourceAction({ actor: actorFromContext(ctx), resource: "agent", action, workspaceId, resourceId: agentKey }, ctx);
  return workspaceId;
}

export const assistantConfigurationsRouter = router({
  listMetadata: protectedProcedure.input(AssistantScopePreconditionSchema).query(async ({ ctx, input }) => {
    const workspaceId = await authorize(ctx, "read", input.expectedWorkspaceId);
    // A complete directory cannot disguise a per-key denial as "not configured".
    // Finish every required permission check before the configuration repository.
    for (const agentKey of AGENT_LIBRARY_KEYS) await authorize(ctx, "read", input.expectedWorkspaceId, agentKey);
    return assistantConfigurationService.listMetadata(workspaceId);
  }),
  get: adminProcedure.input(AssistantKeyInputSchema).query(async ({ ctx, input }) => assistantConfigurationService.get(await authorize(ctx, "update", input.expectedWorkspaceId, input.agentKey), input.agentKey)),
  options: adminProcedure.input(AssistantScopePreconditionSchema).query(async ({ ctx, input }) => assistantConfigurationService.options(await authorize(ctx, "update", input.expectedWorkspaceId))),
  history: adminProcedure.input(AssistantHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      const { expectedWorkspaceId, ...request } = input;
      return assistantConfigurationService.history(await authorize(ctx, "update", expectedWorkspaceId, input.agentKey), request);
    }),
  getVersion: adminProcedure.input(AssistantVersionInputSchema)
    .query(async ({ ctx, input }) => assistantConfigurationService.getVersion(await authorize(ctx, "update", input.expectedWorkspaceId, input.agentKey), input.agentKey, input.revision)),
  save: adminProcedure.input(AssistantSaveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { expectedWorkspaceId, ...request } = input;
      return assistantConfigurationService.save(await authorize(ctx, "update", expectedWorkspaceId, input.agentKey), ctx.user.id, request);
    }),
  rollback: adminProcedure.input(AssistantRollbackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { expectedWorkspaceId, ...request } = input;
      return assistantConfigurationService.rollback(await authorize(ctx, "update", expectedWorkspaceId, input.agentKey), ctx.user.id, request);
    }),
});
