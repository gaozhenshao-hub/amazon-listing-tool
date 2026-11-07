import type { PlanningScope } from "./imagePlanningStore";
import { RESEARCH_SKILLS } from "./researchPrompts";
import {
  getAgentRun,
  recordAgentTemplateVersion,
} from "../ai_os/services/agentRunner";
import { ensureBusinessManagedRun } from "../ai_os/services/businessManagedAgent";
import { rawExecute } from "../ai_os/routerContext";
import type { EmperorAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
export async function ensureResearchAgent(
  scope: PlanningScope,
  section: keyof typeof RESEARCH_SKILLS
) {
  const slug = "listing.research." + section + (section==="questions"?".v3":section==="planning"?".v2":""),
    skill = RESEARCH_SKILLS[section],
    name = {
      selling: "卖点梳理",
      reviews: "评论分析",
      questions: "买家问题整理",
      planning: "图片策划对话",
    }[section];
  const dag: EmperorAgentDag = {
    version: section==="questions"||section==="planning"?"2.0.0":"1.0.0",
    workflowType: "human_in_loop_dag",
    description: name,
    executionOwner: "research",
    businessRoute:
      section === "planning"
        ? "/listing/image-planning?projectId={{projectId}}"
        : "/listing/aggregation?projectId={{projectId}}",
    nodes: [
      {
        id: section,
        nodeType: "skill_node",
        label: name,
        skillSlug: skill,
        skillVersionPolicy: "snapshot",
        outputKey: section,
        humanGate: section !== "planning",
        required: true,
        scheduler: "manual",
        executionOwner: "research",
        x: 80,
        y: 80,
      },
    ],
    edges: [],
  };
  await rawExecute(
    "INSERT IGNORE INTO emperor_agents (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition) VALUES (NULL,?,?,?,'Listing','active','project','manual',900,?)",
    [slug, name, name, JSON.stringify(dag)]
  );
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: slug,
    agentName: name,
    dag,
    status: "released",
    releaseNotes: name,
    isDefault: true,
    rolloutPercent: 100,
  });
  const { detail } = await ensureBusinessManagedRun({
    agentSlug: slug,
    ...scope,
    requireMutable: true,
  });
  return { agentRunId: detail.run.runId, agentNodeId: section };
}
export async function researchAgentContext(
  scope: PlanningScope,
  runId: string,
  section: keyof typeof RESEARCH_SKILLS
) {
  const detail = await getAgentRun(runId, undefined, true);
  if (
    detail.run.agentSlug !== "listing.research." + section + (section==="questions"?".v3":section==="planning"?".v2":"") ||
    detail.run.projectId !== scope.projectId ||
    detail.run.workspaceId !== scope.workspaceId ||
    detail.run.userId !== scope.userId ||
    !detail.dag.nodes.some(
      n => n.id === section && n.skillSlug === RESEARCH_SKILLS[section]
    )
  )
    throw new Error("当前分析流程与项目不匹配");
  return { runId, dag: detail.dag, nodeId: section, userId: scope.userId };
}
