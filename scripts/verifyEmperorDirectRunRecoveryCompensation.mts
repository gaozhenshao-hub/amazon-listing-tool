import { randomUUID } from "node:crypto";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { prepareSkillRunRecovery, prepareToolRunRecovery } from "../server/domains/ai_os/services/directRunRecovery";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const rows = <T = Record<string, any>>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

async function main() {
  const [user] = rows(await rawExecute("SELECT id,defaultWorkspaceId FROM users WHERE status='active' ORDER BY id LIMIT 1"));
  const [skill] = rows(await rawExecute("SELECT slug FROM emperor_skills ORDER BY id LIMIT 1"));
  const [tool] = rows(await rawExecute("SELECT slug,name,type FROM emperor_tools ORDER BY id LIMIT 1"));
  if (!user || !skill || !tool) throw new Error("Recovery compensation verification requires an active user, one Skill and one Tool definition");
  const workspaceId = user.defaultWorkspaceId ?? null;
  const suffix = randomUUID().replace(/-/g, "");
  const traceId = `system_test_recovery_${suffix.slice(0, 28)}`;
  const skillRunId = `system_test_skill_${suffix.slice(0, 32)}`;
  const toolRunId = `system_test_tool_${suffix.slice(0, 32)}`;

  await ensureRunTrace({ runId: traceId, rootRunType: "agent_run", workspaceId, agentSlug: "system.recovery.audit", userId: user.id, metadata: { systemTest: true, noExternalExecution: true } });
  await rawExecute(
    `INSERT INTO emperor_skill_runs (workspaceId,runId,skillSlug,skillName,skillVersion,userId,input,status,errorMessage,traceId)
     VALUES (?,?,?,?,?,?,?, 'failed', ?, ?)`,
    [workspaceId, skillRunId, skill.slug, "SYSTEM TEST — Recovery Compensation", 1, user.id, JSON.stringify({ systemTest: true, noExternalExecution: true }), "system test failed run; do not execute", traceId],
  );
  await rawExecute(
    `INSERT INTO emperor_tool_runs (workspaceId,toolRunId,toolSlug,toolName,toolType,source,status,riskLevel,userId,input,errorMessage,retryable,attemptCount,governanceDecision)
     VALUES (?,?,?,?,?,?, 'failed','high',?,?,?,0,0,?)`,
    [workspaceId, toolRunId, tool.slug, "SYSTEM TEST — Recovery Compensation", tool.type, "builtin", user.id, JSON.stringify({ systemTest: true, noExternalExecution: true }), "system test failed run; do not execute", JSON.stringify({ systemTest: true, sideEffect: "write" })],
  );

  const skillResult = await prepareSkillRunRecovery({ runId: skillRunId, userId: user.id, workspaceId, isAdmin: true });
  const toolResult = await prepareToolRunRecovery({ toolRunId, userId: user.id, workspaceId });
  const recoveries = rows(await rawExecute(
    "SELECT targetType,targetId,status,reasonCode FROM emperor_execution_recovery_requests WHERE targetId IN (?,?) ORDER BY createdAt",
    [skillRunId, toolRunId],
  ));
  const events = rows(await rawExecute(
    "SELECT eventType,entityType,entityId FROM emperor_run_ledger_events WHERE traceId=? AND entityId IN (?,?) ORDER BY id",
    [traceId, skillRunId, toolRunId],
  ));
  if (skillResult.allowed || toolResult.allowed) throw new Error("Non-idempotent/high-risk system test runs must not be recoverable");
  if (recoveries.length !== 2 || recoveries.some((item) => item.status !== "compensation_required" || !item.reasonCode)) throw new Error("Compensation requests were not persisted with reasonCode");
  const hasSkillEvent = events.some((event) => event.entityType === "skill_run" && event.entityId === skillRunId && event.eventType === "lifecycle.compensation_required");
  const hasToolEvent = events.some((event) => event.entityType === "tool_run" && event.entityId === toolRunId && event.eventType === "lifecycle.compensation_required");
  if (!hasSkillEvent || !hasToolEvent) throw new Error("Compensation Ledger entity semantics are incomplete");
  console.log(JSON.stringify({ traceId, skillRunId, toolRunId, recoveries, events, verification: "compensation-only-no-model-tool-mcp-executed" }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
