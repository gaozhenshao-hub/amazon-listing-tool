import { z } from "zod";
import { adminProcedure, router } from "../../../_core/trpc";
import { recordSecurityAuditLog, workspaceIdFromContext } from "../../../services/securityGovernance";
import { listDataLifecyclePolicies, runDataLifecycleSweep } from "../services/artifactLifecycle";
import {
  buildAiOsObservabilityDashboard,
  buildAiOsSloSummary,
  buildDatabaseObservabilitySection,
  buildWorkerQueueHealth,
  listAiOsEvaluations,
  listAiOsMetrics,
  recordDatabaseBaselineSnapshot,
  sampleDatabaseSlowQueries,
} from "../services/observability";
import { invalidateContextSource, listRunLedgerProjection } from "../services/contextProvenance";

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

  slo: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).optional().default(30),
      agentSlug: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return buildAiOsSloSummary({ days: input?.days, agentSlug: input?.agentSlug });
    }),

  workerHealth: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).optional().default(30),
    }).optional())
    .query(async ({ input }) => {
      return buildWorkerQueueHealth(input?.days || 30);
    }),

  databaseBaseline: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).optional().default(30),
    }).optional())
    .query(async ({ input }) => {
      return buildDatabaseObservabilitySection(input?.days || 30);
    }),

  recordDatabaseBaselineSnapshot: adminProcedure
    .mutation(async ({ ctx }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await recordDatabaseBaselineSnapshot({
        workspaceId,
        userId: ctx.user.id,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "database_baseline.snapshot",
        resourceType: "ai_os",
        status: "success",
        riskLevel: "medium",
        metadata: result,
      });
      return result;
    }),

  sampleSlowQueries: adminProcedure
    .input(z.object({
      minimumAverageMs: z.number().min(1).max(3_600_000).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await sampleDatabaseSlowQueries(input || {});
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "database_slow_query.sample",
        resourceType: "ai_os",
        status: result.available ? "success" : "failed",
        riskLevel: "medium",
        metadata: {
          available: result.available,
          sampleCount: result.sampleCount,
          reason: "reason" in result ? result.reason : null,
          options: result.options,
        },
      });
      return result;
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

  runProjection: adminProcedure
    .input(z.object({ traceId: z.string().min(1).max(80), afterId: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(300).optional() }))
    .query(async ({ input }) => listRunLedgerProjection(input)),

  invalidateContextSource: adminProcedure
    .input(z.object({ sourceType: z.enum(["attachment", "knowledge"]), sourceKey: z.string().min(1).max(160), reason: z.string().min(3).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await invalidateContextSource({ ...input, userId: ctx.user.id });
      await recordSecurityAuditLog({ ctx, workspaceId, action: "context_source.invalidate", resourceType: "ai_os", status: "success", riskLevel: "medium", metadata: { sourceType: input.sourceType, sourceKey: input.sourceKey, invalidated: result.invalidated } });
      return result;
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
