import { describe, expect, it } from "vitest";
import { parseImageWorkflowConsumerRef } from "./imageWorkflowProjection";

describe("image workflow acquisition projection contract", () => {
  it("accepts only a project competitor-gallery consumer reference", () => {
    expect(parseImageWorkflowConsumerRef("project:42:competitor-gallery")).toEqual({ projectId: 42 });
  });

  it("rejects malformed or cross-consumer references", () => {
    expect(() => parseImageWorkflowConsumerRef("project:42:listing")).toThrow();
    expect(() => parseImageWorkflowConsumerRef("kb-images:US:B012345678")).toThrow();
  });
});
