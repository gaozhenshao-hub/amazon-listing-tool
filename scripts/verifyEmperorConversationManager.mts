import { emperorConversationsRouter } from "../server/domains/ai_os/routers/conversations";
import { rawExecute } from "../server/domains/ai_os/routerContext";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const requestId = `conversation-manager-verify-${Date.now()}`;
  const caller = emperorConversationsRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  });
  const created = await caller.create({ title: "[系统验收] 通用对话任务管理器", initialMessage: "验证受治理对话、附件与计划编排；不执行任何能力。" });
  try {
    const capabilities = await caller.capabilities();
    const skill = capabilities.skills[0] as any;
    if (!skill?.slug) throw new Error("No governed skill is available for conversation verification");
    const attachment = await caller.uploadAttachment({
      conversationId: created.conversationId,
      fileName: "conversation-verification.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("受控对话附件验收文本", "utf8").toString("base64"),
      contextPolicy: "extracted_text",
    });
    const candidates = await caller.knowledgeCandidates({ sourceKind: "all", limit: 5 });
    const plan = await caller.proposePlan({
      conversationId: created.conversationId,
      goal: "验证对话任务治理数据流",
      steps: [{ title: skill.name || skill.slug, description: "仅提交计划，不运行能力", capabilityType: "skill", capabilitySlug: skill.slug, riskLevel: "L1", approvalRequired: false }],
    });
    const detail = await caller.get({ conversationId: created.conversationId });
    console.log(JSON.stringify({ conversationId: created.conversationId, attachmentRegistered: Boolean(attachment.attachmentId), governedSkillCount: capabilities.skills.length, knowledgeCandidateCount: candidates.length, proposedPlanId: plan.planId, planStatus: detail.plans[0]?.status, stepStatus: detail.steps[0]?.status }));
  } finally {
    await rawExecute("UPDATE emperor_conversations SET status='archived' WHERE conversationId=?", [created.conversationId]);
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "Conversation manager verification failed"); process.exitCode = 1; });
