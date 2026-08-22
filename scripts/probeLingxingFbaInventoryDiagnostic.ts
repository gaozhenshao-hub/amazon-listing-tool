import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

function summarize(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const message = String((parsed as any).message || "");
      return {
        code: (typeof (parsed as any).code === "string" || typeof (parsed as any).code === "number") ? (parsed as any).code : null,
        hasMessage: message.length > 0,
        parameterRelated: /参数|parameter|invalid|required/i.test(message),
      };
    }
  } catch {}
  return null;
}

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!sid) throw new Error("No authorized store scope");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const result = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_fba_stock_list", arguments: { sid, offset: 0, length: 10, sort_field: "sku", sort_type: "asc", is_cost_page: "0", fulfillment_channel_type: "FBA" } }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const raw = result.output as Record<string, unknown>;
  const text = Array.isArray(raw?.content) && typeof (raw.content[0] as Record<string, unknown>)?.text === "string" ? String((raw.content[0] as Record<string, unknown>).text) : "";
  console.log(JSON.stringify({ httpStatus: result.metadata.status, rowCount: pickRecords(normalizeMcpPayload(result.output)).length, error: summarize(text) }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "FBA diagnostic failed"); process.exitCode = 1; });
