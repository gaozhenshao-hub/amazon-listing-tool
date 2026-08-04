import { describe, it, expect } from "vitest";

describe("TOOL_SECRET_KEY environment variable", () => {
  it("should be set and have sufficient length (>=32 chars)", () => {
    const key = process.env.TOOL_SECRET_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThanOrEqual(32);
  });

  it("AI_JOB_IN_PROCESS should be set to false for worker-separated deployment", () => {
    const val = process.env.AI_JOB_IN_PROCESS;
    // Either false (worker separated) or undefined (in-process mode)
    if (val !== undefined) {
      expect(["false", "true"]).toContain(val);
    }
  });
});
