import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listAiJobHandlerRegistrations } from "./domains/ai_os/services/jobRunner";
import "./domains/image/routerContext";

describe("image Step 5 Agent binding", () => {
  it("registers the recoverable final-suggestion worker handler", () => {
    expect(listAiJobHandlerRegistrations()).toContainEqual({
      id: "imageWorkflow.step5FinalSuggestion",
      recoverable: true,
    });
  });

  it("binds queue, execution, retry, completion and cancellation to the Agent checkpoint", () => {
    const routeSource = readFileSync(
      new URL("./domains/image/routers/step5.ts", import.meta.url),
      "utf8",
    );
    const runnerSource = readFileSync(
      new URL("./domains/image/routerContext.ts", import.meta.url),
      "utf8",
    );

    expect(routeSource).toMatch(/input:\s*{[\s\S]*?agentRunId,[\s\S]*?agentNodeId: "step5_skill"/);
    expect(routeSource).toContain("await syncStepJobQueuedToAgent");
    expect(routeSource).toContain("cancelStep5Generation");
    expect(routeSource).toContain('failureKind: "cancel"');
    expect(runnerSource).toContain("syncStepJobRunningToAgent");
    expect(runnerSource).toContain("syncStepJobWaitingHumanToAgent");
    expect(runnerSource).toContain("syncStepJobFailedToAgent");
    expect(runnerSource).toContain('step5RunStatus: isCanceled ? "canceled" : finalAttempt ? "failed" : "queued"');
  });

  it("guards the session and checkpoint from stale Job results", () => {
    const runnerSource = readFileSync(
      new URL("./domains/image/routerContext.ts", import.meta.url),
      "utf8",
    );
    const bridgeSource = readFileSync(
      new URL("./domains/ai_os/services/businessManagedAgent.ts", import.meta.url),
      "utf8",
    );

    expect(runnerSource).toContain("latest.step5RunId !== runId");
    expect(bridgeSource).toContain("checkpoint.aiJobRunId !== input.aiJobRunId");
  });

  it("restores the Agent Run from the image session without manual input", () => {
    const pageSource = readFileSync(
      new URL("../client/src/pages/ImageWorkflowPage.tsx", import.meta.url),
      "utf8",
    );
    expect(pageSource).toContain("queryAgentRunId || session?.agentRunId || null");
    expect(pageSource).toContain("trpc.imageWorkflow.cancelStep5Generation.useMutation()");
  });
});
