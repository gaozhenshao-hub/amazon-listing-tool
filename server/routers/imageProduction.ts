import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import { getProjectById } from "../repositories";
import { productionStageSchema } from "../../shared/imageProduction";
import {
  productionStatus,
  saveProductionReferences,
  openProductionStep,
  adoptProductionImage,
} from "../domains/listing/imageProduction";
const base = z.object({
  projectId: z.number().int().positive(),
  imageId: z.string().uuid(),
});
async function scope(ctx: any, projectId: number) {
  if (
    !ctx.workspaceId ||
    !(await getProjectById(projectId, ctx.user.id, ctx.workspaceId))
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  return {
    projectId,
    workspaceId: ctx.workspaceId as number,
    userId: ctx.user.id as number,
    role: ctx.user.role as string,
  };
}
export const imageProductionRouter = router({
  get: workspaceScopedProcedure("project")
    .input(base)
    .query(async ({ ctx, input }) =>
      productionStatus(await scope(ctx, input.projectId), input.imageId)
    ),
  saveReferences: workspaceScopedProcedure("project", "update")
    .input(
      base.extend({
        revision: z.number().int().nonnegative(),
        kind: z.enum(["productAssets", "compositionAssets"]),
        assets: z.array(z.string().uuid()).max(14),
      })
    )
    .mutation(async ({ ctx, input }) =>
      saveProductionReferences(await scope(ctx, input.projectId), input)
    ),
  open: workspaceScopedProcedure("project", "update")
    .input(base.extend({ stage: productionStageSchema }))
    .mutation(async ({ ctx, input }) =>
      openProductionStep(
        await scope(ctx, input.projectId),
        input.imageId,
        input.stage
      )
    ),
  adopt: workspaceScopedProcedure("project", "update")
    .input(
      base.extend({
        stage: productionStageSchema,
        conversationId: z.string().uuid(),
        generationId: z.string().uuid(),
        assetId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      adoptProductionImage(await scope(ctx, input.projectId), input)
    ),
});
