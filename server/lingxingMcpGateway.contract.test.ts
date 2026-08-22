import { describe, expect, it } from "vitest";
import { invokeMcpHttpTool } from "./domains/ai_os/services/toolGateway/executors";

const connector = {
  slug: "internal.lingxing.read",
  name: "领星官方MCP只读数据源",
  type: "mcp" as const,
  config: {
    mcpEndpoint: "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp",
    allowedHosts: ["openmcp.lingxing.com"],
    allowedTools: ["get_fba_stock_list"],
    requireShopScope: true,
    shopScopeKeys: ["sid", "sids", "profile_ids"],
    allowToolDiscovery: true,
  },
};

describe("领星MCP Tool Gateway只读治理", () => {
  it("在网络调用前拒绝白名单外的写入工具", async () => {
    await expect(invokeMcpHttpTool(connector, { capability: "post_keywords", arguments: { sid: "1" } })).rejects.toThrow("read-only allowlist");
  });

  it("对库存查询强制要求官方店铺范围参数", async () => {
    await expect(invokeMcpHttpTool(connector, { capability: "get_fba_stock_list", arguments: {} })).rejects.toThrow("requires at least one shop scope parameter");
  });

  it("只在明确允许时放行无副作用的工具目录发现", async () => {
    await expect(invokeMcpHttpTool(connector, { method: "tools/list" })).rejects.toThrow("Safe HTTP blocked a real network request in the test environment");
  });

  it("广告授权Profile目录属于无副作用发现能力，可在不传业务店铺范围时读取", async () => {
    const adProfileDiscoveryConnector = {
      ...connector,
      config: {
        ...connector.config,
        allowedTools: ["ad_auth_shops"],
        scopeExemptTools: ["ad_auth_shops"],
      },
    };
    await expect(invokeMcpHttpTool(adProfileDiscoveryConnector, { capability: "ad_auth_shops", arguments: {} })).rejects.toThrow("Safe HTTP blocked a real network request in the test environment");
  });
});
