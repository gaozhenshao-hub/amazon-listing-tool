import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!sid) throw new Error("No ERP store SID available");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "query_product_performance_asin_lists", arguments: { sids: sid, offset: 0, length: 20, start_date: "2026-07-01", end_date: "2026-08-22", date_range_type: 0, date_type: "purchase", date_view_type: "day", date_view_order_type: 0, summary_field: "asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD", sort_field: "volume", sort_type: "desc" } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ASIN grain product probe failed"); process.exitCode = 1; });
