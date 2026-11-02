import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_JOB_CHECKPOINT_STATUS_MAP,
  classifyBusinessJobFailure,
} from "./domains/ai_os/services/businessJobCheckpointBinder";
import {
  assertBusinessJobAgentBinding,
  BUSINESS_AI_JOB_MODULES,
} from "./domains/ai_os/services/businessJobBindingPolicy";
import { summarizeActiveBusinessJobBindings } from "./domains/ai_os/services/observability";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("business Job QA gate", () => {
  it("requires explicit Agent Run and node bindings for every business module", () => {
    for (const module of BUSINESS_AI_JOB_MODULES) {
      expect(() => assertBusinessJobAgentBinding({ module, kind: "qa", input: {} })).toThrow(/agentRunId.*agentNodeId/);
      expect(() => assertBusinessJobAgentBinding({
        module,
        kind: "qa",
        input: { agentRunId: "agent_1", agentNodeId: "node_1" },
      })).not.toThrow();
    }
    expect(() => assertBusinessJobAgentBinding({ module: "qa", kind: "qa", input: {} })).not.toThrow();
  });

  it("treats a Job as bound only when its Checkpoint matches both Agent identifiers", () => {
    const result = summarizeActiveBusinessJobBindings([
      {
        runId: "job_bound",
        module: "listing",
        kind: "listing.generate",
        status: "running",
        input: { agentRunId: "agent_1", agentNodeId: "G2" },
        checkpointRunId: "agent_1",
        checkpointNodeId: "G2",
      },
      {
        runId: "job_missing",
        module: "imageWorkflow",
        kind: "image.step2",
        status: "queued",
        input: {},
      },
      {
        runId: "job_mismatch",
        module: "videoScript",
        kind: "video.generate",
        status: "running",
        input: { agentRunId: "agent_2", agentNodeId: "shots" },
        checkpointRunId: "agent_old",
        checkpointNodeId: "shots",
      },
    ]);

    expect(result).toMatchObject({
      activeJobs: 3,
      boundActiveJobs: 1,
      unboundActiveJobs: 2,
      healthy: false,
    });
    expect(result.issues.map((issue) => issue.reason)).toEqual(["missing_job_binding", "checkpoint_mismatch"]);
  });

  it("keeps cancel, timeout and retry state mapping exact", () => {
    expect(BUSINESS_JOB_CHECKPOINT_STATUS_MAP).toEqual({
      queued: "running",
      running: "running",
      retrying: "running",
      succeeded: "waiting_human",
      confirmed: "confirmed",
      failed: "failed",
      canceled: "canceled",
    });
    expect(classifyBusinessJobFailure({
      error: new Error("request timed out"),
      attempt: 1,
      maxAttempts: 3,
    })).toMatchObject({ failureKind: "timeout", lifecycleStatus: "retrying", finalAttempt: false });
    expect(classifyBusinessJobFailure({
      error: new Error("request timed out"),
      attempt: 3,
      maxAttempts: 3,
    })).toMatchObject({ failureKind: "timeout", lifecycleStatus: "failed", finalAttempt: true });
    const controller = new AbortController();
    controller.abort("user canceled");
    expect(classifyBusinessJobFailure({
      error: new Error("aborted"),
      signal: controller.signal,
      attempt: 1,
      maxAttempts: 3,
    })).toMatchObject({ failureKind: "cancel", lifecycleStatus: "canceled", finalAttempt: true });
  });

  it("runs both Agent binding and Emperor Skill checks in the CI gate", () => {
    const packageJson = JSON.parse(read("../package.json"));
    const workflow = read("../.github/workflows/qa-gate.yml");
    expect(packageJson.scripts["audit:business-job-bindings"]).toContain("check-business-job-bindings.mjs");
    expect(packageJson.scripts["qa:gate"]).toContain("audit:business-job-bindings");
    expect(packageJson.scripts["qa:gate"]).toContain("audit:business-skills");
    expect(workflow).toContain("pnpm qa:gate");
  });

  it("keeps Listing Job history on the governed module key and migrates the legacy key", () => {
    expect(read("./domains/listing/services/generationJob.ts")).toContain('LISTING_JOB_MODULE = "listing"');
    const migration = read("../drizzle/0136_business_job_binding_qa.sql");
    expect(migration).toContain("WHERE `module`='listingWorkflow'");
    expect(migration).toContain("SET `module`='listing'");
  });

  it("uses a true canceled state in every business bridge", () => {
    for (const path of [
      "./domains/image/imageWorkflowAgentBridge.ts",
      "./domains/listing/listingAgentBridge.ts",
      "./domains/keyword/keywordAgentBridge.ts",
      "./domains/product_development/analysis/productAnalysisAgent.ts",
      "./domains/ai_os/services/scopedBusinessAgent.ts",
    ]) {
      expect(read(path)).toContain("markBusinessManagedNodeCanceled");
    }
  });
});
