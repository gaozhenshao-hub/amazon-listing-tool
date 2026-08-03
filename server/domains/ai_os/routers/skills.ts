import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { getSkillBySlug, normalizeSkillVersionForDb, parseManifest, rawExecute } from "../routerContext";

export const emperorSkillsRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }) => {
      let sql = "SELECT id,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,modelOverride,when_to_use,timeout_seconds,execution_mode,allowed_tools,disallowed_tools,model_override,createdAt,updatedAt FROM emperor_skills WHERE 1=1";
      const params: any[] = [];
      if (input.category) { sql += " AND category = ?"; params.push(input.category); }
      if (input.status) { sql += " AND status = ?"; params.push(input.status); }
      if (input.search) {
        sql += " AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)";
        params.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`);
      }
      sql += " ORDER BY category, name";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const skills = await rawExecute(sql, params);

      let countSql = "SELECT COUNT(*) as cnt FROM emperor_skills WHERE 1=1";
      const countParams: any[] = [];
      if (input.category) { countSql += " AND category = ?"; countParams.push(input.category); }
      if (input.status) { countSql += " AND status = ?"; countParams.push(input.status); }
      if (input.search) {
        countSql += " AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)";
        countParams.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`);
      }
      const countRows = await rawExecute(countSql, countParams);
      const total = countRows[0]?.cnt || 0;
      return { skills, total, page: input.page, pageSize: input.pageSize };
    }),

  categories: protectedProcedure.query(async () => {
    return rawExecute("SELECT category, COUNT(*) as count FROM emperor_skills GROUP BY category ORDER BY count DESC");
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const skill = await getSkillBySlug(input.slug);
      if (!skill) throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      return parseManifest(skill);
    }),

  create: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      systemPrompt: z.string().optional(),
      userPromptTemplate: z.string().optional(),
      modelOverride: z.string().nullable().optional(),
      status: z.enum(["Draft","Validated","Approved","Released","Deprecated"]).optional().default("Draft"),
      // cc-haha 新字段
      whenToUse: z.string().optional(),
      timeoutSeconds: z.number().optional().default(120),
      executionMode: z.enum(["inline","fork","background"]).optional().default("inline"),
      allowedTools: z.array(z.string()).optional(),
      disallowedTools: z.array(z.string()).optional(),
      version: z.union([z.string(), z.number()]).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const manifest = {
        implementation: {
          systemPrompt: input.systemPrompt || "",
          userPromptTemplate: input.userPromptTemplate || "{{context}}",
        }
      };
      await rawExecute(
        `INSERT INTO emperor_skills (slug,name,description,category,modelOverride,status,manifest,isSystem,callCount,version,when_to_use,timeout_seconds,execution_mode,allowed_tools,disallowed_tools) VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?,?,?)`,
        [
          input.slug, input.name, input.description||null, input.category||"通用",
          input.modelOverride||null, input.status||"Draft", JSON.stringify(manifest),
          normalizeSkillVersionForDb(input.version),
          input.whenToUse||null,
          input.timeoutSeconds||120,
          input.executionMode||"inline",
          input.allowedTools ? JSON.stringify(input.allowedTools) : null,
          input.disallowedTools ? JSON.stringify(input.disallowedTools) : null,
        ]
      );
      return { success: true };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["Draft","Validated","Approved","Released","Deprecated"]).optional(),
      modelOverride: z.string().nullable().optional(),
      systemPrompt: z.string().optional(),
      userPromptTemplate: z.string().optional(),
      manifest: z.any().optional(),
      // cc-haha 新字段
      whenToUse: z.string().nullable().optional(),
      timeoutSeconds: z.number().nullable().optional(),
      executionMode: z.enum(["inline","fork","background"]).optional(),
      allowedTools: z.array(z.string()).nullable().optional(),
      disallowedTools: z.array(z.string()).nullable().optional(),
      version: z.union([z.string(), z.number()]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { slug, systemPrompt, userPromptTemplate, whenToUse, timeoutSeconds, executionMode, allowedTools, disallowedTools, version, ...updates } = input;
      const sets: string[] = [];
      const params: any[] = [];
      if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
      if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
      if (updates.category !== undefined) { sets.push("category = ?"); params.push(updates.category); }
      if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
      if (updates.modelOverride !== undefined) { sets.push("modelOverride = ?"); params.push(updates.modelOverride); }
      if (updates.manifest !== undefined) { sets.push("manifest = ?"); params.push(JSON.stringify(updates.manifest)); }
      else if (systemPrompt !== undefined || userPromptTemplate !== undefined) {
        const existing = await rawExecute("SELECT manifest FROM emperor_skills WHERE slug = ? LIMIT 1", [slug]);
        const existingManifest = existing[0]?.manifest ? (typeof existing[0].manifest === "string" ? JSON.parse(existing[0].manifest) : existing[0].manifest) : {};
        if (systemPrompt !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.systemPrompt = systemPrompt; }
        if (userPromptTemplate !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.userPromptTemplate = userPromptTemplate; }
        sets.push("manifest = ?"); params.push(JSON.stringify(existingManifest));
      }
      // cc-haha 新字段
      if (whenToUse !== undefined) { sets.push("when_to_use = ?"); params.push(whenToUse); }
      if (timeoutSeconds !== undefined) { sets.push("timeout_seconds = ?"); params.push(timeoutSeconds); }
      if (executionMode !== undefined) { sets.push("execution_mode = ?"); params.push(executionMode); }
      if (allowedTools !== undefined) { sets.push("allowed_tools = ?"); params.push(allowedTools ? JSON.stringify(allowedTools) : null); }
      if (disallowedTools !== undefined) { sets.push("disallowed_tools = ?"); params.push(disallowedTools ? JSON.stringify(disallowedTools) : null); }
      if (version !== undefined) { sets.push("version = ?"); params.push(normalizeSkillVersionForDb(version)); }
      if (sets.length === 0) return { success: true };
      params.push(slug);
      await rawExecute(`UPDATE emperor_skills SET ${sets.join(", ")} WHERE slug = ?`, params);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_skills WHERE slug = ?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Skill Engine Router (Run Skills)
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedModel {
  modelId: string;
  provider: string;
  baseUrl?: string;
  apiKeyRef?: string;
}
async function resolveModel(skill: any, modelOverrideSlug?: string): Promise<ResolvedModel> {
  const fromRow = (row: any): ResolvedModel => ({
    modelId: row.modelId,
    provider: row.provider,
    baseUrl: row.baseUrl || undefined,
    apiKeyRef: row.apiKeyRef || undefined,
  });
  if (modelOverrideSlug) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [modelOverrideSlug]);
    if (rows[0]) return fromRow(rows[0]);
  }
  if (skill.modelOverride) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [skill.modelOverride]);
    if (rows[0]) return fromRow(rows[0]);
  }
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  const modelPolicy = manifest?.implementation?.modelPolicy;
  if (modelPolicy) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE modelId = ? AND isActive = 1 LIMIT 1", [modelPolicy]);
    if (rows[0]) return fromRow(rows[0]);
  }
  // Fallback: try default model
  const defaultRows = await rawExecute("SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 LIMIT 1");
  if (defaultRows[0]) return fromRow(defaultRows[0]);
  return { modelId: "manus-default", provider: "manus_builtin" };
}
