import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import type { NormalizedAmazonSnapshot } from "../../../shared/acquisition";
import { createCollectedListingSaver } from "./collectedListing";
import { createManualSnapshotReviewTestFixture } from "../acquisition/manualSnapshotReview.testFixture";
import { getManualSnapshotPublication } from "../acquisition/manualSnapshotPublication";

const now = new Date("2026-10-17T00:00:00Z");
const scope = { workspaceId: 3, userId: 7, projectId: 11, asin: "B012345678", confirmedSnapshotId: 9 };
const normalized: NormalizedAmazonSnapshot = { asin: scope.asin, marketplace: "US", sourceUrlHash: "a".repeat(64), title: "Original title",
  brand: "Brand", category: null, description: null, bulletPoints: ["Original bullet"], price: null, rating: "4.7", reviewCount: 22,
  variantAsins: [], assets: [], fieldEvidence: {} };
function row(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return { id: 20, projectId: 11, asin: scope.asin, title: "Old title", bulletPoints: null, imageUrls: null, price: null, rating: null,
    reviewCount: null, reviewAnalysis: "Retained review analysis", keywords: "[]", rawData: JSON.stringify({ reviewImport: { sourceHash: "c".repeat(64) }, research: { previous: true } }),
    aiSummary: "Old AI", summary: "Human edited", summaryStatus: "confirmed", summaryVersion: 4, summaryConfirmedBy: 7, summaryConfirmedAt: now, createdAt: now, updatedAt: now, ...overrides };
}
function fixture(initial: CompetitorAnalysis[] = []) {
  const state = { actor: { id: 7, role: "ops_specialist", status: "active", defaultWorkspaceId: 3 }, parent: { id: 11, userId: 7, workspaceId: 3 },
    confirmed: { id: 9, workspaceId: 3, snapshotId: 8, revisionId: null, asin: scope.asin, marketplace: "US", contentHash: "b".repeat(64), confirmedData: structuredClone(normalized), confirmedAssetIds: [] as number[], isCurrent: 1 },
    source: { id: 8, workspaceId: 3, asin: scope.asin, marketplace: "US", rawArtifactId: 5, normalizedData: structuredClone(normalized) },
    assets: [] as Record<string, unknown>[], competitors: structuredClone(initial), warning: 0, affected: 1, breakReadback: false };
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new MySqlDialect();
  const db = { execute: vi.fn(async (statement: SQL) => {
    const q = dialect.sqlToQuery(statement); calls.push(q);
    if (q.sql.includes("FROM users")) return [[state.actor]];
    if (q.sql.includes("FROM projects")) return [[state.parent]];
    if (q.sql.includes("FROM acquisition_confirmed")) return [[state.confirmed]];
    if (q.sql.includes("FROM acquisition_source")) return [[state.source]];
    if (q.sql.includes("FROM acquisition_asset")) return [state.assets];
    if (q.sql.startsWith("SELECT * FROM competitorAnalyses")) return [state.breakReadback && calls.some(c => c.sql.startsWith("INSERT") || c.sql.startsWith("UPDATE")) ? [] : structuredClone(state.competitors)];
    const fields = ["title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount", "rawData"];
    if (q.sql.startsWith("UPDATE competitorAnalyses")) {
      state.competitors[0] = { ...state.competitors[0], ...Object.fromEntries(fields.map((key, index) => [key, q.params[index]])) };
      return [{ affectedRows: state.affected, warningStatus: state.warning }];
    }
    if (q.sql.startsWith("INSERT INTO competitorAnalyses")) {
      state.competitors = [row({ ...Object.fromEntries(fields.map((key, index) => [key, q.params[index + 2]])), summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null, summary: null, aiSummary: null, reviewAnalysis: null, keywords: null })];
      return [{ insertId: 20, affectedRows: state.affected, warningStatus: state.warning }];
    }
    throw new Error(`Unexpected SQL ${q.sql}`);
  }) };
  const writeCalls = () => calls.filter(c => /^(INSERT|UPDATE)/u.test(c.sql));
  return { state, db, calls, writeCalls };
}
const permission = vi.fn().mockResolvedValue(undefined);
const save = createCollectedListingSaver(permission);
beforeEach(() => permission.mockReset().mockResolvedValue(undefined));

describe("capture-only competitor projection (offline transaction-executor fixture)", () => {
  it("uses only approved same-snapshot image storage references", async () => {
    const f = fixture();
    const ref = { role: "main" as const, positionIndex: 0, sourcePath: "$.images[0]", sourceUrlHash: "d".repeat(64), providerAssetId: null, moduleType: null, moduleClass: null };
    f.state.confirmed.confirmedData.assets = [ref]; f.state.source.normalizedData.assets = [ref]; f.state.confirmed.confirmedAssetIds = [100];
    const asset = { id: 100, workspaceId: 3, snapshotId: 8, sourceArtifactId: 5, role: "main", positionIndex: 0, sourcePath: ref.sourcePath,
      sourceUrlHash: ref.sourceUrlHash, storageKey: "s3://synthetic-scoped/image.jpg", contentHash: "e".repeat(64), reviewStatus: "approved" };
    f.state.assets = [asset, { ...asset, id: 101, storageKey: "not-approved" }];
    await save({ db: f.db, ...scope });
    expect(JSON.parse(f.state.competitors[0].imageUrls!)).toEqual([asset.storageKey]);
    const count = f.writeCalls().length; f.state.assets[0].snapshotId = 99;
    await expect(save({ db: f.db, ...scope })).rejects.toThrow("COMPETITOR_CAPTURE_ASSET_INVALID");
    expect(f.writeCalls()).toHaveLength(count);
  });
  it("saves original fields without any analysis/confirmation result", async () => {
    const f = fixture();
    await expect(save({ db: f.db, ...scope })).resolves.toEqual({ analysisId: 20 });
    const saved = f.state.competitors[0];
    expect(saved.title).toBe(normalized.title); expect(saved.summary).toBeNull();
    expect(JSON.parse(saved.rawData!)).toMatchObject({ captureOnly: true, analysisStale: true, acquisitionCapture: { version: 1, confirmedSnapshotId: 9 } });
    expect(permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "project", action: "update", authorizationRead: { executor: f.db, strict: true, lock: true } }));
    expect(permission.mock.calls[0][0]).not.toHaveProperty("ownerUserId");
    expect(f.calls.findIndex(c => c.sql.includes("FROM projects"))).toBeLessThan(f.calls.findIndex(c => c.sql.includes("FROM competitorAnalyses")));
  });
  it("preserves review provenance, old results and human confirmation verbatim", async () => {
    const old = row(), f = fixture([old]); await save({ db: f.db, ...scope });
    for (const field of ["reviewAnalysis", "keywords", "aiSummary", "summary", "summaryStatus", "summaryVersion", "summaryConfirmedAt", "summaryConfirmedBy"] as const) expect(f.state.competitors[0][field]).toEqual(old[field]);
    expect(JSON.parse(f.state.competitors[0].rawData!)).toMatchObject({ ...JSON.parse(old.rawData!), captureOnly: true, analysisStale: true });
  });
  it("recapture keeps the exact human sales override and independent SellerSprite estimate", async () => {
    const manualSales = { version: 1, value: 0, sourceNote: "Synthetic human calibration", updatedAt: "2026-10-19T00:00:00.000Z", updatedBy: 7 };
    const old = row(), f = fixture([{ ...old, rawData: JSON.stringify({ ...JSON.parse(old.rawData!), manualSales, sellerSpriteData: { monthlySales: 450 } }) }]);
    await save({ db: f.db, ...scope });
    expect(JSON.parse(f.state.competitors[0].rawData!)).toMatchObject({ manualSales, sellerSpriteData: { monthlySales: 450 }, captureOnly: true, analysisStale: true });
    expect(f.state.competitors[0].summary).toBe(old.summary);
  });
  it("same source replay is a no-op even after selected analysis completed", async () => {
    const f = fixture(); await save({ db: f.db, ...scope });
    const raw = JSON.parse(f.state.competitors[0].rawData!);
    f.state.competitors[0].rawData = JSON.stringify({ ...raw, captureOnly: false, analysisStale: false });
    f.state.competitors[0].aiSummary = "new analysis";
    const count = f.writeCalls().length;
    await save({ db: f.db, ...scope });
    expect(f.writeCalls()).toHaveLength(count); expect(f.state.competitors[0].aiSummary).toBe("new analysis");
    expect(JSON.parse(f.state.competitors[0].rawData!).captureOnly).toBe(false);
  });
  it.each(["actor", "parent", "snapshot", "source", "duplicate", "permission", "json", "overflow", "asset"])("fails closed for %s before writes", async kind => {
    const f = fixture();
    if (kind === "actor") f.state.actor.status = "disabled";
    if (kind === "parent") f.state.parent.userId = 88;
    if (kind === "snapshot") f.state.confirmed.workspaceId = 99;
    if (kind === "source") f.state.source.normalizedData.title = "Other source";
    if (kind === "duplicate") f.state.competitors = [row(), row({ id: 21 })];
    if (kind === "permission") permission.mockRejectedValueOnce(new Error("denied"));
    if (kind === "json") f.state.competitors = [row({ rawData: "broken" })];
    if (kind === "overflow") { f.state.confirmed.confirmedData.title = "中".repeat(22000); f.state.source.normalizedData.title = f.state.confirmed.confirmedData.title; }
    if (kind === "asset") f.state.confirmed.confirmedAssetIds = [100];
    await expect(save({ db: f.db, ...scope })).rejects.toThrow(/COMPETITOR_CAPTURE_/);
    expect(f.writeCalls()).toHaveLength(0);
  });
  it("does not let older snapshots overwrite a new capture", async () => {
    const f = fixture([row({ rawData: JSON.stringify({ acquisitionCapture: { version: 1, confirmedSnapshotId: 12, contentHash: "a".repeat(64), sourceHash: "b".repeat(64) } }) })]);
    await expect(save({ db: f.db, ...scope })).rejects.toThrow("COMPETITOR_CAPTURE_OLDER_SNAPSHOT");
    expect(f.writeCalls()).toHaveLength(0);
  });
  it.each(["warning", "affected", "readback"])("rejects %s so the outer transaction must roll back", async kind => {
    const f = fixture();
    if (kind === "warning") f.state.warning = 1;
    if (kind === "affected") f.state.affected = 0;
    if (kind === "readback") f.state.breakReadback = true;
    await expect(save({ db: f.db, ...scope })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("manual revision publication through real review repository and saver", () => {
  const confirmId = "22222222-2222-4222-8222-222222222222";
  it("publishes the exact revised data/assets while preserving original and all human/research history", async () => {
    const f = createManualSnapshotReviewTestFixture(), original = structuredClone(f.state.snapshot);
    const previous = row({ projectId: 11, summaryConfirmedBy: 3 }); f.state.competitors.push(previous);
    const report = { id: 501, workspaceId: 7, projectId: 11, userId: 3, selectionKey: "20-21", analysisIds: "[20,21]", analyzedAsins: "[\"B012345678\",\"B012345679\"]",
      aiSummary: "Old model report", summary: "Retained human report", sellingPointRows: "[]", status: "confirmed" as const, version: 4,
      confirmedBy: 3, confirmedAt: now, createdAt: now, updatedAt: now };
    f.state.comparisons.push(report, { ...report, id: 502, selectionKey: "22-23", analysisIds: "[22,23]" });
    let sourceHash: string | undefined;
    f.control.onPublish = async context => {
      sourceHash = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId)?.sourceHash;
      return save({ db: context.tx, workspaceId: 7, userId: 3, projectId: 11, asin: context.snapshot.asin, confirmedSnapshotId: context.confirmedSnapshotId });
    };
    await f.service.execute(f.ctx, await f.save()); const view = await f.service.read(f.ctx, f.scope);
    const result = await f.service.execute(f.ctx, { ...f.scope, operationId: confirmId, expectedRevisionHash: view.revisionHash, action: "confirm", note: null });
    expect(result.status).toBe("committed"); expect(f.state.competitors[0].title).toBe("Human title");
    expect(f.state.snapshot).toEqual(original); expect(f.state.confirmed[0].isCurrent).toBe(0);
    for (const key of ["summary", "summaryStatus", "summaryVersion", "summaryConfirmedBy", "summaryConfirmedAt", "reviewAnalysis", "aiSummary"] as const) expect(f.state.competitors[0][key]).toEqual(previous[key]);
    expect(JSON.parse(f.state.competitors[0].rawData!)).toMatchObject({ captureOnly: true, analysisStale: true, acquisitionCapture: { sourceHash } });
    expect(JSON.parse(f.state.competitors[0].imageUrls!)).toEqual([f.state.assets[0].storageKey]);
    expect(f.state.comparisons[0]).toMatchObject({ status: "draft", version: 5, confirmedBy: null, confirmedAt: null, summary: report.summary, aiSummary: report.aiSummary });
    expect(f.state.comparisons[1]).toMatchObject({ status: "confirmed", version: 4 });
    expect(getManualSnapshotPublication(f.tx, result.confirmedSnapshotId!)).toBeNull();
    await expect(save({ db: f.tx, workspaceId: 7, userId: 3, projectId: 11, asin: f.state.snapshot.asin, confirmedSnapshotId: result.confirmedSnapshotId! })).rejects.toThrow("SNAPSHOT_CHANGED");
  });
  it.each(["wrong-tx", "wrong-confirmed-data", "wrong-asset", "wrong-original"])("refuses %s and rolls back all manual publication writes", async fault => {
    const f = createManualSnapshotReviewTestFixture();
    f.control.onPublish = async context => {
      if (fault === "wrong-confirmed-data") f.state.confirmed[0].confirmedData = JSON.stringify({ ...context.effectiveData, title: "Changed after ACK" });
      if (fault === "wrong-asset") f.state.assets[0].storageKey = "storage://s3/acquisition/7/snapshots/21/other.png";
      if (fault === "wrong-original") f.state.snapshot.normalizedData.title = "Changed original";
      return save({ db: fault === "wrong-tx" ? { execute: f.execute } : context.tx, workspaceId: 7, userId: 3, projectId: 11, asin: context.snapshot.asin, confirmedSnapshotId: context.confirmedSnapshotId });
    };
    await f.service.execute(f.ctx, await f.save()); const view = await f.service.read(f.ctx, f.scope);
    expect((await f.service.execute(f.ctx, { ...f.scope, operationId: confirmId, expectedRevisionHash: view.revisionHash, action: "confirm", note: null })).status).toBe("unknown");
    expect(f.state.revisions).toHaveLength(1); expect(f.state.confirmed).toHaveLength(0); expect(f.state.competitors).toHaveLength(0); expect(f.state.audits).toHaveLength(1);
    expect(getManualSnapshotPublication(f.tx, 201)).toBeNull();
  });
});
