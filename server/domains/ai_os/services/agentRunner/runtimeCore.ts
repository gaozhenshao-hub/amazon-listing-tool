import { TRPCError } from "@trpc/server";

import { createHash } from "crypto";

import { sql as drizzleSql } from "drizzle-orm";

import { getDb } from "../../../../repositories/dbClient";

import { buildWorkspaceScopeFilter } from "../../../../services/securityGovernance";

import {
  assertNodeTransition,
  canTransitionNodeStatus,
  canTransitionRunStatus,
  withAgentStateMachine,
  type AgentNodeStatus,
  type AgentRunStatus,
} from "../agentStateMachine";

import {
  getEmperorSkillRuntimeSnapshot,
  normalizeSkillVersion,
  runEmperorSkill,
  safeParseSkillJSON,
  SkillRunError,
  type SkillRuntimeSnapshot,
  type SkillVersionPolicy,
} from "../skillRunner";

import { calculateAiJobRetryDelayMs, cancelAiJob, failAiJob, getAiJobRun, registerAiJobHandler, retryAiJob, startRegisteredAiJob, type AiJobSnapshot } from "../jobRunner";

import { invokeEmperorTool } from "../toolGateway";

import { recordAiOsEvaluation, recordAiOsMetric } from "../observability";

import { registerAgentArtifactLifecycleIndex } from "../artifactLifecycle";

export { canTransitionNodeStatus, canTransitionRunStatus };

export type { AgentNodeStatus, AgentRunStatus } from "../agentStateMachine";

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

const agentArtifactStoreState = { available: true };

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

export { TRPCError, createHash, drizzleSql, getDb, buildWorkspaceScopeFilter, assertNodeTransition, withAgentStateMachine, getEmperorSkillRuntimeSnapshot, normalizeSkillVersion, runEmperorSkill, safeParseSkillJSON, SkillRunError, SkillRuntimeSnapshot, SkillVersionPolicy, calculateAiJobRetryDelayMs, cancelAiJob, failAiJob, getAiJobRun, registerAiJobHandler, retryAiJob, startRegisteredAiJob, AiJobSnapshot, invokeEmperorTool, recordAiOsEvaluation, recordAiOsMetric, registerAgentArtifactLifecycleIndex, CheckpointRow, agentArtifactStoreState, hashJson, hashArtifactContent, assertRunMutable, rawExecute, parseJson, stringifyJson, stringifyJsonOrNull, toRecord, generateRunId, nodeMaxAttempts, nodeTimeoutAt, SUPPORTED_AGENT_NODE_TYPES, edgeId, addDagIssue, resolveNodeToolSlugForValidation, edgeSource, edgeTarget, parentIds, childIds, descendantIds, isConfirmedStatus, checkpointPayload, checkpointMetadata, buildNodeRunMetadata };
