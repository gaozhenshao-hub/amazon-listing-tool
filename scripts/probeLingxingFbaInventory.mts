import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  if (!process.env.LINGXING_MCP_KEY) throw new Error("LINGXING_MCP_KEY is not configured");
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = pickRecords(normalizeMcpPayload(stores.output))[0]?.sid;
  if (!sid) throw new Error("No readable LingXing store scope was returned");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_fba_stock_list", arguments: { sid: String(sid), offset: 0, length: 10, sort_field: "sku", sort_type: "asc", is_cost_page: "0", fulfillment_channel_type: "FBA" } }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  const raw = result.output as Record<string, unknown>;
  const text = Array.isArray(raw?.content) && typeof (raw.content[0] as Record<string, unknown>)?.text === "string" ? String((raw.content[0] as Record<string, unknown>).text) : "";
  console.log(JSON.stringify({ success: result.success, httpStatus: result.metadata.status, toolRunId: result.metadata.toolRunId, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort(), textEnvelope: { lineCount: text.split(/\r?\n/).length, labels: [...new Set(text.split(/\r?\n/).map((line) => line.match(/^\s*(?:[-*•\d.、]+\s*)?([^:：]{1,30})[:：]/)?.[1]?.trim()).filter(Boolean))].slice(0, 40) } }));
  process.exit(0);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "LingXing FBA inventory probe failed"); process.exitCode = 1; });
