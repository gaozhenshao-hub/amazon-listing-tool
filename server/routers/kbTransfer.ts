import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { kbTransferStages, securityAuditLogs, users } from "../../drizzle/schema";
import { getDb } from "../repositories/dbClient";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import { recordSecurityAuditLog } from "../services/securityGovernance";
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

export function buildProductKnowledgeTransferExportAuditMetadata(filters: z.infer<typeof filtersSchema>, result?: { itemCount: number; attachmentCount: number; bytes: number }) {
  return {
    filter: {
      modules: filters.modules,
      dateField: filters.dateField,
      startAt: filters.startAt?.toISOString() ?? null,
      endAt: filters.endAt?.toISOString() ?? null,
      tags: filters.tags ?? [],
    },
    itemCount: result?.itemCount ?? null,
    attachmentCount: result?.attachmentCount ?? null,
    archiveBytes: result?.bytes ?? null,
  };
}

export function readProductKnowledgeTransferExportAuditMetadata(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const filter = source.filter && typeof source.filter === "object" && !Array.isArray(source.filter)
    ? source.filter as Record<string, unknown>
    : {};
  return {
    filter: {
      modules: Array.isArray(filter.modules) ? filter.modules.filter((item): item is string => typeof item === "string").slice(0, 5) : [],
      dateField: filter.dateField === "created_at" ? "created_at" : "updated_at",
      startAt: typeof filter.startAt === "string" ? filter.startAt : null,
      endAt: typeof filter.endAt === "string" ? filter.endAt : null,
      tags: Array.isArray(filter.tags) ? filter.tags.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
    },
    itemCount: typeof source.itemCount === "number" ? source.itemCount : null,
    attachmentCount: typeof source.attachmentCount === "number" ? source.attachmentCount : null,
    archiveBytes: typeof source.archiveBytes === "number" ? source.archiveBytes : null,
  };
}

export const kbTransferRouter = router({
  previewExport: superAdminExportProcedure
    .input(filtersSchema)
    .query(({ ctx, input }) => previewProductKnowledgeTransfer(ctx.workspaceId!, input)),

  exportZip: superAdminExportProcedure
    .input(filtersSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await exportProductKnowledgeTransfer(ctx.user.id, ctx.workspaceId!, input);
        await recordSecurityAuditLog({
          ctx,
          workspaceId: ctx.workspaceId!,
          action: "knowledge.transfer.export",
          resourceType: "knowledge",
          resourceId: "product-knowledge-transfer",
          resourceName: "产品知识库完整ZIP包",
          status: "success",
          riskLevel: "medium",
          metadata: buildProductKnowledgeTransferExportAuditMetadata(input, result),
        });
        return result;
      } catch (error) {
        await recordSecurityAuditLog({
          ctx,
          workspaceId: ctx.workspaceId!,
          action: "knowledge.transfer.export",
          resourceType: "knowledge",
          resourceId: "product-knowledge-transfer",
          resourceName: "产品知识库完整ZIP包",
          status: "failed",
          riskLevel: "medium",
          reason: error instanceof Error ? error.message.slice(0, 512) : "导出失败",
          metadata: buildProductKnowledgeTransferExportAuditMetadata(input),
        });
        throw error;
      }
    }),

  exportLogs: superAdminExportProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      const rows = await db.select({
        id: securityAuditLogs.id,
        actorUserId: securityAuditLogs.actorUserId,
        operatorName: users.name,
        status: securityAuditLogs.status,
        reason: securityAuditLogs.reason,
        metadata: securityAuditLogs.metadata,
        createdAt: securityAuditLogs.createdAt,
      })
        .from(securityAuditLogs)
        .leftJoin(users, eq(securityAuditLogs.actorUserId, users.id))
        .where(and(
          eq(securityAuditLogs.workspaceId, ctx.workspaceId!),
          eq(securityAuditLogs.action, "knowledge.transfer.export"),
          eq(securityAuditLogs.resourceId, "product-knowledge-transfer"),
        ))
        .orderBy(desc(securityAuditLogs.createdAt))
        .limit(input?.limit ?? 100);
      return rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        operatorName: row.operatorName || "未知用户",
        status: row.status,
        reason: row.reason,
        metadata: readProductKnowledgeTransferExportAuditMetadata(row.metadata),
        createdAt: row.createdAt,
      }));
    }),

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
