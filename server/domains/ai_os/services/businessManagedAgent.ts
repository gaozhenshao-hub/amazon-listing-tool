import { randomUUID } from "node:crypto";
import type { EmperorAgentDag, EmperorAgentNode } from "./agentRunner/runtimeCore";
import {
  checkpointMetadata,
  parseJson,
  rawExecute,
  stringifyJson,
  withAgentStateMachine,
} from "./agentRunner/runtimeCore";
import { persistAgentArtifact } from "./agentRunner/artifactStore";
import { addEvent, getCheckpoint } from "./agentRunner/checkpointStore";
import { refreshRunAfterCheckpoint, unlockChildren } from "./agentRunner/contextPackage";
import { getAgentRun, startAgentRun } from "./agentRunner/execution";

type RunStatus = "running" | "waiting_human" | "paused" | "completed" | "failed" | "canceled";

type BusinessManagedRunInput = {
  agentSlug: string;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  inputs?: Record<string, unknown>;
};

type BusinessManagedNodeInput = {
  runId: string;
  dag: EmperorAgentDag;
  nodeId: string;
  output?: unknown;
  userEdit?: unknown;
  aiJobRunId?: string | null;
  aiJobAttempt?: number | null;
  progress?: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  resetNodeIds?: string[];
  userId?: number;
};

function workspaceClause(workspaceId?: number | null) {
  return workspaceId === null || workspaceId === undefined
    ? { clause: "workspaceId IS NULL", params: [] as unknown[] }
    : { clause: "workspaceId=?", params: [workspaceId] as unknown[] };
}

function nodeFromDag(dag: EmperorAgentDag, nodeId: string): EmperorAgentNode {
  const node = dag.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Agent node not found: ${nodeId}`);
  return node;
}

function runRow(detail: any) {
  return detail?.run || detail;
}

async function resetNodes(runId: string, nodeIds: string[] = []) {
  const uniqueNodeIds = [...new Set(nodeIds)].filter(Boolean);
  if (uniqueNodeIds.length === 0) return;
  await withAgentStateMachine((stateMachine) => stateMachine.resetDescendants({
    runId,
    nodeIds: uniqueNodeIds,
  }));
}

async function ensureNodeCanRun(input: BusinessManagedNodeInput) {
  let checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (checkpoint.status === "running") return checkpoint;

  if (["confirmed", "skipped"].includes(checkpoint.status)) {
    await withAgentStateMachine((stateMachine) => stateMachine.resetNodeForRerun({
      runId: input.runId,
      nodeId: input.nodeId,
    }));
    checkpoint = await getCheckpoint(input.runId, input.nodeId);
  }
  if (checkpoint.status === "pending") {
    await withAgentStateMachine((stateMachine) => stateMachine.markNodeReady({
      runId: input.runId,
      nodeId: input.nodeId,
      action: "prepare business-managed node",
    }));
    checkpoint = await getCheckpoint(input.runId, input.nodeId);
  }
  if (checkpoint.status === "waiting_human") return checkpoint;
  if (!["ready", "failed"].includes(checkpoint.status)) {
    throw new Error(`业务托管节点 ${input.nodeId} 当前状态不可执行：${checkpoint.status}`);
  }

  const now = new Date();
  const lockToken = `business_${randomUUID()}`;
  await withAgentStateMachine((stateMachine) => stateMachine.claimNodeRunning({
    runId: input.runId,
    nodeId: input.nodeId,
    nodeInput: {
      source: "business_page",
      projectStage: input.nodeId,
      aiJobRunId: input.aiJobRunId || null,
    },
    lockToken,
    lockedAt: now,
    timeoutAt: new Date(now.getTime() + 30 * 60_000),
    allowedFromStatuses: [checkpoint.status as "ready" | "failed"],
    action: "claim business-managed node",
  }));
  if (input.aiJobRunId) {
    await withAgentStateMachine((stateMachine) => stateMachine.attachNodeAiJob({
      runId: input.runId,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId!,
      aiJobAttempt: input.aiJobAttempt ?? 0,
      lockToken,
    }));
  }
  return getCheckpoint(input.runId, input.nodeId);
}

export async function findLatestBusinessManagedRun(input: BusinessManagedRunInput) {
  const scope = workspaceClause(input.workspaceId);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_runs
     WHERE agentSlug=? AND projectId=? AND ${scope.clause}
     ORDER BY createdAt DESC,id DESC LIMIT 1`,
    [input.agentSlug, input.projectId, ...scope.params],
  );
  return rows[0] || null;
}

export async function ensureBusinessManagedRun(input: BusinessManagedRunInput & {
  requireMutable?: boolean;
}) {
  const latest = await findLatestBusinessManagedRun(input);
  const status = latest?.status as RunStatus | undefined;
  if (latest && (!input.requireMutable || (status !== "completed" && status !== "canceled"))) {
    return { detail: await getAgentRun(latest.runId, undefined, true), created: false };
  }

  // Recheck immediately before creation so rapid repeated clicks normally share one Run.
  const rechecked = await findLatestBusinessManagedRun(input);
  const recheckedStatus = rechecked?.status as RunStatus | undefined;
  if (rechecked && (!input.requireMutable || (recheckedStatus !== "completed" && recheckedStatus !== "canceled"))) {
    return { detail: await getAgentRun(rechecked.runId, undefined, true), created: false };
  }

  const detail = await startAgentRun({
    slug: input.agentSlug,
    inputs: {
      projectId: input.projectId,
      executionOwner: "business_page",
      ...(input.inputs || {}),
    },
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId,
  });
  return { detail, created: true };
}

export async function markBusinessManagedNodeRunning(input: BusinessManagedNodeInput) {
  let checkpoint = await ensureNodeCanRun(input);
  if (checkpoint.status === "waiting_human") {
    await withAgentStateMachine((stateMachine) => stateMachine.claimNodeRunning({
      runId: input.runId,
      nodeId: input.nodeId,
      nodeInput: { source: "business_page", projectStage: input.nodeId, aiJobRunId: input.aiJobRunId || null },
      lockToken: `business_${randomUUID()}`,
      lockedAt: new Date(),
      timeoutAt: new Date(Date.now() + 30 * 60_000),
      allowedFromStatuses: ["waiting_human"],
      action: "rerun business-managed node",
    }));
    checkpoint = await getCheckpoint(input.runId, input.nodeId);
  }
  if (checkpoint.status !== "running") throw new Error(`节点 ${input.nodeId} 未进入运行状态`);
  if (input.aiJobRunId && checkpoint.aiJobRunId !== input.aiJobRunId) {
    await withAgentStateMachine((stateMachine) => stateMachine.attachNodeAiJob({
      runId: input.runId,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId!,
      aiJobAttempt: input.aiJobAttempt ?? 0,
    }));
  }
  await addEvent(input.runId, checkpoint.agentSlug, input.nodeId, "node.business_started", `业务页面已启动 ${checkpoint.nodeLabel || input.nodeId}`, {
    aiJobRunId: input.aiJobRunId || null,
  });
  await refreshRunAfterCheckpoint(input.runId, input.dag);
}

export async function markBusinessManagedNodeProgress(input: BusinessManagedNodeInput) {
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (checkpoint.status !== "running") return false;
  if (input.aiJobRunId && checkpoint.aiJobRunId !== input.aiJobRunId) return false;

  if (input.aiJobRunId && input.aiJobAttempt && Number(checkpoint.aiJobAttempt || 0) < input.aiJobAttempt) {
    await withAgentStateMachine((stateMachine) => stateMachine.recordNodeJobAttempt({
      runId: input.runId,
      nodeId: input.nodeId,
      aiJobRunId: input.aiJobRunId!,
      aiJobAttempt: input.aiJobAttempt!,
      aiJobClaimedAt: new Date(),
      timeoutAt: new Date(Date.now() + 30 * 60_000),
    }));
  }
  const metadata = {
    ...checkpointMetadata(checkpoint),
    ...(input.metadata || {}),
    businessProgress: Math.min(Math.max(Math.round(input.progress || 0), 0), 100),
  };
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET metadata=?,errorMessage=?,updatedAt=NOW() WHERE runId=? AND nodeId=? AND status='running'",
    [stringifyJson(metadata), input.errorMessage ?? null, input.runId, input.nodeId],
  );
  return true;
}

export async function markBusinessManagedNodeWaitingHuman(input: BusinessManagedNodeInput) {
  let checkpoint = await ensureNodeCanRun(input);
  if (checkpoint.status === "waiting_human") {
    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET output=?,metadata=?,errorMessage=?,completedAt=COALESCE(completedAt,NOW()),updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [
        stringifyJson(input.output),
        stringifyJson({ ...checkpointMetadata(checkpoint), ...(input.metadata || {}), businessProgress: 100 }),
        input.errorMessage ?? null,
        input.runId,
        input.nodeId,
      ],
    );
  } else {
    if (checkpoint.status !== "running") {
      await markBusinessManagedNodeRunning(input);
      checkpoint = await getCheckpoint(input.runId, input.nodeId);
    }
    const metadata = { ...checkpointMetadata(checkpoint), ...(input.metadata || {}), businessProgress: 100 };
    await withAgentStateMachine((stateMachine) => stateMachine.completeNode({
      runId: input.runId,
      nodeId: input.nodeId,
      to: "waiting_human",
      output: input.output,
      metadata,
      completedAt: new Date(),
      sourceAiJobRunId: input.aiJobRunId || null,
      sourceAiJobAttempt: input.aiJobAttempt ?? null,
      updateRunToWaitingHuman: true,
    }));
  }

  await resetNodes(input.runId, input.resetNodeIds);
  const detail = await getAgentRun(input.runId, undefined, true);
  const node = nodeFromDag(input.dag, input.nodeId);
  await persistAgentArtifact({
    run: runRow(detail),
    node,
    status: "draft",
    content: input.output,
    sourceAiJobRunId: input.aiJobRunId || null,
    metadata: { source: "business_page", ...(input.metadata || {}) },
  });
  await addEvent(input.runId, runRow(detail).agentSlug, input.nodeId, "node.business_waiting_human", `业务结果已生成，等待页面确认`);
  await refreshRunAfterCheckpoint(input.runId, input.dag);
}

export async function markBusinessManagedNodeConfirmed(input: BusinessManagedNodeInput) {
  let checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (checkpoint.status !== "waiting_human" && checkpoint.status !== "confirmed") {
    await markBusinessManagedNodeWaitingHuman(input);
    checkpoint = await getCheckpoint(input.runId, input.nodeId);
  }
  const effectiveOutput = input.userEdit ?? input.output ?? checkpoint.userEdit ?? checkpoint.output;
  await withAgentStateMachine((stateMachine) => stateMachine.confirmNode({
    runId: input.runId,
    nodeId: input.nodeId,
    to: "confirmed",
    output: input.output,
    userEdit: effectiveOutput,
    reviewerUserId: input.userId || 0,
    confirmedAt: new Date(),
  }));
  await resetNodes(input.runId, input.resetNodeIds);
  const detail = await getAgentRun(input.runId, undefined, true);
  await persistAgentArtifact({
    run: runRow(detail),
    node: nodeFromDag(input.dag, input.nodeId),
    status: "final",
    content: effectiveOutput,
    sourceAiJobRunId: input.aiJobRunId || checkpoint.aiJobRunId || null,
    selectedBy: input.userId || runRow(detail).userId,
    metadata: { source: "business_page_confirmation", ...(input.metadata || {}) },
  });
  await addEvent(input.runId, runRow(detail).agentSlug, input.nodeId, "node.business_confirmed", `业务页面已确认并锁定节点`, {
    resetNodeIds: input.resetNodeIds || [],
  });
  await unlockChildren(input.runId, input.dag, input.nodeId);
  await refreshRunAfterCheckpoint(input.runId, input.dag);
}

export async function markBusinessManagedNodeDraft(input: BusinessManagedNodeInput) {
  await markBusinessManagedNodeWaitingHuman({ ...input, output: input.userEdit ?? input.output });
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET userEdit=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(input.userEdit ?? input.output), input.runId, input.nodeId],
  );
  await addEvent(input.runId, (await getCheckpoint(input.runId, input.nodeId)).agentSlug, input.nodeId, "node.business_draft_saved", "业务页面已保存人工编辑");
}

export async function markBusinessManagedNodeSkipped(input: BusinessManagedNodeInput & { reason: string }) {
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (checkpoint.status === "skipped") return;
  if (checkpoint.status !== "pending" && checkpoint.status !== "ready") {
    throw new Error(`节点 ${input.nodeId} 当前状态不可跳过：${checkpoint.status}`);
  }
  await withAgentStateMachine((stateMachine) => stateMachine.confirmNode({
    runId: input.runId,
    nodeId: input.nodeId,
    to: "skipped",
    userEdit: { reason: input.reason },
    reviewerUserId: input.userId || 0,
    confirmedAt: new Date(),
  }));
  await addEvent(input.runId, checkpoint.agentSlug, input.nodeId, "node.business_skipped", input.reason);
  await unlockChildren(input.runId, input.dag, input.nodeId);
  await refreshRunAfterCheckpoint(input.runId, input.dag);
}

export async function markBusinessManagedNodeFailed(input: BusinessManagedNodeInput & {
  finalAttempt: boolean;
  failureKind?: "error" | "timeout" | "cancel";
}) {
  let checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (!input.finalAttempt) {
    return markBusinessManagedNodeProgress({
      ...input,
      progress: input.progress || 15,
      metadata: { ...(input.metadata || {}), retryPending: true },
    });
  }
  if (checkpoint.status !== "running") {
    await markBusinessManagedNodeRunning(input);
    checkpoint = await getCheckpoint(input.runId, input.nodeId);
  }
  await withAgentStateMachine((stateMachine) => stateMachine.failNode({
    runId: input.runId,
    nodeId: input.nodeId,
    message: input.errorMessage || "业务节点执行失败",
    completedAt: new Date(),
    sourceAiJobRunId: input.aiJobRunId || null,
    sourceAiJobAttempt: input.aiJobAttempt ?? null,
    failureKind: input.failureKind || "error",
  }));
  await addEvent(input.runId, checkpoint.agentSlug, input.nodeId, `node.business_${input.failureKind || "failed"}`, input.errorMessage || "业务节点执行失败", {
    aiJobRunId: input.aiJobRunId || null,
  });
  await refreshRunAfterCheckpoint(input.runId, input.dag);
}

export function parseBusinessManagedOutput(value: unknown) {
  if (typeof value !== "string") return value;
  return parseJson(value, value);
}
