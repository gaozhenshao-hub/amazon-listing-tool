import { z } from "zod";
import { adminProcedure, router } from "../../../_core/trpc";
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
});

// ─────────────────────────────────────────────────────────────────────────────
