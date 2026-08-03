import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../db";
import { buildWorkspaceScopeFilter } from "../../../services/securityGovernance";
import {
  assertNodeTransition,
  canTransitionNodeStatus,
  canTransitionRunStatus,
  withAgentStateMachine,
  type AgentNodeStatus,
  type AgentRunStatus,
} from "./agentStateMachine";
import {
  getEmperorSkillRuntimeSnapshot,
  normalizeSkillVersion,
  runEmperorSkill,
  safeParseSkillJSON,
  SkillRunError,
  type SkillRuntimeSnapshot,
  type SkillVersionPolicy,
} from "./skillRunner";
import { calculateAiJobRetryDelayMs, cancelAiJob, failAiJob, getAiJobRun, registerAiJobHandler, retryAiJob, startRegisteredAiJob, type AiJobSnapshot } from "./jobRunner";
import { invokeEmperorTool } from "./toolGateway";
import { recordAiOsEvaluation, recordAiOsMetric } from "./observability";

export { canTransitionNodeStatus, canTransitionRunStatus };
export type { AgentNodeStatus, AgentRunStatus } from "./agentStateMachine";

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
  artifactType?: AgentArtifactType;
  version: number;
  status: string;
  isCurrent?: boolean;
  ref?: string;
  currentRef?: string;
  content: unknown;
  metadata?: unknown;
  contentHash?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  storageUri?: string | null;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
};

export type AgentContextResourceKind = "file" | "image" | "table";

export type AgentContextResourceRef = {
  kind: AgentContextResourceKind;
  artifactId?: number;
  runId: string;
  nodeId: string;
  artifactKey: string;
  artifactType?: AgentArtifactType;
  version: number;
  ref: string;
  currentRef: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  storageUri?: string | null;
  contentHash?: string | null;
  metadata?: unknown;
};

export type AgentContextBudgetSection = {
  estimatedTokens: number;
  limitTokens: number;
};

export type AgentContextBudgetReport = {
  maxTokens: number;
  estimatedTokens: number;
  overBudget: boolean;
  sections: Record<string, AgentContextBudgetSection>;
  truncatedFields: string[];
  summarizedFields: string[];
  resolvedArtifactRefs: string[];
  resourceCounts: Record<AgentContextResourceKind, number>;
};

export type AgentContextProvenanceSource = {
  path: string;
  sourceType: "run_input" | "checkpoint" | "artifact" | "artifact_ref";
  nodeId?: string;
  artifactRef?: string;
  checkpointStatus?: string;
  artifactVersion?: number;
};

export type AgentContextPackage = {
  version: "1.0";
  schema: {
    name: "agent.context_package";
    version: "1.1";
    sections: string[];
  };
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
  resourceRefs: Record<AgentContextResourceKind, AgentContextResourceRef[]>;
  contextBudget: AgentContextBudgetReport;
  provenance: {
    parentNodeIds: string[];
    confirmedNodeIds: string[];
    artifactRefs: string[];
    currentArtifactRefs: string[];
    sources: AgentContextProvenanceSource[];
    builtAt: string;
  };
};

export type AgentContextPackageOptions = {
  maxStringLength?: number;
  maxArtifactContentLength?: number;
  includeArtifactContent?: boolean;
  maxTokens?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  summaryStringLength?: number;
  sectionTokenBudgets?: Partial<Record<"runInputs" | "parentOutputs" | "confirmedOutputs" | "artifacts", number>>;
};

type CheckpointRow = {
  workspaceId?: number | null;
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
  aiJobAttempt?: number | null;
  aiJobClaimedAt?: Date | null;
  lockToken?: string | null;
  lockedAt?: Date | null;
  timeoutAt?: Date | null;
  retryCount?: number | null;
  retryScheduledAt?: Date | null;
  lastFailureKind?: string | null;
  errorMessage?: string | null;
};

export type AgentArtifactType = "json" | "text" | "markdown" | "html" | "image" | "file" | "table" | "other";

export const LISTING_AGENT_SLUG = "listing.full.workflow";
let agentArtifactStoreAvailable = true;

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

function hashArtifactContent(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
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

function stringifyJsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : stringifyJson(value);
}

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
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

async function buildNodeRunMetadata(node: EmperorAgentNode, workspaceId?: number | null): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    node,
    preparedAt: new Date().toISOString(),
  };
  if (node.nodeType !== "skill_node" || !node.skillSlug) return metadata;

  const binding = resolveAgentNodeSkillBinding(node);
  let skillSnapshot: SkillRuntimeSnapshot;
  try {
    skillSnapshot = await getEmperorSkillRuntimeSnapshot(node.skillSlug, workspaceId);
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
    isDefault: Boolean(row?.isDefault),
    rolloutPercent: Math.min(Math.max(Number(row?.rolloutPercent ?? 100), 0), 100),
    rolloutPolicy: parseJson(row?.rolloutPolicy, null),
    dagDefinition: normalizeAgentDag(row.dagDefinition),
  };
}

function templateRolloutBucket(input: { agentSlug: string; userId: number; projectId?: number | null; version: string }) {
  const key = `${input.agentSlug}:${input.version}:${input.userId}:${input.projectId ?? "none"}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) % 100;
}

async function findAgentTemplateVersion(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  workspaceId?: number | null;
}) {
  if (!input.versionId && !input.version) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Template versionId or version is required" });
  }
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const rows = input.versionId
    ? await rawExecute(
      scope
        ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND id=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
        : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND id=? LIMIT 1",
      scope ? [input.agentSlug, input.versionId, ...scope.params] : [input.agentSlug, input.versionId],
    )
    : await rawExecute(
      scope
        ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND version=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
        : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND version=? LIMIT 1",
      scope ? [input.agentSlug, input.version || "", ...scope.params] : [input.agentSlug, input.version || ""],
    );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent template version not found" });
  return normalizeTemplateVersionRow(rows[0]);
}

async function getDefaultAgentTemplateVersion(agentSlug: string, workspaceId?: number | null) {
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND status='released' AND isDefault=1 AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT 1`,
    [agentSlug, ...scope.params],
  );
  return rows[0] ? normalizeTemplateVersionRow(rows[0]) : null;
}

async function selectAgentTemplateVersionForRun(input: {
  agent: any;
  userId: number;
  workspaceId?: number | null;
  projectId?: number | null;
}) {
  const scope = buildWorkspaceScopeFilter(input.workspaceId ?? input.agent.workspaceId ?? null);
  const canaryRows = await rawExecute(
    `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND status='released' AND isDefault=0 AND rolloutPercent > 0 AND rolloutPercent < 100 AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT 20`,
    [input.agent.slug, ...scope.params],
  ).catch(() => []);
  for (const row of canaryRows) {
    const template = normalizeTemplateVersionRow(row);
    if (templateRolloutBucket({
      agentSlug: input.agent.slug,
      version: template.version,
      userId: input.userId,
      projectId: input.projectId ?? null,
    }) < template.rolloutPercent) {
      return template;
    }
  }

  const defaultVersion = await getDefaultAgentTemplateVersion(input.agent.slug, input.workspaceId ?? input.agent.workspaceId ?? null).catch(() => null);
  if (defaultVersion) return defaultVersion;
  return recordAgentTemplateVersion({
    workspaceId: input.workspaceId ?? input.agent.workspaceId ?? null,
    agentSlug: input.agent.slug,
    agentName: input.agent.name,
    dag: normalizeAgentDag(input.agent.dagDefinition),
    status: input.agent.status === "draft" ? "draft" : "released",
    createdBy: input.userId,
    releaseNotes: "Captured default Agent template",
    isDefault: input.agent.status !== "draft",
    rolloutPercent: input.agent.status === "draft" ? 0 : 100,
  });
}

export async function recordAgentTemplateVersion(input: {
  workspaceId?: number | null;
  agentSlug: string;
  agentName?: string | null;
  dag: EmperorAgentDag;
  status?: AgentTemplateVersionStatus;
  createdBy?: number | null;
  releaseNotes?: string | null;
  parentVersionId?: number | null;
  isDefault?: boolean;
  rolloutPercent?: number | null;
  rolloutPolicy?: unknown;
}) {
  const dag = assertValidAgentDag(input.dag, "record agent template version");
  const status = input.status || "released";
  const dagHash = hashJson(dag);
  const rolloutPercent = Math.min(Math.max(Math.floor(Number(input.rolloutPercent ?? (status === "released" ? 100 : 0))), 0), 100);
  const isDefault = input.isDefault ?? (status === "released" && rolloutPercent >= 100);
  const rolloutPolicyProvided = input.rolloutPolicy !== undefined;
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const existing = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    scope ? [input.agentSlug, dagHash, ...scope.params] : [input.agentSlug, dagHash],
  );
  if (existing[0]) {
    const nextStatus = existing[0].status === "released" && status === "draft" ? "released" : status;
    const nextIsDefault = input.isDefault === undefined ? Number(existing[0].isDefault || 0) : (isDefault ? 1 : 0);
    const nextRolloutPercent = input.rolloutPercent === undefined ? Number(existing[0].rolloutPercent ?? rolloutPercent) : rolloutPercent;
    await rawExecute(
      "UPDATE emperor_agent_template_versions SET agentName=?,status=?,isDefault=?,rolloutPercent=?,rolloutPolicy=?,releaseNotes=COALESCE(?,releaseNotes),releasedAt=COALESCE(releasedAt,?),activatedAt=COALESCE(activatedAt,?),updatedAt=NOW() WHERE id=?",
      [
        input.agentName || null,
        nextStatus,
        nextIsDefault,
        nextRolloutPercent,
        rolloutPolicyProvided ? stringifyJson(input.rolloutPolicy) : stringifyJsonOrNull(existing[0].rolloutPolicy),
        input.releaseNotes || null,
        nextStatus === "released" ? new Date() : null,
        nextIsDefault ? new Date() : null,
        existing[0].id,
      ],
    );
    if (nextIsDefault) {
      await rawExecute(
        scope
          ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
          : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
        scope ? [new Date(), input.agentSlug, existing[0].id, ...scope.params] : [new Date(), input.agentSlug, existing[0].id],
      );
    }
    const rows = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [existing[0].id]);
    return normalizeTemplateVersionRow(rows[0] || existing[0]);
  }

  const latest = await rawExecute(
    scope
      ? `SELECT versionNumber FROM emperor_agent_template_versions WHERE agentSlug=? AND ${scope.clause} ORDER BY versionNumber DESC LIMIT 1`
      : "SELECT versionNumber FROM emperor_agent_template_versions WHERE agentSlug=? ORDER BY versionNumber DESC LIMIT 1",
    scope ? [input.agentSlug, ...scope.params] : [input.agentSlug],
  );
  const versionNumber = Number(latest[0]?.versionNumber || 0) + 1;
  const version = `v${versionNumber}`;
  await rawExecute(
    `INSERT INTO emperor_agent_template_versions
     (workspaceId,agentSlug,agentName,parentVersionId,versionNumber,version,dagHash,status,isDefault,rolloutPercent,rolloutPolicy,dagDefinition,releaseNotes,createdBy,releasedAt,activatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.workspaceId ?? null,
      input.agentSlug,
      input.agentName || null,
      input.parentVersionId || null,
      versionNumber,
      version,
      dagHash,
      status,
      isDefault ? 1 : 0,
      rolloutPercent,
      input.rolloutPolicy === undefined ? null : stringifyJson(input.rolloutPolicy),
      stringifyJson(dag),
      input.releaseNotes || null,
      input.createdBy || null,
      status === "released" ? new Date() : null,
      isDefault ? new Date() : null,
    ],
  );
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    scope ? [input.agentSlug, dagHash, ...scope.params] : [input.agentSlug, dagHash],
  );
  if (isDefault && rows[0]?.id) {
    await rawExecute(
      scope
        ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
        : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
      scope ? [new Date(), input.agentSlug, rows[0].id, ...scope.params] : [new Date(), input.agentSlug, rows[0].id],
    );
    const refreshed = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [rows[0].id]);
    return normalizeTemplateVersionRow(refreshed[0] || rows[0]);
  }
  return normalizeTemplateVersionRow(rows[0]);
}

export async function listAgentTemplateVersions(input: {
  agentSlug: string;
  limit?: number;
  workspaceId?: number | null;
}) {
  const limit = Math.min(Math.max(input.limit || 20, 1), 100);
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT ${limit}`
      : `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=?
     ORDER BY versionNumber DESC, id DESC
     LIMIT ${limit}`,
    scope ? [input.agentSlug, ...scope.params] : [input.agentSlug],
  );
  return rows.map(normalizeTemplateVersionRow);
}

export async function publishAgentTemplateVersion(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  rolloutPercent?: number;
  rolloutPolicy?: unknown;
  releaseNotes?: string | null;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const template = await findAgentTemplateVersion(input);
  const dag = assertValidAgentDag(template.dagDefinition, "publish agent template version");
  const rolloutPercent = Math.min(Math.max(Math.floor(Number(input.rolloutPercent ?? 100)), 0), 100);
  const now = new Date();
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  if (rolloutPercent >= 100) {
    await rawExecute(
      scope
        ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
        : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
      scope ? [now, input.agentSlug, template.id, ...scope.params] : [now, input.agentSlug, template.id],
    );
    await rawExecute(
      scope
        ? `UPDATE emperor_agents SET dagDefinition=?, status='active', updatedAt=NOW() WHERE slug=? AND ${scope.clause}`
        : "UPDATE emperor_agents SET dagDefinition=?, status='active', updatedAt=NOW() WHERE slug=?",
      scope ? [stringifyJson(dag), input.agentSlug, ...scope.params] : [stringifyJson(dag), input.agentSlug],
    );
  }
  await rawExecute(
    `UPDATE emperor_agent_template_versions
     SET status='released',
         isDefault=?,
         rolloutPercent=?,
         rolloutPolicy=?,
         releaseNotes=COALESCE(?, releaseNotes),
         releasedAt=COALESCE(releasedAt, ?),
         activatedAt=?,
         deprecatedAt=NULL,
         updatedAt=NOW()
     WHERE id=?`,
    [
      rolloutPercent >= 100 ? 1 : 0,
      rolloutPercent,
      input.rolloutPolicy === undefined ? stringifyJsonOrNull(template.rolloutPolicy) : stringifyJson(input.rolloutPolicy),
      input.releaseNotes || null,
      now,
      rolloutPercent > 0 ? now : null,
      template.id,
    ],
  );
  const rows = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [template.id]);
  await recordAiOsMetric({
    entityType: "agent_run",
    entityId: `${input.agentSlug}:${template.version}`,
    metricName: rolloutPercent >= 100 ? "template.published" : "template.rollout_started",
    metricValue: rolloutPercent,
    status: "released",
    workspaceId: input.workspaceId ?? null,
    userId: input.userId ?? null,
    agentSlug: input.agentSlug,
    metadata: { version: template.version, versionId: template.id, rolloutPercent },
  });
  return {
    success: true,
    templateVersion: normalizeTemplateVersionRow(rows[0] || template),
    validation: validateAgentDag(dag),
  };
}

export async function rollbackAgentTemplateVersion(input: {
  agentSlug: string;
  targetVersionId?: number | null;
  targetVersion?: string | null;
  releaseNotes?: string | null;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const target = await findAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.targetVersionId ?? null,
    version: input.targetVersion ?? null,
    workspaceId: input.workspaceId ?? null,
  });
  return publishAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: target.id,
    rolloutPercent: 100,
    releaseNotes: input.releaseNotes || `Rollback to ${target.version}`,
    userId: input.userId ?? null,
    workspaceId: input.workspaceId ?? null,
  });
}

export async function setAgentTemplateRollout(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  rolloutPercent: number;
  rolloutPolicy?: unknown;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  return publishAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.versionId ?? null,
    version: input.version ?? null,
    rolloutPercent: input.rolloutPercent,
    rolloutPolicy: input.rolloutPolicy,
    releaseNotes: `Rollout set to ${Math.min(Math.max(Math.floor(Number(input.rolloutPercent)), 0), 100)}%`,
    userId: input.userId ?? null,
    workspaceId: input.workspaceId ?? null,
  });
}

export async function diffAgentTemplateVersions(input: {
  agentSlug: string;
  baseVersionId?: number | null;
  baseVersion?: string | null;
  targetVersionId?: number | null;
  targetVersion?: string | null;
  limit?: number;
  workspaceId?: number | null;
}) {
  const target = await findAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.targetVersionId ?? null,
    version: input.targetVersion ?? null,
    workspaceId: input.workspaceId ?? null,
  });
  let base = input.baseVersionId || input.baseVersion
    ? await findAgentTemplateVersion({
      agentSlug: input.agentSlug,
      versionId: input.baseVersionId ?? null,
      version: input.baseVersion ?? null,
      workspaceId: input.workspaceId ?? null,
    })
    : null;
  const scope = buildWorkspaceScopeFilter(input.workspaceId ?? null);
  if (!base) {
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_template_versions
       WHERE agentSlug=? AND versionNumber < ? AND ${scope.clause}
       ORDER BY versionNumber DESC, id DESC
       LIMIT 1`,
      [input.agentSlug, target.versionNumber, ...scope.params],
    );
    base = rows[0] ? normalizeTemplateVersionRow(rows[0]) : null;
  }
  if (!base) throw new TRPCError({ code: "NOT_FOUND", message: "Base template version not found" });
  const entries = diffAgentArtifactContent(base.dagDefinition, target.dagDefinition, input.limit || 300);
  return {
    agentSlug: input.agentSlug,
    base: {
      id: base.id,
      version: base.version,
      dagHash: base.dagHash,
    },
    target: {
      id: target.id,
      version: target.version,
      dagHash: target.dagHash,
      rolloutPercent: target.rolloutPercent,
      isDefault: target.isDefault,
    },
    changed: entries.length > 0,
    entries,
  };
}

export async function backfillAgentRunTemplateVersions(input: {
  agentSlug?: string | null;
  limit?: number;
  dryRun?: boolean;
  userId?: number | null;
} = {}) {
  const limit = Math.min(Math.max(input.limit || 200, 1), 1000);
  const clauses = ["(templateVersionId IS NULL OR templateVersion IS NULL OR dagHash IS NULL)"];
  const params: unknown[] = [];
  if (input.agentSlug) {
    clauses.push("agentSlug=?");
    params.push(input.agentSlug);
  }
  const rows = await rawExecute(
    `SELECT id,runId,agentSlug,agentName,userId,projectId,inputs,dagHash,templateVersionId,templateVersion
     FROM emperor_agent_runs
     WHERE ${clauses.join(" AND ")}
     ORDER BY createdAt ASC
     LIMIT ${limit}`,
    params,
  );
  const agentCache = new Map<string, any>();
  const results: Array<{ runId: string; agentSlug: string; templateVersion: string | null; templateVersionId: number | null; dagHash: string | null; updated: boolean }> = [];
  for (const row of rows) {
    if (!agentCache.has(row.agentSlug)) {
      agentCache.set(row.agentSlug, await getAgentBySlug(row.agentSlug));
    }
    const agent = agentCache.get(row.agentSlug);
    const storedInputs = parseStoredAgentRunInputs(row.inputs);
    const dag = assertValidAgentDag(storedInputs.runtime?.dagSnapshot || agent.dagDefinition, "backfill run template version");
    const template = await recordAgentTemplateVersion({
      agentSlug: row.agentSlug,
      agentName: row.agentName || agent.name,
      dag,
      status: agent.status === "draft" ? "draft" : "released",
      createdBy: input.userId ?? row.userId ?? null,
      releaseNotes: "Backfilled from historical Agent run",
      isDefault: false,
      rolloutPercent: 0,
    });
    const stored = buildStoredAgentRunInputs({
      inputs: storedInputs.inputs,
      agentSlug: row.agentSlug,
      agentName: row.agentName || agent.name,
      templateVersionId: template.id ?? null,
      templateVersion: template.version ?? null,
      dag,
    });
    if (!input.dryRun) {
      await rawExecute(
        "UPDATE emperor_agent_runs SET templateVersionId=?,templateVersion=?,dagHash=?,inputs=?,updatedAt=NOW() WHERE id=?",
        [template.id ?? null, template.version ?? null, template.dagHash ?? hashJson(dag), stringifyJson(stored), row.id],
      );
    }
    results.push({
      runId: row.runId,
      agentSlug: row.agentSlug,
      templateVersion: template.version ?? null,
      templateVersionId: template.id ?? null,
      dagHash: template.dagHash ?? hashJson(dag),
      updated: !input.dryRun,
    });
  }
  await recordAiOsMetric({
    entityType: "agent_run",
    entityId: input.agentSlug || "all",
    metricName: "template.backfilled_runs",
    metricValue: results.length,
    status: input.dryRun ? "dry_run" : "completed",
    workspaceId: null,
    userId: input.userId ?? null,
    agentSlug: input.agentSlug || null,
    metadata: { dryRun: input.dryRun === true, limit },
  });
  return {
    success: true,
    dryRun: input.dryRun === true,
    scanned: rows.length,
    updated: input.dryRun ? 0 : results.length,
    results,
  };
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

async function getAgentBySlug(slug: string, workspaceId?: number | null) {
  const scope = workspaceId === undefined ? null : buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agents WHERE slug=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agents WHERE slug=? LIMIT 1",
    scope ? [slug, ...scope.params] : [slug],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  return {
    ...rows[0],
    dagDefinition: normalizeAgentDag(rows[0].dagDefinition),
  };
}

async function addEvent(runId: string, agentSlug: string, nodeId: string | null, eventType: string, message: string, payload?: unknown) {
  await rawExecute(
    `INSERT INTO emperor_agent_events (workspaceId,runId,agentSlug,nodeId,eventType,message,payload)
     SELECT workspaceId,?,?,?,?,?,?
     FROM emperor_agent_runs
     WHERE runId=?
     LIMIT 1`,
    [runId, agentSlug, nodeId, eventType, message, payload === undefined ? null : stringifyJson(payload), runId],
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

const AGENT_ARTIFACT_TYPES = new Set<AgentArtifactType>(["json", "text", "markdown", "html", "image", "file", "table", "other"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeArtifactType(value: unknown): AgentArtifactType | null {
  const normalized = String(value || "").trim().toLowerCase();
  return AGENT_ARTIFACT_TYPES.has(normalized as AgentArtifactType) ? normalized as AgentArtifactType : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  }
  return null;
}

function inferArtifactType(content: unknown, metadata: Record<string, unknown> = {}): AgentArtifactType {
  const declared = normalizeArtifactType(metadata.artifactType || metadata.type);
  if (declared) return declared;
  const mimeType = firstString(metadata.mimeType, metadata.contentType);
  const fileName = firstString(metadata.fileName, metadata.name);
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.includes("spreadsheet") || mimeType === "text/csv" || mimeType?.includes("tab-separated-values")) return "table";
  if (fileName && /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) return "image";
  if (fileName && /\.(csv|xlsx?|tsv)$/i.test(fileName)) return "table";
  if (Object.keys(asRecord(metadata.image)).length > 0) return "image";
  if (Object.keys(asRecord(metadata.table)).length > 0) return "table";
  if (Object.keys(asRecord(metadata.file)).length > 0) return "file";
  if (typeof content === "string") return "text";
  if (content && typeof content === "object") return "json";
  return "other";
}

function normalizeArtifactMetadata(content: unknown, rawMetadata: unknown) {
  const metadata = asRecord(rawMetadata);
  const contentRecord = asRecord(content);
  const file = asRecord(metadata.file || contentRecord.file);
  const image = asRecord(metadata.image || contentRecord.image);
  const table = asRecord(metadata.table || contentRecord.table);
  const mimeType = firstString(metadata.mimeType, metadata.contentType, file.mimeType, file.contentType, image.mimeType, table.mimeType);
  const fileName = firstString(metadata.fileName, metadata.name, file.fileName, file.name, image.fileName, table.fileName);
  const fileSizeBytes = firstNumber(metadata.fileSizeBytes, metadata.sizeBytes, metadata.size, file.fileSizeBytes, file.sizeBytes, file.size, image.fileSizeBytes, table.fileSizeBytes);
  const storageUri = firstString(metadata.storageUri, metadata.uri, metadata.url, file.storageUri, file.uri, file.url, image.storageUri, image.url, table.storageUri);
  const artifactType = inferArtifactType(content, { ...metadata, mimeType, fileName });
  return {
    artifactType,
    mimeType,
    fileName,
    fileSizeBytes,
    storageUri,
    metadata: {
      ...metadata,
      artifactType,
      file: Object.keys(file).length > 0 ? file : undefined,
      image: Object.keys(image).length > 0 ? image : undefined,
      table: Object.keys(table).length > 0 ? table : undefined,
      mimeType,
      fileName,
      fileSizeBytes,
      storageUri,
    },
  };
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

function contextNumberLimit(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? "");
  }
}

export function estimateAgentContextTokens(value: unknown): number {
  return Math.max(1, Math.ceil(safeSerialize(value).length / 4));
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

type ContextTrimStats = {
  truncatedFields: string[];
  summarizedFields: string[];
};

type ContextTrimOptions = {
  maxStringLength: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  path: string;
  stats: ContextTrimStats;
};

function trimContextValueWithOptions(value: unknown, options: ContextTrimOptions): unknown {
  if (typeof value === "string") {
    if (value.length <= options.maxStringLength) return value;
    pushUnique(options.stats.truncatedFields, options.path);
    return {
      __truncated: true,
      originalLength: value.length,
      preview: value.slice(0, options.maxStringLength),
    };
  }
  if (Array.isArray(value)) {
    const maxItems = options.maxArrayItems;
    const source = value.length > maxItems ? value.slice(0, maxItems) : value;
    const items = source.map((item, index) => trimContextValueWithOptions(item, {
      ...options,
      path: `${options.path}[${index}]`,
    }));
    if (value.length <= maxItems) return items;
    pushUnique(options.stats.summarizedFields, options.path);
    return {
      __summary: true,
      kind: "array",
      originalLength: value.length,
      sample: items,
      omittedItems: value.length - source.length,
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const maxKeys = options.maxObjectKeys;
    const selectedEntries = entries.length > maxKeys ? entries.slice(0, maxKeys) : entries;
    const trimmed = Object.fromEntries(
      selectedEntries.map(([key, item]) => [key, trimContextValueWithOptions(item, {
        ...options,
        path: `${options.path}.${key}`,
      })]),
    );
    if (entries.length <= maxKeys) return trimmed;
    pushUnique(options.stats.summarizedFields, options.path);
    return {
      ...trimmed,
      __summary: true,
      __truncatedKeys: entries.slice(maxKeys).map(([key]) => key),
      __omittedKeyCount: entries.length - selectedEntries.length,
    };
  }
  return value;
}

function summarizeContextValue(value: unknown, targetChars: number, path: string, stats: ContextTrimStats): unknown {
  pushUnique(stats.summarizedFields, path);
  const maxPreviewLength = Math.min(Math.max(Math.floor(targetChars), 200), 8000);
  if (typeof value === "string") {
    return {
      __summary: true,
      kind: "string",
      originalLength: value.length,
      preview: value.slice(0, maxPreviewLength),
    };
  }
  if (Array.isArray(value)) {
    const sampleSize = Math.min(value.length, 5);
    return {
      __summary: true,
      kind: "array",
      originalLength: value.length,
      sample: value.slice(0, sampleSize).map((item, index) => trimContextValueWithOptions(item, {
        maxStringLength: Math.min(maxPreviewLength, 1000),
        maxArrayItems: 8,
        maxObjectKeys: 20,
        path: `${path}[${index}]`,
        stats,
      })),
      omittedItems: Math.max(value.length - sampleSize, 0),
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const previewEntries = entries.slice(0, 12);
    return {
      __summary: true,
      kind: "object",
      originalLength: safeSerialize(value).length,
      keys: entries.map(([key]) => key).slice(0, 80),
      preview: Object.fromEntries(previewEntries.map(([key, item]) => [key, trimContextValueWithOptions(item, {
        maxStringLength: Math.min(maxPreviewLength, 1000),
        maxArrayItems: 8,
        maxObjectKeys: 20,
        path: `${path}.${key}`,
        stats,
      })])),
    };
  }
  return value;
}

function fitValueToTokenBudget(value: unknown, limitTokens: number, path: string, stats: ContextTrimStats): unknown {
  if (estimateAgentContextTokens(value) <= limitTokens) return value;
  return summarizeContextValue(value, limitTokens * 4, path, stats);
}

async function persistAgentArtifact(input: {
  run: any;
  node: EmperorAgentNode;
  status: "draft" | "final";
  content: unknown;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
  metadata?: unknown;
  selectedBy?: number | null;
}) {
  if (!agentArtifactStoreAvailable) return;
  const artifactKey = input.node.outputKey || input.node.id;
  const artifactMetadata = normalizeArtifactMetadata(input.content, input.metadata);
  const currentSince = input.status === "final" ? new Date() : null;
  try {
    if (input.status === "final") {
      await rawExecute(
        "UPDATE emperor_agent_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1",
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
       (workspaceId,runId,agentSlug,nodeId,artifactKey,artifactType,status,version,isCurrent,currentSince,selectedBy,userId,projectId,content,contentHash,summary,metadata,mimeType,fileName,fileSizeBytes,storageUri,sourceSkillRunId,sourceAiJobRunId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.run.workspaceId ?? null,
        input.run.runId,
        input.run.agentSlug,
        input.node.id,
        artifactKey,
        artifactMetadata.artifactType,
        input.status,
        version,
        input.status === "final" ? 1 : 0,
        currentSince,
        input.status === "final" ? input.selectedBy ?? input.run.userId ?? null : null,
        input.run.userId,
        input.run.projectId ?? null,
        stringifyJson(input.content),
        hashArtifactContent(input.content),
        summarizeArtifactContent(input.content),
        stringifyJson(artifactMetadata.metadata),
        artifactMetadata.mimeType,
        artifactMetadata.fileName,
        artifactMetadata.fileSizeBytes,
        artifactMetadata.storageUri,
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
  artifactKey?: string;
  currentOnly?: boolean;
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
  if (input.artifactKey) {
    sql += " AND artifactKey=?";
    params.push(input.artifactKey);
  }
  if (input.currentOnly) {
    sql += " AND (isCurrent=1 OR status='final')";
  }
  sql += " ORDER BY createdAt DESC, id DESC LIMIT 200";
  try {
    const rows = await rawExecute(sql, params);
    return rows.map(parseAgentArtifactRow);
  } catch (error) {
    agentArtifactStoreAvailable = false;
    console.warn("[Agent Artifact] Failed to list artifacts:", error);
    return [];
  }
}

function parseAgentArtifactRow(artifact: any) {
  const metadata = parseJson(artifact.metadata, {}) as Record<string, unknown>;
  const rawIsCurrent = artifact.isCurrent;
  const isCurrent = rawIsCurrent === undefined || rawIsCurrent === null
    ? artifact.status === "final"
    : Number(rawIsCurrent || 0) === 1 || rawIsCurrent === true;
  return {
    ...artifact,
    version: Number(artifact.version || 1),
    isCurrent,
    content: parseJson(artifact.content),
    metadata,
    contentHash: artifact.contentHash || hashArtifactContent(parseJson(artifact.content)),
    mimeType: artifact.mimeType || (metadata.mimeType as string | undefined) || null,
    fileName: artifact.fileName || (metadata.fileName as string | undefined) || null,
    fileSizeBytes: artifact.fileSizeBytes === undefined || artifact.fileSizeBytes === null ? (metadata.fileSizeBytes as number | undefined) ?? null : Number(artifact.fileSizeBytes),
    storageUri: artifact.storageUri || (metadata.storageUri as string | undefined) || null,
    ref: buildAgentArtifactRef(artifact),
    currentRef: buildAgentArtifactRef(artifact, "current"),
  };
}

export function buildAgentArtifactRef(
  artifact: Pick<AgentContextArtifactRef, "runId" | "nodeId" | "artifactKey"> & { version?: number | null },
  version: number | "current" = Number(artifact.version || 1),
) {
  return `artifact://${artifact.runId}/${artifact.nodeId}/${artifact.artifactKey}@${version}`;
}

function isCurrentAgentArtifact(artifact: any): boolean {
  return Number(artifact.isCurrent || 0) === 1 || (artifact.isCurrent === undefined && artifact.status === "final");
}

function artifactResourceKind(artifact: Pick<AgentContextArtifactRef, "artifactType" | "metadata" | "mimeType" | "fileName">): AgentContextResourceKind | null {
  const artifactType = normalizeArtifactType(artifact.artifactType);
  if (artifactType === "image") return "image";
  if (artifactType === "table") return "table";
  if (artifactType === "file") return "file";
  const metadata = asRecord(artifact.metadata);
  const mimeType = firstString(artifact.mimeType, metadata.mimeType, metadata.contentType);
  const fileName = firstString(artifact.fileName, metadata.fileName, metadata.name);
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.includes("spreadsheet") || mimeType === "text/csv" || mimeType?.includes("tab-separated-values")) return "table";
  if (fileName && /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) return "image";
  if (fileName && /\.(csv|xlsx?|tsv)$/i.test(fileName)) return "table";
  if (Object.keys(asRecord(metadata.image)).length > 0) return "image";
  if (Object.keys(asRecord(metadata.table)).length > 0) return "table";
  if (Object.keys(asRecord(metadata.file)).length > 0) return "file";
  return null;
}

function buildAgentResourceRef(artifact: AgentContextArtifactRef): AgentContextResourceRef | null {
  const kind = artifactResourceKind(artifact);
  if (!kind) return null;
  return {
    kind,
    artifactId: artifact.artifactId,
    runId: artifact.runId,
    nodeId: artifact.nodeId,
    artifactKey: artifact.artifactKey,
    artifactType: artifact.artifactType,
    version: Number(artifact.version || 1),
    ref: artifact.ref || buildAgentArtifactRef(artifact),
    currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
    mimeType: artifact.mimeType || null,
    fileName: artifact.fileName || null,
    fileSizeBytes: artifact.fileSizeBytes ?? null,
    storageUri: artifact.storageUri || null,
    contentHash: artifact.contentHash || null,
    metadata: artifact.metadata || {},
  };
}

function compactArtifactForContext(artifact: AgentContextArtifactRef, includeContent: boolean, maxLength: number, stats: ContextTrimStats, path: string) {
  const ref = artifact.ref || buildAgentArtifactRef(artifact);
  const currentRef = artifact.currentRef || buildAgentArtifactRef(artifact, "current");
  const resource = buildAgentResourceRef(artifact);
  if (resource) {
    return {
      __artifactRef: currentRef,
      ref,
      currentRef,
      artifactType: artifact.artifactType,
      resourceKind: resource.kind,
      mimeType: artifact.mimeType || null,
      fileName: artifact.fileName || null,
      fileSizeBytes: artifact.fileSizeBytes ?? null,
      storageUri: artifact.storageUri || null,
      contentHash: artifact.contentHash || null,
      summary: summarizeArtifactContent(artifact.content),
      metadata: trimContextValueWithOptions(artifact.metadata || {}, {
        maxStringLength: Math.min(maxLength, 1000),
        maxArrayItems: 20,
        maxObjectKeys: 40,
        path: `${path}.metadata`,
        stats,
      }),
    };
  }
  if (!includeContent) return null;
  return trimContextValueWithOptions(artifact.content, {
    maxStringLength: maxLength,
    maxArrayItems: 80,
    maxObjectKeys: 120,
    path,
    stats,
  });
}

function parseAgentArtifactRef(ref: string) {
  const match = ref.match(/^artifact:\/\/([^/]+)\/([^/]+)\/([^@/]+)(?:@(\d+|current))?$/);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid artifact ref" });
  }
  return {
    runId: match[1],
    nodeId: match[2],
    artifactKey: match[3],
    version: match[4] && match[4] !== "current" ? Number(match[4]) : null,
    current: !match[4] || match[4] === "current",
  };
}

async function findAgentArtifact(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  version?: number | null;
  current?: boolean;
}) {
  const params: unknown[] = [input.runId, input.nodeId, input.artifactKey];
  if (input.current || !input.version) {
    let rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1
       ORDER BY version DESC LIMIT 1`,
      params,
    );
    if (!rows[0]) {
      rows = await rawExecute(
        `SELECT * FROM emperor_agent_artifacts
         WHERE runId=? AND nodeId=? AND artifactKey=? AND status='final'
         ORDER BY version DESC LIMIT 1`,
        params,
      );
    }
    return rows[0] ? parseAgentArtifactRow(rows[0]) : null;
  }
  const rows = await rawExecute(
    "SELECT * FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=? AND version=? LIMIT 1",
    [...params, input.version],
  );
  return rows[0] ? parseAgentArtifactRow(rows[0]) : null;
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
  const artifact = await findAgentArtifact(parsed);
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  return artifact;
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
  const artifact = await findAgentArtifact({ ...input, current: false });
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1",
    [input.runId, input.nodeId, input.artifactKey],
  );
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='final',isCurrent=1,currentSince=NOW(),selectedBy=?,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND version=?",
    [input.userId, input.runId, input.nodeId, input.artifactKey, input.version],
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
    isCurrent: true,
  };
}

export async function rollbackAgentArtifactVersion(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  targetVersion?: number | null;
  userId: number;
}) {
  const run = await getRunRow(input.runId);
  if (run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot rollback this Artifact" });
  }
  let targetVersion = input.targetVersion ?? null;
  if (!targetVersion) {
    const current = await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, current: true });
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND version < ? AND status IN ('final','superseded')
       ORDER BY version DESC LIMIT 1`,
      [input.runId, input.nodeId, input.artifactKey, Number(current?.version || Number.MAX_SAFE_INTEGER)],
    );
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No previous Artifact version to rollback" });
    targetVersion = Number(rows[0].version);
  }
  const selected = await selectAgentArtifactVersion({
    runId: input.runId,
    nodeId: input.nodeId,
    artifactKey: input.artifactKey,
    version: targetVersion,
    userId: input.userId,
  });
  await addEvent(input.runId, run.agentSlug, input.nodeId, "artifact.rollback", `Artifact ${input.artifactKey} 已回滚到 v${targetVersion}`, {
    artifactKey: input.artifactKey,
    version: targetVersion,
    ref: buildAgentArtifactRef(selected),
    currentRef: buildAgentArtifactRef(selected, "current"),
  });
  return selected;
}

type ArtifactDiffEntry = {
  path: string;
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

function previewDiffValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 500 ? { __preview: serialized.slice(0, 500), __truncated: true } : value;
  } catch {
    return String(value).slice(0, 500);
  }
}

function diffValues(before: unknown, after: unknown, path = "$", entries: ArtifactDiffEntry[] = [], limit = 200) {
  if (entries.length >= limit) return entries;
  if (JSON.stringify(before) === JSON.stringify(after)) return entries;
  const beforeIsObject = before && typeof before === "object" && !Array.isArray(before);
  const afterIsObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeIsObject && afterIsObject) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of keys) {
      if (entries.length >= limit) break;
      const childPath = `${path}.${key}`;
      if (!(key in beforeRecord)) {
        entries.push({ path: childPath, type: "added", after: previewDiffValue(afterRecord[key]) });
      } else if (!(key in afterRecord)) {
        entries.push({ path: childPath, type: "removed", before: previewDiffValue(beforeRecord[key]) });
      } else {
        diffValues(beforeRecord[key], afterRecord[key], childPath, entries, limit);
      }
    }
    return entries;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (entries.length >= limit) break;
      const childPath = `${path}[${index}]`;
      if (index >= before.length) {
        entries.push({ path: childPath, type: "added", after: previewDiffValue(after[index]) });
      } else if (index >= after.length) {
        entries.push({ path: childPath, type: "removed", before: previewDiffValue(before[index]) });
      } else {
        diffValues(before[index], after[index], childPath, entries, limit);
      }
    }
    return entries;
  }
  entries.push({ path, type: "changed", before: previewDiffValue(before), after: previewDiffValue(after) });
  return entries;
}

export function diffAgentArtifactContent(before: unknown, after: unknown, limit = 200) {
  return diffValues(before, after, "$", [], Math.min(Math.max(Math.floor(limit), 1), 1000));
}

export function estimateAgentHumanEditRate(before: unknown, after: unknown): number {
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return 0;
  const beforeText = JSON.stringify(before ?? "");
  const afterText = JSON.stringify(after ?? "");
  const maxLength = Math.max(beforeText.length, afterText.length, 1);
  const lengthDelta = Math.abs(afterText.length - beforeText.length) / maxLength;
  const diffCount = diffAgentArtifactContent(before, after, 1000).length;
  const structuralDelta = Math.min(diffCount / 50, 1);
  return Math.round(Math.min(Math.max(Math.max(lengthDelta, structuralDelta), 0), 1) * 1000) / 1000;
}

export async function diffAgentArtifactVersions(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  baseVersion?: number | null;
  targetVersion?: number | "current" | null;
  userId?: number;
  skipOwnerCheck?: boolean;
  limit?: number;
}) {
  const run = await getRunRow(input.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot diff this Artifact" });
  }
  const target = input.targetVersion && input.targetVersion !== "current"
    ? await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, version: input.targetVersion, current: false })
    : await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, current: true });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target Artifact not found" });

  let base = input.baseVersion
    ? await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, version: input.baseVersion, current: false })
    : null;
  if (!base) {
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND version < ?
       ORDER BY version DESC LIMIT 1`,
      [input.runId, input.nodeId, input.artifactKey, Number(target.version || 1)],
    );
    base = rows[0] ? parseAgentArtifactRow(rows[0]) : null;
  }
  if (!base) throw new TRPCError({ code: "NOT_FOUND", message: "Base Artifact not found" });

  const entries = diffAgentArtifactContent(base.content, target.content, input.limit || 200);
  return {
    runId: input.runId,
    nodeId: input.nodeId,
    artifactKey: input.artifactKey,
    base: {
      version: base.version,
      ref: buildAgentArtifactRef(base),
      contentHash: base.contentHash,
    },
    target: {
      version: target.version,
      ref: buildAgentArtifactRef(target),
      contentHash: target.contentHash,
      isCurrent: target.isCurrent,
    },
    changed: entries.length > 0,
    entries,
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

function chooseCurrentAgentArtifacts(artifacts: any[]) {
  const byKey = new Map<string, any>();
  for (const rawArtifact of artifacts || []) {
    const artifact = rawArtifact?.ref ? rawArtifact : parseAgentArtifactRow(rawArtifact);
    if (!["final", "superseded"].includes(String(artifact.status))) continue;
    const key = `${artifact.runId}:${artifact.nodeId}:${artifact.artifactKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, artifact);
      continue;
    }
    const score = (item: any) => (isCurrentAgentArtifact(item) ? 1_000_000 : 0) + Number(item.version || 0);
    if (score(artifact) > score(existing)) byKey.set(key, artifact);
  }
  return [...byKey.values()].filter(isCurrentAgentArtifact);
}

type AgentContextSectionKey = "runInputs" | "parentOutputs" | "confirmedOutputs" | "artifacts";

const CONTEXT_SECTION_KEYS: AgentContextSectionKey[] = ["runInputs", "parentOutputs", "confirmedOutputs", "artifacts"];

type NormalizedContextOptions = {
  maxStringLength: number;
  maxArtifactContentLength: number;
  includeArtifactContent: boolean;
  maxTokens: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  summaryStringLength: number;
  sectionTokenBudgets: Partial<Record<AgentContextSectionKey, number>>;
};

export type AgentContextPackageBuilderInput = {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  checkpoints: any[];
  artifacts?: any[];
  options?: AgentContextPackageOptions;
};

function normalizeContextPackageOptions(options?: AgentContextPackageOptions): NormalizedContextOptions {
  const maxTokens = contextNumberLimit(options?.maxTokens, 32000, 1000, 200000);
  return {
    maxStringLength: contextStringLimit(options?.maxStringLength),
    maxArtifactContentLength: contextStringLimit(options?.maxArtifactContentLength, 8000),
    includeArtifactContent: options?.includeArtifactContent !== false,
    maxTokens,
    maxArrayItems: contextNumberLimit(options?.maxArrayItems, 80, 5, 1000),
    maxObjectKeys: contextNumberLimit(options?.maxObjectKeys, 120, 10, 2000),
    summaryStringLength: contextStringLimit(options?.summaryStringLength, 1200),
    sectionTokenBudgets: Object.fromEntries(
      Object.entries(options?.sectionTokenBudgets || {}).map(([key, value]) => [
        key,
        contextNumberLimit(value, Math.floor(maxTokens / CONTEXT_SECTION_KEYS.length), 100, maxTokens),
      ]),
    ) as Partial<Record<AgentContextSectionKey, number>>,
  };
}

function defaultSectionTokenBudget(section: AgentContextSectionKey, maxTokens: number): number {
  const ratios: Record<AgentContextSectionKey, number> = {
    runInputs: 0.16,
    parentOutputs: 0.30,
    confirmedOutputs: 0.26,
    artifacts: 0.14,
  };
  return Math.max(100, Math.floor(maxTokens * ratios[section]));
}

function normalizeContextArtifact(rawArtifact: any): AgentContextArtifactRef {
  const artifact = rawArtifact?.ref && rawArtifact?.currentRef ? rawArtifact : parseAgentArtifactRow(rawArtifact);
  const metadata = parseJson(artifact.metadata, {}) as Record<string, unknown>;
  const artifactType = normalizeArtifactType(artifact.artifactType) || inferArtifactType(artifact.content, metadata);
  return {
    ...artifact,
    artifactId: artifact.artifactId ?? artifact.id,
    artifactType,
    version: Number(artifact.version || 1),
    status: String(artifact.status || "final"),
    isCurrent: isCurrentAgentArtifact(artifact),
    content: artifact.content,
    metadata,
    contentHash: artifact.contentHash || hashArtifactContent(artifact.content),
    mimeType: artifact.mimeType || (metadata.mimeType as string | undefined) || null,
    fileName: artifact.fileName || (metadata.fileName as string | undefined) || null,
    fileSizeBytes: artifact.fileSizeBytes === undefined || artifact.fileSizeBytes === null ? (metadata.fileSizeBytes as number | undefined) ?? null : Number(artifact.fileSizeBytes),
    storageUri: artifact.storageUri || (metadata.storageUri as string | undefined) || null,
    ref: artifact.ref || buildAgentArtifactRef(artifact),
    currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
  };
}

export class AgentContextPackageBuilder {
  private readonly run: any;
  private readonly dag: EmperorAgentDag;
  private readonly node: EmperorAgentNode;
  private readonly checkpoints: CheckpointRow[];
  private readonly options: NormalizedContextOptions;
  private readonly allArtifacts: AgentContextArtifactRef[];
  private readonly currentArtifacts: AgentContextArtifactRef[];
  private readonly artifactByRef = new Map<string, AgentContextArtifactRef>();
  private readonly stats: ContextTrimStats & { resolvedArtifactRefs: string[] } = {
    truncatedFields: [],
    summarizedFields: [],
    resolvedArtifactRefs: [],
  };
  private readonly resourceRefs: Record<AgentContextResourceKind, AgentContextResourceRef[]> = {
    file: [],
    image: [],
    table: [],
  };
  private readonly sources: AgentContextProvenanceSource[] = [];

  constructor(input: AgentContextPackageBuilderInput) {
    this.run = input.run;
    this.dag = input.dag;
    this.node = input.node;
    this.checkpoints = (input.checkpoints || []) as CheckpointRow[];
    this.options = normalizeContextPackageOptions(input.options);
    this.allArtifacts = (input.artifacts || []).filter(Boolean).map(normalizeContextArtifact);
    this.currentArtifacts = chooseCurrentAgentArtifacts(this.allArtifacts).map(normalizeContextArtifact);
    this.indexArtifacts();
  }

  build(): AgentContextPackage {
    const parents = parentIds(this.dag, this.node.id);
    const rawRunInputs = parseStoredAgentRunInputs(this.run.inputs).inputs;
    this.addRunInputSources(rawRunInputs);
    const runInputs = this.prepareSection("runInputs", rawRunInputs, "runInputs");
    const parentOutputs = this.prepareSection("parentOutputs", this.buildOutputs(
      this.checkpoints.filter((checkpoint) => parents.includes(checkpoint.nodeId)),
      "parentOutputs",
    ), "parentOutputs");
    const confirmedOutputs = this.prepareSection("confirmedOutputs", this.buildOutputs(
      this.checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)),
      "confirmedOutputs",
    ), "confirmedOutputs");
    const artifacts = this.prepareArtifactsSection(this.buildArtifactsSection());
    const nodeParams = this.prepareSection("runInputs", this.node.toolParams ?? null, "node.params");
    const budget = this.buildBudgetReport({ runInputs, parentOutputs, confirmedOutputs, artifacts }, nodeParams);
    const artifactRefs = this.currentArtifacts.map((artifact) => artifact.ref || buildAgentArtifactRef(artifact));
    const currentArtifactRefs = this.currentArtifacts.map((artifact) => artifact.currentRef || buildAgentArtifactRef(artifact, "current"));

    return {
      version: "1.0",
      schema: {
        name: "agent.context_package",
        version: "1.1",
        sections: ["runInputs", "parentOutputs", "confirmedOutputs", "artifacts", "resourceRefs", "contextBudget", "provenance"],
      },
      agentRunId: this.run.runId,
      agentSlug: this.run.agentSlug,
      projectId: this.run.projectId ?? null,
      parentOutputs: parentOutputs as Record<string, unknown>,
      confirmedOutputs: confirmedOutputs as Record<string, unknown>,
      artifacts,
      resourceRefs: this.resourceRefs,
      contextBudget: budget,
      node: {
        id: this.node.id,
        label: this.node.label,
        skillSlug: this.node.skillSlug,
        skillVersion: this.node.skillVersion,
        skillVersionRef: this.node.skillVersionRef,
        skillVersionPolicy: this.node.skillVersionPolicy,
        toolSlug: this.node.toolSlug,
        outputKey: this.node.outputKey,
        nodeType: this.node.nodeType,
        params: nodeParams,
      },
      runInputs: runInputs as Record<string, unknown>,
      provenance: {
        parentNodeIds: parents,
        confirmedNodeIds: this.checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).map((checkpoint) => checkpoint.nodeId),
        artifactRefs,
        currentArtifactRefs,
        sources: this.sources,
        builtAt: new Date().toISOString(),
      },
    };
  }

  private indexArtifacts() {
    for (const artifact of this.allArtifacts) {
      const versionRef = artifact.ref || buildAgentArtifactRef(artifact);
      const currentRef = artifact.currentRef || buildAgentArtifactRef(artifact, "current");
      this.artifactByRef.set(versionRef, artifact);
      this.artifactByRef.set(`artifact://${artifact.runId}/${artifact.nodeId}/${artifact.artifactKey}`, artifact);
      if (isCurrentAgentArtifact(artifact)) this.artifactByRef.set(currentRef, artifact);
    }
  }

  private sectionLimit(section: AgentContextSectionKey): number {
    return this.options.sectionTokenBudgets[section] || defaultSectionTokenBudget(section, this.options.maxTokens);
  }

  private prepareSection(section: AgentContextSectionKey, value: unknown, path: string): unknown {
    const resolved = this.resolveArtifactRefs(value, path);
    const trimmed = trimContextValueWithOptions(resolved, {
      maxStringLength: section === "artifacts" ? this.options.maxArtifactContentLength : this.options.maxStringLength,
      maxArrayItems: this.options.maxArrayItems,
      maxObjectKeys: this.options.maxObjectKeys,
      path,
      stats: this.stats,
    });
    const sectionLimited = fitValueToTokenBudget(trimmed, this.sectionLimit(section), path, this.stats);
    if (estimateAgentContextTokens(sectionLimited) <= this.sectionLimit(section)) return sectionLimited;
    return summarizeContextValue(sectionLimited, this.options.summaryStringLength, path, this.stats);
  }

  private prepareArtifactsSection(value: AgentContextArtifactRef[]): AgentContextArtifactRef[] {
    const trimmed = trimContextValueWithOptions(this.resolveArtifactRefs(value, "artifacts"), {
      maxStringLength: this.options.maxArtifactContentLength,
      maxArrayItems: this.options.maxArrayItems,
      maxObjectKeys: this.options.maxObjectKeys,
      path: "artifacts",
      stats: this.stats,
    }) as AgentContextArtifactRef[];
    const limit = this.sectionLimit("artifacts");
    if (estimateAgentContextTokens(trimmed) <= limit) return trimmed;
    const perArtifactChars = Math.max(400, Math.floor((limit * 4) / Math.max(trimmed.length, 1)));
    return trimmed.map((artifact, index) => ({
      ...artifact,
      content: summarizeContextValue(artifact.content, perArtifactChars, `artifacts[${index}].content`, this.stats),
    }));
  }

  private buildOutputs(checkpoints: CheckpointRow[], pathPrefix: "parentOutputs" | "confirmedOutputs"): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const checkpoint of checkpoints) {
      const sourceNode = this.dag.nodes.find((item) => item.id === checkpoint.nodeId);
      const key = sourceNode?.outputKey || checkpoint.nodeId;
      const artifact = this.currentArtifactForNode(sourceNode);
      if (artifact) {
        outputs[key] = this.artifactContextValue(artifact, `${pathPrefix}.${key}`);
        this.addSource({
          path: `${pathPrefix}.${key}`,
          sourceType: "artifact",
          nodeId: artifact.nodeId,
          artifactRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
          artifactVersion: artifact.version,
        });
      } else {
        outputs[key] = effectiveCheckpointOutput(checkpoint);
        this.addSource({
          path: `${pathPrefix}.${key}`,
          sourceType: "checkpoint",
          nodeId: checkpoint.nodeId,
          checkpointStatus: checkpoint.status,
        });
      }
    }
    return outputs;
  }

  private buildArtifactsSection(): AgentContextArtifactRef[] {
    return this.currentArtifacts.map((artifact, index) => {
      this.addResourceRef(artifact);
      this.addSource({
        path: `artifacts[${index}]`,
        sourceType: "artifact",
        nodeId: artifact.nodeId,
        artifactRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
        artifactVersion: artifact.version,
      });
      return {
        artifactId: artifact.artifactId,
        runId: artifact.runId,
        nodeId: artifact.nodeId,
        artifactKey: artifact.artifactKey,
        artifactType: artifact.artifactType,
        version: Number(artifact.version || 1),
        status: artifact.status,
        isCurrent: isCurrentAgentArtifact(artifact),
        ref: artifact.ref || buildAgentArtifactRef(artifact),
        currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
        content: this.artifactContextValue(artifact, `artifacts[${index}].content`),
        metadata: artifact.metadata || {},
        contentHash: artifact.contentHash || null,
        mimeType: artifact.mimeType || null,
        fileName: artifact.fileName || null,
        fileSizeBytes: artifact.fileSizeBytes ?? null,
        storageUri: artifact.storageUri || null,
        sourceSkillRunId: artifact.sourceSkillRunId || null,
        sourceAiJobRunId: artifact.sourceAiJobRunId || null,
      };
    });
  }

  private addRunInputSources(runInputs: Record<string, unknown>) {
    for (const key of Object.keys(runInputs || {})) {
      this.addSource({
        path: `runInputs.${key}`,
        sourceType: "run_input",
      });
    }
  }

  private currentArtifactForNode(node: EmperorAgentNode | undefined): AgentContextArtifactRef | undefined {
    if (!node) return undefined;
    const preferredKey = node.outputKey || node.id;
    return this.currentArtifacts.find((item) => item.nodeId === node.id && item.artifactKey === preferredKey)
      || this.currentArtifacts.find((item) => item.nodeId === node.id);
  }

  private artifactContextValue(artifact: AgentContextArtifactRef, path: string): unknown {
    this.addResourceRef(artifact);
    return compactArtifactForContext(
      artifact,
      this.options.includeArtifactContent,
      this.options.maxArtifactContentLength,
      this.stats,
      path,
    );
  }

  private resolveArtifactRefs(value: unknown, path: string): unknown {
    if (typeof value === "string") {
      const trimmed = value.trim();
      const exact = this.artifactByRef.get(trimmed);
      if (exact) {
        pushUnique(this.stats.resolvedArtifactRefs, trimmed);
        this.addSource({
          path,
          sourceType: "artifact_ref",
          nodeId: exact.nodeId,
          artifactRef: trimmed,
          artifactVersion: exact.version,
        });
        return {
          __resolvedArtifactRef: trimmed,
          content: this.artifactContextValue(exact, path),
        };
      }
      for (const match of value.matchAll(/artifact:\/\/[^/\s"'<>]+\/[^/\s"'<>]+\/[^@\s"'<>]+(?:@(?:\d+|current))?/g)) {
        if (this.artifactByRef.has(match[0])) pushUnique(this.stats.resolvedArtifactRefs, match[0]);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.resolveArtifactRefs(item, `${path}[${index}]`));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => {
          if (key === "ref" || key === "currentRef" || key === "__artifactRef") return [key, item];
          return [key, this.resolveArtifactRefs(item, `${path}.${key}`)];
        }),
      );
    }
    return value;
  }

  private addResourceRef(artifact: AgentContextArtifactRef) {
    const resource = buildAgentResourceRef(artifact);
    if (!resource) return;
    const exists = this.resourceRefs[resource.kind].some((item) => item.currentRef === resource.currentRef && item.ref === resource.ref);
    if (exists) return;
    const nextIndex = this.resourceRefs[resource.kind].length;
    this.resourceRefs[resource.kind].push({
      ...resource,
      metadata: trimContextValueWithOptions(resource.metadata || {}, {
        maxStringLength: 1000,
        maxArrayItems: 20,
        maxObjectKeys: 40,
        path: `resourceRefs.${resource.kind}[${nextIndex}].metadata`,
        stats: this.stats,
      }),
    });
  }

  private addSource(source: AgentContextProvenanceSource) {
    const key = `${source.path}:${source.sourceType}:${source.artifactRef || ""}:${source.nodeId || ""}`;
    if (!this.sources.some((item) => `${item.path}:${item.sourceType}:${item.artifactRef || ""}:${item.nodeId || ""}` === key)) {
      this.sources.push(source);
    }
  }

  private buildBudgetReport(sections: Record<AgentContextSectionKey, unknown>, nodeParams: unknown): AgentContextBudgetReport {
    const sectionReports = Object.fromEntries(CONTEXT_SECTION_KEYS.map((section) => [
      section,
      {
        estimatedTokens: estimateAgentContextTokens(sections[section]),
        limitTokens: this.sectionLimit(section),
      },
    ])) as Record<string, AgentContextBudgetSection>;
    const estimatedTokens = estimateAgentContextTokens({
      node: {
        ...this.node,
        params: nodeParams,
      },
      runInputs: sections.runInputs,
      parentOutputs: sections.parentOutputs,
      confirmedOutputs: sections.confirmedOutputs,
      artifacts: sections.artifacts,
      resourceRefs: this.resourceRefs,
    });
    return {
      maxTokens: this.options.maxTokens,
      estimatedTokens,
      overBudget: estimatedTokens > this.options.maxTokens,
      sections: sectionReports,
      truncatedFields: [...this.stats.truncatedFields],
      summarizedFields: [...this.stats.summarizedFields],
      resolvedArtifactRefs: [...this.stats.resolvedArtifactRefs],
      resourceCounts: {
        file: this.resourceRefs.file.length,
        image: this.resourceRefs.image.length,
        table: this.resourceRefs.table.length,
      },
    };
  }
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

  await withAgentStateMachine((stateMachine) => stateMachine.refreshRun({
    runId,
    to: status,
    currentNodeId,
    progress,
    outputs: outputMap,
    completedAt: allDone ? new Date() : null,
  }));

  if (runRow.status !== status && ["completed", "failed", "canceled"].includes(status)) {
    const durationMs = runRow.startedAt ? Date.now() - new Date(runRow.startedAt).getTime() : null;
    void recordAiOsEvaluation({
      entityType: "agent_run",
      entityId: runId,
      output: outputMap,
      status,
      workspaceId: runRow.workspaceId ?? null,
      userId: runRow.userId,
      projectId: runRow.projectId ?? null,
      agentSlug: runRow.agentSlug,
      retryCount: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.retryCount || 0), 0),
      metadata: {
        progress,
        checkpointCount: checkpoints.length,
        confirmedCount: checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).length,
        durationMs,
      },
    });
    void recordAiOsMetric({
      entityType: "agent_run",
      entityId: runId,
      metricName: `agent_run.${status}`,
      metricValue: durationMs,
      status,
      workspaceId: runRow.workspaceId ?? null,
      userId: runRow.userId,
      projectId: runRow.projectId ?? null,
      agentSlug: runRow.agentSlug,
      metadata: {
        progress,
        checkpointCount: checkpoints.length,
        retryCount: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.retryCount || 0), 0),
      },
    });
  }

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
    await withAgentStateMachine((stateMachine) => stateMachine.markNodeReady({ runId, nodeId: childId, action: "unlock child" }));
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
  return new AgentContextPackageBuilder(input).build();
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
