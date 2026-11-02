import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const storesResult = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const stores = pickRecords(normalizeMcpPayload(storesResult.output)).slice(0, 10);
  let attempted = 0;
  for (const store of stores) {
    const sid = String(store?.sid || "").trim();
    if (!sid) continue;
    await sleep(1_100);
    const result = await invokeEmperorTool({
      toolSlug: "internal.lingxing.read",
      params: { capability: "query_product_performance_asin_lists", arguments: { sids: sid, offset: 0, length: 10, start_date: "2026-08-01", end_date: "2026-08-21", date_type: "purchase", date_view_type: "week", date_view_order_type: 2, summary_field: "parent_asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD" } },
      userId: 1, userRole: "super_admin", workspaceId: 1,
    });
    attempted += 1;
    const rows = pickRecords(normalizeMcpPayload(result.output));
    if (rows.length) {
      console.log(JSON.stringify({ success: true, attemptedStores: attempted, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort(), toolRunId: result.metadata.toolRunId }));
      process.exit(0);
    }
  }
  console.log(JSON.stringify({ success: true, attemptedStores: attempted, rowCount: 0, sampleFields: [] }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing cross-store product probe failed");
  process.exitCode = 1;
});
