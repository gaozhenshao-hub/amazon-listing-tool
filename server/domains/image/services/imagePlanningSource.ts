import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { projects, projectFiles, competitorAnalyses, competitorComparisonReports } from "../../../../drizzle/schema/project";
import { imageWorkflowSessions, imageWorkflowStep0Artifacts } from "../../../../drizzle/schema/image";
import { imageWorkflowStageSnapshots } from "../../../../drizzle/schema/imageWorkflowVersions";
import { keywords, listings, reviewAggregations } from "../../../../drizzle/schema/listing";
import { ImagePlanningSourceSchema, imagePlanningHash, imagePlanningCanonical, IMAGE_PLANNING_LIMITS,
  type ImagePlanningIdentity, type ImagePlanningScope, type ImagePlanningSource } from "../../../../shared/imagePlanning";
import { hydrateImagePlanningResearch } from "../../../services/imagePlanningResearch";
import { readActiveCompetitorResearch, assertActiveCompetitorResearchScope } from "../../../services/competitorActiveResearch";
import { buildHumanConfirmedStageDraft, materializeImmutableStageSnapshot, currentImageWorkflowUpstreamDigest,
  immutableDigest, type StoredStageSnapshot } from "./imageWorkflowVersionPolicy";
import { imageAssetPolicyService } from "./imageAssetPolicyService";
import type { DbExecutor } from "../../../repositories/dbClient";

export interface ImagePlanningExecutor { execute(query: SQL): Promise<unknown> }
export class ImagePlanningRepositoryError extends Error {
  constructor(readonly code: string, readonly outcomeUnknown = false) { super(`IMAGE_PLANNING_${code}`); this.name = "ImagePlanningRepositoryError"; }
}
export function imagePlanningFail(code: string): never { throw new ImagePlanningRepositoryError(code); }
export function imagePlanningStatement(query: string, params: unknown[] = []): SQL {
  const parts = query.split("?");
  if (parts.length !== params.length + 1) return imagePlanningFail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
export async function imagePlanningRows(tx: ImagePlanningExecutor, query: string, params: unknown[], maximum: number): Promise<Record<string, unknown>[]> {
  const result = await tx.execute(imagePlanningStatement(query, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum
    || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) return imagePlanningFail("READ_INVALID");
  return result[0];
}
export function imagePlanningJson(value: unknown, maximum = IMAGE_PLANNING_LIMITS.sourceBytes): unknown {
  try {
    const text = typeof value === "string" ? value : imagePlanningCanonical(value);
    if (Buffer.byteLength(text) > maximum) return imagePlanningFail("SOURCE_LIMIT");
    return JSON.parse(text);
  } catch (error) { if (error instanceof ImagePlanningRepositoryError) throw error; return imagePlanningFail("JSON_INVALID"); }
}
const jsonRow = (row: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(row));
const tables = [projects, imageWorkflowSessions, projectFiles, competitorAnalyses, competitorComparisonReports,
  keywords, listings, reviewAggregations, imageWorkflowStep0Artifacts] as AnyMySqlTable[];
/** Reject unknown columns rather than claiming a complete capture after silently
 * dropping newly added facts. This is metadata admission, never a migration. */
export async function assertImagePlanningSourceSchema(tx: ImagePlanningExecutor): Promise<void> {
  for (const table of tables) {
    const config = getTableConfig(table), columns = await imagePlanningRows(tx,
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 201", [config.name], 200);
    const normalize = (value: string) => value.toLowerCase().replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",");
    if (columns.length !== config.columns.length || new Set(columns.map(row => row.name)).size !== columns.length
      || config.columns.some(expected => {
        const actual = columns.find(row => row.name === expected.name);
        return !actual || typeof actual.columnType !== "string" || normalize(actual.columnType) !== normalize(expected.getSQLType())
          || actual.nullable !== (expected.notNull ? "NO" : "YES") || typeof actual.extra !== "string" || /generated/iu.test(actual.extra.replace(/DEFAULT_GENERATED/giu, ""));
      })) imagePlanningFail("SOURCE_SCHEMA_UNAVAILABLE");
  }
}
async function completeRows(tx: ImagePlanningExecutor, table: AnyMySqlTable, where: string, params: unknown[], maximum = 100) {
  const config = getTableConfig(table);
  const columns = config.columns.map(column => `\`${column.name}\``);
  const byteCount = columns.map(column => `COALESCE(OCTET_LENGTH(${column}),0)`).join("+");
  const projection = columns.map(column => `IF((${byteCount})<=${IMAGE_PLANNING_LIMITS.sourceBytes},${column},NULL) AS ${column}`).join(",");
  const rows = await imagePlanningRows(tx, `SELECT ${projection},(${byteCount}) AS __sourceBytes FROM \`${config.name}\` WHERE ${where} ORDER BY id LIMIT ${maximum + 1} FOR SHARE`, params, maximum);
  for (const row of rows) {
    if (!Number.isSafeInteger(Number(row.__sourceBytes)) || Number(row.__sourceBytes) > IMAGE_PLANNING_LIMITS.sourceBytes) imagePlanningFail("SOURCE_LIMIT");
    delete row.__sourceBytes;
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0) imagePlanningFail("SOURCE_INVALID");
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) imagePlanningFail("SOURCE_INVALID");
  return rows;
}

function confirmedSnapshots(rows: Record<string, unknown>[], scope: ImagePlanningScope): StoredStageSnapshot[] {
  const output: StoredStageSnapshot[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(Number(row.__sourceBytes)) || Number(row.__sourceBytes) < 0 || Number(row.__sourceBytes) > IMAGE_PLANNING_LIMITS.sourceBytes) imagePlanningFail("SOURCE_LIMIT");
    if (row.workspaceId !== scope.expectedWorkspaceId || row.projectId !== scope.projectId || row.sessionId !== scope.sessionId
      || ![0, 1].includes(Number(row.step)) || !["confirmed", "superseded", "invalidated"].includes(String(row.state))) imagePlanningFail("UPSTREAM_INVALID");
    const draft = buildHumanConfirmedStageDraft({ workspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, sessionId: scope.sessionId,
      step: row.step as 0 | 1, content: imagePlanningJson(row.contentJson), contentRevision: Number(row.contentRevision),
      contentOrigin: row.contentOrigin as "human_confirmed" | "legacy_human_confirmed", sourceConfirmed: true,
      assetDependencies: imagePlanningJson(row.assetDependenciesJson) as StoredStageSnapshot["assetDependencies"] },
      imagePlanningJson(row.dependenciesJson) as StoredStageSnapshot["dependencies"]);
    const snapshot = materializeImmutableStageSnapshot({ draft, version: Number(row.version), confirmedBy: Number(row.confirmedBy),
      confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt : new Date(String(row.confirmedAt)) });
    if (!Number.isFinite(snapshot.confirmedAt.getTime()) || snapshot.contentDigest !== row.contentDigest || snapshot.assetDependencyDigest !== row.assetDependencyDigest
      || snapshot.dependencyDigest !== row.dependencyDigest || snapshot.snapshotDigest !== row.snapshotDigest) imagePlanningFail("UPSTREAM_INVALID");
    output.push({ ...snapshot, state: row.state as StoredStageSnapshot["state"] });
  }
  // Existing pure policy verifies the same Step 0/1 chain, not a second weaker
  // interpretation of human confirmation.
  currentImageWorkflowUpstreamDigest({ scope: { workspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, sessionId: scope.sessionId },
    targetStep: 2, snapshots: output });
  return output.filter(row => row.state === "confirmed");
}

/** Called only inside the repository's fresh authorized, parent/session-locked
 * transaction. No global DB access, usage writes, model or external reads. */
export async function captureImagePlanningSource(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningScope,
  dependencies: { policyReader?: typeof imageAssetPolicyService.requireCurrentApprovedAssetUseInTransaction } = {}): Promise<ImagePlanningSource> {
  if (scope.expectedWorkspaceId !== identity.workspaceId) imagePlanningFail("ACCESS_DENIED");
  const [project] = await completeRows(tx, projects, "id=?", [scope.projectId], 1);
  const [session] = await completeRows(tx, imageWorkflowSessions, "id=? AND projectId=?", [scope.sessionId, scope.projectId], 1);
  if (!project || project.workspaceId !== identity.workspaceId || !session || session.userId !== identity.userId) imagePlanningFail("ACCESS_DENIED");
  if (session.step0Confirmed !== 1 || session.step1Confirmed !== 1 || session.step2Confirmed !== 0) imagePlanningFail("HUMAN_UPSTREAM_REQUIRED");
  const versions = await imagePlanningRows(tx, "SELECT workspaceId,projectId,sessionId,revision FROM image_workflow_version_scopes WHERE workspaceId=? AND projectId=? AND sessionId=? FOR UPDATE",
    [identity.workspaceId, scope.projectId, scope.sessionId], 1);
  const revision = versions[0];
  if (!revision || revision.workspaceId !== identity.workspaceId || revision.projectId !== scope.projectId || revision.sessionId !== scope.sessionId
    || !Number.isSafeInteger(revision.revision) || Number(revision.revision) < 1) imagePlanningFail("VERSION_LEDGER_UNAVAILABLE");
  const snapshotColumns = getTableConfig(imageWorkflowStageSnapshots).columns.map(column => `s.\`${column.name}\``);
  const snapshotBytes = snapshotColumns.map(column => `COALESCE(OCTET_LENGTH(${column}),0)`).join("+");
  const snapshotProjection = snapshotColumns.map(column => `IF((${snapshotBytes})<=${IMAGE_PLANNING_LIMITS.sourceBytes},${column},NULL) AS ${column.slice(2)}`).join(",");
  const snapshotRows = await imagePlanningRows(tx, `SELECT ${snapshotProjection},(${snapshotBytes}) AS __sourceBytes,e.state FROM image_workflow_stage_snapshots s
    INNER JOIN (SELECT snapshotDigest,MAX(id) AS latestId FROM image_workflow_snapshot_state_events WHERE workspaceId=? AND projectId=? AND sessionId=? GROUP BY snapshotDigest) latest ON latest.snapshotDigest=s.snapshotDigest
    INNER JOIN image_workflow_snapshot_state_events e ON e.id=latest.latestId
    WHERE s.workspaceId=? AND s.projectId=? AND s.sessionId=? AND s.step IN (0,1) ORDER BY s.step,s.version LIMIT 101 FOR SHARE`,
    [identity.workspaceId, scope.projectId, scope.sessionId, identity.workspaceId, scope.projectId, scope.sessionId], 100);
  const snapshots = confirmedSnapshots(snapshotRows, scope);
  if (snapshots.some(snapshot => snapshot.assetDependencies.length > 0)) {
    const names = ["image_assets", "image_asset_policy_revisions", "image_controlled_upload_receipts", "image_asset_license_evidence_revisions"];
    const metadata = await imagePlanningRows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")}) LIMIT 5`, names, 4);
    if (metadata.length !== names.length || new Set(metadata.map(row => row.name)).size !== names.length || metadata.some(row => !names.includes(String(row.name)) || row.engine !== "InnoDB")) imagePlanningFail("SOURCE_SCHEMA_UNAVAILABLE");
    const actors = await imagePlanningRows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId], 1), actor = actors[0];
    if (!actor || actor.id !== identity.userId || actor.status !== "active" || actor.defaultWorkspaceId !== identity.workspaceId || typeof actor.role !== "string" || !actor.role) imagePlanningFail("ACCESS_DENIED");
    const requireCurrent = dependencies.policyReader ?? imageAssetPolicyService.requireCurrentApprovedAssetUseInTransaction;
    for (const snapshot of snapshots) for (const dependency of snapshot.assetDependencies) {
      const approved = await requireCurrent(tx as DbExecutor, { workspaceId: identity.workspaceId, projectId: scope.projectId, actorId: identity.userId, actorRole: actor.role,
        assetId: dependency.assetId, allowedUse: dependency.allowedUse, expectedRevision: dependency.policyRevision });
      // This is the exact existing version-policy digest, not the mutable
      // policy row's own hash. Current receipt/license replay is performed by
      // the original policy service using this same transaction.
      const digest = immutableDigest({ assetId: approved.assetId, originKind: approved.originKind, allowedUses: [...approved.allowedUses].sort(),
        reviewState: approved.reviewState, revision: approved.revision, contentHash: approved.contentHash, storageRef: approved.storageRef });
      if (digest !== dependency.policyHash || approved.assetId !== dependency.assetId || approved.revision !== dependency.policyRevision
        || approved.contentHash !== dependency.contentHash || approved.reviewState !== "approved" || approved.originKind !== dependency.originKind) imagePlanningFail("CURRENT_ASSET_POLICY_CHANGED");
    }
  }
  for (const snapshot of snapshots) {
    const text = session[`step${snapshot.step}UserEdit`];
    if (!text || imagePlanningHash(imagePlanningJson(text)) !== imagePlanningHash(snapshot.content)) imagePlanningFail("UPSTREAM_CHANGED");
  }
  const downstream = await imagePlanningRows(tx, `SELECT s.step,e.state FROM image_workflow_stage_snapshots s
    INNER JOIN (SELECT snapshotDigest,MAX(id) AS latestId FROM image_workflow_snapshot_state_events WHERE workspaceId=? AND projectId=? AND sessionId=? GROUP BY snapshotDigest) latest ON latest.snapshotDigest=s.snapshotDigest
    INNER JOIN image_workflow_snapshot_state_events e ON e.id=latest.latestId
    WHERE s.workspaceId=? AND s.projectId=? AND s.sessionId=? AND s.step>=2 AND e.state='confirmed' LIMIT 1 FOR SHARE`,
    [identity.workspaceId, scope.projectId, scope.sessionId, identity.workspaceId, scope.projectId, scope.sessionId], 1);
  if (downstream.length) imagePlanningFail("DOWNSTREAM_CONFIRMATION_EXISTS");
  const files = await completeRows(tx, projectFiles, "projectId=? AND status='completed'", [scope.projectId]);
  if (files.some(row => row.workspaceId !== identity.workspaceId || row.userId !== identity.userId)) imagePlanningFail("SOURCE_SCOPE_INVALID");
  const competitors = await completeRows(tx, competitorAnalyses, "projectId=?", [scope.projectId]);
  const canonicalCompetitors: Record<string, unknown>[] = [];
  for (const row of competitors) {
    await hydrateImagePlanningResearch(row as typeof competitorAnalyses.$inferSelect, tx as DbExecutor,
      { id: scope.projectId, userId: Number(project.userId), workspaceId: identity.workspaceId });
    const active = readActiveCompetitorResearch(row);
    if (row.projectId !== scope.projectId || typeof row.asin !== "string" || !row.asin) imagePlanningFail("SOURCE_INVALID");
    assertActiveCompetitorResearchScope({ id: Number(row.id), projectId: scope.projectId, asin: row.asin }, active, { ...identity, projectId: scope.projectId });
    if (active.status === "unavailable") imagePlanningFail("COMPETITOR_SOURCE_UNAVAILABLE");
    canonicalCompetitors.push({ row: jsonRow(row), active: jsonRow(active as unknown as Record<string, unknown>) });
  }
  const comparisons = await completeRows(tx, competitorComparisonReports, "projectId=? AND status='confirmed'", [scope.projectId]);
  if (comparisons.some(row => row.workspaceId !== identity.workspaceId || row.userId !== identity.userId)) imagePlanningFail("SOURCE_SCOPE_INVALID");
  const keywordRows = await completeRows(tx, keywords, "projectId=?", [scope.projectId]);
  if (keywordRows.some(row => row.userId !== identity.userId)) imagePlanningFail("SOURCE_SCOPE_INVALID");
  const activeListings = await completeRows(tx, listings, "projectId=? AND isActive=1", [scope.projectId], 1);
  const aggregates = await completeRows(tx, reviewAggregations, "projectId=? AND status='completed'", [scope.projectId]);
  if (aggregates.some(row => row.userId !== identity.userId)) imagePlanningFail("SOURCE_SCOPE_INVALID");
  const composites = await completeRows(tx, imageWorkflowStep0Artifacts, "workspaceId=? AND projectId=? AND sessionId=? AND artifactType='composite' AND status='confirmed'", [identity.workspaceId, scope.projectId, scope.sessionId], 1);
  const body = { version: 1 as const, identity, scope, sourceRevision: imagePlanningHash({ project: jsonRow(project), session: jsonRow(session), scopeRevision: revision.revision }),
    scopeRevision: Number(revision.revision), project: jsonRow(project), session: jsonRow(session),
    confirmedSteps: snapshots.map(row => ({ step: row.step as 0 | 1, version: row.version, snapshotHash: row.snapshotDigest, content: row.content as Record<string, unknown> })),
    files: files.map(jsonRow), competitors: canonicalCompetitors, comparisons: comparisons.map(jsonRow), keywordAnalyses: keywordRows.map(jsonRow),
    otherSources: [...activeListings.map(row => ({ kind: "active_listing", row: jsonRow(row) })), ...aggregates.map(row => ({ kind: "legacy_review_aggregation", row: jsonRow(row) })),
      ...composites.map(row => ({ kind: "confirmed_step0_composite", row: jsonRow(row) }))], coverage: "complete_saved_project_inputs_not_exhaustive_market" as const };
  return ImagePlanningSourceSchema.parse({ ...body, sourceHash: imagePlanningHash(body) });
}
