import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  buildWorkspaceScopeFilter,
  recordSecurityAuditLog,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";
import { rawExecute } from "../routerContext";
import {
  createExternalKnowledgeCallerToken,
  EXTERNAL_KNOWLEDGE_CALLER_KIND,
  EXTERNAL_KNOWLEDGE_SCOPES,
  hashExternalKnowledgeCallerToken,
  parseExternalKnowledgeCallerConfig,
  type ExternalKnowledgeScope,
} from "../services/externalKnowledgeCaller";

const scopeSchema = z.array(z.enum(EXTERNAL_KNOWLEDGE_SCOPES)).min(1).max(EXTERNAL_KNOWLEDGE_SCOPES.length);

function publicCaller(row: Record<string, unknown>) {
  const config = parseExternalKnowledgeCallerConfig(row.config);
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    workspaceId: Number(row.workspaceId),
    isActive: Boolean(row.isActive),
    tokenPrefix: typeof config.tokenPrefix === "string" ? config.tokenPrefix : "",
    scopes: Array.isArray(config.scopes)
      ? config.scopes.filter((scope): scope is ExternalKnowledgeScope => EXTERNAL_KNOWLEDGE_SCOPES.includes(scope as ExternalKnowledgeScope))
      : [],
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * Admin-only registry for external, read-only knowledge callers.
 * The plaintext caller token is deliberately returned exactly once at creation;
 * only its SHA-256 digest is persisted in the connector configuration.
 */
export const emperorExternalKnowledgeAccessRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    const rows = await rawExecute(
      `SELECT id, workspaceId, slug, name, description, config, isActive, createdAt, updatedAt
       FROM emperor_mcp_connectors
       WHERE connectionType = 'internal'
         AND JSON_UNQUOTE(JSON_EXTRACT(config, '$.kind')) = ?
         AND ${scope.clause}
       ORDER BY isActive DESC, updatedAt DESC`,
        [EXTERNAL_KNOWLEDGE_CALLER_KIND, ...scope.params],
    );
    return rows.map((row) => publicCaller(row));
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(240).optional(),
      scopes: scopeSchema.default([...EXTERNAL_KNOWLEDGE_SCOPES]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "create" });
      const workspaceId = workspaceIdFromContext(ctx);
      if (!workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前调用方未绑定工作空间" });

      const token = createExternalKnowledgeCallerToken();
      const slug = `kb-external-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
      const config = {
        kind: EXTERNAL_KNOWLEDGE_CALLER_KIND,
        tokenHash: hashExternalKnowledgeCallerToken(token),
        tokenPrefix: token.slice(0, 12),
        scopes: [...new Set(input.scopes)],
        createdBy: ctx.user.id,
        createdAt: new Date().toISOString(),
      };
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors
          (workspaceId, slug, name, description, connectionType, config, governancePolicy, secretRefs, isActive)
         VALUES (?, ?, ?, ?, 'internal', ?, ?, JSON_ARRAY(), 1)`,
        [
          workspaceId,
          slug,
          input.name,
          input.description || null,
          JSON.stringify(config),
          JSON.stringify({
            kind: EXTERNAL_KNOWLEDGE_CALLER_KIND,
            allowExternalReadOnly: true,
            allowedScopes: config.scopes,
            writesAllowed: false,
          }),
        ],
      );
      const connectorRows = await rawExecute(
        `SELECT id FROM emperor_mcp_connectors WHERE slug = ? AND workspaceId = ? LIMIT 1`,
        [slug, workspaceId],
      );
      if (!connectorRows[0]?.id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "调用方绑定创建失败" });
      await rawExecute(
        `INSERT INTO emperor_external_knowledge_callers
          (connectorId, workspaceId, tokenHash, tokenPrefix, scopes, createdByUserId)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [connectorRows[0].id, workspaceId, config.tokenHash, config.tokenPrefix, JSON.stringify(config.scopes), ctx.user.id],
      );
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "external_knowledge_caller.create",
        resourceType: "tool",
        resourceId: slug,
        resourceName: input.name,
        status: "success",
        riskLevel: "high",
        metadata: { scopes: config.scopes, plaintextTokenPersisted: false },
      });
      return {
        caller: {
          slug,
          name: input.name,
          workspaceId,
          tokenPrefix: config.tokenPrefix,
          scopes: config.scopes,
        },
        token,
      };
    }),

  revoke: adminProcedure
    .input(z.object({ slug: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "update", resourceId: input.slug });
      const workspaceId = workspaceIdFromContext(ctx);
      const scope = buildWorkspaceScopeFilter(workspaceId);
      const before = await rawExecute(
        `SELECT id, name FROM emperor_mcp_connectors
         WHERE slug = ?
           AND connectionType = 'internal'
           AND JSON_UNQUOTE(JSON_EXTRACT(config, '$.kind')) = ?
           AND ${scope.clause}
         LIMIT 1`,
        [input.slug, EXTERNAL_KNOWLEDGE_CALLER_KIND, ...scope.params],
      );
      if (!before[0]) throw new TRPCError({ code: "NOT_FOUND", message: "外部知识库调用方不存在或不属于当前工作空间" });
      await rawExecute(
        `UPDATE emperor_mcp_connectors SET isActive = 0, updatedAt = NOW()
         WHERE id = ?`,
        [before[0].id],
      );
      await rawExecute(
        `UPDATE emperor_external_knowledge_callers SET revokedAt = NOW()
         WHERE connectorId = ? AND workspaceId = ? AND revokedAt IS NULL`,
        [before[0].id, workspaceId],
      );
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "external_knowledge_caller.revoke",
        resourceType: "tool",
        resourceId: input.slug,
        resourceName: String(before[0].name),
        status: "success",
        riskLevel: "high",
      });
      return { success: true };
    }),
});

export const externalKnowledgeCallerConfig = {
  kind: EXTERNAL_KNOWLEDGE_CALLER_KIND,
  scopes: EXTERNAL_KNOWLEDGE_SCOPES,
  hashToken: hashExternalKnowledgeCallerToken,
  parseConfig: parseExternalKnowledgeCallerConfig,
};
