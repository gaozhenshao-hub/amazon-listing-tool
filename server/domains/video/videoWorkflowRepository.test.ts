import { describe, expect, it } from "vitest";
import { VideoWorkflowOperationSchema, parseVideoWorkflowCandidate, videoWorkflowHash, type VideoWorkflowOperation } from "../../../shared/videoWorkflow";
import { createVideoWorkflowTestFixture, videoOperation, videoApplyOperation } from "./videoWorkflow.testFixture";
import { createVideoWorkflowProcessor } from "./videoWorkflowWorker";

function processor(f: ReturnType<typeof createVideoWorkflowTestFixture>) {
  return createVideoWorkflowProcessor({ repository: f.repository, runtimes: Object.fromEntries(VideoWorkflowOperationSchema.options.map(operation => [operation, f.runtime])) as Record<VideoWorkflowOperation, typeof f.runtime>,
    loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled });
}
const hint = { id: 101, workspaceId: 7, userId: 3, projectId: 8, videoScriptId: 9, operationId: videoOperation };
async function ready(operation: VideoWorkflowOperation = "sections") {
  const f = createVideoWorkflowTestFixture(operation), submitted = await f.submitted(), process = processor(f); await process(hint);
  const run = (await f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).run!;
  return { ...f, submitted, process, run };
}
const applyInput = (f: Awaited<ReturnType<typeof ready>>) => ({ ...f.scope, operationId: videoApplyOperation, runOperationId: videoOperation,
  expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash!, replaceConfirmed: true, confirmHumanReview: true as const });
describe("video seven operations actual SQL protocol and immutable candidate pipeline", () => {
  it.each(VideoWorkflowOperationSchema.options)("%s dispatches once and retains full candidate without changing script", async operation => {
    const f = await ready(operation);
    expect(f.run.state).toBe("succeeded"); expect(f.run.candidate).toEqual(parseVideoWorkflowCandidate(operation, f.candidate));
    expect(f.state.sourceTables.video_scripts[0].version).toBe(1); expect(f.state.artifacts).toHaveLength(2);
    expect(f.events.indexOf("checkpoint:dispatched")).toBeLessThan(f.events.indexOf("provider_called"));
    expect(f.events.slice(f.events.indexOf("checkpoint:dispatched"), f.events.indexOf("provider_called"))).toContain("commit_ack");
    expect(f.providerContexts[0]).toContain("SYNTHETIC_SAVED_RULE"); await f.process(hint); expect(f.providerContexts).toHaveLength(1);
  });
  it.each(VideoWorkflowOperationSchema.options)("%s human apply is atomic and preserves complete original version and fixed receipt", async operation => {
    const f = await ready(operation), before = structuredClone(f.state.sourceTables), input = applyInput(f), receipt = await f.repository.apply(f.identity, input);
    expect(receipt.status).toBe("committed"); expect(receipt.version).toBe(2); expect(receipt.requestHash).toBe(videoWorkflowHash({ identity: f.identity, request: input }));
    expect(f.state.sourceTables.video_scripts[0].version).toBe(2); expect(f.state.sourceTables.video_script_versions).toHaveLength(1);
    const original = f.state.sourceTables.video_script_versions[0].snapshotData as { tables: Record<string, unknown> };
    expect(original.tables.video_script_shots).toEqual(before.video_script_shots);
    expect(await f.repository.apply(f.identity, input)).toEqual(receipt); expect(f.state.artifacts).toHaveLength(4);
    expect(f.state.sourceTables.emperor_agent_checkpoints).toHaveLength(6);
    expect(f.state.artifacts.find(row => row.artifactKey === "video.script")?.isCurrent).toBe(1);
  });
  it("start replay precedes current configuration/source re-resolution and preserves original snapshot", async () => {
    const f = createVideoWorkflowTestFixture(), first = await f.submitted(); f.configuration.config.enabled = false; f.state.sourceTables.projects[0].name = "changed";
    expect((await f.repository.reserve(f.identity, first.input, async () => { throw new Error("MUST_NOT_RESOLVE"); })).runId).toBe(first.run.runId);
    await expect(f.repository.reserve(f.identity, { ...first.input, maxCostCents: 101 }, f.prepare())).rejects.toMatchObject({ code: "OPERATION_CONTENT_CONFLICT" });
  });
  it("commit ACK loss recovers original UUID without new reservation or provider", async () => {
    const f = createVideoWorkflowTestFixture(); f.control.ackLostOn = "INSERT INTO ai_jobs";
    await expect(f.submitted()).rejects.toMatchObject({ code: "OUTCOME_UNVERIFIED" });
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).run?.state).toBe("queued"); expect(f.providerContexts).toHaveLength(0);
  });
  it("unknown dispatch is permanently non-retryable until explicit same UUID cancellation", async () => {
    const f = createVideoWorkflowTestFixture(); await f.submitted(); f.control.modelThrows = true; const process = processor(f); await process(hint); await process(hint);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).run?.state).toBe("outcome_unknown"); expect(f.providerContexts).toHaveLength(1);
    await expect(f.submitted(videoApplyOperation)).rejects.toMatchObject({ code: "ACTIVE_OPERATION_EXISTS" });
    f.control.enabled = false; expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: videoOperation })).run?.state).toBe("canceled");
  });
  it.each(["stop", "flagoff"])("paid returned candidate survives %s with no second call", async mode => {
    const f = createVideoWorkflowTestFixture(); await f.submitted(); const controller = new AbortController();
    f.control.afterPaid = async () => { if (mode === "stop") controller.abort(); else f.control.enabled = false; };
    await processor(f)(hint, controller.signal); expect((await f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).run?.state).toBe("succeeded");
  });
  it("cancellation while provider response is in flight prevents candidate publication", async () => {
    const f = createVideoWorkflowTestFixture(); await f.submitted(); f.control.afterPaid = async () => { await f.repository.cancel(f.identity, { ...f.scope, operationId: videoOperation }); };
    await processor(f)(hint); expect((await f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).run?.state).toBe("canceled"); expect(f.state.artifacts).toHaveLength(1);
  });
  it("source or fresh authority changes cannot publish or expose private candidate", async () => {
    const f = await ready(); f.state.sourceTables.projects[0].name = "changed";
    await expect(f.repository.apply(f.identity, applyInput(f))).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    f.control.deny = true; await expect(f.repository.check(f.identity, { ...f.scope, operationId: videoOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("warnings roll back all rows, before version, candidate revision and final audit", async () => {
    const f = await ready(), before = structuredClone(f.state); f.control.warning = true;
    await expect(f.repository.apply(f.identity, applyInput(f))).rejects.toBeInstanceOf(Error); expect(f.state).toEqual(before);
  });
  it("apply ACK loss and flag-off recovery return same immutable final", async () => {
    const f = await ready(); f.control.ackLostOn = "UPDATE video_scripts";
    await expect(f.repository.apply(f.identity, applyInput(f))).rejects.toMatchObject({ code: "OUTCOME_UNVERIFIED" }); f.control.enabled = false;
    expect((await f.repository.applyCheck(f.identity, { ...f.scope, operationId: videoApplyOperation, runOperationId: videoOperation }))?.status).toBe("committed");
    expect(f.state.sourceTables.video_scripts[0].version).toBe(2);
  });
  it("cancel-before-start and cancel-before-apply retain separate durable tombstones", async () => {
    const f = createVideoWorkflowTestFixture(); await f.repository.cancel(f.identity, { ...f.scope, operationId: videoOperation });
    await expect(f.submitted()).rejects.toMatchObject({ code: "OPERATION_CANCELED" });
    const r = await ready(); await r.repository.applyCancel(r.identity, { ...r.scope, operationId: videoApplyOperation, runOperationId: videoOperation });
    await expect(r.repository.apply(r.identity, applyInput(r))).rejects.toMatchObject({ code: "OPERATION_CONTENT_CONFLICT" });
    expect(r.state.sourceTables.video_scripts[0].version).toBe(1);
  });
  it.each(["schema", "engine", "scope", "unconfirmed", "duplicate", "oversize"])("rejects incomplete %s without source truncation", async kind => {
    const f = createVideoWorkflowTestFixture();
    if (kind === "schema") f.columns.get("video_scripts")!.pop(); if (kind === "engine") f.control.engine = "MyISAM";
    if (kind === "scope") f.state.sourceTables.projects[0].workspaceId = 8;
    if (kind === "unconfirmed") (f.state.sourceTables.video_scripts[0].stageStatus as Record<string, unknown>).stage_0b = "pending";
    if (kind === "duplicate") f.state.sourceTables.video_scripts.push({ ...f.state.sourceTables.video_scripts[0] });
    if (kind === "oversize") f.state.sourceTables.video_competitor_scripts[0].rawContent = "x".repeat(8 * 1024 * 1024 + 1);
    await expect(f.submitted()).rejects.toBeInstanceOf(Error); expect(f.state.jobs).toHaveLength(0);
  });
});
