/**
 * Listing Workflow ↔ Agent DAG Bridge
 *
 * 将 Listing 工作台的生成/确认事件同步到 Emperor Agent DAG 系统，
 * 使 Agent 画布能实时反映 Listing 工作台的操作状态。
 *
 * DAG 节点映射（listing.full.workflow）：
 * - G1 (listing.sellingpoints.generate) ← generateSellingPointsCores / syncConfirmedBullets
 * - G2 (listing.title.generate)         ← generateTitle
 * - G3 (listing.description.generate)   ← generateDescription
 * - G4 (listing.searchterms.generate)   ← generateSearchTerms
 * - G5 (listing.qa.generate)            ← generateQA
 * - O1 (output_node)                    ← 所有步骤锁定后
 * - N1-N5 (前置数据节点)                 ← 由竞品分析/关键词/评论模块完成
 *
 * 步骤号 → 节点 ID 映射（与 updateLockedSteps 的 lockedSteps 数组对应）：
 * - 步骤 1 → G1 (卖点)
 * - 步骤 2 → G2 (标题)
 * - 步骤 3 → G3 (描述)
 * - 步骤 4 → G4 (搜索词)
 * - 步骤 5 → G5 (QA)
 *
 * 设计原则：所有 Agent 集成调用均为 best-effort（失败不影响业务流程）
 */

import {
  ensureBusinessManagedRun,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
} from "../ai_os/services/businessManagedAgent";
import { normalizeAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { getAgentBySlug } from "../ai_os/services/agentRunner/templateGovernance";

export const LISTING_WORKFLOW_AGENT_SLUG = "listing.full.workflow";

// Step number → DAG node ID mapping
const STEP_NODE_MAP: Record<number, string> = {
  1: "G1",  // 卖点精雕
  2: "G2",  // 标题生成
  3: "G3",  // 产品描述
  4: "G4",  // 搜索词
  5: "G5",  // QA问答
};

// Generation node → DAG node ID mapping
const GEN_NODE_MAP: Record<string, string> = {
  "sellingPoints": "G1",
  "title": "G2",
  "description": "G3",
  "searchTerms": "G4",
  "qa": "G5",
  "imageAdvice": "E1",
};

/**
 * Ensure Agent Run exists for the listing project.
 * Called when creating/initializing a listing project.
 */
export async function ensureListingAgentRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}): Promise<string | null> {
  try {
    const { detail } = await ensureBusinessManagedRun({
      agentSlug: LISTING_WORKFLOW_AGENT_SLUG,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      requireMutable: true,
    });
    return (detail?.run as any)?.runId ?? null;
  } catch (err) {
    console.warn("[ListingBridge] Failed to ensure Agent Run:", err);
    return null;
  }
}

async function getListingDag() {
  const agent = await getAgentBySlug(LISTING_WORKFLOW_AGENT_SLUG);
  if (!agent?.dagDefinition) return null;
  return normalizeAgentDag(agent.dagDefinition as any);
}

/**
 * Mark a generation node as waiting_human (AI output ready, pending user review).
 * Called after each generation route completes successfully.
 */
export async function syncGenerationToAgent(input: {
  agentRunId: string | null | undefined;
  nodeKey: keyof typeof GEN_NODE_MAP;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  aiOutput?: unknown;
}): Promise<void> {
  const nodeId = GEN_NODE_MAP[input.nodeKey];
  if (!nodeId) return;

  try {
    let runId = input.agentRunId;
    if (!runId) {
      runId = await ensureListingAgentRun({
        projectId: input.projectId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    }
    if (!runId) return;

    const dag = await getListingDag();
    if (!dag) return;

    await markBusinessManagedNodeWaitingHuman({
      runId,
      dag,
      nodeId,
      output: input.aiOutput ?? null,
      userId: input.userId,
      metadata: {
        source: "listing_workbench_generation",
        nodeKey: input.nodeKey,
        projectId: input.projectId,
      },
    });
  } catch (err) {
    console.warn(`[ListingBridge] syncGeneration(${input.nodeKey}) failed:`, err);
  }
}

/**
 * Mark a step node as confirmed (user locked the step).
 * Called when updateLockedSteps adds a new step to the locked set.
 */
export async function syncStepLockToAgent(input: {
  agentRunId: string | null | undefined;
  stepNumber: number;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  userEdit?: unknown;
}): Promise<void> {
  const nodeId = STEP_NODE_MAP[input.stepNumber];
  if (!nodeId) return;

  try {
    let runId = input.agentRunId;
    if (!runId) {
      runId = await ensureListingAgentRun({
        projectId: input.projectId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    }
    if (!runId) return;

    const dag = await getListingDag();
    if (!dag) return;

    await markBusinessManagedNodeConfirmed({
      runId,
      dag,
      nodeId,
      output: input.userEdit ?? null,
      userEdit: input.userEdit ?? null,
      userId: input.userId,
      metadata: {
        source: "listing_workbench_lock",
        stepNumber: input.stepNumber,
        projectId: input.projectId,
      },
    });
  } catch (err) {
    console.warn(`[ListingBridge] syncStepLock(step${input.stepNumber}) failed:`, err);
  }
}

/**
 * Mark a step node as unlocked (waiting_human again).
 * Called when updateLockedSteps removes a step from the locked set.
 */
export async function syncStepUnlockToAgent(input: {
  agentRunId: string | null | undefined;
  stepNumber: number;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}): Promise<void> {
  const nodeId = STEP_NODE_MAP[input.stepNumber];
  if (!nodeId) return;

  try {
    let runId = input.agentRunId;
    if (!runId) return;

    const dag = await getListingDag();
    if (!dag) return;

    await markBusinessManagedNodeWaitingHuman({
      runId,
      dag,
      nodeId,
      userId: input.userId,
      metadata: {
        source: "listing_workbench_unlock",
        stepNumber: input.stepNumber,
        projectId: input.projectId,
      },
    });
  } catch (err) {
    console.warn(`[ListingBridge] syncStepUnlock(step${input.stepNumber}) failed:`, err);
  }
}
