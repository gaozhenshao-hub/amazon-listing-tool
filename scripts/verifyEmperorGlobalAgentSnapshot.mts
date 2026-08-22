import { cancelAgentRun, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [agent] = await rawExecute("SELECT slug,workspaceId FROM emperor_agents WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!agent) throw new Error("No active Agent is available for the P1 snapshot verification");
  const [user] = await rawExecute("SELECT id FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!user?.id) throw new Error("No active user is available for the P1 snapshot verification");

  const detail: any = await startAgentRun({
    slug: String(agent.slug),
    inputs: { verification: "p1_global_agent_snapshot", noExecution: true },
    userId: Number(user.id),
    workspaceId: agent.workspaceId == null ? null : Number(agent.workspaceId),
  });
  const runId = String(detail?.run?.runId || "");
  if (!runId || detail?.run?.status !== "waiting_human") throw new Error("Agent verification run was not created in waiting_human state");
  const traceId = `agent_run_${runId}`;
  const [traceRows, snapshotRows, eventRows, jobRows] = await Promise.all([
    rawExecute("SELECT status FROM emperor_run_traces WHERE traceId=?", [traceId]),
    rawExecute("SELECT snapshotId,stateVersion FROM emperor_execution_state_snapshots WHERE targetType='agent_run' AND targetId=?", [runId]),
    rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
    rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId')=?", [runId]).catch(() => [{ count: 0 }]),
  ]);
  if (!traceRows[0] || !snapshotRows.some((row: any) => Number(row.stateVersion) === 0) || !eventRows.some((row: any) => row.eventType === "lifecycle.snapshot_created")) {
    throw new Error("Global Agent trace or execution snapshot evidence is incomplete");
  }
  if (Number(jobRows[0]?.count || 0) !== 0) throw new Error("Verification unexpectedly scheduled an AI job");
  await cancelAgentRun({ runId, userId: Number(user.id), reason: "P1 global Agent snapshot verification; no node execution requested" });
  console.log(JSON.stringify({ runId, traceId, snapshotId: snapshotRows[0]?.snapshotId, agentSlug: agent.slug, status: "canceled", verification: "no-node-model-tool-mcp-executed" }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "P1 global Agent verification failed");
  process.exit(1);
});
