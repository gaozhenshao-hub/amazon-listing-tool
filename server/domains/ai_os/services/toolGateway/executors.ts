import { TRPCError, recordAiOsMetric, EmperorToolDefinition, EmperorToolInvocationInput, EmperorToolInvocationResult, EmperorToolNormalizedOutput, toRecord, buildUrl, generateToolRunId, sanitizeForAudit, serializeToolError, boundedToolAttempts, assertNoPlaintextSecrets, resolveSecretRefs, publicSecretRefs, assertToolPermission, assertToolRateLimit, incrementToolInFlight, buildToolGovernanceDecision, getToolCircuitState, assertToolCircuitClosed, recordToolCircuitSuccess, recordToolCircuitFailure, assertToolSchema, inferRequestUrl, inferToolRisk, assertHttpPolicy, createToolRunRecord, finishToolRunRecord, isPolicyBlock, classifyToolFailure, normalizeToolOutput, parseArrayConfig, captureInput, mergeOutputs, composeListingPreview, queryKnowledge } from "./governanceCore";
import { getToolDefinition } from "./registry";
import { safeHttpRequest } from "../../../../infrastructure/http/safeHttpClient";
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

async function invokeHttpTool(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = [], workspaceId?: number | null): Promise<ToolExecutorResult> {
  assertNoPlaintextSecrets(tool.config, "tool.config");
  assertNoPlaintextSecrets(params, "tool.params");
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs, 0, workspaceId ?? tool.workspaceId ?? null));
  const request = toRecord(await resolveSecretRefs(params, resolvedSecretRefs, 0, workspaceId ?? tool.workspaceId ?? null));
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
  const response = await safeHttpRequest(parsedUrl, {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(body ?? {}),
    timeoutMs,
    maxRedirects: Number(config.maxRedirects ?? 3),
    maxResponseBytes: Number(config.maxResponseBytes ?? 5 * 1024 * 1024),
    allowedHosts: parseArrayConfig(config.allowedHosts),
    allowedHostSuffixes: parseArrayConfig(config.allowedHostSuffixes),
    allowPrivateNetwork: config.allowPrivateNetwork === true,
    auditContext: { workspaceId: workspaceId ?? tool.workspaceId ?? null, toolSlug: tool.slug, operation: "tool.http" },
  });
  const contentType = response.headers["content-type"] || "";
  const output = contentType.includes("application/json") ? response.json() : response.text();
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `HTTP tool failed: ${response.status}`,
      cause: output,
    });
  }
  return { status: response.status, output, requestHost: parsedUrl.hostname };
}

async function invokeMcpHttpTool(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = [], workspaceId?: number | null): Promise<ToolExecutorResult> {
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs, 0, workspaceId ?? tool.workspaceId ?? null));
  const connectorConfig = toRecord(config.connectorConfig || config);
  const request = toRecord(await resolveSecretRefs(params, resolvedSecretRefs, 0, workspaceId ?? tool.workspaceId ?? null));
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
  const timeoutMs = Number(request.timeoutMs || connectorConfig.timeoutMs || 30000);
  const response = await safeHttpRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(request.rpcPayload || rpcPayload),
    timeoutMs,
    maxRedirects: Number(connectorConfig.maxRedirects ?? 3),
    maxResponseBytes: Number(connectorConfig.maxResponseBytes ?? 5 * 1024 * 1024),
    allowedHosts: parseArrayConfig(connectorConfig.allowedHosts),
    allowedHostSuffixes: parseArrayConfig(connectorConfig.allowedHostSuffixes),
    allowPrivateNetwork: connectorConfig.allowPrivateNetwork === true,
    auditContext: { workspaceId: workspaceId ?? tool.workspaceId ?? null, toolSlug: tool.slug, operation: "tool.mcp_http" },
  });
  const contentType = response.headers["content-type"] || "";
  const payload = contentType.includes("application/json") ? response.json() : response.text();
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

async function invokeMcpConnector(tool: EmperorToolDefinition, params: unknown, resolvedSecretRefs: string[] = [], workspaceId?: number | null): Promise<ToolExecutorResult> {
  assertNoPlaintextSecrets(tool.config, "tool.config");
  assertNoPlaintextSecrets(params, "tool.params");
  const config = toRecord(await resolveSecretRefs(tool.config, resolvedSecretRefs, 0, workspaceId ?? tool.workspaceId ?? null));
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
    }, params, resolvedSecretRefs, workspaceId);
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
    }, httpParams, resolvedSecretRefs, workspaceId);
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

async function invokeInternalTool(slug: string, params: unknown, resolvedSecretRefs: string[] = [], workspaceId?: number | null) {
  switch (slug) {
    case "internal.agent.capture_input":
      return captureInput(params);
    case "internal.agent.merge_outputs":
      return mergeOutputs(params);
    case "internal.listing.compose_preview":
      return composeListingPreview(params);
    case "internal.knowledge.query":
      return queryKnowledge(params);
    case "internal.http.request":
      return invokeHttpTool({
        slug,
        name: "HTTP API 请求",
        type: "api",
        config: {},
      }, params, resolvedSecretRefs, workspaceId);
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported internal tool: ${slug}` });
  }
}

registerEmperorToolExecutor("internal", async ({ tool, params, resolvedSecretRefs, invocation }) => {
  const result = await invokeInternalTool(tool.slug, params, resolvedSecretRefs, invocation.workspaceId ?? tool.workspaceId ?? null);
  return toRecord(result).output !== undefined && toRecord(result).status !== undefined
    ? result as ToolExecutorResult
    : { output: result };
});

registerEmperorToolExecutor("api", async ({ tool, params, resolvedSecretRefs, invocation }) => {
  return invokeHttpTool(tool, params, resolvedSecretRefs, invocation.workspaceId ?? tool.workspaceId ?? null);
});

registerEmperorToolExecutor("mcp", async ({ tool, params, resolvedSecretRefs, invocation }) => {
  return invokeMcpConnector(tool, params, resolvedSecretRefs, invocation.workspaceId ?? tool.workspaceId ?? null);
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
  const tool = await getToolDefinition(input.toolSlug, input.workspaceId ?? null);
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
      workspaceId: input.workspaceId ?? tool.workspaceId ?? null,
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
      workspaceId: input.workspaceId ?? tool.workspaceId ?? null,
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

export { ToolExecutorContext, ToolExecutorResult, EmperorToolExecutor, emperorToolExecutors, buildUrl, mergeToolHeaders, HTTP_REQUEST_CONTROL_KEYS, buildHttpRequestBody, pickConnectorCapability, mergeConnectorHttpCapabilityParams, applyToolAuth, invokeHttpTool, invokeMcpHttpTool, invokeMcpConnector, executeToolWithRegisteredExecutor };
