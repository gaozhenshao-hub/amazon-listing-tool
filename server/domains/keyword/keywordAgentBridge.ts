import {
  ensureBusinessManagedRun,
  markBusinessManagedNodeCanceled,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
} from "../ai_os/services/businessManagedAgent";
import {
  recordAgentTemplateVersion,
  type EmperorAgentDag,
  type EmperorAgentNode,
} from "../ai_os/services/agentRunner";
import { rawExecute } from "../ai_os/routerContext";

export const KEYWORD_WORKFLOW_AGENT_SLUG = "keyword.analysis.workflow";

export const KEYWORD_OPERATION_NODE_MAP = {
  trafficComp: "K1",
  filter: "K2",
  tag: "K3",
  classify: "K4",
  matrix: "K5",
  layout: "K6",
} as const;

export type KeywordOperation = keyof typeof KEYWORD_OPERATION_NODE_MAP;

const nodeConfig: Record<KeywordOperation, { label: string; skillSlug: string; x: number; y: number }> = {
  trafficComp: { label: "K1 · 流量/竞争度分类", skillSlug: "keyword.traffic.classify", x: 40, y: 80 },
  filter: { label: "K2 · 语义过滤", skillSlug: "keyword.semantic.filter", x: 300, y: 80 },
  tag: { label: "K3 · COSMO 场景打标", skillSlug: "keyword.scene.tag", x: 560, y: 80 },
  classify: { label: "K4 · 词根分类", skillSlug: "keyword.root.classify", x: 40, y: 320 },
  matrix: { label: "K5 · 3D 策略矩阵", skillSlug: "keyword.strategy.matrix", x: 300, y: 320 },
  layout: { label: "K6 · Listing 布局", skillSlug: "keyword.listing.layout", x: 560, y: 320 },
};

export function getKeywordAgentDag(): EmperorAgentDag {
  const nodes: EmperorAgentNode[] = (Object.keys(KEYWORD_OPERATION_NODE_MAP) as KeywordOperation[]).map((operation) => {
    const config = nodeConfig[operation];
    return {
      id: KEYWORD_OPERATION_NODE_MAP[operation],
      nodeType: "skill_node",
      label: config.label,
      subtitle: "由关键词业务页面运行、审阅与确认",
      skillSlug: config.skillSlug,
      skillVersionPolicy: "snapshot",
      outputKey: operation,
      humanGate: true,
      required: operation !== "layout",
      scheduler: "manual",
      executionOwner: "keyword.workbench",
      businessRoute: "/listing/keywords?projectId={{projectId}}&tab=pipeline",
      x: config.x,
      y: config.y,
    };
  });
  const operations = Object.keys(KEYWORD_OPERATION_NODE_MAP) as KeywordOperation[];
  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "关键词六步分析流水线。Skill 提供能力，Job 负责后台执行，业务页面负责确认。",
    executionOwner: "keyword.workbench",
    businessRoute: "/listing/keywords?projectId={{projectId}}&tab=pipeline",
    nodes,
    edges: operations.slice(0, -1).map((operation, index) => ({
      id: `${KEYWORD_OPERATION_NODE_MAP[operation]}-${KEYWORD_OPERATION_NODE_MAP[operations[index + 1]]}`,
      source: KEYWORD_OPERATION_NODE_MAP[operation],
      target: KEYWORD_OPERATION_NODE_MAP[operations[index + 1]],
      from: KEYWORD_OPERATION_NODE_MAP[operation],
      to: KEYWORD_OPERATION_NODE_MAP[operations[index + 1]],
      label: "建议顺序",
      kind: "suggested",
      required: false,
    })),
  };
}

export async function ensureKeywordAgentTemplate() {
  const dag = getKeywordAgentDag();
  const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug=? LIMIT 1", [KEYWORD_WORKFLOW_AGENT_SLUG]);
  if (!existing[0]) {
    await rawExecute(
      `INSERT INTO emperor_agents
       (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,?, 'active','project','manual',1800,?)`,
      [
        KEYWORD_WORKFLOW_AGENT_SLUG,
        "关键词分析流水线",
        "关键词六步 Job/Skill 人机协同工作流。",
        "关键词",
        JSON.stringify(dag),
      ],
    );
  } else {
    await rawExecute(
      "UPDATE emperor_agents SET name=?,description=?,category=?,dagDefinition=?,status='active',updatedAt=NOW() WHERE slug=?",
      ["关键词分析流水线", "关键词六步 Job/Skill 人机协同工作流。", "关键词", JSON.stringify(dag), KEYWORD_WORKFLOW_AGENT_SLUG],
    );
  }
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: KEYWORD_WORKFLOW_AGENT_SLUG,
    agentName: "关键词分析流水线",
    dag,
    status: "released",
    releaseNotes: "关键词六步 Job/Checkpoint/Artifact 实时绑定",
    isDefault: true,
    rolloutPercent: 100,
  });
  return dag;
}

export async function ensureKeywordAgentRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  const dag = await ensureKeywordAgentTemplate();
  const ensured = await ensureBusinessManagedRun({
    agentSlug: KEYWORD_WORKFLOW_AGENT_SLUG,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    requireMutable: true,
    inputs: { workflow: "keyword.analysis", schemaVersion: "1.0" },
  });
  return { runId: (ensured.detail as any).run.runId as string, dag };
}

type KeywordAgentSyncInput = {
  operation: KeywordOperation;
  projectId: number;
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

async function resolveRun(input: KeywordAgentSyncInput) {
  if (input.agentRunId) return { runId: input.agentRunId, dag: getKeywordAgentDag() };
  return ensureKeywordAgentRun(input);
}

export async function syncKeywordNodeQueued(input: KeywordAgentSyncInput & { aiJobRunId: string }) {
  const run = await resolveRun(input);
  const nodeId = KEYWORD_OPERATION_NODE_MAP[input.operation];
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
      source: "keyword_generation_job",
      businessJobStatus: "queued",
      businessJobAttempt: input.aiJobAttempt ?? 0,
      businessJobMaxAttempts: input.maxAttempts ?? null,
      retryPending: false,
    },
  });
  return run.runId;
}

export async function syncKeywordNodeProgress(input: KeywordAgentSyncInput & { aiJobRunId: string }) {
  const run = await resolveRun(input);
  const nodeId = KEYWORD_OPERATION_NODE_MAP[input.operation];
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
      source: "keyword_generation_job",
      businessJobStatus: input.error ? "retrying" : "running",
      businessJobAttempt: input.aiJobAttempt ?? 1,
      businessJobMaxAttempts: input.maxAttempts ?? null,
      retryPending: Boolean(input.error),
    },
  });
  return run.runId;
}

export async function syncKeywordNodeWaitingHuman(input: KeywordAgentSyncInput & { aiJobRunId: string }) {
  const run = await resolveRun(input);
  await markBusinessManagedNodeWaitingHuman({
    runId: run.runId,
    dag: run.dag,
    nodeId: KEYWORD_OPERATION_NODE_MAP[input.operation],
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? null,
    output: input.output,
    metadata: { source: "keyword_generation_job", businessJobStatus: "waiting_human", retryPending: false },
  });
  return run.runId;
}

export async function syncKeywordNodeFailure(input: KeywordAgentSyncInput & {
  aiJobRunId: string;
  finalAttempt: boolean;
  failureKind?: "error" | "timeout" | "cancel";
}) {
  const run = await resolveRun(input);
  const mutationInput = {
    runId: run.runId,
    dag: run.dag,
    nodeId: KEYWORD_OPERATION_NODE_MAP[input.operation],
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? null,
    progress: input.progress ?? 10,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error || "关键词分析失败"),
    metadata: {
      source: "keyword_generation_job",
      businessJobStatus: input.failureKind === "cancel" ? "canceled" : input.finalAttempt ? "failed" : "retrying",
      retryPending: !input.finalAttempt,
    },
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
}

export async function confirmKeywordNode(input: KeywordAgentSyncInput & { output: unknown }) {
  const run = await resolveRun(input);
  await markBusinessManagedNodeConfirmed({
    runId: run.runId,
    dag: run.dag,
    nodeId: KEYWORD_OPERATION_NODE_MAP[input.operation],
    output: input.output,
    userEdit: input.output,
    userId: input.userId,
    metadata: { source: "keyword_workbench_confirm", projectId: input.projectId },
  });
  return run.runId;
}

// Backward-compatible bridge for older call sites while all generation moves to Job execution.
export async function syncKeywordStepToAgent(input: {
  stepKey: "trafficClassify" | "semanticFilter" | "sceneTag" | "rootClassify" | "strategyMatrix" | "listingLayout";
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  output?: unknown;
}) {
  const legacyMap = {
    trafficClassify: "trafficComp",
    semanticFilter: "filter",
    sceneTag: "tag",
    rootClassify: "classify",
    strategyMatrix: "matrix",
    listingLayout: "layout",
  } as const;
  const operation = legacyMap[input.stepKey];
  const run = await resolveRun({ ...input, operation });
  await markBusinessManagedNodeWaitingHuman({
    runId: run.runId,
    dag: run.dag,
    nodeId: KEYWORD_OPERATION_NODE_MAP[operation],
    output: input.output,
    userId: input.userId,
    metadata: { source: "keyword_workbench_step", projectId: input.projectId },
  });
  return run.runId;
}

export async function syncFullPipelineToAgent(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  pipelineResult: Record<string, unknown>;
}) {
  const run = await ensureKeywordAgentRun(input);
  const outputs: Partial<Record<KeywordOperation, unknown>> = {
    trafficComp: input.pipelineResult.trafficCompetition,
    filter: input.pipelineResult.filter,
    tag: input.pipelineResult.tag,
    classify: input.pipelineResult.classify,
    matrix: input.pipelineResult.matrix,
    layout: input.pipelineResult.listingLayout,
  };
  for (const operation of Object.keys(outputs) as KeywordOperation[]) {
    if (outputs[operation] === undefined) continue;
    await confirmKeywordNode({ ...input, operation, agentRunId: run.runId, output: outputs[operation] }).catch(() => null);
  }
}
