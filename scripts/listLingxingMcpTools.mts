import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload } from "../server/routers/lingxingSync";

const approved = new Set(["query_product_performance_asin_lists", "get_fba_stock_list", "query_order_profit_list", "get_my_sids", "erp_listing", "query_erp_keyword_ranking_keyword", "ad_campaign_report", "ad_campaign_keyword_report"]);

async function main() {
  if (!process.env.LINGXING_MCP_KEY) throw new Error("LINGXING_MCP_KEY is not configured");
  const result = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { method: "tools/list" }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const normalized = normalizeMcpPayload(result.output) as any;
  const tools = (normalized?.tools || normalized?.result?.tools || [])
    .filter((tool: any) => approved.has(String(tool?.name || "")))
    .map((tool: any) => ({ name: tool.name, inputFields: Object.keys(tool?.inputSchema?.properties || {}).sort(), required: tool?.inputSchema?.required || [] }));
  console.log(JSON.stringify({ success: result.success, httpStatus: result.metadata.status, toolCount: tools.length, tools }));
  process.exit(0);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "LingXing tools/list failed"); process.exitCode = 1; });
