import { describe, expect, it } from "vitest";
import { buildLingxingActionInvocation } from "./domains/ai_os/services/toolGateway/executors";

const schemaEnvelope = {
  content: [{
    type: "text",
    text: JSON.stringify({
      code: 1,
      data: {
        toolId: "get_my_sids",
        catalogVersion: "lingxing-mcp-20260904-v1",
        schemaVersion: "get_my_sids-v1",
        toolVersionId: 153,
        toolType: "read",
      },
    }),
  }],
};

describe("领星MCP新版search→action协议", () => {
  it("传递不可变工具版本和对象型空参数，支持无范围的店铺目录读取", () => {
    expect(buildLingxingActionInvocation("get_my_sids", {}, schemaEnvelope)).toEqual({
      toolName: "action",
      arguments: {
        toolId: "get_my_sids",
        catalogVersion: "lingxing-mcp-20260904-v1",
        schemaVersion: "get_my_sids-v1",
        toolVersionId: 153,
        params: {},
      },
    });
  });

  it("拒绝缺少不可变工具版本的Schema，保持失败关闭", () => {
    const withoutVersion = { content: [{ type: "text", text: JSON.stringify({ code: 1, data: { ...JSON.parse(schemaEnvelope.content[0].text).data, toolVersionId: null } }) }] };
    expect(() => buildLingxingActionInvocation("get_my_sids", {}, withoutVersion)).toThrow("最新只读Schema无效或不匹配");
  });
});
