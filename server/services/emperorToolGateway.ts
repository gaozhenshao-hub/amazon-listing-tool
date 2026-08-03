import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";

export type EmperorToolType = "mcp" | "api" | "internal" | "code";

export type EmperorToolDefinition = {
  slug: string;
  name: string;
  description?: string | null;
  type: EmperorToolType;
  config?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  isActive?: number | boolean;
};

export type EmperorToolInvocationInput = {
  toolSlug: string;
  params?: unknown;
  userId: number;
  runId?: string;
  nodeId?: string;
  projectId?: number | null;
};

export type EmperorToolInvocationResult = {
  toolSlug: string;
  type: EmperorToolType;
  success: boolean;
  output: unknown;
  metadata: {
    toolRunId?: string | null;
    durationMs: number;
    status?: number;
    requestHost?: string | null;
    riskLevel?: ToolRiskLevel;
    source: "builtin" | "emperor_tools" | "mcp_connector";
  };
};

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";
type ToolRunStatus = "running" | "succeeded" | "failed" | "blocked";
let toolRunStoreAvailable = true;

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

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|refresh[-_]?token)/i;

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
}) {
  if (!toolRunStoreAvailable) return;
  try {
    await rawExecute(
      `INSERT INTO emperor_tool_runs
       (toolRunId,toolSlug,toolName,toolType,source,status,riskLevel,userId,agentRunId,nodeId,projectId,input,requestHost,startedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
  error?: unknown;
  durationMs: number;
  httpStatus?: number;
}) {
  if (!toolRunStoreAvailable) return;
  try {
    await rawExecute(
      "UPDATE emperor_tool_runs SET status=?,output=?,errorMessage=?,durationMs=?,httpStatus=?,completedAt=?,updatedAt=NOW() WHERE toolRunId=?",
      [
        input.status,
        input.output === undefined ? null : stringifyJson(sanitizeForAudit(input.output)),
        input.error === undefined ? null : serializeToolError(input.error),
        input.durationMs,
        input.httpStatus || null,
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
  return /(blocked|not allowed|allowlist|only supports|timeout exceeds|private or local network|invalid URL)/i.test(message);
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
    "SELECT slug,name,description,type,config,inputSchema,outputSchema,isActive,createdAt,updatedAt FROM emperor_tools ORDER BY name"
  ).catch(() => []);
  const connectorRows = await rawExecute(
    "SELECT slug,name,description,connectionType,config,isActive,createdAt,updatedAt FROM emperor_mcp_connectors ORDER BY name"
  ).catch(() => []);

  const dbTools = toolRows.map((row) => ({
    ...row,
    config: parseJson(row.config, {}),
    inputSchema: parseJson(row.inputSchema, null),
    outputSchema: parseJson(row.outputSchema, null),
    source: "emperor_tools" as const,
  }));
  const connectorTools = connectorRows.map((row) => ({
    slug: `mcp.${row.slug}`,
    name: row.name,
    description: row.description,
    type: "mcp" as const,
    config: { connectorSlug: row.slug, connectionType: row.connectionType, connectorConfig: parseJson(row.config, {}) },
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
      isActive: connectors[0].isActive,
      source: "mcp_connector",
    };
  }

  throw new TRPCError({ code: "NOT_FOUND", message: `Tool not found: ${slug}` });
}

async function invokeInternalTool(slug: string, params: unknown) {
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
      }, params);
      return result;
    }
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported internal tool: ${slug}` });
  }
}

function buildUrl(baseUrl: string, path = "") {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBase).toString();
}

async function invokeHttpTool(tool: EmperorToolDefinition, params: unknown) {
  const config = toRecord(tool.config);
  const request = toRecord(params);
  const baseUrl = String(request.baseUrl || config.baseUrl || "");
  const path = String(request.path || config.path || "");
  const method = String(request.method || config.method || "POST").toUpperCase();
  if (!baseUrl && !request.url) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool requires baseUrl or url" });
  }

  const url = request.url ? String(request.url) : buildUrl(baseUrl, path);
  const headers = {
    "content-type": "application/json",
    ...toRecord(config.headers),
    ...toRecord(request.headers),
  };
  const rawTimeoutMs = Number(request.timeoutMs || config.timeoutMs || 30000);
  const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 30000;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "HTTP tool received an invalid URL" });
  }
  assertHttpPolicy(tool, parsedUrl, method, timeoutMs);
  const body = request.body ?? request.payload ?? params;
  const response = await fetch(url, {
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

async function invokeMcpConnector(tool: EmperorToolDefinition, params: unknown) {
  const config = toRecord(tool.config);
  const connectorConfig = toRecord(config.connectorConfig || config);
  const connectionType = String(config.connectionType || connectorConfig.connectionType || "internal");

  if (connectionType === "http_api" || connectorConfig.baseUrl) {
    const result = await invokeHttpTool({
      ...tool,
      type: "api",
      config: connectorConfig,
    }, params);
    return {
      connectorSlug: config.connectorSlug,
      connectionType,
      ...result,
    };
  }

  return {
    connectorSlug: config.connectorSlug,
    connectionType,
    params,
    message: "MCP Connector 已统一接入 Tool Gateway；当前连接类型需要后续绑定真实 MCP 执行器。",
  };
}

export async function invokeEmperorTool(input: EmperorToolInvocationInput): Promise<EmperorToolInvocationResult> {
  const startedAt = Date.now();
  const tool = await getToolDefinition(input.toolSlug);
  const toolRunId = generateToolRunId();
  const riskLevel = inferToolRisk(tool, input.params);
  const requestUrl = tool.type === "api" || tool.type === "mcp" || tool.slug === "internal.http.request"
    ? inferRequestUrl(input.params, tool.config)
    : null;
  await createToolRunRecord({
    toolRunId,
    tool,
    invocation: input,
    riskLevel,
    requestHost: requestUrl?.hostname || null,
  });

  let output: unknown;
  let status: number | undefined;
  let requestHost: string | null = requestUrl?.hostname || null;

  try {
    if (tool.type === "internal") {
      output = await invokeInternalTool(tool.slug, input.params);
      status = Number(toRecord(output).status) || undefined;
      requestHost = toRecord(output).requestHost || requestHost;
    } else if (tool.type === "api") {
      const result = await invokeHttpTool(tool, input.params);
      status = result.status;
      requestHost = result.requestHost || requestHost;
      output = result.output;
    } else if (tool.type === "mcp") {
      output = await invokeMcpConnector(tool, input.params);
      status = Number(toRecord(output).status) || undefined;
      requestHost = toRecord(output).requestHost || requestHost;
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Code tools require an approved internal handler and cannot execute arbitrary code.",
      });
    }

    await finishToolRunRecord({
      toolRunId,
      status: "succeeded",
      output,
      durationMs: Date.now() - startedAt,
      httpStatus: status,
    });
  } catch (error) {
    await finishToolRunRecord({
      toolRunId,
      status: isPolicyBlock(error) ? "blocked" : "failed",
      error,
      durationMs: Date.now() - startedAt,
      httpStatus: status,
    });
    throw error;
  }

  return {
    toolSlug: input.toolSlug,
    type: tool.type,
    success: true,
    output,
    metadata: {
      toolRunId,
      durationMs: Date.now() - startedAt,
      status,
      requestHost,
      riskLevel,
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
  inputSchema?: unknown;
  outputSchema?: unknown;
  isActive?: boolean;
}) {
  await rawExecute(
    `INSERT INTO emperor_tools (slug,name,description,type,config,inputSchema,outputSchema,isActive)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),type=VALUES(type),config=VALUES(config),inputSchema=VALUES(inputSchema),outputSchema=VALUES(outputSchema),isActive=VALUES(isActive),updatedAt=NOW()`,
    [
      input.slug,
      input.name,
      input.description || null,
      input.type,
      input.config === undefined ? null : JSON.stringify(input.config),
      input.inputSchema === undefined ? null : JSON.stringify(input.inputSchema),
      input.outputSchema === undefined ? null : JSON.stringify(input.outputSchema),
      input.isActive === false ? 0 : 1,
    ],
  );
  return { success: true, slug: input.slug };
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
