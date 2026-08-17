import { describe, expect, it } from "vitest";
import { resolveImageWorkflowProjectId } from "./projectIdResolution";

describe("resolveImageWorkflowProjectId", () => {
  it("prefers a valid projectId from the direct workflow URL", () => {
    expect(resolveImageWorkflowProjectId("?projectId=90001&view=step4", 12)).toBe(90001);
  });

  it("uses the selected project when the URL parameter is missing or invalid", () => {
    expect(resolveImageWorkflowProjectId("?view=step4", 90001)).toBe(90001);
    expect(resolveImageWorkflowProjectId("?projectId=abc", 90001)).toBe(90001);
  });
});
