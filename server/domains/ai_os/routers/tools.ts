import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { invokeEmperorTool, listEmperorToolRuns, listEmperorTools, seedBuiltinTools, upsertEmperorTool, upsertEmperorToolSecret } from "../services/toolGateway";
import { rawExecute } from "../routerContext";

export const emperorToolsRouter = router({
  list: protectedProcedure.query(async () => {
    return listEmperorTools();
  }),

  listRuns: protectedProcedure
    .input(z.object({
      toolSlug: z.string().optional(),
      agentRunId: z.string().optional(),
      nodeId: z.string().optional(),
      status: z.enum(["running", "succeeded", "failed", "blocked"]).optional(),
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return listEmperorToolRuns({
        userId: ctx.user.id,
        isAdmin,
        toolSlug: input?.toolSlug,
        agentRunId: input?.agentRunId,
        nodeId: input?.nodeId,
        status: input?.status,
        limit: input?.limit,
      });
    }),

  seedBuiltins: adminProcedure.mutation(async () => {
    return seedBuiltinTools();
  }),

  invoke: protectedProcedure
    .input(z.object({
      toolSlug: z.string(),
      params: z.any().optional(),
      runId: z.string().optional(),
      nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return invokeEmperorTool({
        toolSlug: input.toolSlug,
        params: input.params,
        userId: ctx.user.id,
        userRole: (ctx.user as any).role || null,
        runId: input.runId,
        nodeId: input.nodeId,
      });
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["mcp", "api", "internal", "code"]),
      config: z.any().optional(),
      governancePolicy: z.any().optional(),
      permissionPolicy: z.any().optional(),
      rateLimitPolicy: z.any().optional(),
      circuitBreakerPolicy: z.any().optional(),
      secretRefs: z.any().optional(),
      outputPolicy: z.any().optional(),
      inputSchema: z.any().optional(),
      outputSchema: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input }) => {
      return upsertEmperorTool(input);
    }),

  upsertSecret: adminProcedure
    .input(z.object({
      slug: z.string().min(1).max(128),
      value: z.string().min(1),
      description: z.string().optional(),
      metadata: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return upsertEmperorToolSecret({
        slug: input.slug,
        value: input.value,
        description: input.description || null,
        metadata: input.metadata,
        userId: ctx.user.id,
      });
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_tools WHERE slug=?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics Router
// ─────────────────────────────────────────────────────────────────────────────
