import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { actorFromContext, assertResourceAction, buildWorkspaceScopeFilter, recordSecurityAuditLog, workspaceIdFromContext } from "../../../services/securityGovernance";
import { assertToolConfigUsesSecretRefs, invokeEmperorTool, sanitizeToolConfigForPublic } from "../services/toolGateway";
import { rawExecute } from "../routerContext";

export const emperorMcpRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    const rows = await rawExecute(
      `SELECT id,workspaceId,slug,name,description,connectionType,isActive,createdAt
       FROM emperor_mcp_connectors
       WHERE ${scope.clause}
       ORDER BY workspaceId IS NULL ASC, name`,
      scope.params,
    );
    return rows.map((r: any) => ({ ...r, isActive: !!r.isActive }));
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "read",
        resourceId: input.slug,
      });
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const rows = await rawExecute(
        `SELECT *
         FROM emperor_mcp_connectors
         WHERE slug = ? AND ${scope.clause}
         ORDER BY workspaceId IS NULL ASC
         LIMIT 1`,
        [input.slug, ...scope.params],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : (rows[0].config ?? {});
      const secretRefs = typeof rows[0].secretRefs === "string" ? JSON.parse(rows[0].secretRefs) : (rows[0].secretRefs ?? []);
      const governancePolicy = typeof rows[0].governancePolicy === "string" ? JSON.parse(rows[0].governancePolicy) : (rows[0].governancePolicy ?? {});
      return {
        ...rows[0],
        config: sanitizeToolConfigForPublic(config),
        governancePolicy,
        secretRefs,
        isActive: !!rows[0].isActive,
      };
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      toolType: z.enum(["rest_api","openapi","database","custom_script"]).optional().default("rest_api"),
      description: z.string().optional(),
      // Step 2: connection
      baseUrl: z.string().optional(),
      // Step 3: auth
      authType: z.enum(["none","api_key","bearer","basic","oauth2"]).optional().default("none"),
      authConfig: z.any().optional(),
      governancePolicy: z.any().optional(),
      secretRefs: z.any().optional(),
      // Step 4: capabilities
      capabilities: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
        parameters: z.any().optional(),
      })).optional().default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "create" });
      assertToolConfigUsesSecretRefs(input.authConfig, "mcp.authConfig");
      assertToolConfigUsesSecretRefs(input.capabilities, "mcp.capabilities");
      assertToolConfigUsesSecretRefs(input.secretRefs, "mcp.secretRefs");
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) + "-" + Date.now().toString(36);
      const connectionType = input.toolType === "database" ? "database" : input.toolType === "custom_script" ? "script" : "http_api";
      const config = JSON.stringify({ baseUrl: input.baseUrl, authType: input.authType, authConfig: input.authConfig, capabilities: input.capabilities });
      const workspaceId = workspaceIdFromContext(ctx);
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (workspaceId,slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive) VALUES (?,?,?,?,?,?,?,?,1)`,
        [
          workspaceId,
          slug,
          input.name,
          input.description || null,
          connectionType,
          config,
          input.governancePolicy ? JSON.stringify(input.governancePolicy) : null,
          input.secretRefs ? JSON.stringify(input.secretRefs) : null,
        ],
      );
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "mcp.create",
        resourceType: "tool",
        resourceId: slug,
        resourceName: input.name,
        status: "success",
        riskLevel: "high",
      });
      return { success: true, slug };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      config: z.any().optional(),
      governancePolicy: z.any().optional(),
      secretRefs: z.any().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { slug, ...rest } = input;
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "update",
        resourceId: slug,
      });
      assertToolConfigUsesSecretRefs(rest.config, "mcp.config");
      assertToolConfigUsesSecretRefs(rest.secretRefs, "mcp.secretRefs");
      const sets: string[] = []; const vals: any[] = [];
      if (rest.name !== undefined) { sets.push("name=?"); vals.push(rest.name); }
      if (rest.description !== undefined) { sets.push("description=?"); vals.push(rest.description); }
      if (rest.config !== undefined) { sets.push("config=?"); vals.push(JSON.stringify(rest.config)); }
      if (rest.governancePolicy !== undefined) { sets.push("governancePolicy=?"); vals.push(JSON.stringify(rest.governancePolicy)); }
      if (rest.secretRefs !== undefined) { sets.push("secretRefs=?"); vals.push(JSON.stringify(rest.secretRefs)); }
      if (rest.isActive !== undefined) { sets.push("isActive=?"); vals.push(rest.isActive?1:0); }
      if (!sets.length) return { success: true };
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      vals.push(slug, ...scope.params);
      await rawExecute(`UPDATE emperor_mcp_connectors SET ${sets.join(",")},updatedAt=NOW() WHERE slug=? AND ${scope.clause}`, vals);
      await recordSecurityAuditLog({
        ctx,
        action: "mcp.update",
        resourceType: "tool",
        resourceId: slug,
        resourceName: rest.name || null,
        status: "success",
        riskLevel: "high",
      });
      return { success: true };
    }),

  invoke: protectedProcedure
    .input(z.object({ slug: z.string(), capability: z.string(), params: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "invoke",
        resourceId: input.slug,
      });
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await invokeEmperorTool({
        toolSlug: `mcp.${input.slug}`,
        params: {
          capability: input.capability,
          ...(input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : { payload: input.params }),
        },
        userId: ctx.user.id,
        userRole: (ctx.user as any).role || null,
        workspaceId,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "mcp.invoke",
        resourceType: "tool",
        resourceId: input.slug,
        toolSlug: `mcp.${input.slug}`,
        status: result.success ? "success" : "failed",
        riskLevel: result.metadata.riskLevel || "medium",
        metadata: {
          capability: input.capability,
          toolRunId: result.metadata.toolRunId,
          failureKind: result.metadata.failureKind,
        },
      });
      return result;
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      connectionType: z.enum(["http_api","database","webhook","internal","script"]),
      config: z.any().optional(),
      governancePolicy: z.any().optional(),
      secretRefs: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "update",
        resourceId: input.slug,
      });
      assertToolConfigUsesSecretRefs(input.config, "mcp.config");
      assertToolConfigUsesSecretRefs(input.secretRefs, "mcp.secretRefs");
      const workspaceId = workspaceIdFromContext(ctx);
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (workspaceId,slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE workspaceId=VALUES(workspaceId),name=VALUES(name),description=VALUES(description),connectionType=VALUES(connectionType),config=VALUES(config),governancePolicy=VALUES(governancePolicy),secretRefs=VALUES(secretRefs),isActive=VALUES(isActive),updatedAt=NOW()`,
        [
          workspaceId,
          input.slug,
          input.name,
          input.description || null,
          input.connectionType,
          input.config ? JSON.stringify(input.config) : null,
          input.governancePolicy ? JSON.stringify(input.governancePolicy) : null,
          input.secretRefs ? JSON.stringify(input.secretRefs) : null,
          input.isActive ? 1 : 0,
        ],
      );
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "mcp.upsert",
        resourceType: "tool",
        resourceId: input.slug,
        resourceName: input.name,
        status: "success",
        riskLevel: "high",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "delete",
        resourceId: input.slug,
      });
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      await rawExecute(
        `DELETE FROM emperor_mcp_connectors WHERE slug = ? AND ${scope.clause}`,
        [input.slug, ...scope.params],
      );
      await recordSecurityAuditLog({
        ctx,
        action: "mcp.delete",
        resourceType: "tool",
        resourceId: input.slug,
        status: "success",
        riskLevel: "high",
      });
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Agents Router
// ─────────────────────────────────────────────────────────────────────────────
