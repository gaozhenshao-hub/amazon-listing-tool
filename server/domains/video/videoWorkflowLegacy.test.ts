import { describe, expect, it } from "vitest";
import type { AppDb } from "../../repositories/dbClient";
import type { TrpcContext } from "../../_core/context";
import { videoWorkflowLegacyRequest } from "./videoWorkflowLegacy";
import { createVideoWorkflowTestFixture } from "./videoWorkflow.testFixture";
import { currentVideoWorkflowTransaction } from "./videoWorkflowTransaction";

function setup() {
  const f = createVideoWorkflowTestFixture();
  const ctx = { user: { id: 3, role: "super_admin", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
  const deps = { getDb: async () => f.database as unknown as AppDb, permission: async () => {} };
  return { ...f, ctx, deps };
}
describe("actual legacy video request transaction preserves six-node human gates", () => {
  it("unchanged confirmStage still publishes its explicit human proof before success", async () => {
    const f = setup(); let sawTransaction = false;
    const result = await videoWorkflowLegacyRequest(f.ctx, "videoScript.confirmStage", "mutation",
      { videoScriptId: 9, stage: "stage_1" }, async () => { sawTransaction = !!currentVideoWorkflowTransaction(); return { success: true }; }, f.deps);
    expect(result).toEqual({ success: true }); expect(sawTransaction).toBe(true);
    expect(f.state.sourceTables.video_scripts[0].version).toBe(2);
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "section_planning")).toMatchObject({ status: "confirmed", reviewerUserId: 3 });
    expect(f.state.artifacts.find(row => row.artifactKey === "video.script")).toMatchObject({ status: "final", isCurrent: 1 });
    expect(f.state.audits).toHaveLength(1);
  });
  it("editing a later stage preserves original upstream reviewer/time and makes downstream noncurrent", async () => {
    const f = setup();
    await videoWorkflowLegacyRequest(f.ctx, "videoScript.confirmStage", "mutation", { videoScriptId: 9, stage: "stage_1" }, async () => ({}), f.deps);
    const upstream = f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "section_planning")!;
    upstream.reviewerUserId = 77; const reviewTime = upstream.confirmedAt;
    await videoWorkflowLegacyRequest(f.ctx, "videoScript.updateShot", "mutation", { id: 25 }, async () => {
      f.state.sourceTables.video_script_shots[0].shotDescription = "HUMAN EDIT"; return {};
    }, f.deps);
    expect(upstream.reviewerUserId).toBe(77); expect(upstream.confirmedAt).toEqual(reviewTime);
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "shot_storyboard")).toMatchObject({ status: "waiting_human", reviewerUserId: null });
    expect(f.state.artifacts.every(row => row.isCurrent === 0)).toBe(true);
  });
  it("projection failure rolls back the review instead of claiming success", async () => {
    const f = setup(), before = structuredClone(f.state); f.control.failWrite = "INSERT INTO emperor_agent_events";
    await expect(videoWorkflowLegacyRequest(f.ctx, "videoScript.confirmStage", "mutation", { videoScriptId: 9, stage: "stage_1" }, async () => ({ success: true }), f.deps)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.state).toEqual(before);
  });
  it("does not write on reads and rejects missing explicit workspace before a transaction", async () => {
    const f = setup();
    await videoWorkflowLegacyRequest(f.ctx, "videoScript.getById", "query", { id: 9 }, async () => ({}), f.deps);
    expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
    let opened = false;
    await expect(videoWorkflowLegacyRequest({ ...f.ctx, workspaceId: null }, "videoScript.getById", "query", { id: 9 }, async () => ({}),
      { ...f.deps, getDb: async () => { opened = true; return f.database as unknown as AppDb; } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(opened).toBe(false);
  });
});
