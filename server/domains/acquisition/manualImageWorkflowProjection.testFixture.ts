import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createManualSnapshotReviewTestFixture } from "./manualSnapshotReview.testFixture";
import { createManualSnapshotReviewRepository } from "./manualSnapshotReviewRepository";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";
import { getManualSnapshotPublication } from "./manualSnapshotPublication";
import { projectManualSnapshotToImageWorkflow } from "./manualImageWorkflowProjection";
import type { ManualSnapshotReviewExecutor } from "./manualSnapshotRevision";

const stamp = "2026-10-19 01:00:00.000000";
/** Real writer/proof/reader implementation over a synthetic SQL wire protocol,
 * not native MySQL, a model, or a live storage-provider acceptance test. */
export function createManualImageWorkflowProjectionTestFixture() {
  const f = createManualSnapshotReviewTestFixture(), dialect = new MySqlDialect();
  const state = f.state as typeof f.state & { subjects: Array<Record<string, unknown>> }; state.subjects = [];
  state.job.consumerType = "image_workflow"; state.job.consumerRef = "project:11:competitor-gallery";
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const result = (rows: unknown[]) => [structuredClone(rows), []];
  const execute = async (statement: SQL) => {
    const { sql, params } = dialect.sqlToQuery(statement); sqlCalls.push({ sql, params });
    if (sql.includes("FROM image_competitor_research_subjects")) {
      const matching = state.subjects.filter(row => row.workspaceId === params[0] && row.projectId === params[1]
        && (sql.includes("confirmedSnapshotId=?") ? row.confirmedSnapshotId === params[2] : row.status !== "archived"));
      return result(matching);
    }
    if (sql.startsWith("INSERT INTO image_competitor_research_subjects")) {
      const [workspaceId, projectId, userId, confirmedSnapshotId, marketplace, asin, displayName, role, sortOrder] = params;
      const row = { id: 501 + state.subjects.length, workspaceId, projectId, userId, confirmedSnapshotId, marketplace, asin, displayName, role,
        status: "ready", currentAnalysisVersion: 0, sortOrder }; state.subjects.push(row);
      return [{ insertId: row.id, affectedRows: 1, warningStatus: 0 }, []];
    }
    if (sql.includes("FROM acquisition_confirmed_snapshots") && !sql.startsWith("SELECT confirmation_version")) {
      const found = state.confirmed.filter(row => row.id === params[0] && row.workspaceId === params[1]);
      if (sql.includes("AS confirmationVersion")) return result(found.map(row => ({ id: row.id, workspaceId: row.workspaceId, snapshotId: row.snapshotId,
        revisionId: row.revisionId, marketplace: row.marketplace, asin: row.asin, confirmationVersion: row.version, contentHash: row.contentHash,
        confirmedData: row.confirmedData, fieldStatuses: row.fieldStatuses, confirmedAssetIds: row.assetIds, isCurrent: row.isCurrent, confirmedBy: row.confirmedBy,
        confirmedAt: stamp, createdAt: stamp })));
      if (sql.startsWith("SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,is_current")) return result(found.map(row => ({ id: row.id, workspaceId: row.workspaceId, snapshotId: row.snapshotId, revisionId: row.revisionId, isCurrent: row.isCurrent })));
    }
    if (sql.includes("FROM acquisition_snapshot_revisions") && !sql.includes("ORDER BY version DESC")) {
      const found = state.revisions.filter(row => sql.includes("WHERE id=?") ? row.id === params[0] && row.snapshotId === params[1] && row.workspaceId === params[2]
        : row.snapshotId === params[0] && row.workspaceId === params[1] && row.version === params[2]);
      return result(found.map(row => ({ ...row, patch: JSON.stringify(row.patch) })));
    }
    if (sql.includes("FROM acquisition_asset_candidates") && sql.includes("id IN (")) return result(state.assets.filter(row => row.snapshotId === params[0] && row.workspaceId === params[1] && params.slice(2).includes(row.id)));
    if (sql.includes("FROM acquisition_consumer_links") && sql.includes("confirmed_snapshot_id=?")) {
      return result(state.links.filter(row => row.workspaceId === params[0] && row.confirmedSnapshotId === params[1] && row.consumerType === params[2] && row.consumerRef === params[3]
        && row.capabilityScope === "image_gallery" && (sql.includes("status IN") ? ["active", "superseded"].includes(String(row.status)) : row.status === "active"))
        .map(row => ({ id: row.id, workspaceId: row.workspaceId, confirmedSnapshotId: row.confirmedSnapshotId, consumerType: row.consumerType, consumerRef: row.consumerRef,
          capabilityScope: row.capabilityScope, projectionVersion: row.projectionVersion, status: row.status, createdBy: row.createdBy })));
    }
    return f.execute(statement);
  };
  const tx: ManualSnapshotReviewExecutor = { execute };
  const getDb = async () => ({ async transaction<T>(body: (executor: ManualSnapshotReviewExecutor) => Promise<T>): Promise<T> {
    return (await f.getDb()).transaction(async () => body(tx));
  } });
  f.control.onPublish = async context => {
    const projection = await projectManualSnapshotToImageWorkflow(context), proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId)!;
    for (const old of state.links) if (old.consumerType === state.job.consumerType && old.consumerRef === state.job.consumerRef) old.status = "superseded";
    for (const capabilityScope of state.job.requestedCapabilities) state.links.push({ id: 701 + state.links.length, workspaceId: f.identity.workspaceId,
      confirmedSnapshotId: context.confirmedSnapshotId, consumerType: state.job.consumerType, consumerRef: state.job.consumerRef, capabilityScope,
      projectionVersion: proof.sourceHash, status: "active", createdBy: f.identity.userId, createdAt: stamp, updatedAt: stamp });
    return projection;
  };
  const repository = createManualSnapshotReviewRepository({ getDb, enabled: () => f.control.enabled, permission: async () => undefined, admit: async () => undefined,
    now: () => new Date("2026-10-19T02:00:00.000Z"), publish: f.publish });
  const service = createManualSnapshotReviewService({ repository, previewUrl: async () => "https://synthetic.invalid/image.png" });
  const save = async () => {
    const view = await service.read(f.ctx, f.scope);
    return service.execute(f.ctx, { ...f.scope, operationId: f.operationId, expectedRevisionHash: view.revisionHash, action: "save", patch: { title: "Human-reviewed title" },
      assetDecisions: view.assets.map(asset => ({ assetId: asset.id, decision: "keep" as const })), note: "Human-reviewed full source" });
  };
  const confirm = async () => {
    const view = await service.read(f.ctx, f.scope);
    return service.execute(f.ctx, { ...f.scope, operationId: "22222222-2222-4222-8222-222222222222", expectedRevisionHash: view.revisionHash, action: "confirm", note: "Confirmed original full source" });
  };
  return { ...f, state, repository, service, save, confirm, getDb, tx, execute, sqlCalls };
}
