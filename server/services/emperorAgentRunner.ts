import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";
import { runEmperorSkill, safeParseSkillJSON } from "./emperorSkillRunner";
import { startAiJobInProcess } from "./aiJobRunner";
import { invokeEmperorTool } from "./emperorToolGateway";

export type AgentNodeStatus = "pending" | "ready" | "running" | "waiting_human" | "confirmed" | "skipped" | "failed";
export type AgentRunStatus = "running" | "waiting_human" | "completed" | "failed" | "canceled";

export type EmperorAgentNode = {
  id: string;
  nodeType: string;
  label: string;
  subtitle?: string;
  skillSlug?: string;
  toolSlug?: string;
  toolParams?: unknown;
  executionMode?: "inline" | "fork" | "background";
  humanGate?: boolean;
  autoConfirm?: boolean;
  scheduler?: "manual" | "auto";
  required?: boolean;
  inputRefs?: string[];
  outputKey?: string;
  reviewPrompt?: string;
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type EmperorAgentEdge = {
  id?: string;
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  label?: string;
  required?: boolean;
  kind?: "required" | "suggested" | "optional";
};

export type EmperorAgentDag = {
  version?: string;
  workflowType?: string;
  description?: string;
  nodes: EmperorAgentNode[];
  edges: EmperorAgentEdge[];
};

type CheckpointRow = {
  runId: string;
  agentSlug: string;
  nodeId: string;
  nodeLabel?: string | null;
  nodeType: string;
  status: AgentNodeStatus;
  input?: unknown;
  output?: unknown;
  userEdit?: unknown;
  metadata?: unknown;
  skillRunId?: string | null;
  aiJobRunId?: string | null;
  errorMessage?: string | null;
};

export const LISTING_AGENT_SLUG = "listing.full.workflow";

async function rawExecute(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  let result: any;
  if (params.length > 0) {
    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) chunks.push(drizzleSql`${params[i]}`);
    }
    result = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  } else {
    result = await db.execute(drizzleSql.raw(sqlStr));
  }
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
}

function parseJson(value: unknown, fallback: unknown = null): unknown {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function generateRunId(prefix = "agent"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeAgentDag(raw: unknown): EmperorAgentDag {
  const dag = parseJson(raw, { nodes: [], edges: [] }) as Partial<EmperorAgentDag>;
  return {
    ...dag,
    nodes: Array.isArray(dag.nodes) ? dag.nodes.filter((node) => node?.id) as EmperorAgentNode[] : [],
    edges: Array.isArray(dag.edges) ? dag.edges as EmperorAgentEdge[] : [],
  };
}

function edgeSource(edge: EmperorAgentEdge): string {
  return String(edge.source || edge.from || "");
}

function edgeTarget(edge: EmperorAgentEdge): string {
  return String(edge.target || edge.to || "");
}

function parentIds(dag: EmperorAgentDag, nodeId: string): string[] {
  return dag.edges.filter((edge) => edgeTarget(edge) === nodeId).map(edgeSource).filter(Boolean);
}

function childIds(dag: EmperorAgentDag, nodeId: string): string[] {
  return dag.edges.filter((edge) => edgeSource(edge) === nodeId).map(edgeTarget).filter(Boolean);
}

function descendantIds(dag: EmperorAgentDag, nodeId: string): string[] {
  const result = new Set<string>();
  const queue = [...childIds(dag, nodeId)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (result.has(current)) continue;
    result.add(current);
    queue.push(...childIds(dag, current));
  }
  return [...result];
}

function isConfirmedStatus(status: string): boolean {
  return status === "confirmed" || status === "skipped";
}

function checkpointPayload(row: any): CheckpointRow {
  return {
    ...row,
    input: parseJson(row.input),
    output: parseJson(row.output),
    userEdit: parseJson(row.userEdit),
    metadata: parseJson(row.metadata),
  };
}

export function getListingAgentDag(): EmperorAgentDag {
  const node = (
    id: string,
    nodeType: string,
    label: string,
    subtitle: string,
    x: number,
    y: number,
    extra: Partial<EmperorAgentNode> = {},
  ): EmperorAgentNode => ({
    id,
    nodeType,
    label,
    subtitle,
    x,
    y,
    humanGate: true,
    required: true,
    ...extra,
  });

  const edge = (source: string, target: string, label?: string, kind: EmperorAgentEdge["kind"] = "required"): EmperorAgentEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    from: source,
    to: target,
    label,
    kind,
    required: kind === "required",
  });

  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "完整 Listing 长工作流：前置数据准备、生成主链、输出优化和扩展内容。",
    nodes: [
      node("N0", "input_node", "N0 · 项目管理", "品牌/产品/市场基础信息", 520, 20, {
        toolSlug: "internal.agent.capture_input",
        outputKey: "project",
      }),
      node("N1", "skill_node", "N1 · 竞品分析", "ASIN/竞品 Listing 分析", 110, 150, { skillSlug: "listing.competitor.analyze", outputKey: "competitorAnalysis" }),
      node("N2", "skill_node", "N2 · 竞品对比", "多竞品横向对比", -80, 350, { skillSlug: "analysis.competitor.multi", outputKey: "competitorComparison" }),
      node("N3", "skill_node", "N3 · 数据文件", "产品属性 / Rufus / 买家问题", 780, 350, { skillSlug: "analysis.rufus.attribute", outputKey: "productAttributes" }),
      node("N4", "skill_node", "N4 · 关键词管理", "关键词矩阵与词根分类", 520, 350, { skillSlug: "keyword.listing.layout", outputKey: "keywordMatrix" }),
      node("N5", "skill_node", "N5 · 评论聚合分析", "痛点/痒点/爽点提取", 160, 350, { skillSlug: "analysis.review.extract", outputKey: "reviewAggregation" }),
      node("G1", "skill_node", "G1 · 卖点精雕", "7条卖点核心方向", 360, 620, { skillSlug: "listing.sellingpoints.generate", outputKey: "sellingPoints" }),
      node("G2", "skill_node", "G2 · 标题生成", "200字符内核心词前置", 360, 820, { skillSlug: "listing.title.generate", outputKey: "title" }),
      node("G3", "skill_node", "G3 · 产品描述", "长描述 + A+内容规划", 360, 1020, { skillSlug: "listing.description.generate", outputKey: "description" }),
      node("G4", "skill_node", "G4 · 搜索词", "后台关键词 250 字符", 360, 1220, { skillSlug: "listing.searchterms.generate", outputKey: "searchTerms" }),
      node("G5", "skill_node", "G5 · QA问答", "买家问题与专业解答", 360, 1420, { skillSlug: "listing.qa.generate", outputKey: "qaContent" }),
      node("O1", "output_node", "O1 · 结果预览", "完整 Listing 中英文版本", 360, 1620, {
        toolSlug: "internal.listing.compose_preview",
        outputKey: "listingPreview",
      }),
      node("O2", "skill_node", "O2 · Listing评分", "多维度质量评估", 190, 1820, { skillSlug: "listing.scoring.overall", outputKey: "listingScore", required: false }),
      node("O3", "skill_node", "O3 · 广告架构", "广告词 + 投放策略", 190, 2020, { skillSlug: "ad.structure.generate", outputKey: "adStructure", required: false }),
      node("E1", "skill_node", "E1 · 智能图片建议", "图片结构与构图建议", 560, 1820, { skillSlug: "listing.image.advice", outputKey: "imageAdvice", required: false }),
      node("E2", "skill_node", "E2 · 视频脚本", "产品视频脚本与分镜", 560, 2020, { skillSlug: "video.edit.script", outputKey: "videoScript", required: false }),
    ],
    edges: [
      edge("N0", "N1"), edge("N0", "N3"), edge("N1", "N2"), edge("N1", "N5"),
      edge("N1", "G1"), edge("N2", "G1", "差异化建议"), edge("N3", "G1", "产品属性"),
      edge("N4", "G1", "策略矩阵"), edge("N5", "G1", "痛点/爽点"), edge("G1", "G2"),
      edge("N4", "G2", "关键词矩阵"), edge("G2", "G3"), edge("G2", "G4"), edge("G1", "G4"),
      edge("N4", "G4", "词根分类"), edge("G1", "G5"), edge("N3", "G5", "买家问题库", "suggested"),
      edge("N5", "G5", "评论洞察"), edge("G1", "O1"), edge("G2", "O1"), edge("G3", "O1"),
      edge("G4", "O1"), edge("G5", "O1"), edge("O1", "O2", "评分"), edge("N4", "O3", "广告关键词"),
      edge("O1", "O3", "Listing内容"), edge("G1", "E1"), edge("G2", "E1"), edge("N5", "E1", "用户痛点"),
      edge("G1", "E2"), edge("E1", "E2", "图片建议"),
    ],
  };
}

export async function upsertListingAgentTemplate() {
  const dag = getListingAgentDag();
  await rawExecute(
    `INSERT INTO emperor_agents (slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition,execution_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),scope=VALUES(scope),triggerType=VALUES(triggerType),maxExecutionSeconds=VALUES(maxExecutionSeconds),dagDefinition=VALUES(dagDefinition),execution_mode=VALUES(execution_mode),updatedAt=NOW()`,
    [
      LISTING_AGENT_SLUG,
      "智能 Listing 全链路 Agent",
      "按 N0-N5 数据层、G1-G5 生成层、O/E 输出优化层编排的 Human-in-the-loop Listing DAG。",
      "Listing",
      "active",
      "project",
      "manual",
      1800,
      stringifyJson(dag),
      "background",
    ],
  );
  return { success: true, slug: LISTING_AGENT_SLUG, dag };
}

async function getAgentBySlug(slug: string) {
  const rows = await rawExecute("SELECT * FROM emperor_agents WHERE slug=? LIMIT 1", [slug]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  return {
    ...rows[0],
    dagDefinition: normalizeAgentDag(rows[0].dagDefinition),
  };
}

async function addEvent(runId: string, agentSlug: string, nodeId: string | null, eventType: string, message: string, payload?: unknown) {
  await rawExecute(
    "INSERT INTO emperor_agent_events (runId,agentSlug,nodeId,eventType,message,payload) VALUES (?,?,?,?,?,?)",
    [runId, agentSlug, nodeId, eventType, message, payload === undefined ? null : stringifyJson(payload)],
  );
}

async function getCheckpoints(runId: string): Promise<CheckpointRow[]> {
  const rows = await rawExecute("SELECT * FROM emperor_agent_checkpoints WHERE runId=? ORDER BY id ASC", [runId]);
  return rows.map(checkpointPayload);
}

async function getCheckpoint(runId: string, nodeId: string): Promise<CheckpointRow> {
  const rows = await rawExecute("SELECT * FROM emperor_agent_checkpoints WHERE runId=? AND nodeId=? LIMIT 1", [runId, nodeId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Checkpoint not found" });
  return checkpointPayload(rows[0]);
}

async function getRunRow(runId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
  return rows[0];
}

function calculateProgress(checkpoints: CheckpointRow[]): number {
  if (!checkpoints.length) return 0;
  const done = checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).length;
  return Math.round((done / checkpoints.length) * 100);
}

function effectiveCheckpointOutput(checkpoint: CheckpointRow): unknown {
  return checkpoint.userEdit !== undefined && checkpoint.userEdit !== null
    ? checkpoint.userEdit
    : checkpoint.output;
}

async function refreshRunAfterCheckpoint(runId: string, dag: EmperorAgentDag) {
  const checkpoints = await getCheckpoints(runId);
  const progress = calculateProgress(checkpoints);
  const allDone = checkpoints.length > 0 && checkpoints.every((checkpoint) => isConfirmedStatus(checkpoint.status));
  const failed = checkpoints.find((checkpoint) => checkpoint.status === "failed");
  const running = checkpoints.find((checkpoint) => checkpoint.status === "running");
  const waiting = checkpoints.find((checkpoint) => checkpoint.status === "waiting_human");
  const nextReady = checkpoints.find((checkpoint) => checkpoint.status === "ready");
  const anyRunning = checkpoints.some((checkpoint) => checkpoint.status === "running");
  const anyWaiting = checkpoints.some((checkpoint) => checkpoint.status === "waiting_human");
  const status: AgentRunStatus = allDone ? "completed" : anyRunning ? "running" : failed && !nextReady && !anyWaiting ? "failed" : "waiting_human";
  const currentNodeId = running?.nodeId || waiting?.nodeId || nextReady?.nodeId || failed?.nodeId || null;
  const outputMap = checkpoints.reduce<Record<string, unknown>>((acc, checkpoint) => {
    const node = dag.nodes.find((item) => item.id === checkpoint.nodeId);
    const key = node?.outputKey || checkpoint.nodeId;
    if (checkpoint.output !== undefined && checkpoint.output !== null) acc[key] = checkpoint.output;
    if (checkpoint.userEdit !== undefined && checkpoint.userEdit !== null) acc[`${key}UserEdit`] = checkpoint.userEdit;
    const effective = effectiveCheckpointOutput(checkpoint);
    if (effective !== undefined && effective !== null) acc[`${key}Final`] = effective;
    return acc;
  }, {});

  await rawExecute(
    "UPDATE emperor_agent_runs SET status=?,currentNodeId=?,progress=?,outputs=?,completedAt=? WHERE runId=?",
    [status, currentNodeId, progress, stringifyJson(outputMap), allDone ? new Date() : null, runId],
  );

  if (!anyRunning && !anyWaiting && nextReady) {
    await addEvent(runId, checkpoints[0]?.agentSlug || "", nextReady.nodeId, "node.ready", `节点 ${nextReady.nodeLabel || nextReady.nodeId} 已就绪`);
  }

  return { checkpoints, status, progress };
}

async function unlockChildren(runId: string, dag: EmperorAgentDag, nodeId: string) {
  const checkpoints = await getCheckpoints(runId);
  const byNode = new Map(checkpoints.map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  for (const childId of childIds(dag, nodeId)) {
    const child = byNode.get(childId);
    if (!child || child.status !== "pending") continue;
    const parents = parentIds(dag, childId);
    const ready = parents.every((parentId) => isConfirmedStatus(byNode.get(parentId)?.status || ""));
    if (!ready) continue;
    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET status='ready',updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [runId, childId],
    );
  }
}

function buildNodeInput(run: any, dag: EmperorAgentDag, node: EmperorAgentNode, checkpoints: CheckpointRow[]) {
  const parents = parentIds(dag, node.id);
  const parentOutputs = checkpoints
    .filter((checkpoint) => parents.includes(checkpoint.nodeId))
    .reduce<Record<string, unknown>>((acc, checkpoint) => {
      const parentNode = dag.nodes.find((item) => item.id === checkpoint.nodeId);
      acc[parentNode?.outputKey || checkpoint.nodeId] = effectiveCheckpointOutput(checkpoint);
      return acc;
    }, {});
  const confirmedOutputs = checkpoints
    .filter((checkpoint) => isConfirmedStatus(checkpoint.status))
    .reduce<Record<string, unknown>>((acc, checkpoint) => {
      const confirmedNode = dag.nodes.find((item) => item.id === checkpoint.nodeId);
      acc[confirmedNode?.outputKey || checkpoint.nodeId] = effectiveCheckpointOutput(checkpoint);
      return acc;
    }, {});
  return {
    runInputs: parseJson(run.inputs, {}),
    parentOutputs,
    confirmedOutputs,
    node: {
      id: node.id,
      label: node.label,
      skillSlug: node.skillSlug,
      toolSlug: node.toolSlug,
      outputKey: node.outputKey,
      nodeType: node.nodeType,
      params: node.toolParams ?? null,
    },
  };
}

function buildSkillContext(node: EmperorAgentNode, nodeInput: unknown): string {
  return [
    `Agent 节点：${node.id} ${node.label}`,
    node.subtitle ? `节点说明：${node.subtitle}` : "",
    "请基于 runInputs 与 parentOutputs 完成本节点任务。输出严格 JSON。",
    "",
    JSON.stringify(nodeInput, null, 2),
  ].filter(Boolean).join("\n");
}

function nodeRequiresHumanGate(node: EmperorAgentNode): boolean {
  if (node.autoConfirm === true) return false;
  return node.humanGate !== false;
}

async function finalizeNodeOutput(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  userId: number;
  output: unknown;
  skillRunId?: string | null;
  completedMessage?: string;
}) {
  const waitingForHuman = nodeRequiresHumanGate(input.node);
  const nextStatus: AgentNodeStatus = waitingForHuman ? "waiting_human" : "confirmed";
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status=?,output=?,skillRunId=COALESCE(?,skillRunId),reviewerUserId=?,completedAt=?,confirmedAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [
      nextStatus,
      stringifyJson(input.output),
      input.skillRunId || null,
      waitingForHuman ? null : input.userId,
      new Date(),
      waitingForHuman ? null : new Date(),
      input.run.runId,
      input.node.id,
    ],
  );

  if (waitingForHuman) {
    await rawExecute("UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,updatedAt=NOW() WHERE runId=?", [input.node.id, input.run.runId]);
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
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status='failed',errorMessage=?,completedAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [message, new Date(), input.run.runId, input.node.id],
  );
  await rawExecute("UPDATE emperor_agent_runs SET status='failed',errorMessage=?,currentNodeId=?,updatedAt=NOW() WHERE runId=?", [message, input.node.id, input.run.runId]);
  await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.failed", `节点 ${input.node.label || input.node.id} 执行失败`, { error: message });
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
      runId: input.run.runId,
      nodeId: input.node.id,
    });
  }

  return invokeEmperorTool({
    toolSlug,
    params,
    userId: input.userId,
    runId: input.run.runId,
    nodeId: input.node.id,
  });
}

export async function startAgentRun(input: {
  slug: string;
  inputs: Record<string, unknown>;
  userId: number;
  projectId?: number | null;
}) {
  const agent = await getAgentBySlug(input.slug);
  const dag = normalizeAgentDag(agent.dagDefinition);
  if (!dag.nodes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Agent DAG has no nodes" });

  const runId = generateRunId("agent");
  const rootNodeIds = dag.nodes.filter((node) => parentIds(dag, node.id).length === 0).map((node) => node.id);
  const firstReady = rootNodeIds[0] || dag.nodes[0].id;

  await rawExecute(
    "INSERT INTO emperor_agent_runs (runId,agentSlug,agentName,userId,projectId,status,currentNodeId,progress,inputs,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [runId, agent.slug, agent.name, input.userId, input.projectId ?? null, "waiting_human", firstReady, 0, stringifyJson(input.inputs), new Date()],
  );

  for (const node of dag.nodes) {
    const status: AgentNodeStatus = rootNodeIds.includes(node.id) ? "ready" : "pending";
    await rawExecute(
      "INSERT INTO emperor_agent_checkpoints (runId,agentSlug,nodeId,nodeLabel,nodeType,status,metadata) VALUES (?,?,?,?,?,?,?)",
      [runId, agent.slug, node.id, node.label || node.id, node.nodeType || "skill_node", status, stringifyJson({ node })],
    );
  }

  await addEvent(runId, agent.slug, null, "run.started", `Agent ${agent.name} 已启动`, { inputs: input.inputs });
  return getAgentRun(runId, input.userId, true);
}

export async function getAgentRun(runId: string, userId?: number, skipOwnerCheck = false) {
  const run = await getRunRow(runId);
  if (!skipOwnerCheck && userId && run.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Agent run" });
  }
  const agent = await getAgentBySlug(run.agentSlug);
  const dag = normalizeAgentDag(agent.dagDefinition);
  const checkpoints = await getCheckpoints(runId);
  const events = await rawExecute("SELECT * FROM emperor_agent_events WHERE runId=? ORDER BY createdAt ASC LIMIT 200", [runId]);
  return {
    run: {
      ...run,
      inputs: parseJson(run.inputs, {}),
      outputs: parseJson(run.outputs, {}),
    },
    agent,
    dag,
    checkpoints,
    events: events.map((event) => ({ ...event, payload: parseJson(event.payload) })),
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
    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET status='ready',updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [runId, node.id],
    );
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
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (!["waiting_human", "confirmed", "failed"].includes(checkpoint.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Node draft is not editable: ${checkpoint.status}` });
  }
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET userEdit=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(input.userEdit), input.runId, input.nodeId],
  );
  await addEvent(input.runId, detail.run.agentSlug, input.nodeId, "node.draft_saved", `节点 ${checkpoint.nodeLabel || input.nodeId} 草稿已保存`);
  await refreshRunAfterCheckpoint(input.runId, normalizeAgentDag(detail.dag));
  return getAgentRun(input.runId, input.userId, true);
}

export async function rerunAgentNode(input: {
  runId: string;
  nodeId: string;
  userId: number;
  resetDescendants?: boolean;
}) {
  const detail = await getAgentRun(input.runId, input.userId);
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Agent node not found" });
  const descendants = input.resetDescendants === false ? [] : descendantIds(dag, input.nodeId);

  if (descendants.length > 0) {
    const placeholders = descendants.map(() => "?").join(",");
    await rawExecute(
      `UPDATE emperor_agent_checkpoints
       SET status='pending',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId IN (${placeholders})`,
      [input.runId, ...descendants],
    );
  }

  await rawExecute(
    `UPDATE emperor_agent_checkpoints
     SET status='ready',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
     WHERE runId=? AND nodeId=?`,
    [input.runId, input.nodeId],
  );
  await rawExecute("UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,errorMessage=NULL,completedAt=NULL,updatedAt=NOW() WHERE runId=?", [input.nodeId, input.runId]);
  await addEvent(input.runId, detail.run.agentSlug, input.nodeId, "node.rerun_requested", `节点 ${node.label || input.nodeId} 已请求重跑`, { resetDescendants: descendants });
  return executeAgentNode({ runId: input.runId, nodeId: input.nodeId, userId: input.userId });
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
  const dag = normalizeAgentDag(detail.dag);
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  const nextStatus: AgentNodeStatus = input.skip ? "skipped" : "confirmed";
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status=?,output=COALESCE(?,output),userEdit=?,reviewerUserId=?,confirmedAt=?,completedAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [
      nextStatus,
      input.output === undefined ? null : stringifyJson(input.output),
      input.userEdit === undefined ? (checkpoint.userEdit === undefined ? null : stringifyJson(checkpoint.userEdit)) : stringifyJson(input.userEdit),
      input.userId,
      new Date(),
      new Date(),
      input.runId,
      input.nodeId,
    ],
  );
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
  const dag = normalizeAgentDag(detail.dag);
  const node = dag.nodes.find((item) => item.id === input.nodeId);
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Agent node not found" });
  const checkpoint = await getCheckpoint(input.runId, input.nodeId);
  if (!["ready", "waiting_human", "failed"].includes(checkpoint.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Node is not executable: ${checkpoint.status}` });
  }

  const nodeInput = buildNodeInput(run, dag, node, detail.checkpoints);
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status='running',attempt=attempt+1,input=?,errorMessage=NULL,startedAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(nodeInput), new Date(), input.runId, input.nodeId],
  );
  await rawExecute("UPDATE emperor_agent_runs SET status='running',currentNodeId=?,updatedAt=NOW() WHERE runId=?", [input.nodeId, input.runId]);
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

  const job = await startAiJobInProcess({
    kind: `agent.node.${node.id}`,
    module: "emperorAgent",
    procedure: "emperor.agents.executeNode",
    userId: input.userId,
    projectId: run.projectId ?? null,
    skillSlug: node.skillSlug,
    input: {
      runId: input.runId,
      agentSlug: run.agentSlug,
      nodeId: node.id,
      skillSlug: node.skillSlug,
      nodeInput,
    },
    progress: 5,
  }, async () => {
    try {
      const result = await runEmperorSkill({
        skillSlug: node.skillSlug!,
        userId: input.userId,
        context: buildSkillContext(node, nodeInput),
        variables: {
          agentRunId: input.runId,
          nodeId: node.id,
          nodeInput,
        },
        validate: (content) => safeParseSkillJSON(content),
      });
      await finalizeNodeOutput({
        run,
        dag,
        node,
        userId: input.userId,
        output: result,
        skillRunId: result.runId,
        completedMessage: `节点 ${node.label || node.id} 已生成，等待人工确认`,
      });
      return result;
    } catch (error) {
      await failNodeExecution({ run, node, error });
      throw error;
    }
  });

  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET aiJobRunId=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [job.runId, input.runId, input.nodeId],
  );
  return getAgentRun(input.runId, input.userId, true);
}
