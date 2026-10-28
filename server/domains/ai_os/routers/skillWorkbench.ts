import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  protectedProcedure,
  adminProcedure,
  router,
} from "../../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";
import type { TrpcContext } from "../../../_core/context";
import {
  SkillDraftContentSchema,
  SkillWorkbenchInputSchema,
} from "../../../../shared/skillWorkbench";
import { skillWorkbench } from "../services/skillWorkbench";

const scope = z.object({ expectedWorkspaceId: z.number().int().positive() });
const target = scope.extend({ slug: z.string().min(1).max(191) });
const revision = scope.extend({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
});
async function actor(
  ctx: TrpcContext,
  expected: number,
  action: "read" | "run" | "update"
) {
  const workspaceId = workspaceIdFromContext(ctx);
  if (!workspaceId || workspaceId !== expected)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "工作区已变更，请重新进入",
    });
  await assertResourceAction(
    {
      actor: actorFromContext(ctx),
      resource: "emperor_skill",
      action,
      workspaceId,
    },
    ctx
  );
  return {
    workspaceId,
    userId: ctx.user!.id,
    admin: ["admin", "super_admin"].includes(ctx.user!.role),
    superAdmin: ctx.user!.role === "super_admin",
  };
}
export const skillWorkbenchRouter = router({
  catalog: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) =>
      skillWorkbench.catalog(
        await actor(ctx, input.expectedWorkspaceId, "read")
      )
    ),
  newSkill: adminProcedure
    .input(
      scope.extend({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500),
        category: z.string().min(1).max(50),
        systemPrompt: z.string().trim().min(1).max(50000),
      })
    )
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.newSkill(
        await actor(ctx, input.expectedWorkspaceId, "update"),
        input
      )
    ),
  products: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) =>
      skillWorkbench.products(
        await actor(ctx, input.expectedWorkspaceId, "read")
      )
    ),
  detail: protectedProcedure
    .input(target)
    .query(async ({ ctx, input }) =>
      skillWorkbench.detail(
        await actor(ctx, input.expectedWorkspaceId, "read"),
        input.slug
      )
    ),
  create: protectedProcedure
    .input(target.extend({ snapshotId: z.string().max(80).optional() }))
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.create(
        await actor(ctx, input.expectedWorkspaceId, "run"),
        input.slug,
        input.snapshotId
      )
    ),
  save: protectedProcedure
    .input(
      revision.extend({
        content: SkillDraftContentSchema,
        input: SkillWorkbenchInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.save(
        await actor(ctx, input.expectedWorkspaceId, "run"),
        input.id,
        input.revision,
        input.content,
        input.input
      )
    ),
  run: protectedProcedure
    .input(
      revision.extend({
        baseline: z.boolean().default(false),
        feedback: z.string().trim().min(2).max(8000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.run(
        await actor(ctx, input.expectedWorkspaceId, "run"),
        input.id,
        input.revision,
        input.baseline,
        input.feedback
      )
    ),
  approve: protectedProcedure
    .input(
      revision.extend({ testId: z.string().uuid(), approved: z.boolean() })
    )
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.approve(
        await actor(ctx, input.expectedWorkspaceId, "run"),
        input.id,
        input.revision,
        input.testId,
        input.approved
      )
    ),
  publish: adminProcedure
    .input(revision)
    .mutation(async ({ ctx, input }) =>
      skillWorkbench.publish(
        await actor(ctx, input.expectedWorkspaceId, "update"),
        input.id,
        input.revision
      )
    ),
});
