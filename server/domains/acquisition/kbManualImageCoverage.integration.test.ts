import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { createManualImageWorkflowProjectionTestFixture } from "./manualImageWorkflowProjection.testFixture";
import { createManualSnapshotConsumerPublisher } from "./manualSnapshotConsumerPublication";
import { createManualSnapshotReviewRepository, type ManualSnapshotReviewExecutor } from "./manualSnapshotReviewRepository";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";
import { readManualKbImageCoverage } from "./kbManualImageCoverage";

type Row = Record<string, unknown>;
/** Real review repository -> production publisher -> durable replay -> coverage,
 * with an in-memory SQL protocol only. No database, storage, or model calls. */
function fixture() {
  const f = createManualImageWorkflowProjectionTestFixture(), dialect = new MySqlDialect();
  f.scope.expectedProjectId = null; f.state.job.consumerType = "kb_images"; f.state.job.consumerRef = "kb-images:US:B012345678";
  f.state.assets.push({ ...f.state.assets[0], id: 62, role: "secondary", positionIndex: 1,
    sourceJsonPath: "$.images[1]", storageKey: "storage://s3/acquisition/7/snapshots/21/secondary/original.png" });
  f.state.snapshot.normalizedData.assets.push({ ...f.state.snapshot.normalizedData.assets[0], role: "secondary", positionIndex: 1, sourcePath: "$.images[1]" });
  f.state.snapshot.sourceHash = acquisitionReviewHash(f.state.snapshot.normalizedData);
  const sets: Row[] = [{ id: 600, userId: 3, workspaceId: 7, overallAnalysis: "SYNTHETIC old AI", visibility: "team" }];
  const images: Row[] = [{ id: 700, imageSetId: 600, imageUrl: "storage://s3/old-original.png", aiDimensionAnalysis: "SYNTHETIC old analysis", tagColorScheme: "human tag" }];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const result = (rows: Row[]) => [structuredClone(rows), []];
  const ok = (insertId = 1) => [{ insertId, affectedRows: 1, warningStatus: 0 }, []];
  const execute = async (statement: SQL) => {
    const { sql, params } = dialect.sqlToQuery(statement); calls.push({ sql, params });
    if (sql.includes("FROM information_schema.TABLES")) return result(params.map(tableName => ({ tableName, engine: "InnoDB" })));
    if (sql.startsWith("SELECT id FROM kb_image_sets")) return result(sets.filter(row => row.workspaceId === params[0] && row.userId === params[1]
      && row.origin_instance_id === params[2] && row.remote_id === params[3]).map(row => ({ id: row.id })));
    if (sql.startsWith("INSERT INTO kb_image_sets")) {
      const [workspaceId, userId, asin, productTitle, brand, category, reviewedBy, origin_instance_id, remote_id, sync_version] = params;
      const id = 600 + sets.length; sets.push({ id, workspaceId, userId, asin, productTitle, brand, category, reviewedBy, origin_instance_id, remote_id, sync_version,
        status: "confirmed", reviewStatus: "approved", visibility: "private" }); return ok(id);
    }
    if (sql.includes("FROM kb_image_sets")) return result(sets.filter(row => row.id === params[0] && row.workspaceId === params[1]
      && (params.length < 3 || row.userId === params[2])).map(row => sql.includes("AS originInstanceId") ? {
      id: row.id, userId: row.userId, workspaceId: row.workspaceId, asin: row.asin, visibility: row.visibility,
      originInstanceId: row.origin_instance_id, remoteId: row.remote_id, syncVersion: row.sync_version } : row));
    if (sql.startsWith("INSERT INTO kb_images")) {
      const [imageSetId, imageUrl, imagePosition, positionIndex, tagImageBelong, aplusModuleType, aplusModuleClass] = params;
      const id = 700 + images.length; images.push({ id, imageSetId, imageUrl, imagePosition, positionIndex, tagImageBelong, aplusModuleType, aplusModuleClass,
        tagsConfirmed: 0, analysisConfirmed: 0 }); return ok(id);
    }
    if (sql.includes("FROM kb_images")) return result(images.filter(row => row.imageSetId === params[0]).map(row => sql.includes("tagImageBelong") ? row
      : { id: row.id, imageSetId: row.imageSetId, imageUrl: row.imageUrl, imagePosition: row.imagePosition, positionIndex: row.positionIndex,
        aplusModuleType: row.aplusModuleType, aplusModuleClass: row.aplusModuleClass }));
    if (sql.includes("FROM acquisition_consumer_links") && !sql.includes("confirmed_snapshot_id=?")) {
      const rows = f.state.links.filter(row => row.workspaceId === params[0] && row.consumerType === params[1] && row.consumerRef === params[2]
        && (sql.includes("AND id=?") ? row.id === params[3] : row.status === "active"));
      return result(sql.includes("AS createdAt") ? rows : rows.map(({ createdAt: _created, updatedAt: _updated, ...row }) => row));
    }
    if (sql.startsWith("UPDATE acquisition_consumer_links")) {
      const row = f.state.links.find(row => row.id === params[0] && row.workspaceId === params[1] && row.consumerType === params[2] && row.consumerRef === params[3] && row.status === "active");
      if (!row) throw new Error("SYNTHETIC_LINK_NOT_FOUND"); row.status = "superseded"; return ok();
    }
    if (sql.startsWith("INSERT INTO acquisition_consumer_links")) {
      const [workspaceId, confirmedSnapshotId, consumerType, consumerRef, capabilityScope, projectionVersion, createdBy] = params;
      const id = 800 + f.state.links.length; f.state.links.push({ id, workspaceId, confirmedSnapshotId, consumerType, consumerRef, capabilityScope,
        projectionVersion, createdBy, status: "active", createdAt: "2026-10-19 01:00:00.000000", updatedAt: "2026-10-19 01:00:00.000000" }); return ok(id);
    }
    return f.execute(statement);
  };
  const tx: ManualSnapshotReviewExecutor = { execute };
  const errors: string[] = [];
  const db = { transaction: async <T>(body: (executor: ManualSnapshotReviewExecutor) => Promise<T>) => {
    try { return await (await f.getDb()).transaction(async () => body(tx)); }
    catch (error) { errors.push(String(error)); throw error; }
  } };
  const repository = createManualSnapshotReviewRepository({ getDb: async () => db, enabled: () => true, permission: async () => undefined, admit: async () => undefined,
    now: () => new Date("2026-10-19T02:00:00.000Z"), publish: createManualSnapshotConsumerPublisher({ permission: async () => undefined }) });
  const service = createManualSnapshotReviewService({ repository, previewUrl: async () => "https://synthetic.invalid/image.png" });
  async function publish(version: 1 | 2 = 1) {
    const read = await service.read(f.ctx, f.scope);
    const saved = await service.execute(f.ctx, { ...f.scope, operationId: version === 1 ? "11111111-1111-4111-8111-111111111111" : "33333333-3333-4333-8333-333333333333",
      expectedRevisionHash: read.revisionHash, action: "save", patch: { title: `SYNTHETIC reviewed title ${version}` },
      assetDecisions: read.assets.map(asset => ({ assetId: asset.id, decision: asset.id === 61 ? "keep" : "delete" })), note: null });
    expect(saved.status, errors.join("; ")).toBe("committed");
    const ready = await service.read(f.ctx, f.scope);
    const receipt = await service.execute(f.ctx, { ...f.scope, operationId: version === 1 ? "22222222-2222-4222-8222-222222222222" : "44444444-4444-4444-8444-444444444444",
      expectedRevisionHash: ready.revisionHash, action: "confirm", note: null });
    expect(receipt.status, errors.join("; ")).toBe("committed"); return receipt;
  }
  function read(index = 1) {
    const row = sets[index];
    const set = { id: Number(row.id), userId: Number(row.userId), workspaceId: Number(row.workspaceId), asin: String(row.asin), visibility: String(row.visibility),
      originInstanceId: String(row.origin_instance_id), remoteId: Number(row.remote_id), syncVersion: Number(row.sync_version) };
    const delivered = images.filter(image => image.imageSetId === set.id).map(image => ({ id: Number(image.id), imageSetId: Number(image.imageSetId), imageUrl: String(image.imageUrl),
      imagePosition: String(image.imagePosition), positionIndex: Number(image.positionIndex), aplusModuleType: image.aplusModuleType as string | null, aplusModuleClass: image.aplusModuleClass as string | null }));
    return readManualKbImageCoverage(db, f.identity, set, delivered);
  }
  return { ...f, sets, images, calls, publish, read };
}

describe("manual KB version coverage through real publication and durable replay", () => {
  it("reports kept/excluded from the confirmed revision and preserves the old gallery byte-for-byte", async () => {
    const f = fixture(), oldSet = structuredClone(f.sets[0]), oldImage = structuredClone(f.images[0]);
    const receipt = await f.publish();
    expect(await f.read()).toEqual({ mode: "manual_revision", status: "verified", revisionVersion: 2, confirmedSnapshotId: receipt.confirmedSnapshotId, kept: 1, excluded: 1, total: 2 });
    expect(f.sets[0]).toEqual(oldSet); expect(f.images[0]).toEqual(oldImage);
    expect(f.calls.some(call => /^(DELETE|UPDATE kb_images|UPDATE kb_image_sets)/u.test(call.sql))).toBe(false);
  });
  it("keeps both exact private versions readable after a later confirmed revision supersedes the first", async () => {
    const f = fixture(); await f.publish(); await f.publish(2);
    expect(await f.read(1)).toMatchObject({ status: "verified", revisionVersion: 2, kept: 1, excluded: 1 });
    expect(await f.read(2)).toMatchObject({ status: "verified", revisionVersion: 4, kept: 1, excluded: 1 });
    expect(f.sets).toHaveLength(3); expect(f.images).toHaveLength(3);
  });
  it.each(["source-hash", "receipt", "detached", "selected-image", "foreign-workspace-key", "foreign-confirmation"])("does not claim manual coverage after %s tampering", async kind => {
    const f = fixture(); await f.publish();
    if (kind === "source-hash") f.state.links.forEach(link => { link.projectionVersion = "f".repeat(64); });
    if (kind === "receipt") f.state.audits.pop();
    if (kind === "detached") f.state.links.forEach(link => { link.status = "detached"; });
    if (kind === "selected-image") f.images[1].imageUrl = "storage://s3/unrelated-original.png";
    if (kind === "foreign-workspace-key") f.images[1].imageUrl = "storage://s3/acquisition/8/snapshots/99/private.png";
    if (kind === "foreign-confirmation") f.state.confirmed[0].workspaceId = 8;
    expect(await f.read()).toEqual({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
  });
});
