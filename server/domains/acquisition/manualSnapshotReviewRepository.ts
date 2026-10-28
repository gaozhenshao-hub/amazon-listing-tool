import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as tables from "../../../drizzle/schema/acquisition";
import { getDb } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { assertOperationsBoardOperationJournalSchema } from "../ops/operationsBoardOperationJournal";
import { AcquisitionReviewIdentitySchema, AcquisitionReviewReadInputSchema, AcquisitionReviewOperationInputSchema,
  AcquisitionReviewWriteInputSchema, AcquisitionReviewWriteResultSchema, acquisitionReviewCanonical, acquisitionReviewHash,
  acquisitionReviewRequestHash, type AcquisitionReviewIdentity, type AcquisitionReviewReadInput, type AcquisitionReviewWriteInput,
  type AcquisitionReviewWriteResult } from "../../../shared/acquisitionReview";
import { ManualSnapshotPreparedImageSchema, type ManualSnapshotPreparedImage } from "./manualSnapshotImageStorage";
import { ManualSnapshotRevisionSchema, ManualSnapshotAssetSchema, applyManualSnapshotRevision, manualSnapshotObject, replayManualSnapshotRevision,
  type ManualSnapshotRevision, type ManualSnapshotAsset, type ManualSnapshotRevisionRow, type ManualSnapshotReviewExecutor,
  type ManualSnapshotJob, type ManualSnapshotLoadedSource, type ManualSnapshotPublishContext } from "./manualSnapshotRevision";
export type { ManualSnapshotReviewExecutor, ManualSnapshotJob, ManualSnapshotLoadedSource, ManualSnapshotPublishContext } from "./manualSnapshotRevision";
import { NormalizedAmazonSnapshotSchema } from "./contracts";
import { issueManualSnapshotPublication } from "./manualSnapshotPublication";

const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const MAX = 8 * 1024 * 1024;
type Row = Record<string, unknown>;
interface Database { transaction<T>(body: (tx: ManualSnapshotReviewExecutor) => Promise<T>): Promise<T> }
export class ManualSnapshotReviewError extends Error {
  constructor(readonly code: string) { super(`ACQUISITION_REVIEW_${code}`); this.name = "ManualSnapshotReviewError"; }
}
function fail(code: string): never { throw new ManualSnapshotReviewError(code); }
export function manualSnapshotReviewStatement(query: string, params: unknown[] = []): SQL {
  const parts = query.split("?"); if (parts.length !== params.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: ManualSnapshotReviewExecutor, query: string, params: unknown[], maximum: number): Promise<Row[]> {
  const result = await tx.execute(manualSnapshotReviewStatement(query, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum
    || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID");
  acquisitionReviewCanonical(result[0], MAX); return result[0];
}
async function write(tx: ManualSnapshotReviewExecutor, query: string, params: unknown[], inserted = false): Promise<number> {
  const result = await tx.execute(manualSnapshotReviewStatement(query, params));
  if (!Array.isArray(result) || result[0]?.affectedRows !== 1 || result[0].warningStatus !== 0
    || inserted && !id.safeParse(result[0].insertId).success) fail("WRITE_UNCONFIRMED");
  return inserted ? result[0].insertId : 1;
}
const sourceTables = [tables.acquisitionJobs, tables.acquisitionSourceSnapshots, tables.acquisitionAssetCandidates,
  tables.acquisitionRawArtifacts, tables.acquisitionSnapshotRevisions, tables.acquisitionConfirmedSnapshots, tables.acquisitionConsumerLinks] as AnyMySqlTable[];
const writeTables = new Set(["acquisition_asset_candidates", "acquisition_snapshot_revisions", "acquisition_confirmed_snapshots", "acquisition_consumer_links"]);
const uniqueKeys: Record<string, string[][]> = {
  acquisition_asset_candidates: [["id"], ["snapshot_id", "role", "position_index"]],
  acquisition_snapshot_revisions: [["id"], ["snapshot_id", "version"]],
  acquisition_confirmed_snapshots: [["id"], ["snapshot_id", "confirmation_version"]],
  acquisition_consumer_links: [["id"], ["workspace_id", "consumer_type", "consumer_ref", "capability_scope", "confirmed_snapshot_id"]],
};
/** Existing-table admission only. No migration, fallback DDL, adoption, or
 * automatic schema repair. Audit UUID uniqueness is independently checked. */
export async function assertManualSnapshotReviewSchema(tx: ManualSnapshotReviewExecutor): Promise<void> {
  const names = [...sourceTables.map(table => getTableConfig(table).name), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")}) LIMIT 32`, names, 31);
  if (engines.length !== names.length || new Set(engines.map(row => row.tableName)).size !== names.length
    || engines.some(row => !names.includes(String(row.tableName)) || row.engine !== "InnoDB")) fail("SCHEMA_UNAVAILABLE");
  for (const table of sourceTables) {
    const config = getTableConfig(table), columns = await rows(tx, "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 129", [config.name], 128);
    if (new Set(columns.map(row => row.name)).size !== columns.length) fail("SCHEMA_UNAVAILABLE");
    for (const expected of config.columns) {
      const actual = columns.find(row => row.name === expected.name);
      const normalize = (value: string) => value.replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",").toLowerCase();
      if (!actual || typeof actual.columnType !== "string" || typeof actual.extra !== "string" || !["YES", "NO"].includes(String(actual.nullable))
        || normalize(actual.columnType) !== normalize(expected.getSQLType()) || actual.nullable !== (expected.notNull ? "NO" : "YES")
        || /(?:virtual|stored)\s+generated/iu.test(actual.extra) || actual.defaultValue !== null && typeof actual.defaultValue !== "string" && !(typeof actual.defaultValue === "number" && Number.isFinite(actual.defaultValue))
        || actual.collation !== null && !["utf8mb4_unicode_ci", "utf8mb4_general_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"].includes(String(actual.collation))) fail("SCHEMA_UNAVAILABLE");
      if (writeTables.has(config.name) && expected.name === "id" && actual.extra !== "auto_increment") fail("SCHEMA_UNAVAILABLE");
      if (writeTables.has(config.name) && ["created_at", "updated_at"].includes(expected.name)
        && !/^current_timestamp(?:\(\d*\))?$/iu.test(String(actual.defaultValue))) fail("SCHEMA_UNAVAILABLE");
    }
    if (!writeTables.has(config.name)) continue;
    if (columns.some(row => !config.columns.some(column => column.name === row.name) && row.nullable !== "YES" && row.defaultValue === null)) fail("SCHEMA_UNAVAILABLE");
    const indexes = await rows(tx, "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [config.name], 256);
    const groups = new Map<string, Row[]>();
    for (const row of indexes) {
      if (typeof row.name !== "string" || ![0, 1].includes(Number(row.nonUnique)) || !id.safeParse(Number(row.sequence)).success || row.subPart !== null || typeof row.columnName !== "string") fail("SCHEMA_UNAVAILABLE");
      groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
    }
    const unique = [...groups.values()].filter(group => Number(group[0].nonUnique) === 0).map(group => {
      if (group.some((row, i) => Number(row.sequence) !== i + 1 || Number(row.nonUnique) !== 0)) fail("SCHEMA_UNAVAILABLE");
      return group.map(row => row.columnName);
    });
    const expected = uniqueKeys[config.name];
    if (unique.length !== expected.length || expected.some(key => !unique.some(value => acquisitionReviewHash(key) === acquisitionReviewHash(value)))) fail("SCHEMA_UNAVAILABLE");
  }
  try { await assertOperationsBoardOperationJournalSchema(tx); } catch { fail("JOURNAL_SCHEMA_UNAVAILABLE"); }
}

type Publish = (context: ManualSnapshotPublishContext) => Promise<unknown>;
const defaults = { getDb: getDb as () => Promise<Database | null | undefined>, permission: assertResourceAction,
  enabled: () => process.env.ENABLE_ACQUISITION_REVIEW_WRITES === "true", admit: assertManualSnapshotReviewSchema,
  now: () => new Date(), publish: undefined as Publish | undefined };
type Dependencies = Partial<typeof defaults>;
const canonical = acquisitionReviewCanonical;
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
const date = (column: string, alias: string) => `DATE_FORMAT(${column},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const jsonColumn = (column: string, alias: string) => `IF(OCTET_LENGTH(CAST(${column} AS CHAR CHARACTER SET utf8mb4))<=${MAX},CAST(${column} AS CHAR CHARACTER SET utf8mb4),NULL) AS ${alias}`;
const assetProjection = `id,workspace_id AS workspaceId,snapshot_id AS snapshotId,source_artifact_id AS sourceArtifactId,role,position_index AS positionIndex,source_json_path AS sourceJsonPath,source_url_hash AS sourceUrlHash,provider_asset_id AS providerAssetId,storage_key AS storageKey,content_hash AS contentHash,content_type AS contentType,size_bytes AS sizeBytes,width,height,module_type AS moduleType,module_class AS moduleClass,field_status AS fieldStatus,review_status AS reviewStatus,reviewed_by AS reviewedBy,${date("reviewed_at", "reviewedAt")},${date("created_at", "createdAt")},${date("updated_at", "updatedAt")}`;
const revisionProjection = `id,workspace_id AS workspaceId,snapshot_id AS snapshotId,version,base_content_hash AS baseContentHash,${jsonColumn("patch", "patch")},revision_hash AS revisionHash,reason_code AS reasonCode,note,created_by AS createdBy,${date("created_at", "createdAt")}`;
function decode(value: unknown): unknown { if (typeof value !== "string") fail("JSON_UNAVAILABLE"); try { const result: unknown = JSON.parse(value); canonical(result); return result; } catch { return fail("JSON_INVALID"); } }
function checkedRecord(value: Row | undefined, code: string): Row { if (!value) fail(code); return value; }
export function createManualSnapshotReviewRepository(dependencies: Dependencies = {}) {
  const deps = { ...defaults, ...dependencies };
  async function transaction<T>(rawIdentity: AcquisitionReviewIdentity, rawScope: AcquisitionReviewReadInput, mode: "read" | "write" | "recover", body: (session: ManualSnapshotReviewSession) => Promise<T>): Promise<T> {
    const identity = AcquisitionReviewIdentitySchema.parse(rawIdentity), scope = AcquisitionReviewReadInputSchema.parse(rawScope);
    if (identity.workspaceId !== scope.expectedWorkspaceId) fail("SCOPE_CHANGED");
    const db = await deps.getDb(); if (!db || typeof db.transaction !== "function") fail("DATABASE_UNAVAILABLE");
    let completed = false;
    try {
      return await db.transaction(async tx => {
        await deps.admit(tx);
        const lock = mode === "read" ? "FOR SHARE" : "FOR UPDATE";
        const workspace = checkedRecord((await rows(tx, `SELECT id,status FROM workspaces WHERE id=? ${lock}`, [identity.workspaceId], 1))[0], "ACCESS_DENIED");
        const actorRow = checkedRecord((await rows(tx, `SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? ${lock}`, [identity.userId], 1))[0], "ACCESS_DENIED");
        const memberships = await rows(tx, `SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ${lock}`, [identity.workspaceId, identity.userId], 2);
        if (workspace.id !== identity.workspaceId || workspace.status !== "active" || actorRow.id !== identity.userId || actorRow.status !== "active"
          || actorRow.defaultWorkspaceId !== identity.workspaceId || typeof actorRow.role !== "string" || memberships.length !== 1
          || memberships[0].workspaceId !== identity.workspaceId || memberships[0].userId !== identity.userId || memberships[0].status !== "active") fail("ACCESS_DENIED");
        const actor = { id: identity.userId, role: actorRow.role, defaultWorkspaceId: identity.workspaceId };
        // All writers use workspace→actor→consumer parent→job→snapshot. The
        // initial snapshot job ID is a hint only, never an authority decision.
        if (scope.expectedProjectId !== null) {
          const parent = checkedRecord((await rows(tx, `SELECT id,userId,workspaceId FROM projects WHERE id=? ${lock}`, [scope.expectedProjectId], 1))[0], "PROJECT_UNAVAILABLE");
          if (parent.id !== scope.expectedProjectId || parent.userId !== identity.userId || parent.workspaceId !== identity.workspaceId) fail("ACCESS_DENIED");
        }
        const hint = checkedRecord((await rows(tx, "SELECT job_id AS jobId FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? LIMIT 1", [scope.snapshotId, identity.workspaceId], 1))[0], "SNAPSHOT_UNAVAILABLE");
        const jobId = id.parse(hint.jobId);
        const lockedJob = checkedRecord((await rows(tx, `SELECT id,cache_expired_at AS cacheExpiredAt FROM acquisition_jobs WHERE id=? AND workspace_id=? ${lock}`, [jobId, identity.workspaceId], 1))[0], "JOB_UNAVAILABLE");
        if (lockedJob.id !== jobId) fail("JOB_UNAVAILABLE");
        if (lockedJob.cacheExpiredAt) fail("SNAPSHOT_UNAVAILABLE");
        const load = async () => {
          const snapshot = checkedRecord((await rows(tx, `SELECT id,workspace_id AS workspaceId,job_id AS jobId,run_id AS runId,raw_artifact_id AS rawArtifactId,marketplace,asin,source_hash AS sourceHash,${jsonColumn("normalized_data", "normalizedData")},${jsonColumn("field_statuses", "fieldStatuses")},${jsonColumn("completeness", "completeness")},status,reviewed_by AS reviewedBy,${date("reviewed_at", "reviewedAt")},review_note AS reviewNote,${date("created_at", "createdAt")},${date("updated_at", "updatedAt")} FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? ${lock}`, [scope.snapshotId, identity.workspaceId], 1))[0], "SNAPSHOT_UNAVAILABLE") as ManualSnapshotLoadedSource;
          snapshot.normalizedData = decode(snapshot.normalizedData); snapshot.fieldStatuses = decode(snapshot.fieldStatuses); snapshot.completeness = snapshot.completeness === null ? null : decode(snapshot.completeness);
          const normalized = NormalizedAmazonSnapshotSchema.parse(snapshot.normalizedData);
          if (normalized.asin !== snapshot.asin || normalized.marketplace !== snapshot.marketplace) fail("SOURCE_INVALID");
          if (snapshot.id !== scope.snapshotId || snapshot.workspaceId !== identity.workspaceId || snapshot.jobId !== jobId || !id.safeParse(snapshot.runId).success || !id.safeParse(snapshot.rawArtifactId).success || !hash.safeParse(snapshot.sourceHash).success) fail("SOURCE_INVALID");
          const job = checkedRecord((await rows(tx, `SELECT id,workspace_id AS workspaceId,requested_by AS requestedBy,consumer_type AS consumerType,consumer_ref AS consumerRef,marketplace,asin,status,${jsonColumn("requested_capabilities", "requestedCapabilities")} FROM acquisition_jobs WHERE id=? AND workspace_id=? ${lock}`, [snapshot.jobId, identity.workspaceId], 1))[0], "JOB_UNAVAILABLE") as ManualSnapshotJob;
          job.requestedCapabilities = decode(job.requestedCapabilities);
          if (job.id !== snapshot.jobId || job.workspaceId !== identity.workspaceId || job.requestedBy !== identity.userId || job.asin !== snapshot.asin || job.marketplace !== snapshot.marketplace) fail("ACCESS_DENIED");
          if (!["queued", "running", "review_required", "confirmed", "failed", "canceled"].includes(job.status)
            || !["draft", "pending_review", "confirmed", "rejected", "superseded"].includes(snapshot.status)) fail("SOURCE_INVALID");
          let projectId: number | null = null, recordId: number | null = null;
          if (job.consumerType === "project_competitor") {
            const match = /^project-competitor:([1-9]\d*):([A-Z0-9]{10})(?::capture-v1)?$/u.exec(job.consumerRef);
            if (!match || match[2] !== job.asin) fail("CONSUMER_INVALID"); projectId = id.parse(Number(match[1]));
          } else if (job.consumerType === "image_workflow") {
            const match = /^project:([1-9]\d*):competitor-gallery$/u.exec(job.consumerRef); if (!match) fail("CONSUMER_INVALID"); projectId = id.parse(Number(match[1]));
          } else if (job.consumerType === "kb_listing" || job.consumerType === "kb_product") {
            const match = (job.consumerType === "kb_listing" ? /^kb-listing:([1-9]\d*)$/u : /^kb-product:([1-9]\d*)$/u).exec(job.consumerRef);
            if (!match) fail("CONSUMER_INVALID"); recordId = id.parse(Number(match[1]));
          } else if (job.consumerType === "conversion_collector") {
            if (job.consumerRef !== `conversion-collector:${job.marketplace}:${job.asin}`) fail("CONSUMER_INVALID");
          } else if (job.consumerType === "kb_images") {
            if (job.marketplace !== "US" || job.consumerRef !== `kb-images:US:${job.asin}`) fail("CONSUMER_INVALID");
          } else if (job.consumerType === "competitor_monitor") {
            if (job.consumerRef !== `manual:${job.asin}`) fail("CONSUMER_INVALID");
          } else fail("CONSUMER_UNSUPPORTED");
          if (scope.expectedProjectId !== projectId) fail("SCOPE_CHANGED");
          if (projectId !== null) {
            const parent = checkedRecord((await rows(tx, `SELECT id,userId,workspaceId FROM projects WHERE id=? ${lock}`, [projectId], 1))[0], "PROJECT_UNAVAILABLE");
            if (parent.id !== projectId || parent.userId !== identity.userId || parent.workspaceId !== identity.workspaceId) fail("ACCESS_DENIED");
          }
          if (recordId !== null) {
            const table = job.consumerType === "kb_listing" ? "kb_listing_copywriting" : "kb_product_innovations";
            const record = checkedRecord((await rows(tx, `SELECT id,userId,workspaceId,asin FROM ${table} WHERE id=? AND workspaceId=? ${lock}`, [recordId, identity.workspaceId], 1))[0], "TARGET_UNAVAILABLE");
            if (record.id !== recordId || record.userId !== identity.userId || record.workspaceId !== identity.workspaceId || record.asin !== job.asin) fail("ACCESS_DENIED");
          }
          await deps.permission({ actor, resource: projectId === null ? "knowledge" : "project", action: mode === "read" ? "read" : "update",
            workspaceId: identity.workspaceId, projectId, resourceId: projectId ?? recordId ?? job.consumerRef, ownerUserId: identity.userId,
            authorizationRead: { executor: tx, strict: true, lock: true, lockMode: mode === "read" ? "share" : "update" } });
          const assets = await rows(tx, `SELECT ${assetProjection} FROM acquisition_asset_candidates WHERE snapshot_id=? AND workspace_id=? ORDER BY id LIMIT 301 ${lock}`, [snapshot.id, identity.workspaceId], 300) as ManualSnapshotAsset[];
          for (const asset of assets) {
            ManualSnapshotAssetSchema.parse(asset);
            if (!id.safeParse(asset.id).success || asset.workspaceId !== identity.workspaceId || asset.snapshotId !== snapshot.id || asset.sourceArtifactId !== snapshot.rawArtifactId
              || typeof asset.fieldStatus !== "string" || typeof asset.role !== "string" || !Number.isSafeInteger(asset.positionIndex) || asset.positionIndex < 0) fail("ASSET_INVALID");
          }
          const revisionRows = await rows(tx, `SELECT ${revisionProjection} FROM acquisition_snapshot_revisions WHERE snapshot_id=? AND workspace_id=? ORDER BY version DESC LIMIT 1 ${lock}`, [snapshot.id, identity.workspaceId], 1);
          const revision = revisionRows[0] as ManualSnapshotRevisionRow | undefined;
          if (revision) revision.patch = decode(revision.patch);
          const replay = revision ? replayManualSnapshotRevision({ snapshot, assets, revision }) : null;
          if (replay && (replay.revision.userId !== identity.userId || !same(replay.revision.scope, scope) || replay.revision.consumerType !== job.consumerType || replay.revision.consumerRef !== job.consumerRef)) fail("REVISION_INVALID");
          const artifact = checkedRecord((await rows(tx, `SELECT id,workspace_id AS workspaceId,run_id AS runId,artifact_kind AS artifactKind,storage_key AS storageKey,content_hash AS contentHash,content_type AS contentType,size_bytes AS sizeBytes FROM acquisition_raw_artifacts WHERE id=? AND workspace_id=? ${lock}`, [snapshot.rawArtifactId, identity.workspaceId], 1))[0], "ARTIFACT_UNAVAILABLE");
          if (artifact.id !== snapshot.rawArtifactId || artifact.workspaceId !== identity.workspaceId || artifact.runId !== snapshot.runId || !hash.safeParse(artifact.contentHash).success) fail("ARTIFACT_INVALID");
          const links = await rows(tx, `SELECT id,workspace_id AS workspaceId,confirmed_snapshot_id AS confirmedSnapshotId,consumer_type AS consumerType,consumer_ref AS consumerRef,capability_scope AS capabilityScope,projection_version AS projectionVersion,status,created_by AS createdBy,${date("created_at", "createdAt")},${date("updated_at", "updatedAt")} FROM acquisition_consumer_links WHERE workspace_id=? AND BINARY consumer_type=BINARY ? AND BINARY consumer_ref=BINARY ? AND status='active' ORDER BY id LIMIT 301 ${lock}`, [identity.workspaceId, job.consumerType, job.consumerRef], 300);
          if (links.some(link => link.workspaceId !== identity.workspaceId || link.consumerType !== job.consumerType || link.consumerRef !== job.consumerRef || link.status !== "active")
            || new Set(links.map(link => link.capabilityScope)).size !== links.length) fail("CONSUMER_LINK_INVALID");
          const sourceStateHash = acquisitionReviewHash({ identity, scope, job, snapshot, assets, revision: revision ?? null, artifact });
          const consumerLinksHash = acquisitionReviewHash(links), stateHash = acquisitionReviewHash({ sourceStateHash, consumerLinksHash });
          return { snapshot, job, assets, revision: revision ?? null, replay, artifact, stateHash, sourceStateHash, consumerLinksHash };
        };
        let state = await load();
        const writable = (requireFlag = true) => { if (mode === "read") fail("READ_ONLY"); if (requireFlag && !deps.enabled()) fail("WRITES_DISABLED");
          if (["queued", "running"].includes(state.job.status)) fail("JOB_IN_PROGRESS"); };
        const checkCAS = (expected: string) => { if (state.stateHash !== expected) fail("REVISION_CONFLICT"); };
        async function assertNoOtherPrepared(operationId: string) {
          const pending = await rows(tx, "SELECT p.resourceId AS operationId FROM security_audit_logs p WHERE p.workspaceId=? AND p.resourceType='acquisition_review_operation' AND p.action='acquisition.review.prepare' AND JSON_UNQUOTE(JSON_EXTRACT(p.metadata,'$.prepared.scope.snapshotId'))=? AND p.resourceId<>? AND NOT EXISTS (SELECT 1 FROM security_audit_logs f WHERE f.workspaceId=p.workspaceId AND f.actorUserId=p.actorUserId AND f.resourceType=p.resourceType AND f.resourceId=p.resourceId AND f.action='acquisition.review.final') LIMIT 2 FOR UPDATE", [identity.workspaceId, String(scope.snapshotId), operationId], 2);
          if (pending.length) fail("IMAGE_OPERATION_PENDING");
        }
        const unknown = (operationId: string, status: "unknown" | "cancelled" = "unknown"): AcquisitionReviewWriteResult => ({ identity, scope, operationId,
          action: null, status, requestHash: null, revisionId: null, revisionVersion: null, committedRevisionHash: null, confirmedSnapshotId: null,
          reasonCode: status === "cancelled" ? "OPERATION_CANCELLED" : "OUTCOME_UNKNOWN" });
        function journal(operationId: string) {
          AcquisitionReviewOperationInputSchema.parse({ ...scope, operationId });
          const key = acquisitionReviewHash({ identity, operationId }), keys = { final: `acqr_final_${key}`, prepared: `acqr_prepare_${key}` };
          async function read() {
            const found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadata FROM security_audit_logs WHERE auditId IN (?,?) ORDER BY auditId LIMIT 3 FOR UPDATE", [keys.final, keys.prepared], 2);
            let final: AcquisitionReviewWriteResult | null = null, prepared: ManualSnapshotPreparedImage | null = null;
            for (const row of found) {
              if (row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.resourceType !== "acquisition_review_operation" || row.resourceId !== operationId || row.status !== "success" || row.riskLevel !== "medium" || typeof row.metadata !== "string" || Buffer.byteLength(row.metadata) > 32768) fail("JOURNAL_INVALID");
              const value = manualSnapshotObject(decode(row.metadata));
              if (row.auditId === keys.final && row.action === "acquisition.review.final" && !final) {
                const record = z.object({ version: z.literal(1), kind: z.literal("final"), receipt: AcquisitionReviewWriteResultSchema,
                  binding: z.object({ sourceStateHash: hash, consumerLinksHash: hash }).strict().nullable() }).strict().parse(value);
                final = record.receipt;
                if (final.status === "committed" ? !record.binding || final.committedRevisionHash !== acquisitionReviewHash(record.binding) : record.binding !== null) fail("JOURNAL_INVALID");
                if (final.status === "unknown" || !same(final.identity, identity) || !same(final.scope, scope) || final.operationId !== operationId) fail("JOURNAL_SCOPE_CONFLICT");
              } else if (row.auditId === keys.prepared && row.action === "acquisition.review.prepare" && !prepared) {
                prepared = z.object({ version: z.literal(1), kind: z.literal("image_prepared"), prepared: ManualSnapshotPreparedImageSchema }).strict().parse(value).prepared;
                if (!same(prepared.identity, identity) || !same(prepared.scope, scope) || prepared.operationId !== operationId) fail("JOURNAL_SCOPE_CONFLICT");
              } else fail("JOURNAL_INVALID");
            }
            if (prepared && final?.status === "committed" && (final.action !== "image" || final.requestHash !== prepared.requestHash)) fail("JOURNAL_INVALID");
            return { final, prepared };
          }
          async function insert(auditId: string, action: string, value: unknown) {
            if (mode === "read") fail("READ_ONLY");
            await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'acquisition_review_operation',?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, actor.role, action, operationId, canonical(value, 32768)]);
          }
          async function finalize(receipt: AcquisitionReviewWriteResult) {
            const parsed = AcquisitionReviewWriteResultSchema.parse(receipt);
            if (parsed.status === "unknown" || !same(parsed.identity, identity) || !same(parsed.scope, scope) || parsed.operationId !== operationId) fail("JOURNAL_INVALID");
            const previous = await read();
            if (previous.final) { if (previous.final.status === "cancelled" && parsed.status !== "cancelled") fail("OPERATION_CANCELLED"); if (!same(previous.final, parsed)) fail("OPERATION_CONTENT_CONFLICT"); return previous.final; }
            if (parsed.status === "committed" && parsed.action === "image" && previous.prepared?.requestHash !== parsed.requestHash) fail("IMAGE_NOT_PREPARED");
            const binding = parsed.status === "committed" ? { sourceStateHash: state.sourceStateHash, consumerLinksHash: state.consumerLinksHash } : null;
            if (binding && parsed.committedRevisionHash !== acquisitionReviewHash(binding)) fail("JOURNAL_INVALID");
            await insert(keys.final, "acquisition.review.final", { version: 1, kind: "final", receipt: parsed, binding });
            const saved = await read(); if (!same(saved.final, parsed)) fail("READBACK_FAILED"); return parsed;
          }
          async function prepare(input: ManualSnapshotPreparedImage) {
            writable(); const prepared = ManualSnapshotPreparedImageSchema.parse(input), previous = await read();
            if (previous.final) fail(previous.final.status === "cancelled" ? "OPERATION_CANCELLED" : "OPERATION_FINAL");
            if (!same(prepared.identity, identity) || !same(prepared.scope, scope) || prepared.operationId !== operationId) fail("JOURNAL_SCOPE_CONFLICT");
            if (previous.prepared) { if (!same(previous.prepared, prepared)) fail("OPERATION_CONTENT_CONFLICT"); return { created: false, prepared: previous.prepared }; }
            checkCAS(prepared.expectedRevisionHash); validatePrepared(prepared); await assertNoOtherPrepared(operationId);
            await insert(keys.prepared, "acquisition.review.prepare", { version: 1, kind: "image_prepared", prepared });
            if (!same((await read()).prepared, prepared)) fail("READBACK_FAILED"); return { created: true, prepared };
          }
          async function cancel() { if (mode === "read") fail("READ_ONLY"); const previous = await read(); return previous.final ?? finalize(unknown(operationId, "cancelled")); }
          return { read, prepare, finalize, cancel };
        }
        function validatePrepared(prepared: ManualSnapshotPreparedImage) {
          if (prepared.sourceArtifactId !== state.snapshot.rawArtifactId || state.assets.length >= 300) fail("IMAGE_SOURCE_INVALID");
          const target = prepared.sourceAssetId === null ? null : state.assets.find(asset => asset.id === prepared.sourceAssetId);
          if (prepared.sourceAssetId !== null && !target) fail("IMAGE_SOURCE_INVALID");
          if (prepared.mode === "retry_original" && (!target || target.storageKey !== null || prepared.role !== target.role || prepared.sourceJsonPath !== target.sourceJsonPath || prepared.sourceUrlHash !== target.sourceUrlHash)) fail("IMAGE_SOURCE_INVALID");
        }
        function baseline(operationId: string, status: ManualSnapshotRevision["status"], note: string | null): ManualSnapshotRevision {
          const original = manualSnapshotObject(state.snapshot.normalizedData), old = state.replay?.revision;
          return ManualSnapshotRevisionSchema.parse({ version: 1, kind: "manual_acquisition_review_v1", scope, userId: identity.userId, jobId: state.job.id,
            consumerType: state.job.consumerType, consumerRef: state.job.consumerRef, baseSourceHash: state.snapshot.sourceHash,
            originalHash: old?.originalHash ?? acquisitionReviewHash(original), originalAssetIds: old?.originalAssetIds ?? state.assets.map(asset => asset.id),
            originalAssetsHash: old?.originalAssetsHash ?? acquisitionReviewHash(state.assets), previousRevisionHash: state.revision?.revisionHash ?? null,
            consumerLinksHash: old?.status === "pending_review" ? old.consumerLinksHash : state.consumerLinksHash,
            revisionVersion: (state.revision?.version ?? 0) + 1, operationId, createdAt: deps.now().toISOString(), status,
            patch: old?.patch ?? {}, assetDecisions: old?.assetDecisions ?? state.assets.map(asset => ({ assetId: asset.id, decision: asset.storageKey && asset.fieldStatus === "pending_review" ? "keep" : "pending" })),
            supplements: old?.supplements ?? [], note });
        }
        async function append(envelope: ManualSnapshotRevision) {
          applyManualSnapshotRevision(state.snapshot, state.assets, envelope);
          const patch = canonical(envelope), revisionHash = acquisitionReviewHash(envelope);
          const revisionId = await write(tx, "INSERT INTO acquisition_snapshot_revisions (workspace_id,snapshot_id,version,base_content_hash,patch,revision_hash,reason_code,note,created_by) VALUES (?,?,?,?,?,?,'manual_review_v1',?,?)", [identity.workspaceId, scope.snapshotId, envelope.revisionVersion, state.snapshot.sourceHash, patch, revisionHash, envelope.note, identity.userId], true);
          const saved = await load();
          if (!saved.revision || saved.revision.id !== revisionId || !same(saved.revision.patch, envelope) || !same(saved.snapshot, state.snapshot) || !same(saved.assets, state.assets)) fail("READBACK_FAILED");
          state = saved; return saved.revision;
        }
        function receipt(operationId: string, requestHash: string, action: AcquisitionReviewWriteResult["action"], confirmedSnapshotId: number | null = null): AcquisitionReviewWriteResult {
          if (!state.revision) fail("REVISION_INVALID");
          return AcquisitionReviewWriteResultSchema.parse({ identity, scope, operationId, action, status: "committed", requestHash,
            revisionId: state.revision.id, revisionVersion: state.revision.version, committedRevisionHash: state.stateHash, confirmedSnapshotId, reasonCode: null });
        }
        async function execute(input: AcquisitionReviewWriteInput) {
          const command = AcquisitionReviewWriteInputSchema.parse(input); if (!same(scope, { expectedWorkspaceId: command.expectedWorkspaceId, expectedProjectId: command.expectedProjectId, snapshotId: command.snapshotId })) fail("SCOPE_CHANGED");
          const log = journal(command.operationId), requestHash = acquisitionReviewRequestHash(identity, command), prior = await log.read();
          if (prior.final) { if (prior.final.status === "committed" && prior.final.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return prior.final; }
          if (prior.prepared) fail("OPERATION_CONTENT_CONFLICT");
          writable(); checkCAS(command.expectedRevisionHash); await assertNoOtherPrepared(command.operationId);
          if (command.action !== "save" && state.replay?.revision.status !== "pending_review") fail("DRAFT_REQUIRED");
          const envelope = baseline(command.operationId, command.action === "save" ? "pending_review" : command.action === "confirm" ? "confirmed" : "rejected", command.note);
          if (command.action === "save") { envelope.patch = { ...envelope.patch, ...command.patch }; envelope.assetDecisions = command.assetDecisions; }
          const replay = applyManualSnapshotRevision(state.snapshot, state.assets, envelope);
          if (command.action === "confirm" && envelope.consumerLinksHash !== state.consumerLinksHash) fail("CONSUMER_CHANGED");
          if (command.action === "confirm" && (envelope.assetDecisions.some(decision => decision.decision === "pending") || !replay.selectedAssets.some(asset => asset.role === "main" || asset.role === "secondary"))) fail("ASSET_DECISIONS_INCOMPLETE");
          if (command.action === "confirm" && !deps.publish) fail("PUBLISH_UNAVAILABLE");
          const revision = await append(envelope);
          let confirmedSnapshotId: number | null = null;
          if (command.action === "confirm") {
            const previous = await rows(tx, "SELECT confirmation_version AS version FROM acquisition_confirmed_snapshots WHERE snapshot_id=? AND workspace_id=? ORDER BY confirmation_version DESC LIMIT 1 FOR UPDATE", [scope.snapshotId, identity.workspaceId], 1);
            const version = id.parse(Number(previous[0]?.version ?? 0) + 1), assetIds = replay.selectedAssets.map(asset => asset.id);
            const contentHash = acquisitionReviewHash({ confirmedData: replay.effectiveData, approvedAssetIds: assetIds, revisionHash: revision.revisionHash });
            const statuses = { ...manualSnapshotObject(state.snapshot.fieldStatuses) };
            for (const [key, value] of Object.entries(statuses)) if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).status === "pending_review") statuses[key] = { ...value, status: "confirmed", noteCode: "human_confirmed" };
            for (const key of Object.keys(envelope.patch)) statuses[key] = { status: "confirmed", sourcePath: `manual_revision:${revision.id}:${key}`, valueHash: acquisitionReviewHash((replay.effectiveData as Record<string, unknown>)[key]), noteCode: "human_confirmed" };
            confirmedSnapshotId = await write(tx, "INSERT INTO acquisition_confirmed_snapshots (workspace_id,snapshot_id,revision_id,marketplace,asin,confirmation_version,content_hash,confirmed_data,field_statuses,confirmed_asset_ids,is_current,confirmed_by) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)", [identity.workspaceId, scope.snapshotId, revision.id, state.snapshot.marketplace, state.snapshot.asin, version, contentHash, canonical(replay.effectiveData), canonical(statuses), canonical(assetIds), identity.userId], true);
            const readback = await rows(tx, `SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,marketplace,asin,confirmation_version AS version,confirmed_by AS confirmedBy,content_hash AS contentHash,is_current AS isCurrent,${jsonColumn("confirmed_data", "confirmedData")},${jsonColumn("field_statuses", "fieldStatuses")},${jsonColumn("confirmed_asset_ids", "assetIds")} FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? FOR UPDATE`, [confirmedSnapshotId, identity.workspaceId], 1);
            const saved = readback[0]; if (!saved || saved.id !== confirmedSnapshotId || saved.workspaceId !== identity.workspaceId || saved.snapshotId !== scope.snapshotId || saved.revisionId !== revision.id || saved.contentHash !== contentHash || saved.isCurrent !== 0
              || saved.marketplace !== state.snapshot.marketplace || saved.asin !== state.snapshot.asin || saved.version !== version || saved.confirmedBy !== identity.userId
              || !same(decode(saved.fieldStatuses), statuses) || !same(decode(saved.confirmedData), replay.effectiveData) || !same(decode(saved.assetIds), assetIds)) fail("READBACK_FAILED");
            const publication = { tx, identity, actor, job: state.job, snapshot: state.snapshot, revision, envelope,
              effectiveData: replay.effectiveData, assets: replay.selectedAssets, allAssets: state.assets, confirmedSnapshotId };
            const revoke = issueManualSnapshotPublication(publication);
            try { await deps.publish!(publication); } finally { revoke(); }
            const after = await load(); if (after.sourceStateHash !== state.sourceStateHash) fail("SOURCE_CHANGED_DURING_PUBLISH"); state = after;
          }
          return log.finalize(receipt(command.operationId, requestHash, command.action, confirmedSnapshotId));
        }
        async function completeImage(input: ManualSnapshotPreparedImage) {
          writable(false); const prepared = ManualSnapshotPreparedImageSchema.parse(input), log = journal(prepared.operationId), previous = await log.read();
          if (previous.final) { if (previous.final.status === "committed" && previous.final.requestHash !== prepared.requestHash) fail("OPERATION_CONTENT_CONFLICT"); return previous.final; }
          if (!previous.prepared || !same(previous.prepared, prepared)) fail("IMAGE_NOT_PREPARED");
          checkCAS(prepared.expectedRevisionHash); validatePrepared(prepared);
          const envelope = baseline(prepared.operationId, "pending_review", state.replay?.revision.note ?? null);
          const position = Math.max(-1, ...state.assets.filter(asset => asset.role === prepared.role).map(asset => asset.positionIndex)) + 1;
          const assetId = await write(tx, "INSERT INTO acquisition_asset_candidates (workspace_id,snapshot_id,source_artifact_id,role,position_index,source_json_path,source_url_hash,storage_key,content_hash,content_type,size_bytes,width,height,field_status,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_review','pending')", [identity.workspaceId, scope.snapshotId, state.snapshot.rawArtifactId, prepared.role, position, prepared.sourceJsonPath, prepared.sourceUrlHash, prepared.storageUri, prepared.metadata.contentHash, prepared.metadata.contentType, prepared.metadata.byteSize, prepared.metadata.width, prepared.metadata.height], true);
          const added = await rows(tx, `SELECT ${assetProjection} FROM acquisition_asset_candidates WHERE id=? AND snapshot_id=? AND workspace_id=? FOR UPDATE`, [assetId, scope.snapshotId, identity.workspaceId], 1) as ManualSnapshotAsset[];
          if (added.length !== 1) fail("READBACK_FAILED");
          const asset = added[0], supplement = { assetId, replacesAssetId: prepared.sourceAssetId, operationId: prepared.operationId, mode: prepared.mode,
            sourceArtifactId: prepared.sourceArtifactId, role: prepared.role, positionIndex: position, sourceJsonPath: prepared.sourceJsonPath, sourceUrlHash: prepared.sourceUrlHash,
            storageKey: prepared.storageUri, contentHash: prepared.metadata.contentHash, contentType: prepared.metadata.contentType, sizeBytes: prepared.metadata.byteSize, width: prepared.metadata.width, height: prepared.metadata.height };
          envelope.supplements.push(supplement); envelope.assetDecisions = envelope.assetDecisions.map(decision => decision.assetId === prepared.sourceAssetId ? { ...decision, decision: "delete" as const } : decision);
          envelope.assetDecisions.push({ assetId, decision: "keep" }); state = { ...state, assets: [...state.assets, asset] };
          await append(envelope); return log.finalize(receipt(prepared.operationId, prepared.requestHash, "image"));
        }
        const session = { tx, identity, actor, get job() { return state.job; }, get snapshot() { return state.snapshot; }, get assets() { return state.assets; },
          get artifact() { return state.artifact; }, get stateHash() { return state.stateHash; }, get revision() { return state.revision; }, get replay() { return state.replay; },
          get consumerLinksHash() { return state.consumerLinksHash; }, enabled: deps.enabled, publishAvailable: () => Boolean(deps.publish), journal, execute, completeImage, unknown };
        const result = await body(session); completed = true; return result;
      });
    } catch (error) {
      if (error instanceof ManualSnapshotReviewError) throw error;
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED");
      if (error instanceof z.ZodError || error instanceof SyntaxError) fail("DATA_INVALID");
      if (error instanceof Error && /^ACQUISITION_REVIEW_[A-Z_]+$/u.test(error.message)) fail(error.message.slice(19));
      fail(completed ? "COMMIT_UNKNOWN" : "STORAGE_UNKNOWN");
    }
  }
  return { transaction };
}
export type ManualSnapshotReviewRepository = ReturnType<typeof createManualSnapshotReviewRepository>;
export type ManualSnapshotReviewSession = {
  tx: ManualSnapshotReviewExecutor; identity: AcquisitionReviewIdentity; actor: { id: number; role: string; defaultWorkspaceId: number };
  job: ManualSnapshotJob; snapshot: ManualSnapshotLoadedSource; assets: ManualSnapshotAsset[]; artifact: Row; stateHash: string;
  revision: ManualSnapshotRevisionRow | null; replay: ReturnType<typeof replayManualSnapshotRevision> | null; consumerLinksHash: string;
  enabled(): boolean; publishAvailable(): boolean;
  journal(operationId: string): { read(): Promise<{ final: AcquisitionReviewWriteResult | null; prepared: ManualSnapshotPreparedImage | null }>;
    prepare(input: ManualSnapshotPreparedImage): Promise<{ created: boolean; prepared: ManualSnapshotPreparedImage }>;
    finalize(receipt: AcquisitionReviewWriteResult): Promise<AcquisitionReviewWriteResult>; cancel(): Promise<AcquisitionReviewWriteResult> };
  execute(input: AcquisitionReviewWriteInput): Promise<AcquisitionReviewWriteResult>;
  completeImage(input: ManualSnapshotPreparedImage): Promise<AcquisitionReviewWriteResult>;
  unknown(operationId: string, status?: "unknown" | "cancelled"): AcquisitionReviewWriteResult;
};
export const manualSnapshotReviewRepository = createManualSnapshotReviewRepository();
