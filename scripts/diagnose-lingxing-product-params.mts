import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const classify = (value: unknown) => {
  const text = JSON.stringify(value);
  return {
    length: text.length,
    hasParameterHint: /参数|parameter|invalid|required/i.test(text),
    hasDateHint: /日期|date|时间/i.test(text),
    hasPermissionHint: /权限|permission|授权/i.test(text),
  };
};

async function call(sid: string, sids: string | string[]) {
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "query_product_performance_asin_lists", arguments: { sids, offset: 0, length: 10, start_date: "2026-08-01", end_date: "2026-08-21", date_type: "purchase", date_view_type: "week", date_view_order_type: 2, summary_field: "parent_asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD" } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  return { rows: pickRecords(normalizeMcpPayload(result.output)).length, status: result.metadata.status, envelope: classify(result.output) };
}

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const sid = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!sid) throw new Error("No authorized store scope");
  await sleep(1_100);
  const stringForm = await call(sid, sid);
  await sleep(1_100);
  const arrayForm = await call(sid, [sid]);
  console.log(JSON.stringify({ stringForm, arrayForm }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Product parameter diagnostic failed"); process.exitCode = 1; });
