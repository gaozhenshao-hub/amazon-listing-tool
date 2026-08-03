import { TRPCError } from "@trpc/server";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";
import { recordAiOsMetric } from "./aiOsObservability";

export type EmperorToolType = "mcp" | "api" | "internal" | "code";

export type EmperorToolDefinition = {
  slug: string;
  name: string;
  description?: string | null;
  type: EmperorToolType;
  config?: unknown;
  governancePolicy?: unknown;
  permissionPolicy?: unknown;
  rateLimitPolicy?: unknown;
  circuitBreakerPolicy?: unknown;
  secretRefs?: unknown;
  outputPolicy?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  isActive?: number | boolean;
};

export type EmperorToolInvocationInput = {
  toolSlug: string;
  params?: unknown;
  userId: number;
  userRole?: string | null;
  runId?: string;
  nodeId?: string;
  projectId?: number | null;
};

export type EmperorToolInvocationResult = {
  toolSlug: string;
  type: EmperorToolType;
  success: boolean;
  output: unknown;
  normalizedOutput: EmperorToolNormalizedOutput;
  metadata: {
    toolRunId?: string | null;
    durationMs: number;
    status?: number;
    requestHost?: string | null;
    riskLevel?: ToolRiskLevel;
    attempts?: number;
    failureKind?: EmperorToolFailureKind | null;
    retryable?: boolean;
    circuitState?: ToolCircuitRuntimeState;
    governanceDecision?: ToolGovernanceDecision;
    secretRefs?: string[];
    source: "builtin" | "emperor_tools" | "mcp_connector";
  };
};

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";
type ToolRunStatus = "running" | "succeeded" | "failed" | "blocked";
export type EmperorToolFailureKind = "policy" | "rate_limit" | "circuit_open" | "schema" | "auth" | "timeout" | "network" | "http" | "executor" | "unknown";
type ToolCircuitRuntimeState = "closed" | "open" | "half_open";

export type ToolGovernanceDecision = {
  allowed: boolean;
  riskLevel: ToolRiskLevel;
  permissionPolicy?: unknown;
  rateLimitPolicy?: unknown;
  circuitBreakerPolicy?: unknown;
  secretRefs: string[];
  rateLimitScope?: string;
  circuitState: ToolCircuitRuntimeState;
};

export type EmperorToolNormalizedOutput = {
  ok: boolean;
  data: unknown;
  error?: {
    kind: EmperorToolFailureKind;
    message: string;
    retryable: boolean;
    httpStatus?: number | null;
  } | null;
  meta: {
    toolSlug: string;
    type: EmperorToolType;
    source: "builtin" | "emperor_tools" | "mcp_connector";
    status?: number | null;
    requestHost?: string | null;
    attempts: number;
    durationMs: number;
  };
};

let toolRunStoreAvailable = true;
const toolRateLimitBuckets = new Map<string, number[]>();
const toolInFlightCounts = new Map<string, number>();
const toolCircuitStates = new Map<string, {
  state: ToolCircuitRuntimeState;
  failures: number;
  openedUntil: number;
  lastFailureAt: number;
}>();

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

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function generateToolRunId(prefix = "tool"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|refresh[-_]?token|connection[-_]?string|dsn)/i;
const SECRET_REF_PATTERN = /^(env:[A-Z0-9_]+|secret:\/\/[a-z0-9._:-]+)$/i;
const SECRET_TEMPLATE_PATTERN = /\$\{(env:[A-Z0-9_]+|secret:[a-z0-9._:-]+)\}/gi;

function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 5) return "[Truncated]";
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForAudit(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 80)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeForAudit(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

export function sanitizeToolConfigForPublic(value: unknown): unknown {
  return sanitizeForAudit(value);
}

function serializeToolError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown tool invocation error";
  }
}

function parseArrayConfig(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function boundedToolAttempts(value: unknown): number {
  const attempts = Number(value);
  return Number.isFinite(attempts) ? Math.min(Math.max(Math.floor(attempts), 1), 5) : 1;
}

function secretKeyMaterial(): Buffer {
  const configured = process.env.TOOL_SECRET_KEY || process.env.EMPEROR_SECRET_KEY || process.env.JWT_SECRET;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOOL_SECRET_KEY is required in production for Tool secret encryption.");
    }
    return createHash("sha256").update("development-tool-secret-key").digest();
  }
  return createHash("sha256").update(configured).digest();
}

export function buildToolSecretRef(slug: string): string {
  return `secret://${slug}`;
}

export function encryptToolSecretValue(value: string): { encryptedValue: string; iv: string; authTag: string; keyVersion: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKeyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: "v1",
  };
}

export function decryptToolSecretValue(input: { encryptedValue: string; iv: string; authTag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", secretKeyMaterial(), Buffer.from(input.iv, "base64"));
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function loadStoredToolSecret(slug: string): Promise<string> {
  const rows = await rawExecute("SELECT encryptedValue,iv,authTag FROM emperor_tool_secrets WHERE slug=? LIMIT 1", [slug]);
  if (!rows[0]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Missing Tool secret reference: ${slug}` });
  }
  return decryptToolSecretValue(rows[0]);
}

function isSecretReferenceString(value: string): boolean {
  SECRET_TEMPLATE_PATTERN.lastIndex = 0;
  return SECRET_REF_PATTERN.test(value.trim()) || SECRET_TEMPLATE_PATTERN.test(value);
}

function assertNoPlaintextSecrets(value: unknown, path = "$", depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextSecrets(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof item === "string" && item.trim() && !isSecretReferenceString(item)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Tool secret value at ${nextPath} must use env:NAME or secret://slug reference`,
      });
    }
    assertNoPlaintextSecrets(item, nextPath, depth + 1);
  }
}

export function assertToolConfigUsesSecretRefs(value: unknown, path = "$") {
  assertNoPlaintextSecrets(value, path);
}

async function resolveSecretRefString(value: string, refs: string[]): Promise<string> {
  const trimmed = value.trim();
  if (/^env:/i.test(trimmed)) {
    const key = trimmed.slice(4);
    const secret = process.env[key];
    if (!secret) throw new TRPCError({ code: "BAD_REQUEST", message: `Missing environment secret: ${key}` });
    refs.push(`env:${key}`);
    return secret;
  }
  if (/^secret:\/\//i.test(trimmed)) {
    const slug = trimmed.slice("secret://".length);
    refs.push(`secret://${slug}`);
    return loadStoredToolSecret(slug);
  }
  SECRET_TEMPLATE_PATTERN.lastIndex = 0;
  let output = value;
  for (const match of value.matchAll(SECRET_TEMPLATE_PATTERN)) {
    const ref = match[1];
    const replacement = /^env:/i.test(ref)
      ? await resolveSecretRefString(ref, refs)
      : await resolveSecretRefString(`secret://${ref.slice("secret:".length)}`, refs);
    output = output.replace(match[0], replacement);
  }
  return output;
}

async function resolveSecretRefs(value: unknown, refs: string[] = [], depth = 0): Promise<unknown> {
  if (depth > 8) return value;
  if (typeof value === "string") return resolveSecretRefString(value, refs);
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveSecretRefs(item, refs, depth + 1)));
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await resolveSecretRefs(item, refs, depth + 1)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function publicSecretRefs(value: unknown, depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const refs: string[] = [];
    const trimmed = value.trim();
    if (SECRET_REF_PATTERN.test(trimmed)) refs.push(trimmed.replace(/^secret:/i, "secret:"));
    for (const match of value.matchAll(SECRET_TEMPLATE_PATTERN)) {
      refs.push(match[1].replace(/^secret:/i, "secret://"));
    }
    return refs;
  }
  if (Array.isArray(value)) return value.flatMap((item) => publicSecretRefs(item, depth + 1));
  if (typeof value === "object") return Object.values(value).flatMap((item) => publicSecretRefs(item, depth + 1));
  return [];
}

function toolPermissionPolicy(tool: EmperorToolDefinition): Record<string, any> {
  return {
    ...toRecord(toRecord(tool.config).permissions),
    ...toRecord(toRecord(tool.config).permissionPolicy),
    ...toRecord(tool.permissionPolicy),
  };
}

function assertToolPermission(tool: EmperorToolDefinition, invocation: EmperorToolInvocationInput) {
  const config = toRecord(tool.config);
  const policy = toolPermissionPolicy(tool);
  const role = String(invocation.userRole || "");
  const allowedRoles = parseArrayConfig(policy.allowedRoles || config.allowedRoles);
  if (allowedRoles.length > 0 && (!role || !allowedRoles.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Tool ${tool.slug} is not allowed for role ${role || "(unknown)"}` });
  }
  const deniedRoles = parseArrayConfig(policy.deniedRoles || config.deniedRoles);
  if (role && deniedRoles.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Tool ${tool.slug} is denied for role ${role}` });
  }
  const allowedUserIds = parseArrayConfig(policy.allowedUserIds || config.allowedUserIds).map(Number).filter(Number.isFinite);
  if (allowedUserIds.length > 0 && !allowedUserIds.includes(invocation.userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Tool ${tool.slug} is not allowed for this user` });
  }
  const requiredProjectIds = parseArrayConfig(policy.allowedProjectIds || config.allowedProjectIds).map(Number).filter(Number.isFinite);
  if (requiredProjectIds.length > 0 && (!invocation.projectId || !requiredProjectIds.includes(invocation.projectId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Tool ${tool.slug} is not allowed for this project` });
  }
}

function toolRateLimitPolicy(tool: EmperorToolDefinition): Record<string, any> {
  return {
    ...toRecord(toRecord(tool.config).rateLimit),
    ...toRecord(toRecord(tool.config).rateLimitPolicy),
    ...toRecord(tool.rateLimitPolicy),
  };
}

function rateLimitScopeKey(tool: EmperorToolDefinition, invocation: EmperorToolInvocationInput, policy: Record<string, any>) {
  const scope = String(policy.scope || "user");
  if (scope === "tool") return { scope, key: tool.slug };
  if (scope === "project") return { scope, key: `${tool.slug}:project:${invocation.projectId || "none"}` };
  if (scope === "agentRun") return { scope, key: `${tool.slug}:run:${invocation.runId || "none"}` };
  return { scope: "user", key: `${tool.slug}:user:${invocation.userId}` };
}

function assertToolRateLimit(tool: EmperorToolDefinition, invocation: EmperorToolInvocationInput) {
  const config = toRecord(tool.config);
  const policy = toolRateLimitPolicy(tool);
  const limit = Number(policy.perMinute || config.rateLimitPerMinute || config.maxCallsPerMinute || 0);
  const hourLimit = Number(policy.perHour || config.rateLimitPerHour || config.maxCallsPerHour || 0);
  const concurrencyLimit = Number(policy.concurrency || config.concurrency || 0);
  const { key } = rateLimitScopeKey(tool, invocation, policy);
  if (Number.isFinite(concurrencyLimit) && concurrencyLimit > 0) {
    const inFlight = toolInFlightCounts.get(key) || 0;
    if (inFlight >= Math.min(Math.max(Math.floor(concurrencyLimit), 1), 1000)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Tool ${tool.slug} exceeded concurrency limit` });
    }
  }
  if (Number.isFinite(hourLimit) && hourLimit > 0) {
    assertWindowLimit(tool.slug, key, "hour", hourLimit, 3_600_000);
  }
  if (!Number.isFinite(limit) || limit <= 0) return;
  assertWindowLimit(tool.slug, key, "minute", limit, 60_000);
}

function assertWindowLimit(toolSlug: string, scopeKey: string, windowName: string, limit: number, windowMs: number) {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100_000);
  const key = `${scopeKey}:${windowName}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  const bucket = (toolRateLimitBuckets.get(key) || []).filter((timestamp) => timestamp >= windowStart);
  if (bucket.length >= boundedLimit) {
    toolRateLimitBuckets.set(key, bucket);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Tool ${toolSlug} exceeded ${boundedLimit}/${windowName} rate limit` });
  }
  bucket.push(now);
  toolRateLimitBuckets.set(key, bucket);
}

function incrementToolInFlight(tool: EmperorToolDefinition, invocation: EmperorToolInvocationInput) {
  const policy = toolRateLimitPolicy(tool);
  const { key } = rateLimitScopeKey(tool, invocation, policy);
  toolInFlightCounts.set(key, (toolInFlightCounts.get(key) || 0) + 1);
  return () => {
    const next = Math.max((toolInFlightCounts.get(key) || 1) - 1, 0);
    if (next === 0) toolInFlightCounts.delete(key);
    else toolInFlightCounts.set(key, next);
  };
}

function toolCircuitPolicy(tool: EmperorToolDefinition): Record<string, any> {
  return {
    ...toRecord(toRecord(tool.config).circuitBreaker),
    ...toRecord(toRecord(tool.config).circuitBreakerPolicy),
    ...toRecord(tool.circuitBreakerPolicy),
  };
}

function buildToolGovernanceDecision(input: {
  tool: EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" };
  invocation: EmperorToolInvocationInput;
  riskLevel: ToolRiskLevel;
  secretRefs: string[];
}): ToolGovernanceDecision {
  const ratePolicy = toolRateLimitPolicy(input.tool);
  const rateScope = rateLimitScopeKey(input.tool, input.invocation, ratePolicy);
  return {
    allowed: true,
    riskLevel: input.riskLevel,
    permissionPolicy: toolPermissionPolicy(input.tool),
    rateLimitPolicy: ratePolicy,
    circuitBreakerPolicy: toolCircuitPolicy(input.tool),
    secretRefs: [...new Set(input.secretRefs)],
    rateLimitScope: rateScope.scope,
    circuitState: getToolCircuitState(input.tool),
  };
}

function circuitKey(tool: EmperorToolDefinition) {
  return tool.slug;
}

function getToolCircuitState(tool: EmperorToolDefinition): ToolCircuitRuntimeState {
  const policy = toolCircuitPolicy(tool);
  if (policy.enabled === false) return "closed";
  const state = toolCircuitStates.get(circuitKey(tool));
  if (!state) return "closed";
  if (state.state === "open" && state.openedUntil <= Date.now()) return "half_open";
  return state.state;
}

function assertToolCircuitClosed(tool: EmperorToolDefinition) {
  const policy = toolCircuitPolicy(tool);
  if (policy.enabled === false) return;
  const key = circuitKey(tool);
  const state = toolCircuitStates.get(key);
  if (!state) return;
  if (state.state === "open" && state.openedUntil > Date.now()) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Tool ${tool.slug} circuit breaker is open` });
  }
  if (state.state === "open" && state.openedUntil <= Date.now()) {
    toolCircuitStates.set(key, { ...state, state: "half_open" });
  }
}

function recordToolCircuitSuccess(tool: EmperorToolDefinition) {
  const policy = toolCircuitPolicy(tool);
  if (policy.enabled === false) return;
  toolCircuitStates.delete(circuitKey(tool));
}

function recordToolCircuitFailure(tool: EmperorToolDefinition, failureKind: EmperorToolFailureKind) {
  const policy = toolCircuitPolicy(tool);
  if (policy.enabled === false || ["policy", "rate_limit", "schema", "auth", "circuit_open"].includes(failureKind)) return;
  const key = circuitKey(tool);
  const current = toolCircuitStates.get(key);
  const failureThreshold = Math.min(Math.max(Number(policy.failureThreshold || 5), 1), 100);
  const resetAfterMs = Math.min(Math.max(Number(policy.resetAfterMs || policy.openMs || 60_000), 1000), 86_400_000);
  const failures = (current?.failures || 0) + 1;
  const nextState: ToolCircuitRuntimeState = failures >= failureThreshold ? "open" : "closed";
  toolCircuitStates.set(key, {
    state: nextState,
    failures,
    openedUntil: nextState === "open" ? Date.now() + resetAfterMs : 0,
    lastFailureAt: Date.now(),
  });
}

function schemaTypes(schema: Record<string, any>): string[] {
  const type = schema.type;
  if (Array.isArray(type)) return type.map(String);
  if (typeof type === "string") return [type];
  if (schema.properties || schema.required) return ["object"];
  if (schema.items) return ["array"];
  return [];
}

function matchesJsonSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(value && typeof value === "object" && !Array.isArray(value));
    default:
      return true;
  }
}

function jsonSchemaPath(parent: string, key: string | number): string {
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

export function validateJsonSchemaValue(schema: unknown, value: unknown, path = "$"): string[] {
  if (schema === undefined || schema === null || schema === true) return [];
  if (schema === false) return [`${path} is not allowed`];
  if (typeof schema !== "object" || Array.isArray(schema)) return [];

  const record = schema as Record<string, any>;
  if (Array.isArray(record.anyOf) && !record.anyOf.some((item) => validateJsonSchemaValue(item, value, path).length === 0)) {
    return [`${path} must match at least one allowed schema`];
  }
  if (Array.isArray(record.oneOf) && record.oneOf.filter((item) => validateJsonSchemaValue(item, value, path).length === 0).length !== 1) {
    return [`${path} must match exactly one allowed schema`];
  }
  if (Array.isArray(record.allOf)) {
    return record.allOf.flatMap((item) => validateJsonSchemaValue(item, value, path));
  }

  if (Array.isArray(record.enum) && !record.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return [`${path} must be one of ${record.enum.map((item) => JSON.stringify(item)).join(", ")}`];
  }

  const types = schemaTypes(record);
  if (types.length > 0 && !types.some((type) => matchesJsonSchemaType(type, value))) {
    return [`${path} must be ${types.join(" or ")}`];
  }

  const errors: string[] = [];
  if (matchesJsonSchemaType("object", value)) {
    const objectValue = value as Record<string, unknown>;
    const required = Array.isArray(record.required) ? record.required.map(String) : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, key) || objectValue[key] === undefined) {
        errors.push(`${jsonSchemaPath(path, key)} is required`);
      }
    }
    const properties = toRecord(record.properties);
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(objectValue, key)) {
        errors.push(...validateJsonSchemaValue(propertySchema, objectValue[key], jsonSchemaPath(path, key)));
      }
    }
    if (record.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(objectValue)) {
        if (!allowed.has(key)) errors.push(`${jsonSchemaPath(path, key)} is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && record.items) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchemaValue(record.items, item, jsonSchemaPath(path, index)));
    });
  }

  if (typeof value === "string") {
    if (typeof record.minLength === "number" && value.length < record.minLength) errors.push(`${path} is shorter than ${record.minLength}`);
    if (typeof record.maxLength === "number" && value.length > record.maxLength) errors.push(`${path} is longer than ${record.maxLength}`);
    if (record.pattern) {
      try {
        if (!new RegExp(String(record.pattern)).test(value)) errors.push(`${path} does not match pattern`);
      } catch {
        errors.push(`${path} has an invalid schema pattern`);
      }
    }
  }

  if (typeof value === "number") {
    if (typeof record.minimum === "number" && value < record.minimum) errors.push(`${path} must be >= ${record.minimum}`);
    if (typeof record.maximum === "number" && value > record.maximum) errors.push(`${path} must be <= ${record.maximum}`);
  }

  return errors;
}

function assertToolSchema(direction: "input" | "output", tool: EmperorToolDefinition, value: unknown) {
  const schema = direction === "input" ? tool.inputSchema : tool.outputSchema;
  if (!schema) return;
  const errors = validateJsonSchemaValue(schema, value, "$");
  if (errors.length === 0) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Tool ${tool.slug} ${direction}Schema validation failed: ${errors.slice(0, 5).join("; ")}`,
  });
}

function inferRequestUrl(params: unknown, config: unknown): URL | null {
  const request = toRecord(params);
  const toolConfig = toRecord(config);
  const baseUrl = String(request.baseUrl || toolConfig.baseUrl || "");
  const path = String(request.path || toolConfig.path || "");
  const rawUrl = request.url ? String(request.url) : baseUrl ? buildUrl(baseUrl, path) : "";
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function inferToolRisk(tool: EmperorToolDefinition & { source?: string }, params?: unknown): ToolRiskLevel {
  const config = toRecord(tool.config);
  if (["low", "medium", "high", "critical"].includes(String(config.riskLevel))) {
    return String(config.riskLevel) as ToolRiskLevel;
  }
  if (tool.type === "code") return "critical";
  if (tool.type === "api" || tool.type === "mcp" || tool.slug === "internal.http.request") {
    const method = String(toRecord(params).method || config.method || "POST").toUpperCase();
    if (["DELETE", "PATCH", "PUT"].includes(method)) return "high";
    return "medium";
  }
  return "low";
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match172 = host.match(/^172\.(\d+)\./);
  return Boolean(match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31);
}

function assertHttpPolicy(tool: EmperorToolDefinition, url: URL, method: string, timeoutMs: number) {
  const config = toRecord(tool.config);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool only supports http/https URLs" });
  }

  const allowedMethods = parseArrayConfig(config.allowedMethods);
  const configuredMethod = String(config.method || "").toUpperCase();
  const effectiveAllowedMethods = allowedMethods.length > 0
    ? allowedMethods.map((item) => item.toUpperCase())
    : ["GET", "POST", configuredMethod].filter(Boolean);
  if (!effectiveAllowedMethods.includes(method)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `HTTP method ${method} is not allowed for this tool` });
  }

  const allowedHosts = parseArrayConfig(config.allowedHosts).map((item) => item.toLowerCase());
  const allowedHostSuffixes = parseArrayConfig(config.allowedHostSuffixes).map((item) => item.toLowerCase().replace(/^\./, ""));
  const hostname = url.hostname.toLowerCase();
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `HTTP host ${hostname} is not in the tool allowlist` });
  }
  if (allowedHostSuffixes.length > 0 && !allowedHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `HTTP host ${hostname} is not in the tool allowlist` });
  }
  if (isPrivateHost(hostname) && config.allowPrivateNetwork !== true) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool blocked private or local network target" });
  }

  const maxTimeoutMs = Number(config.maxTimeoutMs || 30000);
  if (timeoutMs > maxTimeoutMs) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `HTTP timeout exceeds maxTimeoutMs ${maxTimeoutMs}` });
  }
}

async function createToolRunRecord(input: {
  toolRunId: string;
  tool: EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" };
  invocation: EmperorToolInvocationInput;
  riskLevel: ToolRiskLevel;
  requestHost?: string | null;
  governanceDecision: ToolGovernanceDecision;
}) {
  if (!toolRunStoreAvailable) return;
  try {
    await rawExecute(
      `INSERT INTO emperor_tool_runs
       (toolRunId,toolSlug,toolName,toolType,source,status,riskLevel,userId,agentRunId,nodeId,projectId,input,requestHost,governanceDecision,secretRefs,circuitState,startedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.toolRunId,
        input.tool.slug,
        input.tool.name,
        input.tool.type,
        input.tool.source,
        "running",
        input.riskLevel,
        input.invocation.userId,
        input.invocation.runId || null,
        input.invocation.nodeId || null,
        input.invocation.projectId ?? null,
        stringifyJson(sanitizeForAudit(input.invocation.params ?? {})),
        input.requestHost || null,
        stringifyJson(input.governanceDecision),
        stringifyJson(input.governanceDecision.secretRefs),
        input.governanceDecision.circuitState,
        new Date(),
      ],
    );
  } catch (error) {
    toolRunStoreAvailable = false;
    if (!isMissingDatabase(error)) console.warn("[Tool Gateway] Failed to create tool run:", error);
  }
}

async function finishToolRunRecord(input: {
  toolRunId: string;
  status: ToolRunStatus;
  output?: unknown;
  normalizedOutput?: EmperorToolNormalizedOutput;
  error?: unknown;
  failureKind?: EmperorToolFailureKind | null;
  retryable?: boolean;
  attempts?: number;
  circuitState?: ToolCircuitRuntimeState;
  durationMs: number;
  httpStatus?: number;
}) {
  if (!toolRunStoreAvailable) return;
  try {
    await rawExecute(
      "UPDATE emperor_tool_runs SET status=?,output=?,normalizedOutput=?,errorMessage=?,failureKind=?,retryable=?,attemptCount=?,durationMs=?,httpStatus=?,circuitState=?,completedAt=?,updatedAt=NOW() WHERE toolRunId=?",
      [
        input.status,
        input.output === undefined ? null : stringifyJson(sanitizeForAudit(input.output)),
        input.normalizedOutput === undefined ? null : stringifyJson(sanitizeForAudit(input.normalizedOutput)),
        input.error === undefined ? null : serializeToolError(input.error),
        input.failureKind || null,
        input.retryable ? 1 : 0,
        input.attempts || 0,
        input.durationMs,
        input.httpStatus || null,
        input.circuitState || null,
        new Date(),
        input.toolRunId,
      ],
    );
  } catch (error) {
    toolRunStoreAvailable = false;
    if (!isMissingDatabase(error)) console.warn("[Tool Gateway] Failed to finish tool run:", error);
  }
}

function isPolicyBlock(error: unknown): boolean {
  const message = serializeToolError(error);
  return /(blocked|not allowed|allowlist|only supports|timeout exceeds|private or local network|invalid URL|must use env:NAME or secret:\/\/slug)/i.test(message);
}

export function classifyToolFailure(error: unknown, httpStatus?: number): { kind: EmperorToolFailureKind; retryable: boolean } {
  const message = serializeToolError(error);
  const code = error instanceof TRPCError ? error.code : "";
  const parsedStatus = httpStatus || Number(message.match(/(?:HTTP tool failed|MCP HTTP executor failed):\s*(\d+)/i)?.[1] || 0) || undefined;
  if (/circuit breaker is open/i.test(message)) return { kind: "circuit_open", retryable: true };
  if (code === "TOO_MANY_REQUESTS" || /rate limit|concurrency limit/i.test(message)) return { kind: "rate_limit", retryable: true };
  if (code === "FORBIDDEN" || isPolicyBlock(error)) return { kind: "policy", retryable: false };
  if (/schema validation failed/i.test(message)) return { kind: "schema", retryable: false };
  if (/missing .*secret|unauthorized|forbidden|401|403/i.test(message)) return { kind: "auth", retryable: false };
  if (/timeout|aborted|AbortError|ETIMEDOUT/i.test(message)) return { kind: "timeout", retryable: true };
  if (/fetch failed|ECONNRESET|ENOTFOUND|ECONNREFUSED|network/i.test(message)) return { kind: "network", retryable: true };
  if (parsedStatus && parsedStatus >= 500) return { kind: "http", retryable: true };
  if (parsedStatus && parsedStatus >= 400) return { kind: "http", retryable: false };
  if (/executor|unsupported|cannot execute/i.test(message)) return { kind: "executor", retryable: false };
  return { kind: "unknown", retryable: false };
}

function normalizeToolOutput(input: {
  tool: EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" };
  output?: unknown;
  error?: unknown;
  attempts: number;
  durationMs: number;
  status?: number | null;
  requestHost?: string | null;
  failureKind?: EmperorToolFailureKind | null;
  retryable?: boolean;
}): EmperorToolNormalizedOutput {
  if (input.error) {
    const classified = input.failureKind
      ? { kind: input.failureKind, retryable: input.retryable ?? false }
      : classifyToolFailure(input.error, input.status || undefined);
    return {
      ok: false,
      data: null,
      error: {
        kind: classified.kind,
        message: serializeToolError(input.error),
        retryable: classified.retryable,
        httpStatus: input.status || null,
      },
      meta: {
        toolSlug: input.tool.slug,
        type: input.tool.type,
        source: input.tool.source,
        status: input.status || null,
        requestHost: input.requestHost || null,
        attempts: input.attempts,
        durationMs: input.durationMs,
      },
    };
  }
  const outputPolicy = toRecord(input.tool.outputPolicy || toRecord(input.tool.config).outputPolicy);
  const record = toRecord(input.output);
  const data = outputPolicy.unwrapKey && Object.prototype.hasOwnProperty.call(record, String(outputPolicy.unwrapKey))
    ? record[String(outputPolicy.unwrapKey)]
    : input.output;
  return {
    ok: true,
    data,
    error: null,
    meta: {
      toolSlug: input.tool.slug,
      type: input.tool.type,
      source: input.tool.source,
      status: input.status || null,
      requestHost: input.requestHost || null,
      attempts: input.attempts,
      durationMs: input.durationMs,
    },
  };
}

function isMissingDatabase(error: unknown): boolean {
  return error instanceof TRPCError
    && error.code === "INTERNAL_SERVER_ERROR"
    && /Database not available/i.test(error.message);
}

function unwrapSkillResult(value: unknown): unknown {
  const record = toRecord(value);
  if ("parsed" in record) return record.parsed;
  if ("output" in record) return record.output;
  return value;
}

function pickFirst(record: Record<string, any>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  }
  return undefined;
}

function getNodeInput(params: unknown) {
  const record = toRecord(params);
  const nodeInput = toRecord(record.nodeInput || record);
  return {
    runInputs: toRecord(nodeInput.runInputs),
    parentOutputs: toRecord(nodeInput.parentOutputs),
    node: toRecord(nodeInput.node),
  };
}

function composeListingPreview(params: unknown) {
  const { runInputs, parentOutputs } = getNodeInput(params);
  const normalizedParents = Object.fromEntries(
    Object.entries(parentOutputs).map(([key, value]) => [key, unwrapSkillResult(value)])
  );
  const sellingPoints = unwrapSkillResult(normalizedParents.sellingPoints);
  const title = unwrapSkillResult(normalizedParents.title);
  const description = unwrapSkillResult(normalizedParents.description);
  const searchTerms = unwrapSkillResult(normalizedParents.searchTerms);
  const qaContent = unwrapSkillResult(normalizedParents.qaContent);

  return {
    project: runInputs.project || runInputs,
    title: pickFirst(toRecord(title), ["title", "mainTitle", "recommendedTitle", "en"]) || title,
    sellingPoints,
    bulletPoints: pickFirst(toRecord(sellingPoints), ["bulletPoints", "bullets", "sellingPoints", "points"]) || sellingPoints,
    description: pickFirst(toRecord(description), ["description", "productDescription", "html", "en"]) || description,
    searchTerms: pickFirst(toRecord(searchTerms), ["searchTerms", "backendSearchTerms", "terms", "en"]) || searchTerms,
    qaContent: pickFirst(toRecord(qaContent), ["qaContent", "qaPairs", "questions", "items"]) || qaContent,
    sourceKeys: Object.keys(normalizedParents),
    generatedAt: new Date().toISOString(),
  };
}

function mergeOutputs(params: unknown) {
  const { runInputs, parentOutputs, node } = getNodeInput(params);
  return {
    ...runInputs,
    ...Object.fromEntries(Object.entries(parentOutputs).map(([key, value]) => [key, unwrapSkillResult(value)])),
    node,
  };
}

function captureInput(params: unknown) {
  const { runInputs, node } = getNodeInput(params);
  return {
    nodeId: node.id,
    capturedInput: runInputs,
    generatedAt: new Date().toISOString(),
  };
}

async function queryKnowledge(params: unknown) {
  const record = toRecord(params);
  const { runInputs, parentOutputs, node } = getNodeInput(params);
  const query = String(record.query || node.query || runInputs.query || runInputs.keyword || "").trim();
  if (!query) {
    return { query, items: [], note: "未提供知识库查询关键词。" };
  }

  const like = `%${query}%`;
  const rows = await rawExecute(
    `SELECT id,memory_type,content,source,tags,confidence,created_at
     FROM emperor_knowledge
     WHERE is_active=1 AND (content LIKE ? OR source LIKE ?)
     ORDER BY confidence DESC, updated_at DESC
     LIMIT 10`,
    [like, like],
  ).catch(() => []);

  return {
    query,
    parentKeys: Object.keys(parentOutputs),
    items: rows.map((row) => ({
      ...row,
      tags: parseJson(row.tags, []),
    })),
  };
}

const BUILTIN_TOOLS: EmperorToolDefinition[] = [
  {
    slug: "internal.agent.capture_input",
    name: "采集 Agent 输入",
    description: "把启动 Agent 时传入的项目/产品/市场信息固化成首个可确认产物。",
    type: "internal",
    config: { handler: "capture_input" },
  },
  {
    slug: "internal.agent.merge_outputs",
    name: "合并上游节点产物",
    description: "将上游节点输出合并为结构化结果。",
    type: "internal",
    config: { handler: "merge_outputs" },
  },
  {
    slug: "internal.listing.compose_preview",
    name: "组合 Listing 预览",
    description: "把 G1-G5 的已确认产物组合为完整 Listing 预览。",
    type: "internal",
    config: { handler: "compose_listing_preview" },
  },
  {
    slug: "internal.knowledge.query",
    name: "查询皇帝知识库",
    description: "基于查询词检索皇帝知识库内容。",
    type: "internal",
    config: { handler: "knowledge_query" },
  },
  {
    slug: "internal.http.request",
    name: "HTTP API 请求",
    description: "通过 Tool Gateway 发起受控 HTTP API 请求。",
    type: "internal",
    config: { handler: "http_request" },
  },
];

function builtinBySlug(slug: string) {
  return BUILTIN_TOOLS.find((tool) => tool.slug === slug);
}

export function getBuiltinToolDefinitions() {
  return BUILTIN_TOOLS;
}

export async function listEmperorTools() {
  const toolRows = await rawExecute(
    "SELECT slug,name,description,type,config,governancePolicy,permissionPolicy,rateLimitPolicy,circuitBreakerPolicy,secretRefs,outputPolicy,inputSchema,outputSchema,isActive,createdAt,updatedAt FROM emperor_tools ORDER BY name"
  ).catch(() => []);
  const connectorRows = await rawExecute(
    "SELECT slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive,createdAt,updatedAt FROM emperor_mcp_connectors ORDER BY name"
  ).catch(() => []);

  const dbTools = toolRows.map((row) => ({
    ...row,
    config: sanitizeForAudit(parseJson(row.config, {})),
    governancePolicy: parseJson(row.governancePolicy, {}),
    permissionPolicy: parseJson(row.permissionPolicy, {}),
    rateLimitPolicy: parseJson(row.rateLimitPolicy, {}),
    circuitBreakerPolicy: parseJson(row.circuitBreakerPolicy, {}),
    secretRefs: parseJson(row.secretRefs, []),
    outputPolicy: parseJson(row.outputPolicy, {}),
    inputSchema: parseJson(row.inputSchema, null),
    outputSchema: parseJson(row.outputSchema, null),
    source: "emperor_tools" as const,
  }));
  const connectorTools = connectorRows.map((row) => ({
    slug: `mcp.${row.slug}`,
    name: row.name,
    description: row.description,
    type: "mcp" as const,
    config: { connectorSlug: row.slug, connectionType: row.connectionType, connectorConfig: sanitizeForAudit(parseJson(row.config, {})) },
    governancePolicy: parseJson(row.governancePolicy, {}),
    secretRefs: parseJson(row.secretRefs, []),
    inputSchema: null,
    outputSchema: null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: "mcp_connector" as const,
  }));

  return [
    ...BUILTIN_TOOLS.map((tool) => ({ ...tool, source: "builtin" as const })),
    ...dbTools,
    ...connectorTools,
  ];
}

async function getToolDefinition(slug: string): Promise<EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" }> {
  const builtin = builtinBySlug(slug);
  if (builtin) return { ...builtin, source: "builtin" };

  const rows = await rawExecute("SELECT * FROM emperor_tools WHERE slug=? AND isActive=1 LIMIT 1", [slug]);
  if (rows[0]) {
    return {
      slug: rows[0].slug,
      name: rows[0].name,
      description: rows[0].description,
      type: rows[0].type,
      config: parseJson(rows[0].config, {}),
      governancePolicy: parseJson(rows[0].governancePolicy, {}),
      permissionPolicy: parseJson(rows[0].permissionPolicy, {}),
      rateLimitPolicy: parseJson(rows[0].rateLimitPolicy, {}),
      circuitBreakerPolicy: parseJson(rows[0].circuitBreakerPolicy, {}),
      secretRefs: parseJson(rows[0].secretRefs, []),
      outputPolicy: parseJson(rows[0].outputPolicy, {}),
      inputSchema: parseJson(rows[0].inputSchema, null),
      outputSchema: parseJson(rows[0].outputSchema, null),
      isActive: rows[0].isActive,
      source: "emperor_tools",
    };
  }

  const connectorSlug = slug.startsWith("mcp.") ? slug.slice(4) : slug;
  const connectors = await rawExecute("SELECT * FROM emperor_mcp_connectors WHERE slug=? AND isActive=1 LIMIT 1", [connectorSlug]);
  if (connectors[0]) {
    return {
      slug,
      name: connectors[0].name,
      description: connectors[0].description,
      type: "mcp",
      config: {
        connectorSlug,
        connectionType: connectors[0].connectionType,
        connectorConfig: parseJson(connectors[0].config, {}),
      },
      governancePolicy: parseJson(connectors[0].governancePolicy, {}),
      secretRefs: parseJson(connectors[0].secretRefs, []),
      isActive: connectors[0].isActive,
      source: "mcp_connector",
    };
  }

  throw new TRPCError({ code: "NOT_FOUND", message: `Tool not found: ${slug}` });
}

async function invokeInternalTool(slug: string, params: unknown, resolvedSecretRefs: string[] = []) {
  switch (slug) {
    case "internal.agent.capture_input":
      return captureInput(params);
    case "internal.agent.merge_outputs":
      return mergeOutputs(params);
    case "internal.listing.compose_preview":
      return composeListingPreview(params);
    case "internal.knowledge.query":
      return queryKnowledge(params);
    case "internal.http.request": {
      const result = await invokeHttpTool({
        slug,
        name: "HTTP API 请求",
        type: "api",
        config: {},
      }, params, resolvedSecretRefs);
      return result;
    }
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported internal tool: ${slug}` });
  }
}

type ToolExecutorContext = {
  tool: EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" };
  params: unknown;
  invocation: EmperorToolInvocationInput;
  resolvedSecretRefs: string[];
};

type ToolExecutorResult = {
  output: unknown;
  status?: number;
  requestHost?: string | null;
};

type EmperorToolExecutor = (context: ToolExecutorContext) => Promise<ToolExecutorResult>;
const emperorToolExecutors = new Map<string, EmperorToolExecutor>();

export function registerEmperorToolExecutor(key: string, executor: EmperorToolExecutor) {
  emperorToolExecutors.set(key, executor);
}

function buildUrl(baseUrl: string, path = "") {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBase).toString();
}

function mergeToolHeaders(...values: unknown[]) {
  return Object.assign({}, ...values.map(toRecord));
}

const HTTP_REQUEST_CONTROL_KEYS = new Set([
  "url",
  "baseUrl",
  "path",
  "endpoint",
  "method",
  "headers",
  "authType",
  "authConfig",
  "apiKey",
  "apiKeyRef",
  "token",
  "accessToken",
  "username",
  "password",
  "timeoutMs",
  "allowedHosts",
  "allowedMethods",
  "capability",
  "toolName",
]);

function buildHttpRequestBody(request: Record<string, any>) {
  const explicitBody = request.body ?? request.payload ?? request.arguments ?? request.params;
  if (explicitBody !== undefined) return explicitBody;
  const data = Object.fromEntries(
    Object.entries(request).filter(([key, value]) => !HTTP_REQUEST_CONTROL_KEYS.has(key) && value !== undefined),
  );
  return Object.keys(data).length > 0 ? data : {};
}

function pickConnectorCapability(connectorConfig: Record<string, any>, request: Record<string, any>): Record<string, any> | null {
  const requested = String(request.capability || request.toolName || request.name || "").trim();
  if (!requested) return null;
  const capabilities = Array.isArray(connectorConfig.capabilities) ? connectorConfig.capabilities : [];
  const match = capabilities.find((capability) => String(toRecord(capability).name || "").trim() === requested);
  return match ? toRecord(match) : null;
}

function mergeConnectorHttpCapabilityParams(params: unknown, connectorConfig: Record<string, any>) {
  const request = toRecord(params);
  const capability = pickConnectorCapability(connectorConfig, request);
  if (!capability) return params;
  const next = {
    ...request,
    method: request.method || capability.method,
    path: request.path || request.endpoint || capability.path || capability.endpoint,
  };
  return next;
}

function applyToolAuth(input: {
  url: URL;
  headers: Record<string, string>;
  config: Record<string, any>;
  request: Record<string, any>;
}) {
  const authConfig = toRecord(input.config.authConfig);
  const authType = String(input.request.authType || input.config.authType || authConfig.authType || "none");
  if (authType === "bearer") {
    const token = String(input.request.token || input.config.token || input.config.apiKeyRef || authConfig.token || authConfig.apiKeyRef || "");
    if (token) input.headers.authorization = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  } else if (authType === "api_key") {
    const apiKey = String(input.request.apiKey || input.config.apiKey || input.config.apiKeyRef || authConfig.apiKey || authConfig.apiKeyRef || "");
    const headerName = String(input.config.apiKeyHeader || authConfig.headerName || "x-api-key");
    const queryParam = String(input.config.apiKeyQueryParam || authConfig.queryParam || "");
    if (apiKey && queryParam) input.url.searchParams.set(queryParam, apiKey);
    else if (apiKey) input.headers[headerName] = apiKey;
  } else if (authType === "basic") {
    const username = String(input.request.username || input.config.username || authConfig.username || "");
    const password = String(input.request.password || input.config.password || authConfig.password || "");
    if (username || password) input.headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  } else if (authType === "oauth2") {
    const token = String(input.request.accessToken || input.config.accessToken || authConfig.accessToken || "");
    if (token) input.headers.authorization = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  }
}

async function invokeHttpTool(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = []): Promise<ToolExecutorResult> {
  assertNoPlaintextSecrets(tool.config, "tool.config");
  assertNoPlaintextSecrets(params, "tool.params");
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs));
  const request = toRecord(await resolveSecretRefs(params, resolvedSecretRefs));
  const baseUrl = String(request.baseUrl || config.baseUrl || "");
  const path = String(request.path || config.path || "");
  const method = String(request.method || config.method || "POST").toUpperCase();
  if (!baseUrl && !request.url) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool requires baseUrl or url" });
  }

  const rawUrl = request.url ? String(request.url) : buildUrl(baseUrl, path);
  const headers = mergeToolHeaders(
    { "content-type": "application/json" },
    toRecord(config.headers),
    toRecord(request.headers),
  ) as Record<string, string>;
  const rawTimeoutMs = Number(request.timeoutMs || config.timeoutMs || 30000);
  const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 30000;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool received an invalid URL" });
  }
  applyToolAuth({ url: parsedUrl, headers, config, request });
  assertHttpPolicy(tool, parsedUrl, method, timeoutMs);
  const body = buildHttpRequestBody(request);
  const response = await fetch(parsedUrl.toString(), {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get("content-type") || "";
  const output = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `HTTP tool failed: ${response.status}`,
      cause: output,
    });
  }
  return { status: response.status, output, requestHost: parsedUrl.hostname };
}

async function invokeMcpHttpTool(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = []): Promise<ToolExecutorResult> {
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs));
  const connectorConfig = toRecord(config.connectorConfig || config);
  const request = toRecord(await resolveSecretRefs(params, resolvedSecretRefs));
  const baseUrl = String(request.baseUrl || connectorConfig.mcpEndpoint || connectorConfig.baseUrl || "");
  if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "MCP HTTP executor requires mcpEndpoint or baseUrl" });
  const method = String(request.method || "tools/call");
  const toolName = String(request.toolName || request.capability || connectorConfig.toolName || "");
  const url = new URL(baseUrl);
  const headers = mergeToolHeaders(
    { "content-type": "application/json" },
    connectorConfig.headers,
    request.headers,
  ) as Record<string, string>;
  applyToolAuth({ url, headers, config: connectorConfig, request });
  assertHttpPolicy({ ...tool, type: "api", config: connectorConfig }, url, "POST", Number(request.timeoutMs || connectorConfig.timeoutMs || 30000));
  const rpcPayload = {
    jsonrpc: "2.0",
    id: request.id || generateToolRunId("mcp_rpc"),
    method,
    params: {
      name: toolName,
      arguments: request.arguments || request.params || request.payload || {},
    },
  };
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(request.rpcPayload || rpcPayload),
    signal: AbortSignal.timeout(Number(request.timeoutMs || connectorConfig.timeoutMs || 30000)),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `MCP HTTP executor failed: ${response.status}`, cause: payload });
  }
  const resultRecord = toRecord(payload);
  if (resultRecord.error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `MCP tool failed: ${serializeToolError(resultRecord.error)}`, cause: resultRecord.error });
  }
  return {
    status: response.status,
    requestHost: url.hostname,
    output: resultRecord.result ?? payload,
  };
}

async function invokeMcpConnector(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = []): Promise<ToolExecutorResult> {
  assertNoPlaintextSecrets(tool.config, "tool.config");
  assertNoPlaintextSecrets(params, "tool.params");
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs));
  const connectorConfig = toRecord(config.connectorConfig || config);
  const connectionType = String(config.connectionType || connectorConfig.connectionType || "internal");
  const executor = String(connectorConfig.executor || connectorConfig.protocol || "");

  if (executor === "mcp_http" || connectorConfig.mcpEndpoint) {
    const result = await invokeMcpHttpTool({
      ...tool,
      config: {
        ...config,
        connectorConfig,
      },
    }, params, resolvedSecretRefs);
    return {
      status: result.status,
      requestHost: result.requestHost,
      output: {
        connectorSlug: config.connectorSlug,
        connectionType,
        result: result.output,
      },
    };
  }

  if (connectionType === "http_api" || connectorConfig.baseUrl) {
    const httpParams = mergeConnectorHttpCapabilityParams(params, connectorConfig);
    const result = await invokeHttpTool({
      ...tool,
      type: "api",
      config: connectorConfig,
    }, httpParams, resolvedSecretRefs);
    return {
      status: result.status,
      requestHost: result.requestHost,
      output: {
        connectorSlug: config.connectorSlug,
        connectionType,
        result: result.output,
      },
    };
  }

  return {
    output: {
      connectorSlug: config.connectorSlug,
      connectionType,
      params: sanitizeForAudit(params),
      message: "MCP Connector 已统一接入 Tool Gateway；请为该 connector 配置 executor=mcp_http、mcpEndpoint 或注册专用 executor。",
    },
  };
}

registerEmperorToolExecutor("internal", async ({ tool, params, resolvedSecretRefs }) => {
  const result = await invokeInternalTool(tool.slug, params, resolvedSecretRefs);
  return toRecord(result).output !== undefined && toRecord(result).status !== undefined
    ? result as ToolExecutorResult
    : { output: result };
});

registerEmperorToolExecutor("api", async ({ tool, params, resolvedSecretRefs }) => {
  return invokeHttpTool(tool, params, resolvedSecretRefs);
});

registerEmperorToolExecutor("mcp", async ({ tool, params, resolvedSecretRefs }) => {
  return invokeMcpConnector(tool, params, resolvedSecretRefs);
});

async function executeToolWithRegisteredExecutor(context: ToolExecutorContext): Promise<ToolExecutorResult> {
  const config = toRecord(context.tool.config);
  const connectorConfig = toRecord(config.connectorConfig);
  const executorKey = String(config.executorKey || connectorConfig.executorKey || context.tool.type);
  const executor = emperorToolExecutors.get(executorKey) || emperorToolExecutors.get(context.tool.type);
  if (!executor) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `No Tool executor registered for ${executorKey}` });
  }
  if (context.tool.type === "code") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Code tools require an approved internal handler and cannot execute arbitrary code.",
    });
  }
  return executor(context);
}

export async function invokeEmperorTool(input: EmperorToolInvocationInput): Promise<EmperorToolInvocationResult> {
  const startedAt = Date.now();
  const tool = await getToolDefinition(input.toolSlug);
  const toolRunId = generateToolRunId();
  const riskLevel = inferToolRisk(tool, input.params);
  const publicRefs = [
    ...publicSecretRefs(tool.secretRefs),
    ...publicSecretRefs(tool.config),
    ...publicSecretRefs(input.params),
  ];
  const resolvedSecretRefs = [...new Set(publicRefs)];
  const governanceDecision = buildToolGovernanceDecision({
    tool,
    invocation: input,
    riskLevel,
    secretRefs: resolvedSecretRefs,
  });
  const requestUrl = tool.type === "api" || tool.type === "mcp" || tool.slug === "internal.http.request"
    ? inferRequestUrl(input.params, tool.config)
    : null;
  await createToolRunRecord({
    toolRunId,
    tool,
    invocation: input,
    riskLevel,
    requestHost: requestUrl?.hostname || null,
    governanceDecision,
  });

  let output: unknown;
  let normalizedOutput: EmperorToolNormalizedOutput | null = null;
  let status: number | undefined;
  let requestHost: string | null = requestUrl?.hostname || null;
  let attempts = 0;
  const config = toRecord(tool.config);
  const retryPolicy = {
    ...toRecord(config.retry),
    ...toRecord(toRecord(tool.governancePolicy).retry),
  };
  const maxAttempts = boundedToolAttempts(retryPolicy.maxAttempts || config.maxAttempts || config.retryAttempts || 1);
  let releaseInFlight: (() => void) | null = null;

  try {
    assertNoPlaintextSecrets(tool.config, "tool.config");
    assertNoPlaintextSecrets(input.params, "tool.params");
    assertToolPermission(tool, input);
    assertToolCircuitClosed(tool);
    assertToolRateLimit(tool, input);
    releaseInFlight = incrementToolInFlight(tool, input);
    assertToolSchema("input", tool, input.params ?? {});

    for (attempts = 1; attempts <= maxAttempts; attempts += 1) {
      try {
        const execution = await executeToolWithRegisteredExecutor({
          tool,
          params: input.params,
          invocation: input,
          resolvedSecretRefs,
        });
        status = execution.status;
        requestHost = execution.requestHost || requestHost;
        output = execution.output;
        break;
      } catch (error) {
        const classified = classifyToolFailure(error, status);
        if (attempts >= maxAttempts || !classified.retryable || isPolicyBlock(error)) throw error;
        const delayMs = Math.min(500 * 2 ** (attempts - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    assertToolSchema("output", tool, output);
    recordToolCircuitSuccess(tool);
    normalizedOutput = normalizeToolOutput({
      tool,
      output,
      attempts,
      durationMs: Date.now() - startedAt,
      status,
      requestHost,
    });

    await finishToolRunRecord({
      toolRunId,
      status: "succeeded",
      output,
      normalizedOutput,
      attempts,
      circuitState: getToolCircuitState(tool),
      durationMs: Date.now() - startedAt,
      httpStatus: status,
    });
    void recordAiOsMetric({
      entityType: "tool",
      entityId: toolRunId,
      metricName: "tool.succeeded",
      metricValue: Date.now() - startedAt,
      status: "succeeded",
      userId: input.userId,
      projectId: input.projectId ?? null,
      nodeId: input.nodeId || null,
      toolSlug: tool.slug,
      metadata: {
        type: tool.type,
        source: tool.source,
        attempts,
        httpStatus: status,
        requestHost,
        governanceDecision,
        secretRefs: resolvedSecretRefs,
        circuitState: getToolCircuitState(tool),
      },
    });
  } catch (error) {
    const classified = classifyToolFailure(error, status);
    const circuitFailureKind = classified.kind;
    recordToolCircuitFailure(tool, circuitFailureKind);
    normalizedOutput = normalizeToolOutput({
      tool,
      error,
      attempts,
      durationMs: Date.now() - startedAt,
      status,
      requestHost,
      failureKind: classified.kind,
      retryable: classified.retryable,
    });
    const blocked = ["policy", "rate_limit", "circuit_open", "schema", "auth"].includes(classified.kind);
    await finishToolRunRecord({
      toolRunId,
      status: blocked ? "blocked" : "failed",
      normalizedOutput,
      error,
      failureKind: classified.kind,
      retryable: classified.retryable,
      attempts,
      circuitState: getToolCircuitState(tool),
      durationMs: Date.now() - startedAt,
      httpStatus: status,
    });
    void recordAiOsMetric({
      entityType: "tool",
      entityId: toolRunId,
      metricName: isPolicyBlock(error) ? "tool.blocked" : "tool.failed",
      metricValue: Date.now() - startedAt,
      status: isPolicyBlock(error) ? "blocked" : "failed",
      userId: input.userId,
      projectId: input.projectId ?? null,
      nodeId: input.nodeId || null,
      toolSlug: tool.slug,
      metadata: {
        type: tool.type,
        source: tool.source,
        attempts,
        httpStatus: status,
        requestHost,
        failureKind: classified.kind,
        retryable: classified.retryable,
        governanceDecision,
        secretRefs: resolvedSecretRefs,
        circuitState: getToolCircuitState(tool),
        error: serializeToolError(error),
      },
    });
    throw error;
  } finally {
    if (releaseInFlight) releaseInFlight();
  }

  return {
    toolSlug: input.toolSlug,
    type: tool.type,
    success: true,
    output,
    normalizedOutput: normalizedOutput!,
    metadata: {
      toolRunId,
      durationMs: Date.now() - startedAt,
      status,
      requestHost,
      riskLevel,
      attempts,
      failureKind: null,
      retryable: false,
      circuitState: getToolCircuitState(tool),
      governanceDecision,
      secretRefs: resolvedSecretRefs,
      source: tool.source,
    },
  };
}

export async function listEmperorToolRuns(input: {
  userId?: number;
  isAdmin?: boolean;
  toolSlug?: string;
  agentRunId?: string;
  nodeId?: string;
  status?: ToolRunStatus;
  limit?: number;
} = {}) {
  if (!toolRunStoreAvailable) return [];
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (!input.isAdmin && input.userId) {
    clauses.push("userId=?");
    params.push(input.userId);
  }
  if (input.toolSlug) {
    clauses.push("toolSlug=?");
    params.push(input.toolSlug);
  }
  if (input.agentRunId) {
    clauses.push("agentRunId=?");
    params.push(input.agentRunId);
  }
  if (input.nodeId) {
    clauses.push("nodeId=?");
    params.push(input.nodeId);
  }
  if (input.status) {
    clauses.push("status=?");
    params.push(input.status);
  }
  params.push(Math.min(Math.max(input.limit || 50, 1), 200));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const rows = await rawExecute(
      `SELECT * FROM emperor_tool_runs ${where} ORDER BY createdAt DESC LIMIT ?`,
      params,
    );
    return rows.map((row) => ({
      ...row,
      input: parseJson(row.input, null),
      output: parseJson(row.output, null),
      normalizedOutput: parseJson(row.normalizedOutput, null),
      governanceDecision: parseJson(row.governanceDecision, null),
      secretRefs: parseJson(row.secretRefs, []),
    }));
  } catch (error) {
    toolRunStoreAvailable = false;
    if (!isMissingDatabase(error)) console.warn("[Tool Gateway] Failed to list tool runs:", error);
    return [];
  }
}

export async function upsertEmperorTool(input: {
  slug: string;
  name: string;
  description?: string | null;
  type: EmperorToolType;
  config?: unknown;
  governancePolicy?: unknown;
  permissionPolicy?: unknown;
  rateLimitPolicy?: unknown;
  circuitBreakerPolicy?: unknown;
  secretRefs?: unknown;
  outputPolicy?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  isActive?: boolean;
}) {
  assertNoPlaintextSecrets(input.config, "tool.config");
  assertNoPlaintextSecrets(input.secretRefs, "tool.secretRefs");
  await rawExecute(
    `INSERT INTO emperor_tools (slug,name,description,type,config,governancePolicy,permissionPolicy,rateLimitPolicy,circuitBreakerPolicy,secretRefs,outputPolicy,inputSchema,outputSchema,isActive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),type=VALUES(type),config=VALUES(config),governancePolicy=VALUES(governancePolicy),permissionPolicy=VALUES(permissionPolicy),rateLimitPolicy=VALUES(rateLimitPolicy),circuitBreakerPolicy=VALUES(circuitBreakerPolicy),secretRefs=VALUES(secretRefs),outputPolicy=VALUES(outputPolicy),inputSchema=VALUES(inputSchema),outputSchema=VALUES(outputSchema),isActive=VALUES(isActive),updatedAt=NOW()`,
    [
      input.slug,
      input.name,
      input.description || null,
      input.type,
      input.config === undefined ? null : JSON.stringify(input.config),
      input.governancePolicy === undefined ? null : JSON.stringify(input.governancePolicy),
      input.permissionPolicy === undefined ? null : JSON.stringify(input.permissionPolicy),
      input.rateLimitPolicy === undefined ? null : JSON.stringify(input.rateLimitPolicy),
      input.circuitBreakerPolicy === undefined ? null : JSON.stringify(input.circuitBreakerPolicy),
      input.secretRefs === undefined ? null : JSON.stringify(input.secretRefs),
      input.outputPolicy === undefined ? null : JSON.stringify(input.outputPolicy),
      input.inputSchema === undefined ? null : JSON.stringify(input.inputSchema),
      input.outputSchema === undefined ? null : JSON.stringify(input.outputSchema),
      input.isActive === false ? 0 : 1,
    ],
  );
  return { success: true, slug: input.slug };
}

export async function upsertEmperorToolSecret(input: {
  slug: string;
  value: string;
  description?: string | null;
  metadata?: unknown;
  userId?: number | null;
}) {
  const encrypted = encryptToolSecretValue(input.value);
  await rawExecute(
    `INSERT INTO emperor_tool_secrets (slug,description,encryptedValue,iv,authTag,keyVersion,metadata,createdBy,updatedBy)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE description=VALUES(description),encryptedValue=VALUES(encryptedValue),iv=VALUES(iv),authTag=VALUES(authTag),keyVersion=VALUES(keyVersion),metadata=VALUES(metadata),updatedBy=VALUES(updatedBy),updatedAt=NOW()`,
    [
      input.slug,
      input.description || null,
      encrypted.encryptedValue,
      encrypted.iv,
      encrypted.authTag,
      encrypted.keyVersion,
      input.metadata === undefined ? null : JSON.stringify(sanitizeForAudit(input.metadata)),
      input.userId || null,
      input.userId || null,
    ],
  );
  return { success: true, ref: buildToolSecretRef(input.slug), slug: input.slug };
}

export async function seedBuiltinTools() {
  for (const tool of BUILTIN_TOOLS) {
    await upsertEmperorTool({
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      type: tool.type,
      config: tool.config,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      isActive: true,
    });
  }
  return { success: true, tools: BUILTIN_TOOLS };
}
