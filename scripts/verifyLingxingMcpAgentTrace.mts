import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { ensureAgentRunTrace } from "../server/domains/ai_os/services/runLedger";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  if (!process.env.LINGXING_MCP_KEY) {
    throw new Error("LINGXING_MCP_KEY is required for the live LingXing MCP trace verification");
  }

  const runId = `lingxing_mcp_verify_${Date.now()}`;
  const nodeId = "lingxing_mcp_readonly_verification";
  await ensureAgentRunTrace({
    runId,
    workspaceId: 1,
    agentSlug: "system.lingxing_mcp_verification",
    userId: 1,
    metadata: { purpose: "read_only_mcp_trace_verification" },
  });

  const result = await invokeEmperorTool({
    toolSlug: "mcp.lingxing-mcp",
    params: { capability: "get_my_sids", arguments: {} },
    userId: 1,
    userRole: "super_admin",
    workspaceId: 1,
    runId,
    nodeId,
  });
  const rows = await rawExecute(
    `SELECT eventType FROM emperor_run_ledger_events
     WHERE traceId=? AND toolSlug='mcp.lingxing-mcp'
     ORDER BY createdAt ASC`,
    [runId],
  );
  const events = rows.map((row: any) => String(row.eventType));
  if (!events.includes("tool.lingxing_mcp.start") || !events.includes("tool.lingxing_mcp.success")) {
    throw new Error("Expected LingXing MCP start and success ledger events were not recorded");
  }
  await rawExecute(
    "UPDATE emperor_run_traces SET status='succeeded',completedAt=NOW(),updatedAt=NOW() WHERE traceId=?",
    [runId],
  );

  console.log(JSON.stringify({
    success: result.success,
    traceId: runId,
    toolRunId: result.metadata.toolRunId,
    httpStatus: result.metadata.status,
    eventTypes: events,
  }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing MCP Trace verification failed");
  process.exitCode = 1;
});
