import { describe, expect, it } from "vitest";
import { createVideoWorkflowTestFixture } from "./videoWorkflow.testFixture";
import { captureVideoWorkflowTables } from "./videoWorkflowSource";
import { projectVideoWorkflowAgent, videoWorkflowArtifactMatchesScript } from "./videoWorkflowAgentProjection";
import { VIDEO_STAGE_NODE_MAP } from "./videoWorkflowDag";

describe("same transaction video Agent human-gate and formal artifact projection (SQL protocol fixture)", () => {
  it("projects actual six nodes and current formal artifact without calling an external runner", async () => {
    const f = createVideoWorkflowTestFixture(), tables = await captureVideoWorkflowTables(f.tx, f.scope);
    const result = await f.database.transaction(tx => projectVideoWorkflowAgent(tx, f.identity, f.scope, tables, true, "stage_1"));
    expect(f.state.sourceTables.emperor_agent_runs[0].runId).toBe(result.agentRunId);
    const gates = f.state.sourceTables.emperor_agent_checkpoints;
    expect(gates.map(row => row.nodeId)).toEqual(Object.values(VIDEO_STAGE_NODE_MAP));
    expect(gates.find(row => row.nodeId === "section_planning")).toMatchObject({ status: "confirmed", reviewerUserId: 3 });
    expect(gates.find(row => row.nodeId === "product_information")).toMatchObject({ status: "confirmed", reviewerUserId: null, confirmedAt: null });
    expect(f.state.sourceTables.emperor_agent_artifacts.filter(row => row.status === "final")).toHaveLength(5);
    expect(f.state.artifacts[0]).toMatchObject({ artifactKey: "video.script", version: 1, isCurrent: 1, status: "final" });
    expect((f.state.artifacts[0].contentJson as Record<string, unknown>).script).toEqual(tables.video_scripts[0]);
    expect(f.providerContexts).toEqual([]);
  });
  it("reuses the exact run and invalidates changed descendants while preserving older reviewer and review time", async () => {
    const f = createVideoWorkflowTestFixture();
    await f.database.transaction(async tx => projectVideoWorkflowAgent(tx, f.identity, f.scope, await captureVideoWorkflowTables(tx, f.scope), true, "stage_1"));
    const gate = f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "section_planning")!;
    gate.reviewerUserId = 77; gate.confirmedAt = new Date("2026-01-01T00:00:00.000Z");
    const originalGate = structuredClone(gate);
    f.state.sourceTables.video_scripts[0].version = 2;
    (f.state.sourceTables.video_scripts[0].stageStatus as Record<string, unknown>).stage_3 = "stale";
    const beforeArtifacts = f.state.sourceTables.emperor_agent_artifacts.length;
    await f.database.transaction(async tx => projectVideoWorkflowAgent(tx, f.identity, f.scope, await captureVideoWorkflowTables(tx, f.scope), false));
    expect(f.state.sourceTables.emperor_agent_runs).toHaveLength(1);
    expect(gate.reviewerUserId).toBe(originalGate.reviewerUserId); expect(gate.confirmedAt).toEqual(originalGate.confirmedAt);
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "shot_storyboard")).toMatchObject({ status: "waiting_human", reviewerUserId: null, confirmedAt: null });
    expect(f.state.sourceTables.emperor_agent_artifacts).toHaveLength(beforeArtifacts + 6);
    expect(f.state.artifacts[0]).toMatchObject({ isCurrent: 0, status: "superseded" });
    expect(f.state.artifacts[1]).toMatchObject({ isCurrent: 0, status: "draft", version: 2 });
  });
  it("only explicitly reconfirmed stage receives a new review identity/time", async () => {
    const f = createVideoWorkflowTestFixture();
    await f.database.transaction(async tx => projectVideoWorkflowAgent(tx, f.identity, f.scope, await captureVideoWorkflowTables(tx, f.scope), true, "stage_0b"));
    const first = f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "product_information")!;
    first.reviewerUserId = 88; const reviewedAt = first.confirmedAt;
    f.state.sourceTables.video_scripts[0].version = 2;
    await f.database.transaction(async tx => projectVideoWorkflowAgent(tx, f.identity, f.scope, await captureVideoWorkflowTables(tx, f.scope), true, "stage_1"));
    expect(first.reviewerUserId).toBe(88); expect(first.confirmedAt).toEqual(reviewedAt);
    expect(f.state.sourceTables.emperor_agent_checkpoints.find(row => row.nodeId === "section_planning")).toMatchObject({ reviewerUserId: 3 });
  });
  it("a projection write failure rolls back all newly created gates/artifacts instead of returning business success", async () => {
    const f = createVideoWorkflowTestFixture(), before = structuredClone(f.state);
    f.control.failWrite = "INSERT INTO emperor_agent_events";
    await expect(f.database.transaction(async tx => {
      f.state.sourceTables.video_scripts[0].version = 2;
      await projectVideoWorkflowAgent(tx, f.identity, f.scope, await captureVideoWorkflowTables(tx, f.scope), true, "stage_1");
    })).rejects.toThrow();
    expect(f.state).toEqual(before);
  });
  it("readback and transactional engine failures cannot silently lose the old DAG", async () => {
    const f = createVideoWorkflowTestFixture(); f.control.nonTransactionalTable = "emperor_agent_checkpoints";
    await expect(projectVideoWorkflowAgent(f.tx, f.identity, f.scope, await captureVideoWorkflowTables(f.tx, f.scope), true)).rejects.toMatchObject({ code: "AGENT_PROJECTION_UNAVAILABLE" });
    expect(f.state.sourceTables.emperor_agent_runs).toHaveLength(0);
  });
  it("formal overlay is exact script version and scope bound; rollback/history cannot shadow a newer edit", () => {
    const script = { id: 9, projectId: 8, userId: 3, version: 2 };
    expect(videoWorkflowArtifactMatchesScript({ content: { script } }, script)).toBe(true);
    for (const patch of [{ version: 1 }, { id: 10 }, { projectId: 11 }, { userId: 4 }]) {
      expect(videoWorkflowArtifactMatchesScript({ content: { script: { ...script, ...patch } } }, script)).toBe(false);
    }
    expect(videoWorkflowArtifactMatchesScript({ content: {} }, script)).toBe(false);
  });
});
