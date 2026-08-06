/**
 * Image Workflow ↔ Agent DAG Bridge
 *
 * 将图片工作流的业务确认事件同步到 Emperor Agent DAG 系统，
 * 使 Agent 画布能实时反映业务页面的确认状态。
 *
 * 设计原则：
 * - 所有 Agent 集成调用均为 best-effort（失败不影响业务流程）
 * - 每个 confirmStepN 对应 DAG 中的 step{N}_skill + step{N}_review 两个节点
 * - 先将 skill 节点标记为 waiting_human，再将 review 节点标记为 confirmed
 */

import {
  ensureBusinessManagedRun,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
} from "../ai_os/services/businessManagedAgent";
import { normalizeAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { getAgentBySlug } from "../ai_os/services/agentRunner/templateGovernance";

const IMAGE_WORKFLOW_AGENT_SLUG = "image.workflow";

// Step N → DAG node IDs mapping
const STEP_NODE_MAP: Record<number, { skillNode: string; reviewNode: string }> = {
  0: { skillNode: "step0_skill", reviewNode: "step0_review" },
  1: { skillNode: "step1_skill", reviewNode: "step1_review" },
  2: { skillNode: "step2_skill", reviewNode: "step2_review" },
  3: { skillNode: "step3_skill", reviewNode: "step3_review" },
  4: { skillNode: "step4_skill", reviewNode: "step4_review" },
  5: { skillNode: "step5_skill", reviewNode: "step5_review" },
};

/**
 * Ensure Agent Run exists for the image workflow session.
 * Called when creating a new session.
 */
export async function ensureImageWorkflowAgentRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}): Promise<string | null> {
  try {
    const { detail } = await ensureBusinessManagedRun({
      agentSlug: IMAGE_WORKFLOW_AGENT_SLUG,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      requireMutable: true,
    });
    return (detail?.run as any)?.runId ?? null;
  } catch (err) {
    console.warn("[ImageWorkflowBridge] Failed to ensure Agent Run:", err);
    return null;
  }
}

/**
 * Sync a step confirmation to the Agent DAG.
 * Called after each confirmStepN succeeds.
 *
 * Flow:
 * 1. Ensure Agent Run exists (idempotent)
 * 2. Mark skill node as waiting_human (if not already)
 * 3. Mark review node as confirmed with the user's edit data
 */
export async function syncStepConfirmToAgent(input: {
  agentRunId: string | null | undefined;
  stepNumber: number;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  userEdit?: unknown;
  aiResult?: unknown;
}): Promise<void> {
  const nodes = STEP_NODE_MAP[input.stepNumber];
  if (!nodes) return;

  try {
    // Resolve runId
    let runId = input.agentRunId;
    if (!runId) {
      runId = await ensureImageWorkflowAgentRun({
        projectId: input.projectId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    }
    if (!runId) return;

    // Get Agent DAG
    const agent = await getAgentBySlug(IMAGE_WORKFLOW_AGENT_SLUG);
    if (!agent?.dagDefinition) return;
    const dag = normalizeAgentDag(agent.dagDefinition as any);

    const output = input.userEdit ?? input.aiResult ?? null;

    // Mark skill node as waiting_human (captures AI output)
    await markBusinessManagedNodeWaitingHuman({
      runId,
      dag,
      nodeId: nodes.skillNode,
      output: input.aiResult ?? null,
      userId: input.userId,
    }).catch(() => {/* already in correct state - ignore */});

    // Mark review node as confirmed (captures user edit)
    await markBusinessManagedNodeConfirmed({
      runId,
      dag,
      nodeId: nodes.reviewNode,
      output,
      userEdit: output,
      userId: input.userId,
      metadata: {
        source: "business_page_confirm",
        stepNumber: input.stepNumber,
        projectId: input.projectId,
      },
    });
  } catch (err) {
    // Non-fatal: Agent DAG sync failure never blocks business flow
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} sync failed:`, err);
  }
}
