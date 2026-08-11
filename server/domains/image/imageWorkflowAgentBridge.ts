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
  markBusinessManagedNodeCanceled,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
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

export function imageWorkflowSkillNodeId(stepNumber: number): string {
  const nodes = STEP_NODE_MAP[stepNumber];
  if (!nodes) throw new Error(`Unsupported image workflow step: ${stepNumber}`);
  return nodes.skillNode;
}

type ImageStepAgentContextInput = {
  agentRunId?: string | null;
  stepNumber: number;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
};

async function resolveImageStepAgentContext(input: ImageStepAgentContextInput) {
  const nodes = STEP_NODE_MAP[input.stepNumber];
  if (!nodes) return null;

  let runId = input.agentRunId;
  if (!runId) {
    runId = await ensureImageWorkflowAgentRun({
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
  }
  if (!runId) return null;

  const agent = await getAgentBySlug(IMAGE_WORKFLOW_AGENT_SLUG);
  if (!agent?.dagDefinition) return null;
  return {
    runId,
    nodes,
    dag: normalizeAgentDag(agent.dagDefinition as any),
  };
}

type ImageStepJobSyncInput = ImageStepAgentContextInput & {
  aiJobRunId: string;
  aiJobAttempt?: number | null;
  aiJobMaxAttempts?: number | null;
  progress?: number;
  errorMessage?: string | null;
  output?: unknown;
};

export async function syncStepJobQueuedToAgent(input: ImageStepJobSyncInput): Promise<void> {
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;
    await markBusinessManagedNodeRunning({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 0,
      progress: input.progress ?? 5,
      allowJobReplacement: true,
      userId: input.userId,
    });
    await markBusinessManagedNodeProgress({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 0,
      progress: input.progress ?? 5,
      errorMessage: null,
      metadata: {
        source: "image_step_job",
        businessJobStatus: "queued",
        businessJobAttempt: input.aiJobAttempt ?? 0,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} queued sync failed:`, error);
  }
}

export async function syncStepJobRunningToAgent(input: ImageStepJobSyncInput): Promise<void> {
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;
    await markBusinessManagedNodeRunning({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 1,
      progress: input.progress ?? 15,
      userId: input.userId,
    });
    await markBusinessManagedNodeProgress({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 1,
      progress: input.progress ?? 15,
      errorMessage: null,
      metadata: {
        source: "image_step_job",
        businessJobStatus: "running",
        businessJobAttempt: input.aiJobAttempt ?? 1,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} running sync failed:`, error);
  }
}

export async function syncStepJobWaitingHumanToAgent(input: ImageStepJobSyncInput): Promise<void> {
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;
    await markBusinessManagedNodeWaitingHuman({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? null,
      output: input.output,
      progress: 100,
      errorMessage: null,
      metadata: {
        source: "image_step_job",
        businessJobStatus: "waiting_human",
        businessJobAttempt: input.aiJobAttempt ?? null,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} waiting-human sync failed:`, error);
  }
}

export async function syncStepJobFailedToAgent(input: ImageStepJobSyncInput & {
  finalAttempt: boolean;
  failureKind?: "error" | "timeout" | "cancel";
}): Promise<void> {
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;
    const mutationInput = {
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? null,
      progress: input.finalAttempt ? 100 : 15,
      errorMessage: input.errorMessage || "图片工作流任务执行失败",
      metadata: {
        source: "image_step_job",
        businessJobStatus: input.failureKind === "cancel"
          ? "canceled"
          : input.finalAttempt
            ? "failed"
            : "retrying",
        businessJobAttempt: input.aiJobAttempt ?? null,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
      },
      userId: input.userId,
    };
    if (input.failureKind === "cancel") {
      await markBusinessManagedNodeCanceled(mutationInput);
    } else {
      await markBusinessManagedNodeFailed({
        ...mutationInput,
        finalAttempt: input.finalAttempt,
        failureKind: input.failureKind || "error",
      });
    }
  } catch (error) {
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} failure sync failed:`, error);
  }
}

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
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;

    const output = input.userEdit ?? input.aiResult ?? null;

    // Mark skill node as waiting_human (captures AI output)
    await markBusinessManagedNodeWaitingHuman({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      output: input.aiResult ?? null,
      userId: input.userId,
    }).catch(() => {/* already in correct state - ignore */});

    // Mark review node as confirmed (captures user edit)
    await markBusinessManagedNodeConfirmed({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.reviewNode,
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

export async function syncStepUnlockToAgent(input: ImageStepAgentContextInput): Promise<void> {
  try {
    const context = await resolveImageStepAgentContext(input);
    if (!context) return;
    const resetNodeIds: string[] = [];
    for (let step = input.stepNumber; step <= 5; step += 1) {
      const nodes = STEP_NODE_MAP[step];
      if (!nodes) continue;
      resetNodeIds.push(nodes.reviewNode);
      if (step > input.stepNumber) resetNodeIds.push(nodes.skillNode);
    }
    await markBusinessManagedNodeWaitingHuman({
      runId: context.runId,
      dag: context.dag,
      nodeId: context.nodes.skillNode,
      output: null,
      resetNodeIds,
      userId: input.userId,
      metadata: {
        source: "image_business_page_unlock",
        stepNumber: input.stepNumber,
        projectId: input.projectId,
      },
    });
  } catch (error) {
    console.warn(`[ImageWorkflowBridge] Step ${input.stepNumber} unlock sync failed:`, error);
  }
}
