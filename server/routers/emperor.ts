/**
 * Emperor 皇帝 · AI能力中台 - 融合路由
 * 提供 Skill 管理、运行引擎、运行历史、模型路由、MCP 连接器、Agent 编排、定时任务等功能
 */
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { TRPCError } from "@trpc/server";
import type { Pool } from "mysql2/promise";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw SQL helper (uses drizzle $client which is mysql2 Pool)
// ─────────────────────────────────────────────────────────────────────────────

async function rawExecute(sql: string, params: any[] = []): Promise<any[]> {
  const drizzle = await getDb();
  if (!drizzle) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const pool = (drizzle as any).$client as Pool;
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getSkillBySlug(slug: string) {
  const rows = await rawExecute("SELECT * FROM emperor_skills WHERE slug = ? LIMIT 1", [slug]);
  return rows[0] || null;
}

function parseManifest(skill: any) {
  if (!skill) return null;
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  return { ...skill, manifest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill Library Router
// ─────────────────────────────────────────────────────────────────────────────

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
      let sql = "SELECT id,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,modelOverride,createdAt,updatedAt FROM emperor_skills WHERE 1=1";
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
    }))
    .mutation(async ({ input }) => {
      const manifest = {
        implementation: {
          systemPrompt: input.systemPrompt || "",
          userPromptTemplate: input.userPromptTemplate || "{{context}}",
        }
      };
      await rawExecute(
        `INSERT INTO emperor_skills (slug,name,description,category,modelOverride,status,manifest,isSystem,callCount,version) VALUES (?,?,?,?,?,?,?,0,0,'1.0.0')`,
        [input.slug, input.name, input.description||null, input.category||"通用", input.modelOverride||null, input.status||"Draft", JSON.stringify(manifest)]
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
    }))
    .mutation(async ({ input }) => {
      const { slug, systemPrompt, userPromptTemplate, ...updates } = input;
      const sets: string[] = [];
      const params: any[] = [];
      if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
      if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
      if (updates.category !== undefined) { sets.push("category = ?"); params.push(updates.category); }
      if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
      if (updates.modelOverride !== undefined) { sets.push("modelOverride = ?"); params.push(updates.modelOverride); }
      if (updates.manifest !== undefined) { sets.push("manifest = ?"); params.push(JSON.stringify(updates.manifest)); }
      else if (systemPrompt !== undefined || userPromptTemplate !== undefined) {
        // Merge into manifest
        const existing = await rawExecute("SELECT manifest FROM emperor_skills WHERE slug = ? LIMIT 1", [slug]);
        const existingManifest = existing[0]?.manifest ? (typeof existing[0].manifest === "string" ? JSON.parse(existing[0].manifest) : existing[0].manifest) : {};
        if (systemPrompt !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.systemPrompt = systemPrompt; }
        if (userPromptTemplate !== undefined) { existingManifest.implementation = existingManifest.implementation || {}; existingManifest.implementation.userPromptTemplate = userPromptTemplate; }
        sets.push("manifest = ?"); params.push(JSON.stringify(existingManifest));
      }
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

async function resolveModel(skill: any, modelOverrideSlug?: string): Promise<{ modelId: string; provider: string }> {
  if (modelOverrideSlug) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [modelOverrideSlug]);
    if (rows[0]) return { modelId: rows[0].modelId, provider: rows[0].provider };
  }
  if (skill.modelOverride) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [skill.modelOverride]);
    if (rows[0]) return { modelId: rows[0].modelId, provider: rows[0].provider };
  }
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  const modelPolicy = manifest?.implementation?.modelPolicy;
  if (modelPolicy) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE modelId = ? AND isActive = 1 LIMIT 1", [modelPolicy]);
    if (rows[0]) return { modelId: rows[0].modelId, provider: rows[0].provider };
  }
  return { modelId: "manus-default", provider: "manus_builtin" };
}

function renderTemplate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    if (val === undefined || val === null) return "";
    return typeof val === "object" ? JSON.stringify(val) : String(val);
  });
}

export const emperorRunRouter = router({
  run: protectedProcedure
    .input(z.object({
      skillSlug: z.string(),
      context: z.string().optional().default(""),
      emphasis: z.string().optional().default(""),
      variables: z.record(z.string(), z.any()).optional().default({}),
      modelOverride: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const runId = generateRunId();
      const startedAt = new Date();

      const skillRow = await getSkillBySlug(input.skillSlug);
      if (!skillRow) throw new TRPCError({ code: "NOT_FOUND", message: `Skill '${input.skillSlug}' not found` });
      const skill = parseManifest(skillRow)!;
      const impl = skill.manifest?.implementation || {};

      const modelInfo = await resolveModel(skill, input.modelOverride);

      const templateVars = { context: input.context, emphasis: input.emphasis, ...input.variables };
      const systemPrompt = impl.systemPrompt || "You are a helpful assistant.";
      const userPromptTemplate = impl.userPromptTemplate || "{{context}}";
      const userPrompt = renderTemplate(userPromptTemplate, templateVars);

      await rawExecute(
        "INSERT INTO emperor_skill_runs (runId,skillSlug,skillName,userId,input,status,modelSlug,startedAt) VALUES (?,?,?,?,?,?,?,?)",
        [runId, input.skillSlug, skill.name, ctx.user.id, JSON.stringify({ context: input.context, emphasis: input.emphasis }), "running", modelInfo.modelId, startedAt]
      );

      try {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];

        const llmParams: any = { messages };
        if (impl.supportsJsonMode === true && systemPrompt.toLowerCase().includes("json")) {
          llmParams.response_format = { type: "json_object" };
        }
        if (impl.temperature !== undefined) llmParams.temperature = impl.temperature;
        if (impl.maxTokens) llmParams.max_tokens = impl.maxTokens;

        const response = await invokeLLM(llmParams);
        const content = response?.choices?.[0]?.message?.content || "";
        const usage = (response?.usage || {}) as { prompt_tokens?: number; completion_tokens?: number };
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        const inputTok = usage.prompt_tokens || 0;
        const outputTok = usage.completion_tokens || 0;

        await rawExecute(
          "UPDATE emperor_skill_runs SET status=?,output=?,inputTokens=?,outputTokens=?,durationMs=?,completedAt=? WHERE runId=?",
          ["succeeded", JSON.stringify({ content }), inputTok, outputTok, durationMs, completedAt, runId]
        );
        await rawExecute("UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ?", [input.skillSlug]);

        return { runId, status: "succeeded", content, durationMs, inputTokens: inputTok, outputTokens: outputTok };
      } catch (err: any) {
        await rawExecute(
          "UPDATE emperor_skill_runs SET status=?,errorMessage=?,completedAt=? WHERE runId=?",
          ["failed", err.message || "Unknown error", new Date(), runId]
        );
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message || "Skill execution failed" });
      }
    }),

  history: protectedProcedure
    .input(z.object({
      skillSlug: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input, ctx }) => {
      let sql = "SELECT id,runId,skillSlug,skillName,userId,status,errorMessage,modelSlug,inputTokens,outputTokens,durationMs,startedAt,completedAt,createdAt FROM emperor_skill_runs WHERE 1=1";
      const params: any[] = [];
      if (input.skillSlug) { sql += " AND skillSlug = ?"; params.push(input.skillSlug); }
      if (input.status) { sql += " AND status = ?"; params.push(input.status); }
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (!isAdmin) { sql += " AND userId = ?"; params.push(ctx.user.id); }
      sql += " ORDER BY createdAt DESC";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const runs = await rawExecute(sql, params);
      return { runs, page: input.page, pageSize: input.pageSize };
    }),

  getDetail: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const rows = await rawExecute("SELECT * FROM emperor_skill_runs WHERE runId = ? LIMIT 1", [input.runId]);
      const run = rows[0];
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (!isAdmin && run.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      const output = typeof run.output === "string" ? JSON.parse(run.output) : run.output;
      const inputData = typeof run.input === "string" ? JSON.parse(run.input) : run.input;
      return { ...run, output, input: inputData };
    }),

  tokenStats: protectedProcedure
    .input(z.object({
      days: z.number().default(30),
      groupBy: z.enum(["day","skill","user"]).default("day"),
    }))
    .query(async ({ ctx, input }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      const userFilter = isAdmin ? "" : `AND userId = ${ctx.user.id}`;
      if (input.groupBy === "day") {
        return rawExecute(
          `SELECT DATE(createdAt) as date, SUM(inputTokens+outputTokens) as totalTokens, COUNT(*) as runCount FROM emperor_skill_runs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY DATE(createdAt) ORDER BY date ASC`,
          [input.days]
        );
      } else if (input.groupBy === "skill") {
        return rawExecute(
          `SELECT skillSlug, skillName, SUM(inputTokens+outputTokens) as totalTokens, COUNT(*) as runCount, AVG(durationMs) as avgDurationMs FROM emperor_skill_runs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY skillSlug, skillName ORDER BY totalTokens DESC LIMIT 20`,
          [input.days]
        );
      } else {
        return rawExecute(
          `SELECT r.userId, u.name as userName, SUM(r.inputTokens+r.outputTokens) as totalTokens, COUNT(*) as runCount FROM emperor_skill_runs r LEFT JOIN users u ON r.userId = u.id WHERE r.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY r.userId, u.name ORDER BY totalTokens DESC LIMIT 20`,
          [input.days]
        );
      }
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Model Providers Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorModelsRouter = router({
  list: protectedProcedure.query(async () => {
    return rawExecute("SELECT id,slug,name,provider,modelId,displayName,isDefault,isActive,capabilityTags,createdAt FROM emperor_model_providers ORDER BY isDefault DESC, name ASC");
  }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      provider: z.enum(["manus_builtin","openai","deepseek","anthropic","custom"]),
      modelId: z.string(),
      displayName: z.string().optional(),
      baseUrl: z.string().optional(),
      apiKeyRef: z.string().optional(),
      isDefault: z.boolean().optional().default(false),
      isActive: z.boolean().optional().default(true),
      capabilityTags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      await rawExecute(
        `INSERT INTO emperor_model_providers (slug,name,provider,modelId,displayName,baseUrl,apiKeyRef,isDefault,isActive,capabilityTags) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),provider=VALUES(provider),modelId=VALUES(modelId),displayName=VALUES(displayName),baseUrl=VALUES(baseUrl),apiKeyRef=VALUES(apiKeyRef),isDefault=VALUES(isDefault),isActive=VALUES(isActive),capabilityTags=VALUES(capabilityTags)`,
        [input.slug, input.name, input.provider, input.modelId, input.displayName||null, input.baseUrl||null, input.apiKeyRef||null, input.isDefault?1:0, input.isActive?1:0, input.capabilityTags ? JSON.stringify(input.capabilityTags) : null]
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_model_providers WHERE slug = ?", [input.slug]);
      return { success: true };
    }),

  test: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        const start = Date.now();
        const res = await invokeLLM({ messages: [{ role: "user", content: "Reply with exactly: OK" }] });
        const ms = Date.now() - start;
        const content = res?.choices?.[0]?.message?.content || "";
        return { success: true, latencyMs: ms, response: content.slice(0, 100) };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP Connectors Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorMcpRouter = router({
  list: protectedProcedure.query(async () => {
    return rawExecute("SELECT id,slug,name,description,connectionType,isActive,createdAt FROM emperor_mcp_connectors ORDER BY name");
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_mcp_connectors WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config;
      return { ...rows[0], config };
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      connectionType: z.enum(["http_api","database","webhook","internal","script"]),
      config: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input }) => {
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (slug,name,description,connectionType,config,isActive) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),connectionType=VALUES(connectionType),config=VALUES(config),isActive=VALUES(isActive)`,
        [input.slug, input.name, input.description||null, input.connectionType, input.config ? JSON.stringify(input.config) : null, input.isActive?1:0]
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

export const emperorAgentsRouter = router({
  list: protectedProcedure.query(async () => {
    return rawExecute("SELECT id,slug,name,description,category,status,callCount,createdAt FROM emperor_agents ORDER BY name");
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const dag = typeof rows[0].dagDefinition === "string" ? JSON.parse(rows[0].dagDefinition) : rows[0].dagDefinition;
      return { ...rows[0], dagDefinition: dag };
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["Draft","Validated","Released","Deprecated"]).optional().default("Draft"),
      dagDefinition: z.any(),
    }))
    .mutation(async ({ input }) => {
      await rawExecute(
        `INSERT INTO emperor_agents (slug,name,description,category,status,dagDefinition) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),dagDefinition=VALUES(dagDefinition)`,
        [input.slug, input.name, input.description||null, input.category||"通用", input.status, JSON.stringify(input.dagDefinition)]
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_agents WHERE slug = ?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks Router
// ─────────────────────────────────────────────────────────────────────────────

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
// Diagnostics Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorDiagnosticsRouter = router({
  health: protectedProcedure.query(async () => {
    const checks: Record<string, { status: "ok"|"error"|"warning"; message?: string; latencyMs?: number }> = {};

    try {
      const start = Date.now();
      await rawExecute("SELECT 1");
      checks.database = { status: "ok", latencyMs: Date.now() - start };
    } catch (e: any) {
      checks.database = { status: "error", message: e.message };
    }

    try {
      const start = Date.now();
      await invokeLLM({ messages: [{ role: "user", content: "ping" }] });
      checks.llm = { status: "ok", latencyMs: Date.now() - start };
    } catch (e: any) {
      checks.llm = { status: "error", message: e.message };
    }

    try {
      const rows = await rawExecute("SELECT COUNT(*) as cnt FROM emperor_skills WHERE status = 'Released'");
      checks.skills = { status: "ok", message: `${rows[0]?.cnt || 0} Released skills` };
    } catch (e: any) {
      checks.skills = { status: "error", message: e.message };
    }

    return { checks, timestamp: new Date().toISOString() };
  }),

  recentErrors: adminProcedure.query(async () => {
    return rawExecute("SELECT runId,skillSlug,skillName,errorMessage,createdAt FROM emperor_skill_runs WHERE status='failed' ORDER BY createdAt DESC LIMIT 20");
  }),

  stats: protectedProcedure.query(async () => {
    const [skillCount, runCount, todayRuns, totalTokens, agentCount, mcpCount] = await Promise.all([
      rawExecute("SELECT COUNT(*) as cnt FROM emperor_skills"),
      rawExecute("SELECT COUNT(*) as cnt FROM emperor_skill_runs"),
      rawExecute("SELECT COUNT(*) as cnt FROM emperor_skill_runs WHERE DATE(createdAt) = CURDATE()"),
      rawExecute("SELECT COALESCE(SUM(inputTokens+outputTokens),0) as total FROM emperor_skill_runs"),
      rawExecute("SELECT COUNT(*) as cnt FROM emperor_agents"),
      rawExecute("SELECT COUNT(*) as cnt FROM emperor_mcp_connectors WHERE isActive=1"),
    ]);
    return {
      skillCount: skillCount[0]?.cnt || 0,
      runCount: runCount[0]?.cnt || 0,
      todayRuns: todayRuns[0]?.cnt || 0,
      totalTokens: totalTokens[0]?.total || 0,
      agentCount: agentCount[0]?.cnt || 0,
      mcpCount: mcpCount[0]?.cnt || 0,
    };
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined Emperor Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorRouter = router({
  skills: emperorSkillsRouter,
  run: emperorRunRouter,
  models: emperorModelsRouter,
  mcp: emperorMcpRouter,
  agents: emperorAgentsRouter,
  scheduled: emperorScheduledRouter,
  diagnostics: emperorDiagnosticsRouter,
});
