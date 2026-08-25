import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [skillRunId, toolRunId, skillSlug, toolSlug] = process.argv.slice(2);
  if (![skillRunId, toolRunId, skillSlug, toolSlug].every(Boolean)) throw new Error("Expected skillRunId toolRunId skillSlug toolSlug arguments");
  const [skillRuns, toolRuns, skills, tools] = await Promise.all([
    rawExecute("SELECT status,errorMessage FROM emperor_skill_runs WHERE runId=? LIMIT 1", [skillRunId]),
    rawExecute("SELECT status,errorMessage FROM emperor_tool_runs WHERE toolRunId=? LIMIT 1", [toolRunId]),
    rawExecute("SELECT status FROM emperor_skills WHERE slug=? LIMIT 1", [skillSlug]),
    rawExecute("SELECT isActive FROM emperor_tools WHERE slug=? LIMIT 1", [toolSlug]),
  ]);
  const skillRun: any = skillRuns[0]; const toolRun: any = toolRuns[0]; const skill: any = skills[0]; const tool: any = tools[0];
  const archived = skillRun?.status === "canceled" && String(skillRun?.errorMessage || "").includes("ARCHIVED_SYSTEM_TEST")
    && toolRun?.status === "blocked" && String(toolRun?.errorMessage || "").includes("ARCHIVED_SYSTEM_TEST")
    && skill?.status === "Deprecated" && Number(tool?.isActive) === 0;
  if (!archived) throw new Error("System-test archive verification failed");
  console.log(JSON.stringify({ skillRun: { status: skillRun.status, archived: true }, toolRun: { status: toolRun.status, archived: true }, skill: { status: skill.status }, tool: { isActive: Number(tool.isActive) }, verification: "read-only-system-test-archive-state" }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "system_test_archive_verification_failed");
  process.exit(1);
});
