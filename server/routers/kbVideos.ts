import { z } from "zod";
import { router } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import {
  VIDEO_TYPES,
  VIDEO_CONTENT_TAGS,
  VideoLabelsSchema,
  validateVideoLabels,
} from "../../shared/videoLabels";
import {
  listLibraryVideos,
  videoBrowseFacets,
  getLibraryVideo,
  requireVideo,
  saveVideoLabels,
} from "../domains/knowledge/videoLibrary";
import { enqueueVideoTags } from "../domains/knowledge/videoTagging";
const target = z.object({ id: z.number().int().positive() });
const scope = (ctx: TrpcContext) => ({
  workspaceId: ctx.workspaceId!,
  userId: ctx.user!.id,
  role: ctx.user!.role,
});
export const kbVideosRouter = router({
  facets: workspaceScopedProcedure("knowledge").input(z.object({scope:z.enum(["mine","shared","all"]),query:z.string().max(200).optional(),filters:z.record(z.string().max(64),z.string().max(100)),groupBy:z.string().max(32)}))
    .query(({ctx,input})=>videoBrowseFacets(scope(ctx),input)),
  list: workspaceScopedProcedure("knowledge")
    .input(
      z.object({
        scope: z.enum(["mine", "shared", "all"]).default("shared"),
        page: z.number().int().min(1).max(10000).default(1),
        query: z.string().max(200).optional(),
        imageSetId: z.number().int().positive().optional(),
        role: z.enum(["main", "aplus"]).optional(),
        type: z.enum(VIDEO_TYPES).optional(),
        content: z.enum(VIDEO_CONTENT_TAGS).optional(),
        category: z.string().max(64).optional(),
        style: z.string().max(64).optional(),
        primaryColor: z.string().max(30).optional(),
        accentColor: z.string().max(30).optional(),
        groupBy:z.enum(["none","type","category","style","primaryColor","accentColor","role"]).optional(),
      })
    )
    .query(({ ctx, input }) => listLibraryVideos(scope(ctx), input)),
  get: workspaceScopedProcedure("knowledge")
    .input(target)
    .query(({ ctx, input }) => getLibraryVideo(scope(ctx), input.id)),
  save: workspaceScopedProcedure("knowledge")
    .input(
      target.extend({
        revision: z.number().int().min(0),
        labels: VideoLabelsSchema,
        role: z.enum(["main", "aplus"]).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await requireVideo(scope(ctx), input.id, true);
      return saveVideoLabels(
        scope(ctx),
        input.id,
        input.revision,
        validateVideoLabels(input.labels, row.duration || 0),
        input.role
      );
    }),
  runTags: workspaceScopedProcedure("knowledge")
    .input(
      target.extend({
        revision: z.number().int().min(0),
        feedback: z.string().trim().min(2).max(4000).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      enqueueVideoTags(scope(ctx), input.id, input.revision, input.feedback)
    ),
});
