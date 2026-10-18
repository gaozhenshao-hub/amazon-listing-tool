import { describe, expect, it } from "vitest";
import { createImagePlanningTestFixture, planningOperation, planningApplyOperation } from "./imagePlanning.testFixture";
import { createImagePlanningProcessor } from "./imagePlanningWorker";
import { imagePlanningHash } from "../../../../shared/imagePlanning";

async function ready() {
  const f = createImagePlanningTestFixture(), submitted = await f.submitted();
  const process = createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled });
  await process({ id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation });
  const run = (await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run!;
  return { ...f, submitted, run, process };
}
describe("image planning actual source / runtime / SQL / processor composition", () => {
  it("freezes whole source and saved policy, dispatches once only after durable ACK and keeps the session unchanged", async () => {
    const f = await ready(); expect(f.run.state).toBe("succeeded"); expect(f.run.candidate?.secondaryImages).toHaveLength(6); expect(f.run.candidate?.aPlusModules).toHaveLength(7);
    expect(f.providerContexts).toHaveLength(1); expect(f.providerContexts[0]).toContain("SYNTHETIC_SAVED_RULE"); expect(f.providerContexts[0]).toContain("SYNTHETIC_SAVED_IMAGE_INSTRUCTION");
    expect(f.events.indexOf("checkpoint:dispatched")).toBeLessThan(f.events.indexOf("provider_called"));
    expect(f.events.slice(f.events.indexOf("checkpoint:dispatched"), f.events.indexOf("provider_called"))).toContain("commit_ack");
    expect(f.state.sourceTables.image_workflow_sessions[0].step2UserEdit).toBeNull(); expect(f.state.artifacts).toHaveLength(2);
    expect(f.state.jobs[0]).toMatchObject({ maxAttempts: 1, kind: "image.workflow.outline.v1", projectId: 8, userId: 3, workspaceId: 7 });
    await f.process({ id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation }); expect(f.providerContexts).toHaveLength(1);
  });
  it("applies the full candidate under source/session CAS without confirming and retains independent immutable apply proof", async () => {
    const f = await ready(), input = { ...f.scope, operationId: planningApplyOperation, runOperationId: planningOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash!, replaceDraftConfirmed: true as const };
    const receipt = await f.repository.apply(f.identity, input);
    expect(receipt).toMatchObject({ status: "committed", requestHash: imagePlanningHash({ identity: f.identity, request: input }), resultHash: f.run.resultHash });
    expect(f.state.sourceTables.image_workflow_sessions[0].step2Confirmed).toBe(0);
    expect(f.state.version).toBe(f.run.source.scopeRevision + 1);
    expect(JSON.parse(String(f.state.sourceTables.image_workflow_sessions[0].step2UserEdit))).toEqual(f.run.candidate);
    expect(f.state.artifacts).toHaveLength(3); expect(await f.repository.apply(f.identity, input)).toEqual(receipt);
  });
  it("preserves original UUID on start and apply commit ACK loss", async () => {
    const f = createImagePlanningTestFixture(); f.control.ackLostOn = "INSERT INTO ai_jobs";
    await expect(f.submitted()).rejects.toMatchObject({ code: "OUTCOME_UNVERIFIED" });
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("queued");
    const r = await ready(); r.control.ackLostOn = "UPDATE image_workflow_sessions";
    await expect(r.repository.apply(r.identity, { ...r.scope, operationId: planningApplyOperation, runOperationId: planningOperation, expectedSourceHash: r.run.sourceHash, expectedResultHash: r.run.resultHash!, replaceDraftConfirmed: true })).rejects.toMatchObject({ code: "OUTCOME_UNVERIFIED" });
    expect((await r.repository.applyCheck(r.identity, { ...r.scope, operationId: planningApplyOperation, runOperationId: planningOperation }))?.status).toBe("committed");
  });
  it("rejects changed source, human confirmation and permission before model or apply", async () => {
    const f = await ready(); f.state.sourceTables.projects[0].brand = "CHANGED";
    await expect(f.repository.apply(f.identity, { ...f.scope, operationId: planningApplyOperation, runOperationId: planningOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash!, replaceDraftConfirmed: true })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(f.state.sourceTables.image_workflow_sessions[0].step2UserEdit).toBeNull(); f.control.deny = true;
    await expect(f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("unknown provider outcome cannot start a new operation until explicit original cancellation", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted(); f.control.modelThrows = true;
    const process = createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled });
    const hint = { id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation };
    await process(hint); expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("outcome_unknown");
    await process(hint); expect(f.providerContexts).toHaveLength(1);
    await expect(f.submitted(planningApplyOperation)).rejects.toMatchObject({ code: "ACTIVE_OPERATION_EXISTS" });
    f.control.enabled = false; expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("canceled");
  });
  it.each(["stop", "flagoff"])("paid legal reply persists locally after %s without second dispatch", async kind => {
    const f = createImagePlanningTestFixture(); await f.submitted(); const abort = new AbortController();
    f.control.afterPaid = async () => { if (kind === "stop") abort.abort(); else f.control.enabled = false; };
    await createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled })({ id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation }, abort.signal);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("succeeded"); expect(f.providerContexts).toHaveLength(1);
  });
  it("explicit cancellation during the slow paid response wins and candidate cannot overwrite it", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted(); f.control.afterPaid = async () => { await f.repository.cancel(f.identity, { ...f.scope, operationId: planningOperation }); };
    await createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled })({ id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation });
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("canceled"); expect(f.state.artifacts).toHaveLength(1);
  });
  it("a paid reply cannot bypass a freshly revoked actor and is never dispatched again on recovery", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted(); f.control.afterPaid = async () => { f.control.actorStatus = "inactive"; };
    const process = createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => true });
    const hint = { id: 1, ...f.identity, projectId: 8, sessionId: 9, operationId: planningOperation };
    await process(hint); expect(f.state.artifacts).toHaveLength(1); expect(f.providerContexts).toHaveLength(1);
    f.control.actorStatus = "active"; f.control.now += 121; await process(hint);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("outcome_unknown"); expect(f.providerContexts).toHaveLength(1);
  });
  it("default-disabled new work does not remove check/cancel recovery or bypass an early cancel fence", async () => {
    const f = createImagePlanningTestFixture(); f.control.enabled = false;
    expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: planningOperation })).receipt?.status).toBe("cancelled"); f.control.enabled = true;
    await expect(f.submitted()).rejects.toMatchObject({ code: "OPERATION_CANCELED" }); expect(f.state.jobs).toHaveLength(0);
  });
  it.each(["duplicate", "source_limit", "snapshot_limit", "unconfirmed", "step0_unlocked", "downstream_confirmed", "foreign_session", "bad_schema", "unverified_snapshot"])("fails closed for %s without partial capture", async kind => {
    const f = createImagePlanningTestFixture();
    if (kind === "duplicate") f.state.sourceTables.projects.push({ ...f.state.sourceTables.projects[0] });
    if (kind === "source_limit") f.state.sourceTables.projects[0].productFeatures = "x".repeat(2097153);
    if (kind === "snapshot_limit") f.state.snapshots[0].contentJson = JSON.stringify({ huge: "x".repeat(2097153) });
    if (kind === "unconfirmed") f.state.sourceTables.image_workflow_sessions[0].step1Confirmed = 0;
    if (kind === "step0_unlocked") f.state.sourceTables.image_workflow_sessions[0].step0Confirmed = 0;
    if (kind === "downstream_confirmed") f.state.snapshots.push({ ...f.state.snapshots[1], step: 3, state: "confirmed" });
    if (kind === "foreign_session") f.state.sourceTables.image_workflow_sessions[0].userId = 4;
    if (kind === "bad_schema") f.columns.get("image_workflow_sessions")!.pop();
    if (kind === "unverified_snapshot") f.state.snapshots[0].snapshotDigest = "a".repeat(64);
    await expect(f.submitted()).rejects.toBeInstanceOf(Error); expect(f.state.jobs).toHaveLength(0); expect(f.providerContexts).toHaveLength(0);
  });
  it.each(["projectFiles", "competitorAnalyses", "competitorComparisonReports", "keywords", "listings", "reviewAggregations", "image_workflow_step0_artifacts"])("requires transactional source table %s", async table => {
    const f = createImagePlanningTestFixture(); f.control.nonTransactionalTable = table;
    await expect(f.submitted()).rejects.toMatchObject({ code: "SCHEMA_UNAVAILABLE" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("guards every snapshot column in SQL before fetching native JSON instead of selecting s.*", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted();
    const query = f.calls.find(call => call.sql.includes("FROM image_workflow_stage_snapshots") && call.sql.includes("s.step IN"))!.sql;
    expect(query).not.toContain("s.*");
    for (const column of ["contentJson", "assetDependenciesJson", "dependenciesJson"]) expect(query).toContain(`s.\`${column}\`,NULL) AS \`${column}\``);
    expect(query).toContain("<=2097152"); expect(query).toContain("AS __sourceBytes");
  });
  it("retains every saved legacy aggregate in internal capture and source hash, even when it is not safe model evidence", async () => {
    const f = createImagePlanningTestFixture(); f.state.sourceTables.reviewAggregations = [{ id: 91, projectId: 8, userId: 3, status: "completed", result: "ORIGINAL_AGGREGATE" }];
    const first = await f.repository.readSource(f.identity, f.scope); expect(first.otherSources).toContainEqual({ kind: "legacy_review_aggregation", row: f.state.sourceTables.reviewAggregations[0] });
    f.state.sourceTables.reviewAggregations[0].result = "REVISED_AGGREGATE";
    expect((await f.repository.readSource(f.identity, f.scope)).sourceHash).not.toBe(first.sourceHash);
  });
  it("does not overwrite a later confirmed downstream stage when applying a paid candidate", async () => {
    const f = await ready(); f.state.sourceTables.image_workflow_sessions[0].step3Confirmed = 1;
    await expect(f.repository.apply(f.identity, { ...f.scope, operationId: planningApplyOperation, runOperationId: planningOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash!, replaceDraftConfirmed: true })).rejects.toBeInstanceOf(Error);
    expect(f.state.sourceTables.image_workflow_sessions[0].step2UserEdit).toBeNull(); expect(f.state.version).toBe(2);
  });
  it("rolls back candidate/apply warning or readback failure without mutating prior draft", async () => {
    const f = await ready(); const before = structuredClone(f.state); f.control.warning = true;
    await expect(f.repository.apply(f.identity, { ...f.scope, operationId: planningApplyOperation, runOperationId: planningOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash!, replaceDraftConfirmed: true })).rejects.toMatchObject({ code: "WRITE_UNCONFIRMED" });
    expect(f.state).toEqual(before);
  });
});
