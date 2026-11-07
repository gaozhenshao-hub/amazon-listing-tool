import { DOCUMENT_REFERENCE_LOOKUP_LIMIT } from "../../shared/planningImageReference";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import { getProjectById } from "../repositories";
import { imageDocumentSchema } from "../../shared/imageDocument";
import { imageOutlineSchema } from "../../shared/imagePlanning";
import { saveDocumentWorkspace } from "../domains/listing/imageDocumentWorkspace";
import {
  compositionSketchStatus,
  checkCompositionSketch,
} from "../domains/listing/compositionSketches";
import {
  planningImageReferenceSchema,
  planningReferenceKey,
} from "../../shared/planningImageReference";
import {
  documentReferences,
  resolveDocumentMaterials,
  publicDocumentMaterials,
} from "../domains/listing/imageDocumentMaterials";
import {
  readImageDocument,
  saveImageDocument,
  lockImageDocument,
  synchronizeDocument,
} from "../domains/listing/imageDocumentStore";
import {
  readImagePlan,
  type PlanningScope,
} from "../domains/listing/imagePlanningStore";
import {
  imageDocumentStatus,
  startImageDocument,
  imageDocumentStartSchema,
  confirmImageDocument,
  dismissImageDocument,
} from "../domains/listing/imageDocument";
const project = z.object({ projectId: z.number().int().positive() }),
  revision = project.extend({ revision: z.number().int().nonnegative() });
async function scope(
  ctx: { workspaceId?: number | null; user: { id: number; role: string } },
  projectId: number
): Promise<PlanningScope> {
  if (
    !ctx.workspaceId ||
    !(await getProjectById(projectId, ctx.user.id, ctx.workspaceId))
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  return {
    projectId,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    role: ctx.user.role,
  };
}
export const imageDocumentRouter = router({
  sketches: workspaceScopedProcedure("project")
    .input(project)
    .query(async ({ ctx, input }) =>
      compositionSketchStatus(await scope(ctx, input.projectId))
    ),
  sketch: workspaceScopedProcedure("project", "update")
    .input(
      revision.extend({
        imageId: z.string().uuid(),
        retry: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await scope(ctx, input.projectId),
        current = await readImageDocument(actor),
        entry = current.data.entries.find(e => e.imageId === input.imageId);
      if (!entry)
        throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在" });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "构图参考已改为人工选图；需要制作结构图时，请使用下方四步制作中的“生成构图”。",
      });
    }),
  checkSketch: workspaceScopedProcedure("project", "update")
    .input(project.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      checkCompositionSketch(await scope(ctx, input.projectId), input.id)
    ),
  saveWorkspace: workspaceScopedProcedure("project", "update")
    .input(
      revision.extend({
        outlineRevision: z.number().int().nonnegative(),
        outline: imageOutlineSchema,
        data: imageDocumentSchema,
      })
    )
    .mutation(async ({ ctx, input }) =>
      saveDocumentWorkspace(await scope(ctx, input.projectId), input)
    ),
  get: workspaceScopedProcedure("project")
    .input(project)
    .query(async ({ ctx, input }) =>
      imageDocumentStatus(await scope(ctx, input.projectId))
    ),
  references: workspaceScopedProcedure("project")
    .input(
      project.extend({
        references: z.array(planningImageReferenceSchema).max(DOCUMENT_REFERENCE_LOOKUP_LIMIT),
      })
    )
    .query(async ({ ctx, input }) =>
      publicDocumentMaterials(
        await resolveDocumentMaterials(
          await scope(ctx, input.projectId),
          input.references
        )
      )
    ),
  save: workspaceScopedProcedure("project", "update")
    .input(revision.extend({ data: imageDocumentSchema }))
    .mutation(async ({ ctx, input }) => {
      const actor = await scope(ctx, input.projectId),
        current = await readImageDocument(actor),
        plan = await readImagePlan(actor),
        previous = documentReferences(current.data),
        old = new Set(previous.map(planningReferenceKey));
      // Previously chosen sources may become unavailable. Keep those choices and
      // explanations, but every newly introduced image must pass current access.
      await resolveDocumentMaterials(
        actor,
        documentReferences(input.data).filter(
          r => !old.has(planningReferenceKey(r))
        ),
        { strict: true, referenceSetIds: plan.data.referenceSets, previous }
      );
      return saveImageDocument(actor, input.revision, input.data);
    }),
  lock: workspaceScopedProcedure("project", "update")
    .input(revision.extend({ locked: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      lockImageDocument(
        await scope(ctx, input.projectId),
        input.revision,
        input.locked
      )
    ),
  sync: workspaceScopedProcedure("project", "update")
    .input(revision)
    .mutation(async ({ ctx, input }) => {
      const actor = await scope(ctx, input.projectId),
        current = await readImageDocument(actor),
        plan = await readImagePlan(actor);
      return saveImageDocument(
        actor,
        input.revision,
        synchronizeDocument(current.data, plan.data),
        undefined,
        { generated: true }
      );
    }),
  start: workspaceScopedProcedure("project", "update")
    .input(imageDocumentStartSchema)
    .mutation(async ({ ctx, input }) =>
      startImageDocument(await scope(ctx, input.projectId), input)
    ),
  confirm: workspaceScopedProcedure("project", "update")
    .input(
      project.extend({
        candidateId: z.string().uuid(),
        improve: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) =>
      confirmImageDocument(
        await scope(ctx, input.projectId),
        input.candidateId,
        input.improve
      )
    ),
  dismiss: workspaceScopedProcedure("project", "update")
    .input(project.extend({ candidateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      dismissImageDocument(await scope(ctx, input.projectId), input.candidateId)
    ),
});
