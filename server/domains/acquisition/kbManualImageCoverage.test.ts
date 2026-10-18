import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
vi.mock("./manualImageWorkflowProjection", () => ({ readManualKbImageSnapshotHistory: vi.fn(() => { throw new Error("REAL_DATABASE_FORBIDDEN"); }) }));
import { readManualKbImageCoverage } from "./kbManualImageCoverage";
function fixture() {
  const owner = { userId: 3, workspaceId: 7 }, set = { id: 101, userId: 3, workspaceId: 7, asin: "B012345678", visibility: "private", originInstanceId: "manual_acquisition_review_v1", remoteId: 41, syncVersion: 3 };
  const images = [{ id: 201, imageSetId: 101, imageUrl: "storage://s3/acquisition/7/snapshots/21/main/source.png", imagePosition: "main", positionIndex: 0, aplusModuleType: null as string | null, aplusModuleClass: null as string | null }];
  const proof = { revision: { version: 3 }, confirmed: { id: 41, asin: set.asin }, identity: owner, scope: { expectedProjectId: null as number | null }, job: { consumerType: "kb_images" },
    assets: [{ storageKey: images[0].imageUrl, role: "main", positionIndex: 0, moduleType: null as string | null, moduleClass: null as string | null }],
    envelope: { status: "confirmed", assetDecisions: [{ assetId: 61, decision: "keep" }, { assetId: 62, decision: "delete" }] } };
  const state = { sets: [structuredClone(set)], images: structuredClone(images) }, dialect = new MySqlDialect(), calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = { execute: async (statement: SQL) => { const query = dialect.sqlToQuery(statement); calls.push(query);
    return [structuredClone(query.sql.includes("FROM kb_image_sets") ? state.sets : state.images), []]; } };
  const load = vi.fn(async (_db, _ws, _confirmed, _owner, callback) => { await callback(tx, proof); return proof; });
  const read = () => readManualKbImageCoverage({} as never, owner, set, images, load as never);
  return { owner, set, images, proof, state, load, read, calls };
}
describe("manual KB image coverage exact-version binding", () => {
  it("uses one durable reader transaction and exact private set/image proof; excluded is not failed", async () => {
    const f = fixture(); expect(await f.read()).toEqual({ mode: "manual_revision", status: "verified", revisionVersion: 3, confirmedSnapshotId: 41, kept: 1, excluded: 1, total: 2 });
    expect(f.load).toHaveBeenCalledWith({}, 7, 41, 3, expect.any(Function));
    expect(f.calls[0].params).toEqual([101, 7, 3]); expect(f.calls[0].sql).toContain("FOR SHARE");
    expect(f.calls[1].params).toEqual([101]); expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["owner", "workspace", "shared"])("rejects %s before reading any durable source", async mode => {
    const f = fixture(); if (mode === "owner") f.set.userId = 4; if (mode === "workspace") f.set.workspaceId = 8; if (mode === "shared") f.set.visibility = "team";
    await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.load).not.toHaveBeenCalled();
  });
  it("revocation or removal during the reader transaction does not expose a source", async () => {
    const f = fixture(); f.state.sets = []; await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["revision", "confirmed", "asin", "actor", "scope", "consumer", "pending", "count", "imageContent", "imagePosition", "imageModule", "newImage", "duplicateImage"])("%s mismatch is unavailable with no guessed counts", async mode => {
    const f = fixture();
    if (mode === "revision") f.proof.revision.version++;
    if (mode === "confirmed") f.proof.confirmed.id++;
    if (mode === "asin") f.proof.confirmed.asin = "B000000000";
    if (mode === "actor") f.proof.identity = { ...f.owner, userId: 4 };
    if (mode === "scope") f.proof.scope.expectedProjectId = 11;
    if (mode === "consumer") f.proof.job.consumerType = "image_workflow";
    if (mode === "pending") f.proof.envelope.assetDecisions[1].decision = "pending";
    if (mode === "count") f.proof.envelope.assetDecisions[1].decision = "keep";
    if (mode === "imageContent") f.proof.assets[0].storageKey += ".changed";
    if (mode === "imagePosition") f.state.images[0].positionIndex++;
    if (mode === "imageModule") f.proof.assets[0].moduleType = "changed";
    if (mode === "newImage") f.state.images.push({ ...f.images[0], id: 202 });
    if (mode === "duplicateImage") f.images.push({ ...f.images[0] });
    expect(await f.read()).toEqual({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
  });
  it("missing/corrupt durable proof cannot fall back to the default/direct candidate total", async () => {
    const f = fixture(); f.load.mockRejectedValue(new Error("private storage URI and audit body"));
    expect(await f.read()).toEqual({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
  });
  it("an extra set is not silently picked as the first match", async () => {
    const f = fixture(); f.state.sets.push({ ...f.set, id: 102 }); expect(await f.read()).toMatchObject({ status: "unavailable" });
  });
});
