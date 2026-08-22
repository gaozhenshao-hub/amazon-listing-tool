import { randomUUID } from "node:crypto";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { prepareSkillRunRecovery, prepareToolRunRecovery } from "../server/domains/ai_os/services/directRunRecovery";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const suffix = randomUUID().replace(/-/g, "").slice(0, 20);
const skillSlug = `system_test_conflict_skill_${suffix}`;
const toolSlug = `system_test_conflict_tool_${suffix}`;
const skillRunId = `system_test_conflict_skill_run_${suffix}`;
const toolRunId = `system_test_conflict_tool_run_${suffix}`;
const traceId = `system_test_recovery_conflict_${suffix}`;

async function main() {
  const [user] = await rawExecute("SELECT id,defaultWorkspaceId FROM users WHERE status='active' ORDER BY id ASC LIMIT 1");
  if (!user?.id) throw new Error("No active user for direct recovery conflict verification");
  const userId = Number(user.id); const workspaceId = user.defaultWorkspaceId == null ? null : Number(user.defaultWorkspaceId);
  try {
    await ensureRunTrace({ runId: traceId, rootRunType: "agent_run", workspaceId, agentSlug: "system.recovery.conflict.audit", userId, metadata: { systemTest: true, noExternalExecution: true } });
    await rawExecute("INSERT INTO emperor_skills (workspaceId,slug,name,category,owner,riskTier,status,scope,version,isSystem,manifest,execution_mode,allowed_tools) VALUES (?,?,?,'system_test','system_test','L1','Released','private',1,1,?,'inline',?)", [workspaceId, skillSlug, "SYSTEM TEST stale recovery Skill", JSON.stringify({ implementation: { sideEffect: "read", recovery: { idempotent: true, sideEffect: "read" } } }), JSON.stringify([])]);
    await rawExecute("INSERT INTO emperor_tools (workspaceId,slug,name,type,config,governancePolicy,isActive) VALUES (?,?,?,'internal',?,?,0)", [workspaceId, toolSlug, "SYSTEM TEST stale recovery Tool", JSON.stringify({ retry: { idempotent: true }, sideEffect: "read" }), JSON.stringify({ riskLevel: "low", sideEffect: "read", retry: { idempotent: true } })]);
    await rawExecute("INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,userId,input,status,errorMessage,traceId,stateVersion) VALUES (?,?,?,?,?,?,?,'failed',?,?,1)", [workspaceId, skillRunId, skillSlug, "SYSTEM TEST stale recovery Skill", 1, userId, JSON.stringify({ systemTest: true }), "system_test_failed_stale", traceId]);
    await rawExecute("INSERT INTO emperor_tool_runs (workspaceId,toolRunId,toolSlug,toolName,toolType,source,status,riskLevel,userId,input,errorMessage,retryable,attemptCount,governanceDecision) VALUES (?,?,?,?,?,?, 'failed','low',?,?,?,1,1,?)", [workspaceId, toolRunId, toolSlug, "SYSTEM TEST stale recovery Tool", "internal", "builtin", userId, JSON.stringify({ systemTest: true }), "system_test_failed_stale", JSON.stringify({ systemTest: true })]);
    const [skillResult, toolResult] = await Promise.all([
      prepareSkillRunRecovery({ runId: skillRunId, userId, workspaceId, isAdmin: true, expectedStateVersion: 0 }),
      prepareToolRunRecovery({ toolRunId, userId, workspaceId, expectedStateVersion: 0 }),
    ]);
    const [recoveries, events, executions] = await Promise.all([
      rawExecute("SELECT targetType,targetId,status,reasonCode,expectedStateVersion FROM emperor_execution_recovery_requests WHERE targetId IN (?,?) ORDER BY createdAt", [skillRunId, toolRunId]),
      rawExecute("SELECT eventType,entityType,entityId FROM emperor_run_ledger_events WHERE entityId IN (?,?) ORDER BY id", [skillRunId, toolRunId]),
      rawExecute("SELECT (SELECT COUNT(*) FROM emperor_skill_runs WHERE runId=? AND status IN ('queued','running','succeeded')) AS skillExecutions, (SELECT COUNT(*) FROM emperor_tool_runs WHERE toolRunId=? AND status IN ('running','succeeded')) AS toolExecutions", [skillRunId, toolRunId]),
    ]);
    if (skillResult.reasonCode !== "SKILL_STATE_VERSION_CONFLICT" || toolResult.reasonCode !== "TOOL_STATE_VERSION_CONFLICT") throw new Error("Stale recovery did not return version conflict reason codes");
    if (recoveries.length !== 2 || recoveries.some((row: any) => row.status !== "rejected" || !String(row.reasonCode || "").endsWith("STATE_VERSION_CONFLICT") || Number(row.expectedStateVersion) !== 0)) throw new Error("Stale recovery requests were not rejected with the requested version");
    if (![['skill_run', skillRunId], ['tool_run', toolRunId]].every(([type, id]) => events.some((event: any) => event.eventType === "lifecycle.recovery_rejected" && event.entityType === type && event.entityId === id))) throw new Error("Stale recovery Ledger evidence is incomplete");
    if (Number(executions[0]?.skillExecutions || 0) !== 0 || Number(executions[0]?.toolExecutions || 0) !== 0) throw new Error("Stale recovery conflict unexpectedly executed a capability");
    console.log(JSON.stringify({ traceId, skillRunId, toolRunId, recoveries, events, verification: "direct-skill-tool-stale-recovery-rejected-no-model-skill-tool-mcp-executed" }));
  } finally {
    await rawExecute("UPDATE emperor_skill_runs SET status='canceled',errorMessage=CONCAT(COALESCE(errorMessage,''),' | ARCHIVED_SYSTEM_TEST') WHERE runId=?", [skillRunId]).catch(() => undefined);
    await rawExecute("UPDATE emperor_tool_runs SET status='blocked',errorMessage=CONCAT(COALESCE(errorMessage,''),' | ARCHIVED_SYSTEM_TEST') WHERE toolRunId=?", [toolRunId]).catch(() => undefined);
    await rawExecute("UPDATE emperor_skills SET status='Deprecated' WHERE slug=?", [skillSlug]).catch(() => undefined);
    await rawExecute("UPDATE emperor_tools SET isActive=0 WHERE slug=?", [toolSlug]).catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "direct_recovery_version_conflict_verification_failed"); process.exit(1); });
