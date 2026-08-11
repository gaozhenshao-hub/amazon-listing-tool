import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listAiJobHandlerRegistrations } from "./domains/ai_os/services/jobRunner";
import { validateStep4ReferenceResult } from "./domains/image/services/step4ReferenceJob";

describe("image Step 4 reference recommendation job", () => {
  it("registers a recoverable worker handler", () => {
    expect(listAiJobHandlerRegistrations()).toContainEqual({
      id: "imageWorkflow.step4Reference",
      recoverable: true,
    });
  });

  it("requires every secondary image from 2 through 7", () => {
    const complete = {
      imageReferences: [
        { imageType: "主图", imageNumber: 0 },
        ...[2, 3, 4, 5, 6, 7].map((imageNumber) => ({ imageType: "辅图", imageNumber })),
      ],
    };
    expect(validateStep4ReferenceResult(complete)).toBe(complete);

    expect(() => validateStep4ReferenceResult({
      imageReferences: complete.imageReferences.filter((item) => item.imageNumber !== 7),
    })).toThrow("当前缺少辅图: 7");
  });

  it("keeps the browser request asynchronous", () => {
    const source = readFileSync(
      new URL("../client/src/pages/imageWorkflow/ReferenceImagesStep.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("trpc.imageWorkflow.startStep4Generation.useMutation()");
    expect(source).toContain("trpc.imageWorkflow.getStep4Run.useQuery(");
    expect(source).not.toContain("trpc.imageWorkflow.generateStep4.useMutation()");
  });

  it("binds the background job lifecycle to the Step 4 Agent checkpoint", () => {
    const jobSource = readFileSync(
      new URL("./domains/image/services/step4ReferenceJob.ts", import.meta.url),
      "utf8",
    );
    const canvasSource = readFileSync(
      new URL("../client/src/pages/emperor/AgentCanvas.tsx", import.meta.url),
      "utf8",
    );

    expect(jobSource).toContain("agentRunId: z.string().max(80).optional()");
    expect(jobSource).toContain("syncStepJobRunningToAgent");
    expect(jobSource).toContain("syncStepJobWaitingHumanToAgent");
    expect(jobSource).toContain("syncStepJobFailedToAgent");
    expect(jobSource).toContain("syncStepJobQueuedToAgent");
    expect(jobSource.indexOf("await syncStepJobQueuedToAgent")).toBeLessThan(
      jobSource.indexOf("await scheduleAiJobRun(job.runId)"),
    );
    expect(canvasSource).toContain('queued: "排队中"');
    expect(canvasSource).toContain("selectedCheckpoint.aiJobRunId");
  });
});
