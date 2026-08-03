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
};

export type EmperorToolInvocationResult = {
  toolSlug: string;
  type: EmperorToolType;
  success: boolean;
  output: unknown;
  metadata: {
    durationMs: number;
    status?: number;
    source: "builtin" | "emperor_tools" | "mcp_connector";
  };
};

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
        config: params,
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
  const timeoutMs = Number(request.timeoutMs || config.timeoutMs || 30000);
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
  return { status: response.status, output };
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
  let output: unknown;
  let status: number | undefined;

  if (tool.type === "internal") {
    output = await invokeInternalTool(tool.slug, input.params);
  } else if (tool.type === "api") {
    const result = await invokeHttpTool(tool, input.params);
    status = result.status;
    output = result.output;
  } else if (tool.type === "mcp") {
    output = await invokeMcpConnector(tool, input.params);
    status = toRecord(output).status;
  } else {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Code tools require an approved internal handler and cannot execute arbitrary code.",
    });
  }

  return {
    toolSlug: input.toolSlug,
    type: tool.type,
    success: true,
    output,
    metadata: {
      durationMs: Date.now() - startedAt,
      status,
      source: tool.source,
    },
  };
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
