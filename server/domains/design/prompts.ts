import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { designPromptInput } from "../../../shared/designPrompts";
import { defaultDesignParams } from "../../../shared/designStudio";
import { protectedProcedure, router } from "../../_core/trpc";
import { authorizeDesign } from "./access";
import {
  execute,
  jsonValue,
  ownAsset,
  ownConversation,
  transaction,
} from "./repository";

const missing = () => {
  throw new TRPCError({ code: "NOT_FOUND", message: "提示词不存在或无法访问" });
};
const canManage = (user: any, row: any) =>
  user.id === row.userId || ["admin", "super_admin"].includes(user.role);
export const designPromptRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().max(200).default(""),
        category: z.string().max(40).default("全部"),
        offset: z.number().int().min(0).max(100000).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "read", "design_prompts");
      const search = input.search.trim().replace(/[!%_]/g, v => "!" + v);
      const rows: any[] = await execute(
        "SELECT p.*,u.name AS authorName FROM design_prompt_library p LEFT JOIN users u ON u.id=p.userId WHERE p.workspaceId=? AND p.deletedAt IS NULL AND (?='全部' OR p.category=?) AND (?='' OR p.title LIKE ? ESCAPE '!' OR p.prompt LIKE ? ESCAPE '!') ORDER BY p.updatedAt DESC,p.id DESC LIMIT 31 OFFSET ?",
        [
          s.workspaceId,
          input.category,
          input.category,
          search,
          `%${search}%`,
          `%${search}%`,
          input.offset,
        ]
      );
      return {
        items: rows
          .slice(0, 30)
          .map(r => ({
            id: String(r.id),
            title: String(r.title),
            category: String(r.category),
            prompt: String(r.prompt),
            notes: String(r.notes),
            params: { ...defaultDesignParams, ...jsonValue(r.params, {}) },
            authorName: r.authorName || "团队成员",
            revision: Number(r.revision),
            hasExample: !!r.exampleAssetId,
            canManage: canManage(ctx.user, r),
          })),
        hasMore: rows.length > 30,
      };
    }),
  save: protectedProcedure
    .input(
      designPromptInput.extend({
        sourceGenerationId: z.string().uuid().optional(),
        revision: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit", "design_prompts");
      return transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        const row = (
          await execute(
            "SELECT * FROM design_prompt_library WHERE id=? AND workspaceId=? FOR UPDATE",
            [input.id, s.workspaceId],
            tx
          )
        )[0];
        if (row) {
          if (row.deletedAt || !canManage(ctx.user, row)) missing();
          if (!input.revision || Number(row.revision) !== input.revision)
            throw new TRPCError({
              code: "CONFLICT",
              message: "这条提示词已更新，请刷新后再编辑",
            });
          await execute(
            "UPDATE design_prompt_library SET title=?,category=?,prompt=?,notes=?,params=?,revision=revision+1,updatedAt=NOW(3) WHERE id=? AND workspaceId=?",
            [
              input.title,
              input.category,
              input.prompt,
              input.notes,
              JSON.stringify(input.params),
              input.id,
              s.workspaceId,
            ],
            tx
          );
          return { id: input.id };
        }
        if (input.revision) missing();
        let example: string | null = null;
        if (input.sourceGenerationId) {
          const g = (
            await execute(
              "SELECT * FROM design_generations WHERE id=? AND workspaceId=? AND userId=? AND status='succeeded' AND deletedAt IS NULL",
              [input.sourceGenerationId, s.workspaceId, s.userId],
              tx
            )
          )[0];
          if (!g || !(await ownConversation(g.conversationId, s, tx)))
            missing();
          const existing = (
            await execute(
              "SELECT id FROM design_prompt_library WHERE workspaceId=? AND userId=? AND sourceGenerationId=? AND deletedAt IS NULL",
              [s.workspaceId, s.userId, input.sourceGenerationId],
              tx
            )
          )[0];
          if (existing)
            throw new TRPCError({
              code: "CONFLICT",
              message: "这张作品已保存到提示词库",
            });
          example = jsonValue<string[]>(g.assetIds, [])[0] || null;
          if (example && !(await ownAsset(example, s))) missing();
          // A removed entry can be saved again without exposing old private history.
          await execute(
            "UPDATE design_prompt_library SET sourceGenerationId=NULL WHERE workspaceId=? AND userId=? AND sourceGenerationId=? AND deletedAt IS NOT NULL",
            [s.workspaceId, s.userId, input.sourceGenerationId],
            tx
          );
        }
        await execute(
          "INSERT INTO design_prompt_library(id,workspaceId,userId,title,category,prompt,notes,params,sourceGenerationId,exampleAssetId) VALUES(?,?,?,?,?,?,?,?,?,?)",
          [
            input.id,
            s.workspaceId,
            s.userId,
            input.title,
            input.category,
            input.prompt,
            input.notes,
            JSON.stringify(input.params),
            input.sourceGenerationId || null,
            example,
          ],
          tx
        );
        return { id: input.id };
      });
    }),
  remove: protectedProcedure
    .input(
      z.object({ id: z.string().uuid(), revision: z.number().int().positive() })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "delete", "design_prompts");
      return transaction(async tx => {
        const row = (
          await execute(
            "SELECT * FROM design_prompt_library WHERE id=? AND workspaceId=? AND deletedAt IS NULL FOR UPDATE",
            [input.id, s.workspaceId],
            tx
          )
        )[0];
        if (!row || !canManage(ctx.user, row)) missing();
        if (Number(row.revision) !== input.revision)
          throw new TRPCError({
            code: "CONFLICT",
            message: "这条提示词已更新，请刷新后再操作",
          });
        await execute(
          "UPDATE design_prompt_library SET deletedAt=NOW(3),revision=revision+1 WHERE id=? AND workspaceId=?",
          [input.id, s.workspaceId],
          tx
        );
        return { ok: true };
      });
    }),
});
