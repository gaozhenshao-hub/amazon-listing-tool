import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  if (!process.env.LINGXING_MCP_KEY) throw new Error("LINGXING_MCP_KEY is not configured");
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const firstStore = pickRecords(normalizeMcpPayload(stores.output))[0];
  const sid = firstStore?.sid;
  if (!sid) throw new Error("No readable LingXing store scope was returned");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "query_product_performance_asin_lists", arguments: { sids: String(sid), offset: 0, length: 10, start_date: "2026-08-15", end_date: "2026-08-21", date_type: "purchase", date_view_type: "week", date_view_order_type: 2, summary_field: "parent_asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD" } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ success: result.success, httpStatus: result.metadata.status, toolRunId: result.metadata.toolRunId, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing product performance probe failed");
  process.exitCode = 1;
});
