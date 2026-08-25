import { randomUUID } from "node:crypto";
import { getAllUsers } from "../server/repositories/auth/authRepository";
import { getProjectsByUser } from "../server/repositories/project/projectRepository";
import { cancelAgentRun, getAgentRun, startAgentRun } from "../server/domains/ai_os/services/agentRunner";
import { getKeywordAgentDag, KEYWORD_WORKFLOW_AGENT_SLUG } from "../server/domains/keyword/keywordAgentBridge";
import { markBusinessManagedNodeRunning } from "../server/domains/ai_os/services/businessManagedAgent";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [user] = (await getAllUsers()).filter(item => item.status === "active" && (item.role === "super_admin" || item.role === "admin"));
  if (!user) throw new Error("No active admin is available for keyword node recovery verification");
  const [project] = await getProjectsByUser(user.id, (user as any).defaultWorkspaceId ?? 1);
  if (!project) throw new Error("No admin-owned project is available for keyword node recovery verification");

  const staleRuns = await rawExecute(
    "SELECT runId FROM emperor_agent_runs WHERE agentSlug=? AND userId=? AND inputs LIKE ? AND status NOT IN ('completed','failed','canceled')",
    [KEYWORD_WORKFLOW_AGENT_SLUG, user.id, "%keyword-running-node-recovery%"],
  );
  for (const stale of staleRuns as any[]) {
    await cancelAgentRun({ runId: stale.runId, userId: user.id, reason: "ARCHIVED_SYSTEM_TEST keyword recovery cleanup" }).catch(() => null);
  }

  const started = await startAgentRun({
    slug: KEYWORD_WORKFLOW_AGENT_SLUG,
    inputs: { systemTest: "keyword-running-node-recovery" },
    userId: user.id,
    workspaceId: (user as any).defaultWorkspaceId ?? null,
    projectId: project.id,
  });
  const runId = (started as any).run?.runId || (started as any).runId;
  if (!runId) throw new Error("Keyword system test Agent run did not return a runId");
  const firstJobId = `system_test_keyword_job_${randomUUID().replace(/-/g, "")}`;
  const replacementJobId = `system_test_keyword_job_${randomUUID().replace(/-/g, "")}`;
  try {
    const first = await markBusinessManagedNodeRunning({
      runId,
      dag: getKeywordAgentDag(),
      nodeId: "K1",
      aiJobRunId: firstJobId,
      aiJobAttempt: 1,
      progress: 10,
      allowJobReplacement: true,
    });
    const replacement = await markBusinessManagedNodeRunning({
      runId,
      dag: getKeywordAgentDag(),
      nodeId: "K1",
      aiJobRunId: replacementJobId,
      aiJobAttempt: 2,
      progress: 15,
      allowJobReplacement: true,
    });
    const detail = await getAgentRun(runId, user.id);
    const checkpoint = detail.checkpoints.find((item: any) => item.nodeId === "K1");
    if (!first || !replacement || checkpoint?.status !== "running" || checkpoint?.aiJobRunId !== replacementJobId) {
      throw new Error("Running keyword node could not accept the governed replacement Job");
    }
    console.log(JSON.stringify({ runId, nodeId: "K1", status: checkpoint.status, replacementJobId, verification: "keyword-running-node-idempotent-recovery-no-execution" }));
  } finally {
    await cancelAgentRun({ runId, userId: user.id, reason: "ARCHIVED_SYSTEM_TEST keyword running node recovery" }).catch(() => null);
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "keyword_running_node_recovery_verification_failed"); process.exit(1); });
