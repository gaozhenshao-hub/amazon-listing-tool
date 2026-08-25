import { randomUUID } from "node:crypto";
import { cancelAgentRun, pauseAgentRun, resumeAgentRun, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { invalidateContextSource, recordContextSourceProvenance } from "../server/domains/ai_os/services/contextProvenance";

async function main() {
  const [agent] = await rawExecute("SELECT slug,workspaceId FROM emperor_agents WHERE status='active' ORDER BY id ASC LIMIT 1");
  const [user] = await rawExecute("SELECT id FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!agent || !user?.id) throw new Error("No active Agent/user available for invalidated-source recovery verification");
  const userId = Number(user.id);
  const sourceKey = `system_test_agent_context_${randomUUID().replace(/-/g, "")}`;
  const created: any = await startAgentRun({
    slug: String(agent.slug),
    inputs: { verification: "agent_context_source_invalidated_recovery", noExecution: true, systemTest: true },
    userId,
    workspaceId: agent.workspaceId == null ? null : Number(agent.workspaceId),
  });
  const runId = String(created?.run?.runId || "");
  if (!runId || created?.run?.status !== "waiting_human") throw new Error("Verification Agent Run was not created in waiting_human");
  const traceId = `agent_run_${runId}`;
  try {
    await recordContextSourceProvenance({
      manifestId: `system_test_agent_manifest_${randomUUID().replace(/-/g, "")}`,
      traceId,
      manifest: { context: { attachments: [{ attachmentId: sourceKey, artifactId: sourceKey, mimeType: "text/plain", contextPolicy: "summary_only" }] } },
    });
    const invalidated = await invalidateContextSource({ sourceType: "attachment", sourceKey, reason: "system_test_agent_context_source_invalidated", userId });
    if (invalidated.invalidated !== 1) throw new Error(`Expected one invalidated source, got ${invalidated.invalidated}`);
    await pauseAgentRun({ runId, userId, reason: "system_test_prepare_invalidated_resume" });
    const [paused] = await rawExecute("SELECT status,stateVersion FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]);
    const expectedStateVersion = Number(paused?.stateVersion || 0);
    let rejected = false;
    let resumeStatus: string | null = null;
    let resumeError: { code: string | null; message: string } | null = null;
    try {
      const resumed: any = await resumeAgentRun({ runId, userId, expectedStateVersion });
      resumeStatus = resumed?.run?.status || null;
    } catch (error: any) {
      resumeError = { code: error?.code || null, message: String(error?.message || "unknown") };
      rejected = error?.code === "PRECONDITION_FAILED" && String(error?.message || "").includes("关联上下文来源已失效");
    }
    const [recoveryRows, eventRows, afterRows, jobRows] = await Promise.all([
      rawExecute("SELECT status,reasonCode,expectedStateVersion FROM emperor_execution_recovery_requests WHERE targetId=? AND targetType='agent_run' ORDER BY createdAt ASC", [runId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
      rawExecute("SELECT status,stateVersion FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]),
      rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId')=?", [runId]).catch(() => [{ count: 0 }]),
    ]);
    const eventTypes = eventRows.map((row: any) => row.eventType);
    const recovery = recoveryRows.find((row: any) => row.status === "rejected" && row.reasonCode === "CONTEXT_SOURCE_INVALIDATED");
    if (!rejected || !recovery || !eventTypes.includes("context.source_invalidated") || !eventTypes.includes("lifecycle.recovery_rejected")) throw new Error(`Invalidated-source Agent recovery rejection evidence is incomplete: ${JSON.stringify({ rejected, paused, resumeStatus, resumeError, after: afterRows[0], recoveries: recoveryRows, eventTypes })}`);
    if (afterRows[0]?.status !== "paused" || Number(afterRows[0]?.stateVersion) !== expectedStateVersion || Number(jobRows[0]?.count || 0) !== 0) throw new Error("Invalidated-source Agent recovery changed state or scheduled a job");
    console.log(JSON.stringify({ runId, traceId, recovery, eventTypes, verification: "agent-context-source-invalidated-rejected-no-node-model-tool-mcp-executed" }));
  } finally {
    await cancelAgentRun({ runId, userId, reason: "system_test_cleanup_context_source_invalidated" }).catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "agent_context_source_invalidated_recovery_verification_failed"); process.exit(1); });
