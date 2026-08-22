import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!sid) throw new Error("No ERP store SID available");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_fba_stock_list", arguments: { sid, offset: 0, length: 20, sort_field: "sku", sort_type: "asc", is_cost_page: "0", is_hide_zero_stock: 0, is_parant_asin_merge: "1" } }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing inventory channel probe failed"); process.exitCode = 1; });
