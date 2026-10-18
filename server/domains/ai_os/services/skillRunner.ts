import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { createHash } from "crypto";
import Handlebars from "handlebars";
import { SocksProxyAgent } from "socks-proxy-agent";
import { getDb } from "../../../repositories/dbClient";
import { buildWorkspaceScopeFilter } from "../../../services/securityGovernance";
import { invokeLLM, type InvokeResult, type Message, type MessageContent } from "../../../_core/llm";
import { ENV } from "../../../_core/env";
import { SafeHttpError, safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";
import { recordAiOsEvaluation, recordAiOsMetric } from "./observability";
import {
  canonicalizeTeamorouterOpenAiBaseUrl,
  TEAMOROUTER_LEGACY_SOCKS_HOST,
  defaultTeamorouterFallbacks,
  resolveGovernedModelApiKey,
} from "./teamorouterCatalog";
import {
  getHighQualitySkillGovernance,
  type HighQualitySkillGovernance,
} from "./highQualitySkillGovernance";
import { resolveActiveSkillRollout } from "./skillRollout";
import { StrictSkillRuntimeError, STRICT_SKILL_LIMITS,
  strictModelSnapshotFromRow, strictRuntimeCanonical, strictRuntimeHash, strictRuntimeRefuse, strictSkillMessages,
  parseStrictExecutionOptions, strictCostUpperBound, strictSkillAuditIdentity,
  type StrictRegisteredModelSnapshot, type StrictSkillExecutionOptions } from "./strictSkillRuntime";
export type { StrictRegisteredModelSnapshot, StrictSkillExecutionOptions, StrictSkillDispatchReceipt } from "./strictSkillRuntime";

export type SkillRunErrorCode =
  | "SKILL_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT"
  | "PROMPT_MISSING"
  | "SKILL_VERSION_MISMATCH"
  | "DATABASE_ERROR"
  | "CANCELED"
  | "UNKNOWN";

export class SkillRunError extends Error {
  constructor(
    public readonly code: SkillRunErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SkillRunError";
  }
}

type SkillRow = {
  workspaceId?: number | null;
  slug: string;
  name: string;
  manifest: unknown;
  modelOverride?: string | null;
  model_override?: string | null;
  timeout_seconds?: number | null;
  status?: string | null;
  version?: string | number | null;
};

type ModelRow = {
  workspaceId?: number | null;
  slug: string;
  provider: string;
  modelId: string;
  baseUrl?: string | null;
  apiKeyRef?: string | null;
  isActive?: number | boolean;
  costPer1kInputTokens?: string | number | null;
  costPer1kOutputTokens?: string | number | null;
};

/** `manus-default` is an explicit governed failover, never a client-selected route. */
export function runtimeProviderOverrideForModel(model: Pick<ModelRow, "provider">): "forge" | undefined {
  return model.provider === "manus_builtin" ? "forge" : undefined;
}

type SkillManifest = {
  implementation?: {
    systemPrompt?: string;
    userPromptTemplate?: string;
    modelPolicy?: string;
    /** 只接受已登记模型Provider slug，禁止用Preset携带任意端点或密钥。 */
    qualityModelPolicy?: string;
    evaluationModelPolicy?: string;
    maxTokens?: number;
    temperature?: number;
    supportsJsonMode?: boolean;
  };
  contract?: {
    schemaVersion?: string;
    inputSchema?: Record<string, unknown>;
    outputMode?: string;
    humanReviewRequired?: boolean;
    automaticExecution?: string;
  };
  governance?: Partial<HighQualitySkillGovernance>;
};

export function buildSkillJsonResponseFormat(supportsJsonMode?: boolean) {
  return supportsJsonMode ? { type: "json_object" as const } : undefined;
}

export type RunSkillInput<T> = {
  skillSlug: string;
  userId: number;
  workspaceId?: number | null;
  projectId?: number | null;
  variables: Record<string, unknown>;
  context?: string;
  emphasis?: string;
  modelOverride?: string;
  fallbackModels?: string[];
  attachments?: MessageContent[];
  legacySystemPrompt?: string;
  migrationSource?: string;
  skillVersionPolicy?: SkillVersionPolicy;
  expectedSkillVersion?: string | number;
  expectedSkillPromptHash?: string;
  /** Stored (unrendered) template hash from getEmperorSkillRuntimeSnapshot:
   * SHA-256 hex truncated to 16 lowercase characters, not full SHA-256. */
  expectedSkillUserPromptHash?: string;
  /** Existing JSON.stringify(manifest) snapshot hash. This does not pin the
   * separately resolved model registry, Skill modelOverride or caller context. */
  expectedSkillManifestHash?: string;
  /** Opt-in release-state fence for approved, checkpointed workflows. */
  expectedSkillStatus?: "Released";
  executionPreset?: SkillExecutionPreset;
  maxModelAttempts?: number;
  signal?: AbortSignal;
  validate?: (content: string) => T;
  /** Server-only opt-in; never pass untrusted RPC options through to this field. */
  strictExecution?: StrictSkillExecutionOptions;
};

export type RunSkillResult<T = string> = {
  runId: string;
  skillSlug: string;
  skillName: string;
  skillVersion: string;
  skillPromptHash: string;
  skillManifestHash: string;
  content: string;
  parsed: T;
  modelSlug: string;
  provider: string;
  durationMs: number;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  fallbackCount: number;
  executionPreset: SkillExecutionPreset;
  governance: HighQualitySkillGovernance | null;
  /** Strict private lane only; advisory stores do not discard a validated reply. */
  auditWarnings?: Array<"METRICS_UNAVAILABLE" | "CALL_COUNT_UNAVAILABLE">;
};

export type SkillVersionPolicy = "latest" | "snapshot" | "pinned";

/** Harness执行模式只能调整受治理模型候选顺序，不能绕开Skill、模型Provider或Tool边界。 */
export type SkillExecutionPreset = "standard" | "quality_first" | "batch_background" | "evaluation";

export function normalizeSkillExecutionPreset(value: unknown): SkillExecutionPreset {
  return value === "quality_first" || value === "batch_background" || value === "evaluation"
    ? value
    : "standard";
}

export type SkillRuntimeSnapshot = {
  slug: string;
  name: string;
  version: string;
  status?: string | null;
  modelOverride?: string | null;
  timeoutSeconds: number;
  systemPromptHash: string;
  systemPromptLength: number;
  userPromptHash: string;
  manifestHash: string;
};

/**
 * When Forge is genuinely provisioned it is the first independent fallback;
 * otherwise both candidates stay on the official direct Teamorouter endpoint.
 * Candidate resolution is capped at two attempts, so this is an availability
 * policy rather than a cosmetic preference.
 */
export const DEFAULT_FALLBACKS = defaultTeamorouterFallbacks();

export function createRestrictedTeamorouterSocksAgent(targetUrl: string, proxyUrl = ENV.teamorouterSocksProxy) {
  const target = new URL(targetUrl);
  const configuredProxy = proxyUrl.trim();
  // The current official `.cn` endpoint is directly reachable from Qingdao.
  // Keep the restricted local SOCKS path only for legacy `.com` records until
  // their administrator-approved migration is complete.
  if (target.hostname !== TEAMOROUTER_LEGACY_SOCKS_HOST || !configuredProxy) return undefined;

  const proxy = new URL(configuredProxy);
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!new Set(["socks5:", "socks5h:"]).has(proxy.protocol) || !loopbackHosts.has(proxy.hostname)) {
    throw new SkillRunError("PROVIDER_UNAVAILABLE", "Teamorouter SOCKS proxy must use a local socks5 endpoint", false);
  }
  return new SocksProxyAgent(proxy);
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function rawExecute(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new SkillRunError("DATABASE_ERROR", "Database not available", false);

  try {
    if (params.length === 0) {
      const result = await db.execute(drizzleSql.raw(sqlStr));
      const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
      return Array.isArray(rows) ? rows as any[] : [];
    }

    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      chunks.push(drizzleSql.raw(parts[index]));
      if (index < params.length) chunks.push(drizzleSql`${params[index]}`);
    }
    const result = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    return Array.isArray(rows) ? rows as any[] : [];
  } catch (error) {
    throw new SkillRunError("DATABASE_ERROR", "Database operation failed", false, error);
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseLenientJson<T>(candidate: string): T | null {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Continue with a conservative repair for common LLM JSON defects.
  }

  let repaired = "";
  let inString = false;
  let escaped = false;
  for (const char of candidate) {
    if (inString && !escaped && char === "\n") {
      repaired += "\\n";
      continue;
    }
    if (inString && !escaped && char === "\r") {
      repaired += "\\r";
      continue;
    }
    if (inString && !escaped && char === "\t") {
      repaired += "\\t";
      continue;
    }
    repaired += char;
    if (char === '"' && !escaped) inString = !inString;
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

export function safeParseSkillJSON<T = unknown>(raw: unknown, fallback?: T): T | { raw: string } {
  if (raw === undefined || raw === null) {
    if (fallback !== undefined) return fallback;
    return { raw: String(raw) };
  }

  const str = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "");
  if (!str.trim()) {
    if (fallback !== undefined) return fallback;
    return { raw: "" };
  }

  const cleaned = str
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  const wholeDocument = parseLenientJson<T>(cleaned);
  if (wholeDocument !== null) return wholeDocument;

  const candidates: Array<[number, number]> = [
    [cleaned.indexOf("{"), cleaned.lastIndexOf("}")],
    [cleaned.indexOf("["), cleaned.lastIndexOf("]")],
  ];

  for (const [start, end] of candidates) {
    if (start >= 0 && end > start) {
      const extracted = parseLenientJson<T>(cleaned.slice(start, end + 1));
      if (extracted !== null) return extracted;
    }
  }

  if (fallback !== undefined) return fallback;
  return { raw: str };
}

function getTemplateValue(path: string, variables: Record<string, unknown>): unknown {
  if (path === "this" || path === ".") return variables.this;
  if (path === "@index") return variables.index;
  return path.split(".").reduce<unknown>((current, key) => {
    if (key === "this" && current === variables) return variables.this;
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, variables);
}

function isTruthyTemplateValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function withTemplateStringifiers(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const arrayValue: unknown[] = [];
    seen.set(value, arrayValue);
    arrayValue.push(...value.map((item) => withTemplateStringifiers(item, seen)));
    Object.defineProperty(arrayValue, "toString", {
      value: () => stringifyTemplateValue(arrayValue),
      enumerable: false,
    });
    return arrayValue;
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, child] of Object.entries(record)) {
    output[key] = withTemplateStringifiers(child, seen);
  }
  Object.defineProperty(output, "toString", {
    value: () => stringifyTemplateValue(output),
    enumerable: false,
  });
  return output;
}

function renderSkillTemplateFallback(template: string, variables: Record<string, unknown>): string {
  let output = template;

  output = output.replace(
    /\{\{\s*#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g,
    (_, path: string, block: string) => {
      const value = getTemplateValue(path, variables);
      if (!Array.isArray(value)) return "";
      return value.map((item, index) => renderSkillTemplateFallback(block, {
        ...variables,
        this: item,
        index,
      })).join("");
    },
  );

  output = output.replace(
    /\{\{\s*#if\s+([\w.]+)\s*\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?\{\{\s*\/if\s*\}\}/g,
    (_, path: string, truthyBlock: string, falsyBlock = "") => {
      return isTruthyTemplateValue(getTemplateValue(path, variables)) ? truthyBlock : falsyBlock;
    },
  );

  output = output.replace(
    /\{\{\s*#unless\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\s*\/unless\s*\}\}/g,
    (_, path: string, block: string) => {
      return isTruthyTemplateValue(getTemplateValue(path, variables)) ? "" : block;
    },
  );

  output = output.replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_, path: string) => {
    return stringifyTemplateValue(getTemplateValue(path, variables));
  });
  return output.replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_, path: string) => {
    return stringifyTemplateValue(getTemplateValue(path, variables));
  });
}

export function renderSkillTemplate(template: string, variables: Record<string, unknown>): string {
  try {
    const compiled = Handlebars.compile(template, {
      noEscape: true,
      strict: false,
    });
    return compiled(withTemplateStringifiers(variables) as Record<string, unknown>);
  } catch {
    try {
      return renderSkillTemplateFallback(template, variables);
    } catch {
      return template.replace(/\{\{\{?\s*([\w.@]+)\s*\}?\}\}/g, (_, path: string) => {
        return stringifyTemplateValue(getTemplateValue(path, variables));
      });
    }
  }
}

function normalizePromptForAudit(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

export function normalizeSkillVersion(value: unknown): string {
  const raw = String(value ?? "1").trim();
  return raw || "1";
}

function buildSkillRuntimeSnapshot(skill: SkillRow, manifest: SkillManifest): SkillRuntimeSnapshot {
  const implementation = manifest.implementation || {};
  // 新皇帝 Skill 的数据库 manifest 是唯一运行时 Prompt 来源；legacy prompt 仅保留作审计对比。
  const systemPrompt = implementation.systemPrompt || "";
  const userPromptTemplate = implementation.userPromptTemplate || "";
  return {
    slug: skill.slug,
    name: skill.name,
    version: normalizeSkillVersion(skill.version),
    status: skill.status ?? null,
    modelOverride: skill.modelOverride || skill.model_override || null,
    timeoutSeconds: Math.min(Math.max(Number(skill.timeout_seconds || 120), 5), 600),
    systemPromptHash: hashPrompt(systemPrompt),
    systemPromptLength: systemPrompt.length,
    userPromptHash: hashPrompt(userPromptTemplate),
    manifestHash: hashJson(manifest),
  };
}

type SkillSnapshotExpectations = Pick<RunSkillInput<unknown>, "skillVersionPolicy" | "expectedSkillVersion" | "expectedSkillPromptHash"
  | "expectedSkillUserPromptHash" | "expectedSkillManifestHash" | "expectedSkillStatus">;

function hasContentSnapshotPins(input: SkillSnapshotExpectations): boolean {
  return input.expectedSkillUserPromptHash !== undefined || input.expectedSkillManifestHash !== undefined || input.expectedSkillStatus !== undefined;
}

function validateContentSnapshotPins(input: SkillSnapshotExpectations): void {
  if (input.expectedSkillStatus !== undefined && input.expectedSkillStatus !== "Released") {
    throw new SkillRunError("SKILL_VERSION_MISMATCH", "Expected Skill status must be Released", false);
  }
  for (const [field, label] of [["expectedSkillUserPromptHash", "user prompt"], ["expectedSkillManifestHash", "manifest"]] as const) {
    const value = input[field];
    if (value !== undefined && (typeof value !== "string" || !/^[a-f0-9]{16}$/u.test(value))) {
      throw new SkillRunError("SKILL_VERSION_MISMATCH", `Expected Skill ${label} hash must be 16 lowercase hexadecimal characters`, false);
    }
  }
}

function assertSkillSnapshotCompatible(snapshot: SkillRuntimeSnapshot, input: SkillSnapshotExpectations) {
  // New explicit content pins cannot be silently overridden by `latest`.
  // Calls without these fields retain their existing version-policy behavior.
  const policy = hasContentSnapshotPins(input) ? "snapshot"
    : input.skillVersionPolicy || ((input.expectedSkillVersion || input.expectedSkillPromptHash) ? "snapshot" : "latest");
  if (policy === "latest") return;
  if (input.expectedSkillStatus !== undefined && snapshot.status !== input.expectedSkillStatus) {
    throw new SkillRunError("SKILL_VERSION_MISMATCH", "Skill release state changed after approval", false);
  }

  const expectedVersion = input.expectedSkillVersion === undefined ? "" : normalizeSkillVersion(input.expectedSkillVersion);
  if (expectedVersion && expectedVersion !== snapshot.version) {
    throw new SkillRunError(
      "SKILL_VERSION_MISMATCH",
      `Skill '${snapshot.slug}' version changed: expected ${expectedVersion}, current ${snapshot.version}`,
      false,
    );
  }

  if (input.expectedSkillPromptHash && input.expectedSkillPromptHash !== snapshot.systemPromptHash) {
    throw new SkillRunError(
      "SKILL_VERSION_MISMATCH",
      `Skill '${snapshot.slug}' prompt changed after the Agent run started`,
      false,
    );
  }
  if (input.expectedSkillUserPromptHash !== undefined && input.expectedSkillUserPromptHash !== snapshot.userPromptHash) {
    throw new SkillRunError("SKILL_VERSION_MISMATCH", "Skill user prompt snapshot mismatch", false);
  }
  if (input.expectedSkillManifestHash !== undefined && input.expectedSkillManifestHash !== snapshot.manifestHash) {
    throw new SkillRunError("SKILL_VERSION_MISMATCH", "Skill manifest snapshot mismatch", false);
  }
}

function buildPromptAudit(skillSlug: string, dbSystemPrompt: string, legacySystemPrompt?: string, source?: string) {
  if (!legacySystemPrompt?.trim()) {
    return {
      skillSlug,
      source,
      systemPromptSource: "emperor_skills.manifest.implementation.systemPrompt",
      legacyPromptProvided: false,
      skillPromptHash: hashPrompt(dbSystemPrompt),
      skillPromptLength: dbSystemPrompt.length,
    };
  }

  const normalizedDb = normalizePromptForAudit(dbSystemPrompt);
  const normalizedLegacy = normalizePromptForAudit(legacySystemPrompt);
  return {
    skillSlug,
    source,
    systemPromptSource: "emperor_skills.manifest.implementation.systemPrompt",
    legacyPromptProvided: true,
    exactMatch: dbSystemPrompt === legacySystemPrompt,
    normalizedMatch: normalizedDb === normalizedLegacy,
    skillPromptHash: hashPrompt(dbSystemPrompt),
    legacyPromptHash: hashPrompt(legacySystemPrompt),
    skillPromptLength: dbSystemPrompt.length,
    legacyPromptLength: legacySystemPrompt.length,
    lengthDelta: dbSystemPrompt.length - legacySystemPrompt.length,
  };
}

function classifyProviderError(error: unknown): SkillRunError {
  if (error instanceof SkillRunError) return error;
  if (error instanceof SafeHttpError) {
    if (error.reason === "timeout") {
      return new SkillRunError("PROVIDER_TIMEOUT", "AI provider timed out", true, error);
    }
    if (error.reason === "network" || error.reason === "dns_resolution_failed") {
      return new SkillRunError("PROVIDER_UNAVAILABLE", "AI provider network is temporarily unavailable", true, error);
    }
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SkillRunError("PROVIDER_TIMEOUT", "AI provider timed out", true, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) {
    return new SkillRunError("PROVIDER_TIMEOUT", "AI provider timed out", true, error);
  }
  if (/abort|cancel/i.test(message)) {
    return new SkillRunError("CANCELED", "Skill execution canceled", false, error);
  }
  if (/429|rate.?limit/i.test(message)) {
    return new SkillRunError("PROVIDER_RATE_LIMIT", "AI provider rate limited the request", true, error);
  }
  if (/5\d\d|unavailable|bad gateway|gateway timeout/i.test(message)) {
    return new SkillRunError("PROVIDER_UNAVAILABLE", "AI provider is temporarily unavailable", true, error);
  }
  return new SkillRunError("UNKNOWN", "AI skill execution failed", false, error);
}

async function getSkill(skillSlug: string, workspaceId?: number | null): Promise<SkillRow> {
  const scope = workspaceId === undefined ? null : buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_skills WHERE slug = ? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_skills WHERE slug = ? LIMIT 1",
    scope ? [skillSlug, ...scope.params] : [skillSlug],
  );
  if (!rows[0]) throw new SkillRunError("SKILL_NOT_FOUND", `Skill '${skillSlug}' not found`, false);
  return rows[0] as SkillRow;
}

export async function getEmperorSkillRuntimeSnapshot(skillSlug: string, workspaceId?: number | null): Promise<SkillRuntimeSnapshot> {
  const skill = await getSkill(skillSlug, workspaceId);
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  return buildSkillRuntimeSnapshot(skill, manifest);
}

async function getModelBySlug(slug: string, workspaceId?: number | null): Promise<ModelRow | null> {
  if (slug === "manus-default") {
    return { slug, provider: "manus_builtin", modelId: "manus-default", isActive: true };
  }
  const scope = workspaceId === undefined ? null : buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_model_providers WHERE (slug = ? OR modelId = ?) AND isActive = 1 AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_model_providers WHERE (slug = ? OR modelId = ?) AND isActive = 1 LIMIT 1",
    scope ? [slug, slug, ...scope.params] : [slug, slug],
  );
  return (rows[0] as ModelRow | undefined) ?? null;
}

async function resolveModelCandidates(
  skill: SkillRow,
  requestedModel: string | undefined,
  fallbackModels: string[],
  workspaceId?: number | null,
  executionPreset: SkillExecutionPreset = "standard",
): Promise<ModelRow[]> {
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  const configuredModel = skill.modelOverride || skill.model_override || manifest.implementation?.modelPolicy;
  const qualityModel = executionPreset === "quality_first"
    ? manifest.implementation?.qualityModelPolicy || configuredModel
    : executionPreset === "evaluation"
      ? manifest.implementation?.evaluationModelPolicy || configuredModel
      : undefined;
  const preferred = [
    requestedModel,
    qualityModel,
    configuredModel,
  ].filter((value): value is string => Boolean(value));

  if (preferred.length === 0) {
    const scope = workspaceId === undefined ? null : buildWorkspaceScopeFilter(workspaceId);
    const defaults = await rawExecute(
      scope
        ? `SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
        : "SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 LIMIT 1",
      scope ? scope.params : [],
    );
    if (defaults[0]?.slug) preferred.push(String(defaults[0].slug));
  }

  const uniqueSlugs = [...new Set([...preferred, ...fallbackModels, "manus-default"])];
  const models: ModelRow[] = [];
  for (const slug of uniqueSlugs) {
    if (models.length >= 2) break;
    const model = await getModelBySlug(slug, workspaceId);
    if (model) models.push(model);
  }
  if (models.length === 0) {
    throw new SkillRunError("MODEL_NOT_FOUND", "No active model is available", false);
  }
  return models;
}

async function callModel(
  model: ModelRow,
  messages: Message[],
  implementation: NonNullable<SkillManifest["implementation"]>,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const apiKey = resolveGovernedModelApiKey(model.apiKeyRef);
  if (model.provider === "custom" && model.baseUrl && apiKey) {
    const payload: Record<string, unknown> = {
      model: model.modelId,
      messages,
      max_tokens: implementation.maxTokens || 4096,
    };
    if (implementation.temperature !== undefined) payload.temperature = implementation.temperature;
    const responseFormat = buildSkillJsonResponseFormat(implementation.supportsJsonMode);
    if (responseFormat) payload.response_format = responseFormat;

    // Older managed sites can still have a persisted `.com` Teamorouter base
    // URL. Normalize it at execution time as a failed-closed compatibility
    // boundary, so a stale record never depends on a retired SOCKS tunnel.
    const canonicalBaseUrl = canonicalizeTeamorouterOpenAiBaseUrl(model.baseUrl);
    const apiUrl = `${canonicalBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const proxyAgent = createRestrictedTeamorouterSocksAgent(apiUrl);
    const response = await safeHttpRequest(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
      timeoutMs: timeoutSeconds * 1000,
      maxResponseBytes: 20 * 1024 * 1024,
      agent: proxyAgent,
      allowedHosts: [new URL(apiUrl).hostname],
      allowPrivateNetwork: process.env.MODEL_PROVIDER_ALLOW_PRIVATE_NETWORK === "true",
      auditContext: {
        workspaceId: model.workspaceId ?? null,
        operation: "ai_os.skill_runner.external_model",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider HTTP ${response.status}: ${text.slice(0, 120)}`);
    }
    const result = response.json() as any;
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new SkillRunError("EMPTY_RESPONSE", "AI provider returned an empty response", true);
    }
    return {
      content,
      inputTokens: Number(result?.usage?.prompt_tokens || 0),
      outputTokens: Number(result?.usage?.completion_tokens || 0),
    };
  }

  const timeoutController = new AbortController();
  const abortFromParent = () => timeoutController.abort(signal?.reason || new Error("Skill execution canceled"));
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(
    () => timeoutController.abort(new Error(`Skill model timed out after ${timeoutSeconds}s`)),
    timeoutSeconds * 1000,
  );
  let result: InvokeResult;
  try {
    const params: any = {
      messages,
      max_tokens: implementation.maxTokens || 4096,
      bypassEmperor: true,
      emperorBypassReason: "skill_runner_provider_call",
      signal: timeoutController.signal,
    };
    // The independent site normally uses its registered external model gateway.
    // `manus-default` is the explicit, audited final candidate and must use the
    // Forge runtime even when the process-level default remains external.
    const runtimeProviderOverride = runtimeProviderOverrideForModel(model);
    if (runtimeProviderOverride) params.runtimeProviderOverride = runtimeProviderOverride;
    const responseFormat = buildSkillJsonResponseFormat(implementation.supportsJsonMode);
    if (responseFormat) params.response_format = responseFormat;
    result = await invokeLLM(params);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
  const rawContent = result?.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "";
  if (!content.trim()) {
    throw new SkillRunError("EMPTY_RESPONSE", "Built-in AI returned an empty response", true);
  }
  return {
    content,
    inputTokens: Number(result?.usage?.prompt_tokens || 0),
    outputTokens: Number(result?.usage?.completion_tokens || 0),
  };
}

/** No default/alias/fallback lookup. A duplicate registry identity is not a choice. */
export async function resolveStrictRegisteredModelSnapshot(input: { workspaceId: number; modelSlug: string }): Promise<StrictRegisteredModelSnapshot> {
  try {
    const captured = JSON.parse(strictRuntimeCanonical(input)) as { workspaceId: number; modelSlug: string };
    if (Object.keys(captured).sort().join(",") !== "modelSlug,workspaceId" || !Number.isSafeInteger(captured.workspaceId)
      || captured.workspaceId < 1 || captured.workspaceId > 2147483647 || typeof captured.modelSlug !== "string"
      || !captured.modelSlug || captured.modelSlug.length > 256) return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID");
    const rows = await rawExecute("SELECT workspaceId,slug,provider,modelId,baseUrl,apiKeyRef,isActive,capabilityTags,maxContextTokens,costPer1kInputTokens,costPer1kOutputTokens FROM emperor_model_providers WHERE slug=? AND (workspaceId=? OR workspaceId IS NULL)", [captured.modelSlug, captured.workspaceId]);
    if (rows.length !== 1) return strictRuntimeRefuse("STRICT_MODEL_UNAVAILABLE");
    const snapshot = strictModelSnapshotFromRow(captured.workspaceId, captured.modelSlug, rows[0]);
    if (!resolveGovernedModelApiKey(snapshot.model.apiKeyRef)?.trim()) return strictRuntimeRefuse("STRICT_MODEL_CREDENTIAL_UNAVAILABLE");
    return snapshot;
  } catch (error) {
    if (error instanceof StrictSkillRuntimeError) throw error;
    return strictRuntimeRefuse("STRICT_MODEL_UNAVAILABLE");
  }
}

async function runStrictEmperorSkill<T>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> {
  // Snapshot all caller data before the first await; accessors/non-JSON values are rejected.
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!("value" in descriptor) || !descriptor.enumerable) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
  }
  const strict = parseStrictExecutionOptions(input.strictExecution!);
  const { beforeDispatch } = strict;
  const validate = input.validate, signal = input.signal;
  if ((validate !== undefined && typeof validate !== "function") || (signal !== undefined && !(signal instanceof AbortSignal))) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
  const raw: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
    const field = Object.getOwnPropertyDescriptor(input, key)!;
    if (!("value" in field) || !field.enumerable) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
    if (!["strictExecution", "validate", "signal"].includes(key) && field.value !== undefined) raw[key] = field.value;
  }
  const request = JSON.parse(strictRuntimeCanonical(raw)) as RunSkillInput<T>;
  if (!Number.isSafeInteger(request.workspaceId) || Number(request.workspaceId) < 1 || request.workspaceId !== strict.modelSnapshot.workspaceId
    || !Number.isSafeInteger(request.userId) || request.userId < 1 || request.userId > 2147483647 || request.skillVersionPolicy !== "pinned"
    || request.expectedSkillStatus !== "Released" || request.maxModelAttempts !== 1
    || !Array.isArray(request.fallbackModels) || request.fallbackModels.length !== 0
    || request.modelOverride !== strict.modelSnapshot.model.slug || request.legacySystemPrompt !== undefined
    || typeof request.expectedSkillVersion !== "string" || !/^[1-9]\d*$/u.test(request.expectedSkillVersion) || Number(request.expectedSkillVersion) > 2147483647
    || ![request.expectedSkillPromptHash, request.expectedSkillUserPromptHash, request.expectedSkillManifestHash].every(value => typeof value === "string" && /^[a-f0-9]{16}$/u.test(value))
    || (request.executionPreset !== undefined && request.executionPreset !== "standard")
    || typeof request.skillSlug !== "string" || !request.skillSlug || request.skillSlug.length > 128
    || (request.context !== undefined && typeof request.context !== "string") || (request.emphasis !== undefined && typeof request.emphasis !== "string")
    || !request.variables || Object.getPrototypeOf(request.variables) !== Object.prototype) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
  if (signal?.aborted) return strictRuntimeRefuse("STRICT_RUNTIME_CANCELED");
  const skills = await rawExecute("SELECT * FROM emperor_skills WHERE slug=? AND (workspaceId=? OR (workspaceId IS NULL AND scope='global'))", [request.skillSlug, request.workspaceId]);
  if (skills.length !== 1 || skills[0].slug !== request.skillSlug || (skills[0].workspaceId !== null && skills[0].workspaceId !== request.workspaceId)
    || (skills[0].workspaceId === null && skills[0].scope !== "global")) return strictRuntimeRefuse("STRICT_RUNTIME_SKILL_UNAVAILABLE");
  const skill = skills[0] as SkillRow, manifest = parseJson<SkillManifest>(skill.manifest, {});
  strictRuntimeCanonical(manifest);
  if (String(skill.version) !== request.expectedSkillVersion) return strictRuntimeRefuse("STRICT_RUNTIME_SKILL_CHANGED");
  const snapshot = buildSkillRuntimeSnapshot(skill, manifest);
  try { assertSkillSnapshotCompatible(snapshot, request); }
  catch { return strictRuntimeRefuse("STRICT_RUNTIME_SKILL_CHANGED"); }
  if (snapshot.modelOverride !== strict.expectedSkillModelOverride || snapshot.timeoutSeconds !== strict.expectedSkillTimeoutSeconds
    || !snapshot.systemPromptLength) return strictRuntimeRefuse("STRICT_RUNTIME_SKILL_CHANGED");
  const implementation = manifest.implementation || {};
  if (implementation.temperature !== undefined && (typeof implementation.temperature !== "number" || !Number.isFinite(implementation.temperature)
    || implementation.temperature < 0 || implementation.temperature > 2)) return strictRuntimeRefuse("STRICT_RUNTIME_CONFIGURATION_INVALID");
  if (implementation.supportsJsonMode !== undefined && typeof implementation.supportsJsonMode !== "boolean") return strictRuntimeRefuse("STRICT_RUNTIME_CONFIGURATION_INVALID");
  const variables = { context: request.context || "", emphasis: request.emphasis || "", ...request.variables };
  const systemPrompt = implementation.systemPrompt || "", userPrompt = renderSkillTemplate(implementation.userPromptTemplate || "{{context}}", variables);
  const model = await resolveStrictRegisteredModelSnapshot({ workspaceId: request.workspaceId!, modelSlug: strict.modelSnapshot.model.slug });
  if (strictRuntimeCanonical(model) !== strictRuntimeCanonical(strict.modelSnapshot)) return strictRuntimeRefuse("STRICT_MODEL_CHANGED");
  const prepared = strictSkillMessages(systemPrompt, userPrompt, request.attachments, model, implementation.maxTokens ?? 4096, strict.imageBudget);
  const estimatedMaxCostCents = strictCostUpperBound(model, prepared.budget.contextAdmissionUnits, prepared.budget.outputTokens);
  if (estimatedMaxCostCents > strict.maxCostCents) return strictRuntimeRefuse("STRICT_RUNTIME_COST_BUDGET_EXCEEDED");
  const payload = { model: model.model.modelId, messages: prepared.messages, max_tokens: prepared.budget.outputTokens,
    ...(implementation.temperature === undefined ? {} : { temperature: implementation.temperature }),
    ...(implementation.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) };
  const body = strictRuntimeCanonical(payload), requestHash = strictRuntimeHash(payload);
  const apiKey = resolveGovernedModelApiKey(model.model.apiKeyRef);
  if (!apiKey?.trim()) return strictRuntimeRefuse("STRICT_MODEL_CREDENTIAL_UNAVAILABLE");
  const runId = generateRunId(), startedAt = new Date(), auditIdentity = strictSkillAuditIdentity(strict.stage);
  const metadata = { privateExecution: true, stage: strict.stage, bindingHash: strict.bindingHash, requestHash,
    modelConfigurationHash: model.configurationHash, skillVersion: snapshot.version, skillPromptHash: snapshot.systemPromptHash,
    skillUserPromptHash: snapshot.userPromptHash, skillManifestHash: snapshot.manifestHash, budget: prepared.budget,
    estimatedMaxCostCents, maxCostCents: strict.maxCostCents, imageBudget: strict.imageBudget ?? null,
    pricingBasis: "registered_rates_and_conservative_admission_not_provider_invoice" };
  await rawExecute("INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,skillPromptHash,skillManifestHash,migrationSource,userId,input,status,modelSlug,provider,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [request.workspaceId, runId, skill.slug, skill.name, Number(snapshot.version) || 1, snapshot.systemPromptHash, snapshot.manifestHash,
      auditIdentity.migrationSource, request.userId, JSON.stringify(metadata), "running", model.model.slug, "custom", startedAt]);
  let dispatched = false;
  try {
    if (signal?.aborted) return strictRuntimeRefuse("STRICT_RUNTIME_CANCELED");
    // This awaited callback owns the durable dispatch fence and fresh authorization.
    // After it there is no provider selection, fallback, database read, or retry.
    try { await beforeDispatch({ runId, stage: strict.stage, requestHash, modelConfigurationHash: model.configurationHash,
      bindingHash: strict.bindingHash, budget: structuredClone(prepared.budget) }); }
    catch { return strictRuntimeRefuse("STRICT_RUNTIME_DISPATCH_DENIED"); }
    if (signal?.aborted) return strictRuntimeRefuse("STRICT_RUNTIME_CANCELED");
    dispatched = true;
    const response = await safeHttpRequest(model.model.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body, signal, timeoutMs: snapshot.timeoutSeconds * 1000, maxResponseBytes: STRICT_SKILL_LIMITS.responseBytes, maxRedirects: 0,
      allowedHosts: [new URL(model.model.endpoint).hostname], allowPrivateNetwork: false,
      auditContext: { workspaceId: request.workspaceId, operation: auditIdentity.operation } });
    if (!response.ok) return strictRuntimeRefuse("STRICT_RUNTIME_PROVIDER_FAILED");
    const result = response.json() as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > STRICT_SKILL_LIMITS.responseBytes) return strictRuntimeRefuse("STRICT_RUNTIME_OUTPUT_INVALID");
    if (signal?.aborted) return strictRuntimeRefuse("STRICT_RUNTIME_CANCELED");
    const inputTokens = result.usage?.prompt_tokens, outputTokens = result.usage?.completion_tokens;
    if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || Number(inputTokens) < 0 || Number(outputTokens) < 0
      || Number(inputTokens) > model.model.maxContextTokens || Number(outputTokens) > prepared.budget.outputTokens) return strictRuntimeRefuse("STRICT_RUNTIME_USAGE_INVALID");
    let parsed: T;
    try { parsed = validate ? validate(content) : content as T; }
    catch { return strictRuntimeRefuse("STRICT_RUNTIME_OUTPUT_INVALID"); }
    const costCents = strictCostUpperBound(model, Number(inputTokens), Number(outputTokens));
    if (costCents > strict.maxCostCents) return strictRuntimeRefuse("STRICT_RUNTIME_COST_BUDGET_EXCEEDED");
    const durationMs = Date.now() - startedAt.getTime();
    const output = { ...metadata, outputHash: strictRuntimeHash(content), inputTokens, outputTokens, costCents, durationMs };
    await rawExecute("UPDATE emperor_skill_runs SET status=?,output=?,modelSlug=?,provider=?,inputTokens=?,outputTokens=?,durationMs=?,costCents=?,completedAt=? WHERE runId=?",
      ["succeeded", JSON.stringify(output), model.model.slug, "custom", inputTokens, outputTokens, durationMs, costCents, new Date(), runId]);
    const auditWarnings: NonNullable<RunSkillResult["auditWarnings"]> = [];
    try {
      await rawExecute(`UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ? AND workspaceId ${skill.workspaceId === null ? "IS NULL" : "= ?"}`,
        skill.workspaceId === null ? [skill.slug] : [skill.slug, skill.workspaceId]);
    } catch { auditWarnings.push("CALL_COUNT_UNAVAILABLE"); }
    // No heuristic "quality score" for an opaque private result. Only metadata
    // enters advisory stores; their failure must not discard a paid, validated
    // reply. The caller must still persist that reply in its turn-owned store.
    try {
      const metricReceipt = await recordAiOsMetric({ entityType: "skill", entityId: runId, metricName: "skill.tokens", metricValue: Number(inputTokens) + Number(outputTokens), status: "succeeded",
        workspaceId: request.workspaceId, userId: request.userId, skillSlug: skill.slug, metadata: output });
      if (metricReceipt.recorded !== true) auditWarnings.push("METRICS_UNAVAILABLE");
    } catch { auditWarnings.push("METRICS_UNAVAILABLE"); }
    return { runId, skillSlug: skill.slug, skillName: skill.name, skillVersion: snapshot.version, skillPromptHash: snapshot.systemPromptHash,
      skillManifestHash: snapshot.manifestHash, content, parsed, modelSlug: model.model.slug, provider: "custom", durationMs,
      costCents, inputTokens: Number(inputTokens), outputTokens: Number(outputTokens), fallbackCount: 0, executionPreset: "standard", governance: getHighQualitySkillGovernance(skill.slug), auditWarnings };
  } catch (error) {
    const code = error instanceof StrictSkillRuntimeError ? error.code : signal?.aborted ? "STRICT_RUNTIME_CANCELED" : "STRICT_RUNTIME_RESULT_UNKNOWN";
    // No provider body, callback cause, SQL params, or validation exception is retained.
    try { await rawExecute("UPDATE emperor_skill_runs SET status=?,errorMessage=?,durationMs=?,completedAt=? WHERE runId=?",
      ["failed", `${code}; dispatched=${dispatched ? "yes" : "no"}`, Date.now() - startedAt.getTime(), new Date(), runId]); } catch { /* Unknown audit acknowledgement is not permission to retry. */ }
    return strictRuntimeRefuse(code);
  }
}

export async function runEmperorSkill<T = string>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> {
  const strictDescriptor = Object.getOwnPropertyDescriptor(input, "strictExecution");
  if (strictDescriptor && !("value" in strictDescriptor)) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_INVALID");
  if (strictDescriptor?.value !== undefined) {
    try { return await runStrictEmperorSkill(input); }
    catch (error) { if (error instanceof StrictSkillRuntimeError) throw error; return strictRuntimeRefuse("STRICT_RUNTIME_UNAVAILABLE"); }
  }
  validateContentSnapshotPins(input);
  const skill = await getSkill(input.skillSlug, input.workspaceId ?? null);
  // Fixed-version and implicit snapshot runs must not drift into a live rollout.
  const rollout = !hasContentSnapshotPins(input) && input.skillVersionPolicy !== "snapshot" && input.skillVersionPolicy !== "pinned"
    && (input.skillVersionPolicy === "latest" || (input.expectedSkillVersion === undefined && !input.expectedSkillPromptHash))
    ? await resolveActiveSkillRollout({
      skillSlug: skill.slug,
      workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
      userId: input.userId,
      projectId: input.projectId ?? null,
    })
    : null;
  const runtimeSkill: SkillRow = rollout ? {
    ...skill,
    version: rollout.skillVersion,
    manifest: rollout.manifest,
    modelOverride: rollout.modelOverride,
    model_override: null,
  } : skill;
  const manifest = parseJson<SkillManifest>(runtimeSkill.manifest, {});
  // DEBUG: log manifest type and systemPrompt for troubleshooting
  if (input.skillSlug === 'image.step5.final.suggestion') {
    console.log(`[SkillRunner DEBUG] slug=${skill.slug} manifestType=${typeof skill.manifest} manifestIsNull=${skill.manifest === null} manifestKeys=${typeof manifest === 'object' ? Object.keys(manifest as object).join(',') : 'N/A'} implKeys=${typeof (manifest as any)?.implementation === 'object' ? Object.keys((manifest as any).implementation).join(',') : 'N/A'} promptLen=${((manifest as any)?.implementation?.systemPrompt || '').length}`);
  }
  const skillSnapshot = buildSkillRuntimeSnapshot(runtimeSkill, manifest);
  assertSkillSnapshotCompatible(skillSnapshot, input);
  const rolloutAudit = rollout ? {
    planId: rollout.planId,
    snapshotId: rollout.snapshotId,
    snapshotHash: rollout.snapshotHash,
    bucket: rollout.bucket,
    rolloutPercent: rollout.rolloutPercent,
  } : null;
  const implementation = manifest.implementation || {};
  const executionPreset = normalizeSkillExecutionPreset(input.executionPreset);
  const governance = getHighQualitySkillGovernance(skill.slug);
  const timeoutSeconds = skillSnapshot.timeoutSeconds;
  const variables = {
    context: input.context || "",
    emphasis: input.emphasis || "",
    ...input.variables,
  };
  // 皇帝Skill数据库manifest是运行时唯一的首选Prompt来源；旧代码提示词只在迁移兼容时回退。
  const systemPrompt = implementation.systemPrompt || input.legacySystemPrompt?.trim() || "";
  if (!systemPrompt.trim()) {
    throw new SkillRunError("PROMPT_MISSING", `Skill '${skill.slug}' has empty systemPrompt`, false);
  }
  const promptAudit = buildPromptAudit(skill.slug, implementation.systemPrompt || "", input.legacySystemPrompt, input.migrationSource);
  const executionVariables = {
    ...variables,
    __executionPreset: executionPreset,
    ...(rolloutAudit ? { __rollout: rolloutAudit } : {}),
    __promptAudit: {
      ...promptAudit,
      skillVersion: skillSnapshot.version,
      skillManifestHash: skillSnapshot.manifestHash,
    },
    __governance: governance,
  };
  const userPrompt = renderSkillTemplate(implementation.userPromptTemplate || "{{context}}", executionVariables);
  const models = await resolveModelCandidates(
    runtimeSkill,
    input.modelOverride,
    input.fallbackModels || DEFAULT_FALLBACKS,
    input.workspaceId ?? skill.workspaceId ?? null,
    executionPreset,
  );
  const modelAttempts = models.slice(0, Math.min(Math.max(input.maxModelAttempts || models.length, 1), models.length));

  const runId = generateRunId();
  const startedAt = new Date();
  await rawExecute(
    "INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,skillPromptHash,skillManifestHash,migrationSource,userId,input,status,modelSlug,provider,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [input.workspaceId ?? skill.workspaceId ?? null, runId, skill.slug, skill.name, Number(skillSnapshot.version) || 1, skillSnapshot.systemPromptHash, skillSnapshot.manifestHash, rollout ? `skill_rollout:${rollout.planId}` : input.migrationSource || null, input.userId, JSON.stringify(executionVariables), "running", models[0].slug, models[0].provider, startedAt],
  );

  let lastError: SkillRunError | null = null;
  for (let index = 0; index < modelAttempts.length; index += 1) {
    const model = modelAttempts[index];
    try {
      if (input.signal?.aborted) {
        throw new SkillRunError("CANCELED", "Skill execution canceled", false, input.signal.reason);
      }
      const response = await callModel(
        model,
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: input.attachments?.length
              ? [{ type: "text", text: userPrompt }, ...input.attachments]
              : userPrompt,
          },
        ],
        implementation,
        timeoutSeconds,
        input.signal,
      );
      let parsed: T;
      try {
        parsed = input.validate ? input.validate(response.content) : response.content as T;
      } catch (error) {
        throw new SkillRunError("INVALID_OUTPUT", "AI output validation failed", true, error);
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const totalTokens = response.inputTokens + response.outputTokens;
      const costCents = Math.max(0, Math.round(
        ((response.inputTokens * Number(model.costPer1kInputTokens || 0))
          + (response.outputTokens * Number(model.costPer1kOutputTokens || 0))) / 10,
      ));
      await rawExecute(
        "UPDATE emperor_skill_runs SET status=?,output=?,modelSlug=?,provider=?,inputTokens=?,outputTokens=?,durationMs=?,costCents=?,completedAt=? WHERE runId=?",
        [
          "succeeded",
          JSON.stringify({
            content: response.content,
            fallbackCount: index,
            executionPreset,
            skillVersion: skillSnapshot.version,
            skillPromptHash: skillSnapshot.systemPromptHash,
            skillManifestHash: skillSnapshot.manifestHash,
            rollout: rollout ? rolloutAudit : null,
            governance,
          }),
          model.slug,
          model.provider,
          response.inputTokens,
          response.outputTokens,
          durationMs,
          costCents,
          completedAt,
          runId,
        ],
      );
      // Quality-gate replay invokes the governed `evaluation` preset and records
      // its outcome in emperor_skill_eval_results. It is not a normal Skill use.
      if (executionPreset !== "evaluation") {
        await rawExecute("UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ?", [skill.slug]);
      }
      void recordAiOsEvaluation({
        entityType: "skill",
        entityId: runId,
        output: parsed,
        status: "succeeded",
        workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
        userId: input.userId,
        skillSlug: skill.slug,
        retryCount: index,
        fallbackCount: index,
        metadata: {
          skillName: skill.name,
          skillVersion: skillSnapshot.version,
          modelSlug: model.slug,
          provider: model.provider,
          executionPreset,
          governance,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs,
          costCents,
        },
      });
      void recordAiOsMetric({
        entityType: "skill",
        entityId: runId,
        metricName: "skill.succeeded",
        metricValue: durationMs,
        status: "succeeded",
        workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
        userId: input.userId,
        skillSlug: skill.slug,
        metadata: { skillName: skill.name, modelSlug: model.slug, provider: model.provider, fallbackCount: index, executionPreset, governance },
      });
      void recordAiOsMetric({
        entityType: "skill",
        entityId: runId,
        metricName: "skill.tokens",
        metricValue: totalTokens,
        status: "succeeded",
        workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
        userId: input.userId,
        skillSlug: skill.slug,
        metadata: { inputTokens: response.inputTokens, outputTokens: response.outputTokens, modelSlug: model.slug, executionPreset, governance },
      });
      return {
        runId,
        skillSlug: skill.slug,
        skillName: skill.name,
        skillVersion: skillSnapshot.version,
        skillPromptHash: skillSnapshot.systemPromptHash,
        skillManifestHash: skillSnapshot.manifestHash,
        content: response.content,
        parsed,
        modelSlug: model.slug,
        provider: model.provider,
        durationMs,
        costCents,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        fallbackCount: index,
        executionPreset,
        governance,
      };
    } catch (error) {
      lastError = input.signal?.aborted
        ? new SkillRunError("CANCELED", "Skill execution canceled", false, input.signal.reason || error)
        : classifyProviderError(error);
      if (!lastError.retryable || index === modelAttempts.length - 1) break;
    }
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  await rawExecute(
    "UPDATE emperor_skill_runs SET status=?,errorMessage=?,durationMs=?,completedAt=? WHERE runId=?",
    ["failed", `${lastError?.code || "UNKNOWN"}: ${lastError?.message || "Skill execution failed"}`, durationMs, completedAt, runId],
  );
  void recordAiOsEvaluation({
    entityType: "skill",
    entityId: runId,
    output: { errorCode: lastError?.code || "UNKNOWN", message: lastError?.message || "Skill execution failed" },
    status: "failed",
    workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
    userId: input.userId,
    skillSlug: skill.slug,
    retryCount: modelAttempts.length - 1,
    metadata: { skillName: skill.name, retryable: lastError?.retryable ?? false, executionPreset, governance },
  });
  void recordAiOsMetric({
    entityType: "skill",
    entityId: runId,
    metricName: "skill.failed",
    metricValue: durationMs,
    status: "failed",
    workspaceId: input.workspaceId ?? skill.workspaceId ?? null,
    userId: input.userId,
    skillSlug: skill.slug,
    metadata: { skillName: skill.name, errorCode: lastError?.code || "UNKNOWN", retryable: lastError?.retryable ?? false, executionPreset, governance },
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "AI 服务暂时不可用，请稍后重试",
    cause: lastError,
  });
}
