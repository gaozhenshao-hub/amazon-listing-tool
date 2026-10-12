import { TRPCError, validateJsonSchemaValue } from "./governanceCore";

type JsonRecord = Record<string, any>;
const own = (value: JsonRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const versionKeys = ["catalogVersion", "schemaVersion", "toolVersionId"] as const;
const schemaError = () => new TRPCError({ code: "BAD_REQUEST", message: "领星最新只读Schema无效或不匹配；已停止执行实际查询" });

const readCapabilities = new Set([
  "query_product_performance_asin_lists", "get_fba_stock_list", "query_order_profit_list", "get_my_sids",
  "ad_auth_shops", "erp_listing", "query_erp_keyword_ranking_keyword", "ad_campaign_report",
  "ad_campaign_keyword_report", "ad_campaign_search_term_report", "ad_campaign_targeting_report",
]);
const scopeExemptCapabilities = new Set(["get_my_sids", "ad_auth_shops"]);

export function assertLingxingReadRequest(capability: string, args: unknown): asserts args is JsonRecord {
  if (!readCapabilities.has(capability)) throw new TRPCError({ code: "FORBIDDEN", message: `领星能力${capability || "(empty)"}不在只读白名单中` });
  if (!isRecord(args)) throw schemaError();
  if (!scopeExemptCapabilities.has(capability)) {
    const keys = ["shop_id", "shopId", "sid", "sids", "profile_id", "profileId", "profile_ids"];
    if (!keys.some(key => args[key] !== undefined && args[key] !== null && String(args[key]).trim())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `领星能力${capability}缺少店铺或广告Profile范围` });
    }
  }
}

function jsonObject(value: unknown): JsonRecord {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw schemaError(); } }
  if (!isRecord(value)) throw schemaError();
  return value;
}

function assertSuccessfulLayer(layer: JsonRecord) {
  const message = [layer.message, layer.error, layer.msg, layer.code]
    .filter(value => value !== undefined && value !== null)
    .map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
  if (/mcp[ _-]?key|api[ _-]?key|access[ _-]?key|token|unauthori[sz]ed|forbidden|认证|鉴权|密钥/i.test(message)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "领星MCP认证失败：访问密钥无效、已失效或无权访问。请由超级管理员在系统设置 → API连接管理中替换领星MCP访问密钥，再执行无费用轻量校验。" });
  }
  if ((own(layer, "error") && layer.error !== null && layer.error !== undefined)
    || (own(layer, "isError") && layer.isError !== false)
    || (own(layer, "success") && layer.success !== true)
    || (own(layer, "code") && ![0, 1, 200].includes(layer.code))) throw schemaError();
}

/** Only known protocol envelopes; never recursively select schemas from examples. */
function schemaEnvelope(value: unknown) {
  const root = jsonObject(value);
  assertSuccessfulLayer(root);
  const mcp = own(root, "result") ? jsonObject(root.result) : root;
  assertSuccessfulLayer(mcp);
  let provider = mcp;
  if (own(mcp, "content")) {
    if (!Array.isArray(mcp.content) || mcp.content.length !== 1
      || !isRecord(mcp.content[0]) || mcp.content[0].type !== "text" || typeof mcp.content[0].text !== "string") throw schemaError();
    provider = jsonObject(mcp.content[0].text);
  }
  assertSuccessfulLayer(provider);
  const schema = own(provider, "data") ? jsonObject(provider.data) : provider;
  assertSuccessfulLayer(schema);
  return { mcp, provider, schema };
}

export function unwrapLingxingMcpEnvelope(value: unknown): JsonRecord { return schemaEnvelope(value).schema; }

// Fail closed on assertion keywords unsupported by the existing gateway validator.
const schemaAnnotations = new Set(["$schema", "$id", "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly"]);
const schemaAssertions = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "oneOf", "minLength", "maxLength", "pattern", "minimum", "maximum"]);
const jsonTypes = new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);

function assertSupportedInputSchema(schema: unknown, depth = 0): asserts schema is JsonRecord {
  if (depth > 12 || !isRecord(schema)) throw schemaError();
  if (Object.keys(schema).some(key => !schemaAnnotations.has(key) && !schemaAssertions.has(key))) throw schemaError();
  if (own(schema, "type")) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.length || types.some(type => typeof type !== "string" || !jsonTypes.has(type))) throw schemaError();
  }
  if (own(schema, "properties")) {
    if (!isRecord(schema.properties)) throw schemaError();
    for (const child of Object.values(schema.properties)) assertSupportedInputSchema(child, depth + 1);
  }
  if (own(schema, "required") && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== "string"))) throw schemaError();
  if (own(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") throw schemaError();
  if (own(schema, "items")) assertSupportedInputSchema(schema.items, depth + 1);
  if (own(schema, "enum") && (!Array.isArray(schema.enum) || !schema.enum.length)) throw schemaError();
  for (const key of ["anyOf", "oneOf"]) {
    if (!own(schema, key)) continue;
    if (!Array.isArray(schema[key]) || !schema[key].length) throw schemaError();
    for (const child of schema[key]) assertSupportedInputSchema(child, depth + 1);
  }
  for (const key of ["minLength", "maxLength", "minimum", "maximum"]) {
    if (own(schema, key) && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw schemaError();
  }
  if (own(schema, "pattern")) {
    if (typeof schema.pattern !== "string") throw schemaError();
    try { new RegExp(schema.pattern); } catch { throw schemaError(); }
  }
}

function assertBusinessArguments(inputSchema: unknown, args: JsonRecord) {
  assertSupportedInputSchema(inputSchema);
  if (inputSchema.type !== "object" || !isRecord(inputSchema.properties)) throw schemaError();
  // action specifies params constructed from search.inputSchema. Never send
  // undeclared root parameters or fill omitted values from examples/defaults.
  if (Object.keys(args).some(key => !own(inputSchema.properties, key)) || validateJsonSchemaValue(inputSchema, args).length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "领星业务参数不符合官方inputSchema；已停止执行实际查询" });
  }
}

function assertSingleSelfReadChain(schema: JsonRecord, capability: string) {
  if (!Array.isArray(schema.callChain) || schema.callChain.length !== 1) throw schemaError();
  const link = schema.callChain[0];
  if (!isRecord(link) || link.toolId !== capability || !Number.isSafeInteger(link.sortNo) || link.sortNo < 0
    || !isRecord(link.parameterBindings) || Object.keys(link.parameterBindings).length
    || Object.keys(link).some(key => !["toolId", "sortNo", "reason", "parameterBindings"].includes(key))
    || (own(link, "reason") && typeof link.reason !== "string")) throw schemaError();
}

export function buildLingxingActionInvocation(capability: string, args: unknown, envelope: unknown) {
  assertLingxingReadRequest(capability, args);
  const { mcp, provider, schema } = schemaEnvelope(envelope);
  if ([mcp, provider].some(layer => layer !== schema && versionKeys.some(key => own(layer, key)))) throw schemaError();
  if (schema.toolId !== capability || schema.toolType !== "read") throw schemaError();
  if (own(schema, "operationAction") && schema.operationAction !== null && schema.operationAction !== "read") throw schemaError();
  // Presence, not truthiness: incomplete/null legacy versions never downgrade.
  if (versionKeys.some(key => own(schema, key))) {
    const { catalogVersion, schemaVersion, toolVersionId } = schema;
    const version = typeof toolVersionId === "number" ? toolVersionId
      : typeof toolVersionId === "string" && /^[1-9]\d*$/.test(toolVersionId) ? Number(toolVersionId) : NaN;
    if (!versionKeys.every(key => own(schema, key))
      || typeof catalogVersion !== "string" || !catalogVersion.trim()
      || typeof schemaVersion !== "string" || !schemaVersion.trim()
      || !Number.isSafeInteger(version) || version < 1) throw schemaError();
    if (own(schema, "inputSchema")) assertBusinessArguments(schema.inputSchema, args);
    if (own(schema, "callChain")) assertSingleSelfReadChain(schema, capability);
    return { toolName: "action", arguments: { toolId: capability, catalogVersion, schemaVersion, toolVersionId: version, params: args } };
  }
  // Observed official 2026-10 contract: explicit success + read identity + one
  // self step. operationAction is explicitly null for the observed read tools.
  if (mcp.isError !== false || provider.code !== 1 || provider.success !== true
    || !own(schema, "operationAction") || !own(schema, "inputSchema")) throw schemaError();
  assertSingleSelfReadChain(schema, capability);
  assertBusinessArguments(schema.inputSchema, args);
  return { toolName: "action", arguments: { toolId: capability, params: args } };
}
