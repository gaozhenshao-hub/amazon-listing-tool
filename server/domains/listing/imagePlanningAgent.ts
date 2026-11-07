import type { PlanningScope } from "./imagePlanningStore";
import { IMAGE_PLANNING_SKILL } from "./imagePlanningPrompt";
import { getAgentRun, recordAgentTemplateVersion } from "../ai_os/services/agentRunner";
import { ensureBusinessManagedRun } from "../ai_os/services/businessManagedAgent";
import { rawExecute } from "../ai_os/routerContext";
import type { EmperorAgentDag } from "../ai_os/services/agentRunner/runtimeCore";

export const IMAGE_PLANNING_AGENT = "listing.images.planning.v3";
export const IMAGE_PLANNING_NODE = "outline";
export const imagePlanningDag: EmperorAgentDag = {
  version: "3.0.0",
  workflowType: "human_in_loop_dag",
  description: "图片策划大师结合三类上游资料生成画面大纲，人工调整并确认；参考图由人工选择。",
  executionOwner: "image_planning",
  businessRoute: "/listing/image-planning?projectId={{projectId}}",
  nodes: [{ id: IMAGE_PLANNING_NODE, nodeType: "skill_node", label: "图片大纲规划", skillSlug: IMAGE_PLANNING_SKILL, skillVersionPolicy: "snapshot", outputKey: "outline", humanGate: true, required: true, scheduler: "manual", executionOwner: "image_planning", businessRoute: "/listing/image-planning?projectId={{projectId}}", x: 80, y: 80 }],
  edges: [],
};

export async function ensureImagePlanningAgentRun(scope: PlanningScope) {
  await rawExecute(
    `INSERT IGNORE INTO emperor_agents (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
     VALUES (NULL,?, ?, ?, 'Listing','active','project','manual',900,?)`,
    [IMAGE_PLANNING_AGENT, "图片策划流程", imagePlanningDag.description, JSON.stringify(imagePlanningDag)],
  );
  await recordAgentTemplateVersion({ workspaceId: null, agentSlug: IMAGE_PLANNING_AGENT, agentName: "图片策划流程", dag: imagePlanningDag, status: "released", releaseNotes: "图片大纲与人工参考图选择", isDefault: true, rolloutPercent: 100 });
  const { detail } = await ensureBusinessManagedRun({ agentSlug: IMAGE_PLANNING_AGENT, ...scope, requireMutable: true });
  await imagePlanningAgentContext(detail.run.runId, scope);
  return { agentRunId: detail.run.runId, agentNodeId: IMAGE_PLANNING_NODE };
}

export async function imagePlanningAgentContext(runId: string, scope: PlanningScope) {
  const agent = await getAgentRun(runId, undefined, true);
  if (agent.run.agentSlug !== IMAGE_PLANNING_AGENT || agent.run.projectId !== scope.projectId || agent.run.workspaceId !== scope.workspaceId || agent.run.userId !== scope.userId || !agent.dag.nodes.some(n => n.id === IMAGE_PLANNING_NODE && n.skillSlug === IMAGE_PLANNING_SKILL))
    throw new Error("图片策划流程与当前项目不匹配");
  return { runId, dag: agent.dag, nodeId: IMAGE_PLANNING_NODE, userId: scope.userId };
}
