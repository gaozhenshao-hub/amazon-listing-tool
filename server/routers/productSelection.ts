import { z } from "zod";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import {
  PICK_FILE_BYTES,
  pickAsin,
  pickDetailsSchema,
  pickReview,
  pickStatus,
  pickTagsSchema,
} from "../../shared/productSelection";
import {
  acceptSelectionTags,
  changeSelection,
  createSelection,
  generateSelectionNames,
  generateSelectionTags,
  getSelection,
  listSelections,
  pickTagChanges,
  previewSelectionPatent,
  transitionSelection,
  uploadSelectionPatent,
} from "../domains/development/productSelection";
import { parsePickImport } from "../domains/development/productSelectionImport";
import { refreshSelectionFx } from "../domains/development/productSelectionFx";
import { TRPCError } from "@trpc/server";

const read = workspaceScopedProcedure("product_development");
const write = workspaceScopedProcedure("product_development", "update");
const id = z.string().uuid();
const ref = z.object({ id, revision: z.number().int().positive() });
const file = z.object({
  name: z.string().trim().min(1).max(180),
  base64: z.string().max(Math.ceil(PICK_FILE_BYTES / 3) * 4),
});
const guidance = z.string().trim().max(2000);
const scope = (ctx: {
  workspaceId?: number | null;
  user: { id: number; role: string };
}) => ({
  workspaceId: ctx.workspaceId!,
  userId: ctx.user.id,
  role: ctx.user.role,
});

export const productSelectionRouter = router({
  list: read
    .input(
      z.object({
        status: z.enum(pickStatus),
        page: z.number().int().min(1).max(10000),
        query: z.string().trim().max(200),
      })
    )
    .query(({ ctx, input }) =>
      listSelections(scope(ctx), input.status, input.page, input.query)
    ),
  get: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => getSelection(scope(ctx), input.id)),
  exchange: read.query(() => refreshSelectionFx()),
  create: workspaceScopedProcedure("product_development", "create")
    .input(z.object({ bookmarkId: id }))
    .mutation(({ ctx, input }) =>
      createSelection(scope(ctx), input.bookmarkId)
    ),
  details: write
    .input(ref.extend({ details: pickDetailsSchema }))
    .mutation(({ ctx, input }) =>
      changeSelection(scope(ctx), input, data => {
        Object.assign(data, input.details);
      })
    ),
  importExcel: workspaceScopedProcedure("product_development", "import")
    .input(ref.extend({ kind: z.enum(["snapshot", "history"]), file }))
    .mutation(async ({ ctx, input }) => {
      const imported = await parsePickImport(
        input.file,
        input.kind,
        new Date().toISOString().slice(0, 10)
      );
      return changeSelection(
        scope(ctx),
        input,
        data => {
          if (imported.kind === "snapshot") {
            data.imported.snapshot = imported.source;
            data.imported.rows = imported.rows;
          } else {
            data.imported.history = imported.source;
            data.imported.historyRows = [...imported.rows];
          }
        },
        true
      );
    }),
  tagSettings: write
    .input(ref.extend({ tags: pickTagsSchema }))
    .mutation(({ ctx, input }) =>
      changeSelection(scope(ctx), input, data => {
        data.tags = input.tags;
        const available = new Set(data.tags.map(tag => tag.id));
        for (const asin of Object.keys(data.rowTags))
          data.rowTags[asin] = data.rowTags[asin].filter(tag =>
            available.has(tag)
          );
      })
    ),
  editTags: write
    .input(
      ref.extend({
        asin: pickAsin,
        tags: z.array(id).max(60),
        allowAuto: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      changeSelection(scope(ctx), input, data => {
        if (!data.imported.rows.some(row => row.asin === input.asin))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到该竞品变体",
          });
        const available = new Set(data.tags.map(tag => tag.id));
        if (input.tags.some(tag => !available.has(tag)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "标签已变化，请刷新",
          });
        data.rowTags[input.asin] = [...new Set(input.tags)];
        data.manualTagAsins = data.manualTagAsins.filter(
          asin => asin !== input.asin
        );
        if (!input.allowAuto) data.manualTagAsins.push(input.asin);
      })
    ),
  editSales: write
    .input(
      ref.extend({
        asin: pickAsin,
        sales: z.number().int().min(0).max(100000000).nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      changeSelection(scope(ctx), input, data => {
        if (!data.imported.rows.some(row => row.asin === input.asin))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到该竞品变体",
          });
        if (input.sales === null) delete data.manualSales[input.asin];
        else data.manualSales[input.asin] = input.sales;
      })
    ),
  generateNames: workspaceScopedProcedure("product_development", "run")
    .input(ref.extend({ guidance }))
    .mutation(({ ctx, input }) =>
      generateSelectionNames(scope(ctx), input, input.guidance)
    ),
  generateTags: workspaceScopedProcedure("product_development", "run")
    .input(
      ref.extend({
        asins: z.array(pickAsin).max(35),
        guidance,
        previous: pickTagChanges.max(35),
      })
    )
    .mutation(({ ctx, input }) =>
      generateSelectionTags(
        scope(ctx),
        input,
        input.asins,
        input.guidance,
        input.previous
      )
    ),
  acceptTags: write
    .input(
      ref.extend({
        changes: pickTagChanges,
        improve: z.object({ guidance, before: pickTagChanges }).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      acceptSelectionTags(scope(ctx), input, input.changes, input.improve)
    ),
  submit: write
    .input(ref)
    .mutation(({ ctx, input }) =>
      transitionSelection(scope(ctx), input, "submit", "")
    ),
  review: write
    .input(
      ref.extend({
        action: z.enum(pickReview),
        notes: z.string().trim().max(4000),
      })
    )
    .mutation(({ ctx, input }) =>
      transitionSelection(scope(ctx), input, input.action, input.notes)
    ),
  uploadPatent: workspaceScopedProcedure("product_development", "upload")
    .input(ref.extend({ file }))
    .mutation(({ ctx, input }) =>
      uploadSelectionPatent(scope(ctx), input, input.file)
    ),
  previewPatent: read
    .input(z.object({ id, reportId: id }))
    .query(({ ctx, input }) =>
      previewSelectionPatent(scope(ctx), input.id, input.reportId)
    ),
});
