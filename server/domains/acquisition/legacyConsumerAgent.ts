import {
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
} from "../ai_os/services/businessManagedAgent";
import { recordAgentTemplateVersion, startAgentRun } from "../ai_os/services/agentRunner";
import type { EmperorAgentDag } from "../ai_os/services/agentRunner/runtimeCore";
import { rawExecute } from "../ai_os/routerContext";

export type LegacyAnalysisConsumerType = "kb_listing" | "kb_product" | "project_competitor";

const config = {
  kb_listing: {
    slug: "knowledge.amazon.listing-analysis",
    name: "知识库 · Amazon Listing分析",
    category: "知识治理",
    nodeId: "listing_analysis",
    skillSlug: "listing.competitor.analyze",
    route: "/knowledge/listings",
  },
  kb_product: {
    slug: "knowledge.amazon.product-analysis",
    name: "知识库 · Amazon产品分析",
    category: "知识治理",
    nodeId: "product_analysis",
    skillSlug: "analysis.competitor.single",
    route: "/knowledge/products",
  },
  project_competitor: {
    slug: "listing.amazon.competitor-analysis",
    name: "Listing项目 · Amazon竞品分析",
    category: "Listing",
    nodeId: "competitor_analysis",
    skillSlug: "listing.competitor.analyze",
    route: "/listing/project/{{projectId}}",
  },
} as const;

export function legacyConsumerAgentConfig(type: LegacyAnalysisConsumerType) {
  return config[type];
}

export function legacyConsumerAgentDag(type: LegacyAnalysisConsumerType): EmperorAgentDag {
  const item = config[type];
  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "Confirmed Amazon Snapshot进入结构化AI分析，AI只生成待审核草案，用户确认后才进入知识或项目下游。",
    executionOwner: "acquisition.consumer_activation",
    businessRoute: item.route,
    nodes: [{
      id: item.nodeId,
      nodeType: "skill_node",
      label: item.name,
      subtitle: "Confirmed Snapshot → AI草案 → 人工确认",
      skillSlug: item.skillSlug,
      skillVersionPolicy: "snapshot",
      outputKey: item.nodeId,
      humanGate: true,
      required: true,
      scheduler: "manual",
      executionOwner: "acquisition.consumer_activation",
      businessRoute: item.route,
      x: 80,
      y: 80,
    }],
    edges: [],
  };
}

async function ensureTemplate(type: LegacyAnalysisConsumerType) {
  const item = config[type];
  const dag = legacyConsumerAgentDag(type);
  const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug=? LIMIT 1", [item.slug]);
  if (!existing[0]) {
    await rawExecute(
      `INSERT INTO emperor_agents
       (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,?, 'active','project','manual',900,?)`,
      [item.slug, item.name, dag.description, item.category, JSON.stringify(dag)],
    );
  } else {
    await rawExecute(
      "UPDATE emperor_agents SET name=?,description=?,category=?,dagDefinition=?,status='active',updatedAt=NOW() WHERE slug=?",
      [item.name, dag.description, item.category, JSON.stringify(dag), item.slug],
    );
  }
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: item.slug,
    agentName: item.name,
    dag,
    status: "released",
    releaseNotes: "A7：统一Amazon采集Confirmed Snapshot消费者分析",
    isDefault: true,
    rolloutPercent: 100,
  });
  return dag;
}

export async function startLegacyConsumerAgentRun(input: {
  consumerType: LegacyAnalysisConsumerType;
  businessId: number;
  workspaceId: number;
  userId: number;
  confirmedSnapshotId: number;
  asin: string;
}) {
  const item = config[input.consumerType];
  const dag = await ensureTemplate(input.consumerType);
  const detail = await startAgentRun({
    slug: item.slug,
    inputs: {
      consumerType: input.consumerType,
      businessId: input.businessId,
      confirmedSnapshotId: input.confirmedSnapshotId,
      asin: input.asin,
      executionOwner: "acquisition.consumer_activation",
    },
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.businessId,
  });
  return { agentRunId: (detail as any).run.runId as string, agentNodeId: item.nodeId, dag };
}

export async function markLegacyConsumerAgentRunning(input: {
  consumerType: LegacyAnalysisConsumerType;
  agentRunId: string;
  aiJobRunId: string;
  attempt: number;
}) {
  return markBusinessManagedNodeRunning({
    runId: input.agentRunId,
    dag: legacyConsumerAgentDag(input.consumerType),
    nodeId: config[input.consumerType].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: 10,
  });
}

export async function markLegacyConsumerAgentWaitingHuman(input: {
  consumerType: LegacyAnalysisConsumerType;
  agentRunId: string;
  aiJobRunId: string;
  attempt: number;
  output: unknown;
}) {
  return markBusinessManagedNodeWaitingHuman({
    runId: input.agentRunId,
    dag: legacyConsumerAgentDag(input.consumerType),
    nodeId: config[input.consumerType].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: 100,
    output: input.output,
  });
}

export async function markLegacyConsumerAgentFailed(input: {
  consumerType: LegacyAnalysisConsumerType;
  agentRunId: string;
  aiJobRunId: string;
  attempt: number;
  finalAttempt: boolean;
  error: unknown;
}) {
  return markBusinessManagedNodeFailed({
    runId: input.agentRunId,
    dag: legacyConsumerAgentDag(input.consumerType),
    nodeId: config[input.consumerType].nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.attempt,
    progress: input.finalAttempt ? 100 : 10,
    finalAttempt: input.finalAttempt,
    failureKind: "error",
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  });
}
