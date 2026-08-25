import { randomUUID } from "node:crypto";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { prepareSkillRunRecovery, prepareToolRunRecovery } from "../server/domains/ai_os/services/directRunRecovery";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const suffix = randomUUID().replace(/-/g, "").slice(0, 20);
const skillSlug = `system_test_recovery_read_skill_${suffix}`;
const toolSlug = `system_test_recovery_read_tool_${suffix}`;
const skillRunId = `system_test_read_skill_run_${suffix}`;
const toolRunId = `system_test_read_tool_run_${suffix}`;
const traceId = `system_test_recovery_prepare_${suffix}`;

async function main() {
  const [user] = await rawExecute("SELECT id,defaultWorkspaceId FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!user?.id) throw new Error("No active user available for direct recovery preparation verification");
  const userId = Number(user.id);
  const workspaceId = user.defaultWorkspaceId == null ? null : Number(user.defaultWorkspaceId);
  try {
    await ensureRunTrace({ runId: traceId, rootRunType: "agent_run", workspaceId, agentSlug: "system.recovery.prepare.audit", userId, metadata: { systemTest: true, noExternalExecution: true } });
    await rawExecute(
      `INSERT INTO emperor_skills (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,manifest,execution_mode,allowed_tools,disallowed_tools)
       VALUES (?,?,?,?,?,'system_test','L1','Released','private',1,1,?,'inline',?,?)`,
      [workspaceId, skillSlug, "SYSTEM TEST read-only recovery Skill", "Temporary audit-only skill; no execution permitted.", "system_test", JSON.stringify({ implementation: { sideEffect: "read", recovery: { idempotent: true, sideEffect: "read" } } }), JSON.stringify([]), JSON.stringify(["*"])],
    );
    await rawExecute(
      `INSERT INTO emperor_tools (workspaceId,slug,name,description,type,config,governancePolicy,permissionPolicy,isActive)
       VALUES (?,?,?,?, 'internal', ?,?,?,0)`,
      [workspaceId, toolSlug, "SYSTEM TEST read-only recovery Tool", "Temporary audit-only tool; never executable.", JSON.stringify({ retry: { idempotent: true }, sideEffect: "read", systemTest: true, noExternalExecution: true }), JSON.stringify({ riskLevel: "low", sideEffect: "read", retry: { idempotent: true } }), JSON.stringify({ systemTest: true })],
    );
    await rawExecute(
      `INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,userId,input,status,errorMessage,traceId)
       VALUES (?,?,?,?,?,?,?,'failed',?,?)`,
      [workspaceId, skillRunId, skillSlug, "SYSTEM TEST read-only recovery Skill", 1, userId, JSON.stringify({ systemTest: true, noExternalExecution: true }), "system_test_failed_read_only; do not execute", traceId],
    );
    await rawExecute(
      `INSERT INTO emperor_tool_runs (workspaceId,toolRunId,toolSlug,toolName,toolType,source,status,riskLevel,userId,input,errorMessage,retryable,attemptCount,governanceDecision)
       VALUES (?,?,?,?,?,?, 'failed','low',?,?,?,1,0,?)`,
      [workspaceId, toolRunId, toolSlug, "SYSTEM TEST read-only recovery Tool", "internal", "builtin", userId, JSON.stringify({ systemTest: true, noExternalExecution: true }), "system_test_failed_read_only; do not execute", JSON.stringify({ systemTest: true, noExternalExecution: true })],
    );
    const [skillResult, toolResult] = await Promise.all([
      prepareSkillRunRecovery({ runId: skillRunId, userId, workspaceId, isAdmin: true }),
      prepareToolRunRecovery({ toolRunId, userId, workspaceId }),
    ]);
    const [recoveries, events, executions] = await Promise.all([
      rawExecute("SELECT targetType,targetId,status,reasonCode,requestedAction FROM emperor_execution_recovery_requests WHERE targetId IN (?,?) ORDER BY createdAt", [skillRunId, toolRunId]),
      rawExecute("SELECT eventType,entityType,entityId FROM emperor_run_ledger_events WHERE entityId IN (?,?) ORDER BY id", [skillRunId, toolRunId]),
      rawExecute("SELECT (SELECT COUNT(*) FROM emperor_skill_runs WHERE runId=? AND status IN ('queued','running','succeeded')) AS skillExecutions, (SELECT COUNT(*) FROM emperor_tool_runs WHERE toolRunId=? AND status IN ('running','succeeded')) AS toolExecutions", [skillRunId, toolRunId]),
    ]);
    if (!skillResult.allowed || !toolResult.allowed || !skillResult.manualExecutionRequired || !toolResult.manualExecutionRequired) throw new Error("Low-risk read-only runs were not limited to manual recovery preparation");
    if (recoveries.length !== 2 || recoveries.some((row: any) => row.status !== "requested" || row.reasonCode !== null || row.requestedAction !== "manual_recovery_prepare")) throw new Error(`Recovery preparation requests are not requested/manual-only: ${JSON.stringify(recoveries)}`);
    const requiredEvents = [["skill_run", skillRunId], ["tool_run", toolRunId]];
    if (!requiredEvents.every(([entityType, entityId]) => events.some((event: any) => event.eventType === "lifecycle.recovery_requested" && event.entityType === entityType && event.entityId === entityId))) throw new Error(`Recovery preparation Ledger evidence is incomplete: ${JSON.stringify(events)}`);
    if (Number(executions[0]?.skillExecutions || 0) !== 0 || Number(executions[0]?.toolExecutions || 0) !== 0) throw new Error("Recovery preparation unexpectedly executed a Skill or Tool");
    console.log(JSON.stringify({ traceId, skillRunId, toolRunId, recoveries, events, verification: "low-risk-read-only-manual-recovery-prepare-no-model-skill-tool-mcp-executed" }));
  } finally {
    await rawExecute("UPDATE emperor_skill_runs SET status='canceled',errorMessage=CONCAT(COALESCE(errorMessage,''),' | ARCHIVED_SYSTEM_TEST') WHERE runId=?", [skillRunId]).catch(() => undefined);
    await rawExecute("UPDATE emperor_tool_runs SET status='blocked',errorMessage=CONCAT(COALESCE(errorMessage,''),' | ARCHIVED_SYSTEM_TEST') WHERE toolRunId=?", [toolRunId]).catch(() => undefined);
    await rawExecute("UPDATE emperor_skills SET status='Deprecated',description='Archived system-test definition; no execution occurred.' WHERE slug=?", [skillSlug]).catch(() => undefined);
    await rawExecute("UPDATE emperor_tools SET isActive=0,description='Archived system-test definition; no execution occurred.' WHERE slug=?", [toolSlug]).catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "direct_run_recovery_prepare_verification_failed");
  process.exit(1);
});
