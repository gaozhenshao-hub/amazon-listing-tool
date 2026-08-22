import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const profiles = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "ad_auth_shops", arguments: {} }, userId: 1, userRole: "super_admin", workspaceId: 1 });
  const profileId = String(pickRecords(normalizeMcpPayload(profiles.output))[0]?.profile_id || "");
  if (!profileId) throw new Error("No authorized ad profile");
  await wait(1_100);
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "ad_campaign_report", arguments: { profile_ids: [profileId], report_date: "2026-08-01 - 2026-08-21", page: 1, length: 20, sort_field: "spends", sort_type: "desc" } },
    userId: 1, userRole: "super_admin", workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, rowCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ad campaign probe failed"); process.exitCode = 1; });
