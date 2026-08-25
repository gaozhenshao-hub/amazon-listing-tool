import { runEmperorSkill } from "../server/services/emperorSkillRunner";
import { parseConversationStructuredJson } from "../server/domains/ai_os/services/conversationPolicy";

async function main() {
  const catalog = [
    { capabilityType: "skill", slug: "video.section.plan", name: "视频段落规划", description: "规划视频章节结构", riskLevel: "L0" },
    { capabilityType: "tool", slug: "internal.lingxing.read", name: "领星只读数据源", description: "读取受限运营数据", riskLevel: "L1" },
  ];
  const result = await runEmperorSkill<string>({
    skillSlug: "emperor.conversation.plan",
    userId: 1,
    workspaceId: 1,
    context: JSON.stringify({ userGoal: "根据附件规划一个只读运营数据分析任务", attachments: [], capabilityCatalog: catalog }),
    variables: { capabilityCatalog: catalog },
    migrationSource: "emperor.conversations.verification",
    validate: (content) => content,
  });
  const output = parseConversationStructuredJson(result.content, { steps: [] });
  const steps = Array.isArray(output.steps) ? output.steps : [];
  console.log(JSON.stringify({ skillRunId: result.runId, stepCount: steps.length, risks: steps.map((step: any) => step.riskLevel), capabilitySlugs: steps.map((step: any) => step.capabilitySlug) }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "Conversation planner verification failed"); process.exitCode = 1; });
