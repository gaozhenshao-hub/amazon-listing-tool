import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const storeRecords = pickRecords(normalizeMcpPayload(stores.output));
  const sids = storeRecords.map((record) => String(record.sid || record.shop_id || "")).filter(Boolean).join(",");
  const mids = [...new Set(storeRecords.map((record) => String(record.mid || record.marketplace_id || record.country_id || "")).filter(Boolean))].join(",");
  if (!sids) throw new Error("No ERP store SID available");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "query_product_performance_asin_lists", arguments: { sids, ...(mids ? { mids } : {}), offset: 0, length: 50, start_date: "2026-07-01", end_date: "2026-08-22", date_range_type: 0, date_type: "purchase", date_view_type: "week", date_view_order_type: 2, summary_field: "parent_asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD", sort_field: "volume", sort_type: "desc" } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, storeCount: storeRecords.length, hasMids: Boolean(mids), rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing weekly ASIN360 product probe failed"); process.exitCode = 1; });
