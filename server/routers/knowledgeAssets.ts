import { getSetTags, saveSetTags, SetTagsSchema } from "../domains/knowledge/setTags";
import { z } from "zod";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import type { TrpcContext } from "../_core/context";
import {
  deleteAsset,
  listRecycled,
  restoreAsset,
  purgeRecycled,
} from "../domains/knowledge/assetLifecycle";
import {
  startAdjustment,
  getAdjustment,
  sendAdjustment,
  discardAdjustment,
  confirmAdjustment,
  retagImage,
} from "../domains/knowledge/adjustmentChat";
import { loadAsset, isLibraryAdmin } from "../domains/knowledge/assetTargets";
import { refreshCollection } from "../domains/knowledge/refreshCollection";
const scope = (ctx: TrpcContext) => ({
  workspaceId: ctx.workspaceId!,
  userId: ctx.user!.id,
  role: ctx.user!.role,
});
const asset = z.object({
  kind: z.enum(["set", "image", "video"]),
  id: z.number().int().positive(),
});
const draft = z.object({ id: z.string().uuid() });
const version = draft.extend({ revision: z.number().int().min(0) });
const procedure = workspaceScopedProcedure("knowledge");
export const knowledgeAssetsRouter = router({
  setTags: procedure.input(z.object({id:z.number().int().positive()})).query(({ctx,input})=>getSetTags(scope(ctx),input.id)),
  saveSetTags: procedure.input(z.object({id:z.number().int().positive(),version:z.string().length(64),tags:SetTagsSchema})).mutation(({ctx,input})=>saveSetTags(scope(ctx),input.id,input.version,input.tags)),
  access: procedure.input(asset).query(async ({ ctx, input }) => {
    const target = await loadAsset(scope(ctx), input.kind, input.id);
    return {
      canDelete: isLibraryAdmin(scope(ctx)),
      canTag: target.unit?.primary.imagePosition !== "brand_story",
      count: target.unit?.images.length || 1,
      kind: input.kind,
      canEdit:
        target.ownerId === ctx.user.id ||
        (isLibraryAdmin(scope(ctx)) && target.visibility !== "private"),
    };
  }),
  startAdjustment: procedure
    .input(asset)
    .mutation(({ ctx, input }) =>
      startAdjustment(scope(ctx), input.kind, input.id)
    ),
  adjustment: procedure
    .input(draft)
    .query(({ ctx, input }) => getAdjustment(scope(ctx), input.id)),
  sendAdjustment: procedure
    .input(version.extend({ text: z.string().trim().min(1).max(4000) }))
    .mutation(({ ctx, input }) =>
      sendAdjustment(scope(ctx), input.id, input.revision, input.text)
    ),
  discardAdjustment: procedure
    .input(draft)
    .mutation(({ ctx, input }) => discardAdjustment(scope(ctx), input.id)),
  confirmAdjustment: procedure
    .input(version.extend({ improve: z.boolean() }))
    .mutation(({ ctx, input }) =>
      confirmAdjustment(scope(ctx), input.id, input.revision, input.improve)
    ),
  retagImage: procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => retagImage(scope(ctx), input.id)),
  delete: procedure
    .input(
      z.object({
        kind: z.enum(["set", "image", "video"]),
        id: z.number().int().positive(),
        permanent: z.boolean().default(false),
      })
    )
    .mutation(({ ctx, input }) =>
      deleteAsset(scope(ctx), input.kind, input.id, input.permanent)
    ),
  recycle: procedure
    .input(z.object({ page: z.number().int().min(1).max(10000).default(1) }))
    .query(({ ctx, input }) => listRecycled(scope(ctx), input.page)),
  restore: procedure
    .input(draft)
    .mutation(({ ctx, input }) => restoreAsset(scope(ctx), input.id)),
  purge: procedure
    .input(draft)
    .mutation(({ ctx, input }) => purgeRecycled(scope(ctx), input.id)),
  refreshCollection: procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => refreshCollection(scope(ctx), input.id)),
});
