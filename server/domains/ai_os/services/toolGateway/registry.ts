import { TRPCError, buildWorkspaceScopeFilter, EmperorToolDefinition, rawExecute, parseJson, sanitizeForAudit } from "./governanceCore";
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

export async function listEmperorTools(workspaceId?: number | null) {
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const toolRows = await rawExecute(
    `SELECT workspaceId,slug,name,description,type,config,governancePolicy,permissionPolicy,rateLimitPolicy,circuitBreakerPolicy,secretRefs,outputPolicy,inputSchema,outputSchema,isActive,createdAt,updatedAt
     FROM emperor_tools
     WHERE ${scope.clause}
     ORDER BY workspaceId IS NULL ASC, name`,
    scope.params,
  ).catch(() => []);
  const connectorRows = await rawExecute(
    `SELECT workspaceId,slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive,createdAt,updatedAt
     FROM emperor_mcp_connectors
     WHERE ${scope.clause}
     ORDER BY workspaceId IS NULL ASC, name`,
    scope.params,
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
    workspaceId: row.workspaceId,
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

async function getToolDefinition(slug: string, workspaceId?: number | null): Promise<EmperorToolDefinition & { source: "builtin" | "emperor_tools" | "mcp_connector" }> {
  const builtin = builtinBySlug(slug);
  if (builtin) return { ...builtin, source: "builtin" };

  const scope = buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    `SELECT *
     FROM emperor_tools
     WHERE slug=? AND isActive=1 AND ${scope.clause}
     ORDER BY workspaceId IS NULL ASC
     LIMIT 1`,
    [slug, ...scope.params],
  );
  if (rows[0]) {
    return {
      workspaceId: rows[0].workspaceId ?? null,
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
  const connectors = await rawExecute(
    `SELECT *
     FROM emperor_mcp_connectors
     WHERE slug=? AND isActive=1 AND ${scope.clause}
     ORDER BY workspaceId IS NULL ASC
     LIMIT 1`,
    [connectorSlug, ...scope.params],
  );
  if (connectors[0]) {
    return {
      workspaceId: connectors[0].workspaceId ?? null,
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

export { BUILTIN_TOOLS, builtinBySlug, getToolDefinition };
