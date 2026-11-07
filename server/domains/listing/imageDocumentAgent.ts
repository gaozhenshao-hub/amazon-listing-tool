import type { PlanningScope } from "./imagePlanningStore";
import { IMAGE_DOCUMENT_SKILL } from "./imageDocumentPrompt";
import {
  getAgentRun,
  recordAgentTemplateVersion,
} from "../ai_os/services/agentRunner";
import { ensureBusinessManagedRun } from "../ai_os/services/businessManagedAgent";
import { rawExecute } from "../ai_os/routerContext";
import type { EmperorAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
export const IMAGE_DOCUMENT_AGENT = "listing.images.document.flow.v1",
  IMAGE_DOCUMENT_NODE = "document";
export const imageDocumentDag: EmperorAgentDag = {
  version: "1.0.0",
  workflowType: "human_in_loop_dag",
  description: "套图文档、画面拆解与四步提示词，运营主动生成、对话调整并确认。",
  executionOwner: "image_document",
  businessRoute: "/listing/image-planning?projectId={{projectId}}",
  nodes: [
    {
      id: IMAGE_DOCUMENT_NODE,
      nodeType: "skill_node",
      label: "套图文档策划",
      skillSlug: IMAGE_DOCUMENT_SKILL,
      skillVersionPolicy: "snapshot",
      outputKey: "document",
      humanGate: true,
      required: true,
      scheduler: "manual",
      executionOwner: "image_document",
      x: 80,
      y: 80,
    },
  ],
  edges: [],
};
export async function ensureImageDocumentAgent(scope: PlanningScope) {
  await rawExecute(
    "INSERT IGNORE INTO emperor_agents(workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition) VALUES(NULL,?,?,?,'Listing','active','project','manual',3600,?)",
    [
      IMAGE_DOCUMENT_AGENT,
      "套图文档策划流程",
      imageDocumentDag.description,
      JSON.stringify(imageDocumentDag),
    ]
  );
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: IMAGE_DOCUMENT_AGENT,
    agentName: "套图文档策划流程",
    dag: imageDocumentDag,
    status: "released",
    releaseNotes: "构图参考、画面拆解和分步提示词",
    isDefault: true,
    rolloutPercent: 100,
  });
  const { detail } = await ensureBusinessManagedRun({
    agentSlug: IMAGE_DOCUMENT_AGENT,
    ...scope,
    requireMutable: true,
  });
  await imageDocumentAgentContext(detail.run.runId, scope);
  return { agentRunId: detail.run.runId, agentNodeId: IMAGE_DOCUMENT_NODE };
}
export async function imageDocumentAgentContext(
  runId: string,
  scope: PlanningScope
) {
  const agent = await getAgentRun(runId, undefined, true);
  if (
    agent.run.agentSlug !== IMAGE_DOCUMENT_AGENT ||
    agent.run.projectId !== scope.projectId ||
    agent.run.userId !== scope.userId ||
    agent.run.workspaceId !== scope.workspaceId ||
    !agent.dag.nodes.some(
      n => n.id === IMAGE_DOCUMENT_NODE && n.skillSlug === IMAGE_DOCUMENT_SKILL
    )
  )
    throw new Error("套图文档流程与当前项目不匹配");
  return {
    runId,
    dag: agent.dag,
    nodeId: IMAGE_DOCUMENT_NODE,
    userId: scope.userId,
  };
}
