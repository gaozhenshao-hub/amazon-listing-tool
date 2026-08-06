/**
 * Keyword Workflow ↔ Agent DAG Bridge
 *
 * 将关键词工作台的流水线步骤同步到 Emperor Agent DAG 系统。
 *
 * DAG 节点映射（keyword.analysis.workflow）：
 * - K0 (input_node)                      ← 关键词导入
 * - K1 (keyword.traffic.classify)        ← aiClassifyTrafficCompetition
 * - K2 (keyword.semantic.filter)         ← aiSemanticFilter
 * - K3 (keyword.scene.tag)               ← aiSceneTag
 * - K4 (keyword.root.classify)           ← aiRootClassify
 * - K5 (keyword.strategy.matrix)         ← aiStrategyMatrix
 * - K6 (keyword.listing.layout)          ← aiListingLayout
 * - output (output_node)                 ← runFullPipeline 完成后
 */

import {
  ensureBusinessManagedRun,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
} from "../ai_os/services/businessManagedAgent";
import { normalizeAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { getAgentBySlug } from "../ai_os/services/agentRunner/templateGovernance";

export const KEYWORD_WORKFLOW_AGENT_SLUG = "keyword.analysis.workflow";

// Step key → DAG node ID mapping
const STEP_NODE_MAP: Record<string, string> = {
  "trafficClassify": "K1",
  "semanticFilter": "K2",
  "sceneTag": "K3",
  "rootClassify": "K4",
  "strategyMatrix": "K5",
  "listingLayout": "K6",
};

async function getKeywordDag() {
  const agent = await getAgentBySlug(KEYWORD_WORKFLOW_AGENT_SLUG);
  if (!agent?.dagDefinition) return null;
  return normalizeAgentDag(agent.dagDefinition as any);
}

/**
 * Ensure Agent Run exists for the keyword workflow.
 */
export async function ensureKeywordAgentRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}): Promise<string | null> {
  try {
    const { detail } = await ensureBusinessManagedRun({
      agentSlug: KEYWORD_WORKFLOW_AGENT_SLUG,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      requireMutable: true,
    });
    return (detail?.run as any)?.runId ?? null;
  } catch (err) {
    console.warn("[KeywordBridge] Failed to ensure Agent Run:", err);
    return null;
  }
}

/**
 * Sync a single pipeline step completion to the Agent DAG.
 * Marks the node as waiting_human (step complete, pending user review).
 */
export async function syncKeywordStepToAgent(input: {
  stepKey: keyof typeof STEP_NODE_MAP;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  output?: unknown;
}): Promise<string | null> {
  const nodeId = STEP_NODE_MAP[input.stepKey];
  if (!nodeId) return null;

  try {
    const runId = await ensureKeywordAgentRun({
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    if (!runId) return null;

    const dag = await getKeywordDag();
    if (!dag) return runId;

    await markBusinessManagedNodeWaitingHuman({
      runId,
      dag,
      nodeId,
      output: input.output ?? null,
      userId: input.userId,
      metadata: {
        source: "keyword_workbench_step",
        stepKey: input.stepKey,
        projectId: input.projectId,
      },
    });
    return runId;
  } catch (err) {
    console.warn(`[KeywordBridge] syncStep(${input.stepKey}) failed:`, err);
    return null;
  }
}

/**
 * Sync full pipeline completion to the Agent DAG.
 * Marks all pipeline nodes as confirmed and the output node as confirmed.
 * Called after runFullPipeline completes successfully.
 */
export async function syncFullPipelineToAgent(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  pipelineResult: {
    trafficCompetition?: unknown;
    filter?: unknown;
    tag?: unknown;
    classify?: unknown;
    matrix?: unknown;
    listingLayout?: unknown;
  };
}): Promise<void> {
  try {
    const runId = await ensureKeywordAgentRun({
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    if (!runId) return;

    const dag = await getKeywordDag();
    if (!dag) return;

    // Mark each pipeline step as confirmed in order
    const steps: Array<{ nodeId: string; output: unknown }> = [
      { nodeId: "K1", output: input.pipelineResult.trafficCompetition },
      { nodeId: "K2", output: input.pipelineResult.filter },
      { nodeId: "K3", output: input.pipelineResult.tag },
      { nodeId: "K4", output: input.pipelineResult.classify },
      { nodeId: "K5", output: input.pipelineResult.matrix },
      { nodeId: "K6", output: input.pipelineResult.listingLayout },
    ];

    for (const step of steps) {
      try {
        await markBusinessManagedNodeConfirmed({
          runId,
          dag,
          nodeId: step.nodeId,
          output: step.output ?? null,
          userEdit: step.output ?? null,
          userId: input.userId,
          metadata: {
            source: "keyword_full_pipeline",
            projectId: input.projectId,
          },
        });
      } catch {
        // Continue even if individual node sync fails
      }
    }

    // Mark output node as confirmed
    try {
      await markBusinessManagedNodeConfirmed({
        runId,
        dag,
        nodeId: "output",
        output: input.pipelineResult,
        userEdit: input.pipelineResult,
        userId: input.userId,
        metadata: {
          source: "keyword_full_pipeline_complete",
          projectId: input.projectId,
        },
      });
    } catch { /* output node sync failure is non-fatal */ }
  } catch (err) {
    console.warn("[KeywordBridge] syncFullPipeline failed:", err);
  }
}
