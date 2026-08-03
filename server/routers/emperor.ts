/**
 * Emperor 皇帝 · AI能力中台 - 融合路由
 * 提供 Skill 管理、运行引擎、运行历史、模型路由、MCP 连接器、Agent 编排、定时任务等功能
 */
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { renderSkillTemplate } from "../services/emperorSkillRunner";
import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import {
  assertValidAgentDag,
  cancelAgentRun,
  confirmAgentNode,
  executeAgentNode,
  getAgentRun,
  listAgentTemplateVersions,
  listAgentArtifacts,
  normalizeAgentDag,
  pauseAgentRun,
  recordAgentTemplateVersion,
  recoverTimedOutAgentNodes,
  rerunAgentNode,
  resolveAgentArtifactRef,
  resumeAgentRun,
  scheduleAgentRun,
  selectAgentArtifactVersion,
  startAgentRun,
  updateAgentNodeDraft,
  upsertListingAgentTemplate,
  validateAgentDag,
} from "../services/emperorAgentRunner";
import {
  invokeEmperorTool,
  listEmperorTools,
  listEmperorToolRuns,
  seedBuiltinTools,
  upsertEmperorTool,
} from "../services/emperorToolGateway";
import { listAiOsMetrics } from "../services/aiOsObservability";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSkillVersionForDb(value: unknown): number {
  const version = Number.parseInt(String(value ?? "1").trim().split(".")[0] || "1", 10);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw SQL helper (uses drizzle db.execute with sql template)
// ─────────────────────────────────────────────────────────────────────────────

async function rawExecute(sqlStr: string, params: any[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  let result: any;
  if (params.length > 0) {
    // Build parameterized query using drizzle sql template
    const parts = sqlStr.split('?');
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) {
        chunks.push(drizzleSql`${params[i]}`);
      }
    }
    const combined = drizzleSql.join(chunks, drizzleSql.raw(''));
    result = await db.execute(combined);
  } else {
    result = await db.execute(drizzleSql.raw(sqlStr));
  }
  // db.execute returns [[rows], fields] or just rows array
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
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
      const systemPrompt = impl.systemPrompt || "";
      if (!systemPrompt.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Skill '${input.skillSlug}' systemPrompt 为空` });
      }
      const userPromptTemplate = impl.userPromptTemplate || "{{context}}";
      const userPrompt = renderSkillTemplate(userPromptTemplate, templateVars);

      await rawExecute(
        "INSERT INTO emperor_skill_runs (runId,skillSlug,skillName,userId,input,status,modelSlug,startedAt) VALUES (?,?,?,?,?,?,?,?)",
        [runId, input.skillSlug, skill.name, ctx.user.id, JSON.stringify({ context: input.context, emphasis: input.emphasis }), "running", modelInfo.modelId, startedAt]
      );

      try {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];

        let content = "";
        let usage: { prompt_tokens?: number; completion_tokens?: number } = {};

        if (modelInfo.provider === "custom" && modelInfo.baseUrl && modelInfo.apiKeyRef) {
          // ── External LLM via OpenAI-compatible API (Teamo Router etc.) ──
          const apiUrl = `${modelInfo.baseUrl.replace(/\/$/, "")}/chat/completions`;
          const externalPayload: any = {
            model: modelInfo.modelId,
            messages: [...messages],
            max_tokens: impl.maxTokens || 4096,
          };
          if (impl.temperature !== undefined) externalPayload.temperature = impl.temperature;
          if (impl.supportsJsonMode === true && systemPrompt.toLowerCase().includes("json")) {
            externalPayload.messages[0] = {
              ...externalPayload.messages[0],
              content: externalPayload.messages[0].content + "\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown code fences, no explanation, no extra text.",
            };
          }
          const extResponse = await fetch(apiUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${modelInfo.apiKeyRef}` },
            body: JSON.stringify(externalPayload),
            signal: AbortSignal.timeout(120_000),
          });
          if (!extResponse.ok) {
            const errText = await extResponse.text();
            throw new Error(`External LLM [${modelInfo.modelId}] failed: ${extResponse.status} – ${errText.slice(0, 300)}`);
          }
          const extResult = await extResponse.json() as any;
          const msg = extResult?.choices?.[0]?.message;
          content = msg?.content || "";
          // DeepSeek V4 may return empty content with reasoning_content
          if (!content && msg?.reasoning_content) content = msg.reasoning_content;
          usage = extResult?.usage || {};
        } else {
          // ── Manus built-in LLM ──
          const llmParams: any = { messages };
          if (impl.supportsJsonMode === true && systemPrompt.toLowerCase().includes("json")) {
            llmParams.response_format = { type: "json_object" };
          }
          if (impl.temperature !== undefined) llmParams.temperature = impl.temperature;
          if (impl.maxTokens) llmParams.max_tokens = impl.maxTokens;
          llmParams.bypassEmperor = true;
          const response = await invokeLLM(llmParams);
          const rawContent = response?.choices?.[0]?.message?.content;
          content = typeof rawContent === "string" ? rawContent : (rawContent ? JSON.stringify(rawContent) : "");
          usage = (response?.usage || {}) as { prompt_tokens?: number; completion_tokens?: number };
        }
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
    const rows = await rawExecute("SELECT id,slug,name,provider,modelId,displayName,isDefault,isActive,capabilityTags,baseUrl,createdAt FROM emperor_model_providers ORDER BY isDefault DESC, name ASC");
    return rows.map((r: any) => ({
      ...r,
      capabilityTags: typeof r.capabilityTags === "string" ? JSON.parse(r.capabilityTags) : (r.capabilityTags ?? []),
      isDefault: !!r.isDefault, isActive: !!r.isActive,
    }));
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      modelId: z.string().min(1).max(128),
      provider: z.string().min(1).max(64),
      apiBaseUrl: z.string().optional().default("https://api.openai.com/v1"),
      apiKey: z.string().optional().default(""),
      capabilityTags: z.array(z.string()).optional().default([]),
      costPer1kInputTokens: z.number().min(0).optional().default(0),
      costPer1kOutputTokens: z.number().min(0).optional().default(0),
      maxContextTokens: z.number().min(1).optional().default(128000),
      isDefault: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) + "-" + Date.now().toString(36);
      if (input.isDefault) await rawExecute("UPDATE emperor_model_providers SET isDefault=0");
      await rawExecute(
        `INSERT INTO emperor_model_providers (slug,name,provider,modelId,displayName,baseUrl,apiKeyRef,isDefault,isActive,capabilityTags) VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [slug, input.name, input.provider, input.modelId, input.name, input.apiBaseUrl||null, input.apiKey||null, input.isDefault?1:0, JSON.stringify(input.capabilityTags)]
      );
      return { success: true, slug };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      apiBaseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      capabilityTags: z.array(z.string()).optional(),
      isDefault: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { slug, ...rest } = input;
      const sets: string[] = []; const vals: any[] = [];
      if (rest.name !== undefined) { sets.push("name=?"); vals.push(rest.name); }
      if (rest.apiBaseUrl !== undefined) { sets.push("baseUrl=?"); vals.push(rest.apiBaseUrl); }
      if (rest.apiKey !== undefined) { sets.push("apiKeyRef=?"); vals.push(rest.apiKey); }
      if (rest.capabilityTags !== undefined) { sets.push("capabilityTags=?"); vals.push(JSON.stringify(rest.capabilityTags)); }
      if (rest.isDefault !== undefined) {
        if (rest.isDefault) await rawExecute("UPDATE emperor_model_providers SET isDefault=0");
        sets.push("isDefault=?"); vals.push(rest.isDefault?1:0);
      }
      if (rest.isActive !== undefined) { sets.push("isActive=?"); vals.push(rest.isActive?1:0); }
      if (!sets.length) return { success: true };
      vals.push(slug);
      await rawExecute(`UPDATE emperor_model_providers SET ${sets.join(",")} WHERE slug=?`, vals);
      return { success: true };
    }),

  healthCheck: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const model = rows[0];
      const start = Date.now();
      let status: "active" | "error" = "active";
      let latencyMs = 0;
      let errorMsg = "";
      try {
        const baseUrl = model.baseUrl || "https://api.openai.com/v1";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${model.apiKeyRef || ""}`, "Content-Type": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timer);
        latencyMs = Date.now() - start;
        if (!response.ok) { status = "error"; errorMsg = `HTTP ${response.status}`; }
      } catch (e: any) {
        status = "error"; latencyMs = Date.now() - start; errorMsg = e.message;
      }
      await rawExecute("UPDATE emperor_model_providers SET isActive=? WHERE slug=?", [status === "active" ? 1 : 0, input.slug]);
      return { status, latencyMs, error: errorMsg || undefined };
    }),

  getCostStats: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).optional().default(30) }))
    .query(async ({ input }) => {
      const rows = await rawExecute(
        `SELECT DATE(createdAt) as date, COUNT(*) as calls, SUM(inputTokens) as inputTokens, SUM(outputTokens) as outputTokens FROM emperor_skill_runs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY DATE(createdAt) ORDER BY date ASC`,
        [input.days]
      );
      const daily = rows.map((r: any) => ({
        date: r.date, calls: Number(r.calls), inputTokens: Number(r.inputTokens||0), outputTokens: Number(r.outputTokens||0), costUsd: 0,
      }));
      const totals = daily.reduce((acc: any, r: any) => ({
        totalCalls: acc.totalCalls + r.calls,
        totalInputTokens: acc.totalInputTokens + r.inputTokens,
        totalOutputTokens: acc.totalOutputTokens + r.outputTokens,
        totalCostUsd: 0,
      }), { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
      return { daily, totals };
    }),

  getAuditLogs: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(50) }))
    .query(async ({ input }) => {
      return rawExecute(
        "SELECT id,skillSlug as resourceId,'skill_run' as action,status,createdAt FROM emperor_skill_runs ORDER BY createdAt DESC LIMIT ?",
        [input.limit]
      );
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
    const rows = await rawExecute("SELECT id,slug,name,description,connectionType,isActive,createdAt FROM emperor_mcp_connectors ORDER BY name");
    return rows.map((r: any) => ({ ...r, isActive: !!r.isActive }));
  }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_mcp_connectors WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : (rows[0].config ?? {});
      return { ...rows[0], config, isActive: !!rows[0].isActive };
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
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) + "-" + Date.now().toString(36);
      const connectionType = input.toolType === "database" ? "database" : input.toolType === "custom_script" ? "script" : "http_api";
      const config = JSON.stringify({ baseUrl: input.baseUrl, authType: input.authType, authConfig: input.authConfig, capabilities: input.capabilities });
      await rawExecute(
        `INSERT INTO emperor_mcp_connectors (slug,name,description,connectionType,config,isActive) VALUES (?,?,?,?,?,1)`,
        [slug, input.name, input.description||null, connectionType, config]
      );
      return { success: true, slug };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      config: z.any().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { slug, ...rest } = input;
      const sets: string[] = []; const vals: any[] = [];
      if (rest.name !== undefined) { sets.push("name=?"); vals.push(rest.name); }
      if (rest.description !== undefined) { sets.push("description=?"); vals.push(rest.description); }
      if (rest.config !== undefined) { sets.push("config=?"); vals.push(JSON.stringify(rest.config)); }
      if (rest.isActive !== undefined) { sets.push("isActive=?"); vals.push(rest.isActive?1:0); }
      if (!sets.length) return { success: true };
      vals.push(slug);
      await rawExecute(`UPDATE emperor_mcp_connectors SET ${sets.join(",")} WHERE slug=?`, vals);
      return { success: true };
    }),

  invoke: protectedProcedure
    .input(z.object({ slug: z.string(), capability: z.string(), params: z.any().optional() }))
    .mutation(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_mcp_connectors WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true, result: { message: "MCP tool invoked", params: input.params } };
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
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      let sql = "SELECT id,slug,name,description,status,triggerType,scope,maxExecutionSeconds,dagDefinition,updatedAt,createdAt FROM emperor_agents";
      const params: any[] = [];
      const where: string[] = [];
      if (input?.search) { where.push("(name LIKE ? OR slug LIKE ?)"); params.push(`%${input.search}%`, `%${input.search}%`); }
      if (input?.status) { where.push("status=?"); params.push(input.status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY updatedAt DESC";
      const rows = await rawExecute(sql, params);
      return rows.map((r: any) => {
        const dag = normalizeAgentDag(r.dagDefinition);
        return {
          ...r,
          dagDefinition: dag,
          validation: validateAgentDag(dag),
        };
      });
    }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const dag = normalizeAgentDag(rows[0].dagDefinition);
      return { ...rows[0], dagDefinition: dag, validation: validateAgentDag(dag) };
    }),

  validateDag: protectedProcedure
    .input(z.object({ workflow: z.any() }))
    .query(async ({ input }) => {
      return validateAgentDag(input.workflow);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      slug: z.string().min(1).max(128),
      description: z.string().optional(),
      scope: z.enum(["global","project","private"]).optional().default("project"),
      triggerType: z.enum(["manual","event","scheduled"]).optional().default("manual"),
      maxExecutionSeconds: z.number().optional().default(300),
      cronExpression: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "Slug 已存在" });
      await rawExecute(
        `INSERT INTO emperor_agents (slug,name,description,status,scope,triggerType,maxExecutionSeconds,cronExpression,dagDefinition) VALUES (?,?,?,'draft',?,?,?,?,?)`,
        [
          input.slug,
          input.name,
          input.description||null,
          input.scope,
          input.triggerType,
          input.maxExecutionSeconds,
          input.cronExpression||null,
          JSON.stringify({ nodes: [], edges: [] }),
        ]
      );
      return { success: true, slug: input.slug };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional(),
      triggerType: z.string().optional(),
      maxExecutionSeconds: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { slug, ...rest } = input;
      const sets: string[] = []; const vals: any[] = [];
      let releasedDag: any = null;
      if (rest.status === "active") {
        const rows = await rawExecute("SELECT name,dagDefinition FROM emperor_agents WHERE slug=? LIMIT 1", [slug]);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
        const dag = normalizeAgentDag(rows[0].dagDefinition);
        assertValidAgentDag(dag, "activate agent");
        releasedDag = { name: rows[0].name, dag };
      }
      if (rest.name !== undefined) { sets.push("name=?"); vals.push(rest.name); }
      if (rest.description !== undefined) { sets.push("description=?"); vals.push(rest.description); }
      if (rest.status !== undefined) { sets.push("status=?"); vals.push(rest.status); }
      if (rest.triggerType !== undefined) { sets.push("triggerType=?"); vals.push(rest.triggerType); }
      if (rest.maxExecutionSeconds !== undefined) { sets.push("maxExecutionSeconds=?"); vals.push(rest.maxExecutionSeconds); }
      if (!sets.length) return { success: true };
      sets.push("updatedAt=NOW()");
      vals.push(slug);
      await rawExecute(`UPDATE emperor_agents SET ${sets.join(",")} WHERE slug=?`, vals);
      const templateVersion = releasedDag
        ? await recordAgentTemplateVersion({
          agentSlug: slug,
          agentName: rest.name ?? releasedDag.name,
          dag: releasedDag.dag,
          status: "released",
          createdBy: ctx.user.id,
          releaseNotes: "Agent activated",
        })
        : null;
      return { success: true, templateVersion };
    }),

  saveWorkflow: adminProcedure
    .input(z.object({
      slug: z.string(),
      workflow: z.object({
        nodes: z.array(z.any()),
        edges: z.array(z.any()),
      }).passthrough(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dag = assertValidAgentDag(input.workflow, "save workflow");
      await rawExecute(
        "UPDATE emperor_agents SET dagDefinition=?, updatedAt=NOW() WHERE slug=?",
        [JSON.stringify(dag), input.slug]
      );
      const rows = await rawExecute("SELECT name,status FROM emperor_agents WHERE slug=? LIMIT 1", [input.slug]);
      const templateVersion = await recordAgentTemplateVersion({
        agentSlug: input.slug,
        agentName: rows[0]?.name || null,
        dag,
        status: rows[0]?.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Workflow saved",
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
    }),

  listTemplateVersions: protectedProcedure
    .input(z.object({
      slug: z.string(),
      limit: z.number().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input }) => {
      return listAgentTemplateVersions({ agentSlug: input.slug, limit: input.limit });
    }),

  getAvailableSkills: protectedProcedure.query(async () => {
    return rawExecute("SELECT slug,name,description,category FROM emperor_skills WHERE status='Released' ORDER BY name");
  }),

  getAvailableModels: protectedProcedure.query(async () => {
    const rows = await rawExecute("SELECT slug,name,provider,modelId,isDefault FROM emperor_model_providers WHERE isActive=1 ORDER BY isDefault DESC, name ASC");
    return rows.map((r: any) => ({ ...r, isDefault: !!r.isDefault }));
  }),

  getAvailableMcpTools: protectedProcedure.query(async () => {
    return rawExecute("SELECT slug,name,description,connectionType FROM emperor_mcp_connectors WHERE isActive=1 ORDER BY name");
  }),

  getAvailableTools: protectedProcedure.query(async () => {
    return listEmperorTools();
  }),

  run: protectedProcedure
    .input(z.object({
      slug: z.string(),
      inputs: z.record(z.string(), z.any()).optional().default({}),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return startAgentRun({
        slug: input.slug,
        inputs: input.inputs,
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
      });
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return getAgentRun(input.runId, isAdmin ? undefined : ctx.user.id, isAdmin);
    }),

  listArtifacts: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return listAgentArtifacts({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: isAdmin ? undefined : ctx.user.id,
        skipOwnerCheck: isAdmin,
      });
    }),

  getArtifactByRef: protectedProcedure
    .input(z.object({ ref: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return resolveAgentArtifactRef({
        ref: input.ref,
        userId: isAdmin ? undefined : ctx.user.id,
        skipOwnerCheck: isAdmin,
      });
    }),

  selectArtifactVersion: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      artifactKey: z.string(),
      version: z.number().int().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      return selectAgentArtifactVersion({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        version: input.version,
        userId: ctx.user.id,
      });
    }),

  listRuns: protectedProcedure
    .input(z.object({ slug: z.string(), limit: z.number().optional().default(20) }))
    .query(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (isAdmin) {
        return rawExecute("SELECT * FROM emperor_agent_runs WHERE agentSlug=? ORDER BY createdAt DESC LIMIT ?", [input.slug, input.limit]);
      }
      return rawExecute("SELECT * FROM emperor_agent_runs WHERE agentSlug=? AND userId=? ORDER BY createdAt DESC LIMIT ?", [input.slug, ctx.user.id, input.limit]);
    }),

  executeNode: protectedProcedure
    .input(z.object({ runId: z.string(), nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return executeAgentNode({ runId: input.runId, nodeId: input.nodeId, userId: ctx.user.id });
    }),

  scheduleRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      mode: z.enum(["unlock", "next", "all_ready"]).optional().default("unlock"),
    }))
    .mutation(async ({ ctx, input }) => {
      return scheduleAgentRun({ runId: input.runId, userId: ctx.user.id, mode: input.mode });
    }),

  cancelRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return cancelAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
    }),

  pauseRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return pauseAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
    }),

  resumeRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      return resumeAgentRun({ runId: input.runId, userId: ctx.user.id });
    }),

  recoverTimedOutNodes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .mutation(async ({ input }) => {
      return recoverTimedOutAgentNodes({ limit: input?.limit });
    }),

  rerunNode: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      resetDescendants: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      return rerunAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        resetDescendants: input.resetDescendants,
      });
    }),

  updateNodeDraft: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      userEdit: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      return updateAgentNodeDraft({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        userEdit: input.userEdit,
      });
    }),

  confirmNode: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      output: z.any().optional(),
      userEdit: z.any().optional(),
      skip: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      return confirmAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        output: input.output,
        userEdit: input.userEdit,
        skip: input.skip,
      });
    }),

  installListingTemplate: adminProcedure
    .mutation(async () => {
      return upsertListingAgentTemplate();
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional().default("draft"),
      dagDefinition: z.any(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dag = assertValidAgentDag(input.dagDefinition, "upsert agent");
      await rawExecute(
        `INSERT INTO emperor_agents (slug,name,description,category,status,dagDefinition) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),dagDefinition=VALUES(dagDefinition),updatedAt=NOW()`,
        [input.slug, input.name, input.description||null, input.category||"通用", input.status, JSON.stringify(dag)]
      );
      const templateVersion = await recordAgentTemplateVersion({
        agentSlug: input.slug,
        agentName: input.name,
        dag,
        status: input.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Agent upserted",
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
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
// Tool Gateway Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorToolsRouter = router({
  list: protectedProcedure.query(async () => {
    return listEmperorTools();
  }),

  listRuns: protectedProcedure
    .input(z.object({
      toolSlug: z.string().optional(),
      agentRunId: z.string().optional(),
      nodeId: z.string().optional(),
      status: z.enum(["running", "succeeded", "failed", "blocked"]).optional(),
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return listEmperorToolRuns({
        userId: ctx.user.id,
        isAdmin,
        toolSlug: input?.toolSlug,
        agentRunId: input?.agentRunId,
        nodeId: input?.nodeId,
        status: input?.status,
        limit: input?.limit,
      });
    }),

  seedBuiltins: adminProcedure.mutation(async () => {
    return seedBuiltinTools();
  }),

  invoke: protectedProcedure
    .input(z.object({
      toolSlug: z.string(),
      params: z.any().optional(),
      runId: z.string().optional(),
      nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return invokeEmperorTool({
        toolSlug: input.toolSlug,
        params: input.params,
        userId: ctx.user.id,
        userRole: (ctx.user as any).role || null,
        runId: input.runId,
        nodeId: input.nodeId,
      });
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["mcp", "api", "internal", "code"]),
      config: z.any().optional(),
      inputSchema: z.any().optional(),
      outputSchema: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input }) => {
      return upsertEmperorTool(input);
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_tools WHERE slug=?", [input.slug]);
      return { success: true };
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
// Knowledge / Memory Router (cc-haha 四分类记忆体系)
// ─────────────────────────────────────────────────────────────────────────────

export const emperorKnowledgeRouter = router({
  list: protectedProcedure
    .input(z.object({
      memoryType: z.enum(["feedback","fact","project","reference"]).optional(),
      search: z.string().optional(),
      projectId: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input, ctx }) => {
      let sql = "SELECT id,user_id,project_id,title,content,memory_type,source,tags,is_active,confidence,created_at,updated_at FROM emperor_knowledge WHERE is_active=1";
      const params: any[] = [];
      if (input.memoryType) { sql += " AND memory_type=?"; params.push(input.memoryType); }
      if (input.projectId) { sql += " AND project_id=?"; params.push(input.projectId); }
      if (input.search) { sql += " AND (title LIKE ? OR content LIKE ?)"; params.push(`%${input.search}%`, `%${input.search}%`); }
      sql += " ORDER BY updated_at DESC";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const rows = await rawExecute(sql, params);
      const items = rows.map((r: any) => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : (r.tags ?? []),
        is_active: !!r.is_active,
      }));

      let countSql = "SELECT COUNT(*) as cnt FROM emperor_knowledge WHERE is_active=1";
      const countParams: any[] = [];
      if (input.memoryType) { countSql += " AND memory_type=?"; countParams.push(input.memoryType); }
      if (input.projectId) { countSql += " AND project_id=?"; countParams.push(input.projectId); }
      if (input.search) { countSql += " AND (title LIKE ? OR content LIKE ?)"; countParams.push(`%${input.search}%`, `%${input.search}%`); }
      const countRows = await rawExecute(countSql, countParams);
      return { items, total: countRows[0]?.cnt || 0, page: input.page, pageSize: input.pageSize };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_knowledge WHERE id=? LIMIT 1", [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const r = rows[0];
      return { ...r, tags: typeof r.tags === "string" ? JSON.parse(r.tags) : (r.tags ?? []), is_active: !!r.is_active };
    }),

  upsert: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      title: z.string().min(1).max(500),
      content: z.string().min(1),
      memoryType: z.enum(["feedback","fact","project","reference"]).default("fact"),
      source: z.string().optional(),
      tags: z.array(z.string()).optional().default([]),
      projectId: z.string().optional(),
      confidence: z.number().min(0).max(1).optional().default(1.0),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = Date.now();
      if (input.id) {
        await rawExecute(
          "UPDATE emperor_knowledge SET title=?,content=?,memory_type=?,source=?,tags=?,project_id=?,confidence=?,updated_at=? WHERE id=? AND user_id=?",
          [input.title, input.content, input.memoryType, input.source||null, JSON.stringify(input.tags), input.projectId||null, input.confidence, now, input.id, ctx.user.id]
        );
        return { success: true, id: input.id };
      } else {
        const result = await rawExecute(
          "INSERT INTO emperor_knowledge (user_id,project_id,title,content,memory_type,source,tags,is_active,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)",
          [ctx.user.id, input.projectId||null, input.title, input.content, input.memoryType, input.source||null, JSON.stringify(input.tags), input.confidence, now, now]
        );
        return { success: true, id: (result as any).insertId };
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (isAdmin) {
        await rawExecute("UPDATE emperor_knowledge SET is_active=0 WHERE id=?", [input.id]);
      } else {
        await rawExecute("UPDATE emperor_knowledge SET is_active=0 WHERE id=? AND user_id=?", [input.id, ctx.user.id]);
      }
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await rawExecute(
      "SELECT memory_type, COUNT(*) as cnt FROM emperor_knowledge WHERE is_active=1 GROUP BY memory_type"
    );
    const result: Record<string, number> = { feedback: 0, fact: 0, project: 0, reference: 0 };
    for (const r of rows) { result[r.memory_type as string] = Number(r.cnt); }
    return result;
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Observability Router
// ─────────────────────────────────────────────────────────────────────────────

export const emperorObservabilityRouter = router({
  metrics: adminProcedure
    .input(z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      metricName: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return listAiOsMetrics(input || {});
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
  tools: emperorToolsRouter,
  agents: emperorAgentsRouter,
  scheduled: emperorScheduledRouter,
  diagnostics: emperorDiagnosticsRouter,
  knowledge: emperorKnowledgeRouter,
  observability: emperorObservabilityRouter,
});
