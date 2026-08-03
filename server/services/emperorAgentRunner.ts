import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";
import {
  getEmperorSkillRuntimeSnapshot,
  normalizeSkillVersion,
  runEmperorSkill,
  safeParseSkillJSON,
  SkillRunError,
  type SkillRuntimeSnapshot,
  type SkillVersionPolicy,
} from "./emperorSkillRunner";
import { calculateAiJobRetryDelayMs, cancelAiJob, failAiJob, registerAiJobHandler, startRegisteredAiJob, type AiJobSnapshot } from "./aiJobRunner";
import { invokeEmperorTool } from "./emperorToolGateway";

export type AgentNodeStatus = "pending" | "ready" | "running" | "waiting_human" | "confirmed" | "skipped" | "failed";
export type AgentRunStatus = "running" | "waiting_human" | "paused" | "completed" | "failed" | "canceled";

export type EmperorAgentNode = {
  id: string;
  nodeType: string;
  label: string;
  subtitle?: string;
  skillSlug?: string;
  skillVersion?: string | number;
  skillVersionRef?: string;
  skillVersionPolicy?: SkillVersionPolicy;
  toolSlug?: string;
  toolParams?: unknown;
  executionMode?: "inline" | "fork" | "background";
  humanGate?: boolean;
  autoConfirm?: boolean;
  scheduler?: "manual" | "auto";
  required?: boolean;
  maxAttempts?: number;
  timeoutSeconds?: number;
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

export type AgentDagValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type AgentDagValidationResult = {
  valid: boolean;
  errors: AgentDagValidationIssue[];
  warnings: AgentDagValidationIssue[];
  rootNodeIds: string[];
  terminalNodeIds: string[];
  topologicalNodeIds: string[];
};

export type AgentNodeSkillBinding = {
  policy: SkillVersionPolicy;
  pinnedVersion?: string;
  ref: string;
};

export type StoredAgentRunRuntime = {
  agentSlug: string;
  agentName?: string | null;
  templateVersionId?: number | null;
  templateVersion?: string | null;
  dagSnapshot: EmperorAgentDag;
  dagHash: string;
  preparedAt: string;
};

export type AgentTemplateVersionStatus = "draft" | "released" | "deprecated";

export type AgentContextArtifactRef = {
  artifactId?: number;
  runId: string;
  nodeId: string;
  artifactKey: string;
  version: number;
  status: string;
  content: unknown;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
};

export type AgentContextPackage = {
  version: "1.0";
  agentRunId: string;
  agentSlug: string;
  projectId: number | null;
  node: {
    id: string;
    label?: string;
    nodeType: string;
    skillSlug?: string;
    skillVersion?: string | number;
    skillVersionRef?: string;
    skillVersionPolicy?: SkillVersionPolicy;
    toolSlug?: string;
    outputKey?: string;
    params?: unknown;
  };
  runInputs: Record<string, unknown>;
  parentOutputs: Record<string, unknown>;
  confirmedOutputs: Record<string, unknown>;
  artifacts: AgentContextArtifactRef[];
  provenance: {
    parentNodeIds: string[];
    confirmedNodeIds: string[];
    artifactRefs: string[];
    builtAt: string;
  };
};

export type AgentContextPackageOptions = {
  maxStringLength?: number;
  maxArtifactContentLength?: number;
  includeArtifactContent?: boolean;
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
  lockToken?: string | null;
  lockedAt?: Date | null;
  timeoutAt?: Date | null;
  errorMessage?: string | null;
};

export const LISTING_AGENT_SLUG = "listing.full.workflow";
let agentArtifactStoreAvailable = true;

const NODE_STATUS_TRANSITIONS: Record<AgentNodeStatus, AgentNodeStatus[]> = {
  pending: ["ready", "skipped"],
  ready: ["running", "skipped", "pending"],
  running: ["waiting_human", "confirmed", "failed", "pending"],
  waiting_human: ["confirmed", "skipped", "running", "pending"],
  confirmed: ["ready", "pending"],
  skipped: ["ready", "pending"],
  failed: ["ready", "running", "pending"],
};

const RUN_STATUS_TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  waiting_human: ["running", "paused", "completed", "failed", "canceled"],
  running: ["waiting_human", "paused", "completed", "failed", "canceled"],
  paused: ["waiting_human", "running", "failed", "canceled"],
  failed: ["waiting_human", "running", "paused", "canceled"],
  completed: [],
  canceled: [],
};

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

export function resolveAgentNodeSkillBinding(node: Pick<EmperorAgentNode, "skillVersion" | "skillVersionPolicy" | "skillVersionRef">): AgentNodeSkillBinding {
  const rawRef = String(node.skillVersionRef || "").trim();
  if (rawRef === "latest") return { policy: "latest", ref: "latest" };
  if (rawRef === "snapshot") return { policy: "snapshot", ref: "snapshot" };
  if (rawRef.startsWith("pinned:")) {
    const rawPinnedVersion = rawRef.slice("pinned:".length).trim();
    if (!rawPinnedVersion) return { policy: "pinned", ref: "pinned" };
    const pinnedVersion = normalizeSkillVersion(rawPinnedVersion);
    return { policy: "pinned", pinnedVersion, ref: `pinned:${pinnedVersion}` };
  }
  if (node.skillVersion !== undefined && node.skillVersion !== null && String(node.skillVersion).trim()) {
    const pinnedVersion = normalizeSkillVersion(node.skillVersion);
    return { policy: "pinned", pinnedVersion, ref: `pinned:${pinnedVersion}` };
  }
  if (node.skillVersionPolicy === "latest") return { policy: "latest", ref: "latest" };
  if (node.skillVersionPolicy === "pinned") return { policy: "pinned", ref: "pinned" };
  return { policy: "snapshot", ref: "snapshot" };
}

export function buildStoredAgentRunInputs(input: {
  inputs: Record<string, unknown>;
  agentSlug: string;
  agentName?: string | null;
  templateVersionId?: number | null;
  templateVersion?: string | null;
  dag: EmperorAgentDag;
}): Record<string, unknown> {
  return {
    __agentRun: {
      agentSlug: input.agentSlug,
      agentName: input.agentName ?? null,
      templateVersionId: input.templateVersionId ?? null,
      templateVersion: input.templateVersion ?? null,
      dagSnapshot: input.dag,
      dagHash: hashJson(input.dag),
      preparedAt: new Date().toISOString(),
    } satisfies StoredAgentRunRuntime,
    payload: input.inputs,
  };
}

export function parseStoredAgentRunInputs(raw: unknown): {
  inputs: Record<string, unknown>;
  runtime: StoredAgentRunRuntime | null;
} {
  const parsed = parseJson(raw, {}) as Record<string, unknown>;
  const runtime = parsed.__agentRun && typeof parsed.__agentRun === "object"
    ? parsed.__agentRun as StoredAgentRunRuntime
    : null;
  if (runtime) {
    const payload = parsed.payload && typeof parsed.payload === "object"
      ? parsed.payload as Record<string, unknown>
      : {};
    return { inputs: payload, runtime };
  }
  return { inputs: parsed, runtime: null };
}

export function canTransitionNodeStatus(from: AgentNodeStatus, to: AgentNodeStatus): boolean {
  return from === to || NODE_STATUS_TRANSITIONS[from]?.includes(to) === true;
}

export function canTransitionRunStatus(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return from === to || RUN_STATUS_TRANSITIONS[from]?.includes(to) === true;
}

function assertNodeTransition(from: AgentNodeStatus, to: AgentNodeStatus, action: string) {
  if (canTransitionNodeStatus(from, to)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Invalid node transition for ${action}: ${from} -> ${to}`,
  });
}

function assertRunTransition(from: AgentRunStatus, to: AgentRunStatus, action: string) {
  if (canTransitionRunStatus(from, to)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Invalid run transition for ${action}: ${from} -> ${to}`,
  });
}

function assertRunMutable(run: { status?: string }, action: string) {
  if (run.status === "canceled" || run.status === "completed" || run.status === "paused") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Run is ${run.status}; cannot ${action}`,
    });
  }
}

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

function nodeMaxAttempts(node: EmperorAgentNode): number {
  const defaultAttempts = node.nodeType === "skill_node" || node.toolSlug ? 2 : 1;
  const value = Number(node.maxAttempts || defaultAttempts);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 10) : defaultAttempts;
}

function nodeTimeoutAt(node: EmperorAgentNode): Date {
  const seconds = Number(node.timeoutSeconds || 600);
  const boundedSeconds = Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 5), 7200) : 600;
  return new Date(Date.now() + boundedSeconds * 1000);
}

const SUPPORTED_AGENT_NODE_TYPES = new Set([
  "input_node",
  "skill_node",
  "llm_node",
  "condition_node",
  "loop_node",
  "human_review",
  "http_node",
  "code_node",
  "mcp_node",
  "knowledge_node",
  "output_node",
]);

function edgeId(edge: EmperorAgentEdge, index: number): string {
  return String(edge.id || `${edgeSource(edge)}-${edgeTarget(edge)}` || `edge_${index}`);
}

function addDagIssue(
  issues: AgentDagValidationIssue[],
  severity: AgentDagValidationIssue["severity"],
  code: string,
  message: string,
  extra: Pick<AgentDagValidationIssue, "nodeId" | "edgeId"> = {},
) {
  issues.push({ severity, code, message, ...extra });
}

function resolveNodeToolSlugForValidation(node: EmperorAgentNode): string {
  if (node.toolSlug) return String(node.toolSlug);
  if (node.nodeType === "mcp_node") {
    const mcpSlug = String((node as any).mcpSlug || "");
    return mcpSlug ? (mcpSlug.startsWith("mcp.") ? mcpSlug : `mcp.${mcpSlug}`) : "";
  }
  if (node.nodeType === "knowledge_node") return "internal.knowledge.query";
  return "";
}

export function validateAgentDag(raw: unknown): AgentDagValidationResult {
  const dag = normalizeAgentDag(raw);
  const issues: AgentDagValidationIssue[] = [];
  const seenNodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  const nodeIds = new Set<string>();

  if (!dag.nodes.length) {
    addDagIssue(issues, "error", "dag.empty", "Agent DAG must contain at least one node.");
  }

  dag.nodes.forEach((node, index) => {
    const nodeId = String(node.id || "");
    if (!nodeId) {
      addDagIssue(issues, "error", "node.id_missing", `Node at index ${index} is missing id.`);
      return;
    }
    if (seenNodeIds.has(nodeId)) duplicateNodeIds.add(nodeId);
    seenNodeIds.add(nodeId);
    nodeIds.add(nodeId);

    if (nodeId.length > 128) {
      addDagIssue(issues, "error", "node.id_too_long", "Node id must be 128 characters or fewer.", { nodeId });
    }
    if (!node.label) {
      addDagIssue(issues, "warning", "node.label_missing", "Node should have a human readable label.", { nodeId });
    }
    const nodeType = String(node.nodeType || "");
    if (!SUPPORTED_AGENT_NODE_TYPES.has(nodeType)) {
      addDagIssue(issues, "error", "node.type_unsupported", `Unsupported node type: ${nodeType || "(empty)"}.`, { nodeId });
    }
    if (nodeType === "skill_node" && !node.skillSlug) {
      addDagIssue(issues, "error", "node.skill_missing", "Skill node must declare skillSlug.", { nodeId });
    }
    if (nodeType === "skill_node") {
      const binding = resolveAgentNodeSkillBinding(node);
      if (node.skillVersionPolicy && !["latest", "snapshot", "pinned"].includes(node.skillVersionPolicy)) {
        addDagIssue(issues, "error", "node.skill_version_policy_invalid", "Skill version policy must be latest, snapshot, or pinned.", { nodeId });
      }
      if (binding.policy === "pinned" && !binding.pinnedVersion) {
        addDagIssue(issues, "error", "node.skill_version_missing", "Pinned Skill nodes must declare skillVersion or skillVersionRef like pinned:3.", { nodeId });
      }
    }
    if (["mcp_node", "knowledge_node"].includes(nodeType) && !resolveNodeToolSlugForValidation(node)) {
      addDagIssue(issues, "error", "node.tool_missing", `${nodeType} must resolve to a Tool slug.`, { nodeId });
    }
    if (nodeType === "http_node") {
      const hasUrl = Boolean((node as any).url || (node as any).baseUrl || node.toolSlug);
      if (!hasUrl) {
        addDagIssue(issues, "warning", "node.http_target_missing", "HTTP node should declare url/baseUrl or an approved toolSlug.", { nodeId });
      }
    }
    if (nodeType === "code_node" && !node.toolSlug) {
      addDagIssue(issues, "error", "node.code_tool_missing", "Code nodes must use an approved Tool slug; arbitrary code execution is not allowed.", { nodeId });
    }
  });

  duplicateNodeIds.forEach((nodeId) => {
    addDagIssue(issues, "error", "node.id_duplicate", `Duplicate node id: ${nodeId}.`, { nodeId });
  });

  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  dag.nodes.forEach((node) => {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
  });
  const seenEdges = new Set<string>();

  dag.edges.forEach((edge, index) => {
    const source = edgeSource(edge);
    const target = edgeTarget(edge);
    const id = edgeId(edge, index);
    if (!source || !target) {
      addDagIssue(issues, "error", "edge.endpoint_missing", "Edge must declare source/from and target/to.", { edgeId: id });
      return;
    }
    if (source === target) {
      addDagIssue(issues, "error", "edge.self_loop", "Edge cannot point to the same node.", { edgeId: id });
    }
    if (!nodeIds.has(source)) {
      addDagIssue(issues, "error", "edge.source_missing", `Edge source does not exist: ${source}.`, { edgeId: id });
    }
    if (!nodeIds.has(target)) {
      addDagIssue(issues, "error", "edge.target_missing", `Edge target does not exist: ${target}.`, { edgeId: id });
    }
    const edgeKey = `${source}->${target}`;
    if (seenEdges.has(edgeKey)) {
      addDagIssue(issues, "warning", "edge.duplicate", `Duplicate edge: ${edgeKey}.`, { edgeId: id });
    }
    seenEdges.add(edgeKey);
    if (nodeIds.has(source) && nodeIds.has(target) && source !== target) {
      outgoing.get(source)?.push(target);
      incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
    }
  });

  const rootNodeIds = [...incomingCount.entries()].filter(([, count]) => count === 0).map(([nodeId]) => nodeId);
  const terminalNodeIds = [...outgoing.entries()].filter(([, children]) => children.length === 0).map(([nodeId]) => nodeId);
  if (dag.nodes.length > 0 && rootNodeIds.length === 0) {
    addDagIssue(issues, "error", "dag.root_missing", "Agent DAG must have at least one root node.");
  }
  if (dag.nodes.length > 0 && terminalNodeIds.length === 0) {
    addDagIssue(issues, "error", "dag.terminal_missing", "Agent DAG must have at least one terminal node.");
  }

  const topologicalNodeIds: string[] = [];
  const incomingForSort = new Map(incomingCount);
  const queue = [...rootNodeIds];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    topologicalNodeIds.push(nodeId);
    for (const childId of outgoing.get(nodeId) || []) {
      const nextCount = (incomingForSort.get(childId) || 0) - 1;
      incomingForSort.set(childId, nextCount);
      if (nextCount === 0) queue.push(childId);
    }
  }
  if (dag.nodes.length > 0 && topologicalNodeIds.length !== nodeIds.size) {
    addDagIssue(issues, "error", "dag.cycle_detected", "Agent DAG must be acyclic; a cycle was detected.");
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    rootNodeIds,
    terminalNodeIds,
    topologicalNodeIds,
  };
}

export function assertValidAgentDag(raw: unknown, action: string): EmperorAgentDag {
  const dag = normalizeAgentDag(raw);
  const validation = validateAgentDag(dag);
  if (validation.valid) return dag;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Invalid Agent DAG for ${action}: ${validation.errors.map((issue) => issue.message).join("; ")}`,
    cause: validation,
  });
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

function checkpointMetadata(checkpoint: Pick<CheckpointRow, "metadata"> | null | undefined): Record<string, unknown> {
  return checkpoint?.metadata && typeof checkpoint.metadata === "object"
    ? checkpoint.metadata as Record<string, unknown>
    : {};
}

async function buildNodeRunMetadata(node: EmperorAgentNode): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    node,
    preparedAt: new Date().toISOString(),
  };
  if (node.nodeType !== "skill_node" || !node.skillSlug) return metadata;

  const binding = resolveAgentNodeSkillBinding(node);
  let skillSnapshot: SkillRuntimeSnapshot;
  try {
    skillSnapshot = await getEmperorSkillRuntimeSnapshot(node.skillSlug);
  } catch (error) {
    if (error instanceof SkillRunError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }

  if (binding.policy === "pinned" && binding.pinnedVersion && binding.pinnedVersion !== skillSnapshot.version) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Agent node ${node.id} pins Skill ${node.skillSlug} to version ${binding.pinnedVersion}, but current version is ${skillSnapshot.version}.`,
    });
  }

  metadata.skillVersionPolicy = binding.policy;
  metadata.skillVersionRef = binding.ref;
  metadata.skillSnapshot = skillSnapshot;
  return metadata;
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

function normalizeTemplateVersionRow(row: any) {
  return {
    ...row,
    dagDefinition: normalizeAgentDag(row.dagDefinition),
  };
}

export async function recordAgentTemplateVersion(input: {
  agentSlug: string;
  agentName?: string | null;
  dag: EmperorAgentDag;
  status?: AgentTemplateVersionStatus;
  createdBy?: number | null;
  releaseNotes?: string | null;
}) {
  const dag = assertValidAgentDag(input.dag, "record agent template version");
  const status = input.status || "released";
  const dagHash = hashJson(dag);
  const existing = await rawExecute(
    "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    [input.agentSlug, dagHash],
  );
  if (existing[0]) {
    const nextStatus = existing[0].status === "released" && status === "draft" ? "released" : status;
    await rawExecute(
      "UPDATE emperor_agent_template_versions SET agentName=?,status=?,releaseNotes=COALESCE(?,releaseNotes),releasedAt=COALESCE(releasedAt,?),updatedAt=NOW() WHERE id=?",
      [
        input.agentName || null,
        nextStatus,
        input.releaseNotes || null,
        nextStatus === "released" ? new Date() : null,
        existing[0].id,
      ],
    );
    const rows = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [existing[0].id]);
    return normalizeTemplateVersionRow(rows[0] || existing[0]);
  }

  const latest = await rawExecute(
    "SELECT versionNumber FROM emperor_agent_template_versions WHERE agentSlug=? ORDER BY versionNumber DESC LIMIT 1",
    [input.agentSlug],
  );
  const versionNumber = Number(latest[0]?.versionNumber || 0) + 1;
  const version = `v${versionNumber}`;
  await rawExecute(
    `INSERT INTO emperor_agent_template_versions
     (agentSlug,agentName,versionNumber,version,dagHash,status,dagDefinition,releaseNotes,createdBy,releasedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      input.agentSlug,
      input.agentName || null,
      versionNumber,
      version,
      dagHash,
      status,
      stringifyJson(dag),
      input.releaseNotes || null,
      input.createdBy || null,
      status === "released" ? new Date() : null,
    ],
  );
  const rows = await rawExecute(
    "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    [input.agentSlug, dagHash],
  );
  return normalizeTemplateVersionRow(rows[0]);
}

export async function listAgentTemplateVersions(input: {
  agentSlug: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit || 20, 1), 100);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=?
     ORDER BY versionNumber DESC, id DESC
     LIMIT ${limit}`,
    [input.agentSlug],
  );
  return rows.map(normalizeTemplateVersionRow);
}

export async function upsertListingAgentTemplate() {
  const dag = assertValidAgentDag(getListingAgentDag(), "install listing template");
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
  const templateVersion = await recordAgentTemplateVersion({
    agentSlug: LISTING_AGENT_SLUG,
    agentName: "智能 Listing 全链路 Agent",
    dag,
    status: "released",
    releaseNotes: "Install Listing full workflow template",
  });
  return { success: true, slug: LISTING_AGENT_SLUG, dag, templateVersion };
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

function inferArtifactType(content: unknown): "json" | "text" | "other" {
  if (typeof content === "string") return "text";
  if (content && typeof content === "object") return "json";
  return "other";
}

function summarizeArtifactContent(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 500);
  try {
    return JSON.stringify(content ?? null).slice(0, 500);
  } catch {
    return "";
  }
}

function contextStringLimit(value?: number, fallback = 4000): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(Number(value)), 200), 50000) : fallback;
}

function trimContextValue(value: unknown, maxLength: number): unknown {
  if (typeof value === "string") {
    return value.length > maxLength
      ? { __truncated: true, originalLength: value.length, preview: value.slice(0, maxLength) }
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => trimContextValue(item, maxLength));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, trimContextValue(item, maxLength)]),
    );
  }
  return value;
}

async function persistAgentArtifact(input: {
  run: any;
  node: EmperorAgentNode;
  status: "draft" | "final";
  content: unknown;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
  metadata?: unknown;
}) {
  if (!agentArtifactStoreAvailable) return;
  const artifactKey = input.node.outputKey || input.node.id;
  try {
    if (input.status === "final") {
      await rawExecute(
        "UPDATE emperor_agent_artifacts SET status='superseded',updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND status='final'",
        [input.run.runId, input.node.id, artifactKey],
      );
    }

    const versionRows = await rawExecute(
      "SELECT COALESCE(MAX(version),0)+1 as nextVersion FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=?",
      [input.run.runId, input.node.id, artifactKey],
    );
    const version = Number(versionRows[0]?.nextVersion || 1);

    await rawExecute(
      `INSERT INTO emperor_agent_artifacts
       (runId,agentSlug,nodeId,artifactKey,artifactType,status,version,userId,projectId,content,summary,metadata,sourceSkillRunId,sourceAiJobRunId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.run.runId,
        input.run.agentSlug,
        input.node.id,
        artifactKey,
        inferArtifactType(input.content),
        input.status,
        version,
        input.run.userId,
        input.run.projectId ?? null,
        stringifyJson(input.content),
        summarizeArtifactContent(input.content),
        stringifyJson(input.metadata ?? {}),
        input.sourceSkillRunId || null,
        input.sourceAiJobRunId || null,
      ],
    );
  } catch (error) {
    agentArtifactStoreAvailable = false;
    console.warn("[Agent Artifact] Failed to persist artifact:", error);
  }
}

export async function listAgentArtifacts(input: {
  runId: string;
  userId?: number;
  nodeId?: string;
  skipOwnerCheck?: boolean;
}) {
  if (!agentArtifactStoreAvailable) return [];
  const run = await getRunRow(input.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Agent run" });
  }
  const params: unknown[] = [input.runId];
  let sql = "SELECT * FROM emperor_agent_artifacts WHERE runId=?";
  if (input.nodeId) {
    sql += " AND nodeId=?";
    params.push(input.nodeId);
  }
  sql += " ORDER BY createdAt DESC, id DESC LIMIT 200";
  try {
    const rows = await rawExecute(sql, params);
    return rows.map((artifact) => ({
      ...artifact,
      content: parseJson(artifact.content),
      metadata: parseJson(artifact.metadata, {}),
    }));
  } catch (error) {
    agentArtifactStoreAvailable = false;
    console.warn("[Agent Artifact] Failed to list artifacts:", error);
    return [];
  }
}

function parseAgentArtifactRef(ref: string) {
  const match = ref.match(/^artifact:\/\/([^/]+)\/([^/]+)\/([^@]+)@(\d+)$/);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid artifact ref" });
  }
  return {
    runId: match[1],
    nodeId: match[2],
    artifactKey: match[3],
    version: Number(match[4]),
  };
}

export async function resolveAgentArtifactRef(input: {
  ref: string;
  userId?: number;
  skipOwnerCheck?: boolean;
}) {
  const parsed = parseAgentArtifactRef(input.ref);
  const run = await getRunRow(parsed.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Artifact" });
  }
  const rows = await rawExecute(
    "SELECT * FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=? AND version=? LIMIT 1",
    [parsed.runId, parsed.nodeId, parsed.artifactKey, parsed.version],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  return {
    ...rows[0],
    content: parseJson(rows[0].content),
    metadata: parseJson(rows[0].metadata, {}),
  };
}

export async function selectAgentArtifactVersion(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  version: number;
  userId: number;
}) {
  const run = await getRunRow(input.runId);
  if (run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot select this Artifact" });
  }
  const rows = await rawExecute(
    "SELECT * FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=? AND version=? LIMIT 1",
    [input.runId, input.nodeId, input.artifactKey, input.version],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  const artifact = {
    ...rows[0],
    content: parseJson(rows[0].content),
    metadata: parseJson(rows[0].metadata, {}),
  };
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='superseded',updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND status='final'",
    [input.runId, input.nodeId, input.artifactKey],
  );
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='final',updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND version=?",
    [input.runId, input.nodeId, input.artifactKey, input.version],
  );
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET userEdit=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(artifact.content), input.runId, input.nodeId],
  );
  await addEvent(input.runId, run.agentSlug, input.nodeId, "artifact.version_selected", `Artifact ${input.artifactKey}@${input.version} 已设为当前版本`, {
    artifactKey: input.artifactKey,
    version: input.version,
  });
  return {
    ...artifact,
    status: "final",
  };
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
  const runRow = await getRunRow(runId);
  const checkpoints = await getCheckpoints(runId);
  const progress = calculateProgress(checkpoints);
  if (runRow.status === "canceled") {
    return { checkpoints, status: "canceled" as AgentRunStatus, progress };
  }
  if (runRow.status === "paused") {
    return { checkpoints, status: "paused" as AgentRunStatus, progress };
  }

  const allDone = checkpoints.length > 0 && checkpoints.every((checkpoint) => isConfirmedStatus(checkpoint.status));
  const failed = checkpoints.find((checkpoint) => checkpoint.status === "failed");
  const running = checkpoints.find((checkpoint) => checkpoint.status === "running");
  const waiting = checkpoints.find((checkpoint) => checkpoint.status === "waiting_human");
  const nextReady = checkpoints.find((checkpoint) => checkpoint.status === "ready");
  const anyRunning = checkpoints.some((checkpoint) => checkpoint.status === "running");
  const anyWaiting = checkpoints.some((checkpoint) => checkpoint.status === "waiting_human");
  const status: AgentRunStatus = allDone ? "completed" : anyRunning ? "running" : failed && !nextReady && !anyWaiting ? "failed" : "waiting_human";
  assertRunTransition(runRow.status as AgentRunStatus, status, "refresh run");
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
    assertNodeTransition(child.status, "ready", "unlock child");
    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET status='ready',updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [runId, childId],
    );
  }
}

export function buildAgentContextPackage(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  checkpoints: CheckpointRow[];
  artifacts?: any[];
  options?: AgentContextPackageOptions;
}): AgentContextPackage {
  const { run, dag, node, checkpoints } = input;
  const maxStringLength = contextStringLimit(input.options?.maxStringLength);
  const maxArtifactContentLength = contextStringLimit(input.options?.maxArtifactContentLength, 8000);
  const includeArtifactContent = input.options?.includeArtifactContent !== false;
  const parents = parentIds(dag, node.id);
  const parentOutputs = checkpoints
    .filter((checkpoint) => parents.includes(checkpoint.nodeId))
    .reduce<Record<string, unknown>>((acc, checkpoint) => {
      const parentNode = dag.nodes.find((item) => item.id === checkpoint.nodeId);
      acc[parentNode?.outputKey || checkpoint.nodeId] = trimContextValue(effectiveCheckpointOutput(checkpoint), maxStringLength);
      return acc;
    }, {});
  const confirmedOutputs = checkpoints
    .filter((checkpoint) => isConfirmedStatus(checkpoint.status))
    .reduce<Record<string, unknown>>((acc, checkpoint) => {
      const confirmedNode = dag.nodes.find((item) => item.id === checkpoint.nodeId);
      acc[confirmedNode?.outputKey || checkpoint.nodeId] = trimContextValue(effectiveCheckpointOutput(checkpoint), maxStringLength);
      return acc;
    }, {});
  const artifacts = (input.artifacts || [])
    .filter((artifact) => artifact.status === "final")
    .map((artifact) => ({
      artifactId: artifact.id,
      runId: artifact.runId,
      nodeId: artifact.nodeId,
      artifactKey: artifact.artifactKey,
      version: Number(artifact.version || 1),
      status: artifact.status,
      content: includeArtifactContent ? trimContextValue(artifact.content, maxArtifactContentLength) : null,
      sourceSkillRunId: artifact.sourceSkillRunId || null,
      sourceAiJobRunId: artifact.sourceAiJobRunId || null,
    }));
  const artifactRefs = artifacts.map((artifact) => `artifact://${artifact.runId}/${artifact.nodeId}/${artifact.artifactKey}@${artifact.version}`);
  const parsedRunInputs = parseJson(run.inputs, {});
  const runInputs = parsedRunInputs && typeof parsedRunInputs === "object" && !Array.isArray(parsedRunInputs)
    ? trimContextValue(parsedRunInputs, maxStringLength) as Record<string, unknown>
    : {};
  return {
    version: "1.0",
    agentRunId: run.runId,
    agentSlug: run.agentSlug,
    projectId: run.projectId ?? null,
    parentOutputs,
    confirmedOutputs,
    artifacts,
    node: {
      id: node.id,
      label: node.label,
      skillSlug: node.skillSlug,
      skillVersion: node.skillVersion,
      skillVersionRef: node.skillVersionRef,
      skillVersionPolicy: node.skillVersionPolicy,
      toolSlug: node.toolSlug,
      outputKey: node.outputKey,
      nodeType: node.nodeType,
      params: node.toolParams ?? null,
    },
    runInputs,
    provenance: {
      parentNodeIds: parents,
      confirmedNodeIds: checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).map((checkpoint) => checkpoint.nodeId),
      artifactRefs,
      builtAt: new Date().toISOString(),
    },
  };
}

function buildNodeInput(run: any, dag: EmperorAgentDag, node: EmperorAgentNode, checkpoints: CheckpointRow[], artifacts?: any[]) {
  const contextOptions = node.contextPackageOptions && typeof node.contextPackageOptions === "object"
    ? node.contextPackageOptions as AgentContextPackageOptions
    : node.contextBudget && typeof node.contextBudget === "object"
      ? node.contextBudget as AgentContextPackageOptions
      : undefined;
  const contextPackage = buildAgentContextPackage({ run, dag, node, checkpoints, artifacts, options: contextOptions });
  return {
    ...contextPackage,
    contextPackage,
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
  sourceAiJobRunId?: string | null;
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

  const waitingForHuman = nodeRequiresHumanGate(input.node);
  const nextStatus: AgentNodeStatus = waitingForHuman ? "waiting_human" : "confirmed";
  assertNodeTransition(checkpoint.status, nextStatus, "finalize node");
  const nextMetadata = {
    ...checkpointMetadata(checkpoint),
    ...(input.runtimeMetadata || {}),
  };
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status=?,output=?,metadata=?,skillRunId=COALESCE(?,skillRunId),reviewerUserId=?,completedAt=?,confirmedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [
      nextStatus,
      stringifyJson(input.output),
      stringifyJson(nextMetadata),
      input.skillRunId || null,
      waitingForHuman ? null : input.userId,
      new Date(),
      waitingForHuman ? null : new Date(),
      input.run.runId,
      input.node.id,
    ],
  );
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

  if (waitingForHuman) {
    if (latestRun.status !== "paused") {
      await rawExecute("UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,updatedAt=NOW() WHERE runId=?", [input.node.id, input.run.runId]);
    }
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
  const latestRun = await getRunRow(input.run.runId);
  if (latestRun.status === "canceled") {
    await addEvent(input.run.runId, input.run.agentSlug, input.node.id, "node.failure_ignored", `节点 ${input.node.label || input.node.id} 的失败已忽略：Run 已取消`);
    return;
  }

  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const checkpoint = await getCheckpoint(input.run.runId, input.node.id);
  assertNodeTransition(checkpoint.status, "failed", "fail node");
  assertRunTransition(latestRun.status as AgentRunStatus, "failed", "fail run");
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status='failed',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
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
      projectId: input.run.projectId ?? null,
    });
  }

  return invokeEmperorTool({
    toolSlug,
    params,
    userId: input.userId,
    runId: input.run.runId,
    nodeId: input.node.id,
    projectId: input.run.projectId ?? null,
  });
}

export async function startAgentRun(input: {
  slug: string;
  inputs: Record<string, unknown>;
  userId: number;
  projectId?: number | null;
}) {
  const agent = await getAgentBySlug(input.slug);
  const dag = assertValidAgentDag(agent.dagDefinition, "start run");
  const templateVersion = await recordAgentTemplateVersion({
    agentSlug: agent.slug,
    agentName: agent.name,
    dag,
    status: agent.status === "draft" ? "draft" : "released",
    createdBy: input.userId,
    releaseNotes: "Captured for Agent run",
  });
  const nodeMetadata = new Map<string, Record<string, unknown>>();
  for (const node of dag.nodes) {
    nodeMetadata.set(node.id, await buildNodeRunMetadata(node));
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
    "INSERT INTO emperor_agent_runs (runId,agentSlug,agentName,templateVersionId,templateVersion,dagHash,userId,projectId,status,currentNodeId,progress,inputs,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
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
      "INSERT INTO emperor_agent_checkpoints (runId,agentSlug,nodeId,nodeLabel,nodeType,status,maxAttempts,metadata) VALUES (?,?,?,?,?,?,?,?)",
      [runId, agent.slug, node.id, node.label || node.id, node.nodeType || "skill_node", status, nodeMaxAttempts(node), stringifyJson(nodeMetadata.get(node.id) || { node })],
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
    assertNodeTransition(checkpoint.status, "ready", "unlock ready node");
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

  if (descendants.length > 0) {
    const placeholders = descendants.map(() => "?").join(",");
    await rawExecute(
      `UPDATE emperor_agent_checkpoints
       SET status='pending',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId IN (${placeholders})`,
      [input.runId, ...descendants],
    );
  }

  await rawExecute(
    `UPDATE emperor_agent_checkpoints
     SET status='ready',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
     WHERE runId=? AND nodeId=?`,
    [input.runId, input.nodeId],
  );
  await rawExecute("UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,errorMessage=NULL,completedAt=NULL,updatedAt=NOW() WHERE runId=?", [input.nodeId, input.runId]);
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
  assertRunTransition(run.status as AgentRunStatus, "canceled", "cancel run");

  const checkpoints = detail.checkpoints as CheckpointRow[];
  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== "running") continue;
    assertNodeTransition(checkpoint.status, "failed", "cancel running node");
    if (checkpoint.aiJobRunId) {
      await cancelAiJob(checkpoint.aiJobRunId, input.reason || "Agent run canceled");
    }
  }

  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status='failed',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,updatedAt=NOW() WHERE runId=? AND status='running'",
    [input.reason || "Agent run canceled", new Date(), input.runId],
  );
  await rawExecute(
    "UPDATE emperor_agent_runs SET status='canceled',currentNodeId=NULL,errorMessage=?,completedAt=?,updatedAt=NOW() WHERE runId=?",
    [input.reason || "Agent run canceled", new Date(), input.runId],
  );
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
  assertRunTransition(run.status as AgentRunStatus, "paused", "pause run");
  await rawExecute(
    "UPDATE emperor_agent_runs SET status='paused',errorMessage=?,updatedAt=NOW() WHERE runId=?",
    [input.reason || null, input.runId],
  );
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
  assertRunTransition(run.status as AgentRunStatus, nextStatus, "resume run");
  await rawExecute(
    "UPDATE emperor_agent_runs SET status=?,errorMessage=NULL,updatedAt=NOW() WHERE runId=?",
    [nextStatus, input.runId],
  );
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
  const result = { scanned: rows.length, failed: 0, skippedPaused: 0 };
  for (const row of rows) {
    const checkpoint = checkpointPayload(row);
    const run = await getRunRow(checkpoint.runId).catch(() => null);
    if (!run || run.status === "canceled" || run.status === "completed") continue;
    if (run.status === "paused") {
      result.skippedPaused += 1;
      continue;
    }

    const message = `Node timed out at ${checkpoint.timeoutAt instanceof Date ? checkpoint.timeoutAt.toISOString() : checkpoint.timeoutAt}`;
    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET status='failed',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=? AND status='running'",
      [message, new Date(), checkpoint.runId, checkpoint.nodeId],
    );
    if (checkpoint.aiJobRunId) {
      await failAiJob(checkpoint.aiJobRunId, new Error(message));
    }
    await rawExecute(
      "UPDATE emperor_agent_runs SET status='failed',errorMessage=?,currentNodeId=?,updatedAt=NOW() WHERE runId=?",
      [message, checkpoint.nodeId, checkpoint.runId],
    );
    await addEvent(checkpoint.runId, checkpoint.agentSlug, checkpoint.nodeId, "node.timeout", `节点 ${checkpoint.nodeLabel || checkpoint.nodeId} 执行超时`, {
      error: message,
      aiJobRunId: checkpoint.aiJobRunId || null,
    });
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
  assertNodeTransition(checkpoint.status, nextStatus, "confirm node");
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status=?,output=COALESCE(?,output),userEdit=?,reviewerUserId=?,confirmedAt=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
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
  assertNodeTransition(checkpoint.status, "running", "execute node");
  assertRunTransition(run.status as AgentRunStatus, "running", "execute node");

  const nodeInput = buildNodeInput(run, dag, node, detail.checkpoints, detail.artifacts);
  const metadata = checkpointMetadata(checkpoint);
  const binding = resolveAgentNodeSkillBinding(node);
  const skillSnapshot = metadata.skillSnapshot && typeof metadata.skillSnapshot === "object"
    ? metadata.skillSnapshot as SkillRuntimeSnapshot
    : null;
  const lockToken = generateRunId("node_lock");
  const lockedAt = new Date();
  const timeoutAt = nodeTimeoutAt(node);
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET status='running',attempt=attempt+1,input=?,errorMessage=NULL,startedAt=?,lockToken=?,lockedAt=?,timeoutAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=? AND status=?",
    [stringifyJson(nodeInput), lockedAt, lockToken, lockedAt, timeoutAt, input.runId, input.nodeId, checkpoint.status],
  );
  const claimedCheckpoint = await getCheckpoint(input.runId, input.nodeId);
  if (claimedCheckpoint.lockToken !== lockToken) {
    await addEvent(input.runId, run.agentSlug, input.nodeId, "node.execution_deduped", `节点 ${node.label || node.id} 已被其他执行请求锁定`);
    return getAgentRun(input.runId, input.userId, true);
  }
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

  let job: AiJobSnapshot;
  try {
    job = await startRegisteredAiJob({
      kind: `agent.node.${node.id}`,
      module: "emperorAgent",
      procedure: "emperor.agents.executeNode",
      userId: input.userId,
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

    await rawExecute(
      "UPDATE emperor_agent_checkpoints SET aiJobRunId=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [job.runId, input.runId, input.nodeId],
    );
  } catch (error) {
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

  try {
    const result = await runEmperorSkill({
      skillSlug: payload.skillSlug,
      userId: job.userId,
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
    if (job.attempt < job.maxAttempts) {
      const retryDelayMs = calculateAiJobRetryDelayMs(job.attempt);
      const timeoutMs = Math.min(Math.max(job.timeoutSeconds || 600, 5), 7200) * 1000;
      const nextTimeoutAt = new Date(Date.now() + retryDelayMs + timeoutMs + 5000);
      await rawExecute(
        "UPDATE emperor_agent_checkpoints SET errorMessage=?,timeoutAt=?,updatedAt=NOW() WHERE runId=? AND nodeId=? AND status='running'",
        [error instanceof Error ? error.message : String(error), nextTimeoutAt, payload.runId, payload.nodeId],
      );
      await addEvent(payload.runId, run.agentSlug, node.id, "node.retry_scheduled", `节点 ${node.label || node.id} 失败，已等待第 ${job.attempt + 1}/${job.maxAttempts} 次重试`, {
        aiJobRunId: job.runId,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        retryDelayMs,
        timeoutAt: nextTimeoutAt.toISOString(),
      });
    } else {
      await failNodeExecution({ run, node, error });
    }
    throw error;
  }
}

registerAiJobHandler({
  id: "emperorAgent.nodeSkill",
  match: (job) => job.module === "emperorAgent" && job.procedure === "emperor.agents.executeNode",
  handler: runAgentNodeSkillJob,
});
