import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";

async function main() {
  if (!process.env.LINGXING_MCP_KEY) {
    throw new Error("LINGXING_MCP_KEY is required for the live LingXing MCP verification");
  }
  const toolSlug = process.argv[2] || "internal.lingxing.read";

  const result = await invokeEmperorTool({
    toolSlug,
    params: {
      capability: "get_my_sids",
      arguments: {},
    },
    userId: 1,
    userRole: "super_admin",
    workspaceId: 1,
  });

  console.log(JSON.stringify({
    success: result.success,
    toolSlug,
    toolRunId: result.metadata.toolRunId,
    httpStatus: result.metadata.status,
    requestHost: result.metadata.requestHost,
    outputType: Array.isArray(result.output) ? "array" : typeof result.output,
  }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing MCP verification failed");
  process.exitCode = 1;
});
