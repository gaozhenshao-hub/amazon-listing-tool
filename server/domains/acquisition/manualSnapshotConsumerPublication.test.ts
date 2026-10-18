import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createManualSnapshotReviewTestFixture } from "./manualSnapshotReview.testFixture";
import { createManualSnapshotReviewRepository, type ManualSnapshotReviewExecutor } from "./manualSnapshotReviewRepository";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";
import { createManualSnapshotConsumerPublisher } from "./manualSnapshotConsumerPublication";
import { getManualSnapshotPublication } from "./manualSnapshotPublication";

type Row = Record<string, unknown>;
function fixture(consumerType = "kb_images") {
  const base = createManualSnapshotReviewTestFixture();
  base.scope.expectedProjectId = consumerType === "project_competitor" || consumerType === "image_workflow" ? 11 : null;
  base.state.job.consumerType = consumerType;
  base.state.job.consumerRef = consumerType === "kb_images" ? "kb-images:US:B012345678"
    : consumerType === "kb_listing" ? "kb-listing:81" : consumerType === "kb_product" ? "kb-product:81"
      : consumerType === "image_workflow" ? "project:11:competitor-gallery" : consumerType === "conversion_collector"
        ? "conversion-collector:US:B012345678" : consumerType === "competitor_monitor" ? "manual:B012345678" : base.state.job.consumerRef;
  const oldSet = { id: 601, workspaceId: 7, userId: 3, asin: "B012345678", origin_instance_id: "unified_amazon_acquisition", remote_id: 101,
    overallAnalysis: "old AI", userEditedOverallAnalysis: "human analysis", visibility: "team" };
  const oldImage = { id: 701, imageSetId: 601, imageUrl: "storage://s3/old.png", tagColorScheme: "human tag", aiDimensionAnalysis: "old analysis", tagsConfirmed: 1 };
  const extra = { sets: [oldSet as Row], images: [oldImage as Row],
    record: { ...base.state.kbRecord, productTitle: "Existing human product", titleText: "Existing generated title", bulletPoints: "[\"keep human bullet\"]", crawledData: "old source",
      aiAnalysis: "Existing AI", userEditedAnalysis: "Human edits", status: "confirmed", createdAt: new Date("2026-10-01T00:00:00Z") } as Row };
  const controls = { warning: false, badSet: false, badImage: false, loseLinkAck: false, foreignRecord: false, changedActor: false,
    commitAckLostOnConfirm: false, engine: "InnoDB" as string | null };
  const dialect = new MySqlDialect(), calls: Array<{ sql: string; params: unknown[] }> = [];
  const ok = (insertId = 1) => [{ affectedRows: 1, warningStatus: controls.warning ? 1 : 0, insertId }, []];
  const result = (value: Row[]) => [structuredClone(value), []];
  const execute = async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (sql.includes("FROM information_schema.TABLES")) return result(controls.engine === null ? [] : params.map(tableName => ({ tableName, engine: controls.engine })));
    if (sql.includes("FROM users") && controls.changedActor) return result([{ ...base.state.actor, role: "other" }]);
    if (sql.startsWith("SELECT id FROM kb_image_sets")) return result(extra.sets.filter(row => row.workspaceId === params[0] && row.userId === params[1] && row.origin_instance_id === params[2] && row.remote_id === params[3]).map(row => ({ id: row.id })));
    if (sql.startsWith("INSERT INTO kb_image_sets")) {
      const [workspaceId, userId, asin, productTitle, brand, category, reviewedBy, origin_instance_id, remote_id, sync_version] = params;
      const id = 602 + extra.sets.length; extra.sets.push({ id, workspaceId, userId, asin, productTitle, brand, category, reviewedBy, origin_instance_id, remote_id, sync_version,
        status: "confirmed", reviewStatus: "approved", visibility: "private" }); return ok(id);
    }
    if (sql.includes("FROM kb_image_sets")) return result(extra.sets.filter(row => row.id === params[0] && row.workspaceId === params[1])
      .map(row => controls.badSet ? { ...row, visibility: "team" } : row));
    if (sql.startsWith("INSERT INTO kb_images")) {
      const [imageSetId, imageUrl, imagePosition, positionIndex, tagImageBelong, aplusModuleType, aplusModuleClass] = params;
      const id = 702 + extra.images.length; extra.images.push({ id, imageSetId, imageUrl, imagePosition, positionIndex, tagImageBelong, aplusModuleType, aplusModuleClass, tagsConfirmed: 0, analysisConfirmed: 0 }); return ok(id);
    }
    if (sql.includes("FROM kb_images")) return result(extra.images.filter(row => row.imageSetId === params[0]).map(row => controls.badImage ? { ...row, imageUrl: "tampered" } : row));
    if (sql.startsWith("SELECT * FROM kb_")) return result([{ ...extra.record, ...(controls.foreignRecord ? { userId: 9 } : {}) }]);
    if (sql.startsWith("UPDATE kb_listing_copywriting") || sql.startsWith("UPDATE kb_product_innovations")) {
      const [crawledData, origin_instance_id, remote_id, sync_version] = params;
      Object.assign(extra.record, { crawledData, origin_instance_id, remote_id, sync_version, last_synced_at: new Date("2026-10-19T01:00:00Z"), updatedAt: new Date("2026-10-19T01:00:00Z") }); return ok();
    }
    if (sql.includes("FROM acquisition_consumer_links")) {
      let links = base.state.links.filter(row => row.workspaceId === params[0] && row.consumerType === params[1] && row.consumerRef === params[2]);
      if (sql.includes("AND id=?")) links = links.filter(row => row.id === params[3]);
      else links = links.filter(row => row.status === "active");
      if (!sql.includes("AS createdAt")) return result(links.map(({ createdAt: _created, updatedAt: _updated, ...row }) => row));
      return result(links);
    }
    if (sql.startsWith("UPDATE acquisition_consumer_links")) {
      const row = base.state.links.find(row => row.id === params[0] && row.workspaceId === params[1] && row.consumerType === params[2] && row.consumerRef === params[3] && row.status === "active");
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []]; row.status = "superseded"; row.updatedAt = "2026-10-19 01:00:00.000000"; return ok();
    }
    if (sql.startsWith("INSERT INTO acquisition_consumer_links")) {
      const [workspaceId, confirmedSnapshotId, consumerType, consumerRef, capabilityScope, projectionVersion, createdBy] = params;
      const id = 800 + base.state.links.length;
      base.state.links.push({ id, workspaceId, confirmedSnapshotId, consumerType, consumerRef, capabilityScope, projectionVersion, createdBy, status: "active", createdAt: "2026-10-19 01:00:00.000000", updatedAt: "2026-10-19 01:00:00.000000" });
      return controls.loseLinkAck ? [{ affectedRows: undefined, warningStatus: 0 }, []] : ok(id);
    }
    return base.execute(query);
  };
  const tx: ManualSnapshotReviewExecutor = { execute };
  const getDb = async () => ({ transaction: async <T>(body: (tx: ManualSnapshotReviewExecutor) => Promise<T>) => {
    const previous = structuredClone(extra); let bodyCompleted = false;
    try { return await (await base.getDb()).transaction(async () => { const value = await body(tx); bodyCompleted = true; return value; }); }
    catch (error) { if (!bodyCompleted) Object.assign(extra, previous); throw error; }
  } });
  const permission = vi.fn(async () => undefined), saveListing = vi.fn(async () => ({ analysisId: 91 })), imageWorkflow = vi.fn(async () => ({ subjectId: 91 }));
  let publishedId = 0;
  const publisher = createManualSnapshotConsumerPublisher({ permission, saveListing, imageWorkflow });
  const publish = async (context: Parameters<typeof publisher>[0]) => { publishedId = context.confirmedSnapshotId; const value = await publisher(context);
    if (controls.commitAckLostOnConfirm) base.control.commitAckLost = true; return value; };
  const repository = createManualSnapshotReviewRepository({ getDb, permission, enabled: () => base.control.enabled, admit: async () => undefined,
    now: () => new Date("2026-10-19T02:00:00Z"), publish });
  const service = createManualSnapshotReviewService({ repository, previewUrl: async () => "https://example.invalid/original.png" });
  async function confirm() {
    const view = await service.read(base.ctx, base.scope);
    await service.execute(base.ctx, { ...base.scope, operationId: base.operationId, expectedRevisionHash: view.revisionHash,
      action: "save", patch: { title: "Reviewed human title" }, assetDecisions: view.assets.map(asset => ({ assetId: asset.id, decision: "keep" })), note: null });
    const updated = await service.read(base.ctx, base.scope);
    return service.execute(base.ctx, { ...base.scope, operationId: "22222222-2222-4222-8222-222222222222", expectedRevisionHash: updated.revisionHash, action: "confirm", note: null });
  }
  return { base, extra, controls, calls, confirm, publisher, tx, service, permission, saveListing, imageWorkflow, get publishedId() { return publishedId; } };
}

describe("actual manual repository → consumer publisher → journal", () => {
  it("appends a private image version, preserves old images/tags/analysis and writes complete exact links", async () => {
    const f = fixture(), oldSet = structuredClone(f.extra.sets[0]), oldImage = structuredClone(f.extra.images[0]), source = structuredClone(f.base.state.snapshot), asset = structuredClone(f.base.state.assets[0]);
    const receipt = await f.confirm();
    expect(receipt.status).toBe("committed"); expect(receipt.confirmedSnapshotId).toBe(f.publishedId);
    expect(f.extra.sets[0]).toEqual(oldSet); expect(f.extra.images[0]).toEqual(oldImage);
    expect(f.base.state.snapshot).toEqual(source); expect(f.base.state.assets[0]).toEqual(asset);
    expect(f.extra.sets[1]).toMatchObject({ visibility: "private", origin_instance_id: "manual_acquisition_review_v1", productTitle: "Reviewed human title", remote_id: receipt.confirmedSnapshotId });
    expect(f.extra.images[1]).toMatchObject({ imageUrl: asset.storageKey, imagePosition: "main", positionIndex: 0, tagsConfirmed: 0, analysisConfirmed: 0 });
    expect(f.base.state.links).toHaveLength(2); expect(f.base.state.links.every(row => row.confirmedSnapshotId === receipt.confirmedSnapshotId && /^[a-f0-9]{64}$/u.test(String(row.projectionVersion)))).toBe(true);
    expect(f.calls.some(call => /^DELETE|UPDATE kb_images|UPDATE kb_image_sets/u.test(call.sql))).toBe(false);
    expect(getManualSnapshotPublication(f.tx, receipt.confirmedSnapshotId!)).toBeNull();
  });
  it.each(["warning", "badSet", "badImage", "loseLinkAck"] as const)("rolls back the whole revision/projection for %s", async kind => {
    const f = fixture(), before = structuredClone(f.extra); f.controls[kind] = true;
    await expect(f.confirm()).rejects.toThrow(/ACQUISITION_REVIEW_PUBLICATION_/u);
    expect(f.extra).toEqual(before); expect(f.base.state.confirmed).toEqual([]); expect(f.base.state.links).toEqual([]);
    expect(getManualSnapshotPublication(f.tx, f.publishedId)).toBeNull();
  });
  it.each(["kb_listing", "kb_product"])("%s binds reviewed source without overwriting generated copy, human analysis or status", async kind => {
    const f = fixture(kind), before = structuredClone(f.extra.record), receipt = await f.confirm();
    expect(receipt.status).toBe("committed");
    for (const key of ["productTitle", "titleText", "bulletPoints", "aiAnalysis", "userEditedAnalysis", "status", "createdAt"]) expect(f.extra.record[key]).toEqual(before[key]);
    expect(JSON.parse(String(f.extra.record.crawledData))).toMatchObject({ source: "manual_acquisition_review_v1", confirmedSnapshotId: receipt.confirmedSnapshotId, analysisStale: true });
    expect(f.extra.sets).toHaveLength(1); expect(f.extra.images).toHaveLength(1);
  });
  it("lost commit ACK recovers original UUID with writes off and never duplicates an image version", async () => {
    const f = fixture(); f.controls.commitAckLostOnConfirm = true;
    expect((await f.confirm()).status).toBe("unknown");
    expect(f.extra.sets).toHaveLength(2); expect(f.extra.images).toHaveLength(2); expect(f.base.state.confirmed).toHaveLength(1);
    f.base.control.enabled = false;
    const writeCount = f.calls.filter(call => /^(?:INSERT|UPDATE)/u.test(call.sql)).length;
    expect(await f.service.recover(f.base.ctx, { ...f.base.scope, operationId: "22222222-2222-4222-8222-222222222222", decision: "check" })).toMatchObject({ status: "committed", action: "confirm", confirmedSnapshotId: f.publishedId });
    expect(f.calls.filter(call => /^(?:INSERT|UPDATE)/u.test(call.sql))).toHaveLength(writeCount);
  });
  it.each(["kb_listing", "kb_product"])("%s cannot update a foreign record even if its old job is owned", async kind => {
    const f = fixture(kind); f.controls.foreignRecord = true;
    await expect(f.confirm()).rejects.toThrow("TARGET_CHANGED");
    expect(f.extra.record.crawledData).toBe("old source"); expect(f.base.state.confirmed).toEqual([]);
  });
  it("does not accept a plain context or an ID from another transaction", async () => {
    const f = fixture(); await expect(f.publisher({ tx: f.tx, confirmedSnapshotId: 201 } as Parameters<typeof f.publisher>[0])).rejects.toThrow("PROOF_REQUIRED");
    expect(f.calls).toEqual([]);
  });
  it("supersedes only this target's current links, preserving other target history", async () => {
    const f = fixture();
    f.base.state.links.push({ id: 71, workspaceId: 7, confirmedSnapshotId: 99, consumerType: "kb_images", consumerRef: "kb-images:US:B012345678", capabilityScope: "image_gallery", projectionVersion: "old", status: "active", createdBy: 3, createdAt: "2026-10-01 00:00:00.000000", updatedAt: "2026-10-01 00:00:00.000000" },
      { id: 72, workspaceId: 7, confirmedSnapshotId: 98, consumerType: "kb_images", consumerRef: "kb-images:US:B098765432", capabilityScope: "image_gallery", projectionVersion: "other", status: "active", createdBy: 3, createdAt: "2026-10-01 00:00:00.000000", updatedAt: "2026-10-01 00:00:00.000000" });
    expect((await f.confirm()).status).toBe("committed"); expect(f.base.state.links.find(row => row.id === 71)?.status).toBe("superseded"); expect(f.base.state.links.find(row => row.id === 72)?.status).toBe("active");
  });
  it.each(["conversion_collector", "competitor_monitor"])("%s creates only reviewed metadata links, no image or model operation", async kind => {
    const f = fixture(kind), before = structuredClone(f.extra); expect((await f.confirm()).status).toBe("committed");
    expect(f.extra).toEqual(before); expect(f.saveListing).not.toHaveBeenCalled(); expect(f.imageWorkflow).not.toHaveBeenCalled();
  });
  it.each(["project_competitor", "image_workflow"])("%s dispatches only its actual same-transaction consumer", async kind => {
    const f = fixture(kind); expect((await f.confirm()).status).toBe("committed");
    if (kind === "project_competitor") { expect(f.saveListing).toHaveBeenCalledWith(expect.objectContaining({ db: f.tx, projectId: 11, userId: 3 })); expect(f.imageWorkflow).not.toHaveBeenCalled(); }
    else { expect(f.imageWorkflow).toHaveBeenCalledWith(expect.objectContaining({ tx: f.tx, confirmedSnapshotId: f.publishedId })); expect(f.saveListing).not.toHaveBeenCalled(); }
  });
  it.each(["kb_images", "kb_listing", "kb_product", "project_competitor", "image_workflow"])("%s refuses missing or non-transactional target tables before any target write", async kind => {
    for (const engine of [null, "MyISAM"]) {
      const f = fixture(kind); f.controls.engine = engine;
      await expect(f.confirm()).rejects.toThrow("TARGET_NOT_TRANSACTIONAL");
      expect(f.calls.some(call => /^(?:INSERT INTO|UPDATE) (?:kb_|competitor|image_competitor)/u.test(call.sql))).toBe(false);
      expect(f.base.state.confirmed).toEqual([]); expect(f.base.state.links).toEqual([]);
      expect(f.saveListing).not.toHaveBeenCalled(); expect(f.imageWorkflow).not.toHaveBeenCalled();
    }
  });
  it.each(["kb_images", "image_workflow"])("%s cannot publish kept unsupported video and leave an unreadable image version", async kind => {
    const f = fixture(kind), asset = { ...f.base.state.assets[0], id: 62, role: "video", positionIndex: 1, sourceJsonPath: "$.videos[0]" };
    f.base.state.assets.push(asset); f.base.state.snapshot.normalizedData.assets.push({ ...f.base.state.snapshot.normalizedData.assets[0], role: "video", positionIndex: 1, sourcePath: "$.videos[0]" });
    const { acquisitionReviewHash } = await import("../../../shared/acquisitionReview");
    f.base.state.snapshot.sourceHash = acquisitionReviewHash(f.base.state.snapshot.normalizedData);
    await expect(f.confirm()).rejects.toThrow("IMAGE_ROLE_INVALID");
    expect(f.extra.sets).toHaveLength(1); expect(f.base.state.confirmed).toEqual([]); expect(f.imageWorkflow).not.toHaveBeenCalled();
  });
});
