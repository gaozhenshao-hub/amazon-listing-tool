import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { invokeLLM } from "../../../_core/llm";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";
import { rawExecute } from "../routerContext";

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
        const apiUrl = `${baseUrl.replace(/\/$/, "")}/models`;
        const response = await safeHttpRequest(apiUrl, {
          headers: { Authorization: `Bearer ${model.apiKeyRef || ""}`, "Content-Type": "application/json" },
          timeoutMs: 10_000,
          maxResponseBytes: 2 * 1024 * 1024,
          allowedHosts: [new URL(apiUrl).hostname],
          allowPrivateNetwork: process.env.MODEL_PROVIDER_ALLOW_PRIVATE_NETWORK === "true",
          auditContext: {
            workspaceId: model.workspaceId ?? null,
            operation: "ai_os.model.health_check",
          },
        });
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
