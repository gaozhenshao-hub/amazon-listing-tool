import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { getManualSnapshotPublication } from "./manualSnapshotPublication";
import { createManualImageWorkflowProjectionTestFixture } from "./manualImageWorkflowProjection.testFixture";
import { projectManualSnapshotToImageWorkflow, readManualImageWorkflowSnapshot, readManualImageWorkflowSnapshotHistory, readManualKbImageSnapshotHistory } from "./manualImageWorkflowProjection";
import type { ManualSnapshotPublishContext } from "./manualSnapshotRevision";
import { getConfirmedSnapshot, listConfirmedAssets, listHistoricalConfirmedAssets, listAvailableConfirmedSnapshots } from "../image/competitorGalleryRepository";
import { listCompetitorGallerySubjects } from "../image/competitorGalleryService";
import * as database from "../../repositories/dbClient";
import * as storage from "../../storage";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";

afterEach(() => vi.restoreAllMocks());

async function confirmedFixture() {
  const f = createManualImageWorkflowProjectionTestFixture(); await f.save(); const receipt = await f.confirm();
  return { ...f, receipt, db: await f.getDb(), confirmedId: receipt.confirmedSnapshotId! };
}
describe("manual image workflow immutable target projection and persistent proof", () => {
  it("projects only the actual confirming transaction and fully replays its committed exact target afterward", async () => {
    const f = createManualImageWorkflowProjectionTestFixture(), oldAsset = structuredClone(f.state.assets[0]), oldSource = structuredClone(f.state.snapshot);
    f.state.subjects.push({ id: 500, workspaceId: 7, projectId: 11, userId: 3, confirmedSnapshotId: 199, marketplace: "US", asin: "B000000001", displayName: "Old primary",
      role: "primary", status: "confirmed", currentAnalysisVersion: 2, sortOrder: 0 });
    await f.save(); const receipt = await f.confirm(), confirmedId = receipt.confirmedSnapshotId!;
    expect(f.state.subjects).toHaveLength(2); expect(f.state.subjects[0]).toMatchObject({ id: 500, role: "primary", status: "confirmed", currentAnalysisVersion: 2 });
    expect(f.state.subjects[1]).toMatchObject({ confirmedSnapshotId: confirmedId, displayName: "Human-reviewed title", role: "benchmark", status: "ready" });
    expect(f.state.assets[0]).toEqual(oldAsset); expect(f.state.snapshot).toEqual(oldSource); expect(f.state.confirmed[0].isCurrent).toBe(0);
    expect(getManualSnapshotPublication(f.tx, confirmedId)).toBeNull();
    const proof = await readManualImageWorkflowSnapshot(await f.getDb(), 7, confirmedId, 11);
    expect(proof?.assets.map(asset => asset.id)).toEqual([61]); expect(proof?.confirmed.contentHash).toBe(f.state.confirmed[0].contentHash);
    expect(proof?.publicationState).toBe("active");
  });
  it("locks the exact project before job/source to match the actual confirming writer", async () => {
    const f = await confirmedFixture(), start = f.sqlCalls.length;
    await readManualImageWorkflowSnapshot(f.db, 7, f.confirmedId, 11);
    const locks = f.sqlCalls.slice(start).filter(query => query.sql.endsWith("FOR SHARE"));
    const parent = locks.findIndex(query => query.sql.includes("FROM projects "));
    const workspace = locks.findIndex(query => query.sql.includes("FROM workspaces "));
    const actor = locks.findIndex(query => query.sql.includes("FROM users "));
    const membership = locks.findIndex(query => query.sql.includes("FROM workspace_memberships "));
    const job = locks.findIndex(query => query.sql.includes("FROM acquisition_jobs "));
    const source = locks.findIndex(query => query.sql.includes("FROM acquisition_source_snapshots "));
    expect(workspace).toBeGreaterThanOrEqual(0); expect(actor).toBeGreaterThan(workspace); expect(membership).toBeGreaterThan(actor);
    expect(parent).toBeGreaterThan(membership); expect(job).toBeGreaterThan(parent); expect(source).toBeGreaterThan(job);
  });
  it("fresh revoked actor/membership is a permission failure, not fabricated unavailable history", async () => {
    const f = await confirmedFixture(); f.state.memberships[0].status = "disabled";
    await expect(readManualImageWorkflowSnapshotHistory(f.db, 7, f.confirmedId, 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not accept a serializable imitation of the runtime proof", async () => {
    const f = await confirmedFixture();
    await expect(projectManualSnapshotToImageWorkflow({ tx: f.tx, confirmedSnapshotId: f.confirmedId } as ManualSnapshotPublishContext)).rejects.toThrow("SOURCE_UNAVAILABLE");
    expect(f.state.subjects).toHaveLength(1);
  });
  it.each(["video", "unknown"])("refuses a real main plus selected %s confirmation without filtering or damaging the old version", async role => {
    const f = createManualImageWorkflowProjectionTestFixture();
    f.state.subjects.push({ id: 500, workspaceId: 7, projectId: 11, userId: 3, confirmedSnapshotId: 199, marketplace: "US", asin: "B000000001",
      displayName: "Old approved gallery", role: "primary", status: "confirmed", currentAnalysisVersion: 2, sortOrder: 0 });
    f.state.assets.push({ ...f.state.assets[0], id: 62, role, positionIndex: 1, sourceJsonPath: "$.otherMedia[0]",
      storageKey: `storage://s3/acquisition/7/snapshots/21/${role}/original.png` });
    f.state.snapshot.normalizedData.assets.push({ ...f.state.snapshot.normalizedData.assets[0], role, positionIndex: 1, sourcePath: "$.otherMedia[0]" });
    f.state.snapshot.sourceHash = acquisitionReviewHash(f.state.snapshot.normalizedData);
    await f.save();
    const source = structuredClone(f.state.snapshot), assets = structuredClone(f.state.assets), revisions = structuredClone(f.state.revisions), subjects = structuredClone(f.state.subjects);
    expect(revisions).toHaveLength(1);
    await expect(f.confirm()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ACQUISITION_REVIEW_PUBLICATION_IMAGE_ROLE_INVALID" });
    expect(f.state.snapshot).toEqual(source); expect(f.state.assets).toEqual(assets); expect(f.state.revisions).toEqual(revisions); expect(f.state.subjects).toEqual(subjects);
    expect(f.state.confirmed).toHaveLength(0); expect(f.state.links).toHaveLength(0);
    expect(f.sqlCalls.some(query => query.sql.startsWith("INSERT INTO image_competitor_research_subjects"))).toBe(false);
  });
  it.each(["project", "workspace", "consumer", "link-ref", "link-hash", "link-actor", "detached", "duplicate-link", "missing-final", "cancelled-final", "receipt-source", "receipt-operation", "content-hash", "selected-ids", "raw-artifact", "revision", "source", "asset"])("rejects corrupted persistent provenance: %s", async kind => {
    const f = await confirmedFixture(); let workspace = 7, project = 11;
    if (kind === "project") project = 12;
    if (kind === "workspace") workspace = 8;
    if (kind === "consumer") f.state.job.consumerType = "kb_images";
    if (kind === "link-ref") f.state.links.forEach(link => { link.consumerRef = "project:12:competitor-gallery"; });
    if (kind === "link-hash") f.state.links.forEach(link => { link.projectionVersion = "e".repeat(64); });
    if (kind === "link-actor") f.state.links.forEach(link => { link.createdBy = 4; });
    if (kind === "detached") f.state.links.forEach(link => { link.status = "detached"; });
    if (kind === "duplicate-link") f.state.links.push({ ...f.state.links.find(link => link.capabilityScope === "image_gallery"), id: 999 });
    if (kind === "missing-final") f.state.audits.pop();
    if (["cancelled-final", "receipt-source", "receipt-operation"].includes(kind)) {
      const row = f.state.audits.at(-1)!, value = JSON.parse(String(row.metadata));
      if (kind === "cancelled-final") value.receipt.status = "cancelled";
      if (kind === "receipt-source") value.binding.sourceStateHash = "f".repeat(64);
      if (kind === "receipt-operation") value.receipt.operationId = f.operationId;
      row.metadata = JSON.stringify(value);
    }
    if (kind === "content-hash") f.state.confirmed[0].contentHash = "e".repeat(64);
    if (kind === "selected-ids") f.state.confirmed[0].assetIds = "[]";
    if (kind === "raw-artifact") f.state.artifact.contentHash = "a".repeat(64);
    if (kind === "revision") f.state.revisions.at(-1)!.revisionHash = "e".repeat(64);
    if (kind === "source") f.state.snapshot.normalizedData.title = "Changed source";
    if (kind === "asset") f.state.assets[0].contentHash = "e".repeat(64);
    const operation = readManualImageWorkflowSnapshot(f.db, workspace, f.confirmedId, project);
    if (kind === "workspace") expect(await operation).toBeNull(); else await expect(operation).rejects.toThrow("SOURCE_UNAVAILABLE");
  });
  it("allows exact superseded history read but not active selection/model reads or detached history", async () => {
    const f = await confirmedFixture(); f.state.links.forEach(link => { link.status = "superseded"; link.updatedAt = "2026-10-20 01:00:00.000000"; });
    await expect(readManualImageWorkflowSnapshot(f.db, 7, f.confirmedId, 11)).rejects.toThrow("SOURCE_UNAVAILABLE");
    expect((await readManualImageWorkflowSnapshotHistory(f.db, 7, f.confirmedId, 11))?.publicationState).toBe("superseded");
    f.state.links.forEach(link => { link.status = "detached"; });
    await expect(readManualImageWorkflowSnapshotHistory(f.db, 7, f.confirmedId, 11)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });
  it("does not let later supplemental candidates alter a bound older confirmed gallery", async () => {
    const f = await confirmedFixture(); f.state.assets.push({ ...f.state.assets[0], id: 62, role: "aplus", positionIndex: 1, sourceJsonPath: "$.manualSupplement.later", reviewStatus: "pending" });
    const proof = await readManualImageWorkflowSnapshot(f.db, 7, f.confirmedId, 11);
    expect(proof?.assets.map(asset => asset.id)).toEqual([61]); expect(proof?.allAssets).toHaveLength(1);
  });
  it("cannot view an image-workflow source through the separate owner-only KB history wrapper", async () => {
    const f = await confirmedFixture();
    await expect(readManualKbImageSnapshotHistory(f.db, 7, f.confirmedId, 3)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });
  it("replays a real owner-only canonical KB confirmation and calls the metadata verifier in that one transaction", async () => {
    const f = createManualImageWorkflowProjectionTestFixture();
    f.scope.expectedProjectId = null; f.state.job.consumerType = "kb_images"; f.state.job.consumerRef = `kb-images:US:${f.state.snapshot.asin}`;
    f.control.onPublish = async context => {
      const proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId)!;
      for (const capabilityScope of f.state.job.requestedCapabilities) f.state.links.push({ id: 701 + f.state.links.length, workspaceId: 7,
        confirmedSnapshotId: context.confirmedSnapshotId, consumerType: "kb_images", consumerRef: f.state.job.consumerRef, capabilityScope,
        projectionVersion: proof.sourceHash, status: "active", createdBy: 3, createdAt: "2026-10-19 01:00:00.000000", updatedAt: "2026-10-19 01:00:00.000000" });
      return { consumerType: "kb_images", imageSetId: 901 };
    };
    await f.save(); const receipt = await f.confirm(), db = await f.getDb(), callback = vi.fn(async (tx, proof) => {
      expect(tx).toBe(f.tx); expect(proof.identity).toEqual(f.identity); expect(proof.scope.expectedProjectId).toBeNull();
      expect(proof.envelope.status).toBe("confirmed"); expect(proof.assets.map((asset: { id: number }) => asset.id)).toEqual([61]);
    });
    const proof = await readManualKbImageSnapshotHistory(db, 7, receipt.confirmedSnapshotId!, 3, callback);
    expect(callback).toHaveBeenCalledTimes(1); expect(proof?.job.consumerRef).toBe(f.state.job.consumerRef);
    f.state.links.forEach(link => { link.status = "superseded"; });
    expect((await readManualKbImageSnapshotHistory(db, 7, receipt.confirmedSnapshotId!, 3))?.publicationState).toBe("superseded");
    await expect(readManualKbImageSnapshotHistory(db, 7, receipt.confirmedSnapshotId!, 4)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });
});

function manualReadFacade(f: Awaited<ReturnType<typeof confirmedFixture>>) {
  const predicates: Array<{ sql: string; params: unknown[] }> = [], dialect = new MySqlDialect();
  return { ...f.db, predicates, select() {
    let table = "";
    const values = () => table === "image_competitor_research_subjects" ? structuredClone(f.state.subjects) : [];
    const query = { from(value: AnyMySqlTable) { table = getTableConfig(value).name; return query; },
      where(value: Parameters<MySqlDialect["sqlToQuery"]>[0]) { predicates.push(dialect.sqlToQuery(value)); return query; },
      orderBy(..._values: unknown[]) { return query; }, limit(_limit: number) { return Promise.resolve(values()); },
      then(resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) { return Promise.resolve(values()).then(resolve, reject); } };
    return query;
  } };
}
describe("actual image gallery repository and service manual consumers", () => {
  it("requires an explicit project for manual reads and does not broaden global options", async () => {
    const f = await confirmedFixture(), db = manualReadFacade(f), before = f.sqlCalls.length;
    expect(await getConfirmedSnapshot(db, 7, f.confirmedId)).toBeNull();
    expect(await listConfirmedAssets(db, 7, f.confirmedId)).toEqual([]);
    expect(await listAvailableConfirmedSnapshots(db, 7)).toEqual([]);
    expect(f.sqlCalls).toHaveLength(before);
    expect(db.predicates.every(query => query.sql.includes("is_current") && query.params.includes(1))).toBe(true);
    expect((await getConfirmedSnapshot(db, 7, f.confirmedId, 11))?.id).toBe(f.confirmedId);
  });
  it("uses confirmed membership for pending supplemental rows without changing global approval flags", async () => {
    const f = createManualImageWorkflowProjectionTestFixture(); Object.assign(f.state.assets[0], { reviewStatus: "pending", reviewedBy: null });
    await f.save(); const receipt = await f.confirm(), full = { ...f, receipt, db: await f.getDb(), confirmedId: receipt.confirmedSnapshotId! };
    const rows = await listConfirmedAssets(manualReadFacade(full), 7, full.confirmedId, 11);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: 61, reviewStatus: "pending" }); expect(f.state.assets[0].reviewStatus).toBe("pending");
  });
  it("historical display cannot turn superseded sources into active analysis inputs", async () => {
    const f = await confirmedFixture(), db = manualReadFacade(f); f.state.links.forEach(link => { link.status = "superseded"; });
    expect(await listHistoricalConfirmedAssets(db, 7, f.confirmedId, 11)).toHaveLength(1);
    await expect(listConfirmedAssets(db, 7, f.confirmedId, 11)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });
  it("shows unavailable source metadata without inventing images or hiding authorization failures", async () => {
    const f = await confirmedFixture(), db = manualReadFacade(f); f.state.links.forEach(link => { link.projectionVersion = "e".repeat(64); });
    vi.spyOn(database, "requireDb").mockResolvedValue(db as never);
    const resolve = vi.spyOn(storage, "resolveStoredObjectUrl").mockResolvedValue("https://synthetic.invalid/image.png");
    const rows = await listCompetitorGallerySubjects({ workspaceId: 7, projectId: 11 });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ assets: [], sourceAvailability: { status: "unavailable", reasonCode: "MANUAL_IMAGE_WORKFLOW_SOURCE_UNAVAILABLE" } });
    expect(resolve).not.toHaveBeenCalled();
    vi.spyOn(database, "requireDb").mockResolvedValue({ ...db, transaction: async () => { throw new TRPCError({ code: "FORBIDDEN" }); } } as never);
    await expect(listCompetitorGallerySubjects({ workspaceId: 7, projectId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
