import { z } from "zod";
import { adminProcedure, router } from "../../../_core/trpc";
import { recordSecurityAuditLog, workspaceIdFromContext } from "../../../services/securityGovernance";
import { listDataLifecyclePolicies, runDataLifecycleSweep } from "../services/artifactLifecycle";
import { buildAiOsObservabilityDashboard, listAiOsEvaluations, listAiOsMetrics } from "../services/observability";

export const emperorObservabilityRouter = router({
  metrics: adminProcedure
    .input(z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      metricName: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return listAiOsMetrics(input || {});
    }),

  evaluations: adminProcedure
    .input(z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      agentSlug: z.string().optional(),
      skillSlug: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return listAiOsEvaluations(input || {});
    }),

  dashboard: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).optional().default(30),
      agentSlug: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return buildAiOsObservabilityDashboard({
        days: input?.days,
        agentSlug: input?.agentSlug,
      });
    }),

  lifecyclePolicies: adminProcedure.query(async () => {
    return listDataLifecyclePolicies();
  }),

  runLifecycleSweep: adminProcedure
    .input(z.object({
      policySlug: z.string().optional(),
      mode: z.enum(["count", "archive", "delete"]).optional().default("archive"),
      dryRun: z.boolean().optional().default(true),
      batchSize: z.number().int().min(1).max(5000).optional().default(1000),
      allWorkspaces: z.boolean().optional().default(false),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const workspaceId = input?.allWorkspaces ? undefined : workspaceIdFromContext(ctx);
      const result = await runDataLifecycleSweep({
        policySlug: input?.policySlug,
        mode: input?.mode,
        dryRun: input?.dryRun ?? true,
        batchSize: input?.batchSize,
        workspaceId,
        userId: ctx.user.id,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId: workspaceId ?? null,
        action: "data_lifecycle.sweep",
        resourceType: "ai_os",
        status: "success",
        riskLevel: input?.dryRun === false ? "high" : "medium",
        metadata: {
          policySlug: input?.policySlug || "all",
          mode: input?.mode || "archive",
          dryRun: input?.dryRun ?? true,
          result,
        },
      });
      return result;
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
