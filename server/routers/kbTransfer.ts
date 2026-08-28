import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { kbTransferStages } from "../../drizzle/schema";
import { getDb } from "../repositories/dbClient";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import {
  confirmProductKnowledgeTransfer,
  exportProductKnowledgeTransfer,
  previewProductKnowledgeTransfer,
} from "../domains/knowledge/productKnowledgeTransferService";
import { assertProductKnowledgeTransferExportAuthority } from "../domains/knowledge/productKnowledgeTransferAuthorization";

const protectedProcedure = workspaceScopedProcedure("knowledge");
const superAdminExportProcedure = protectedProcedure.use(({ ctx, next }) => {
  assertProductKnowledgeTransferExportAuthority(ctx.user.role);
  return next({ ctx });
});
const moduleSchema = z.enum(["products", "listings", "images", "skills", "videos"]);
const filtersSchema = z.object({
  modules: z.array(moduleSchema).min(1).max(5),
  dateField: z.enum(["created_at", "updated_at"]).default("updated_at"),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
}).superRefine((value, context) => {
  if (value.startAt && value.endAt && value.startAt > value.endAt) {
    context.addIssue({ code: "custom", message: "开始时间不能晚于结束时间", path: ["endAt"] });
  }
});

export const kbTransferRouter = router({
  previewExport: superAdminExportProcedure
    .input(filtersSchema)
    .query(({ ctx, input }) => previewProductKnowledgeTransfer(ctx.workspaceId!, input)),

  exportZip: superAdminExportProcedure
    .input(filtersSchema)
    .mutation(({ ctx, input }) => exportProductKnowledgeTransfer(ctx.user.id, ctx.workspaceId!, input)),

  getStage: protectedProcedure
    .input(z.object({ stageId: z.string().regex(/^kbtx_[a-f0-9]{32}$/) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      const rows = await db.select({
        status: kbTransferStages.status,
        expiresAt: kbTransferStages.expiresAt,
        previewJson: kbTransferStages.previewJson,
        importResultJson: kbTransferStages.importResultJson,
      }).from(kbTransferStages).where(and(
        eq(kbTransferStages.id, input.stageId),
        eq(kbTransferStages.userId, ctx.user.id),
        eq(kbTransferStages.workspaceId, ctx.workspaceId!),
      )).limit(1);
      const stage = rows[0];
      if (!stage) throw new Error("导入预览不存在或无权限");
      return {
        status: stage.status,
        expiresAt: stage.expiresAt,
        preview: JSON.parse(stage.previewJson),
        importResult: stage.importResultJson ? JSON.parse(stage.importResultJson) : null,
      };
    }),

  confirmImport: protectedProcedure
    .input(z.object({
      stageId: z.string().regex(/^kbtx_[a-f0-9]{32}$/),
      conflictPolicy: z.enum(["skip_conflicts", "create_version"]).default("skip_conflicts"),
    }))
    .mutation(({ ctx, input }) => confirmProductKnowledgeTransfer(ctx.user.id, ctx.workspaceId!, input.stageId, input.conflictPolicy)),
});
