import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { imageTaggingHash, IMAGE_TAGGING_TAG_FIELDS } from "../../../shared/imageTagging";
import { createImageTaggingTestFixture, taggingOperation, taggingOtherOperation, taggingApplyOperation, syntheticTaggingCandidate } from "./imageTagging.testFixture";
import { createImageTaggingRepository, ImageTaggingRepositoryError, type ImageTaggingLease } from "./imageTaggingRepository";
import { createImageTaggingSourceCapture } from "./imageTaggingSource";
import { createManualImageWorkflowProjectionTestFixture } from "../acquisition/manualImageWorkflowProjection.testFixture";
import { getManualSnapshotPublication } from "../acquisition/manualSnapshotPublication";

export async function imageTaggingDispatchFixture(f: ReturnType<typeof createImageTaggingTestFixture>, lease: ImageTaggingLease, imageId = 9) {
  const run = await f.repository.readLease(lease), image = run.source.images.find(item => item.id === imageId)!;
  const evidence = { imageId, imageSetId: image.imageSetId, imageRevision: image.revisionHash, sourceUrlRef: image.imageUrl,
    contentHash: f.sha(f.bytes), byteSize: f.bytes.length, contentType: "image/png" as const };
  const prepared = await f.repository.prepareStage(lease, (executor, current, source) => f.runtime.prepareStage({ executor, identity: f.identity, operationId: taggingOperation,
    configuration: f.configuration, sourceHash: source.sourceHash, imageCount: current.runtimeSnapshot.imageCount, runtimeSnapshot: current.runtimeSnapshot, evidence, originalBytes: f.bytes }));
  const receipt = { runId: `synthetic-paid-${imageId}`, stage: "image_tagging" as const, requestHash: prepared.providerRequestHash,
    modelConfigurationHash: run.runtimeSnapshot.model.configurationHash, bindingHash: prepared.bindingHash, budget: prepared.budget };
  const input = { imageId, evidence, prepared, receipt };
  const verify = async (executor: typeof f.tx, current: typeof run, source: typeof run.source) => f.runtime.revalidate({ executor, identity: f.identity, operationId: taggingOperation,
    configuration: f.configuration, sourceHash: source.sourceHash, imageCount: current.runtimeSnapshot.imageCount, runtimeSnapshot: current.runtimeSnapshot });
  return { run, evidence, prepared, receipt, input, verify,
    result: { imageId, stage: "image_tagging" as const, candidate: syntheticTaggingCandidate, runId: receipt.runId, contextHash: prepared.contextHash,
      bindingHash: prepared.bindingHash, snapshotHash: prepared.snapshotHash, evidenceHash: prepared.evidenceHash, providerRequestHash: prepared.providerRequestHash, auditWarnings: [] } };
}
async function claimed() { const f = createImageTaggingTestFixture(), reserved = await f.submitted(); const lease = await f.repository.claim(f.identity, { ...f.scope, operationId: taggingOperation }, "worker"); expect(lease).not.toBeNull(); return { ...f, reserved, lease: lease! }; }
async function ready() {
  const f = await claimed();
  for (const imageId of [9, 10]) { const d = await imageTaggingDispatchFixture(f, f.lease, imageId); await f.repository.dispatch(f.lease, d.input, d.verify); await f.repository.candidate(f.lease, d.result); }
  const run = (await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).run!; return { ...f, run };
}
describe("image tagging dedicated durable SQL protocol", () => {
  it("captures the whole owned set with real source adapter and freezes runtime/source before queued ACK", async () => {
    const f = createImageTaggingTestFixture(), before = structuredClone(f.state.images), { input, run } = await f.submitted();
    expect(run).toMatchObject({ identity: f.identity, imageSetId: 5, operationId: taggingOperation, state: "queued", requestHash: imageTaggingHash({ identity: f.identity, request: input }) });
    expect(run.source.images).toHaveLength(2); expect(run.runtimeSnapshot.imageCount).toBe(2); expect(f.state.jobs[0]).toMatchObject({ kind: "knowledge.image_tagging.v1", projectId: null, userId: 3, workspaceId: 7, maxAttempts: 1 });
    expect(f.state.images).toEqual(before); expect(f.state.artifacts).toHaveLength(1); expect(f.state.audits).toHaveLength(1);
    expect(f.state.artifacts[0]).toMatchObject({ isCurrent: 0, projectId: null, userId: 3, workspaceId: 7, status: "draft" });
    const writes = f.calls.filter(call => !call.sql.startsWith("SELECT")); expect(JSON.stringify(writes)).not.toMatch(/base64|data:image/u);
    expect(f.calls.filter(call => call.sql.includes("FROM kb_images")).every(call => call.sql.includes("LIMIT 301 FOR UPDATE"))).toBe(true);
  });
  it("same UUID is idempotent and a changed request cannot spend another call", async () => {
    const f = createImageTaggingTestFixture(), { input, run } = await f.submitted();
    expect((await f.repository.reserve(f.identity, input, async () => { throw new Error("MUST_NOT_PREPARE_AGAIN"); })).runId).toBe(run.runId);
    await expect(f.repository.reserve(f.identity, { ...input, maxCostCents: input.maxCostCents + 1 }, f.prepare())).rejects.toMatchObject({ code: "OPERATION_CONTENT_CONFLICT" });
    expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(1);
  });
  it("commit ACK loss recovers original UUID without resubmitting or duplicating immutable source", async () => {
    const f = createImageTaggingTestFixture(); f.control.ackLostOn = "INSERT INTO ai_jobs";
    await expect(f.submitted()).rejects.toMatchObject({ code: "OUTCOME_UNVERIFIED", outcomeUnknown: true });
    const checked = await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation });
    expect(checked.run?.state).toBe("queued"); expect(checked.receipt?.status).toBe("reserved"); expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(1);
  });
  it("active set fence rejects a different operation UUID", async () => {
    const f = createImageTaggingTestFixture(); await f.submitted();
    await expect(f.submitted(taggingOtherOperation)).rejects.toMatchObject({ code: "ACTIVE_OPERATION_EXISTS" }); expect(f.state.jobs).toHaveLength(1);
  });
  it.each(["source", "runtime", "cost"])("rejects changed %s consent before queuing any paid work", async kind => {
    const f = createImageTaggingTestFixture(), preview = await f.repository.preview(f.identity, { ...f.scope, operationId: taggingOperation, mode: "missing" }, f.prepare());
    const input = { ...f.scope, operationId: taggingOperation, mode: "missing" as const, expectedSourceHash: preview.source.sourceHash,
      expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: 200, chargeConfirmed: true as const };
    if (kind === "source") input.expectedSourceHash = "0".repeat(64); if (kind === "runtime") input.expectedRuntimeHash = "0".repeat(64); if (kind === "cost") input.maxCostCents = 199;
    await expect(f.repository.reserve(f.identity, input, f.prepare())).rejects.toBeInstanceOf(ImageTaggingRepositoryError);
    expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0);
  });
  it("same operation UUID cannot be read, canceled or applied in another owned set", async () => {
    const f = createImageTaggingTestFixture(); await f.submitted(); f.state.sets.push({ ...f.state.sets[0], id: 6 });
    await expect(f.repository.check(f.identity, { ...f.scope, imageSetId: 6, operationId: taggingOperation })).rejects.toMatchObject({ code: "OPERATION_SCOPE_MISMATCH" });
    await expect(f.repository.cancel(f.identity, { ...f.scope, imageSetId: 6, operationId: taggingOperation })).rejects.toMatchObject({ code: "OPERATION_SCOPE_MISMATCH" });
    expect(f.state.jobs[0].status).toBe("queued");
  });
  it("pre-start cancel is a permanent original-UUID fence even with write flags off", async () => {
    const f = createImageTaggingTestFixture(); f.control.enabled = false;
    const canceled = await f.repository.cancel(f.identity, { ...f.scope, operationId: taggingOperation }); expect(canceled.receipt?.status).toBe("canceled");
    f.control.enabled = true; await expect(f.submitted()).rejects.toMatchObject({ code: "OPERATION_CANCELED" }); expect(f.state.jobs).toHaveLength(0);
  });
  it.each(["workspaceStatus", "actorStatus", "memberStatus"] as const)("fresh %s revocation blocks check and start", async field => {
    const f = createImageTaggingTestFixture(); await f.submitted(); f.control[field] = "disabled";
    await expect(f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("revoked agent authority stops new paid work but KB owner can still check/cancel", async () => {
    const f = createImageTaggingTestFixture(); await f.submitted(); f.control.agentDenied = true; f.control.enabled = false;
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).run?.state).toBe("queued");
    expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: taggingOperation })).run?.state).toBe("canceled");
    await expect(f.repository.preview(f.identity, { ...f.scope, operationId: taggingOtherOperation, mode: "missing" }, f.prepare(taggingOtherOperation))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("owned team/public source is allowed without allowing another owner's set", async () => {
    const f = createImageTaggingTestFixture(); f.state.sets[0].visibility = "team"; expect((await f.submitted()).run.source.set.visibility).toBe("team");
    f.state.sets[0].userId = 99; await expect(f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("manual source cannot bypass durable publication proof", async () => {
    const f = createImageTaggingTestFixture(); f.state.sets[0].origin_instance_id = "manual_acquisition_review_v1"; f.state.sets[0].remote_id = 123;
    await expect(f.submitted()).rejects.toBeInstanceOf(ImageTaggingRepositoryError); expect(f.control.manualProofCalls).toBe(1); expect(f.state.jobs).toHaveLength(0);
  });
  it("missing means null, confirmed/analysis-confirmed rows never become paid pending", async () => {
    const f = createImageTaggingTestFixture(); f.state.images[0].tagCategory = ""; f.state.images[0].tagImageTypeMain = ""; f.state.images[0].tagDesignStyleV2 = "";
    const preview = await f.repository.preview(f.identity, { ...f.scope, operationId: taggingOperation, mode: "missing" }, f.prepare());
    expect(preview.stages.map(stage => stage.state)).toEqual(["skipped_complete", "pending"]); expect(preview.runtimeSnapshot.imageCount).toBe(1);
    f.state.images[1].analysisConfirmed = 1; await expect(f.submitted()).rejects.toMatchObject({ code: "NO_ELIGIBLE_IMAGES" });
    expect(f.state.jobs).toHaveLength(0);
  });
  it("captures all 300 images and rejects 301 rather than truncating a collection", async () => {
    const f = createImageTaggingTestFixture(), first = structuredClone(f.state.images[0]);
    f.state.images.splice(0, f.state.images.length, ...Array.from({ length: 300 }, (_, index) => ({ ...first, id: index + 9, positionIndex: index })));
    const source = await f.repository.readSource(f.identity, f.scope); expect(source.images).toHaveLength(300); expect(source.images.at(-1)?.id).toBe(308);
    f.state.images.push({ ...first, id: 309, positionIndex: 300 });
    await expect(f.repository.readSource(f.identity, f.scope)).rejects.toBeInstanceOf(ImageTaggingRepositoryError); expect(f.state.jobs).toHaveLength(0);
  });
  it.each(["0", "1", true, null, 2])("does not coerce invalid confirmed flag %s into an unconfirmed paid row", async flag => {
    const f = createImageTaggingTestFixture(); f.state.images[0].tagsConfirmed = flag;
    await expect(f.submitted()).rejects.toBeInstanceOf(ImageTaggingRepositoryError); expect(f.state.jobs).toHaveLength(0);
  });
  it("real review-confirm→durable replay→manual source runs in one tx and binds original pixels", async () => {
    const f = createImageTaggingTestFixture(), manual = createManualImageWorkflowProjectionTestFixture(), sequence: string[] = [], dialect = new MySqlDialect();
    manual.scope.expectedProjectId = null; manual.state.job.consumerType = "kb_images"; manual.state.job.consumerRef = `kb-images:US:${manual.state.job.asin}`;
    f.state.images[0].imageUrl = manual.state.assets[0].storageKey;
    Object.assign(manual.state.assets[0], { contentHash: f.sha(f.bytes), sizeBytes: f.bytes.length });
    manual.control.onPublish = async context => {
      const proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId)!;
      for (const capabilityScope of manual.state.job.requestedCapabilities) manual.state.links.push({ id: 701 + manual.state.links.length, workspaceId: f.identity.workspaceId,
        confirmedSnapshotId: context.confirmedSnapshotId, consumerType: "kb_images", consumerRef: manual.state.job.consumerRef, capabilityScope,
        projectionVersion: proof.sourceHash, status: "active", createdBy: f.identity.userId });
    };
    expect((await manual.save()).status).toBe("committed"); const confirmed = await manual.confirm(); expect(confirmed.status).toBe("committed");
    Object.assign(f.state.sets[0], { origin_instance_id: "manual_acquisition_review_v1", remote_id: confirmed.confirmedSnapshotId, sync_version: confirmed.revisionVersion });
    f.state.images.splice(1); const joined = { execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query); sequence.push(sql);
      if (sql.includes("acquisition_") || sql.includes("FROM security_audit_logs") && String(params[0]).startsWith("acqr_")) return manual.execute(query);
      return f.tx.execute(query);
    } };
    const repo = createImageTaggingRepository({ getDb: async () => ({ transaction: body => f.database.transaction(async () => body(joined)) }),
      capture: createImageTaggingSourceCapture().capture, permission: async () => {}, writesEnabled: () => f.control.enabled });
    const source = await repo.readSource(f.identity, f.scope); expect(source.images[0].originalContentHash).toBe(f.sha(f.bytes));
    const sourceLock = sequence.findIndex(sql => sql.includes("FROM acquisition_source_snapshots") && sql.includes("FOR SHARE")),
      kbLock = sequence.findIndex(sql => sql.includes("FROM kb_image_sets") && sql.includes("FOR UPDATE"));
    expect(sourceLock).toBeGreaterThan(-1); expect(kbLock).toBeGreaterThan(sourceLock);
    const preview = await repo.preview(f.identity, { ...f.scope, operationId: taggingOperation, mode: "missing" }, f.prepare());
    const run = await repo.reserve(f.identity, { ...f.scope, operationId: taggingOperation, mode: "missing", expectedSourceHash: preview.source.sourceHash,
      expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: 100, chargeConfirmed: true }, f.prepare());
    const lease = await repo.claim(f.identity, { ...f.scope, operationId: taggingOperation }, "worker"); expect(lease).not.toBeNull();
    const image = run.source.images[0], evidence = { imageId: image.id, imageSetId: image.imageSetId, imageRevision: image.revisionHash, sourceUrlRef: image.imageUrl,
      contentHash: "f".repeat(64), byteSize: f.bytes.length, contentType: "image/png" as const };
    // Strict originalContentHash is checked independently of a forged-looking
    // evidence hash or merely valid image signature by the durable repository.
    await expect(repo.dispatch(lease!, { imageId: image.id, evidence, prepared: { contextHash: "a".repeat(64), snapshotHash: run.runtimeSnapshot.snapshotHash,
      evidenceHash: imageTaggingHash(evidence), providerRequestHash: "b".repeat(64), bindingHash: "c".repeat(64), budget: { textBytes: 1, imageCount: 1, imageBytes: f.bytes.length, contextAdmissionUnits: 1, outputTokens: 1024, contextLimit: 200000, tokenEstimateIsExact: false } },
      receipt: { runId: "forged", stage: "image_tagging", requestHash: "b".repeat(64), modelConfigurationHash: run.runtimeSnapshot.model.configurationHash,
        bindingHash: "c".repeat(64), budget: { textBytes: 1, imageCount: 1, imageBytes: f.bytes.length, contextAdmissionUnits: 1, outputTokens: 1024, contextLimit: 200000, tokenEstimateIsExact: false } } }, async () => {})).rejects.toMatchObject({ code: "DISPATCH_BINDING_INVALID" });
    manual.state.links.forEach(link => { link.status = "superseded"; });
    await expect(repo.readSource(f.identity, f.scope)).rejects.toBeInstanceOf(ImageTaggingRepositoryError);
    expect(f.state.jobs).toHaveLength(1); expect(manual.state.confirmed).toHaveLength(1);
  });
  it.each(["engine", "trigger", "warning", "packet", "artifact", "job"])("rejects physical/ACK/readback admission fault: %s", async kind => {
    const f = createImageTaggingTestFixture();
    if (kind === "engine") f.control.engine = "MyISAM"; if (kind === "trigger") f.control.trigger = true;
    if (kind === "warning") f.control.warning = true; if (kind === "packet") f.control.packet = 1024;
    if (kind === "artifact" || kind === "job") f.control.badReadback = kind;
    await expect(f.submitted()).rejects.toBeInstanceOf(ImageTaggingRepositoryError); expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0); expect(f.state.audits).toHaveLength(0);
  });
  it("unknown nullable source columns are rejected, not dropped from complete row fingerprints", async () => {
    const f = createImageTaggingTestFixture(), known = f.columns.get("kb_images")![0];
    f.columns.get("kb_images")!.push({ ...known, name: "futureHumanEdit", columnName: "futureHumanEdit", nullable: "YES", isNullable: "YES", extra: "", defaultValue: null });
    await expect(f.repository.readSource(f.identity, f.scope)).rejects.toMatchObject({ code: "SCHEMA_UNAVAILABLE" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("immutable source artifact corruption is not treated as an empty or restartable run", async () => {
    const f = createImageTaggingTestFixture(); await f.submitted(); (f.state.artifacts[0].contentJson as { images: Array<{ imageUrl: string }> }).images[0].imageUrl = "https://arbitrary.invalid/changed";
    await expect(f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(1);
  });
  it("atomic lease claims once; pending-only restart resumes but never two current workers", async () => {
    const f = await claimed(); expect(await f.repository.claim(f.identity, { ...f.scope, operationId: taggingOperation }, "second")).toBeNull();
    f.control.now += 121; const next = await f.repository.claim(f.identity, { ...f.scope, operationId: taggingOperation }, "second"); expect(next).not.toBeNull();
    await expect(f.repository.heartbeat(f.lease)).rejects.toMatchObject({ code: "LEASE_LOST" });
  });
  it("dispatch is once only and its source/evidence/runtime receipts cannot be swapped", async () => {
    const f = await claimed(), d = await imageTaggingDispatchFixture(f, f.lease);
    await expect(f.repository.dispatch(f.lease, { ...d.input, evidence: { ...d.evidence, sourceUrlRef: "https://evil.invalid/arbitrary" } }, d.verify)).rejects.toMatchObject({ code: "DISPATCH_BINDING_INVALID" });
    await f.repository.dispatch(f.lease, d.input, d.verify);
    await expect(f.repository.dispatch(f.lease, d.input, d.verify)).rejects.toMatchObject({ code: "STAGE_ALREADY_DISPATCHED" });
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).run?.stages[0].state).toBe("dispatched");
  });
  it("expired dispatched stage becomes unknown, blocks another UUID, and never becomes re-dispatchable", async () => {
    const f = await claimed(), d = await imageTaggingDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.input, d.verify); f.control.now += 121;
    expect(await f.repository.claim(f.identity, { ...f.scope, operationId: taggingOperation }, "restart")).toBeNull();
    const run = (await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).run!;
    expect(run.state).toBe("unknown"); expect(run.stages[0].state).toBe("unknown"); await expect(f.submitted(taggingOtherOperation)).rejects.toMatchObject({ code: "ACTIVE_OPERATION_EXISTS" });
    expect((await f.repository.history(f.identity, f.scope)).operations[0].state).toBe("outcome_unknown");
    const historyQuery = f.calls.findLast(call => call.sql.includes("AS logicalState"))!.sql;
    expect(historyQuery).toContain("JSON_UNQUOTE(JSON_EXTRACT(output,'$.state')) AS logicalState"); expect(historyQuery).not.toContain("AS output");
    f.control.enabled = false; await f.repository.cancel(f.identity, { ...f.scope, operationId: taggingOperation }); expect(f.state.jobs[0].status).toBe("canceled");
  });
  it("paid candidate persists immutably after source edit, never touching old AI/human fields", async () => {
    const f = await claimed(), d = await imageTaggingDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.input, d.verify);
    f.state.images[0].tagCategory = "MANUAL_CONCURRENT_CHANGE"; const before = structuredClone(f.state.images);
    await f.repository.candidate(f.lease, d.result);
    expect(f.state.images).toEqual(before); const run = (await f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).run!;
    expect(run.candidates).toEqual([{ imageId: 9, candidateHash: imageTaggingHash(syntheticTaggingCandidate), candidate: syntheticTaggingCandidate }]);
    await expect(f.repository.candidate(f.lease, d.result)).rejects.toMatchObject({ code: "RESULT_CHECKPOINT_CONFLICT" }); expect(f.state.artifacts).toHaveLength(2);
  });
  it("explicit apply uses whole source/tag CAS, accepts edited labels, preserves old analysis, and can apply batches", async () => {
    const f = await ready(), before = structuredClone(f.state.images), source = await f.repository.readSource(f.identity, f.scope), tags = Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, ""])) as Record<typeof IMAGE_TAGGING_TAG_FIELDS[number], string>;
    const first = { ...f.scope, operationId: taggingApplyOperation, runOperationId: taggingOperation, expectedSourceHash: source.sourceHash, expectedResultHash: f.run.resultHash!, decisions: [{ imageId: 9, candidateHash: f.run.stages[0].candidateHash!, decision: "accept" as const, tags }] };
    const receipt = await f.repository.apply(f.identity, first); expect(receipt.status).toBe("committed"); expect(receipt.acceptedImageIds).toEqual([9]);
    expect(f.state.images[0]).toMatchObject({ tagsConfirmed: 1, tagImageType: "", tagColorScheme: "", tagDesignStyle: "", aiDimensionAnalysis: before[0].aiDimensionAnalysis, userEditedDimensionAnalysis: before[0].userEditedDimensionAnalysis });
    expect(f.state.images[1]).toEqual(before[1]); expect(await f.repository.apply(f.identity, first)).toEqual(receipt);
    const next = await f.repository.readSource(f.identity, f.scope);
    const second = await f.repository.apply(f.identity, { ...first, operationId: taggingOtherOperation, expectedSourceHash: next.sourceHash, decisions: [{ imageId: 10, candidateHash: f.run.stages[1].candidateHash!, decision: "exclude", tags: null }] });
    expect(second.excludedImageIds).toEqual([10]); expect(f.state.images[1]).toEqual(before[1]);
  });
  it("applied checkpoint must retain the exact immutable apply audit binding, not just a mutable after-row hash", async () => {
    const f = await ready(), source = await f.repository.readSource(f.identity, f.scope), tags = Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, ""])) as Record<typeof IMAGE_TAGGING_TAG_FIELDS[number], string>;
    await f.repository.apply(f.identity, { ...f.scope, operationId: taggingApplyOperation, runOperationId: taggingOperation, expectedSourceHash: source.sourceHash,
      expectedResultHash: f.run.resultHash!, decisions: [{ imageId: 9, candidateHash: f.run.stages[0].candidateHash!, decision: "accept", tags }] });
    const audit = f.state.audits.find(row => row.resourceId === taggingApplyOperation)!;
    const metadata = audit.metadata as { receipt: { afterImageRevisions: Array<{ revisionHash: string }> } };
    metadata.receipt.afterImageRevisions[0].revisionHash = "0".repeat(64);
    await expect(f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation })).rejects.toMatchObject({ code: "APPLY_BINDING_INVALID" });
    expect(f.state.images[0].tagsConfirmed).toBe(1); expect(f.state.images[1].tagsConfirmed).toBe(0);
  });
  it("concurrent edits or set membership changes reject all apply writes", async () => {
    for (const kind of ["tag", "membership", "set"]) {
      const f = await ready(), source = await f.repository.readSource(f.identity, f.scope);
      if (kind === "tag") f.state.images[0].tagCategory = "CONCURRENT"; if (kind === "membership") f.state.images.push({ ...f.state.images[0], id: 11 }); if (kind === "set") f.state.sets[0].productTitle = "CHANGED";
      const current = await f.repository.readSource(f.identity, f.scope), before = structuredClone(f.state.images);
      await expect(f.repository.apply(f.identity, { ...f.scope, operationId: taggingApplyOperation, runOperationId: taggingOperation, expectedSourceHash: current.sourceHash,
        expectedResultHash: f.run.resultHash!, decisions: [{ imageId: 9, candidateHash: f.run.stages[0].candidateHash!, decision: "exclude", tags: null }] })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
      expect(current.sourceHash).not.toBe(source.sourceHash); expect(f.state.images).toEqual(before);
    }
  });
  it("apply cancel tombstone and apply ACK unknown recover with the same UUID only", async () => {
    const f = await ready(), op = { ...f.scope, operationId: taggingApplyOperation, runOperationId: taggingOperation };
    f.control.enabled = false; expect((await f.repository.applyCancel(f.identity, op)).status).toBe("canceled");
    f.control.enabled = true;
    const source = await f.repository.readSource(f.identity, f.scope), input = { ...op, operationId: taggingOtherOperation, expectedSourceHash: source.sourceHash, expectedResultHash: f.run.resultHash!,
      decisions: [{ imageId: 9, candidateHash: f.run.stages[0].candidateHash!, decision: "exclude" as const, tags: null }] };
    f.control.ackLostOn = "INSERT INTO security_audit_logs";
    await expect(f.repository.apply(f.identity, input)).rejects.toMatchObject({ outcomeUnknown: true });
    f.control.enabled = false; expect((await f.repository.applyCheck(f.identity, { ...op, operationId: taggingOtherOperation }))?.status).toBe("committed");
    expect((await f.repository.apply(f.identity, input)).status).toBe("committed");
  });
});
