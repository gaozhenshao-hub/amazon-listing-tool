import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { createHash } from "crypto";
import Handlebars from "handlebars";
import { getDb } from "../../../repositories/dbClient";
import { buildWorkspaceScopeFilter } from "../../../services/securityGovernance";
import { invokeLLM, type InvokeResult, type Message, type MessageContent } from "../../../_core/llm";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";
import { recordAiOsEvaluation, recordAiOsMetric } from "./observability";

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

type SkillManifest = {
  implementation?: {
    systemPrompt?: string;
    userPromptTemplate?: string;
    modelPolicy?: string;
    maxTokens?: number;
    temperature?: number;
    supportsJsonMode?: boolean;
  };
};

export type RunSkillInput<T> = {
  skillSlug: string;
  userId: number;
  workspaceId?: number | null;
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
  maxModelAttempts?: number;
  signal?: AbortSignal;
  validate?: (content: string) => T;
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
};

export type SkillVersionPolicy = "latest" | "snapshot" | "pinned";

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

const DEFAULT_FALLBACKS = [
  "claude-sonnet-5",
  "gemini-3-6-flash",
  "manus-default",
];

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

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue to extracting a JSON payload from provider prose.
  }

  const candidates: Array<[number, number]> = [
    [cleaned.indexOf("{"), cleaned.lastIndexOf("}")],
    [cleaned.indexOf("["), cleaned.lastIndexOf("]")],
  ];

  for (const [start, end] of candidates) {
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // Try the next candidate.
      }
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

function assertSkillSnapshotCompatible(
  snapshot: SkillRuntimeSnapshot,
  input: Pick<RunSkillInput<unknown>, "skillVersionPolicy" | "expectedSkillVersion" | "expectedSkillPromptHash">,
) {
  const policy = input.skillVersionPolicy || ((input.expectedSkillVersion || input.expectedSkillPromptHash) ? "snapshot" : "latest");
  if (policy === "latest") return;

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
      ? `SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1",
    scope ? [slug, ...scope.params] : [slug],
  );
  return (rows[0] as ModelRow | undefined) ?? null;
}

async function resolveModelCandidates(
  skill: SkillRow,
  requestedModel: string | undefined,
  fallbackModels: string[],
  workspaceId?: number | null,
): Promise<ModelRow[]> {
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  const preferred = [
    requestedModel,
    skill.modelOverride || skill.model_override || undefined,
    manifest.implementation?.modelPolicy,
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
  if (model.provider === "custom" && model.baseUrl && model.apiKeyRef) {
    const payload: Record<string, unknown> = {
      model: model.modelId,
      messages,
      max_tokens: implementation.maxTokens || 4096,
    };
    if (implementation.temperature !== undefined) payload.temperature = implementation.temperature;
    if (implementation.supportsJsonMode) payload.response_format = { type: "json_object" };

    const apiUrl = `${model.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await safeHttpRequest(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${model.apiKeyRef}`,
      },
      body: JSON.stringify(payload),
      signal,
      timeoutMs: timeoutSeconds * 1000,
      maxResponseBytes: 20 * 1024 * 1024,
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
    if (implementation.supportsJsonMode) params.response_format = { type: "json_object" };
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

export async function runEmperorSkill<T = string>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> {
  const skill = await getSkill(input.skillSlug, input.workspaceId ?? null);
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  const skillSnapshot = buildSkillRuntimeSnapshot(skill, manifest);
  assertSkillSnapshotCompatible(skillSnapshot, input);
  const implementation = manifest.implementation || {};
  const timeoutSeconds = skillSnapshot.timeoutSeconds;
  const variables = {
    context: input.context || "",
    emphasis: input.emphasis || "",
    ...input.variables,
  };
  const systemPrompt = implementation.systemPrompt || "";
  if (!systemPrompt.trim()) {
    throw new SkillRunError("PROMPT_MISSING", `Skill '${skill.slug}' has empty systemPrompt`, false);
  }
  const promptAudit = buildPromptAudit(skill.slug, systemPrompt, input.legacySystemPrompt, input.migrationSource);
  const executionVariables = {
    ...variables,
    __promptAudit: {
      ...promptAudit,
      skillVersion: skillSnapshot.version,
      skillManifestHash: skillSnapshot.manifestHash,
    },
  };
  const userPrompt = renderSkillTemplate(implementation.userPromptTemplate || "{{context}}", executionVariables);
  const models = await resolveModelCandidates(
    skill,
    input.modelOverride,
    input.fallbackModels || DEFAULT_FALLBACKS,
    input.workspaceId ?? skill.workspaceId ?? null,
  );
  const modelAttempts = models.slice(0, Math.min(Math.max(input.maxModelAttempts || models.length, 1), models.length));

  const runId = generateRunId();
  const startedAt = new Date();
  await rawExecute(
    "INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,skillPromptHash,skillManifestHash,migrationSource,userId,input,status,modelSlug,provider,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [input.workspaceId ?? skill.workspaceId ?? null, runId, skill.slug, skill.name, Number(skillSnapshot.version) || 1, skillSnapshot.systemPromptHash, skillSnapshot.manifestHash, input.migrationSource || null, input.userId, JSON.stringify(executionVariables), "running", models[0].slug, models[0].provider, startedAt],
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
            skillVersion: skillSnapshot.version,
            skillPromptHash: skillSnapshot.systemPromptHash,
            skillManifestHash: skillSnapshot.manifestHash,
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
      await rawExecute("UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ?", [skill.slug]);
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
        metadata: { skillName: skill.name, modelSlug: model.slug, provider: model.provider, fallbackCount: index },
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
        metadata: { inputTokens: response.inputTokens, outputTokens: response.outputTokens, modelSlug: model.slug },
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
    metadata: { skillName: skill.name, retryable: lastError?.retryable ?? false },
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
    metadata: { skillName: skill.name, errorCode: lastError?.code || "UNKNOWN", retryable: lastError?.retryable ?? false },
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "AI 服务暂时不可用，请稍后重试",
    cause: lastError,
  });
}
