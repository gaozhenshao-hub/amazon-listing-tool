import { describe, expect, it } from "vitest";
import { hasConflictingBusinessJob } from "./domains/ai_os/services/businessManagedAgent";

describe("业务托管Agent运行节点竞争保护", () => {
  it("allows a duplicate claim for the same AI任务", () => {
    expect(hasConflictingBusinessJob("running", "job-1", "job-1", false)).toBe(false);
  });

  it("rejects a different AI任务 attaching to an already-running node unless replacement is explicit", () => {
    expect(hasConflictingBusinessJob("running", "job-1", "job-2", false)).toBe(true);
    expect(hasConflictingBusinessJob("running", "job-1", "job-2", true)).toBe(false);
  });

  it("does not treat non-running nodes or missing AI任务标识 as conflicts", () => {
    expect(hasConflictingBusinessJob("ready", "job-1", "job-2", false)).toBe(false);
    expect(hasConflictingBusinessJob("running", null, "job-2", false)).toBe(false);
  });
});
