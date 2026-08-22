import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const requestId = `conversation-low-risk-verify-${Date.now()}`;
  const caller = emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
  const created = await caller.create({
    title: "[系统验收] 对话低风险Skill与Trace",
    initialMessage: "仅验证受治理规划Skill、会话步骤和审计Trace回写；不读取或写入任何业务数据。",
  });
  try {
    const capabilities = await caller.capabilities();
    const planner = (capabilities.skills as any[]).find((skill) => skill.slug === "emperor.conversation.plan");
    if (!planner) throw new Error("Conversation planner skill is not visible in the governed capability catalog");

    const plan = await caller.proposePlan({
      conversationId: created.conversationId,
      goal: "验证低风险规划Skill的会话步骤与Trace回写",
      steps: [{
        title: "受控规划Skill验收",
        description: "仅生成测试计划文本，不调用业务Tool或MCP。",
        capabilityType: "skill",
        capabilitySlug: "emperor.conversation.plan",
        input: { goal: "仅输出一个低风险验收计划，不调用任何外部业务工具。", context: "系统验收上下文，无业务数据。" },
        riskLevel: "L1",
        approvalRequired: false,
      }],
    });
    await caller.approvePlan({ conversationId: created.conversationId, planId: plan.planId });
    const before = await caller.get({ conversationId: created.conversationId });
    const step = before.steps.find((item: any) => item.planId === plan.planId);
    if (!step || step.status !== "ready") throw new Error("Low-risk conversation step was not ready for governed execution");

    const execution = await caller.runStep({ conversationId: created.conversationId, stepId: step.stepId });
    const after = await caller.get({ conversationId: created.conversationId });
    const executedStep = after.steps.find((item: any) => item.stepId === step.stepId);
    const traceId = `conversation_step_${step.stepId}`;
    const [traceRows, eventRows, manifestRows] = await Promise.all([
      rawExecute("SELECT status,rootRunType FROM emperor_run_traces WHERE traceId=?", [traceId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
      rawExecute("SELECT manifestId FROM emperor_context_manifests WHERE traceId=?", [traceId]),
    ]);
    const eventTypes = eventRows.map((row: any) => row.eventType);
    if (executedStep?.status !== "succeeded" || !execution.skillRunId || traceRows[0]?.status !== "completed" || traceRows[0]?.rootRunType !== "conversation_step" || !eventTypes.includes("conversation.step.started") || !eventTypes.includes("conversation.step.succeeded") || manifestRows.length !== 1) {
      throw new Error("Conversation low-risk execution did not produce the required step, Skill Run, or Run Ledger Trace evidence");
    }
    console.log(JSON.stringify({ conversationId: created.conversationId, stepId: step.stepId, skillRunId: execution.skillRunId, traceId, traceStatus: traceRows[0].status, eventTypes, contextManifestCount: manifestRows.length }));
  } finally {
    await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [created.conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Conversation low-risk verification failed");
  process.exitCode = 1;
});
