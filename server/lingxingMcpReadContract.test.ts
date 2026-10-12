import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => vi.fn());
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: http }));
vi.mock("./domains/ai_os/services/toolGateway/governanceCore", async importOriginal => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/toolGateway/governanceCore")>();
  return { ...actual, resolveSecretRefs: vi.fn(async value => value) };
});
import { buildLingxingActionInvocation, executeToolWithRegisteredExecutor } from "./domains/ai_os/services/toolGateway/executors";

function data(capability = "get_my_sids") {
  return {
    toolId: capability, toolType: "read", operationAction: null,
    inputSchema: { type: "object", properties: {} },
    callChain: [{ toolId: capability, sortNo: 1, parameterBindings: {} }],
  };
}
function envelope(schema: Record<string, unknown> = data(), provider: Record<string, unknown> = {}, mcp: Record<string, unknown> = {}) {
  return { content: [{ type: "text", text: JSON.stringify({ code: 1, success: true, data: schema, ...provider }) }], isError: false, ...mcp };
}
function legacy(overrides: Record<string, unknown> = {}) {
  return { toolId: "get_my_sids", toolType: "read", catalogVersion: "catalog-v3", schemaVersion: "get_my_sids-v1", toolVersionId: 153, ...overrides };
}
const productSchema = {
  ...data("query_product_performance_asin_lists"),
  inputSchema: {
    type: "object", required: ["offset", "length"], properties: {
      sids: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" },
      date_type: { type: "string", enum: ["purchase", "settlement"], default: "purchase" },
      summary_field: { type: "string", enum: ["asin", "parent_asin", "msku", "sku", "spu"] },
      date_view_type: { type: "string" }, offset: { type: "integer" }, length: { type: "integer" },
    },
  },
};
const productArgs = { sids: "1,2", offset: 0, length: 100, summary_field: "parent_asin", start_date: "2026-09-21", end_date: "2026-09-27" };

describe("strict Lingxing versioned and observed unversioned contracts", () => {
  it("uses the observed explicit-success/null-action/self-chain contract and sends only toolId + params", () => {
    expect(buildLingxingActionInvocation("get_my_sids", {}, envelope())).toEqual({ toolName: "action", arguments: { toolId: "get_my_sids", params: {} } });
    expect(buildLingxingActionInvocation("get_my_sids", {}, envelope({ ...data(), operationAction: "read" }))).toEqual({ toolName: "action", arguments: { toolId: "get_my_sids", params: {} } });
  });
  it("retains exact legacy versions without requiring newly introduced success/action fields", () => {
    expect(buildLingxingActionInvocation("get_my_sids", {}, { content: [{ type: "text", text: JSON.stringify({ data: legacy() }) }] })).toEqual({
      toolName: "action", arguments: { toolId: "get_my_sids", catalogVersion: "catalog-v3", schemaVersion: "get_my_sids-v1", toolVersionId: 153, params: {} },
    });
  });
  it("validates observed weekly report parameter types/required/enums without injecting defaults", () => {
    expect(buildLingxingActionInvocation("query_product_performance_asin_lists", productArgs, envelope(productSchema))).toEqual({
      toolName: "action", arguments: { toolId: "query_product_performance_asin_lists", params: productArgs },
    });
    for (const args of [{ sids: "1" }, { ...productArgs, length: "100" }, { ...productArgs, date_type: "delete" }, { ...productArgs, undeclared: true }]) {
      expect(() => buildLingxingActionInvocation("query_product_performance_asin_lists", args, envelope(productSchema))).toThrow("inputSchema");
    }
  });
  it("does not remove shop scope requirements for the unversioned contract", () => {
    expect(() => buildLingxingActionInvocation("query_product_performance_asin_lists", { offset: 0, length: 10 }, envelope(productSchema))).toThrow("缺少店铺");
  });
  it.each([
    { catalogVersion: "cat" }, { schemaVersion: "schema" }, { toolVersionId: 153 },
    { catalogVersion: null }, { schemaVersion: "" }, { toolVersionId: null },
    { catalogVersion: "cat", schemaVersion: "schema" },
    legacy({ toolVersionId: true }), legacy({ toolVersionId: [] }), legacy({ toolVersionId: 1.2 }),
    legacy({ toolVersionId: Number.MAX_SAFE_INTEGER + 1 }), legacy({ catalogVersion: {} }), legacy({ schemaVersion: "   " }),
  ])("rejects partial/malformed versions, never silently downgrading: %j", fields => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, envelope({ ...data(), ...fields }))).toThrow("Schema");
  });
  it("rejects version metadata misplaced on the provider wrapper", () => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, envelope(data(), { catalogVersion: "legacy" }))).toThrow("Schema");
  });
  it.each([
    undefined, null, [], {}, [{ toolId: "get_fba_stock_list", sortNo: 1, parameterBindings: {} }],
    [data().callChain[0], data().callChain[0]],
    [{ ...data().callChain[0], parameterBindings: { sid: "other-shop" } }],
    [{ ...data().callChain[0], parameterBindings: [] }],
    [{ ...data().callChain[0], children: [{ toolId: "delete_listing" }] }],
    [{ ...data().callChain[0], sortNo: "1" }],
  ])("rejects absent, ambiguous or rebound callChain: %j", callChain => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, envelope({ ...data(), callChain }))).toThrow("Schema");
  });
  it.each([
    { toolId: "other" }, { toolType: "write" }, { toolType: "READ" }, { operationAction: "delete" },
    { operationAction: undefined }, { inputSchema: null }, { inputSchema: [] },
    { inputSchema: { type: "object", properties: {}, $ref: "unresolved.json" } },
    { inputSchema: { type: "object", properties: {}, allOf: [{ required: ["hidden"] }] } },
  ])("rejects an uncorroborated new contract: %j", fields => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, envelope({ ...data(), ...fields }))).toThrow("Schema");
  });
  it.each([
    envelope(data(), {}, { isError: true }), envelope(data(), {}, { isError: undefined }),
    envelope(data(), { success: false }), envelope(data(), { success: undefined }),
    envelope(data(), { code: 102 }), envelope(data(), { code: undefined }),
    { error: { code: -1, message: "provider failed" }, result: envelope() },
  ])("rejects provider/MCP errors before valid data can mask them", value => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, value)).toThrow();
  });
  it("does not find an embedded permissive schema in examples, descriptions or extra text blocks", () => {
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, envelope({ examples: data() }))).toThrow();
    const value = envelope();
    value.content.push({ type: "text", text: JSON.stringify({ data: { toolType: "write" } }) });
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, value)).toThrow();
  });
  it("rejects writes, non-object arguments and hidden parameters", () => {
    expect(() => buildLingxingActionInvocation("delete_listing", {}, envelope())).toThrow("不在只读白名单");
    expect(() => buildLingxingActionInvocation("get_my_sids", [], envelope())).toThrow();
    expect(() => buildLingxingActionInvocation("get_my_sids", { sid: "1" }, envelope())).toThrow("inputSchema");
  });
});

function response(payload: unknown) {
  return { ok: true, status: 200, headers: { "content-type": "application/json" }, json: () => payload, text: () => JSON.stringify(payload) };
}
function run(params: unknown) {
  return executeToolWithRegisteredExecutor({
    tool: { slug: "internal.lingxing.read", name: "test", type: "internal", source: "builtin", config: {} },
    params, invocation: { toolSlug: "internal.lingxing.read", userId: 1, userRole: "super_admin", workspaceId: 1 }, resolvedSecretRefs: [],
  });
}
function sentCalls() { return http.mock.calls.map(([, options]) => JSON.parse(options.body)); }

describe("Lingxing gateway does not issue action before every guard passes", () => {
  beforeEach(() => { http.mockReset(); });
  it.each([
    envelope({ ...data(), catalogVersion: "partial" }),
    envelope({ ...data(), toolType: "write" }),
    envelope({ ...data(), operationAction: "delete" }),
    envelope({ ...data(), callChain: [{ toolId: "delete_listing", sortNo: 1, parameterBindings: {} }] }),
    envelope({ ...data(), callChain: [{ ...data().callChain[0], parameterBindings: { sid: "elsewhere" } }] }),
    envelope(data(), { success: false }), envelope(data(), {}, { isError: true }),
  ])("fails after search with zero action calls", async schema => {
    http.mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body);
      return response(request.method === "initialize" ? { result: {} } : { result: schema });
    });
    await expect(run({ capability: "get_my_sids", arguments: {} })).rejects.toThrow();
    expect(sentCalls().filter(call => call.params?.name === "search")).toHaveLength(1);
    expect(sentCalls().filter(call => call.params?.name === "action")).toHaveLength(0);
  });
  it.each([{ capability: "delete_listing", arguments: {} }, { capability: "get_fba_stock_list", arguments: {} }])("rejects writes/missing scope before even search", async request => {
    await expect(run(request)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it.each([null, false, 0, "", [], new Date()])("rejects an explicitly non-object argument before search: %j", async args => {
    await expect(run({ capability: "get_my_sids", arguments: args })).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it("rejects invalid business arguments after search without action", async () => {
    http.mockImplementation(async (_url, options) => response(JSON.parse(options.body).method === "initialize" ? { result: {} } : { result: envelope(productSchema) }));
    await expect(run({ capability: "query_product_performance_asin_lists", arguments: { ...productArgs, length: "100" } })).rejects.toThrow("inputSchema");
    expect(sentCalls().filter(call => call.params?.name === "action")).toHaveLength(0);
  });
  it("sends exactly the observed unversioned action shape with the original managed reference", async () => {
    http.mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body);
      return response(request.method === "initialize" ? { result: {} } : request.params.name === "search" ? { result: envelope() } : { result: { records: [] } });
    });
    await run({ capability: "get_my_sids", arguments: {} });
    const actions = sentCalls().filter(call => call.params?.name === "action");
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toEqual({ name: "action", arguments: { toolId: "get_my_sids", params: {} } });
    for (const [url, options] of http.mock.calls) {
      expect(String(url)).toBe("https://openmcp.lingxing.com/mcp-servers/lingxing-mcp");
      expect(options.headers["X-Mcp-Key"]).toBe("secret://integration.lingxing.mcp_key");
      expect(options.allowedHosts).toEqual(["openmcp.lingxing.com"]);
    }
  });
});
