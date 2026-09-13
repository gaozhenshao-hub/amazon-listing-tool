import {
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeRunning,
} from "../ai_os/services/businessManagedAgent";
import { recordAgentTemplateVersion, startAgentRun } from "../ai_os/services/agentRunner";
import type { EmperorAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { rawExecute } from "../ai_os/routerContext";
import type { AmazonMonitorKind } from "./monitorProviderContracts";

const config = {
  competitor: { slug: "amazon.monitor.competitor", name: "Amazon竞品价格与BSR监控", nodeId: "provider_snapshot" },
  keyword: { slug: "amazon.monitor.keyword-rank", name: "Amazon关键词排名监控", nodeId: "provider_snapshot" },
} as const;

export function monitorAgentDag(kind: AmazonMonitorKind): EmperorAgentDag {
  const item = config[kind];
  return {
    version: "1.0.0",
    workflowType: "tool_job",
    description: "管理员批准的受控Provider → 原始S3证据 → 结构化监控快照；未资格能力失败关闭且不回退旧爬虫。",
    executionOwner: "amazon.monitoring",
    businessRoute: "/ops/crawler",
    nodes: [{
      id: item.nodeId,
      nodeType: "operation_node",
      label: item.name,
      subtitle: "受控Provider Job / Run",
      outputKey: "providerSnapshot",
      humanGate: false,
      autoConfirm: true,
      required: true,
      scheduler: "auto",
      executionOwner: "amazon.monitoring",
      businessRoute: "/ops/crawler",
      x: 80,
      y: 80,
    }],
    edges: [],
  };
}

async function ensureTemplate(kind: AmazonMonitorKind) {
  const item = config[kind];
  const dag = monitorAgentDag(kind);
  const rows = await rawExecute("SELECT id FROM emperor_agents WHERE slug=? LIMIT 1", [item.slug]);
  if (!rows[0]) {
    await rawExecute(
      `INSERT INTO emperor_agents (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,'运营监控','active','project','scheduled',600,?)`,
      [item.slug, item.name, dag.description, JSON.stringify(dag)],
    );
  } else {
    await rawExecute("UPDATE emperor_agents SET name=?,description=?,dagDefinition=?,status='active',updatedAt=NOW() WHERE slug=?", [
      item.name, dag.description, JSON.stringify(dag), item.slug,
    ]);
  }
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: item.slug,
    agentName: item.name,
    dag,
    status: "released",
    releaseNotes: "A8：统一Provider监控与Heartbeat迁移",
    isDefault: true,
    rolloutPercent: 100,
  });
  return dag;
}

export async function startMonitorAgentRun(input: {
  kind: AmazonMonitorKind;
  monitorRunId: number;
  monitorId: number | null;
  workspaceId: number;
  userId: number;
  asin: string;
}) {
  const dag = await ensureTemplate(input.kind);
  const item = config[input.kind];
  const detail = await startAgentRun({
    slug: item.slug,
    inputs: { monitorRunId: input.monitorRunId, monitorId: input.monitorId, kind: input.kind, asin: input.asin, executionOwner: "amazon.monitoring" },
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.monitorId ?? input.monitorRunId,
  });
  return { agentRunId: (detail as any).run.runId as string, agentNodeId: item.nodeId, dag };
}

export async function markMonitorAgentRunning(input: { kind: AmazonMonitorKind; agentRunId: string; aiJobRunId: string; attempt: number }) {
  return markBusinessManagedNodeRunning({
    runId: input.agentRunId,
    dag: monitorAgentDag(input.kind),
    nodeId: config[input.kind].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: 10,
  });
}

export async function markMonitorAgentConfirmed(input: {
  kind: AmazonMonitorKind;
  agentRunId: string;
  aiJobRunId: string;
  attempt: number;
  userId: number;
  output: unknown;
}) {
  return markBusinessManagedNodeConfirmed({
    runId: input.agentRunId,
    dag: monitorAgentDag(input.kind),
    nodeId: config[input.kind].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: 100,
    output: input.output,
    userEdit: input.output,
    userId: input.userId,
    metadata: { source: "qualified_provider", automaticProviderFact: true },
  });
}

export async function markMonitorAgentFailed(input: {
  kind: AmazonMonitorKind;
  agentRunId: string;
  aiJobRunId: string;
  attempt: number;
  finalAttempt: boolean;
  error: unknown;
}) {
  return markBusinessManagedNodeFailed({
    runId: input.agentRunId,
    dag: monitorAgentDag(input.kind),
    nodeId: config[input.kind].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: input.finalAttempt ? 100 : 10,
    finalAttempt: input.finalAttempt,
    failureKind: "error",
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  });
}
