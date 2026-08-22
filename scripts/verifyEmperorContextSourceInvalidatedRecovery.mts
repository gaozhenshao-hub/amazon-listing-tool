import { randomUUID } from "node:crypto";
import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { recordContextSourceProvenance, invalidateContextSource } from "../server/domains/ai_os/services/contextProvenance";
import { createExecutionStateSnapshot } from "../server/domains/ai_os/services/executionLifecycle";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function createCaller() {
  const requestId = `context-invalidated-recovery-verify-${Date.now()}`;
  return emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
}

async function prepareArchivedFailedStep(caller: any) {
  const created = await caller.create({
    title: "[系统验收] 来源失效恢复阻断",
    initialMessage: "仅验证来源失效恢复阻断；不执行模型、Skill、Agent、Tool或MCP。",
  });
  const plan = await caller.proposePlan({
    conversationId: created.conversationId,
    goal: "验证失效上下文只能要求重新编译和人工确认",
    steps: [{
      title: "仅恢复治理验证",
      description: "系统验收步骤；不会进入执行路径。",
      capabilityType: "skill",
      capabilitySlug: "emperor.conversation.plan",
      input: { verification: "context-source-invalidated" },
      riskLevel: "L1",
      approvalRequired: false,
    }],
  });
  await caller.approvePlan({ conversationId: created.conversationId, planId: plan.planId });
  const detail = await caller.get({ conversationId: created.conversationId });
  const step = detail.steps.find((item: any) => item.planId === plan.planId);
  if (!step) throw new Error("System verification step was not created");
  const traceId = `conversation_step_${step.stepId}`;
  const stateVersion = 2;
  await ensureRunTrace({
    runId: traceId,
    rootRunType: "conversation_step",
    workspaceId: 1,
    userId: user.id,
    metadata: { systemTest: true, verification: "context-source-invalidated" },
  });
  await rawExecute(
    "UPDATE emperor_conversation_plan_steps SET status='failed',stateVersion=?,traceId=? WHERE stepId=?",
    [stateVersion, traceId, step.stepId],
  );
  await createExecutionStateSnapshot({
    workspaceId: 1,
    traceId,
    targetType: "conversation_step",
    targetId: step.stepId,
    stateVersion,
    planId: plan.planId,
    planVersion: Number(plan.version),
    capabilityType: "skill",
    capabilitySlug: "emperor.conversation.plan",
    approvalState: step.approvalState,
    snapshot: { systemTest: true, status: "failed", sourceInvalidationVerification: true },
    createdBy: user.id,
  });
  return { conversationId: created.conversationId, planId: plan.planId, stepId: step.stepId, traceId, stateVersion };
}

async function main() {
  const caller = await createCaller();
  const artifactKey = `system-test-source-${randomUUID().replace(/-/g, "")}`;
  let conversationId: string | null = null;
  try {
    const prepared = await prepareArchivedFailedStep(caller);
    conversationId = prepared.conversationId;
    await recordContextSourceProvenance({
      manifestId: `system_test_manifest_${randomUUID().replace(/-/g, "")}`,
      traceId: prepared.traceId,
      manifest: { context: { attachments: [{ attachmentId: artifactKey, artifactId: artifactKey, mimeType: "text/plain", contextPolicy: "summary_only" }] } },
    });
    const invalidation = await invalidateContextSource({
      sourceType: "attachment",
      sourceKey: artifactKey,
      reason: "system_test_context_source_invalidated_recovery",
      userId: user.id,
    });
    if (invalidation.invalidated !== 1) throw new Error(`Expected one invalidated source, received ${invalidation.invalidated}`);

    let rejected = false;
    try {
      await caller.recoverStep({
        conversationId: prepared.conversationId,
        stepId: prepared.stepId,
        expectedStateVersion: prepared.stateVersion,
      });
    } catch (error: any) {
      rejected = error?.code === "PRECONDITION_FAILED" && String(error?.message || "").includes("关联上下文来源已失效");
    }
    if (!rejected) throw new Error("Invalidated context source did not reject recovery");

    const [recoveryRows, stepRows, eventRows] = await Promise.all([
      rawExecute("SELECT status,reasonCode FROM emperor_execution_recovery_requests WHERE targetId=? ORDER BY id DESC LIMIT 1", [prepared.stepId]),
      rawExecute("SELECT status,stateVersion,skillRunId,agentRunId,toolRunId FROM emperor_conversation_plan_steps WHERE stepId=? LIMIT 1", [prepared.stepId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [prepared.traceId]),
    ]);
    const recovery = recoveryRows[0] as any;
    const step = stepRows[0] as any;
    const eventTypes = eventRows.map((row: any) => row.eventType);
    const executionEvents = ["conversation.step.started", "conversation.step.succeeded", "conversation.step.dispatched"];
    if (recovery?.status !== "rejected" || recovery?.reasonCode !== "context_source_invalidated") {
      throw new Error("Recovery rejection record is incomplete");
    }
    if (step?.status !== "failed" || Number(step?.stateVersion) !== prepared.stateVersion || step?.skillRunId || step?.agentRunId || step?.toolRunId) {
      throw new Error("Blocked recovery changed step state or created an execution run");
    }
    if (!eventTypes.includes("context.source_invalidated") || !eventTypes.includes("lifecycle.recovery_requested") || !eventTypes.includes("lifecycle.recovery_rejected") || eventTypes.some((eventType: string) => executionEvents.includes(eventType))) {
      throw new Error("Ledger evidence is incomplete or includes an execution event");
    }
    console.log(JSON.stringify({
      conversationId: prepared.conversationId,
      traceId: prepared.traceId,
      recovery,
      eventTypes,
      verification: "context-source-invalidated-rejected-no-model-skill-agent-tool-mcp-executed",
    }));
  } finally {
    if (conversationId) await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Context source invalidated recovery verification failed");
  process.exit(1);
});
