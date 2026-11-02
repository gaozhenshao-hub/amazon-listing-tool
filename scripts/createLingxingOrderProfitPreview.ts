import { lingxingSyncRouter, normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";
import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const stores = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: user.id, userRole: user.role, workspaceId: user.defaultWorkspaceId });
  const storeId = String(pickRecords(normalizeMcpPayload(stores.output))[0]?.sid || "");
  if (!storeId) throw new Error("No ERP store SID available");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const caller = lingxingSyncRouter.createCaller({ user, workspaceId: user.defaultWorkspaceId, requestId: "lingxing-order-profit-preview", req: { headers: {}, header: () => undefined } as any, res: { locals: { requestId: "lingxing-order-profit-preview" } } as any });
  const preview = await caller.createPreview({ dataDomain: "order_profit", scope: { storeId, startDate: "2026-07-01", endDate: "2026-08-22" } });
  console.log(JSON.stringify({ batchId: preview.batchId, totalRows: preview.totalRows, status: "ready_for_human_review_only" }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing order profit preview failed"); process.exitCode = 1; });
