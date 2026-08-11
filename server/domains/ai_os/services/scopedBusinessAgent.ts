import {
  markBusinessManagedNodeCanceled,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
} from "./businessManagedAgent";
import {
  getAgentRun,
  recordAgentTemplateVersion,
  startAgentRun,
  type EmperorAgentDag,
} from "./agentRunner";
import { rawExecute } from "../routerContext";

export const SCOPED_BUSINESS_AGENT_CONFIG = {
  adSearchTerm: {
    agentSlug: "ads.search-term.workflow",
    agentName: "广告搜索词优化",
    category: "广告",
    nodeId: "search_term_advice",
    nodeLabel: "搜索词优化建议",
    skillSlug: "ad.searchterm.advice",
    businessRoute: "/ops/ads?tab=search-terms",
  },
  opsReplenishment: {
    agentSlug: "ops.replenishment.workflow",
    agentName: "运营补货计划",
    category: "运营",
    nodeId: "replenishment_plan",
    nodeLabel: "智能补货建议",
    skillSlug: "ops.inventory.analysis",
    businessRoute: "/ops/inventory?tab=predictions",
  },
} as const;

export type ScopedBusinessAgentKind = keyof typeof SCOPED_BUSINESS_AGENT_CONFIG;

function getDag(kind: ScopedBusinessAgentKind): EmperorAgentDag {
  const config = SCOPED_BUSINESS_AGENT_CONFIG[kind];
  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: `${config.agentName}业务托管工作流。Skill 提供能力，Job 负责执行，业务页面负责确认。`,
    executionOwner: "business_page",
    businessRoute: config.businessRoute,
    nodes: [{
      id: config.nodeId,
      nodeType: "skill_node",
      label: config.nodeLabel,
      subtitle: "由业务页面运行、编辑与确认",
      skillSlug: config.skillSlug,
      skillVersionPolicy: "snapshot",
      outputKey: config.nodeId,
      humanGate: true,
      required: true,
      scheduler: "manual",
      executionOwner: "business_page",
      businessRoute: config.businessRoute,
      x: 80,
      y: 80,
    }],
    edges: [],
  };
}

async function ensureTemplate(kind: ScopedBusinessAgentKind) {
  const config = SCOPED_BUSINESS_AGENT_CONFIG[kind];
  const dag = getDag(kind);
  const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug=? LIMIT 1", [config.agentSlug]);
  if (!existing[0]) {
    await rawExecute(
      `INSERT INTO emperor_agents
       (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,?, 'active','private','manual',900,?)`,
      [config.agentSlug, config.agentName, `${config.agentName}业务托管工作流。`, config.category, JSON.stringify(dag)],
    );
  } else {
    await rawExecute(
      "UPDATE emperor_agents SET name=?,description=?,category=?,dagDefinition=?,status='active',updatedAt=NOW() WHERE slug=?",
      [config.agentName, `${config.agentName}业务托管工作流。`, config.category, JSON.stringify(dag), config.agentSlug],
    );
  }
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: config.agentSlug,
    agentName: config.agentName,
    dag,
    status: "released",
    releaseNotes: "业务 Job/Checkpoint/Artifact 实时绑定",
    isDefault: true,
    rolloutPercent: 100,
  });
  return dag;
}

function workspaceScope(workspaceId?: number | null) {
  return workspaceId === null || workspaceId === undefined
    ? { clause: "workspaceId IS NULL", params: [] as unknown[] }
    : { clause: "workspaceId=?", params: [workspaceId] as unknown[] };
}

export async function ensureScopedBusinessAgentRun(input: {
  kind: ScopedBusinessAgentKind;
  userId: number;
  workspaceId?: number | null;
  inputs?: Record<string, unknown>;
}) {
  const config = SCOPED_BUSINESS_AGENT_CONFIG[input.kind];
  const dag = await ensureTemplate(input.kind);
  const scope = workspaceScope(input.workspaceId);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_runs
     WHERE agentSlug=? AND userId=? AND projectId IS NULL AND ${scope.clause}
     ORDER BY createdAt DESC,id DESC LIMIT 1`,
    [config.agentSlug, input.userId, ...scope.params],
  );
  const latest = rows[0];
  if (latest && !["completed", "canceled"].includes(latest.status)) {
    return { runId: latest.runId as string, dag, detail: await getAgentRun(latest.runId, undefined, true), created: false };
  }
  const detail = await startAgentRun({
    slug: config.agentSlug,
    inputs: { executionOwner: "business_page", ...(input.inputs || {}) },
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    projectId: null,
  });
  return { runId: (detail as any).run.runId as string, dag, detail, created: true };
}

type SyncInput = {
  kind: ScopedBusinessAgentKind;
  userId: number;
  workspaceId?: number | null;
  agentRunId?: string | null;
  aiJobRunId?: string | null;
  aiJobAttempt?: number | null;
  maxAttempts?: number | null;
  progress?: number;
  output?: unknown;
  error?: unknown;
};

async function resolveRun(input: SyncInput) {
  if (input.agentRunId) return { runId: input.agentRunId, dag: getDag(input.kind) };
  return ensureScopedBusinessAgentRun(input);
}

export async function syncScopedBusinessAgentQueued(input: SyncInput & { aiJobRunId: string }) {
  const run = await resolveRun(input);
  const nodeId = SCOPED_BUSINESS_AGENT_CONFIG[input.kind].nodeId;
  await markBusinessManagedNodeRunning({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? 0,
    progress: input.progress ?? 5,
    allowJobReplacement: true,
  });
  await markBusinessManagedNodeProgress({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? 0,
    progress: input.progress ?? 5,
    metadata: {
      source: "scoped_business_job",
      businessJobStatus: "queued",
      businessJobAttempt: input.aiJobAttempt ?? 0,
      businessJobMaxAttempts: input.maxAttempts ?? null,
      retryPending: false,
    },
  });
  return run.runId;
}

export async function syncScopedBusinessAgentProgress(input: SyncInput & { aiJobRunId: string }) {
  const run = await resolveRun(input);
  const nodeId = SCOPED_BUSINESS_AGENT_CONFIG[input.kind].nodeId;
  await markBusinessManagedNodeRunning({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? 1,
    progress: input.progress ?? 10,
    allowJobReplacement: true,
  });
  await markBusinessManagedNodeProgress({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? 1,
    progress: input.progress ?? 10,
    errorMessage: input.error ? String(input.error) : null,
    metadata: {
      source: "scoped_business_job",
      businessJobStatus: input.error ? "retrying" : "running",
      businessJobAttempt: input.aiJobAttempt ?? 1,
      businessJobMaxAttempts: input.maxAttempts ?? null,
      retryPending: Boolean(input.error),
    },
  });
  return run.runId;
}

export async function syncScopedBusinessAgentWaitingHuman(input: SyncInput & { aiJobRunId: string; output: unknown }) {
  const run = await resolveRun(input);
  await markBusinessManagedNodeWaitingHuman({
    runId: run.runId,
    dag: run.dag,
    nodeId: SCOPED_BUSINESS_AGENT_CONFIG[input.kind].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? null,
    output: input.output,
    metadata: { source: "scoped_business_job", businessJobStatus: "waiting_human", retryPending: false },
  });
  return run.runId;
}

export async function syncScopedBusinessAgentFailure(input: SyncInput & {
  aiJobRunId: string;
  finalAttempt: boolean;
  failureKind?: "error" | "timeout" | "cancel";
}) {
  const run = await resolveRun(input);
  const mutationInput = {
    runId: run.runId,
    dag: run.dag,
    nodeId: SCOPED_BUSINESS_AGENT_CONFIG[input.kind].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? null,
    progress: input.progress ?? 10,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error || "业务 AI 任务失败"),
    metadata: {
      source: "scoped_business_job",
      businessJobStatus: input.failureKind === "cancel" ? "canceled" : input.finalAttempt ? "failed" : "retrying",
      retryPending: !input.finalAttempt,
    },
  };
  if (input.failureKind === "cancel") return markBusinessManagedNodeCanceled(mutationInput);
  return markBusinessManagedNodeFailed({
    ...mutationInput,
    finalAttempt: input.finalAttempt,
    failureKind: input.failureKind || "error",
  });
}

export async function confirmScopedBusinessAgentOutput(input: SyncInput & { output: unknown }) {
  const run = await resolveRun(input);
  await markBusinessManagedNodeConfirmed({
    runId: run.runId,
    dag: run.dag,
    nodeId: SCOPED_BUSINESS_AGENT_CONFIG[input.kind].nodeId,
    output: input.output,
    userEdit: input.output,
    userId: input.userId,
    metadata: { source: "scoped_business_confirm" },
  });
  return run.runId;
}
