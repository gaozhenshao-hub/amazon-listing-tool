import { describe, expect, it } from "vitest";

import { assertLingxingMcpHealthPayload } from "./service";

describe("领星MCP连接健康响应", () => {
  it("接受正常的MCP initialize成功响应", () => {
    expect(() => assertLingxingMcpHealthPayload({
      jsonrpc: "2.0",
      id: "connection_health_check",
      result: { protocolVersion: "2025-03-26", serverInfo: { name: "lingxing-mcp" } },
    })).not.toThrow();
  });

  it("拒绝HTTP 200中承载的失效MCP Key业务错误", () => {
    expect(() => assertLingxingMcpHealthPayload({
      code: 102,
      data: null,
      msg: "MCP Key无效或已失效，请检查x-mcp-key配置",
      success: false,
    })).toThrow("lingxing_auth_failed");
  });

  it("同样拒绝SSE data中的失效密钥错误", () => {
    expect(() => assertLingxingMcpHealthPayload(
      'event: message\ndata: {"code":102,"msg":"MCP Key invalid","success":false}\n\n',
    )).toThrow("lingxing_auth_failed");
  });
});
