import { rawExecute } from "../server/domains/ai_os/routerContext";

const allowedTools = [
  "query_product_performance_asin_lists",
  "get_fba_stock_list",
  "query_order_profit_list",
  "get_my_sids",
  "ad_auth_shops",
  "erp_listing",
  "query_erp_keyword_ranking_keyword",
  "ad_campaign_report",
  "ad_campaign_keyword_report",
];

async function main() {
  const policy = JSON.stringify({ readOnly: true, requireShopScope: true, allowedTools });
  const config = JSON.stringify({ allowedTools, scopeExemptTools: ["get_my_sids", "ad_auth_shops"] });
  await rawExecute(
    `UPDATE emperor_mcp_connectors
     SET config = JSON_MERGE_PATCH(config, CAST(? AS JSON)),
         governancePolicy = JSON_MERGE_PATCH(governancePolicy, CAST(? AS JSON)),
         updatedAt = NOW()
     WHERE slug = 'lingxing-mcp'`,
    [config, policy],
  );
  console.log(JSON.stringify({ slug: "lingxing-mcp", allowedToolCount: allowedTools.length, hasAdProfileDiscovery: true }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing MCP policy update failed");
  process.exitCode = 1;
});
