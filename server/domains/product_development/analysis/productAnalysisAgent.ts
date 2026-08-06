import * as devDb from "../../../devDb";
import {
  ensureBusinessManagedRun,
  findLatestBusinessManagedRun,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeDraft,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeSkipped,
  markBusinessManagedNodeWaitingHuman,
  parseBusinessManagedOutput,
} from "../../ai_os/services/businessManagedAgent";
import {
  getAgentRun,
  recordAgentTemplateVersion,
  type EmperorAgentDag,
  type EmperorAgentNode,
} from "../../ai_os/services/agentRunner";
import { rawExecute } from "../../ai_os/routerContext";
import { downstreamDevAnalysisStages, type DevAnalysisStageType } from "./stageConsistency";

export const PRODUCT_ANALYSIS_AGENT_SLUG = "product-development.analysis.workflow";

export const PRODUCT_ANALYSIS_NODE_IDS = [
  "market_overview",
  "attribute_cross",
  "price_analysis",
  "brand_competition",
  "review_kano",
  "information_summary",
  "decision_dashboard",
] as const;

export type ProductAnalysisAgentNodeId = typeof PRODUCT_ANALYSIS_NODE_IDS[number];

const nodeLabels: Record<ProductAnalysisAgentNodeId, string> = {
  market_overview: "01 · 市场大盘",
  attribute_cross: "02 · 属性交叉",
  price_analysis: "03 · 价格段分析",
  brand_competition: "04 · 品牌竞争",
  review_kano: "05 · 评论深度",
  information_summary: "06 · 信息汇总",
  decision_dashboard: "07 · 综合决策",
};

const nodeSkills: Record<ProductAnalysisAgentNodeId, string> = {
  market_overview: "dev.analysis.market_overview",
  attribute_cross: "dev.analysis.attribute_cross",
  price_analysis: "dev.analysis.price_analysis",
  brand_competition: "dev.analysis.brand_competition",
  review_kano: "dev.analysis.review_kano",
  information_summary: "dev.analysis.information_summary",
  decision_dashboard: "dev.analysis.decision_dashboard",
};

export function getProductAnalysisAgentDag(): EmperorAgentDag {
  const positions: Record<ProductAnalysisAgentNodeId, { x: number; y: number }> = {
    market_overview: { x: 40, y: 40 },
    attribute_cross: { x: 300, y: 40 },
    review_kano: { x: 560, y: 40 },
    price_analysis: { x: 40, y: 260 },
    brand_competition: { x: 300, y: 260 },
    information_summary: { x: 300, y: 500 },
    decision_dashboard: { x: 300, y: 740 },
  };
  const nodes: EmperorAgentNode[] = PRODUCT_ANALYSIS_NODE_IDS.map((id) => ({
    id,
    nodeType: "skill_node",
    label: nodeLabels[id],
    subtitle: "由产品开发业务页面运行、编辑与确认",
    skillSlug: nodeSkills[id],
    skillVersionPolicy: "snapshot",
    outputKey: id,
    humanGate: true,
    required: id !== "review_kano",
    scheduler: "manual",
    executionOwner: "product_development.analysis_page",
    businessRoute: `/dev/project/{{projectId}}/analysis?stage=${id}`,
    x: positions[id].x,
    y: positions[id].y,
  }));
  const edge = (source: ProductAnalysisAgentNodeId, target: ProductAnalysisAgentNodeId, label: string) => ({
    id: `${source}-${target}`,
    source,
    target,
    from: source,
    to: target,
    label,
    kind: "required" as const,
    required: true,
  });
  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "产品开发七阶段分析主链路。Skill 提供 AI 能力，业务页面负责运行与人工确认，Agent Run 统一记录状态。",
    executionOwner: "product_development.analysis_page",
    businessRoute: "/dev/project/{{projectId}}/analysis",
    nodes,
    edges: [
      edge("market_overview", "price_analysis", "市场证据"),
      edge("market_overview", "brand_competition", "市场证据"),
      edge("market_overview", "information_summary", "已确认大盘"),
      edge("attribute_cross", "information_summary", "已确认属性"),
      edge("price_analysis", "information_summary", "已确认价格"),
      edge("brand_competition", "information_summary", "已确认品牌"),
      edge("review_kano", "information_summary", "评论证据或无评论跳过"),
      edge("information_summary", "decision_dashboard", "已确认汇总 Artifact"),
    ],
  };
}

export async function ensureProductAnalysisAgentTemplate() {
  const dag = getProductAnalysisAgentDag();
  const existing = await rawExecute("SELECT * FROM emperor_agents WHERE slug=? LIMIT 1", [PRODUCT_ANALYSIS_AGENT_SLUG]);
  if (!existing[0]) {
    await rawExecute(
      `INSERT INTO emperor_agents
       (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,?, 'active','project','manual',1800,?)`,
      [
        PRODUCT_ANALYSIS_AGENT_SLUG,
        "产品开发 · 七阶段分析",
        "产品开发市场分析主链路，由业务页面托管执行与人工确认。",
        "产品开发",
        JSON.stringify(dag),
      ],
    );
  }
  const defaults = await rawExecute(
    "SELECT id FROM emperor_agent_template_versions WHERE agentSlug=? AND workspaceId IS NULL AND status='released' AND isDefault=1 LIMIT 1",
    [PRODUCT_ANALYSIS_AGENT_SLUG],
  );
  if (!defaults[0]) {
    await recordAgentTemplateVersion({
      workspaceId: null,
      agentSlug: PRODUCT_ANALYSIS_AGENT_SLUG,
      agentName: "产品开发 · 七阶段分析",
      dag,
      status: "released",
      releaseNotes: "产品开发七阶段 Agent 主链路 v1",
      isDefault: true,
      rolloutPercent: 100,
    });
  }
  return dag;
}

function nodeIdForStage(stageType: DevAnalysisStageType): ProductAnalysisAgentNodeId | null {
  return PRODUCT_ANALYSIS_NODE_IDS.includes(stageType as ProductAnalysisAgentNodeId)
    ? stageType as ProductAnalysisAgentNodeId
    : null;
}

function parseStageOutput(stage: any) {
  return parseBusinessManagedOutput(stage?.editedResult || stage?.rawResult || null);
}

async function syncInvalidatedProductStages(input: {
  runId: string;
  dag: EmperorAgentDag;
  projectId: number;
  invalidated?: DevAnalysisStageType[];
}) {
  for (const stageType of input.invalidated || []) {
    const nodeId = nodeIdForStage(stageType);
    if (!nodeId) continue;
    const stage = await devDb.getDevAnalysisStage(input.projectId, stageType);
    const output = parseStageOutput(stage);
    if (!output) continue;
    await markBusinessManagedNodeWaitingHuman({
      runId: input.runId,
      dag: input.dag,
      nodeId,
      output,
      userEdit: stage?.editedResult ? output : undefined,
      errorMessage: stage?.runError || null,
      metadata: { invalidatedByUpstream: true },
    });
  }
}

async function seedCreatedRun(runId: string, dag: EmperorAgentDag, input: {
  projectId: number;
  userId: number;
}) {
  const [stages, dataStatus] = await Promise.all([
    devDb.getDevAnalysisStages(input.projectId),
    devDb.getDataConfirmationStatus(input.projectId),
  ]);
  const byType = new Map(stages.map((stage: any) => [stage.stageType, stage]));
  for (const nodeId of PRODUCT_ANALYSIS_NODE_IDS) {
    const stage = byType.get(nodeId) as any;
    if (!stage) {
      if (nodeId === "review_kano" && Number((dataStatus as any)?.reviews?.fileCount || 0) === 0) {
        await markBusinessManagedNodeSkipped({
          runId,
          dag,
          nodeId,
          userId: input.userId,
          reason: "项目没有评论数据，本轮评论深度节点自动跳过",
        });
      }
      continue;
    }
    const output = parseStageOutput(stage);
    if (stage.status === "running" || stage.status === "generating") {
      await markBusinessManagedNodeRunning({ runId, dag, nodeId, aiJobRunId: stage.runId || null, progress: stage.runProgress || 5 });
      continue;
    }
    if (stage.status === "confirmed") {
      await markBusinessManagedNodeConfirmed({ runId, dag, nodeId, output, userEdit: output, userId: input.userId });
      continue;
    }
    if (["completed", "generated", "editing"].includes(stage.status)) {
      await markBusinessManagedNodeWaitingHuman({ runId, dag, nodeId, output, userEdit: output, errorMessage: stage.runError || null });
    }
  }
}

export async function ensureProductAnalysisAgentRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  requireMutable?: boolean;
}) {
  const dag = await ensureProductAnalysisAgentTemplate();
  const ensured = await ensureBusinessManagedRun({
    agentSlug: PRODUCT_ANALYSIS_AGENT_SLUG,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    requireMutable: input.requireMutable,
    inputs: { workflow: "product_development.analysis", schemaVersion: "1.0" },
  });
  const detail = ensured.detail as any;
  if (ensured.created) {
    await seedCreatedRun(detail.run.runId, dag, input);
    return { runId: detail.run.runId, dag, created: true, detail: await getAgentRun(detail.run.runId, undefined, true) };
  }
  return { runId: detail.run.runId, dag, created: false, detail };
}

export async function syncProductAnalysisNodeRunning(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  userId: number;
  workspaceId?: number | null;
  aiJobRunId: string;
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return null;
  const run = await ensureProductAnalysisAgentRun({ ...input, requireMutable: true });
  await markBusinessManagedNodeRunning({ runId: run.runId, dag: run.dag, nodeId, aiJobRunId: input.aiJobRunId, progress: 5 });
  return { agentRunId: run.runId, dag: run.dag };
}

export async function syncProductAnalysisNodeProgress(input: {
  agentRunId: string;
  stageType: DevAnalysisStageType;
  aiJobRunId: string;
  aiJobAttempt: number;
  progress: number;
  errorMessage?: string | null;
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return false;
  return markBusinessManagedNodeProgress({
    runId: input.agentRunId,
    dag: getProductAnalysisAgentDag(),
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt,
    progress: input.progress,
    errorMessage: input.errorMessage,
  });
}

export async function syncProductAnalysisNodeCompleted(input: {
  agentRunId: string;
  projectId: number;
  stageType: DevAnalysisStageType;
  aiJobRunId: string;
  aiJobAttempt: number;
  output: unknown;
  invalidated?: DevAnalysisStageType[];
  warning?: string | null;
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return;
  await markBusinessManagedNodeWaitingHuman({
    runId: input.agentRunId,
    dag: getProductAnalysisAgentDag(),
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt,
    output: input.output,
    errorMessage: input.warning || null,
    resetNodeIds: (input.invalidated || []).map(nodeIdForStage).filter(Boolean) as string[],
  });
  await syncInvalidatedProductStages({
    runId: input.agentRunId,
    dag: getProductAnalysisAgentDag(),
    projectId: input.projectId,
    invalidated: input.invalidated,
  });
}

export async function syncProductAnalysisNodeFailure(input: {
  agentRunId: string;
  stageType: DevAnalysisStageType;
  aiJobRunId: string;
  aiJobAttempt?: number;
  finalAttempt: boolean;
  error: unknown;
  failureKind?: "error" | "timeout" | "cancel";
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return;
  await markBusinessManagedNodeFailed({
    runId: input.agentRunId,
    dag: getProductAnalysisAgentDag(),
    nodeId,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt,
    finalAttempt: input.finalAttempt,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error || "产品分析失败"),
    failureKind: input.failureKind,
  });
}

async function resolveRunForBusinessMutation(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  requireMutable: boolean;
}) {
  await ensureProductAnalysisAgentTemplate();
  const latest = await findLatestBusinessManagedRun({
    agentSlug: PRODUCT_ANALYSIS_AGENT_SLUG,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
  });
  if (latest && (!input.requireMutable || !["completed", "canceled"].includes(latest.status))) {
    return { runId: latest.runId, dag: getProductAnalysisAgentDag() };
  }
  return ensureProductAnalysisAgentRun(input);
}

export async function syncProductAnalysisConfirmation(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  userId: number;
  workspaceId?: number | null;
  output: unknown;
  invalidated?: DevAnalysisStageType[];
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return;
  const run = await resolveRunForBusinessMutation({ ...input, requireMutable: false });
  await markBusinessManagedNodeConfirmed({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    output: input.output,
    userEdit: input.output,
    userId: input.userId,
    resetNodeIds: (input.invalidated || []).map(nodeIdForStage).filter(Boolean) as string[],
  });
  await syncInvalidatedProductStages({
    runId: run.runId,
    dag: run.dag,
    projectId: input.projectId,
    invalidated: input.invalidated,
  });
}

export async function syncProductAnalysisDraft(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  userId: number;
  workspaceId?: number | null;
  output: unknown;
  invalidated?: DevAnalysisStageType[];
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return;
  const run = await resolveRunForBusinessMutation({ ...input, requireMutable: true });
  await markBusinessManagedNodeDraft({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    output: input.output,
    userEdit: input.output,
    userId: input.userId,
    resetNodeIds: (input.invalidated || []).map(nodeIdForStage).filter(Boolean) as string[],
  });
  await syncInvalidatedProductStages({
    runId: run.runId,
    dag: run.dag,
    projectId: input.projectId,
    invalidated: input.invalidated,
  });
}

export async function syncProductAnalysisCancel(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  userId: number;
  workspaceId?: number | null;
  aiJobRunId: string;
  reason: string;
}) {
  const nodeId = nodeIdForStage(input.stageType);
  if (!nodeId) return;
  const run = await resolveRunForBusinessMutation({ ...input, requireMutable: true });
  await markBusinessManagedNodeFailed({
    runId: run.runId,
    dag: run.dag,
    nodeId,
    aiJobRunId: input.aiJobRunId,
    finalAttempt: true,
    errorMessage: input.reason,
    failureKind: "cancel",
  });
}

export function productAnalysisInvalidatedNodes(stageType: DevAnalysisStageType) {
  return downstreamDevAnalysisStages(stageType).map(nodeIdForStage).filter(Boolean) as ProductAnalysisAgentNodeId[];
}
