import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { listAiJobHandlerRegistrations } from "./domains/ai_os/services/jobRunner";
import {
  IMAGE_GENERATION_STEPS,
  imageStepGenerationJobInput,
} from "./domains/image/services/stepGenerationJob";

describe("image Step 0-3 background jobs", () => {
  it("registers one recoverable handler for every early image step", () => {
    expect(IMAGE_GENERATION_STEPS).toEqual([0, 1, 2, 3]);
    expect(listAiJobHandlerRegistrations()).toContainEqual({
      id: "imageWorkflow.stepGeneration0To3",
      recoverable: true,
    });
    expect(() => imageStepGenerationJobInput.parse({ projectId: 1, sessionId: 2, step: 4 })).toThrow();
  });

  it("keeps all AI execution behind Emperor Skills and propagates cancellation", () => {
    const source = readFileSync(
      new URL("./domains/image/services/stepGenerationJob.ts", import.meta.url),
      "utf8",
    );
    for (const slug of [
      "image.step0.competitor.analysis",
      "image.step0.competitor.summary",
      "image.step1.sellingpoints",
      "image.step2.outline",
      "image.step3.style",
    ]) {
      expect(source).toContain(slug);
    }
    expect(source).toContain("signal: context.signal");
    expect(source).toContain("getLatestImageStepGenerationJob");
    expect(source).toContain("A newer Step");
  });

  it("binds queue, progress, retries, completion and cancel to Agent checkpoints", () => {
    const source = readFileSync(
      new URL("./domains/image/services/stepGenerationJob.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("syncStepJobQueuedToAgent");
    expect(source).toContain("syncStepJobRunningToAgent");
    expect(source).toContain("syncStepJobWaitingHumanToAgent");
    expect(source).toContain("syncStepJobFailedToAgent");
    expect(source).toContain('failureKind: "cancel"');
  });

  it("restores page state through a shared polling hook", () => {
    const source = readFileSync(
      new URL("../client/src/pages/imageWorkflow/useImageStepGenerationJob.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("getStepGenerationRun.useQuery");
    expect(source).toContain("refetchInterval");
    expect(source).toContain("cancelStepGeneration.useMutation");
    expect(source).toContain('status === "queued"');
    expect(source).toContain('status === "running"');
  });

  it("writes only the changed image step as an Artifact version", () => {
    const repository = readFileSync(
      new URL("./repositories/image/imageRepository.ts", import.meta.url),
      "utf8",
    );
    expect(repository).toContain("registerImageWorkflowStepArtifact");
    expect(repository).toContain('sourceType === "ai_output"');
  });
});
