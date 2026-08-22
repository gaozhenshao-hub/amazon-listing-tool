import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const storeIds = pickRecords(normalizeMcpPayload(stores.output)).map((row) => String(row.sid || "")).filter(Boolean).slice(0, 10);
  let responseSummary = { tried: 0, rows: 0, sampleFields: [] as string[], status: 0 };
  for (const storeId of storeIds) {
    await delay(1_100);
    const result = await invokeEmperorTool({
      toolSlug: "internal.lingxing.read",
      params: { capability: "query_product_performance_asin_lists", arguments: { sids: storeId, offset: 0, length: 20, summary_field: "parent_asin", summary_field_level1: "parent_asin", turn_on_summary: 1, date_view_type: "week", date_view_order_type: 2, is_recently_enum: true, sort_field: "volume", sort_type: "desc", query_order_profit: true, currency_code: "USD" } },
      userId: 1, userRole: "super_admin", workspaceId: 1,
    });
    const rows = pickRecords(normalizeMcpPayload(result.output));
    responseSummary = { tried: responseSummary.tried + 1, rows: rows.length, sampleFields: Object.keys(rows[0] || {}).sort(), status: Number(result.metadata.status || 0) };
    if (rows.length) break;
  }
  console.log(JSON.stringify(responseSummary));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Product default-range probe failed"); process.exitCode = 1; });
