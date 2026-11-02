import { describe, expect, it } from "vitest";
import { competitorGalleryJobInput } from "./competitorGalleryJob";

describe("competitor gallery analysis job contract", () => {
  const completeInput = {
    projectId: 7,
    subjectId: 11,
    selectionVersionId: 23,
    selectionHash: "a".repeat(64),
    agentRunId: "run-1",
    agentNodeId: "node-0",
  };

  it("requires a confirmed analysis-scope identity", () => {
    expect(competitorGalleryJobInput.parse(completeInput)).toMatchObject({ selectionVersionId: 23 });
    expect(() => competitorGalleryJobInput.parse({ ...completeInput, selectionVersionId: undefined })).toThrow();
    expect(() => competitorGalleryJobInput.parse({ ...completeInput, selectionHash: "scope" })).toThrow();
  });
});
