import { randomUUID } from "node:crypto";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { approveParallelPlanDraft, createParallelPlan } from "../server/domains/ai_os/services/harnessCompletion";

const userId = 1;
const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
const agentSlug = `system.test.parallel.${suffix}`;
const agentRunId = `agent_run_system_parallel_${suffix}`;
const skillA = `system.test.parallel.a.${suffix}`;
const skillB = `system.test.parallel.b.${suffix}`;

async function main() {
  let planId: string | null = null;
  try {
    for (const slug of [skillA, skillB]) {
      await rawExecute(
        `INSERT INTO emperor_skills (slug,name,category,owner,riskTier,status,scope,version,isSystem,manifest,allowed_tools,execution_mode)
         VALUES (?,?, 'system_test','system','L1','Released','private',1,1,?,NULL,'inline')`,
        [slug, `SYSTEM TEST ${slug}`, JSON.stringify({ implementation: { systemPrompt: "Never execute", userPromptTemplate: "" } })],
      );
    }
    const dag = {
      nodes: [
        { id: "evidence_a", nodeType: "skill_node", label: "Evidence A", skillSlug: skillA, outputKey: "evidenceA" },
        { id: "evidence_b", nodeType: "skill_node", label: "Evidence B", skillSlug: skillB, outputKey: "evidenceB" },
        { id: "merge", nodeType: "merge_node", label: "Manual merge", outputKey: "merged" },
      ],
      edges: [{ source: "evidence_a", target: "merge" }, { source: "evidence_b", target: "merge" }],
    };
    await rawExecute(
      "INSERT INTO emperor_agents (workspaceId,slug,name,description,status,scope,triggerType,maxExecutionSeconds,dagDefinition) VALUES (1,?,?,?,'deprecated','private','manual',60,?)",
      [agentSlug, "SYSTEM TEST Controlled Parallel", "Temporary no-execution governance verification", JSON.stringify(dag)],
    );
    await rawExecute(
      "INSERT INTO emperor_agent_runs (runId,agentSlug,agentName,userId,status,progress,inputs) VALUES (?,?,?,?,'waiting_human',0,?)",
      [agentRunId, agentSlug, "SYSTEM TEST Controlled Parallel", userId, JSON.stringify({ systemTest: true })],
    );
    const draft = await createParallelPlan({ workspaceId: 1, agentRunId, branchNodeIds: ["evidence_a", "evidence_b"], mergeNodeId: "merge", maxConcurrency: 2, userId });
    planId = draft.parallelPlanId;
    if (!draft.assessment.eligible || draft.status !== "draft" || !draft.reviewId) throw new Error("Safe branches did not create an approval draft");
    const approved = await approveParallelPlanDraft({ parallelPlanId: draft.parallelPlanId, reviewId: draft.reviewId, reason: "system_test_approval_no_dispatch", userId });
    if (approved.status !== "approved" || approved.dispatched) throw new Error("Approval changed execution semantics");
    const [plans, reviews, branches, events, skillRuns] = await Promise.all([
      rawExecute("SELECT status FROM emperor_parallel_plans WHERE parallelPlanId=?", [draft.parallelPlanId]),
      rawExecute("SELECT status FROM emperor_harness_review_requests WHERE reviewId=?", [draft.reviewId]),
      rawExecute("SELECT status FROM emperor_parallel_branches WHERE parallelPlanId=?", [draft.parallelPlanId]),
      rawExecute("SELECT eventType FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id", [agentRunId]),
      rawExecute("SELECT runId FROM emperor_skill_runs WHERE skillSlug IN (?,?)", [skillA, skillB]),
    ]);
    if (plans[0]?.status !== "approved" || reviews[0]?.status !== "approved" || branches.some((branch: any) => branch.status !== "pending") || skillRuns.length > 0) throw new Error("Parallel draft approval dispatched or changed a branch");
    const eventTypes = events.map((event: any) => event.eventType);
    if (!eventTypes.includes("parallel.draft_created") || !eventTypes.includes("parallel.draft_approved")) throw new Error("Parallel draft ledger evidence is incomplete");
    console.log(JSON.stringify({ agentRunId, parallelPlanId: draft.parallelPlanId, reviewId: draft.reviewId, branchStatuses: branches.map((branch: any) => branch.status), eventTypes, verification: "parallel-draft-approved-no-model-skill-agent-tool-mcp-executed" }));
  } finally {
    if (planId) await rawExecute("UPDATE emperor_parallel_plans SET status='canceled' WHERE parallelPlanId=?", [planId]);
    await rawExecute("UPDATE emperor_agent_runs SET status='canceled',completedAt=NOW() WHERE runId=?", [agentRunId]);
    await rawExecute("UPDATE emperor_agents SET status='deprecated' WHERE slug=?", [agentSlug]);
    await rawExecute("UPDATE emperor_skills SET status='Deprecated' WHERE slug IN (?,?)", [skillA, skillB]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "controlled_parallel_draft_verification_failed");
  process.exit(1);
});
