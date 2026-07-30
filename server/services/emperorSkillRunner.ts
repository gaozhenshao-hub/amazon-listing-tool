import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";

export type SkillRunErrorCode =
  | "SKILL_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT"
  | "DATABASE_ERROR"
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
  slug: string;
  name: string;
  manifest: unknown;
  modelOverride?: string | null;
  model_override?: string | null;
  timeout_seconds?: number | null;
  version?: string | null;
};

type ModelRow = {
  slug: string;
  provider: string;
  modelId: string;
  baseUrl?: string | null;
  apiKeyRef?: string | null;
  isActive?: number | boolean;
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
  variables: Record<string, unknown>;
  context?: string;
  emphasis?: string;
  modelOverride?: string;
  fallbackModels?: string[];
  validate?: (content: string) => T;
};

export type RunSkillResult<T = string> = {
  runId: string;
  content: string;
  parsed: T;
  modelSlug: string;
  provider: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  fallbackCount: number;
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

export function renderSkillTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
      return undefined;
    }, variables);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function classifyProviderError(error: unknown): SkillRunError {
  if (error instanceof SkillRunError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SkillRunError("PROVIDER_TIMEOUT", "AI provider timed out", true, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate.?limit/i.test(message)) {
    return new SkillRunError("PROVIDER_RATE_LIMIT", "AI provider rate limited the request", true, error);
  }
  if (/5\d\d|unavailable|bad gateway|gateway timeout/i.test(message)) {
    return new SkillRunError("PROVIDER_UNAVAILABLE", "AI provider is temporarily unavailable", true, error);
  }
  return new SkillRunError("UNKNOWN", "AI skill execution failed", false, error);
}

async function getSkill(skillSlug: string): Promise<SkillRow> {
  const rows = await rawExecute("SELECT * FROM emperor_skills WHERE slug = ? LIMIT 1", [skillSlug]);
  if (!rows[0]) throw new SkillRunError("SKILL_NOT_FOUND", `Skill '${skillSlug}' not found`, false);
  return rows[0] as SkillRow;
}

async function getModelBySlug(slug: string): Promise<ModelRow | null> {
  if (slug === "manus-default") {
    return { slug, provider: "manus_builtin", modelId: "manus-default", isActive: true };
  }
  const rows = await rawExecute(
    "SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1",
    [slug],
  );
  return (rows[0] as ModelRow | undefined) ?? null;
}

async function resolveModelCandidates(
  skill: SkillRow,
  requestedModel: string | undefined,
  fallbackModels: string[],
): Promise<ModelRow[]> {
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  const preferred = [
    requestedModel,
    skill.modelOverride || skill.model_override || undefined,
    manifest.implementation?.modelPolicy,
  ].filter((value): value is string => Boolean(value));

  if (preferred.length === 0) {
    const defaults = await rawExecute(
      "SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 LIMIT 1",
    );
    if (defaults[0]?.slug) preferred.push(String(defaults[0].slug));
  }

  const uniqueSlugs = [...new Set([...preferred, ...fallbackModels, "manus-default"])];
  const models: ModelRow[] = [];
  for (const slug of uniqueSlugs) {
    const model = await getModelBySlug(slug);
    if (model) models.push(model);
  }
  if (models.length === 0) {
    throw new SkillRunError("MODEL_NOT_FOUND", "No active model is available", false);
  }
  return models;
}

async function callModel(
  model: ModelRow,
  messages: Array<{ role: "system" | "user"; content: string }>,
  implementation: NonNullable<SkillManifest["implementation"]>,
  timeoutSeconds: number,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (model.provider === "custom" && model.baseUrl && model.apiKeyRef) {
    const payload: Record<string, unknown> = {
      model: model.modelId,
      messages,
      max_tokens: implementation.maxTokens || 4096,
    };
    if (implementation.temperature !== undefined) payload.temperature = implementation.temperature;
    if (implementation.supportsJsonMode) payload.response_format = { type: "json_object" };

    const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${model.apiKeyRef}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider HTTP ${response.status}: ${text.slice(0, 120)}`);
    }
    const result = await response.json() as any;
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

  const params: any = {
    messages,
    max_tokens: implementation.maxTokens || 4096,
  };
  if (implementation.supportsJsonMode) params.response_format = { type: "json_object" };
  const result = await invokeLLM(params);
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
  const skill = await getSkill(input.skillSlug);
  const manifest = parseJson<SkillManifest>(skill.manifest, {});
  const implementation = manifest.implementation || {};
  const timeoutSeconds = Math.min(Math.max(Number(skill.timeout_seconds || 120), 5), 600);
  const variables = {
    context: input.context || "",
    emphasis: input.emphasis || "",
    ...input.variables,
  };
  const systemPrompt = implementation.systemPrompt || "You are a helpful assistant.";
  const userPrompt = renderSkillTemplate(implementation.userPromptTemplate || "{{context}}", variables);
  const models = await resolveModelCandidates(
    skill,
    input.modelOverride,
    input.fallbackModels || DEFAULT_FALLBACKS,
  );

  const runId = generateRunId();
  const startedAt = new Date();
  await rawExecute(
    "INSERT INTO emperor_skill_runs (runId,skillSlug,skillName,userId,input,status,modelSlug,startedAt) VALUES (?,?,?,?,?,?,?,?)",
    [runId, skill.slug, skill.name, input.userId, JSON.stringify(variables), "running", models[0].slug, startedAt],
  );

  let lastError: SkillRunError | null = null;
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const response = await callModel(
        model,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        implementation,
        timeoutSeconds,
      );
      let parsed: T;
      try {
        parsed = input.validate ? input.validate(response.content) : response.content as T;
      } catch (error) {
        throw new SkillRunError("INVALID_OUTPUT", "AI output validation failed", true, error);
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      await rawExecute(
        "UPDATE emperor_skill_runs SET status=?,output=?,modelSlug=?,inputTokens=?,outputTokens=?,durationMs=?,completedAt=? WHERE runId=?",
        [
          "succeeded",
          JSON.stringify({ content: response.content, fallbackCount: index }),
          model.slug,
          response.inputTokens,
          response.outputTokens,
          durationMs,
          completedAt,
          runId,
        ],
      );
      await rawExecute("UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ?", [skill.slug]);
      return {
        runId,
        content: response.content,
        parsed,
        modelSlug: model.slug,
        provider: model.provider,
        durationMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        fallbackCount: index,
      };
    } catch (error) {
      lastError = classifyProviderError(error);
      if (!lastError.retryable || index === models.length - 1) break;
    }
  }

  const completedAt = new Date();
  await rawExecute(
    "UPDATE emperor_skill_runs SET status=?,errorMessage=?,completedAt=? WHERE runId=?",
    ["failed", `${lastError?.code || "UNKNOWN"}: ${lastError?.message || "Skill execution failed"}`, completedAt, runId],
  );
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "AI 服务暂时不可用，请稍后重试",
    cause: lastError,
  });
}
