import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!sid) throw new Error("No ERP store SID available");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "query_order_profit_list", arguments: { sids: sid, start_date: "2026-07-01", end_date: "2026-08-22", currency_type: "USD", external_service_mark: 1, source_service: "mcp", length: "20", offset: "0", sort_type: "desc", turn_on_summary: "1", search_type: 0, search_field: "parent_asin", summary_field: "parent_asin", date_summary_type: 2, query_order_gross_first: true } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing order profit probe failed"); process.exitCode = 1; });
