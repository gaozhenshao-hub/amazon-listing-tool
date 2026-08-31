import { describe, expect, it } from "vitest";
import { buildLingxingActionInvocation, unwrapLingxingMcpEnvelope } from "./domains/ai_os/services/toolGateway/executors";

describe("领星MCP新版action协议适配", () => {
  const schema = {
    content: [{ type: "text", text: JSON.stringify({ data: { toolId: "get_my_sids", catalogVersion: "catalog-v3", schemaVersion: "get_my_sids-v1", toolType: "read" } }) }],
  };

  it("解析JSON-RPC文本封装中的官方Schema", () => {
    expect(unwrapLingxingMcpEnvelope(schema)).toMatchObject({ toolId: "get_my_sids", catalogVersion: "catalog-v3", schemaVersion: "get_my_sids-v1" });
  });

  it("只为白名单只读能力构造action请求", () => {
    expect(buildLingxingActionInvocation("get_my_sids", {}, schema)).toEqual({
      toolName: "action",
      arguments: { toolId: "get_my_sids", catalogVersion: "catalog-v3", schemaVersion: "get_my_sids-v1", paramsJson: "{}" },
    });
  });

  it("拒绝写能力和缺失店铺范围的读取能力", () => {
    expect(() => buildLingxingActionInvocation("add_custom_indicator", {}, schema)).toThrow("不在只读白名单");
    expect(() => buildLingxingActionInvocation("get_fba_stock_list", {}, { data: { toolId: "get_fba_stock_list", catalogVersion: "catalog-v3", schemaVersion: "stock-v1", toolType: "read" } })).toThrow("缺少店铺或广告Profile范围");
  });
});
