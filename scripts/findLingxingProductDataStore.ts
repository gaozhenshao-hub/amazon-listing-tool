import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sids = pickRecords(normalizeMcpPayload(stores.output)).map((record) => String(record.sid || record.shop_id || "")).filter(Boolean).slice(0, 43);
  for (let index = 0; index < sids.length; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const result = await invokeEmperorTool({
      toolSlug: "internal.lingxing.read",
      params: { capability: "query_product_performance_asin_lists", arguments: { sids: sids[index], offset: 0, length: 20, summary_field: "asin", turn_on_summary: 1, sort_field: "volume", sort_type: "desc", currency_code: "USD" } },
      userId: 1, userRole: "super_admin", workspaceId: 1,
    });
    const rows = pickRecords(normalizeMcpPayload(result.output));
    if (rows.length) {
      console.log(JSON.stringify({ found: true, storeIndex: index + 1, rowCount: rows.length, sampleFields: Object.keys(rows[0]).sort() }));
      process.exit(0);
    }
  }
  console.log(JSON.stringify({ found: false, storesChecked: sids.length }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "LingXing product data store scan failed"); process.exitCode = 1; });
