import { describe, expect, it } from "vitest";
import { hasConflictingBusinessJob, latestBusinessManagedRunQuery } from "./domains/ai_os/services/businessManagedAgent";

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

  it("looks up reusable Runs without sorting large execution JSON payloads", () => {
    const query = latestBusinessManagedRunQuery("workspaceId=?");
    expect(query).toContain("SELECT runId,status FROM emperor_agent_runs");
    expect(query).not.toContain("SELECT *");
    expect(query).toContain("WHERE agentSlug=? AND projectId=? AND workspaceId=?");
    expect(query).toContain("ORDER BY createdAt DESC,id DESC LIMIT 1");
  });
});
