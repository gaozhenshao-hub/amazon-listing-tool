import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const requestId = `conversation-plan-context-verify-${Date.now()}`;
  const caller = emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
  const created = await caller.create({ title: "[系统验收] 规划上下文编译", initialMessage: "仅验证规划上下文与Trace，不提交或运行计划。" });
  try {
    const suggestion = await caller.suggestPlan({ conversationId: created.conversationId, goal: "使用已登记能力生成只读运营分析候选计划，不执行任何Tool。" });
    const catalog = await caller.capabilities();
    const allowed = new Set([
      ...(catalog.skills as any[]).map((item) => `skill:${item.slug}`),
      ...(catalog.agents as any[]).map((item) => `agent:${item.slug}`),
      ...(catalog.tools as any[]).map((item) => `tool:${item.slug}`),
    ]);
    const allAllowed = suggestion.steps.every((item: any) => allowed.has(`${item.capabilityType}:${item.capabilitySlug}`));
    const [traceRows, eventRows, manifestRows] = await Promise.all([
      rawExecute("SELECT status,rootRunType FROM emperor_run_traces WHERE traceId=?", [suggestion.skillRunId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [suggestion.skillRunId]),
      rawExecute("SELECT manifest FROM emperor_context_manifests WHERE traceId=?", [suggestion.skillRunId]),
    ]);
    const rawManifest = manifestRows[0]?.manifest;
    const manifest = rawManifest ? (typeof rawManifest === "string" ? JSON.parse(rawManifest) : rawManifest) : null;
    if (!allAllowed || traceRows[0]?.rootRunType !== "skill_run" || traceRows[0]?.status !== "completed" || !eventRows.some((row: any) => row.eventType === "conversation.plan.context_compiled") || manifest?.schema !== "conversation.context_package" || manifest?.policy?.name !== "conversation.context_compiler") {
      throw new Error("Conversation planner did not produce governed candidates with a compiled context Trace");
    }
    console.log(JSON.stringify({ conversationId: created.conversationId, skillRunId: suggestion.skillRunId, stepCount: suggestion.steps.length, allAllowed, traceStatus: traceRows[0].status, contextPolicy: manifest.policy.name }));
  } finally {
    await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [created.conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Conversation planner context verification failed");
  process.exitCode = 1;
});
