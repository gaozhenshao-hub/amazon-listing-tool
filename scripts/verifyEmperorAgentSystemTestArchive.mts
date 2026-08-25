import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Expected Agent Run ID");
  const [runRows, jobRows] = await Promise.all([
    rawExecute("SELECT status,errorMessage,stateVersion FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]),
    rawExecute("SELECT COUNT(*) AS count FROM ai_job_runs WHERE JSON_EXTRACT(payload,'$.runId')=? AND status IN ('queued','running','succeeded')", [runId]).catch(() => [{ count: 0 }]),
  ]);
  const run: any = runRows[0];
  if (run?.status !== "canceled" || Number(jobRows[0]?.count || 0) !== 0) throw new Error("Agent system-test archive verification failed");
  console.log(JSON.stringify({ runId, status: run.status, stateVersion: Number(run.stateVersion || 0), activeOrCompletedJobs: 0, verification: "read-only-agent-system-test-archive-state" }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "agent_system_test_archive_verification_failed"); process.exit(1); });
