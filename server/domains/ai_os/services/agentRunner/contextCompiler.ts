import { createHash } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";

import { getDb } from "../../../../repositories/dbClient";
import type {
  AgentContextKnowledgeRef,
  AgentContextPackage,
  AgentContextPackageOptions,
  EmperorAgentDag,
  EmperorAgentNode,
} from "./runtimeCore";
import { buildNodeInput } from "./contextPackage";

type ContextCompilerPolicy = NonNullable<AgentContextPackageOptions["compilerPolicy"]>;

type KnowledgeRow = {
  id: number;
  project_id?: number | null;
  title?: string | null;
  content?: string | null;
  memory_type?: string | null;
  source?: string | null;
  tags?: unknown;
  confidence?: number | string | null;
  updated_at?: string | Date | null;
};

const MAX_KNOWLEDGE_CANDIDATES = 120;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function textTokens(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 80);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), min), max) : fallback;
}

function normalizePolicy(node: EmperorAgentNode): ContextCompilerPolicy | null {
  const raw = node.contextCompilerPolicy;
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const preset = String((node as any).executionPreset || "standard");
  const presetEnabled = preset === "quality_first" || preset === "evaluation";
  if (record.enabled !== true && !presetEnabled) return null;
  const presetMaxItems = preset === "quality_first" ? 6 : preset === "evaluation" ? 3 : 4;
  const presetMaxChars = preset === "quality_first" ? 2400 : preset === "evaluation" ? 1200 : 1600;
  return {
    enabled: true,
    maxKnowledgeItems: boundedNumber(record.maxKnowledgeItems, presetMaxItems, 1, 12),
    maxKnowledgeItemChars: boundedNumber(record.maxKnowledgeItemChars, presetMaxChars, 300, 8000),
    memoryTypes: Array.isArray(record.memoryTypes) ? record.memoryTypes.map(String).filter(Boolean).slice(0, 8) : [],
    queries: Array.isArray(record.queries) ? record.queries.map(String).filter(Boolean).slice(0, 12) : [],
    includeProjectKnowledge: record.includeProjectKnowledge !== false,
    toolStrategy: preset === "evaluation" || record.toolStrategy === "governed_only" ? "governed_only" : "catalog_only",
  };
}

function compilerHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function queryKnowledge(projectId: number | null, policy: ContextCompilerPolicy): Promise<KnowledgeRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = ["is_active=1"];
  const params: unknown[] = [];
  if (policy.includeProjectKnowledge && projectId) {
    conditions.push("(project_id=? OR project_id IS NULL)");
    params.push(projectId);
  }
  const parts = `SELECT id,project_id,title,content,memory_type,source,tags,confidence,updated_at FROM emperor_knowledge WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ${MAX_KNOWLEDGE_CANDIDATES}`.split("?");
  const chunks: any[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    chunks.push(drizzleSql.raw(parts[index]));
    if (index < params.length) chunks.push(drizzleSql`${params[index]}`);
  }
  const result: any = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as KnowledgeRow[] : [];
}

function selectKnowledge(rows: KnowledgeRow[], queryTokens: string[], policy: ContextCompilerPolicy): AgentContextKnowledgeRef[] {
  const expectedTypes = new Set((policy.memoryTypes || []).map((item) => item.toLowerCase()));
  return rows
    .filter((row) => expectedTypes.size === 0 || expectedTypes.has(String(row.memory_type || "").toLowerCase()))
    .map((row) => {
      const tags = parseJson<string[]>(row.tags, Array.isArray(row.tags) ? row.tags.map(String) : []);
      const searchable = `${row.title || ""}\n${row.content || ""}\n${tags.join(" ")}`.toLowerCase();
      const matchedTerms = [...new Set(queryTokens.filter((token) => searchable.includes(token)))];
      const score = matchedTerms.length * 10 + Math.max(0, Math.min(Number(row.confidence || 0), 1)) * 2;
      return {
        knowledgeId: Number(row.id),
        title: String(row.title || `知识条目 ${row.id}`),
        memoryType: String(row.memory_type || "reference"),
        source: row.source || null,
        tags,
        confidence: Number(row.confidence || 0),
        score,
        matchedTerms,
        content: String(row.content || "").slice(0, policy.maxKnowledgeItemChars || 1600),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    })
    .filter((item) => queryTokens.length === 0 || item.matchedTerms.length > 0)
    .sort((left, right) => right.score - left.score || left.knowledgeId - right.knowledgeId)
    .slice(0, policy.maxKnowledgeItems || 4);
}

/**
 * Builds an opt-in, deterministic extension around the existing AgentContextPackage.
 * Disabled nodes receive the byte-for-byte compatible legacy node input.
 */
export async function compileAgentNodeInput(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  checkpoints: any[];
  artifacts?: any[];
}) {
  const legacyInput = buildNodeInput(input.run, input.dag, input.node, input.checkpoints, input.artifacts);
  const policy = normalizePolicy(input.node);
  if (!policy) return legacyInput;

  const basePackage = legacyInput.contextPackage as AgentContextPackage;
  const queryTokens = [...new Set(textTokens([
    input.node.label,
    input.node.subtitle,
    input.node.skillSlug,
    ...(policy.queries || []),
    JSON.stringify(basePackage.runInputs).slice(0, 4000),
  ].join(" ")))].slice(0, 80);
  const knowledge = selectKnowledge(await queryKnowledge(basePackage.projectId, policy), queryTokens, policy);
  const sourceEntries = knowledge.map((item) => ({
    path: `knowledge[${item.knowledgeId}]`,
    sourceType: "knowledge" as const,
    knowledgeId: item.knowledgeId,
    source: item.source,
  }));
  const toolPolicy = {
    mode: policy.toolStrategy || "catalog_only",
    shell: "denied",
    execution: input.node.toolSlug ? "tool_gateway_only" : "not_requested",
    requestedToolSlug: input.node.toolSlug || null,
    note: "业务Tool必须通过现有Tool Gateway、Schema、权限、限流与熔断策略执行。",
  } as const;
  const compiler = {
    name: "emperor.context_compiler",
    version: "1.0",
    policy,
    policyHash: compilerHash(policy),
    queryTokenCount: queryTokens.length,
    selectedKnowledgeCount: knowledge.length,
    compiledAt: new Date().toISOString(),
  };
  const contextPackage: AgentContextPackage = {
    ...basePackage,
    version: "1.1",
    schema: { ...basePackage.schema, version: "1.2", sections: [...basePackage.schema.sections, "knowledge", "compiler", "toolPolicy"] },
    knowledge,
    compiler,
    toolPolicy,
    provenance: { ...basePackage.provenance, sources: [...basePackage.provenance.sources, ...sourceEntries] },
  };
  return { ...contextPackage, contextPackage };
}
