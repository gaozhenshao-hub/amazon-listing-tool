import { briefingStatus,startBriefing,clearBriefing,improveBriefing } from "../domains/listing/imageBriefing";
import { productPhotos,uploadProductPhoto,reorderProductPhotos,photoUploadSchema } from "../domains/listing/productPhotos";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import { getProjectById } from "../repositories";
import { imageOutlineVersions, useImageOutlineVersion } from "../domains/listing/imageOutlineVersions";
import { imageOutlineSchema } from "../../shared/imagePlanning";
import {
  imagePlanningStatus,
  startImagePlanning,
  confirmImagePlanning,
  dismissImagePlanning,
  imagePlanningStartSchema,
} from "../domains/listing/imagePlanning";
import {
  saveImagePlan,
  type PlanningScope,
} from "../domains/listing/imagePlanningStore";
import {
  imagePlanningSources,
  validateOutlineLinks,
} from "../domains/listing/imagePlanningSources";
import { loadAsset } from "../domains/knowledge/assetTargets";
import { competitorReferenceImages } from "../domains/listing/planningReferenceLibrary";
const projectInput = z.object({ projectId: z.number().int().positive() });
async function scope(
  ctx: { user: { id: number; role: string }; workspaceId?: number | null },
  projectId: number
): Promise<PlanningScope> {
  if (!ctx.workspaceId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前工作区不可用",
    });
  const project = await getProjectById(projectId, ctx.user.id, ctx.workspaceId);
  if (!project || project.workspaceId !== ctx.workspaceId)
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  return {
    projectId,
    userId: ctx.user.id,
    workspaceId: ctx.workspaceId,
    role: ctx.user.role,
  };
}
export const imagePlanningRouter = router({
  competitorImages:workspaceScopedProcedure("project").input(projectInput).query(async({ctx,input})=>competitorReferenceImages(await scope(ctx,input.projectId))),
  improveBriefing:workspaceScopedProcedure("project","update").input(projectInput.extend({feedback:z.string().trim().min(2).max(4000)})).mutation(async({ctx,input})=>improveBriefing(await scope(ctx,input.projectId),input.feedback)),
  briefing:workspaceScopedProcedure("project").input(projectInput).query(async({ctx,input})=>briefingStatus(await scope(ctx,input.projectId))),
  sendBriefing:workspaceScopedProcedure("project","update").input(projectInput.extend({message:z.string().max(4000).default(""),opener:z.boolean().default(false)})).mutation(async({ctx,input})=>startBriefing(await scope(ctx,input.projectId),input.message,input.opener)),
  clearBriefing:workspaceScopedProcedure("project","update").input(projectInput).mutation(async({ctx,input})=>clearBriefing(await scope(ctx,input.projectId))),
  productPhotos:workspaceScopedProcedure("project").input(projectInput).query(async({ctx,input})=>productPhotos(await scope(ctx,input.projectId))),
  uploadProductPhoto:workspaceScopedProcedure("project","update").input(photoUploadSchema).mutation(async({ctx,input})=>uploadProductPhoto(await scope(ctx,input.projectId),input)),
  reorderProductPhotos:workspaceScopedProcedure("project","update").input(projectInput.extend({ids:z.array(z.string().uuid()).max(30),expectedIds:z.array(z.string().uuid()).max(30)})).mutation(async({ctx,input})=>reorderProductPhotos(await scope(ctx,input.projectId),input.ids,input.expectedIds)),
  get: workspaceScopedProcedure("project")
    .input(projectInput)
    .query(async ({ ctx, input }) =>
      imagePlanningStatus(await scope(ctx, input.projectId))
    ),
  versions: workspaceScopedProcedure("project")
    .input(projectInput)
    .query(async ({ ctx, input }) => imageOutlineVersions(await scope(ctx, input.projectId))),
  useVersion: workspaceScopedProcedure("project", "update")
    .input(projectInput.extend({ versionId: z.string().uuid(), revision: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => useImageOutlineVersion(await scope(ctx, input.projectId), input.versionId, input.revision)),
  save: workspaceScopedProcedure("project")
    .input(
      projectInput.extend({
        revision: z.number().int().nonnegative(),
        data: imageOutlineSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await scope(ctx, input.projectId),
        sources = await imagePlanningSources(actor);
      const assets = await Promise.all(
        input.data.referenceSets.map(id => loadAsset(actor, "set", id))
      );
      if (assets.some(a => a.set?.status !== "confirmed"))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "参考套图尚未采集完成，请完成入库后选择",
        });
      for (const item of input.data.groups.flatMap(g => g.items))
        for (const ref of item.references) {
          const asset = assets.find(a => a.id === ref.setId);
          if (!asset?.images.some(i => i.id === ref.imageId))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "参考图片已删除或不属于选中的套图",
            });
        }
      return saveImagePlan(actor, input.revision, input.data, undefined, {
        validateOutline: data => validateOutlineLinks(data, sources.upstream),
      });
    }),
  // Planning and accepting a draft use the same project-edit permission as the
  // existing Listing workspace, without granting project.run/confirm globally.
  generate: workspaceScopedProcedure("project", "update")
    .input(imagePlanningStartSchema)
    .mutation(async ({ ctx, input }) =>
      startImagePlanning(await scope(ctx, input.projectId), input)
    ),
  confirm: workspaceScopedProcedure("project", "update")
    .input(
      projectInput.extend({
        candidateId: z.string().uuid(),
        improve: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      confirmImagePlanning(
        await scope(ctx, input.projectId),
        input.candidateId,
        input.improve
      )
    ),
  dismiss: workspaceScopedProcedure("project")
    .input(projectInput.extend({ candidateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      dismissImagePlanning(await scope(ctx, input.projectId), input.candidateId)
    ),
});
