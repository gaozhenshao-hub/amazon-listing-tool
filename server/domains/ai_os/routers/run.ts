import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../../_core/trpc";
import { invokeLLM } from "../../../_core/llm";
import { renderSkillTemplate } from "../services/skillRunner";
import { recordAiOsEvaluation, recordAiOsMetric } from "../services/observability";
import { generateRunId, getSkillBySlug, parseManifest, rawExecute, resolveModel } from "../routerContext";

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
        void recordAiOsEvaluation({
          entityType: "skill",
          entityId: runId,
          output: content,
          status: "succeeded",
          userId: ctx.user.id,
          skillSlug: input.skillSlug,
          metadata: {
            skillName: skill.name,
            modelId: modelInfo.modelId,
            provider: modelInfo.provider,
            inputTokens: inputTok,
            outputTokens: outputTok,
            durationMs,
            source: "emperor.run.run",
          },
        });
        void recordAiOsMetric({
          entityType: "skill",
          entityId: runId,
          metricName: "skill.succeeded",
          metricValue: durationMs,
          status: "succeeded",
          userId: ctx.user.id,
          skillSlug: input.skillSlug,
          metadata: { skillName: skill.name, modelId: modelInfo.modelId, provider: modelInfo.provider, source: "emperor.run.run" },
        });
        void recordAiOsMetric({
          entityType: "skill",
          entityId: runId,
          metricName: "skill.tokens",
          metricValue: inputTok + outputTok,
          status: "succeeded",
          userId: ctx.user.id,
          skillSlug: input.skillSlug,
          metadata: { inputTokens: inputTok, outputTokens: outputTok, source: "emperor.run.run" },
        });

        return { runId, status: "succeeded", content, durationMs, inputTokens: inputTok, outputTokens: outputTok };
      } catch (err: any) {
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        await rawExecute(
          "UPDATE emperor_skill_runs SET status=?,errorMessage=?,durationMs=?,completedAt=? WHERE runId=?",
          ["failed", err.message || "Unknown error", durationMs, completedAt, runId]
        );
        void recordAiOsEvaluation({
          entityType: "skill",
          entityId: runId,
          output: { error: err.message || "Unknown error" },
          status: "failed",
          userId: ctx.user.id,
          skillSlug: input.skillSlug,
          metadata: { skillName: skill.name, source: "emperor.run.run" },
        });
        void recordAiOsMetric({
          entityType: "skill",
          entityId: runId,
          metricName: "skill.failed",
          metricValue: durationMs,
          status: "failed",
          userId: ctx.user.id,
          skillSlug: input.skillSlug,
          metadata: { skillName: skill.name, error: err.message || "Unknown error", source: "emperor.run.run" },
        });
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
