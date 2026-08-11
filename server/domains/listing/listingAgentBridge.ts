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
  markBusinessManagedNodeCanceled,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeDraft,
} from "../ai_os/services/businessManagedAgent";
import { normalizeAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { getAgentBySlug } from "../ai_os/services/agentRunner/templateGovernance";
import { getCheckpoint } from "../ai_os/services/agentRunner/checkpointStore";

export const LISTING_WORKFLOW_AGENT_SLUG = "listing.full.workflow";

// Step number → DAG node ID mapping
export const LISTING_STEP_NODE_MAP: Record<number, string> = {
  1: "G1",  // 卖点精雕
  2: "G2",  // 标题生成
  3: "G3",  // 产品描述
  4: "G4",  // 搜索词
  5: "G5",  // QA问答
};

// Generation node → DAG node ID mapping
export const LISTING_GENERATION_NODE_MAP = {
  "sellingPoints": "G1",
  "singleBullet": "G1",
  "bullets": "G1",
  "title": "G2",
  "description": "G3",
  "searchTerms": "G4",
  "qa": "G5",
  "imageAdvice": "E1",
} as const;

export type ListingGenerationNodeKey = keyof typeof LISTING_GENERATION_NODE_MAP;
export type ListingAgentNodeId = `N${0 | 1 | 2 | 3 | 4 | 5}` | `G${1 | 2 | 3 | 4 | 5}`;

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

function descendantNodeIds(dag: Awaited<ReturnType<typeof getListingDag>>, nodeId: string) {
  if (!dag) return [];
  const descendants = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of dag.edges.filter((item) => (item.source || item.from) === source)) {
      const target = edge.target || edge.to;
      if (!target || descendants.has(target)) continue;
      descendants.add(target);
      queue.push(target);
    }
  }
  return [...descendants];
}

async function resolveListingNodeContext(input: {
  agentRunId?: string | null;
  nodeId: ListingAgentNodeId;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  let runId = input.agentRunId;
  if (!runId) {
    runId = await ensureListingAgentRun(input);
  }
  if (!runId) return null;
  const dag = await getListingDag();
  if (!dag || !dag.nodes.some((node) => node.id === input.nodeId)) return null;
  return { runId, dag };
}

type ListingNodeJobSyncInput = {
  agentRunId?: string | null;
  nodeId: ListingAgentNodeId;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  aiJobRunId: string;
  aiJobAttempt?: number | null;
  aiJobMaxAttempts?: number | null;
  progress?: number;
  errorMessage?: string | null;
  output?: unknown;
};

export async function syncListingNodeJobQueued(input: ListingNodeJobSyncInput) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    await markBusinessManagedNodeRunning({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 0,
      progress: input.progress ?? 5,
      allowJobReplacement: true,
      userId: input.userId,
    });
    await markBusinessManagedNodeProgress({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 0,
      progress: input.progress ?? 5,
      metadata: {
        source: "listing_generation_job",
        businessJobStatus: "queued",
        businessJobAttempt: input.aiJobAttempt ?? 0,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ListingBridge] ${input.nodeId} queued sync failed:`, error);
  }
}

export async function syncListingNodeJobRunning(input: ListingNodeJobSyncInput) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    await markBusinessManagedNodeRunning({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 1,
      progress: input.progress ?? 15,
      userId: input.userId,
    });
    await markBusinessManagedNodeProgress({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? 1,
      progress: input.progress ?? 15,
      errorMessage: null,
      metadata: {
        source: "listing_generation_job",
        businessJobStatus: "running",
        businessJobAttempt: input.aiJobAttempt ?? 1,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ListingBridge] ${input.nodeId} running sync failed:`, error);
  }
}

export async function syncListingNodeJobWaitingHuman(input: ListingNodeJobSyncInput) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    await markBusinessManagedNodeWaitingHuman({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? null,
      output: input.output,
      progress: 100,
      metadata: {
        source: "listing_generation_job",
        businessJobStatus: "waiting_human",
        businessJobAttempt: input.aiJobAttempt ?? null,
        businessJobMaxAttempts: input.aiJobMaxAttempts ?? null,
        retryPending: false,
      },
      userId: input.userId,
    });
  } catch (error) {
    console.warn(`[ListingBridge] ${input.nodeId} waiting-human sync failed:`, error);
  }
}

export async function syncListingNodeJobFailed(input: ListingNodeJobSyncInput & {
  finalAttempt: boolean;
  failureKind?: "error" | "timeout" | "cancel";
}) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    const mutationInput = {
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId,
      aiJobAttempt: input.aiJobAttempt ?? null,
      progress: input.finalAttempt ? 100 : input.progress ?? 15,
      errorMessage: input.errorMessage || "Listing 生成任务失败",
      metadata: {
        source: "listing_generation_job",
        businessJobStatus: input.failureKind === "cancel" ? "canceled" : input.finalAttempt ? "failed" : "retrying",
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
    console.warn(`[ListingBridge] ${input.nodeId} failure sync failed:`, error);
  }
}

export async function syncListingNodeDraft(input: {
  agentRunId?: string | null;
  nodeId: ListingAgentNodeId;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  userEdit: unknown;
}) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    await markBusinessManagedNodeDraft({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      userEdit: input.userEdit,
      userId: input.userId,
      metadata: { source: "listing_business_page_edit", projectId: input.projectId },
    });
  } catch (error) {
    console.warn(`[ListingBridge] ${input.nodeId} draft sync failed:`, error);
  }
}

export async function syncListingPreparationNodeConfirmed(input: {
  agentRunId?: string | null;
  nodeId: `N${0 | 1 | 2 | 3 | 4 | 5}`;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  output: unknown;
}) {
  try {
    const context = await resolveListingNodeContext(input);
    if (!context) return;
    const checkpoint = await getCheckpoint(context.runId, input.nodeId);
    const currentOutput = checkpoint.userEdit ?? checkpoint.output;
    if (checkpoint.status === "confirmed" && JSON.stringify(currentOutput) === JSON.stringify(input.output)) return;
    if (checkpoint.status === "confirmed") {
      await markBusinessManagedNodeDraft({
        runId: context.runId,
        dag: context.dag,
        nodeId: input.nodeId,
        userEdit: input.output,
        userId: input.userId,
        metadata: { source: "listing_preparation_snapshot_refresh", projectId: input.projectId },
      });
    }
    await markBusinessManagedNodeConfirmed({
      runId: context.runId,
      dag: context.dag,
      nodeId: input.nodeId,
      output: input.output,
      userEdit: input.output,
      resetNodeIds: descendantNodeIds(context.dag, input.nodeId),
      userId: input.userId,
      metadata: {
        source: "listing_preparation_snapshot",
        projectId: input.projectId,
      },
    });
  } catch (error) {
    console.warn(`[ListingBridge] ${input.nodeId} preparation sync failed:`, error);
  }
}

/**
 * Mark a generation node as waiting_human (AI output ready, pending user review).
 * Called after each generation route completes successfully.
 */
export async function syncGenerationToAgent(input: {
  agentRunId: string | null | undefined;
  nodeKey: ListingGenerationNodeKey;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  aiOutput?: unknown;
}): Promise<void> {
  const nodeId = LISTING_GENERATION_NODE_MAP[input.nodeKey];
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
  const nodeId = LISTING_STEP_NODE_MAP[input.stepNumber];
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
      resetNodeIds: descendantNodeIds(dag, nodeId),
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
  const nodeId = LISTING_STEP_NODE_MAP[input.stepNumber];
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
      resetNodeIds: descendantNodeIds(dag, nodeId),
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
