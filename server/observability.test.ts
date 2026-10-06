import { describe, expect, it } from "vitest";
import {
  scoreAiOutputQuality,
  summarizeActiveBusinessJobBindings,
} from "./observability";

describe("observability", () => {
  it("scores structured successful output without external calls", () => {
    const result = scoreAiOutputQuality({
      output: { title: "A sufficiently detailed listing result that is long enough for review." },
      status: "succeeded",
      expectedKeys: ["title"],
    });

    expect(result.score).toBeGreaterThan(50);
    expect(result.grade).not.toBe("poor");
  });

  it("reports missing and mismatched active job bindings", () => {
    const result = summarizeActiveBusinessJobBindings([
      {
        runId: "job-missing",
        module: "listing",
        kind: "generate",
        status: "running",
        input: {},
      },
      {
        runId: "job-mismatched",
        module: "listing",
        kind: "generate",
        status: "running",
        input: { agentRunId: "agent-1", agentNodeId: "node-1" },
        checkpointRunId: "agent-1",
        checkpointNodeId: "node-2",
      },
    ]);

    expect(result).toMatchObject({
      activeJobs: 2,
      boundActiveJobs: 0,
      unboundActiveJobs: 2,
      healthy: false,
    });
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      "missing_job_binding",
      "checkpoint_mismatch",
    ]);
  });
});
