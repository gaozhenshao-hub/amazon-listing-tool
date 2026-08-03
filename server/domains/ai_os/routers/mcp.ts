import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { assertToolConfigUsesSecretRefs, invokeEmperorTool, sanitizeToolConfigForPublic } from "../services/toolGateway";
import { rawExecute } from "../routerContext";

export const emperorMcpRouter = router({
  list: protectedProcedure.query(async () => {
    const rows = await rawExecute("SELECT id,slug,name,description,connectionType,isActive,createdAt FROM emperor_mcp_connectors ORDER BY name");
    return rows.map((r: any) => ({ ...r, isActive: !!r.isActive }));
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_mcp_connectors WHERE slug = ? LIMIT 1", [input.slug]);
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
    .mutation(async ({ input }) => {
      assertToolConfigUsesSecretRefs(input.authConfig, "mcp.authConfig");
      assertToolConfigUsesSecretRefs(input.capabilities, "mcp.capabilities");
      assertToolConfigUsesSecretRefs(input.secretRefs, "mcp.secretRefs");
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) + "-" + Date.now().toString(36);
      const connectionType = input.toolType === "database" ? "database" : input.toolType === "custom_script" ? "script" : "http_api";
      const config = JSON.stringify({ baseUrl: input.baseUrl, authType: input.authType, authConfig: input.authConfig, capabilities: input.capabilities });
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive) VALUES (?,?,?,?,?,?,?,1)`,
        [
          slug,
          input.name,
          input.description || null,
          connectionType,
          config,
          input.governancePolicy ? JSON.stringify(input.governancePolicy) : null,
          input.secretRefs ? JSON.stringify(input.secretRefs) : null,
        ],
      );
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
    .mutation(async ({ input }) => {
      const { slug, ...rest } = input;
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
      vals.push(slug);
      await rawExecute(`UPDATE emperor_mcp_connectors SET ${sets.join(",")} WHERE slug=?`, vals);
      return { success: true };
    }),

  invoke: protectedProcedure
    .input(z.object({ slug: z.string(), capability: z.string(), params: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      return invokeEmperorTool({
        toolSlug: `mcp.${input.slug}`,
        params: {
          capability: input.capability,
          ...(input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : { payload: input.params }),
        },
        userId: ctx.user.id,
        userRole: (ctx.user as any).role || null,
      });
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
    .mutation(async ({ input }) => {
      assertToolConfigUsesSecretRefs(input.config, "mcp.config");
      assertToolConfigUsesSecretRefs(input.secretRefs, "mcp.secretRefs");
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),connectionType=VALUES(connectionType),config=VALUES(config),governancePolicy=VALUES(governancePolicy),secretRefs=VALUES(secretRefs),isActive=VALUES(isActive)`,
        [
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
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_mcp_connectors WHERE slug = ?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Agents Router
// ─────────────────────────────────────────────────────────────────────────────
