import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { invokeLLM } from "../../../_core/llm";
import { rawExecute } from "../routerContext";

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
