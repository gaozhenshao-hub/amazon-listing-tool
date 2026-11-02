import { rawExecute } from "../server/domains/ai_os/routerContext";

const config = {
  executor: "mcp_http",
  mcpEndpoint: process.env.LINGXING_MCP_ENDPOINT || "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp",
  headers: { "X-Mcp-Key": "env:LINGXING_MCP_KEY" },
  allowedHosts: ["openmcp.lingxing.com"],
  timeoutMs: 30_000,
  maxResponseBytes: 2_097_152,
  initializeBeforeCall: true,
  protocolVersion: "2025-03-26",
  requireShopScope: true,
  shopScopeKeys: ["shop_id", "shopId", "sid", "profile_id", "profileId"],
  scopeExemptTools: ["get_my_sids"],
  allowedTools: [
    "query_product_performance_asin_lists",
    "get_fba_stock_list",
    "query_order_profit_list",
    "get_my_sids",
    "erp_listing",
    "query_erp_keyword_ranking_keyword",
    "ad_campaign_report",
    "ad_campaign_keyword_report",
  ],
  rateLimitPolicy: { scope: "tool", perSecond: 1, perMinute: 60, concurrency: 1 },
};

const governancePolicy = {
  readOnly: true,
  requireShopScope: true,
  allowedTools: config.allowedTools,
};

async function main() {
  await rawExecute(
    `INSERT INTO emperor_mcp_connectors
       (workspaceId,slug,name,description,connectionType,config,governancePolicy,secretRefs,isActive)
     VALUES (?,?,?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name),description=VALUES(description),connectionType=VALUES(connectionType),
       config=VALUES(config),governancePolicy=VALUES(governancePolicy),secretRefs=VALUES(secretRefs),
       isActive=1,updatedAt=NOW()`,
    [
      null,
      "lingxing-mcp",
      "领星MCP只读数据源",
      "通过领星官方MCP仅查询产品表现、FBA库存、订单利润、Listing、关键词与广告报表；限定工具白名单、店铺范围和QPS=1。",
      "http_api",
      JSON.stringify(config),
      JSON.stringify(governancePolicy),
      JSON.stringify(["env:LINGXING_MCP_KEY"]),
    ],
  );
  console.log(JSON.stringify({ slug: "lingxing-mcp", active: true, allowedToolCount: config.allowedTools.length, qps: 1 }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing MCP connector registration failed");
  process.exitCode = 1;
});
