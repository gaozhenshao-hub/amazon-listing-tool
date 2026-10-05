import { describe, expect, it } from "vitest";
import { firstProjectionRow, parseImageWorkflowConsumerRef } from "./imageWorkflowProjection";

describe("image workflow acquisition projection contract", () => {
  it("accepts only a project competitor-gallery consumer reference", () => {
    expect(parseImageWorkflowConsumerRef("project:42:competitor-gallery")).toEqual({ projectId: 42 });
  });

  it("rejects malformed or cross-consumer references", () => {
    expect(() => parseImageWorkflowConsumerRef("project:42:listing")).toThrow();
    expect(() => parseImageWorkflowConsumerRef("kb-images:US:B012345678")).toThrow();
  });

  it("uses the selected database row rather than the query result array", () => {
    expect(firstProjectionRow([{ id: 7 }, { id: 8 }])).toEqual({ id: 7 });
    expect(firstProjectionRow([])).toBeNull();
  });
});
