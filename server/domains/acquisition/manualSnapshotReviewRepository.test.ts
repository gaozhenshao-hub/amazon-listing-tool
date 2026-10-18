import { describe, expect, it } from "vitest";
import { acquisitionReviewHash, AcquisitionReviewWriteInputSchema, AcquisitionReviewWriteResultSchema } from "../../../shared/acquisitionReview";
import { replayManualSnapshotRevision } from "./manualSnapshotRevision";
import { createManualSnapshotReviewTestFixture } from "./manualSnapshotReview.testFixture";
import { getManualSnapshotPublication } from "./manualSnapshotPublication";

const second = "22222222-2222-4222-8222-222222222222", third = "33333333-3333-4333-8333-333333333333";
describe("manual snapshot review SQL protocol (synthetic transactions, not native MySQL)", () => {
  it("appends full immutable revision and replays unknown provider research without touching originals", async () => {
    const f = createManualSnapshotReviewTestFixture(), original = structuredClone({ snapshot: f.state.snapshot, assets: f.state.assets, job: f.state.job });
    const command = await f.save(), result = await f.service.execute(f.ctx, command), read = await f.service.read(f.ctx, f.scope);
    expect(result.status).toBe("committed"); expect(read.effectiveDraft.title).toBe("Human title");
    expect(read.effectiveDraft.research).toEqual(f.state.snapshot.normalizedData.research);
    expect((read.effectiveDraft.fieldEvidence as Record<string, unknown>).title).toEqual({ status: "pending_review", sourcePath: `manual_revision:${f.operationId}:title`, valueHash: acquisitionReviewHash("Human title"), noteCode: "manual_revision" });
    expect(read.revision?.note).toBe("Human note"); expect(result.committedRevisionHash).toBe(read.revisionHash);
    expect({ snapshot: f.state.snapshot, assets: f.state.assets, job: f.state.job }).toEqual(original);
    expect(f.state.revisions).toHaveLength(1); expect(f.state.audits).toHaveLength(1); expect(f.state.confirmed).toHaveLength(0);
    expect(f.sqlCalls.filter(call => /^(UPDATE|DELETE)/u.test(call.sql))).toEqual([]);
    expect(f.state.audits[0].metadata).not.toContain("Human title"); expect(f.state.audits[0].metadata).not.toContain("Human note");
  });
  it("same UUID/hash returns original final despite current revision and disabled flag", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save(), first = await f.service.execute(f.ctx, command);
    f.control.enabled = false; expect(await f.service.execute(f.ctx, command)).toEqual(first); expect(f.state.revisions).toHaveLength(1);
  });
  it("same UUID changed payload conflicts and cannot create a new revision", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save(); await f.service.execute(f.ctx, command);
    await expect(f.service.execute(f.ctx, { ...command, note: "different" })).rejects.toThrow("OPERATION_CONTENT_CONFLICT"); expect(f.state.revisions).toHaveLength(1);
  });
  it("scope-hash mismatch is rejected even under a colliding audit key", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save(); await f.service.execute(f.ctx, command);
    const payload = JSON.parse(String(f.state.audits[0].metadata)); payload.receipt.scope.snapshotId = 999;
    f.state.audits[0].metadata = JSON.stringify(payload);
    await expect(f.service.recover(f.ctx, { ...f.scope, operationId: f.operationId, decision: "check" })).rejects.toThrow("JOURNAL_SCOPE_CONFLICT");
  });
  it("reject only appends a rejected revision; current confirmed originals remain untouched", async () => {
    const f = createManualSnapshotReviewTestFixture(); await f.service.execute(f.ctx, await f.save());
    const view = await f.service.read(f.ctx, f.scope);
    await f.service.execute(f.ctx, { ...f.scope, operationId: second, expectedRevisionHash: view.revisionHash, action: "reject", note: "Not acceptable" });
    const read = await f.service.read(f.ctx, f.scope); expect(read.revision?.status).toBe("rejected"); expect(f.state.snapshot.status).toBe("confirmed"); expect(f.state.published).toEqual([]);
    await f.service.execute(f.ctx, await f.save({ operationId: third })); expect(f.state.revisions).toHaveLength(3);
    expect((await f.service.read(f.ctx, f.scope)).revision?.status).toBe("pending_review");
  });
  it("confirmation creates isCurrent=0 and calls the exact-consumer publisher in the same transaction", async () => {
    const f = createManualSnapshotReviewTestFixture(); await f.service.execute(f.ctx, await f.save()); const view = await f.service.read(f.ctx, f.scope);
    const result = await f.service.execute(f.ctx, { ...f.scope, operationId: second, expectedRevisionHash: view.revisionHash, action: "confirm", note: null });
    expect(result.confirmedSnapshotId).toBe(201); expect(f.state.confirmed[0].isCurrent).toBe(0); expect(f.state.published).toEqual([201]);
    expect(f.state.revisions).toHaveLength(2); expect(f.state.audits).toHaveLength(2); expect(f.state.snapshot.status).toBe("confirmed");
    expect(f.sqlCalls.some(call => /UPDATE acquisition_confirmed_snapshots/u.test(call.sql))).toBe(false);
  });
  it("publisher failure rolls back revision, confirmed row and audit final together", async () => {
    const f = createManualSnapshotReviewTestFixture(); await f.service.execute(f.ctx, await f.save()); const view = await f.service.read(f.ctx, f.scope);
    f.control.failPublish = true;
    expect((await f.service.execute(f.ctx, { ...f.scope, operationId: second, expectedRevisionHash: view.revisionHash, action: "confirm", note: null })).status).toBe("unknown");
    expect(f.state.revisions).toHaveLength(1); expect(f.state.confirmed).toEqual([]); expect(f.state.published).toEqual([]); expect(f.state.audits).toHaveLength(1);
  });
  it("lost ACK keeps committed business/audit and original UUID check does not replay writes", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save(); f.control.commitAckLost = true;
    expect((await f.service.execute(f.ctx, command)).status).toBe("unknown"); expect(f.state.revisions).toHaveLength(1);
    f.control.enabled = false; const writes = f.sqlCalls.filter(call => call.sql.startsWith("INSERT")).length;
    const recovered = await f.service.recover(f.ctx, { ...f.scope, operationId: f.operationId, decision: "check" });
    expect(recovered.status).toBe("committed"); expect(f.sqlCalls.filter(call => call.sql.startsWith("INSERT"))).toHaveLength(writes);
  });
  it("cancel-before-submit is a permanent gate-off fence and does not reject an old confirmed snapshot", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save(); f.control.enabled = false;
    expect((await f.service.recover(f.ctx, { ...f.scope, operationId: f.operationId, decision: "cancel" })).status).toBe("cancelled");
    f.control.enabled = true; expect((await f.service.execute(f.ctx, command)).status).toBe("cancelled");
    expect(f.state.revisions).toHaveLength(0); expect(f.state.snapshot.status).toBe("confirmed");
  });
  it.each(["source", "asset", "job"])("full-state CAS catches %s changes", async part => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save();
    if (part === "source") f.state.snapshot.normalizedData.title = "Replaced by old writer";
    if (part === "asset") f.state.assets[0].contentHash = "e".repeat(64);
    if (part === "job") f.state.job.status = "failed";
    await expect(f.service.execute(f.ctx, command)).rejects.toThrow("REVISION_CONFLICT"); expect(f.state.revisions).toHaveLength(0);
  });
  it.each(["queued", "running"])("%s source is read-only and cannot create a revision", async status => {
    const f = createManualSnapshotReviewTestFixture(); f.state.job.status = status; const command = await f.save();
    expect((await f.service.read(f.ctx, f.scope)).capabilities.save.available).toBe(false);
    await expect(f.service.execute(f.ctx, command)).rejects.toThrow("JOB_IN_PROGRESS");
  });
  it.each(["actor", "workspace", "membership", "duplicate-membership", "owner", "project"])("fresh %s refusal occurs before mutation", async kind => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save();
    if (kind === "actor") f.state.actor.status = "disabled";
    if (kind === "workspace") f.state.workspace.status = "disabled";
    if (kind === "membership") f.state.memberships[0].status = "disabled";
    if (kind === "duplicate-membership") f.state.memberships.push({ ...f.state.memberships[0], id: 2 });
    if (kind === "owner") f.state.job.requestedBy = 4;
    if (kind === "project") f.state.parent.userId = 4;
    await expect(f.service.execute(f.ctx, command)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.state.revisions).toHaveLength(0);
  });
  it("KB image jobs retain project=null and are not forced into a project-only scope", async () => {
    const f = createManualSnapshotReviewTestFixture(); f.scope.expectedProjectId = null; f.state.job.consumerType = "kb_images"; f.state.job.consumerRef = "kb-images:US:B012345678";
    expect((await f.service.execute(f.ctx, await f.save())).status).toBe("committed"); expect(f.sqlCalls.some(call => call.sql.includes("FROM projects"))).toBe(false);
  });
  it("monitor uses its actual manual ref and refuses another consumer's canonical ref", async () => {
    const f = createManualSnapshotReviewTestFixture(); f.scope.expectedProjectId = null; f.state.job.consumerType = "competitor_monitor"; f.state.job.consumerRef = "manual:B012345678";
    expect((await f.service.execute(f.ctx, await f.save())).status).toBe("committed");
    f.state.job.consumerRef = "kb-images:US:B012345678";
    await expect(f.service.read(f.ctx, f.scope)).rejects.toThrow("CONSUMER_INVALID");
  });
  it("binds complete active consumer links and prevents a reread old draft replacing a changed pointer", async () => {
    const f = createManualSnapshotReviewTestFixture(), command = await f.save();
    const link = { id: 1, workspaceId: 7, confirmedSnapshotId: 99, consumerType: f.state.job.consumerType, consumerRef: f.state.job.consumerRef,
      capabilityScope: "catalog_basic", projectionVersion: "legacy-v1", status: "active", createdBy: null, createdAt: "2026-10-19 01:00:00.000000", updatedAt: "2026-10-19 01:00:00.000000" };
    f.state.links.push(link);
    await expect(f.service.execute(f.ctx, command)).rejects.toThrow("REVISION_CONFLICT");
    await f.service.execute(f.ctx, await f.save()); f.state.links[0].confirmedSnapshotId = 100;
    const view = await f.service.read(f.ctx, f.scope);
    expect(view.capabilities.confirm).toEqual({ available: false, reasonCode: "CONSUMER_CHANGED" });
    await expect(f.service.execute(f.ctx, { ...f.scope, action: "confirm", operationId: second, expectedRevisionHash: view.revisionHash, note: null })).rejects.toThrow("CONSUMER_CHANGED");
    expect(f.state.confirmed).toEqual([]);
  });
  it("allows the publisher's exact link change but revokes its scoped proof after completion", async () => {
    const f = createManualSnapshotReviewTestFixture();
    f.control.onPublish = async context => {
      const proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId);
      expect(proof?.sourceHash).toMatch(/^[a-f0-9]{64}$/u); expect(Object.isFrozen(proof?.effectiveData)).toBe(true);
      expect(getManualSnapshotPublication({ execute: f.execute }, context.confirmedSnapshotId)).toBeNull();
      f.state.links.push({ id: 1, workspaceId: 7, confirmedSnapshotId: context.confirmedSnapshotId, consumerType: context.job.consumerType,
        consumerRef: context.job.consumerRef, capabilityScope: "catalog_basic", projectionVersion: proof!.sourceHash, status: "active",
        createdBy: 3, createdAt: "2026-10-19 02:00:00.000000", updatedAt: "2026-10-19 02:00:00.000000" });
    };
    await f.service.execute(f.ctx, await f.save()); const view = await f.service.read(f.ctx, f.scope);
    const result = await f.service.execute(f.ctx, { ...f.scope, action: "confirm", operationId: second, expectedRevisionHash: view.revisionHash, note: null });
    expect(result.status).toBe("committed"); expect(result.committedRevisionHash).toBe((await f.service.read(f.ctx, f.scope)).revisionHash);
    expect(getManualSnapshotPublication(f.tx, 201)).toBeNull();
  });
  it("KB record jobs verify exact owner, workspace, ASIN and record identifier", async () => {
    const f = createManualSnapshotReviewTestFixture(); f.scope.expectedProjectId = null; f.state.job.consumerType = "kb_listing"; f.state.job.consumerRef = "kb-listing:81";
    const command = await f.save(); f.state.kbRecord.userId = 4;
    await expect(f.service.execute(f.ctx, command)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("readback and SQL warnings roll back all new records", async () => {
    for (const key of ["warning", "badReadback"] as const) {
      const f = createManualSnapshotReviewTestFixture(), command = await f.save(); f.control[key] = true;
      await expect(f.service.execute(f.ctx, command)).rejects.toThrow(); expect(f.state.revisions).toHaveLength(0); expect(f.state.audits).toHaveLength(0);
    }
  });
  it("read-only session cannot cancel or finalize durable state", async () => {
    const f = createManualSnapshotReviewTestFixture();
    await expect(f.repository.transaction(f.identity, f.scope, "read", session => session.journal(f.operationId).cancel())).rejects.toThrow("READ_ONLY");
    expect(f.state.audits).toEqual([]);
  });
  it("complete asset list required, duplicate decisions and forged patch fields rejected", async () => {
    const f = createManualSnapshotReviewTestFixture(), base = await f.save();
    expect(AcquisitionReviewWriteInputSchema.safeParse({ ...base, patch: { sourceHash: "f".repeat(64) } }).success).toBe(false);
    expect(AcquisitionReviewWriteInputSchema.safeParse({ ...base, assetDecisions: [{ assetId: 61, decision: "keep" }, { assetId: 61, decision: "delete" }] }).success).toBe(false);
    await expect(f.service.execute(f.ctx, { ...base, action: "save", patch: {}, assetDecisions: [], note: null })).rejects.toThrow("REVISION_INVALID");
  });
  it("pending/deleted last gallery cannot confirm; deletion is reversible without file deletion", async () => {
    const f = createManualSnapshotReviewTestFixture();
    await f.service.execute(f.ctx, { ...await f.save(), action: "save", patch: {}, assetDecisions: [{ assetId: 61, decision: "delete" }], note: null });
    const read = await f.service.read(f.ctx, f.scope); expect(read.capabilities.confirm.available).toBe(false);
    await expect(f.service.execute(f.ctx, { ...f.scope, operationId: second, action: "confirm", expectedRevisionHash: read.revisionHash, note: null })).rejects.toThrow("ASSET_DECISIONS_INCOMPLETE");
    await f.service.execute(f.ctx, await f.save({ operationId: third })); expect((await f.service.read(f.ctx, f.scope)).assets[0].decision).toBe("keep");
    expect(f.state.assets[0].storageKey).toContain("original.png");
  });
  it("corrupt revision/full original hash fails pure replay rather than stripping evidence", async () => {
    const f = createManualSnapshotReviewTestFixture(); await f.service.execute(f.ctx, await f.save());
    f.state.snapshot.normalizedData.research.retainedUnknownEvidence.push("Changed original");
    await expect(f.service.read(f.ctx, f.scope)).rejects.toThrow("REVISION_INVALID"); expect(replayManualSnapshotRevision).toBeTypeOf("function");
  });
  it("shared receipts reject fake successful shapes and canonical hash binds request content", () => {
    expect(AcquisitionReviewWriteResultSchema.safeParse({ status: "committed" }).success).toBe(false);
    expect(acquisitionReviewHash({ a: 1, b: 2 })).toBe(acquisitionReviewHash({ b: 2, a: 1 }));
    expect(acquisitionReviewHash({ a: 1 })).not.toBe(acquisitionReviewHash({ a: 2 }));
  });
});
