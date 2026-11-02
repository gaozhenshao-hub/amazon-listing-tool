import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

async function main() {
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "ad_auth_shops", arguments: {} },
    userId: 1,
    userRole: "super_admin",
    workspaceId: 1,
  });
  const rows = pickRecords(normalizeMcpPayload(result.output));
  console.log(JSON.stringify({ httpStatus: result.metadata.status, profileCount: rows.length, sampleFields: Object.keys(rows[0] || {}).sort() }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ad profile verification failed"); process.exitCode = 1; });
