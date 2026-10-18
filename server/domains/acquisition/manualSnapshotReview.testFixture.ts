import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { getTableName, type Table } from "drizzle-orm";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../../../drizzle/schema/project";
import { createManualSnapshotReviewRepository, type ManualSnapshotPublishContext, type ManualSnapshotReviewExecutor } from "./manualSnapshotReviewRepository";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";
import { acquisitionReviewHash, type AcquisitionReviewWriteInput } from "../../../shared/acquisitionReview";

const stamp = "2026-10-19 01:00:00.000000";
export function createManualSnapshotReviewTestFixture() {
  const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, expectedProjectId: 11 as number | null, snapshotId: 21 };
  const original = { asin: "B012345678", marketplace: "US", sourceUrlHash: "a".repeat(64), title: "Original title", brand: "Original brand", category: null,
    description: null, bulletPoints: ["Original bullet"], price: null, rating: null, reviewCount: null, variantAsins: [],
    assets: [{ role: "main", positionIndex: 0, sourcePath: "$.images[0]", sourceUrlHash: "b".repeat(64), providerAssetId: null, moduleType: null, moduleClass: null }],
    fieldEvidence: { title: { status: "pending_review", sourcePath: "$.title", valueHash: "c".repeat(64), noteCode: null } },
    research: { retainedUnknownEvidence: ["Do not remove this original provenance"] },
  };
  const snapshot = { id: 21, workspaceId: 7, jobId: 31, runId: 41, rawArtifactId: 51, marketplace: "US", asin: original.asin,
    sourceHash: acquisitionReviewHash(original), normalizedData: original, fieldStatuses: original.fieldEvidence, completeness: { partial: false },
    status: "confirmed", reviewedBy: 3, reviewedAt: stamp, reviewNote: "system_direct_ingestion", createdAt: stamp, updatedAt: stamp };
  const asset = { id: 61, workspaceId: 7, snapshotId: 21, sourceArtifactId: 51, role: "main", positionIndex: 0, sourceJsonPath: "$.images[0]", sourceUrlHash: "b".repeat(64),
    providerAssetId: null, storageKey: "storage://s3/acquisition/7/snapshots/21/main/original.png", contentHash: "d".repeat(64), contentType: "image/png", sizeBytes: 88,
    width: 1, height: 1, moduleType: null, moduleClass: null, fieldStatus: "pending_review", reviewStatus: "approved", reviewedBy: 3, reviewedAt: stamp, createdAt: stamp, updatedAt: stamp };
  const state = {
    actor: { id: 3, role: "admin", status: "active", defaultWorkspaceId: 7 }, workspace: { id: 7, status: "active" },
    memberships: [{ id: 1, workspaceId: 7, userId: 3, status: "active" }], parent: { id: 11, userId: 3, workspaceId: 7 },
    kbRecord: { id: 81, userId: 3, workspaceId: 7, asin: original.asin },
    job: { id: 31, workspaceId: 7, requestedBy: 3, consumerType: "project_competitor", consumerRef: "project-competitor:11:B012345678:capture-v1", marketplace: "US", asin: original.asin, status: "confirmed", requestedCapabilities: ["catalog_basic", "image_gallery"] },
    snapshot, assets: [asset], revisions: [] as Array<Record<string, unknown>>, confirmed: [] as Array<Record<string, unknown>>,
    artifact: { id: 51, workspaceId: 7, runId: 41, artifactKind: "provider_result", storageKey: `storage://s3/acquisition/7/runs/41/${"f".repeat(64)}.json`, contentHash: "f".repeat(64), contentType: "application/json", sizeBytes: 99 },
    audits: [] as Array<Record<string, unknown>>, published: [] as number[], links: [] as Array<Record<string, unknown>>,
    competitors: [] as CompetitorAnalysis[],
    comparisons: [] as CompetitorComparisonReport[],
  };
  const control = { enabled: true, deny: false, failPublish: false, commitAckLost: false, badReadback: false, warning: false, admissionFailure: false,
    onPublish: null as ((context: ManualSnapshotPublishContext) => Promise<unknown>) | null };
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new MySqlDialect();
  const execute = async (statement: SQL) => {
    const { sql, params } = dialect.sqlToQuery(statement); sqlCalls.push({ sql, params });
    const result = (value: unknown[]) => [structuredClone(value), []];
    const ok = (insertId = 1) => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0, insertId }, []];
    if (sql.startsWith("SELECT id,status FROM workspaces")) return result(params[0] === state.workspace.id ? [state.workspace] : []);
    if (sql.startsWith("SELECT id,role,status")) return result(params[0] === state.actor.id ? [state.actor] : []);
    if (sql.includes("FROM workspace_memberships")) return result(state.memberships);
    if (sql.includes("FROM projects WHERE")) return result([state.parent]);
    if (sql.includes("FROM kb_listing_copywriting") || sql.includes("FROM kb_product_innovations")) return result([state.kbRecord]);
    if (sql.startsWith("SELECT job_id AS jobId")) return result([{ jobId: state.snapshot.jobId }]);
    if (sql.startsWith("SELECT id FROM acquisition_jobs")) return result([{ id: state.job.id }]);
    if (sql.includes("FROM acquisition_source_snapshots")) return result([{ ...state.snapshot, normalizedData: JSON.stringify(state.snapshot.normalizedData), fieldStatuses: JSON.stringify(state.snapshot.fieldStatuses), completeness: JSON.stringify(state.snapshot.completeness) }]);
    if (sql.includes("FROM acquisition_jobs")) return result([{ ...state.job, requestedCapabilities: JSON.stringify(state.job.requestedCapabilities) }]);
    if (sql.includes("FROM acquisition_raw_artifacts")) return result([state.artifact]);
    if (sql.includes("FROM acquisition_consumer_links")) return result(state.links.filter(link => link.workspaceId === params[0] && link.consumerType === params[1] && link.consumerRef === params[2] && link.status === "active"));
    if (sql.includes("FROM acquisition_asset_candidates")) return result((sql.includes("WHERE id=?") ? state.assets.filter(asset => asset.id === params[0]) : state.assets)
      .map(asset => sql.includes("AS sourcePath") ? { ...asset, sourcePath: asset.sourceJsonPath } : asset));
    if (sql.includes("FROM acquisition_snapshot_revisions")) {
      const revision = state.revisions.at(-1); return result(revision ? [{ ...revision, patch: JSON.stringify(revision.patch) }] : []);
    }
    if (sql.startsWith("INSERT INTO acquisition_snapshot_revisions")) {
      const [workspaceId, snapshotId, version, baseContentHash, patch, revisionHash, note, createdBy] = params;
      const id = 101 + state.revisions.length;
      state.revisions.push({ id, workspaceId, snapshotId, version, baseContentHash, patch: JSON.parse(String(patch)), revisionHash,
        reasonCode: "manual_review_v1", note: control.badReadback ? "tampered" : note, createdBy, createdAt: stamp }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO acquisition_asset_candidates")) {
      const [workspaceId, snapshotId, sourceArtifactId, role, positionIndex, sourceJsonPath, sourceUrlHash, storageKey, contentHash, contentType, sizeBytes, width, height] = params;
      const next = { ...asset, id: 61 + state.assets.length, workspaceId, snapshotId, sourceArtifactId, role, positionIndex, sourceJsonPath, sourceUrlHash, storageKey,
        contentHash, contentType, sizeBytes, width, height, fieldStatus: "pending_review", reviewStatus: "pending", reviewedBy: null, reviewedAt: null } as unknown as typeof asset;
      state.assets.push(next); return ok(next.id);
    }
    if (sql.startsWith("INSERT INTO acquisition_confirmed_snapshots")) {
      const [workspaceId, snapshotId, revisionId, marketplace, asin, version, contentHash, confirmedData, fieldStatuses, assetIds, confirmedBy] = params;
      const id = 201 + state.confirmed.length; state.confirmed.push({ id, workspaceId, snapshotId, revisionId, marketplace, asin, version, contentHash,
        confirmedData: String(confirmedData), fieldStatuses: String(fieldStatuses), assetIds: String(assetIds), confirmedBy, isCurrent: 0 }); return ok(id);
    }
    if (sql.includes("FROM acquisition_confirmed_snapshots")) return result(sql.startsWith("SELECT confirmation_version") ? state.confirmed.slice(-1).map(row => ({ version: row.version })) : state.confirmed.filter(row => row.id === params[0])
      .map(row => sql.includes("AS confirmedAssetIds") ? { ...row, confirmedAssetIds: row.assetIds } : row));
    if (sql.startsWith("SELECT * FROM competitorAnalyses")) return result(sql.includes("WHERE id=?") ? state.competitors.filter(row => row.id === params[0] && row.projectId === params[1]) : state.competitors.filter(row => row.projectId === params[0] && row.asin === params[1]));
    if (sql.startsWith("INSERT INTO competitorAnalyses") || sql.startsWith("UPDATE competitorAnalyses")) {
      const insert = sql.startsWith("INSERT"), offset = insert ? 2 : 0;
      const columns = Object.fromEntries(["title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount", "rawData"].map((key, index) => [key, params[index + offset]]));
      const existing = insert ? null : state.competitors.find(row => row.id === params[7]);
      const row = { id: existing?.id ?? 401, projectId: insert ? params[0] : existing?.projectId, asin: insert ? params[1] : existing?.asin,
        title: null, bulletPoints: null, imageUrls: null, price: null, rating: null, reviewCount: null, rawData: null, reviewAnalysis: null, keywords: null,
        aiSummary: null, summary: null, summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
        createdAt: new Date("2026-10-19T02:00:00.000Z"), updatedAt: new Date("2026-10-19T02:00:00.000Z"), ...existing, ...columns } as CompetitorAnalysis;
      if (insert) state.competitors.push(row); else state.competitors[state.competitors.findIndex(item => item.id === row.id)] = row;
      return ok(row.id);
    }
    if (sql.startsWith("SELECT p.resourceId")) return result(state.audits.filter(row => row.action === "acquisition.review.prepare" && row.resourceId !== params[2]
      && !state.audits.some(final => final.action === "acquisition.review.final" && final.resourceId === row.resourceId)).map(row => ({ operationId: row.resourceId })));
    if (sql.startsWith("SELECT auditId")) return result(state.audits.filter(row => params.includes(row.auditId)));
    if (sql.startsWith("INSERT INTO security_audit_logs")) {
      const [auditId, workspaceId, actorUserId, actorRole, action, resourceId, metadata] = params;
      if (state.audits.some(row => row.auditId === auditId)) throw new Error("duplicate audit ID");
      state.audits.push({ auditId, workspaceId, actorUserId, actorRole, action, resourceId, metadata, resourceType: "acquisition_review_operation", status: "success", riskLevel: "medium" }); return ok();
    }
    throw new Error(`Unrecognized synthetic SQL: ${sql}`);
  };
  // The existing comparison invalidator uses Drizzle's select/update facade.
  // This bounded protocol adapter executes that real function in this same TX.
  const tx: ManualSnapshotReviewExecutor = { execute,
    select(projection?: Record<string, unknown>) {
      let table = "", parameters: unknown[] = [];
      const query = {
        from(value: Table) { table = getTableName(value); return query; },
        where(condition: SQL) { parameters = dialect.sqlToQuery(condition).params; return query; },
        limit(_count: number) { return query; },
        async for(mode: string) {
          sqlCalls.push({ sql: `DRIZZLE SELECT ${table} FOR ${mode}`, params: parameters });
          if (table === "projects") return structuredClone([state.parent]);
          if (table !== "competitorComparisonReports") throw new Error("Unexpected comparison table");
          const found = projection ? state.comparisons.filter(row => row.projectId === parameters[0] && row.status === parameters[1])
            : state.comparisons.filter(row => row.id === parameters[0] && row.projectId === parameters[1]);
          return structuredClone(projection ? found.map(row => ({ id: row.id, analysisIds: row.analysisIds, selectionBytes: Buffer.byteLength(row.analysisIds) })) : found);
        },
      }; return query;
    },
    update(table: Table) { return { set(values: Partial<CompetitorComparisonReport>) { return { async where(condition: SQL) {
      if (getTableName(table) !== "competitorComparisonReports") throw new Error("Unexpected comparison write");
      const params = dialect.sqlToQuery(condition).params;
      sqlCalls.push({ sql: "DRIZZLE UPDATE competitorComparisonReports", params });
      const index = state.comparisons.findIndex(row => row.id === params[0] && row.projectId === params[1] && row.version === params[2]);
      if (index < 0) return [{ affectedRows: 0, warningStatus: 0 }];
      state.comparisons[index] = { ...state.comparisons[index], ...values }; return [{ affectedRows: 1, warningStatus: 0 }];
    } }; } }; },
  } as ManualSnapshotReviewExecutor & { select(projection?: Record<string, unknown>): unknown; update(table: Table): unknown };
  const getDb = async () => ({ async transaction<T>(body: (executor: ManualSnapshotReviewExecutor) => Promise<T>): Promise<T> {
    const backup = structuredClone(state);
    let value: T;
    try { value = await body(tx); } catch (error) { Object.assign(state, backup); throw error; }
    if (control.commitAckLost) { control.commitAckLost = false; throw new Error("Synthetic commit ACK lost"); } return value;
  } });
  const publish = async (context: ManualSnapshotPublishContext) => { state.published.push(context.confirmedSnapshotId); if (control.failPublish) throw new Error("Synthetic publish rollback");
    return control.onPublish ? control.onPublish(context) : { published: true }; };
  const repository = createManualSnapshotReviewRepository({ getDb, enabled: () => control.enabled, permission: async () => { if (control.deny) throw new Error("denied"); },
    admit: async () => { if (control.admissionFailure) throw new Error("missing schema"); }, now: () => new Date("2026-10-19T02:00:00.000Z"), publish });
  const service = createManualSnapshotReviewService({ repository, previewUrl: async () => "https://synthetic.invalid/image.png" });
  const ctx = { user: { id: 3 }, workspaceId: 7 };
  const operationId = "11111111-1111-4111-8111-111111111111";
  const save = async (overrides: Partial<AcquisitionReviewWriteInput> = {}) => {
    const view = await service.read(ctx, scope);
    return { ...scope, operationId, expectedRevisionHash: view.revisionHash, action: "save" as const, patch: { title: "Human title" },
      assetDecisions: view.assets.map(asset => ({ assetId: asset.id, decision: "keep" as const })), note: "Human note", ...overrides } as AcquisitionReviewWriteInput;
  };
  return { state, control, identity, scope, ctx, operationId, repository, service, execute, tx, sqlCalls, save, getDb, publish };
}
