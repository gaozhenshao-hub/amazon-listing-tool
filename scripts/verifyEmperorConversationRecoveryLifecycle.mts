import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { createExecutionStateSnapshot } from "../server/domains/ai_os/services/executionLifecycle";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function createCaller() {
  const requestId = `conversation-recovery-verify-${Date.now()}`;
  return emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
}

async function prepareFailedStep(caller: any, input: { title: string; riskLevel: "L1" | "L3"; stateVersion: number }) {
  const created = await caller.create({ title: input.title, initialMessage: "仅验证P1恢复治理；不执行任何能力。" });
  const plan = await caller.proposePlan({
    conversationId: created.conversationId,
    goal: "P1恢复治理验收",
    steps: [{
      title: input.title,
      description: "系统归档验收，不调用模型、Agent、Tool或MCP。",
      capabilityType: "skill",
      capabilitySlug: "emperor.conversation.plan",
      input: { goal: "仅验证恢复状态机" },
      riskLevel: input.riskLevel,
      approvalRequired: input.riskLevel === "L3",
    }],
  });
  await caller.approvePlan({ conversationId: created.conversationId, planId: plan.planId });
  const detail = await caller.get({ conversationId: created.conversationId });
  const step = detail.steps.find((item: any) => item.planId === plan.planId);
  if (!step) throw new Error("Verification step was not created");
  const traceId = `conversation_step_${step.stepId}`;
  await ensureRunTrace({ runId: traceId, rootRunType: "conversation_step", workspaceId: 1, userId: user.id, metadata: { verification: true } });
  await rawExecute("UPDATE emperor_conversation_plan_steps SET status='failed',stateVersion=?,traceId=? WHERE stepId=?", [input.stateVersion, traceId, step.stepId]);
  const snapshot = await createExecutionStateSnapshot({
    workspaceId: 1,
    traceId,
    targetType: "conversation_step",
    targetId: step.stepId,
    stateVersion: input.stateVersion,
    planId: plan.planId,
    planVersion: Number(plan.version),
    capabilityType: "skill",
    capabilitySlug: "emperor.conversation.plan",
    approvalState: step.approvalState,
    snapshot: { verification: true, status: "failed", riskLevel: input.riskLevel, stepId: step.stepId },
    createdBy: user.id,
  });
  return { conversationId: created.conversationId, planId: plan.planId, planVersion: plan.version, stepId: step.stepId, traceId, snapshotId: snapshot.snapshotId, stateVersion: input.stateVersion };
}

async function main() {
  const caller = await createCaller();
  const archiveIds: string[] = [];
  try {
    const low = await prepareFailedStep(caller, { title: "[系统验收] L1幂等恢复", riskLevel: "L1", stateVersion: 2 });
    archiveIds.push(low.conversationId);
    const first = await caller.recoverStep({ conversationId: low.conversationId, stepId: low.stepId, expectedStateVersion: low.stateVersion });
    const replay = await caller.recoverStep({ conversationId: low.conversationId, stepId: low.stepId, expectedStateVersion: low.stateVersion });
    if (!first.success || first.replayed || !replay.success || !replay.replayed) throw new Error("Low-risk recovery was not idempotent");
    let versionConflict = false;
    try {
      await caller.recoverStep({ conversationId: low.conversationId, stepId: low.stepId, expectedStateVersion: low.stateVersion + 1, idempotencyKey: `different-${Date.now()}-version-conflict` });
    } catch (error: any) {
      versionConflict = error?.code === "PRECONDITION_FAILED";
    }
    if (!versionConflict) throw new Error("Stale or invalid recovery version was not rejected");

    const high = await prepareFailedStep(caller, { title: "[系统验收] L3补偿审计", riskLevel: "L3", stateVersion: 4 });
    archiveIds.push(high.conversationId);
    let compensationRejected = false;
    try {
      await caller.recoverStep({ conversationId: high.conversationId, stepId: high.stepId, expectedStateVersion: high.stateVersion });
    } catch (error: any) {
      compensationRejected = error?.code === "PRECONDITION_FAILED";
    }
    if (!compensationRejected) throw new Error("High-risk recovery was not sent to compensation review");

    const [lowEvents, highEvents, lowRecoveryRows, highRecoveryRows, planSnapshotRows] = await Promise.all([
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [low.traceId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [high.traceId]),
      rawExecute("SELECT status FROM emperor_execution_recovery_requests WHERE targetId=? ORDER BY id ASC", [low.stepId]),
      rawExecute("SELECT status,reasonCode FROM emperor_execution_recovery_requests WHERE targetId=? ORDER BY id ASC", [high.stepId]),
      rawExecute("SELECT stateVersion FROM emperor_execution_state_snapshots WHERE targetType='conversation_plan' AND targetId=?", [low.planId]),
    ]);
    const lowEventTypes = lowEvents.map((row: any) => row.eventType);
    const highEventTypes = highEvents.map((row: any) => row.eventType);
    if (!lowEventTypes.includes("lifecycle.recovery_requested") || !lowEventTypes.includes("lifecycle.recovery_completed") || !lowRecoveryRows.some((row: any) => row.status === "completed")) {
      throw new Error("Low-risk recovery lifecycle evidence is incomplete");
    }
    if (!highEventTypes.includes("lifecycle.compensation_required") || !highRecoveryRows.some((row: any) => row.status === "compensation_required" && row.reasonCode === "human_compensation_required")) {
      throw new Error("High-risk compensation lifecycle evidence is incomplete");
    }
    if (!planSnapshotRows.some((row: any) => Number(row.stateVersion) === Number(low.planVersion))) {
      throw new Error("Plan approval did not persist its versioned execution snapshot");
    }
    console.log(JSON.stringify({ low, first, replay, high, lowEventTypes, highEventTypes, planSnapshotVersion: low.planVersion, verification: "no-model-agent-tool-mcp-executed" }));
  } finally {
    for (const conversationId of archiveIds) await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Conversation recovery lifecycle verification failed");
  process.exitCode = 1;
});
