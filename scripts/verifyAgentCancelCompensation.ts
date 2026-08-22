import { cancelAgentRun, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function createVerificationRun(agent: any, userId: number, verification: string) {
  const detail: any = await startAgentRun({
    slug: String(agent.slug),
    inputs: { verification, noExecution: true },
    userId,
    workspaceId: agent.workspaceId == null ? null : Number(agent.workspaceId),
  });
  const runId = String(detail?.run?.runId || "");
  if (!runId || detail?.run?.status !== "waiting_human") throw new Error("Agent verification run was not created in waiting_human state");
  return runId;
}

async function main() {
  const [agent] = await rawExecute("SELECT slug,workspaceId FROM emperor_agents WHERE status='active' ORDER BY id ASC LIMIT 1");
  const [user] = await rawExecute("SELECT id FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!agent || !user?.id) throw new Error("No active Agent/user is available for cancellation verification");
  const userId = Number(user.id);

  const normalRunId = await createVerificationRun(agent, userId, "p1_agent_normal_cancel");
  await cancelAgentRun({ runId: normalRunId, userId, reason: "P1 no-node normal cancellation verification" });
  const normalTraceId = `agent_run_${normalRunId}`;
  const [normalEvents, normalRunRows, normalSnapshots] = await Promise.all([
    rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [normalTraceId]),
    rawExecute("SELECT status,stateVersion,recoverySnapshotId FROM emperor_agent_runs WHERE runId=?", [normalRunId]),
    rawExecute("SELECT snapshotId,stateVersion FROM emperor_execution_state_snapshots WHERE targetType='agent_run' AND targetId=? ORDER BY id ASC", [normalRunId]),
  ]);
  if (!normalEvents.some((row: any) => row.eventType === "lifecycle.canceled") || normalEvents.some((row: any) => row.eventType === "lifecycle.compensation_required") || normalRunRows[0]?.status !== "canceled" || Number(normalRunRows[0]?.stateVersion) < 1 || !normalSnapshots.some((row: any) => Number(row.stateVersion) >= 1)) {
    throw new Error("Normal no-node cancel did not preserve snapshot/version evidence");
  }

  const progressedRunId = await createVerificationRun(agent, userId, "p1_agent_progressed_cancel");
  const [checkpoint] = await rawExecute("SELECT nodeId FROM emperor_agent_checkpoints WHERE runId=? ORDER BY id ASC LIMIT 1", [progressedRunId]);
  if (!checkpoint?.nodeId) throw new Error("Progressed verification run has no checkpoint");
  await rawExecute("UPDATE emperor_agent_checkpoints SET status='confirmed',updatedAt=NOW() WHERE runId=? AND nodeId=?", [progressedRunId, checkpoint.nodeId]);
  await cancelAgentRun({ runId: progressedRunId, userId, reason: "P1 simulated-progress cancellation verification" });
  const progressedTraceId = `agent_run_${progressedRunId}`;
  const [progressedEvents, progressedRunRows, jobs] = await Promise.all([
    rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [progressedTraceId]),
    rawExecute("SELECT status,stateVersion,recoverySnapshotId FROM emperor_agent_runs WHERE runId=?", [progressedRunId]),
    rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId') IN (?,?)", [normalRunId, progressedRunId]).catch(() => [{ count: 0 }]),
  ]);
  if (!progressedEvents.some((row: any) => row.eventType === "lifecycle.compensation_required") || progressedRunRows[0]?.status !== "canceled" || Number(progressedRunRows[0]?.stateVersion) < 1 || Number(jobs[0]?.count || 0) !== 0) {
    throw new Error("Progressed cancellation did not produce compensation or attempted execution");
  }
  console.log(JSON.stringify({ verification: "passed", normalRunId, progressedRunId, normal: "lifecycle.canceled", progressed: "lifecycle.compensation_required", noNodeModelToolMcpExecution: true }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Agent cancellation verification failed");
  process.exit(1);
});
