import { z } from "zod";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import { researchBookmarkSchema } from "../../shared/researchLibrary";
import {
  collectResearch,
  listResearch,
  researchCollectors,
  updateResearch,
  type ResearchScope,
} from "../domains/development/researchLibrary";
import {
  approveResearchExtension,
  pairingInfo,
  revokeResearchExtension,
  researchExtensionSessions,
} from "../domains/development/researchExtension";
const scope = (ctx: {
  workspaceId?: number | null;
  user: { id: number; role: string };
}): ResearchScope => ({
  workspaceId: ctx.workspaceId!,
  userId: ctx.user.id,
  role: ctx.user.role,
});
export const researchLibraryRouter = router({
  list: workspaceScopedProcedure("product_development")
    .input(
      z.object({
        kind: z.enum(["product", "store"]),
        query: z.string().max(200).default(""),
        ownerId: z.number().int().positive().optional(),
        site: z.string().max(100).optional(),
        state: z
          .enum(["pending", "researching", "valuable", "archived"])
          .optional(),
        page: z.number().int().min(1).max(10000).default(1),
      })
    )
    .query(({ ctx, input }) => listResearch(scope(ctx), input)),
  collectors: workspaceScopedProcedure("product_development").query(({ ctx }) =>
    researchCollectors(scope(ctx))
  ),
  collect: workspaceScopedProcedure("product_development", "create")
    .input(researchBookmarkSchema)
    .mutation(({ ctx, input }) => collectResearch(scope(ctx), input)),
  update: workspaceScopedProcedure("product_development", "update")
    .input(
      z.object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
        note: z.string().max(4000),
        state: z.enum(["pending", "researching", "valuable", "archived"]),
      })
    )
    .mutation(({ ctx, input }) => updateResearch(scope(ctx), input)),
  pairing: workspaceScopedProcedure("product_development")
    .input(z.object({ code: z.string().regex(/^[A-F0-9]{10}$/) }))
    .query(({ ctx, input }) => pairingInfo(scope(ctx), input.code)),
  approveExtension: workspaceScopedProcedure("product_development", "create")
    .input(z.object({ code: z.string().regex(/^[A-F0-9]{10}$/) }))
    .mutation(({ ctx, input }) =>
      approveResearchExtension(scope(ctx), input.code)
    ),
  extensionSessions: workspaceScopedProcedure("product_development").query(
    ({ ctx }) => researchExtensionSessions(scope(ctx))
  ),
  revokeExtension: workspaceScopedProcedure("product_development", "update")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      revokeResearchExtension(scope(ctx), input.id)
    ),
});
