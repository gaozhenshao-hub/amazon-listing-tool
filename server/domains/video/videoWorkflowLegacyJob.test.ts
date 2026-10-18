import { describe, expect, it } from "vitest";
import type { AppDb } from "../../repositories/dbClient";
import { createVideoWorkflowLegacyJobBridge } from "./videoWorkflowLegacyJob";
import { createVideoWorkflowTestFixture } from "./videoWorkflow.testFixture";
import { videoWorkflowStatement } from "./videoWorkflowSource";

function setup() {
  const f = createVideoWorkflowTestFixture("product_info");
  // Protocol fixture implements only SQL used by this domain. Production uses
  // the original Drizzle transaction, not a second DB or nested transaction.
  const bridge = createVideoWorkflowLegacyJobBridge(async () => f.database as unknown as AppDb, async () => {});
  const target = { projectId: 8, videoScriptId: 9, operation: "product_info" as const };
  return { ...f, bridge, target };
}
describe("legacy video source and projection fencing without changing provider approval/configuration", () => {
  it("freezes complete project/file/competitor sources and excludes old AI from its actual prompt", async () => {
    const f = setup();
    f.state.sourceTables.projectFiles.push({ id: 2, projectId: 8, userId: 3, workspaceId: 7, fileType: "product_attributes", lifecycleState: "hot", rawContent: "ORIGINAL USER", rawContentHash: null, analysisResult: "OLD_AI" });
    const source = await f.bridge.capture(f.identity, f.target);
    expect(JSON.stringify(source.tables)).toContain("OLD_AI"); expect(JSON.stringify(source.context)).not.toContain("OLD_AI");
    f.state.sourceTables.projectFiles[0].rawContent = "LATER USER EDIT";
    await expect(f.bridge.verify(f.identity, f.target, source.sourceHash)).rejects.toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
  });
  it("refuses post-model publication when an external source changes, before any business write", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target), before = structuredClone(f.state.sourceTables.video_product_snapshots);
    f.state.sourceTables.projects[0].productName = "NEW SOURCE";
    let wrote = false;
    await expect(f.bridge.publish(f.identity, f.target, source.sourceHash, "product_info", async () => { wrote = true; })).rejects.toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
    expect(wrote).toBe(false); expect(f.state.sourceTables.video_product_snapshots).toEqual(before);
  });
  it("publication, complete history, business version, human gate and formal draft commit together", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target);
    await f.bridge.publish(f.identity, f.target, source.sourceHash, "product_info", async () => {
      await f.tx.execute(videoWorkflowStatement("UPDATE `video_product_snapshots` SET `basicInfo`=?,updatedAt=NOW() WHERE id=?", [JSON.stringify({ product_name: "NEW CANDIDATE" }), 30]));
    });
    expect(f.state.sourceTables.video_scripts[0].version).toBe(2);
    expect(f.state.sourceTables.video_script_versions).toHaveLength(2);
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "product_information")).toMatchObject({ status: "waiting_human", reviewerUserId: null, confirmedAt: null });
    expect(f.state.artifacts.find(row => row.artifactKey === "video.script")).toMatchObject({ status: "draft", isCurrent: 0 });
  });
  it("late commit ACK failure cannot turn an already published version into failure", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target);
    f.control.ackLostOn = "INSERT INTO emperor_agent_events";
    await expect(f.bridge.publish(f.identity, f.target, source.sourceHash, "product_info", async () => {})).rejects.toThrow("ACK_LOST");
    const after = structuredClone(f.state);
    await expect(f.bridge.failCurrent(f.identity, f.target, source.sourceHash, "failed")).rejects.toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
    expect(f.state).toEqual(after);
  });
  it("late provider failure never overwrites a newer human edit or review", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target);
    f.state.sourceTables.video_scripts[0].version = 4;
    f.state.sourceTables.video_product_snapshots[0].basicInfo = { human: "NEW REVIEW" };
    const after = structuredClone(f.state);
    await expect(f.bridge.failCurrent(f.identity, f.target, source.sourceHash, "failed")).rejects.toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
    expect(f.state).toEqual(after);
  });
  it("current terminal failure updates only the same source under the common lock", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target);
    await f.bridge.failCurrent(f.identity, f.target, source.sourceHash, "failed");
    expect((f.state.sourceTables.video_scripts[0].stageStatus as Record<string, unknown>).stage_0b).toBe("failed");
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "product_information")?.status).toBe("failed");
  });
  it("warning rolls back legacy candidate, history, gates and formal artifacts", async () => {
    const f = setup(), source = await f.bridge.capture(f.identity, f.target), before = structuredClone(f.state);
    f.control.failWrite = "INSERT INTO emperor_agent_events";
    await expect(f.bridge.publish(f.identity, f.target, source.sourceHash, "product_info", async () => {})).rejects.toThrow();
    expect(f.state).toEqual(before);
  });
});
