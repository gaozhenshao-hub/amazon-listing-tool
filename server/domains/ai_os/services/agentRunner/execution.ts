import { TRPCError, assertNodeTransition, withAgentStateMachine, AgentNodeStatus, AgentRunStatus, runEmperorSkill, safeParseSkillJSON, SkillRuntimeSnapshot, SkillVersionPolicy, calculateAiJobRetryDelayMs, cancelAiJob, failAiJob, getAiJobRun, registerAiJobHandler, retryAiJob, startRegisteredAiJob, AiJobSnapshot, invokeEmperorTool, recordAiOsEvaluation, recordAiOsMetric, EmperorAgentNode, EmperorAgentDag, CheckpointRow, resolveAgentNodeSkillBinding, buildStoredAgentRunInputs, parseStoredAgentRunInputs, assertRunMutable, rawExecute, parseJson, stringifyJson, toRecord, generateRunId, normalizeAgentDag, nodeMaxAttempts, nodeTimeoutAt, assertValidAgentDag, parentIds, descendantIds, isConfirmedStatus, checkpointPayload, checkpointMetadata, buildNodeRunMetadata } from "./runtimeCore";
import { selectAgentTemplateVersionForRun, getAgentBySlug } from "./templateGovernance";
import { addEvent, getCheckpoints, getCheckpoint } from "./checkpointStore";
import { persistAgentArtifact, listAgentArtifacts, estimateAgentHumanEditRate } from "./artifactStore";
import { getRunRow, effectiveCheckpointOutput, refreshRunAfterCheckpoint, unlockChildren, buildNodeInput, buildSkillContext } from "./contextPackage";
function nodeRequiresHumanGate(node: EmperorAgentNode): boolean {
  if (node.autoConfirm === true) return false;
  return node.humanGate !== false;
}

type AgentNodeJobFailureKind = "error" | "timeout" | "cancel";

function agentErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown Agent node error";
  }
}

function agentNodeTimeoutAtForJob(job: Pick<AiJobSnapshot, "timeoutSeconds">, delayMs = 0): Date {
  const timeoutMs = Math.min(Math.max(job.timeoutSeconds || 600, 5), 7200) * 1000;
  return new Date(Date.now() + delayMs + timeoutMs + 5000);
}

export function buildAgentRetryEventPayload(input: {
  job: AiJobSnapshot;
  retryDelayMs: number;
  retryScheduledAt: Date;
  timeoutAt: Date;
  failureKind: AgentNodeJobFailureKind;
  error: string;
}) {
  return {
    schemaVersion: "1.0",
    failureKind: input.failureKind,
    aiJobRunId: input.job.runId,
    attempt: input.job.attempt,
    maxAttempts: input.job.maxAttempts,
    nextAttempt: input.job.attempt + 1,
    retryDelayMs: input.retryDelayMs,
    retryScheduledAt: input.retryScheduledAt.toISOString(),
    timeoutAt: input.timeoutAt.toISOString(),
    error: input.error,
  };
}

async function recordAgentNodeJobAttempt(input: {
  run: any;
  node: EmperorAgentNode;
  job: AiJobSnapshot;
}) {
  const timeoutAt = agentNodeTimeoutAtForJob(input.job);
  const result = await withAgentStateMachine((stateMachine) => stateMachine.recordNodeJobAttempt({
    runId: input.run.runId,
    nodeId: input.node.id,
    aiJobRunId: input.job.runId,
    aiJobAttempt: input.job.attempt,
    aiJobClaimedAt: input.job.claimedAt || null,
    timeoutAt,
  }));
  if (!result.recorded) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.job_attempt_ignored", `节点 ${input.node.label || input.node.id} 的 Job attempt 已忽略：Checkpoint 已变化`, {
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      checkpointStatus: result.status,
      currentAiJobRunId: result.currentAiJobRunId || null,
      currentAiJobAttempt: result.currentAiJobAttempt ?? null,
    });
  } else {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.job_attempt_claimed", `节点 ${input.node.label || input.node.id} 已绑定 Job attempt ${input.job.attempt}`, {
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      timeoutAt: timeoutAt.toISOString(),
    });
  }
  return result;
}

async function finalizeNodeOutput(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  userId: number;
  output: unknown;
  skillRunId?: string | null;
  sourceAiJobRunId?: string | null;
  sourceAiJobAttempt?: number | null;
  runtimeMetadata?: Record<string, unknown>;
  completedMessage?: string;
}) {
  const latestRun = await getRunRow(input.run.runId);
  if (latestRun.status === "canceled") {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.output_ignored", `节点 ${input.node.label || input.node.id} 的结果已忽略：Run 已取消`, {
      skillRunId: input.skillRunId || null,
    });
    return;
  }

  const checkpoint = await getCheckpoint(input.run.runId, input.node.id);
  if (input.sourceAiJobRunId && (checkpoint.status !== "running" || checkpoint.aiJobRunId !== input.sourceAiJobRunId)) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.output_ignored", `节点 ${input.node.label || input.node.id} 的结果已忽略：Checkpoint 已变化`, {
      skillRunId: input.skillRunId || null,
      sourceAiJobRunId: input.sourceAiJobRunId,
      checkpointStatus: checkpoint.status,
      currentAiJobRunId: checkpoint.aiJobRunId || null,
    });
    return;
  }
  if (input.sourceAiJobAttempt !== undefined && input.sourceAiJobAttempt !== null && Number(checkpoint.aiJobAttempt || 0) !== input.sourceAiJobAttempt) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.output_ignored", `节点 ${input.node.label || input.node.id} 的结果已忽略：Job attempt 已过期`, {
      skillRunId: input.skillRunId || null,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      sourceAiJobAttempt: input.sourceAiJobAttempt,
      currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0),
    });
    return;
  }

  const waitingForHuman = nodeRequiresHumanGate(input.node);
  const nextStatus: AgentNodeStatus = waitingForHuman ? "waiting_human" : "confirmed";
  const nextMetadata = {
    ...checkpointMetadata(checkpoint),
    ...(input.runtimeMetadata || {}),
  };
  const completedAt = new Date();
  const transition = await withAgentStateMachine((stateMachine) => stateMachine.completeNode({
    runId: input.run.runId,
    nodeId: input.node.id,
    to: nextStatus,
    output: input.output,
    metadata: nextMetadata,
    skillRunId: input.skillRunId || null,
    reviewerUserId: waitingForHuman ? null : input.userId,
    completedAt,
    confirmedAt: waitingForHuman ? null : completedAt,
    sourceAiJobRunId: input.sourceAiJobRunId || null,
    sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
    updateRunToWaitingHuman: waitingForHuman,
  }));
  if (transition.ignored) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.output_ignored", `节点 ${input.node.label || input.node.id} 的结果已忽略：Checkpoint 已变化`, {
      skillRunId: input.skillRunId || null,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
      checkpointStatus: transition.from,
      currentAiJobRunId: transition.currentAiJobRunId || null,
      currentAiJobAttempt: (transition as any).currentAiJobAttempt ?? null,
    });
    return;
  }
  await persistAgentArtifact({
    run: input.run,
    node: input.node,
    status: waitingForHuman ? "draft" : "final",
    content: input.output,
    sourceSkillRunId: input.skillRunId || checkpoint.skillRunId || null,
    sourceAiJobRunId: input.sourceAiJobRunId || checkpoint.aiJobRunId || null,
    metadata: {
      source: "finalizeNodeOutput",
      waitingForHuman,
      ...nextMetadata,
    },
  });
  const skillRunMetadata = toRecord(toRecord(nextMetadata).skillRun);
  const nodeDurationMs = Number(skillRunMetadata.durationMs || 0);
  const inputTokens = Number(skillRunMetadata.inputTokens || 0);
  const outputTokens = Number(skillRunMetadata.outputTokens || 0);
  void recordAiOsEvaluation({
    entityType: "agent_node",
    entityId: `${input.run.runId}:${input.node.id}`,
    output: input.output,
    status: nextStatus,
    workspaceId: input.run.workspaceId ?? null,
    userId: input.userId,
    projectId: input.run.projectId ?? null,
    agentSlug: input.run.agentSlug,
    nodeId: input.node.id,
    skillSlug: input.node.skillSlug || null,
    retryCount: checkpoint.retryCount || 0,
    fallbackCount: Number(skillRunMetadata.fallbackCount || 0),
    metadata: {
      outputKey: input.node.outputKey || input.node.id,
      waitingForHuman,
      skillRunId: input.skillRunId || null,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      durationMs: nodeDurationMs || null,
      inputTokens,
      outputTokens,
    },
  });
  if (nodeDurationMs > 0) {
    void recordAiOsMetric({
      entityType: "agent_node",
      entityId: `${input.run.runId}:${input.node.id}`,
      metricName: "agent_node.duration_ms",
      metricValue: nodeDurationMs,
      status: nextStatus,
      workspaceId: input.run.workspaceId ?? null,
      userId: input.userId,
      projectId: input.run.projectId ?? null,
      agentSlug: input.run.agentSlug,
      nodeId: input.node.id,
      skillSlug: input.node.skillSlug || null,
      metadata: { outputKey: input.node.outputKey || input.node.id },
    });
  }
  if (inputTokens + outputTokens > 0) {
    void recordAiOsMetric({
      entityType: "agent_node",
      entityId: `${input.run.runId}:${input.node.id}`,
      metricName: "agent_node.tokens",
      metricValue: inputTokens + outputTokens,
      status: nextStatus,
      workspaceId: input.run.workspaceId ?? null,
      userId: input.userId,
      projectId: input.run.projectId ?? null,
      agentSlug: input.run.agentSlug,
      nodeId: input.node.id,
      skillSlug: input.node.skillSlug || null,
      metadata: { inputTokens, outputTokens },
    });
  }

  if (waitingForHuman) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.waiting_human", input.completedMessage || `节点 ${input.node.label || input.node.id} 已生成，等待人工确认`, {
      skillRunId: input.skillRunId || null,
    });
    await refreshRunAfterCheckpoint(input.run.runId, input.dag);
  } else {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.auto_confirmed", input.completedMessage || `节点 ${input.node.label || input.node.id} 已自动确认`, {
      skillRunId: input.skillRunId || null,
    });
    await unlockChildren(input.run.runId, input.dag, input.node.id);
    await refreshRunAfterCheckpoint(input.run.runId, input.dag);
  }
}

async function failNodeExecution(input: {
  run: any;
  node: EmperorAgentNode;
  error: unknown;
  sourceAiJobRunId?: string | null;
  sourceAiJobAttempt?: number | null;
  failureKind?: AgentNodeJobFailureKind;
}) {
  const latestRun = await getRunRow(input.run.runId);
  if (latestRun.status === "canceled") {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.failure_ignored", `节点 ${input.node.label || input.node.id} 的失败已忽略：Run 已取消`);
    return;
  }

  const message = agentErrorMessage(input.error);
  const transition = await withAgentStateMachine((stateMachine) => stateMachine.failNode({
    runId: input.run.runId,
    nodeId: input.node.id,
    message,
    completedAt: new Date(),
    sourceAiJobRunId: input.sourceAiJobRunId || null,
    sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
    failureKind: input.failureKind || "error",
  }));
  if ((transition as any).ignored) {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.failure_ignored", `节点 ${input.node.label || input.node.id} 的失败已忽略：Job attempt 已过期`, {
      error: message,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
      currentAiJobRunId: (transition as any).currentAiJobRunId || null,
      currentAiJobAttempt: (transition as any).currentAiJobAttempt ?? null,
      failureKind: input.failureKind || "error",
    });
    return;
  }
  void recordAiOsMetric({
    entityType: "agent_node",
    entityId: `${input.run.runId}:${input.node.id}`,
    metricName: "agent_node.failed",
    metricValue: null,
    status: "failed",
    workspaceId: input.run.workspaceId ?? null,
    userId: input.run.userId,
    projectId: input.run.projectId ?? null,
    agentSlug: input.run.agentSlug,
    nodeId: input.node.id,
    skillSlug: input.node.skillSlug || null,
    metadata: {
      failureKind: input.failureKind || "error",
      error: message,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
    },
  });
  void recordAiOsEvaluation({
    entityType: "agent_node",
    entityId: `${input.run.runId}:${input.node.id}:failed`,
    output: { error: message, failureKind: input.failureKind || "error" },
    status: "failed",
    workspaceId: input.run.workspaceId ?? null,
    userId: input.run.userId,
    projectId: input.run.projectId ?? null,
    agentSlug: input.run.agentSlug,
    nodeId: input.node.id,
    skillSlug: input.node.skillSlug || null,
    metadata: {
      sourceAiJobRunId: input.sourceAiJobRunId || null,
      sourceAiJobAttempt: input.sourceAiJobAttempt ?? null,
    },
  });
  await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.failed", `节点 ${input.node.label || input.node.id} 执行失败`, { error: message });
}

async function recordAgentNodeJobFailure(input: {
  run: any;
  node: EmperorAgentNode;
  job: AiJobSnapshot;
  error: unknown;
  failureKind: AgentNodeJobFailureKind;
}) {
  const message = agentErrorMessage(input.error);
  if (input.job.attempt < input.job.maxAttempts) {
    const retryDelayMs = calculateAiJobRetryDelayMs(input.job.attempt);
    const retryScheduledAt = new Date(Date.now() + retryDelayMs);
    const timeoutAt = agentNodeTimeoutAtForJob(input.job, retryDelayMs);
    const transition = await withAgentStateMachine((stateMachine) => stateMachine.updateNodeRetry({
      runId: input.run.runId,
      nodeId: input.node.id,
      message,
      timeoutAt,
      aiJobRunId: input.job.runId,
      aiJobAttempt: input.job.attempt,
      retryCount: Math.max(input.job.attempt, 1),
      retryScheduledAt,
      failureKind: input.failureKind,
    }));
    const payload = buildAgentRetryEventPayload({
      job: input.job,
      retryDelayMs,
      retryScheduledAt,
      timeoutAt,
      failureKind: input.failureKind,
      error: message,
    });
    if (transition.updated) {
      await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.retry_scheduled", `节点 ${input.node.label || input.node.id} 失败，已等待第 ${input.job.attempt + 1}/${input.job.maxAttempts} 次重试`, payload);
    } else {
      await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.retry_ignored", `节点 ${input.node.label || input.node.id} 的重试事件已忽略：Checkpoint 已变化`, {
        ...payload,
        checkpointStatus: transition.status,
        currentAiJobRunId: (transition as any).currentAiJobRunId || null,
        currentAiJobAttempt: (transition as any).currentAiJobAttempt ?? null,
      });
    }
    return { finalFailure: false, retryScheduled: transition.updated };
  }

  await failNodeExecution({
    run: input.run,
    node: input.node,
    error: input.error,
    sourceAiJobRunId: input.job.runId,
    sourceAiJobAttempt: input.job.attempt,
    failureKind: input.failureKind,
  });
  return { finalFailure: true, retryScheduled: false };
}

function resolveToolSlug(node: EmperorAgentNode): string | null {
  if (node.toolSlug) return node.toolSlug;
  if (node.nodeType === "mcp_node") {
    const slug = String((node as any).mcpSlug || "");
    return slug ? (slug.startsWith("mcp.") ? slug : `mcp.${slug}`) : null;
  }
  if (node.nodeType === "knowledge_node") return "internal.knowledge.query";
  return null;
}

async function executeToolBackedNode(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  nodeInput: unknown;
  userId: number;
}) {
  const inlineHttpTool = input.node.nodeType === "http_node";
  const toolSlug = inlineHttpTool ? "inline.http" : resolveToolSlug(input.node);
  if (!toolSlug) return null;

  const params = inlineHttpTool
    ? {
        nodeInput: input.nodeInput,
        url: (input.node as any).url,
        baseUrl: (input.node as any).baseUrl,
        path: (input.node as any).path,
        method: (input.node as any).method || "POST",
        headers: (input.node as any).headers,
        body: (input.node as any).body ?? input.nodeInput,
        timeoutMs: (input.node as any).timeoutSeconds ? Number((input.node as any).timeoutSeconds) * 1000 : undefined,
      }
    : {
        nodeInput: input.nodeInput,
        ...(typeof input.node.toolParams === "object" && input.node.toolParams ? input.node.toolParams as Record<string, unknown> : {}),
        ...(input.node.nodeType === "knowledge_node" ? { query: (input.node as any).query } : {}),
      };

  if (inlineHttpTool) {
    return invokeEmperorTool({
      toolSlug: "internal.http.request",
      params: {
        baseUrl: (input.node as any).baseUrl,
        url: (input.node as any).url,
        path: (input.node as any).path || "",
        method: (input.node as any).method || "POST",
        body: (input.node as any).body ?? input.nodeInput,
        headers: (input.node as any).headers,
        timeoutMs: (input.node as any).timeoutSeconds ? Number((input.node as any).timeoutSeconds) * 1000 : undefined,
      },
      userId: input.userId,
      workspaceId: input.run.workspaceId ?? null,
      runId: input.run.runId,
      nodeId: input.node.id,
      projectId: input.run.projectId ?? null,
    });
  }

  return invokeEmperorTool({
    toolSlug,
    params,
    userId: input.userId,
    workspaceId: input.run.workspaceId ?? null,
    runId: input.run.runId,
    nodeId: input.node.id,
    projectId: input.run.projectId ?? null,
  });
}

export async function startAgentRun(input: {
  slug: string;
  inputs: Record<string, unknown>;
  userId: number;
  workspaceId?: number | null;
  projectId?: number | null;
}) {
  const agent = await getAgentBySlug(input.slug, input.workspaceId ?? null);
  const workspaceId = input.workspaceId ?? agent.workspaceId ?? null;
  const templateVersion = await selectAgentTemplateVersionForRun({
    agent,
    userId: input.userId,
    projectId: input.projectId ?? null,
    workspaceId,
  });
  const dag = assertValidAgentDag(templateVersion?.dagDefinition || agent.dagDefinition, "start run");
  const nodeMetadata = new Map<string, Record<string, unknown>>();
  for (const node of dag.nodes) {
    nodeMetadata.set(node.id, await buildNodeRunMetadata(node, workspaceId));
  }
  const storedInputs = buildStoredAgentRunInputs({
    inputs: input.inputs,
    agentSlug: agent.slug,
    agentName: agent.name,
    templateVersionId: templateVersion?.id ?? null,
    templateVersion: templateVersion?.version ?? null,
    dag,
  });
  const runRuntime = parseStoredAgentRunInputs(storedInputs).runtime;

  const runId = generateRunId("agent");
  const rootNodeIds = dag.nodes.filter((node) => parentIds(dag, node.id).length === 0).map((node) => node.id);
  const firstReady = rootNodeIds[0] || dag.nodes[0].id;

  await rawExecute(
    "INSERT INTO emperor_agent_runs (workspaceId,runId,agentSlug,agentName,templateVersionId,templateVersion,dagHash,userId,projectId,status,currentNodeId,progress,inputs,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      workspaceId,
      runId,
      agent.slug,
      agent.name,
      templateVersion?.id ?? null,
      templateVersion?.version ?? null,
      runRuntime?.dagHash ?? templateVersion?.dagHash ?? null,
      input.userId,
      input.projectId ?? null,
      "waiting_human",
      firstReady,
      0,
      stringifyJson(storedInputs),
      new Date(),
    ],
  );

  for (const node of dag.nodes) {
    const status: AgentNodeStatus = rootNodeIds.includes(node.id) ? "ready" : "pending";
    await rawExecute(
      "INSERT INTO emperor_agent_checkpoints (workspaceId,runId,agentSlug,nodeId,nodeLabel,nodeType,status,maxAttempts,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
      [workspaceId, runId, agent.slug, node.id, node.label || node.id, node.nodeType || "skill_node", status, nodeMaxAttempts(node), stringifyJson(nodeMetadata.get(node.id) || { node })],
    );
  }

  await addEvent(runId, agent.slug, null, "run.started", `Agent ${agent.name} 已启动`, {
    inputs: input.inputs,
    dagHash: runRuntime?.dagHash || null,
    templateVersionId: templateVersion?.id ?? null,
    templateVersion: templateVersion?.version ?? null,
    skillSnapshots: [...nodeMetadata.values()].filter((metadata) => metadata.skillSnapshot).map((metadata) => metadata.skillSnapshot),
  });
  return getAgentRun(runId, input.userId, true);
}

export async function getAgentRun(runId: string, userId?: number, skipOwnerCheck = false) {
  const run = await getRunRow(runId);
  if (!skipOwnerCheck && userId && run.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Agent run" });
  }
  const agent = await getAgentBySlug(run.agentSlug);
  const storedInputs = parseStoredAgentRunInputs(run.inputs);
  const dag = normalizeAgentDag(storedInputs.runtime?.dagSnapshot || agent.dagDefinition);
  const checkpoints = await getCheckpoints(runId);
  const events = await rawExecute("SELECT * FROM emperor_agent_events WHERE runId=? ORDER BY createdAt ASC LIMIT 200", [runId]);
  const artifacts = await listAgentArtifacts({ runId, userId, skipOwnerCheck: true });
  return {
    run: {
      ...run,
      inputs: storedInputs.inputs,
      outputs: parseJson(run.outputs, {}),
      runtime: storedInputs.runtime,
    },
    agent,
    dag,
    checkpoints,
    events: events.map((event) => ({ ...event, payload: parseJson(event.payload) })),
    artifacts,
  };
}

async function unlockReadyNodes(runId: string, dag: EmperorAgentDag) {
  const checkpoints = await getCheckpoints(runId);
  const byNode = new Map(checkpoints.map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  const newlyReady: string[] = [];
  for (const node of dag.nodes) {
    const checkpoint = byNode.get(node.id);
    if (!checkpoint || checkpoint.status !== "pending") continue;
    const parents = parentIds(dag, node.id);
    const ready = parents.length === 0 || parents.every((parentId) => isConfirmedStatus(byNode.get(parentId)?.status || ""));
    if (!ready) continue;
    await withAgentStateMachine((stateMachine) => stateMachine.markNodeReady({ runId, nodeId: node.id, action: "unlock ready node" }));
    newlyReady.push(node.id);
  }
  return newlyReady;
}

export async function scheduleAgentRun(input: {
  runId: string;
  userId: number;
  mode?: "unlock" | "next" | "all_ready";
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  assertRunMutable(detail.run, "schedule run");
  const dag = normalizeAgentDag(detail.dag);
  const unlocked = await unlockReadyNodes(input.runId, dag);
  for (const nodeId of unlocked) {
    const node = dag.nodes.find((item) => item.id === nodeId);
    await addEvent(input.runId, detail.run.agentSlug, nodeId, "node.ready", `节点 ${node?.label || nodeId} 已就绪`);
  }
  await refreshRunAfterCheckpoint(input.runId, dag);

  if (!input.mode || input.mode === "unlock") {
    return getAgentRun(input.runId, input.userId, true);
  }

  const refreshed = await getAgentRun(input.runId, input.userId, true);
  const readyNodes = (refreshed.checkpoints as CheckpointRow[])
    .filter((checkpoint) => checkpoint.status === "ready")
    .map((checkpoint) => checkpoint.nodeId);
  const targetNodes = input.mode === "next" ? readyNodes.slice(0, 1) : readyNodes;
  for (const nodeId of targetNodes) {
    await executeAgentNode({ runId: input.runId, nodeId, userId: input.userId });
  }
  return getAgentRun(input.runId, input.userId, true);
}

export async function updateAgentNodeDraft(input: {
  runId: string;
  nodeId: string;
  userId: number;
  userEdit: unknown;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  assertRunMutable(detail.run, "update node draft");
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (!["waiting_human", "confirmed", "failed"].includes(checkpoint.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Node draft is not editable: ${checkpoint.status}` });
  }
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET userEdit=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(input.userEdit), input.runId, input.nodeId],
  );
  if (node) {
    await persistAgentArtifact({
      run: detail.run,
      node,
      status: "draft",
      content: input.userEdit,
      sourceSkillRunId: checkpoint.skillRunId || null,
      sourceAiJobRunId: checkpoint.aiJobRunId || null,
      metadata: {
        source: "updateNodeDraft",
        checkpointStatus: checkpoint.status,
        ...checkpointMetadata(checkpoint),
      },
    });
  }
  await addEvent(input.runId, detail.run.agentSlug, input.nodeId, "node.draft_saved", `节点 ${checkpoint.nodeLabel || input.nodeId} 草稿已保存`);
  await refreshRunAfterCheckpoint(input.runId, dag);
  return getAgentRun(input.runId, input.userId, true);
}

export async function rerunAgentNode(input: {
  runId: string;
  nodeId: string;
  userId: number;
  resetDescendants?: boolean;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  assertRunMutable(detail.run, "rerun node");
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Agent node not found" });
  const descendants = input.resetDescendants === false ? [] : descendantIds(dag, input.nodeId);
  const checkpointByNode = new Map((detail.checkpoints as CheckpointRow[]).map((checkpoint) => [checkpoint.nodeId, checkpoint]));

  const current = checkpointByNode.get(input.nodeId);
  if (current) assertNodeTransition(current.status, "ready", "rerun node");
  for (const descendantId of descendants) {
    const descendant = checkpointByNode.get(descendantId);
    if (descendant) assertNodeTransition(descendant.status, "pending", "reset descendant");
  }

  await withAgentStateMachine(async (stateMachine) => {
    await stateMachine.resetDescendants({ runId: input.runId, nodeIds: descendants });
    await stateMachine.resetNodeForRerun({ runId: input.runId, nodeId: input.nodeId });
  });
  await addEvent(input.runId, detail.run.agentSlug, input.nodeId, "node.rerun_requested", `节点 ${node.label || input.nodeId} 已请求重跑`, { resetDescendants: descendants });
  return executeAgentNode({ runId: input.runId, nodeId: input.nodeId, userId: input.userId });
}

export async function cancelAgentRun(input: {
  runId: string;
  userId: number;
  reason?: string;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  const run = detail.run;
  if (run.status === "canceled") return detail;

  const checkpoints = detail.checkpoints as CheckpointRow[];
  const runningAiJobCheckpoints = checkpoints
    .filter((checkpoint) => checkpoint.status === "running" && checkpoint.aiJobRunId)
    .map((checkpoint) => ({ nodeId: checkpoint.nodeId, nodeLabel: checkpoint.nodeLabel || checkpoint.nodeId, aiJobRunId: checkpoint.aiJobRunId as string, aiJobAttempt: checkpoint.aiJobAttempt ?? null }));
  await withAgentStateMachine((stateMachine) => stateMachine.cancelRun({
    runId: input.runId,
    reason: input.reason || "Agent run canceled",
    completedAt: new Date(),
  }));
  await Promise.all(runningAiJobCheckpoints.map(async (checkpoint) => {
    await cancelAiJob(checkpoint.aiJobRunId, input.reason || "Agent run canceled").catch(() => null);
    await addEvent(input.runId, run.agentSlug, checkpoint.nodeId, "node.job_canceled", `节点 ${checkpoint.nodeLabel} 的 Job 已取消`, {
      schemaVersion: "1.0",
      failureKind: "cancel",
      aiJobRunId: checkpoint.aiJobRunId,
      aiJobAttempt: checkpoint.aiJobAttempt,
      reason: input.reason || null,
    }).catch(() => null);
  }));
  await addEvent(input.runId, run.agentSlug, null, "run.canceled", "Agent Run 已取消", {
    reason: input.reason || null,
  });
  return getAgentRun(input.runId, input.userId, true);
}

export async function pauseAgentRun(input: {
  runId: string;
  userId: number;
  reason?: string;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  const run = detail.run;
  if (run.status === "paused") return detail;
  await withAgentStateMachine((stateMachine) => stateMachine.transitionRun({
    runId: input.runId,
    to: "paused",
    action: "pause run",
    errorMessage: input.reason || null,
  }));
  await addEvent(input.runId, run.agentSlug, null, "run.paused", "Agent Run 已暂停", {
    reason: input.reason || null,
  });
  return getAgentRun(input.runId, input.userId, true);
}

export async function resumeAgentRun(input: {
  runId: string;
  userId: number;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  const run = detail.run;
  if (run.status !== "paused") return detail;
  const dag = normalizeAgentDag(detail.dag);
  const checkpoints = detail.checkpoints as CheckpointRow[];
  const allDone = checkpoints.length > 0 && checkpoints.every((checkpoint) => isConfirmedStatus(checkpoint.status));
  const anyRunning = checkpoints.some((checkpoint) => checkpoint.status === "running");
  const nextStatus: AgentRunStatus = allDone ? "completed" : anyRunning ? "running" : "waiting_human";
  await withAgentStateMachine((stateMachine) => stateMachine.transitionRun({
    runId: input.runId,
    to: nextStatus,
    action: "resume run",
    clearError: true,
  }));
  await addEvent(input.runId, run.agentSlug, null, "run.resumed", "Agent Run 已恢复", { nextStatus });
  await unlockReadyNodes(input.runId, dag);
  await refreshRunAfterCheckpoint(input.runId, dag);
  return getAgentRun(input.runId, input.userId, true);
}

export async function recoverTimedOutAgentNodes(opts: { limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_checkpoints
     WHERE status='running' AND timeoutAt IS NOT NULL AND timeoutAt < NOW()
     ORDER BY timeoutAt ASC LIMIT ${limit}`,
  );
  const result = { scanned: rows.length, failed: 0, retried: 0, skippedPaused: 0, skippedStale: 0 };
  for (const row of rows) {
    const checkpoint = checkpointPayload(row);
    const run = await getRunRow(checkpoint.runId).catch(() => null);
    if (!run || run.status === "canceled" || run.status === "completed") continue;
    if (run.status === "paused") {
      result.skippedPaused += 1;
      continue;
    }

    const detail = await getAgentRun(checkpoint.runId, run.userId, true).catch(() => null);
    const dag = normalizeAgentDag(detail?.dag || { nodes: [], edges: [] });
    const node = dag.nodes.find((item) => item.id === checkpoint.nodeId) || {
      id: checkpoint.nodeId,
      label: checkpoint.nodeLabel || checkpoint.nodeId,
      nodeType: checkpoint.nodeType,
    } as EmperorAgentNode;
    const message = `Node timed out at ${checkpoint.timeoutAt instanceof Date ? checkpoint.timeoutAt.toISOString() : checkpoint.timeoutAt}`;
    const error = new Error(message);
    const job = checkpoint.aiJobRunId ? await getAiJobRun(checkpoint.aiJobRunId).catch(() => null) : null;

    await addEvent(checkpoint.runId, checkpoint.agentSlug, checkpoint.nodeId, "node.timeout", `节点 ${checkpoint.nodeLabel || checkpoint.nodeId} 执行超时`, {
      schemaVersion: "1.0",
      failureKind: "timeout",
      error: message,
      aiJobRunId: checkpoint.aiJobRunId || null,
      aiJobAttempt: checkpoint.aiJobAttempt ?? null,
    });

    if (job && job.status === "succeeded") {
      await addEvent(checkpoint.runId, checkpoint.agentSlug, checkpoint.nodeId, "node.timeout_ignored", `节点 ${checkpoint.nodeLabel || checkpoint.nodeId} 的超时已忽略：Job 已完成`, {
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        jobStatus: job.status,
      });
      result.skippedStale += 1;
      continue;
    }

    if (job && job.attempt < job.maxAttempts) {
      const retryRecord = await recordAgentNodeJobFailure({ run, node, job, error, failureKind: "timeout" });
      const retryResult = await retryAiJob(job.runId, error);
      if (retryRecord.retryScheduled && retryResult?.status === "queued") {
        result.retried += 1;
      } else if (retryResult?.status === "failed") {
        result.failed += 1;
      } else {
        result.skippedStale += 1;
      }
      continue;
    }

    if (job) {
      await failAiJob(job.runId, error);
      await recordAgentNodeJobFailure({ run, node, job, error, failureKind: "timeout" });
    } else {
      await failNodeExecution({ run, node, error, failureKind: "timeout" });
    }
    result.failed += 1;
  }
  return result;
}

export async function confirmAgentNode(input: {
  runId: string;
  nodeId: string;
  userId: number;
  output?: unknown;
  userEdit?: unknown;
  skip?: boolean;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  assertRunMutable(detail.run, "confirm node");
  const dag = normalizeAgentDag(detail.dag);
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  const nextStatus: AgentNodeStatus = input.skip ? "skipped" : "confirmed";
  if (checkpoint.status === nextStatus) {
    await addEvent(input.runId, checkpoint.agentSlug, input.nodeId, "node.confirm_deduped", `节点 ${checkpoint.nodeLabel || input.nodeId} 已是${input.skip ? "跳过" : "确认"}状态`);
    return getAgentRun(input.runId, input.userId, true);
  }
  if (checkpoint.status !== "waiting_human") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Node is not confirmable: ${checkpoint.status}` });
  }
  await withAgentStateMachine((stateMachine) => stateMachine.confirmNode({
    runId: input.runId,
    nodeId: input.nodeId,
    to: nextStatus,
    output: input.output,
    userEdit: input.userEdit === undefined ? checkpoint.userEdit ?? null : input.userEdit,
    reviewerUserId: input.userId,
    confirmedAt: new Date(),
  }));
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  if (node) {
    const finalContent = input.skip
      ? { skipped: true, previousOutput: effectiveCheckpointOutput(checkpoint) }
      : input.userEdit !== undefined
        ? input.userEdit
        : input.output !== undefined
          ? input.output
          : effectiveCheckpointOutput(checkpoint);
    await persistAgentArtifact({
      run: detail.run,
      node,
      status: "final",
      content: finalContent,
      sourceSkillRunId: checkpoint.skillRunId || null,
      sourceAiJobRunId: checkpoint.aiJobRunId || null,
      metadata: {
        source: "confirmNode",
        skipped: input.skip === true,
        ...checkpointMetadata(checkpoint),
      },
    });
    const humanEditRate = input.skip ? 0 : estimateAgentHumanEditRate(effectiveCheckpointOutput(checkpoint), finalContent);
    void recordAiOsMetric({
      entityType: "agent_node",
      entityId: `${input.runId}:${input.nodeId}`,
      metricName: "agent_node.human_edit_rate",
      metricValue: humanEditRate,
      status: nextStatus,
      workspaceId: detail.run.workspaceId ?? null,
      userId: input.userId,
      projectId: detail.run.projectId ?? null,
      agentSlug: checkpoint.agentSlug,
      nodeId: input.nodeId,
      skillSlug: node.skillSlug || null,
      metadata: { skipped: input.skip === true, outputKey: node.outputKey || node.id },
    });
    void recordAiOsEvaluation({
      entityType: "agent_node",
      entityId: `${input.runId}:${input.nodeId}:confirmed`,
      output: finalContent,
      status: nextStatus,
      workspaceId: detail.run.workspaceId ?? null,
      userId: input.userId,
      projectId: detail.run.projectId ?? null,
      agentSlug: checkpoint.agentSlug,
      nodeId: input.nodeId,
      skillSlug: node.skillSlug || null,
      humanEditRate,
      retryCount: checkpoint.retryCount || 0,
      metadata: { skipped: input.skip === true, outputKey: node.outputKey || node.id },
    });
  }
  await addEvent(input.runId, checkpoint.agentSlug, input.nodeId, input.skip ? "node.skipped" : "node.confirmed", `节点 ${checkpoint.nodeLabel || input.nodeId} 已${input.skip ? "跳过" : "确认"}`);
  await unlockChildren(input.runId, dag, input.nodeId);
  await unlockReadyNodes(input.runId, dag);
  await refreshRunAfterCheckpoint(input.runId, dag);
  return getAgentRun(input.runId, input.userId, true);
}

export async function executeAgentNode(input: {
  runId: string;
  nodeId: string;
  userId: number;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  const run = detail.run;
  assertRunMutable(run, "execute node");
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Agent node not found" });
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (checkpoint.status === "running") {
    await addEvent(input.runId, run.agentSlug, input.nodeId, "node.execution_deduped", `节点 ${node.label || node.id} 已在执行中，忽略重复执行请求`);
    return getAgentRun(input.runId, input.userId, true);
  }
  if (!["ready", "waiting_human", "failed"].includes(checkpoint.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Node is not executable: ${checkpoint.status}` });
  }

  const nodeInput = buildNodeInput(run, dag, node, detail.checkpoints, detail.artifacts);
  const metadata = checkpointMetadata(checkpoint);
  const binding = resolveAgentNodeSkillBinding(node);
  const skillSnapshot = metadata.skillSnapshot && typeof metadata.skillSnapshot === "object"
    ? metadata.skillSnapshot as SkillRuntimeSnapshot
    : null;
  const lockToken = generateRunId("node_lock");
  const lockedAt = new Date();
  const timeoutAt = nodeTimeoutAt(node);
  await withAgentStateMachine((stateMachine) => stateMachine.claimNodeRunning({
    runId: input.runId,
    nodeId: input.nodeId,
    nodeInput,
    lockToken,
    lockedAt,
    timeoutAt,
    allowedFromStatuses: ["ready", "waiting_human", "failed"],
    action: "execute node",
  }));
  await addEvent(input.runId, run.agentSlug, input.nodeId, "node.running", `节点 ${node.label || node.id} 开始执行`, { nodeInput });

  try {
    const toolResult = await executeToolBackedNode({ run, dag, node, nodeInput, userId: input.userId });
    if (toolResult) {
      await addEvent(input.runId, run.agentSlug, input.nodeId, "tool.invoked", `Tool ${toolResult.toolSlug} 调用完成`, {
        toolSlug: toolResult.toolSlug,
        type: toolResult.type,
        metadata: toolResult.metadata,
      });
      await finalizeNodeOutput({
        run,
        dag,
        node,
        userId: input.userId,
        output: toolResult,
        completedMessage: `节点 ${node.label || node.id} 已通过 Tool Gateway 生成，等待人工确认`,
      });
      return getAgentRun(input.runId, input.userId, true);
    }

    if (node.nodeType !== "skill_node" || !node.skillSlug) {
      await finalizeNodeOutput({
        run,
        dag,
        node,
        userId: input.userId,
        output: {
          nodeId: node.id,
          label: node.label,
          input: nodeInput,
          note: "此节点无需 AI/Tool 调用，已生成可编辑确认产物。",
        },
        completedMessage: `节点 ${node.label || node.id} 等待人工确认`,
      });
      return getAgentRun(input.runId, input.userId, true);
    }
  } catch (error) {
    await failNodeExecution({ run, node, error });
    throw error;
  }

  let job: AiJobSnapshot | null = null;
  try {
    const createdJob = await startRegisteredAiJob({
      kind: `agent.node.${node.id}`,
      module: "emperorAgent",
      procedure: "emperor.agents.executeNode",
      userId: input.userId,
      workspaceId: run.workspaceId ?? null,
      projectId: run.projectId ?? null,
      skillSlug: node.skillSlug,
      maxAttempts: nodeMaxAttempts(node),
      timeoutSeconds: Number(node.timeoutSeconds || 600),
      input: {
        runId: input.runId,
        agentSlug: run.agentSlug,
        nodeId: node.id,
        skillSlug: node.skillSlug,
        skillVersionPolicy: metadata.skillVersionPolicy || binding.policy,
        expectedSkillVersion: skillSnapshot?.version || binding.pinnedVersion || null,
        expectedSkillPromptHash: skillSnapshot?.systemPromptHash || null,
        skillSnapshot,
        nodeInput,
      },
      progress: 5,
    });
    job = createdJob;

    await withAgentStateMachine((stateMachine) => stateMachine.attachNodeAiJob({
      runId: input.runId,
      nodeId: input.nodeId,
      aiJobRunId: createdJob.runId,
      aiJobAttempt: createdJob.attempt,
      lockToken,
    }));
  } catch (error) {
    if (job?.runId) {
      await cancelAiJob(job.runId, "Agent node AI job attach failed").catch(() => null);
    }
    await failNodeExecution({ run, node, error });
    throw error;
  }
  return getAgentRun(input.runId, input.userId, true);
}

function parseAgentNodeJobInput(job: AiJobSnapshot): {
  runId: string;
  nodeId: string;
  skillSlug: string;
  skillVersionPolicy: SkillVersionPolicy;
  expectedSkillVersion?: string | number | null;
  expectedSkillPromptHash?: string | null;
  skillSnapshot?: SkillRuntimeSnapshot | null;
  nodeInput: unknown;
} {
  const payload = job.input as Record<string, unknown> | null;
  const runId = String(payload?.runId || "");
  const nodeId = String(payload?.nodeId || "");
  const skillSlug = String(payload?.skillSlug || job.skillSlug || "");
  const rawPolicy = String(payload?.skillVersionPolicy || "snapshot");
  const skillVersionPolicy: SkillVersionPolicy = rawPolicy === "latest" || rawPolicy === "pinned" || rawPolicy === "snapshot"
    ? rawPolicy
    : "snapshot";
  if (!runId || !nodeId || !skillSlug) {
    throw new Error("Invalid Agent node job input");
  }
  return {
    runId,
    nodeId,
    skillSlug,
    skillVersionPolicy,
    expectedSkillVersion: payload?.expectedSkillVersion as string | number | null | undefined,
    expectedSkillPromptHash: payload?.expectedSkillPromptHash as string | null | undefined,
    skillSnapshot: payload?.skillSnapshot && typeof payload.skillSnapshot === "object"
      ? payload.skillSnapshot as SkillRuntimeSnapshot
      : null,
    nodeInput: payload?.nodeInput ?? null,
  };
}

async function runAgentNodeSkillJob(job: AiJobSnapshot) {
  const payload = parseAgentNodeJobInput(job);
  const detail = await getAgentRun(payload.runId, job.userId);
  const run = detail.run;
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === payload.nodeId);
  if (!node) throw new Error(`Agent node not found: ${payload.nodeId}`);
  const checkpoint = await getCheckpoint(payload.runId, payload.nodeId);

  if (["waiting_human", "confirmed", "skipped"].includes(checkpoint.status)) {
    return {
      deduped: true,
      status: checkpoint.status,
      output: effectiveCheckpointOutput(checkpoint),
    };
  }
  if (checkpoint.status !== "running" || checkpoint.aiJobRunId !== job.runId) {
    await addEvent(payload.runId, run.agentSlug, node.id, "node.job_stale_ignored", `节点 ${node.label || node.id} 的 Job 已忽略：Checkpoint 已变化`, {
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      checkpointStatus: checkpoint.status,
      currentAiJobRunId: checkpoint.aiJobRunId || null,
      currentAiJobAttempt: checkpoint.aiJobAttempt ?? null,
    });
    return {
      deduped: true,
      stale: true,
      status: checkpoint.status,
    };
  }
  const jobAttemptClaim = await recordAgentNodeJobAttempt({ run, node, job });
  if (!jobAttemptClaim.recorded) {
    return {
      deduped: true,
      stale: true,
      status: jobAttemptClaim.status,
      currentAiJobRunId: jobAttemptClaim.currentAiJobRunId || null,
      currentAiJobAttempt: jobAttemptClaim.currentAiJobAttempt ?? null,
    };
  }

  try {
    const result = await runEmperorSkill({
      skillSlug: payload.skillSlug,
      userId: job.userId,
      workspaceId: run.workspaceId ?? job.workspaceId ?? null,
      context: buildSkillContext(node, payload.nodeInput),
      variables: {
        agentRunId: payload.runId,
        nodeId: node.id,
        nodeInput: payload.nodeInput,
      },
      skillVersionPolicy: payload.skillVersionPolicy,
      expectedSkillVersion: payload.expectedSkillVersion ?? undefined,
      expectedSkillPromptHash: payload.expectedSkillPromptHash || undefined,
      validate: (content) => safeParseSkillJSON(content),
    });
    await finalizeNodeOutput({
      run,
      dag,
      node,
      userId: job.userId,
      output: result,
      skillRunId: result.runId,
      sourceAiJobRunId: job.runId,
      sourceAiJobAttempt: job.attempt,
      runtimeMetadata: {
        skillVersionPolicy: payload.skillVersionPolicy,
        skillSnapshot: payload.skillSnapshot || null,
        skillRun: {
          runId: result.runId,
          skillSlug: result.skillSlug,
          skillVersion: result.skillVersion,
          skillPromptHash: result.skillPromptHash,
          skillManifestHash: result.skillManifestHash,
          modelSlug: result.modelSlug,
          provider: result.provider,
          durationMs: result.durationMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          fallbackCount: result.fallbackCount,
        },
      },
      completedMessage: `节点 ${node.label || node.id} 已生成，等待人工确认`,
    });
    return result;
  } catch (error) {
    await recordAgentNodeJobFailure({ run, node, job, error, failureKind: "error" });
    throw error;
  }
}

registerAiJobHandler({
  id: "emperorAgent.nodeSkill",
  match: (job) => job.module === "emperorAgent" && job.procedure === "emperor.agents.executeNode",
  handler: runAgentNodeSkillJob,
});

export { nodeRequiresHumanGate, AgentNodeJobFailureKind, agentErrorMessage, agentNodeTimeoutAtForJob, recordAgentNodeJobAttempt, finalizeNodeOutput, failNodeExecution, recordAgentNodeJobFailure, resolveToolSlug, executeToolBackedNode, unlockReadyNodes, parseAgentNodeJobInput, runAgentNodeSkillJob };
