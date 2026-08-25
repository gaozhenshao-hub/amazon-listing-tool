import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

function callerFor(requestId: string) {
  return emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
}

async function createApprovedPlan(caller: ReturnType<typeof callerFor>, title: string) {
  const created = await caller.create({ title, initialMessage: "系统验收：仅验证Plan恢复和补偿审计，不执行步骤、模型、Tool或MCP。" });
  const plan = await caller.proposePlan({
    conversationId: created.conversationId,
    goal: "验证受治理Plan恢复协议",
    steps: [{ title: "不执行的L1验证步骤", capabilityType: "skill", capabilitySlug: "emperor.conversation.plan", input: { systemVerification: true }, riskLevel: "L1", approvalRequired: false }],
  });
  await caller.approvePlan({ conversationId: created.conversationId, planId: plan.planId });
  const detail = await caller.get({ conversationId: created.conversationId });
  const approvedPlan = detail.plans.find((item: any) => item.planId === plan.planId);
  if (!approvedPlan || approvedPlan.status !== "approved") throw new Error("Plan was not approved for recovery verification");
  return { conversationId: created.conversationId, planId: plan.planId, stateVersion: Number(approvedPlan.stateVersion || 0), stepId: detail.steps.find((item: any) => item.planId === plan.planId)?.stepId };
}

async function main() {
  const caller = callerFor(`conversation-plan-recovery-verify-${Date.now()}`);
  const createdIds: string[] = [];
  try {
    const safe = await createApprovedPlan(caller, "[系统验收] 未执行Plan恢复");
    createdIds.push(safe.conversationId);
    const restored = await caller.recoverPlan({ conversationId: safe.conversationId, planId: safe.planId, expectedStateVersion: safe.stateVersion });
    const safeDetail = await caller.get({ conversationId: safe.conversationId });
    const restoredPlan = safeDetail.plans.find((item: any) => item.planId === safe.planId);
    const restoredStep = safeDetail.steps.find((item: any) => item.planId === safe.planId);
    if (!restored.success || restoredPlan?.status !== "proposed" || Number(restoredPlan?.stateVersion) !== safe.stateVersion + 1 || restoredStep?.status !== "pending") {
      throw new Error("Unexecuted Plan did not return to proposed/pending without execution");
    }

    const guarded = await createApprovedPlan(caller, "[系统验收] 已执行Plan补偿审计");
    createdIds.push(guarded.conversationId);
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status='succeeded' WHERE stepId=?", [guarded.stepId]);
    let compensationRejected = false;
    try {
      await caller.recoverPlan({ conversationId: guarded.conversationId, planId: guarded.planId, expectedStateVersion: guarded.stateVersion });
    } catch (error) {
      compensationRejected = String(error).includes("补偿审计");
    }
    const traceId = `conversation_plan_${guarded.planId}`;
    const [requestRows, eventRows] = await Promise.all([
      rawExecute("SELECT status,reasonCode FROM emperor_execution_recovery_requests WHERE targetType='conversation_plan' AND targetId=? ORDER BY id DESC LIMIT 1", [guarded.planId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
    ]);
    if (!compensationRejected || requestRows[0]?.status !== "compensation_required" || requestRows[0]?.reasonCode !== "PLAN_EXECUTION_OR_RISK_REVIEW_REQUIRED" || !eventRows.some((row: any) => row.eventType === "lifecycle.compensation_required")) {
      throw new Error("Executed Plan did not produce the required compensation audit evidence");
    }
    console.log(JSON.stringify({ verification: "passed", safePlanId: safe.planId, recoveredStateVersion: restored.stateVersion, guardedPlanId: guarded.planId, compensationStatus: requestRows[0].status, noExternalExecution: true }));
  } finally {
    for (const conversationId of createdIds) await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Conversation Plan recovery verification failed");
  process.exitCode = 1;
});
