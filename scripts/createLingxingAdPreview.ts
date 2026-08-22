import { lingxingSyncRouter, normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";
import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const profiles = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "ad_auth_shops", arguments: {} }, userId: user.id, userRole: user.role, workspaceId: user.defaultWorkspaceId });
  const profile = pickRecords(normalizeMcpPayload(profiles.output))[0] || {};
  const profileId = String(profile.profile_id || "");
  const storeId = String(profile.sid || profile.store_id || "");
  if (!profileId || !storeId) throw new Error("Authorized ad profile lacks profile_id or sid");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const caller = lingxingSyncRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId: "lingxing-ad-preview-verification",
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId: "lingxing-ad-preview-verification" } } as any,
  });
  const preview = await caller.createPreview({
    dataDomain: "ad_campaign",
    scope: { storeId, profileId, startDate: "2026-08-01", endDate: "2026-08-21" },
  });
  console.log(JSON.stringify({ batchId: preview.batchId, totalRows: preview.totalRows, selectedRows: preview.selectedRows, status: "ready_for_human_review_only" }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ad preview creation failed"); process.exitCode = 1; });
