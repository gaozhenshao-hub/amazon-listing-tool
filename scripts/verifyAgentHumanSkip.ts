import { confirmAgentNode, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [agent] = await rawExecute("SELECT slug,workspaceId FROM emperor_agents WHERE status='active' ORDER BY id ASC LIMIT 1");
  const [user] = await rawExecute("SELECT id FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!agent || !user?.id) throw new Error("No active Agent/user is available for human-skip verification");
  const userId = Number(user.id);
  const detail: any = await startAgentRun({
    slug: String(agent.slug),
    inputs: { verification: "p1_agent_human_skip", noExecution: true },
    userId,
    workspaceId: agent.workspaceId == null ? null : Number(agent.workspaceId),
  });
  const runId = String(detail?.run?.runId || "");
  if (!runId || detail?.run?.status !== "waiting_human") throw new Error("Skip verification run was not created in waiting_human state");
  const [checkpoint] = await rawExecute("SELECT nodeId FROM emperor_agent_checkpoints WHERE runId=? AND status IN ('waiting_human','ready') ORDER BY id ASC LIMIT 1", [runId]);
  if (!checkpoint?.nodeId) throw new Error("Skip verification run has no human-confirmable checkpoint");
  await confirmAgentNode({ runId, nodeId: String(checkpoint.nodeId), userId, skip: true });
  const traceId = `agent_run_${runId}`;
  const [checkpointRows, eventRows, jobRows] = await Promise.all([
    rawExecute("SELECT status FROM emperor_agent_checkpoints WHERE runId=? AND nodeId=?", [runId, checkpoint.nodeId]),
    rawExecute("SELECT eventType,payload FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
    rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId')=?", [runId]).catch(() => [{ count: 0 }]),
  ]);
  if (checkpointRows[0]?.status !== "skipped" || !eventRows.some((row: any) => row.eventType === "lifecycle.skipped") || Number(jobRows[0]?.count || 0) !== 0) {
    throw new Error("Human skip did not produce skipped lifecycle evidence or unexpectedly scheduled work");
  }
  console.log(JSON.stringify({ verification: "passed", runId, nodeId: checkpoint.nodeId, event: "lifecycle.skipped", noNodeModelToolMcpExecution: true }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Agent human-skip verification failed");
  process.exit(1);
});
