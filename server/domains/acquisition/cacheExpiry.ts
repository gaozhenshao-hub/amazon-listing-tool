import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { requireDb } from "../../repositories/dbClient";
import { queryRows, type Executor } from "../knowledge/assetTargets";
import { knowledgeCacheCleanupEnabled, knowledgeCacheRetention } from "./cacheRetention";

const idsSql = (ids: number[]) =>
  sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  );
type Column = { TABLE_NAME: string; COLUMN_NAME: string };
const record = (value: unknown): any =>
  typeof value === "string" ? JSON.parse(value) : value;

/** Admission holds the same source-job lock as expiry before it publishes another reference. */
export async function lockAcquisitionCache(
  db: Executor,
  workspaceId: number,
  confirmedId: number
) {
  const [job] = await queryRows<{ cache_expired_at: unknown }>(
    db,
    sql`SELECT j.cache_expired_at
    FROM acquisition_jobs j JOIN acquisition_source_snapshots s ON s.job_id=j.id AND s.workspace_id=j.workspace_id
    JOIN acquisition_confirmed_snapshots c ON c.snapshot_id=s.id AND c.workspace_id=j.workspace_id
    WHERE c.id=${confirmedId} AND j.workspace_id=${workspaceId} FOR UPDATE`
  );
  if (!job || job.cache_expired_at)
    throw new TRPCError({
      code: "CONFLICT",
      message: "采集临时缓存已过期，请重新采集。已入库素材仍可在知识库查看。",
    });
}

export async function requestSetCacheExpiry(
  db: Executor,
  workspaceId: number,
  setId: number
) {
  await db.execute(sql`UPDATE acquisition_jobs SET cache_cleanup_requested_at=NOW()
    WHERE workspace_id=${workspaceId} AND ingested_set_id=${setId} AND consumer_type='kb_images'
    AND status='confirmed' AND cache_expired_at IS NULL`);
}

export function cacheReferences(
  value: unknown,
  result = new Set<string>()
): Set<string> {
  if (
    typeof value === "string" &&
    /^storage:\/\/[^/]+\/acquisition\/\d+\//.test(value)
  )
    result.add(value);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) cacheReferences(item, result);
  return result;
}

export function ownsCacheReference(reference: string, workspaceId: number, sourceIds: number[], runIds: number[]) {
  const match = /^storage:\/\/[^/]+\/acquisition\/(\d+)\/(snapshots|runs)\/(\d+)\/(.+)$/.exec(reference);
  return Boolean(match && Number(match[1]) === workspaceId
    && (match[2] === "snapshots" ? sourceIds : runIds).includes(Number(match[3]))
    && /^[A-Za-z0-9_./-]+$/.test(match[4]) && !match[4].split("/").some(part => !part || part === "." || part === ".."));
}

/** Proof columns are discovered because deployments can have different optional business tables. */
export async function cacheProofColumns(db: Executor) {
  return queryRows<Column>(
    db,
    sql`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,12)<>'acquisition_'
    AND COLUMN_NAME IN ('sourceSnapshotId','source_snapshot_id','confirmedSnapshotId','confirmed_snapshot_id','acquisitionAssetId')`
  );
}

/** Transactional expiry retains every original row and payload; no database records are deleted. */
export async function expireKnowledgeCache(
  db: Executor,
  workspaceId: number,
  jobId: number,
  columns: Column[]
) {
  if (!knowledgeCacheCleanupEnabled()) return { expired: false, reason: "disabled" };
  const [job] = await queryRows<any>(
    db,
    sql`SELECT *,NOW() AS cacheNow FROM acquisition_jobs
    WHERE id=${jobId} AND workspace_id=${workspaceId} FOR UPDATE`
  );
  if (!job || job.cache_expired_at || job.cache_hit_snapshot_id)
    return { expired: false, reason: "unavailable" };
  const reason = knowledgeCacheRetention({
    consumerType: job.consumer_type,
    status: job.status,
    completedAt: job.completed_at ? new Date(job.completed_at) : null,
    now: new Date(job.cacheNow),
    permanentlyDeletedSet: Boolean(job.cache_cleanup_requested_at),
    hasManualRevision: false,
    hasOtherConsumer: false,
    hasActiveCollection: false,
  });
  if (reason !== "eligible") return { expired: false, reason };
  const [repair] = await queryRows(db,sql`SELECT id FROM ai_jobs WHERE workspaceId=${workspaceId} AND kind='knowledge.collection.repair' AND status IN ('queued','running') AND JSON_EXTRACT(input,'$.jobId')=${jobId} LIMIT 1`);
  if(repair)return {expired:false,reason:"active_collection"};
  const sources = await queryRows<any>(
    db,
    sql`SELECT * FROM acquisition_source_snapshots WHERE job_id=${jobId} AND workspace_id=${workspaceId} FOR UPDATE`
  );
  if (
    !sources.length ||
    sources.some(s => !["confirmed", "superseded"].includes(s.status))
  )
    return { expired: false, reason: "incomplete" };
  const sourceIds = sources.map(s => Number(s.id)),
    sourceList = idsSql(sourceIds);
  const confirmed = await queryRows<any>(
    db,
    sql`SELECT * FROM acquisition_confirmed_snapshots WHERE snapshot_id IN (${sourceList}) AND workspace_id=${workspaceId} FOR UPDATE`
  );
  if (!confirmed.length || confirmed.some(c => c.revision_id))
    return { expired: false, reason: "manual_revision" };
  const confirmedIds = confirmed.map(c => Number(c.id)),
    confirmedList = idsSql(confirmedIds);
  const [protectedUse] = await queryRows(
    db,
    sql`SELECT 1 WHERE
    EXISTS (SELECT 1 FROM acquisition_snapshot_revisions WHERE snapshot_id IN (${sourceList})) OR
    EXISTS (SELECT 1 FROM acquisition_consumer_links WHERE confirmed_snapshot_id IN (${confirmedList}) AND consumer_type<>'kb_images') OR
    EXISTS (SELECT 1 FROM acquisition_jobs WHERE cache_hit_snapshot_id IN (${confirmedList})) OR
    EXISTS (SELECT 1 FROM kb_image_sets WHERE remote_id IN (${confirmedList}) AND origin_instance_id<>'unified_amazon_acquisition')`
  );
  if (protectedUse) return { expired: false, reason: "shared_or_active" };
  const [active] = await queryRows(
    db,
    sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${workspaceId}
    AND consumer_ref LIKE ${`kb-refresh:${job.ingested_set_id}:%`} AND status IN ('queued','running','review_required') LIMIT 1`
  );
  if (active) return { expired: false, reason: "active_collection" };
  const assets = await queryRows<any>(
    db,
    sql`SELECT * FROM acquisition_asset_candidates WHERE snapshot_id IN (${sourceList}) AND workspace_id=${workspaceId} FOR UPDATE`
  );
  for (const column of columns) {
    const ids = /source_?snapshot/i.test(column.COLUMN_NAME)
      ? sourceIds
      : /confirmed_?snapshot/i.test(column.COLUMN_NAME)
        ? confirmedIds
        : assets.map(a => Number(a.id));
    if (!ids.length) continue;
    const [used] = await queryRows(
      db,
      sql`SELECT 1 FROM ${sql.identifier(column.TABLE_NAME)} WHERE ${sql.identifier(column.COLUMN_NAME)} IN (${idsSql(ids)}) LIMIT 1`
    );
    if (used) return { expired: false, reason: "business_evidence" };
  }
  const artifacts = await queryRows<any>(
    db,
    sql`SELECT a.* FROM acquisition_raw_artifacts a JOIN acquisition_runs r ON r.id=a.run_id AND r.workspace_id=a.workspace_id WHERE r.job_id=${jobId} AND a.workspace_id=${workspaceId}`
  );
  if (artifacts.length) {
    const artifactList = idsSql(artifacts.map(a => Number(a.id)));
    const [sharedRaw] = await queryRows(
      db,
      sql`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM acquisition_source_snapshots WHERE raw_artifact_id IN (${artifactList}) AND job_id<>${jobId}) OR
      EXISTS (SELECT 1 FROM acquisition_asset_candidates WHERE source_artifact_id IN (${artifactList}) AND snapshot_id NOT IN (${sourceList}))`
    );
    if (sharedRaw) return { expired: false, reason: "shared_artifact" };
  }
  const refs = cacheReferences(assets);
  cacheReferences(artifacts, refs);
  for (const row of sources) {
    cacheReferences(record(row.normalized_data), refs);
    cacheReferences(record(row.completeness), refs);
  }
  for (const row of confirmed)
    cacheReferences(record(row.confirmed_data), refs);
  const runIds = [...new Set([...sources.map(s => Number(s.run_id)), ...artifacts.map(a => Number(a.run_id))])];
  if ([...refs].some(reference => !ownsCacheReference(reference, workspaceId, sourceIds, runIds)))
    return { expired: false, reason: "ambiguous_file_ownership" };
  // Queue first. Actual byte deletion performs a separate all-business reference check.
  for (const reference of refs)
    await db.execute(
      sql`INSERT INTO knowledge_object_cleanup (workspaceId,reference) VALUES (${workspaceId},${reference})`
    );
  await db.execute(
    sql`UPDATE acquisition_jobs SET cache_expired_at=NOW() WHERE id=${jobId} AND workspace_id=${workspaceId}`
  );
  await db.execute(
    sql`UPDATE acquisition_confirmed_snapshots SET is_current=0 WHERE id IN (${confirmedList}) AND workspace_id=${workspaceId}`
  );
  return { expired: true, references: refs.size };
}

export async function sweepKnowledgeCache(signal: AbortSignal) {
  if (!knowledgeCacheCleanupEnabled()) return { checked: 0, expired: 0, disabled: true };
  const db = await requireDb(),
    columns = await cacheProofColumns(db);
  const candidates = await queryRows<{ id: number; workspace_id: number }>(
    db,
    sql`SELECT id,workspace_id FROM acquisition_jobs
    WHERE consumer_type='kb_images' AND status='confirmed' AND cache_expired_at IS NULL AND cache_hit_snapshot_id IS NULL
    AND (completed_at<=DATE_SUB(NOW(),INTERVAL 7 DAY) OR cache_cleanup_requested_at IS NOT NULL) ORDER BY updated_at,id LIMIT 20`
  );
  let expired = 0;
  for (const job of candidates) {
    signal.throwIfAborted();
    const result = await db.transaction(tx =>
      expireKnowledgeCache(tx, job.workspace_id, job.id, columns)
    );
    if (result.expired) expired++;
    else
      await db.execute(
        sql`UPDATE acquisition_jobs SET updated_at=NOW() WHERE id=${job.id} AND workspace_id=${job.workspace_id}`
      );
  }
  return { checked: candidates.length, expired };
}

/** Ignore only rows whose own source job was explicitly expired after the checks above.
 * All other acquisition rows, all business tables, and all recycle-bin assets remain protective.
 * These SQL fragments are used only for managed acquisition objects, never other uploads.
 */
export function retainedCacheReferenceRows(
  table: string,
  reference: string
): SQL {
  if (!/^storage:\/\/[^/]+\/acquisition\/\d+\//.test(reference))
    return sql`TRUE`;
  const name = sql.identifier(table);
  if (table === "acquisition_source_snapshots")
    return sql`NOT EXISTS (SELECT 1 FROM acquisition_jobs cache_owner WHERE cache_owner.id=${name}.job_id AND cache_owner.workspace_id=${name}.workspace_id AND cache_owner.cache_expired_at IS NOT NULL)`;
  if (
    table === "acquisition_asset_candidates" ||
    table === "acquisition_confirmed_snapshots"
  )
    return sql`NOT EXISTS (SELECT 1 FROM acquisition_source_snapshots cache_source JOIN acquisition_jobs cache_owner ON cache_owner.id=cache_source.job_id AND cache_owner.workspace_id=cache_source.workspace_id WHERE cache_source.id=${name}.snapshot_id AND cache_source.workspace_id=${name}.workspace_id AND cache_owner.cache_expired_at IS NOT NULL)`;
  if (table === "acquisition_raw_artifacts")
    return sql`NOT EXISTS (SELECT 1 FROM acquisition_runs cache_run JOIN acquisition_jobs cache_owner ON cache_owner.id=cache_run.job_id AND cache_owner.workspace_id=cache_run.workspace_id WHERE cache_run.id=${name}.run_id AND cache_run.workspace_id=${name}.workspace_id AND cache_owner.cache_expired_at IS NOT NULL)`;
  return sql`TRUE`;
}
