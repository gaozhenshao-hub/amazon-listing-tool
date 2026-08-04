import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { rawExecute } from "../routerContext";

export const emperorScheduledRouter = router({
  list: protectedProcedure.query(async () => {
    return rawExecute("SELECT * FROM emperor_scheduled_tasks ORDER BY name");
  }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      skillSlug: z.string(),
      cronExpr: z.string().optional(),
      inputTemplate: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      await rawExecute(
        `INSERT INTO emperor_scheduled_tasks (slug,name,description,skillSlug,cronExpr,inputTemplate,isActive,createdByUserId) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),skillSlug=VALUES(skillSlug),cronExpr=VALUES(cronExpr),inputTemplate=VALUES(inputTemplate),isActive=VALUES(isActive)`,
        [input.slug, input.name, input.description||null, input.skillSlug, input.cronExpr||null, input.inputTemplate ? JSON.stringify(input.inputTemplate) : null, input.isActive?1:0, ctx.user.id]
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_scheduled_tasks WHERE slug = ?", [input.slug]);
      return { success: true };
    }),

  trigger: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_scheduled_tasks WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      await rawExecute("UPDATE emperor_scheduled_tasks SET lastRunAt = NOW(), runCount = runCount + 1 WHERE slug = ?", [input.slug]);
      return { success: true, message: `Task '${rows[0].name}' triggered` };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Gateway Router
// ─────────────────────────────────────────────────────────────────────────────
