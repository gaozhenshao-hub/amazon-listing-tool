import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const requestId = `conversation-governance-verify-${Date.now()}`;
  const caller = emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
  const created = await caller.create({ title: "[系统验收] 对话高风险人审边界", initialMessage: "仅验证高风险计划审批，绝不执行任何能力或业务Tool。" });
  try {
    const plan = await caller.proposePlan({
      conversationId: created.conversationId,
      goal: "验证L3步骤的人审与串行执行边界",
      steps: [{
        title: "高风险规划Skill验收",
        description: "仅用于确认未审批步骤不可运行。",
        capabilityType: "skill",
        capabilitySlug: "emperor.conversation.plan",
        input: { goal: "不运行，仅验证审批边界。" },
        riskLevel: "L3",
        approvalRequired: false,
      }],
    });
    const before = await caller.get({ conversationId: created.conversationId });
    const beforeStep = before.steps.find((item: any) => item.planId === plan.planId);
    if (!beforeStep || beforeStep.riskLevel !== "L3" || Number(beforeStep.approvalRequired) !== 1 || beforeStep.approvalState !== "pending") {
      throw new Error("High-risk step was not normalized to mandatory human approval");
    }
    await caller.approvePlan({ conversationId: created.conversationId, planId: plan.planId });
    const approved = await caller.get({ conversationId: created.conversationId });
    const approvedStep = approved.steps.find((item: any) => item.stepId === beforeStep.stepId);
    if (!approvedStep || approvedStep.status !== "waiting_human" || approvedStep.approvalState !== "pending") {
      throw new Error("Approved plan did not keep high-risk step waiting for separate human approval");
    }
    let rejected = false;
    try {
      await caller.runStep({ conversationId: created.conversationId, stepId: beforeStep.stepId });
    } catch (error: any) {
      rejected = error?.code === "PRECONDITION_FAILED";
    }
    if (!rejected) throw new Error("Unapproved high-risk step was not rejected by the service layer");
    console.log(JSON.stringify({ conversationId: created.conversationId, planId: plan.planId, stepId: beforeStep.stepId, executionMode: plan.executionMode, riskLevel: beforeStep.riskLevel, approvalState: approvedStep.approvalState, status: approvedStep.status, runRejectedBeforeApproval: rejected }));
  } finally {
    await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [created.conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Conversation governance verification failed");
  process.exitCode = 1;
});
