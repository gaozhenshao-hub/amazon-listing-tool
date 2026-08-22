import { cancelAgentRun, pauseAgentRun, resumeAgentRun, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [agent] = await rawExecute("SELECT slug,workspaceId FROM emperor_agents WHERE status='active' ORDER BY id ASC LIMIT 1");
  const [user] = await rawExecute("SELECT id FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!agent || !user?.id) throw new Error("No active Agent/user available for recovery conflict verification");
  const userId = Number(user.id);
  const created: any = await startAgentRun({
    slug: String(agent.slug),
    inputs: { verification: "agent_recovery_state_version_conflict", noExecution: true, systemTest: true },
    userId,
    workspaceId: agent.workspaceId == null ? null : Number(agent.workspaceId),
  });
  const runId = String(created?.run?.runId || "");
  if (!runId || created?.run?.status !== "waiting_human") throw new Error("Verification Agent Run was not created in waiting_human");
  const traceId = `agent_run_${runId}`;
  try {
    await pauseAgentRun({ runId, userId, reason: "system_test_prepare_stale_resume" });
    const [paused] = await rawExecute("SELECT stateVersion FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]);
    const expectedStateVersion = Number(paused?.stateVersion || 0);
    await rawExecute("UPDATE emperor_agent_runs SET stateVersion=stateVersion+1 WHERE runId=? AND status='paused'", [runId]);
    const recoveries = await Promise.allSettled([resumeAgentRun({ runId, userId, expectedStateVersion })]);
    const [recoveryRows, eventRows, jobRows] = await Promise.all([
      rawExecute("SELECT status,reasonCode,expectedStateVersion FROM emperor_execution_recovery_requests WHERE targetId=? AND targetType='agent_run' ORDER BY createdAt ASC", [runId]),
      rawExecute("SELECT eventType,payload FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
      rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId')=?", [runId]).catch(() => [{ count: 0 }]),
    ]);
    const eventTypes = eventRows.map((row: any) => row.eventType);
    const conflict = recoveryRows.find((row: any) => row.reasonCode === "AGENT_STATE_VERSION_CONFLICT" && row.status === "compensation_required");
    if (!conflict || !eventTypes.includes("lifecycle.recovery_rejected") || !eventTypes.includes("lifecycle.compensation_required")) {
      throw new Error(`Expected stale recovery rejection evidence is missing; outcomes=${recoveries.map((result) => result.status).join(",")}`);
    }
    if (Number(jobRows[0]?.count || 0) !== 0) throw new Error("Recovery conflict verification unexpectedly scheduled an AI job");
    console.log(JSON.stringify({ runId, traceId, recoveryOutcomes: recoveries.map((result) => result.status), recovery: conflict, eventTypes, verification: "agent-stale-recovery-rejected-no-node-model-tool-mcp-executed" }));
  } finally {
    await cancelAgentRun({ runId, userId, reason: "system_test_cleanup_recovery_conflict" }).catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "agent_recovery_conflict_verification_failed");
  process.exit(1);
});
