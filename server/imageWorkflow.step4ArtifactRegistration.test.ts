import { describe, expect, it } from "vitest";
import { awaitStep4ArtifactRegistration } from "./domains/image/routers/workflowSteps";
import { shouldDeferImageWorkflowStepArtifactRegistration } from "./repositories/image/imageRepository";

describe("Step4 Artifact registration boundary", () => {
  it("defers the generic Step4 confirmation registration so the route can apply its bounded registration", () => {
    expect(shouldDeferImageWorkflowStepArtifactRegistration(4, true)).toBe(true);
    expect(shouldDeferImageWorkflowStepArtifactRegistration(4, false)).toBe(false);
    expect(shouldDeferImageWorkflowStepArtifactRegistration(3, true)).toBe(false);
  });

  it("returns the completed artifact without reporting a timeout", async () => {
    const result = await awaitStep4ArtifactRegistration({
      registration: Promise.resolve({ ref: "artifact:step4" }),
      timeoutMs: 20,
    });

    expect(result).toEqual({ artifact: { ref: "artifact:step4" }, timedOut: false });
  });

  it("does not block Step4 confirmation when Artifact registration is slow", async () => {
    const registration = new Promise<{ ref: string }>((resolve) => {
      setTimeout(() => resolve({ ref: "artifact:late-step4" }), 30);
    });

    const result = await awaitStep4ArtifactRegistration({ registration, timeoutMs: 1 });

    expect(result).toEqual({ artifact: null, timedOut: true });
    await expect(registration).resolves.toEqual({ ref: "artifact:late-step4" });
  });

  it("degrades an Artifact registration rejection without surfacing it to the confirmation mutation", async () => {
    const errors: unknown[] = [];
    const result = await awaitStep4ArtifactRegistration({
      registration: Promise.reject(new Error("artifact unavailable")),
      timeoutMs: 20,
      onError: (error) => errors.push(error),
    });

    expect(result).toEqual({ artifact: null, timedOut: false });
    expect(errors).toHaveLength(1);
  });
});
