import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AcquisitionReviewWriteResultSchema, acquisitionReviewCanonical, acquisitionReviewHash, acquisitionReviewRequestHash,
  type AcquisitionReviewIdentity, type AcquisitionReviewReadInput } from "../../../shared/acquisitionReview";
import type { DbExecutor } from "../../repositories/dbClient";
import { getManualSnapshotPublication } from "./manualSnapshotPublication";
import { ManualSnapshotRevisionSchema, replayManualSnapshotRevision, type ManualSnapshotAsset, type ManualSnapshotRevision, type ManualSnapshotRevisionRow,
  type ManualSnapshotPublishContext, type ManualSnapshotReviewExecutor } from "./manualSnapshotRevision";

const id = z.number().int().positive().max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const MAX = 8 * 1024 * 1024;
export class ManualImageWorkflowSourceError extends Error {
  constructor() { super("MANUAL_IMAGE_WORKFLOW_SOURCE_UNAVAILABLE"); this.name = "ManualImageWorkflowSourceError"; }
}
const fail = (): never => { throw new ManualImageWorkflowSourceError(); };
const same = (a: unknown, b: unknown) => acquisitionReviewHash(a) === acquisitionReviewHash(b);
function statement(query: string, values: unknown[]): SQL {
  const parts = query.split("?"); if (parts.length !== values.length + 1) return fail();
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: ManualSnapshotReviewExecutor, query: string, params: unknown[], maximum: number) {
  const response = await tx.execute(statement(query, params));
  if (!Array.isArray(response) || !Array.isArray(response[0]) || response[0].length > maximum
    || response[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) return fail();
  acquisitionReviewCanonical(response[0], MAX); return response[0] as Array<Record<string, unknown>>;
}
function json(value: unknown): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX) return fail();
  try { const result: unknown = JSON.parse(value); acquisitionReviewCanonical(result); return result; } catch { return fail(); }
}
const date = (column: string, alias: string) => `DATE_FORMAT(${column},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const jsonColumn = (column: string, alias: string) => `IF(OCTET_LENGTH(CAST(${column} AS CHAR CHARACTER SET utf8mb4))<=${MAX},CAST(${column} AS CHAR CHARACTER SET utf8mb4),NULL) AS ${alias}`;
const confirmedProjection = `id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,marketplace,asin,confirmation_version AS confirmationVersion,content_hash AS contentHash,${jsonColumn("confirmed_data", "confirmedData")},${jsonColumn("field_statuses", "fieldStatuses")},${jsonColumn("confirmed_asset_ids", "confirmedAssetIds")},is_current AS isCurrent,confirmed_by AS confirmedBy,${date("confirmed_at", "confirmedAt")},${date("created_at", "createdAt")}`;
const sourceProjection = `id,workspace_id AS workspaceId,job_id AS jobId,run_id AS runId,raw_artifact_id AS rawArtifactId,marketplace,asin,source_hash AS sourceHash,${jsonColumn("normalized_data", "normalizedData")},${jsonColumn("field_statuses", "fieldStatuses")},${jsonColumn("completeness", "completeness")},status,reviewed_by AS reviewedBy,${date("reviewed_at", "reviewedAt")},review_note AS reviewNote,${date("created_at", "createdAt")},${date("updated_at", "updatedAt")}`;
const assetProjection = `id,workspace_id AS workspaceId,snapshot_id AS snapshotId,source_artifact_id AS sourceArtifactId,role,position_index AS positionIndex,source_json_path AS sourceJsonPath,source_url_hash AS sourceUrlHash,provider_asset_id AS providerAssetId,storage_key AS storageKey,content_hash AS contentHash,content_type AS contentType,size_bytes AS sizeBytes,width,height,module_type AS moduleType,module_class AS moduleClass,field_status AS fieldStatus,review_status AS reviewStatus,reviewed_by AS reviewedBy,${date("reviewed_at", "reviewedAt")},${date("created_at", "createdAt")},${date("updated_at", "updatedAt")}`;
const revisionProjection = `id,workspace_id AS workspaceId,snapshot_id AS snapshotId,version,base_content_hash AS baseContentHash,${jsonColumn("patch", "patch")},revision_hash AS revisionHash,reason_code AS reasonCode,note,created_by AS createdBy,${date("created_at", "createdAt")}`;
const subjectProjection = "id,workspaceId,projectId,userId,confirmedSnapshotId,marketplace,asin,displayName,role,status,currentAnalysisVersion,sortOrder";

/** Only the actual confirming repository transaction may issue the short-lived
 * proof. A structurally identical browser object or a stale transaction cannot
 * project anything. This appends a new subject; old subjects/facts stay intact. */
export async function projectManualSnapshotToImageWorkflow(context: ManualSnapshotPublishContext) {
  const proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId);
  if (!proof || proof.job.consumerType !== "image_workflow" || proof.job.consumerRef !== `project:${proof.envelope.scope.expectedProjectId}:competitor-gallery`
    || proof.envelope.scope.expectedProjectId === null || !same(context.identity, proof.identity) || !same(context.job, proof.job)
    || !same(context.envelope, proof.envelope) || context.confirmedSnapshotId !== proof.confirmedSnapshotId) return fail();
  if (!proof.assets.length || proof.assets.some(asset => !["main", "secondary", "aplus", "brand_story"].includes(asset.role))) throw new Error("ACQUISITION_REVIEW_PUBLICATION_IMAGE_ROLE_INVALID");
  const projectId = proof.envelope.scope.expectedProjectId, workspaceId = proof.identity.workspaceId;
  const [project] = await rows(context.tx, "SELECT id,userId,workspaceId FROM projects WHERE id=? FOR UPDATE", [projectId], 1);
  const [confirmed] = await rows(context.tx, `SELECT ${confirmedProjection} FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? FOR SHARE`, [proof.confirmedSnapshotId, workspaceId], 1);
  if (!project || project.id !== projectId || project.workspaceId !== workspaceId || project.userId !== proof.identity.userId
    || !confirmed || confirmed.id !== proof.confirmedSnapshotId || confirmed.workspaceId !== workspaceId || confirmed.snapshotId !== proof.snapshot.id
    || confirmed.revisionId !== proof.revision.id || confirmed.confirmedBy !== proof.identity.userId || confirmed.isCurrent !== 0
    || confirmed.contentHash !== proof.contentHash || confirmed.asin !== proof.snapshot.asin || confirmed.marketplace !== proof.snapshot.marketplace
    || !same(json(confirmed.confirmedData), proof.effectiveData) || !same(json(confirmed.confirmedAssetIds), proof.assets.map(asset => asset.id))) return fail();
  const existing = await rows(context.tx, `SELECT ${subjectProjection} FROM image_competitor_research_subjects WHERE workspaceId=? AND projectId=? AND confirmedSnapshotId=? FOR UPDATE`, [workspaceId, projectId, confirmed.id], 1);
  if (existing.length) {
    const current = existing[0];
    if (current.userId !== proof.identity.userId || current.marketplace !== proof.snapshot.marketplace || current.asin !== proof.snapshot.asin || current.status === "archived") return fail();
    return { consumerType: "image_workflow" as const, projectId, subjectId: id.parse(current.id), confirmedSnapshotId: proof.confirmedSnapshotId, created: false };
  }
  const previous = await rows(context.tx, `SELECT ${subjectProjection} FROM image_competitor_research_subjects WHERE workspaceId=? AND projectId=? AND status<>'archived' ORDER BY sortOrder,id LIMIT 301 FOR UPDATE`, [workspaceId, projectId], 300);
  const role = previous.some(subject => subject.role === "primary") ? "benchmark" : "primary";
  const fullTitle = typeof proof.effectiveData.title === "string" && proof.effectiveData.title ? proof.effectiveData.title : proof.snapshot.asin;
  // The full title remains in the immutable confirmedData; the subject's short
  // label uses an explicit version identity if it cannot represent that title.
  const title = fullTitle.length <= 255 ? fullTitle : `${proof.snapshot.asin} · 人工确认版本 ${proof.revision.version}`;
  const result = await context.tx.execute(statement("INSERT INTO image_competitor_research_subjects (workspaceId,projectId,userId,confirmedSnapshotId,marketplace,asin,displayName,role,status,currentAnalysisVersion,sortOrder) VALUES (?,?,?,?,?,?,?,?,'ready',0,?)",
    [workspaceId, projectId, proof.identity.userId, confirmed.id, proof.snapshot.marketplace, proof.snapshot.asin, title, role, previous.length]));
  if (!Array.isArray(result) || result[0]?.affectedRows !== 1 || result[0]?.warningStatus !== 0 || !id.safeParse(result[0]?.insertId).success) return fail();
  const [saved] = await rows(context.tx, `SELECT ${subjectProjection} FROM image_competitor_research_subjects WHERE workspaceId=? AND projectId=? AND confirmedSnapshotId=? FOR UPDATE`, [workspaceId, projectId, confirmed.id], 1);
  if (!saved || saved.id !== result[0].insertId || saved.userId !== proof.identity.userId || saved.displayName !== title || saved.role !== role || saved.status !== "ready"
    || saved.currentAnalysisVersion !== 0 || saved.marketplace !== proof.snapshot.marketplace || saved.asin !== proof.snapshot.asin) return fail();
  return { consumerType: "image_workflow" as const, projectId, subjectId: id.parse(saved.id), confirmedSnapshotId: proof.confirmedSnapshotId, created: true };
}

/** Persistent manual reads require an exact project target and reconstruct the
 * committed confirmation. Merely having isCurrent=0, a revision ID, a link, or
 * caller-supplied JSON is not authority. Global cache/options remain unchanged. */
type ManualReadTarget = { consumerType: "image_workflow"; projectId: number } | { consumerType: "kb_images"; projectId: null; userId: number };
export type ManualSnapshotPersistentProof = { confirmed: Record<string, unknown>; assets: ManualSnapshotAsset[]; sourceHash: string;
  identity: AcquisitionReviewIdentity; scope: AcquisitionReviewReadInput; job: Record<string, unknown>; snapshot: Record<string, unknown>;
  revision: Record<string, unknown>; envelope: ManualSnapshotRevision; contentHash: string; allAssets: ManualSnapshotAsset[]; publicationState: "active" | "superseded" };
type VerifyRead = (tx: ManualSnapshotReviewExecutor, proof: ManualSnapshotPersistentProof) => Promise<unknown>;
async function readManualSnapshotPublication(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number, target: ManualReadTarget, purpose: "active" | "history", verify?: VerifyRead): Promise<ManualSnapshotPersistentProof | null> {
  id.parse(workspaceId); id.parse(confirmedSnapshotId);
  if (target.projectId !== null) id.parse(target.projectId); else id.parse(target.userId);
  if (!db || typeof db.transaction !== "function") return fail();
  return db.transaction(async (tx: ManualSnapshotReviewExecutor) => {
    // Hints do not authorize data. Match writer workspace -> actor/member ->
    // consumer parent -> job -> source; never hold job while waiting on parent.
    const [hint] = await rows(tx, "SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,is_current AS isCurrent FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=?", [confirmedSnapshotId, workspaceId], 1);
    if (!hint || hint.isCurrent !== 0 || !id.safeParse(hint.revisionId).success || !id.safeParse(hint.snapshotId).success) return null;
    const [sourceHint] = await rows(tx, "SELECT id,job_id AS jobId FROM acquisition_source_snapshots WHERE id=? AND workspace_id=?", [hint.snapshotId, workspaceId], 1);
    if (!sourceHint || !id.safeParse(sourceHint.jobId).success) return fail();
    const [actorHint] = await rows(tx, "SELECT requested_by AS requestedBy FROM acquisition_jobs WHERE id=? AND workspace_id=?", [sourceHint.jobId, workspaceId], 1);
    if (!actorHint || !id.safeParse(actorHint.requestedBy).success) return fail();
    const [workspace] = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [workspaceId], 1);
    const [actor] = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [actorHint.requestedBy], 1);
    const memberships = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? FOR SHARE", [workspaceId, actorHint.requestedBy], 2);
    if (!workspace || workspace.id !== workspaceId || workspace.status !== "active" || !actor || actor.id !== actorHint.requestedBy || actor.status !== "active"
      || actor.defaultWorkspaceId !== workspaceId || typeof actor.role !== "string" || memberships.length !== 1 || memberships[0].workspaceId !== workspaceId
      || memberships[0].userId !== actor.id || memberships[0].status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "MANUAL_IMAGE_WORKFLOW_ACCESS_UNAVAILABLE" });
    const parent = target.projectId === null ? null : (await rows(tx, "SELECT id,userId,workspaceId FROM projects WHERE id=? FOR SHARE", [target.projectId], 1))[0];
    const [job] = await rows(tx, `SELECT id,workspace_id AS workspaceId,requested_by AS requestedBy,consumer_type AS consumerType,consumer_ref AS consumerRef,marketplace,asin,status,${jsonColumn("requested_capabilities", "requestedCapabilities")} FROM acquisition_jobs WHERE id=? AND workspace_id=? FOR SHARE`, [sourceHint.jobId, workspaceId], 1);
    const [source] = await rows(tx, `SELECT ${sourceProjection} FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? FOR SHARE`, [hint.snapshotId, workspaceId], 1);
    const [confirmed] = await rows(tx, `SELECT ${confirmedProjection} FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? FOR SHARE`, [confirmedSnapshotId, workspaceId], 1);
    const consumerRef = target.projectId === null ? `kb-images:US:${source?.asin}` : `project:${target.projectId}:competitor-gallery`;
    if (!job || !source || !confirmed || source.id !== hint.snapshotId || source.jobId !== job.id || job.requestedBy !== actor.id || source.workspaceId !== workspaceId || job.workspaceId !== workspaceId
      || (target.projectId === null ? job.requestedBy !== target.userId || source.marketplace !== "US"
        : !parent || parent.id !== target.projectId || parent.workspaceId !== workspaceId || parent.userId !== job.requestedBy)
      || confirmed.id !== confirmedSnapshotId || confirmed.workspaceId !== workspaceId
      || confirmed.snapshotId !== source.id || confirmed.revisionId !== hint.revisionId || confirmed.isCurrent !== 0 || confirmed.asin !== source.asin || confirmed.marketplace !== source.marketplace
      || job.asin !== source.asin || job.marketplace !== source.marketplace || job.consumerType !== target.consumerType || job.consumerRef !== consumerRef
      || ["queued", "running"].includes(String(job.status))) return fail();
    source.normalizedData = json(source.normalizedData); source.fieldStatuses = json(source.fieldStatuses);
    source.completeness = source.completeness === null ? null : json(source.completeness); job.requestedCapabilities = json(job.requestedCapabilities);
    if (!Array.isArray(job.requestedCapabilities) || !job.requestedCapabilities.includes("image_gallery")) return fail();
    const [revisionRow] = await rows(tx, `SELECT ${revisionProjection} FROM acquisition_snapshot_revisions WHERE id=? AND snapshot_id=? AND workspace_id=? FOR SHARE`, [confirmed.revisionId, source.id, workspaceId], 1);
    if (!revisionRow) return fail(); revisionRow.patch = json(revisionRow.patch);
    const envelope = ManualSnapshotRevisionSchema.parse(revisionRow.patch), scope = { expectedWorkspaceId: workspaceId, expectedProjectId: target.projectId, snapshotId: Number(source.id) };
    if (envelope.status !== "confirmed" || envelope.userId !== job.requestedBy || confirmed.confirmedBy !== envelope.userId || !same(envelope.scope, scope)
      || envelope.jobId !== job.id || envelope.consumerType !== job.consumerType || envelope.consumerRef !== job.consumerRef) return fail();
    const boundIds = [...envelope.originalAssetIds, ...envelope.supplements.map(supplement => supplement.assetId)];
    if (!boundIds.length || boundIds.length > 300 || new Set(boundIds).size !== boundIds.length) return fail();
    const allAssets = await rows(tx, `SELECT ${assetProjection} FROM acquisition_asset_candidates WHERE snapshot_id=? AND workspace_id=? AND id IN (${boundIds.map(() => "?").join(",")}) ORDER BY id LIMIT 301 FOR SHARE`, [source.id, workspaceId, ...boundIds], 300) as ManualSnapshotAsset[];
    if (allAssets.length !== boundIds.length) return fail();
    const replay = replayManualSnapshotRevision({ snapshot: source as unknown as Parameters<typeof replayManualSnapshotRevision>[0]["snapshot"], assets: allAssets, revision: revisionRow as unknown as ManualSnapshotRevisionRow });
    if (!replay.selectedAssets.length || replay.selectedAssets.some(asset => !["main", "secondary", "aplus", "brand_story"].includes(asset.role))) return fail();
    const data = json(confirmed.confirmedData), assetIds = json(confirmed.confirmedAssetIds);
    const contentHash = acquisitionReviewHash({ confirmedData: replay.effectiveData, approvedAssetIds: replay.selectedAssets.map(asset => asset.id), revisionHash: revisionRow.revisionHash });
    const sourceHash = acquisitionReviewHash({ effectiveData: replay.effectiveData, revision: replay.revision, selectedAssets: replay.selectedAssets });
    if (!same(data, replay.effectiveData) || !same(assetIds, replay.selectedAssets.map(asset => asset.id)) || confirmed.contentHash !== contentHash) return fail();
    const links = await rows(tx, `SELECT id,workspace_id AS workspaceId,confirmed_snapshot_id AS confirmedSnapshotId,consumer_type AS consumerType,consumer_ref AS consumerRef,capability_scope AS capabilityScope,projection_version AS projectionVersion,status,created_by AS createdBy FROM acquisition_consumer_links WHERE workspace_id=? AND confirmed_snapshot_id=? AND consumer_type=? AND consumer_ref=? AND capability_scope='image_gallery' AND ${purpose === "active" ? "status='active'" : "status IN ('active','superseded')"} FOR SHARE`, [workspaceId, confirmedSnapshotId, target.consumerType, job.consumerRef], 2);
    if (links.length !== 1 || links[0].workspaceId !== workspaceId || links[0].confirmedSnapshotId !== confirmedSnapshotId || links[0].consumerType !== target.consumerType
      || links[0].consumerRef !== job.consumerRef || links[0].capabilityScope !== "image_gallery" || (purpose === "active" ? links[0].status !== "active" : !["active", "superseded"].includes(String(links[0].status)))
      || links[0].projectionVersion !== sourceHash || links[0].createdBy !== envelope.userId) return fail();
    const identity = { userId: envelope.userId, workspaceId };
    const auditId = `acqr_final_${acquisitionReviewHash({ identity, operationId: envelope.operationId })}`;
    const [audit] = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadata FROM security_audit_logs WHERE auditId=? FOR SHARE", [auditId], 1);
    if (!audit || audit.auditId !== auditId || audit.workspaceId !== workspaceId || audit.actorUserId !== envelope.userId || audit.action !== "acquisition.review.final"
      || audit.resourceType !== "acquisition_review_operation" || audit.resourceId !== envelope.operationId || audit.status !== "success" || audit.riskLevel !== "medium") return fail();
    const final = z.object({ version: z.literal(1), kind: z.literal("final"), receipt: AcquisitionReviewWriteResultSchema,
      binding: z.object({ sourceStateHash: hash, consumerLinksHash: hash }).strict() }).strict().parse(json(audit.metadata));
    const receipt = final.receipt;
    if (receipt.action !== "confirm" || receipt.status !== "committed" || !same(receipt.identity, identity) || !same(receipt.scope, scope) || receipt.operationId !== envelope.operationId
      || receipt.confirmedSnapshotId !== confirmedSnapshotId || receipt.revisionId !== revisionRow.id || receipt.revisionVersion !== revisionRow.version) return fail();
    const [artifact] = await rows(tx, "SELECT id,workspace_id AS workspaceId,run_id AS runId,artifact_kind AS artifactKind,storage_key AS storageKey,content_hash AS contentHash,content_type AS contentType,size_bytes AS sizeBytes FROM acquisition_raw_artifacts WHERE id=? AND workspace_id=? FOR SHARE", [source.rawArtifactId, workspaceId], 1);
    if (!artifact || artifact.id !== source.rawArtifactId || artifact.workspaceId !== workspaceId || artifact.runId !== source.runId || !hash.safeParse(artifact.contentHash).success) return fail();
    const state = { identity, scope, job, snapshot: source, assets: allAssets, revision: revisionRow, artifact };
    if (final.binding.sourceStateHash !== acquisitionReviewHash(state) || receipt.committedRevisionHash !== acquisitionReviewHash(final.binding)) return fail();
    const [previousRow] = await rows(tx, `SELECT ${revisionProjection} FROM acquisition_snapshot_revisions WHERE snapshot_id=? AND workspace_id=? AND version=? FOR SHARE`, [source.id, workspaceId, Number(revisionRow.version) - 1], 1);
    if (!previousRow) return fail(); previousRow.patch = json(previousRow.patch);
    const previous = replayManualSnapshotRevision({ snapshot: source as unknown as Parameters<typeof replayManualSnapshotRevision>[0]["snapshot"], assets: allAssets, revision: previousRow as unknown as ManualSnapshotRevisionRow });
    if (previous.revision.status !== "pending_review" || previousRow.revisionHash !== envelope.previousRevisionHash) return fail();
    if (previous.revision.consumerLinksHash !== envelope.consumerLinksHash) return fail();
    const expectedRevisionHash = acquisitionReviewHash({ sourceStateHash: acquisitionReviewHash({ ...state, revision: previousRow }), consumerLinksHash: envelope.consumerLinksHash });
    if (receipt.requestHash !== acquisitionReviewRequestHash(identity, { ...scope, operationId: envelope.operationId, expectedRevisionHash, action: "confirm", note: envelope.note })) return fail();
    const statuses = json(confirmed.fieldStatuses);
    const expectedStatuses = structuredClone(source.fieldStatuses) as Record<string, unknown>;
    if (!expectedStatuses || typeof expectedStatuses !== "object" || Array.isArray(expectedStatuses)) return fail();
    for (const [key, value] of Object.entries(expectedStatuses)) if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).status === "pending_review") expectedStatuses[key] = { ...value, status: "confirmed", noteCode: "human_confirmed" };
    for (const key of Object.keys(envelope.patch)) expectedStatuses[key] = { status: "confirmed", sourcePath: `manual_revision:${revisionRow.id}:${key}`, valueHash: acquisitionReviewHash((replay.effectiveData as Record<string, unknown>)[key]), noteCode: "human_confirmed" };
    if (!same(statuses, expectedStatuses) || !id.safeParse(confirmed.confirmationVersion).success) return fail();
    const proof: ManualSnapshotPersistentProof = { confirmed: { ...confirmed, confirmedData: data, fieldStatuses: statuses, confirmedAssetIds: assetIds }, assets: replay.selectedAssets, sourceHash,
      identity, scope, job, snapshot: source, revision: revisionRow, envelope, contentHash, allAssets, publicationState: links[0].status as "active" | "superseded" };
    await verify?.(tx, proof);
    return proof;
  }).catch((error: unknown) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && error.message === "ACQUISITION_REVIEW_REVISION_INVALID") return fail();
    throw error; // Database/authorization failures are not fabricated empty history.
  });
}
export function readManualImageWorkflowSnapshot(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number, projectId: number) {
  return readManualSnapshotPublication(db, workspaceId, confirmedSnapshotId, { consumerType: "image_workflow", projectId }, "active");
}
/** History display only. Selection, confirmation and model jobs must use the
 * active wrapper above, never a browser-selectable purpose parameter. */
export function readManualImageWorkflowSnapshotHistory(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number, projectId: number) {
  return readManualSnapshotPublication(db, workspaceId, confirmedSnapshotId, { consumerType: "image_workflow", projectId }, "history");
}
/** Separate owner-only knowledge target. It cannot import a workspace's manual
 * confirmation into an arbitrary project or broaden global snapshot options. */
export function readManualKbImageSnapshot(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number, userId: number, verify?: VerifyRead) {
  return readManualSnapshotPublication(db, workspaceId, confirmedSnapshotId, { consumerType: "kb_images", projectId: null, userId }, "active", verify);
}
export function readManualKbImageSnapshotHistory(db: DbExecutor, workspaceId: number, confirmedSnapshotId: number, userId: number, verify?: VerifyRead) {
  return readManualSnapshotPublication(db, workspaceId, confirmedSnapshotId, { consumerType: "kb_images", projectId: null, userId }, "history", verify);
}
