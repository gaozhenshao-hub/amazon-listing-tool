import { randomUUID } from "node:crypto";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { prepareSkillRunRecovery, prepareToolRunRecovery } from "../server/domains/ai_os/services/directRunRecovery";
import { ensureRunTrace } from "../server/domains/ai_os/services/runLedger";

const rows = <T = Record<string, any>>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

async function main() {
  const [user] = rows(await rawExecute("SELECT id,defaultWorkspaceId FROM users WHERE status='active' ORDER BY id LIMIT 1"));
  let [skill] = rows(await rawExecute("SELECT slug FROM emperor_skills ORDER BY id LIMIT 1"));
  let [tool] = rows(await rawExecute("SELECT slug,name,type FROM emperor_tools ORDER BY id LIMIT 1"));
  if (!user) {
    console.log(JSON.stringify({ verification: "skipped", reason: "no_active_user_skill_tool_combination", noExternalExecution: true }));
    return;
  }
  const workspaceId = user.defaultWorkspaceId ?? null;
  const suffix = randomUUID().replace(/-/g, "");
  const systemTestSkillSlug = `system_test_recovery_skill_${suffix.slice(0, 20)}`;
  const systemTestToolSlug = `system_test_recovery_tool_${suffix.slice(0, 20)}`;
  const createdDefinitions: { skill: boolean; tool: boolean } = { skill: false, tool: false };
  if (!skill) {
    await rawExecute(
      `INSERT INTO emperor_skills (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,manifest,execution_mode,allowed_tools,disallowed_tools)
       VALUES (?,?,?,?,?,'system_test','L2','Deprecated','private',1,1,?,'inline',?,?)`,
      [workspaceId, systemTestSkillSlug, 'SYSTEM TEST — no execution', 'Temporary isolated audit definition; never executable.', 'system_test', JSON.stringify({ systemTest: true, noExternalExecution: true, implementation: { mode: 'none' } }), JSON.stringify([]), JSON.stringify(['*'])],
    );
    skill = { slug: systemTestSkillSlug };
    createdDefinitions.skill = true;
  }
  if (!tool) {
    await rawExecute(
      `INSERT INTO emperor_tools (workspaceId,slug,name,description,type,config,governancePolicy,permissionPolicy,isActive)
       VALUES (?,?,?,?, 'internal', ?,?,?,0)`,
      [workspaceId, systemTestToolSlug, 'SYSTEM TEST — no execution', 'Temporary isolated audit definition; never executable.', JSON.stringify({ systemTest: true, noExternalExecution: true }), JSON.stringify({ riskLevel: 'high', sideEffect: 'write', retryable: false }), JSON.stringify({ systemTest: true })],
    );
    tool = { slug: systemTestToolSlug, name: 'SYSTEM TEST — no execution', type: 'internal' };
    createdDefinitions.tool = true;
  }
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
    "SELECT traceId,eventType,entityType,entityId FROM emperor_run_ledger_events WHERE entityId IN (?,?) ORDER BY id",
    [skillRunId, toolRunId],
  ));
  if (skillResult.allowed || toolResult.allowed) throw new Error("Non-idempotent/high-risk system test runs must not be recoverable");
  if (recoveries.length !== 2 || recoveries.some((item) => item.status !== "compensation_required" || !item.reasonCode)) throw new Error("Compensation requests were not persisted with reasonCode");
  const hasSkillEvent = events.some((event) => event.entityType === "skill_run" && event.entityId === skillRunId && event.eventType === "lifecycle.compensation_required");
  const hasToolEvent = events.some((event) => event.entityType === "tool_run" && event.entityId === toolRunId && event.eventType === "lifecycle.compensation_required");
  if (!hasSkillEvent || !hasToolEvent) throw new Error("Compensation Ledger entity semantics are incomplete");
  if (createdDefinitions.skill) await rawExecute("UPDATE emperor_skills SET status='Deprecated',isSystem=1,description=? WHERE slug=?", ['Archived system-test definition; no execution occurred.', systemTestSkillSlug]);
  if (createdDefinitions.tool) await rawExecute("UPDATE emperor_tools SET isActive=0,description=? WHERE slug=?", ['Archived system-test definition; no execution occurred.', systemTestToolSlug]);
  console.log(JSON.stringify({ traceId, skillRunId, toolRunId, recoveries, events, createdDefinitions, verification: "compensation-only-no-model-tool-mcp-executed" }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
