import { layoutWithoutDeletedImages } from "../../../shared/knowledgeAssetLayout";
import { requestSetCacheExpiry, retainedCacheReferenceRows } from "../acquisition/cacheExpiry";
import { knowledgeCacheCleanupEnabled } from "../acquisition/cacheRetention";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { requireDb } from "../../repositories/dbClient";
import { registerAiJobHandler } from "../../services/aiJobRunner";
import { storageDeleteOwnedObject } from "../../storage";
import {
  loadAsset,
  requireLibraryAdmin,
  queryRows,
  notFound,
  type AssetScope,
  type Executor,
} from "./assetTargets";

type RecycleRow = {
  id: string;
  workspaceId: number;
  kind: "set" | "image" | "video";
  targetId: number;
  parentSetId: number | null;
  title: string;
  itemCount: number;
  deletedAt: string;
};
export async function listRecycled(scope: AssetScope, page: number) {
  requireLibraryAdmin(scope);
  const rows = await queryRows<RecycleRow>(
    await requireDb(),
    sql`SELECT * FROM knowledge_recycle_bin WHERE workspaceId=${scope.workspaceId} ORDER BY deletedAt DESC,id LIMIT 51 OFFSET ${(page - 1) * 50}`
  );
  return { items: rows.slice(0, 50), hasMore: rows.length > 50 };
}

async function parentLock(
  db: Executor,
  scope: AssetScope,
  id: number,
  active = true
) {
  const [set] = await queryRows<{
    id: number;
    asin: string;
    productTitle: string;
    recycleId: string | null;
  }>(
    db,
    sql`SELECT id,asin,productTitle,recycleId FROM kb_image_sets WHERE id=${id} AND workspaceId=${scope.workspaceId} FOR UPDATE`
  );
  if (!set || (active && set.recycleId)) throw notFound();
  return set;
}
async function assertNoCollection(
  db: Executor,
  scope: AssetScope,
  setId: number
) {
  const active = await queryRows(
    db,
    sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${scope.workspaceId} AND consumer_ref LIKE ${`kb-refresh:${setId}:%`} AND deleted_at IS NULL AND status IN ('queued','running','review_required') LIMIT 1`
  );
  if (active.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "本套图正在重新采集，请完成采集或取消任务后再删除",
    });
}
export async function deleteAsset(
  scope: AssetScope,
  kind: "set" | "image" | "video",
  targetId: number,
  permanent = false
) {
  requireLibraryAdmin(scope);
  const db = await requireDb();
  return db.transaction(async tx => {
    let ids: number[], parentSetId: number | null, title: string;
    if (kind === "set") {
      const set = await parentLock(tx, scope, targetId);
      await assertNoCollection(tx, scope, targetId);
      ids = [targetId];
      parentSetId = null;
      title = `${set.asin} · ${set.productTitle || "ASIN 集"}`;
    } else {
      const asset = await loadAsset(scope, kind, targetId, {
        db: tx,
        lock: true,
        deleting: true,
      });
      ids = kind === "image" ? asset.unit!.images.map(i => i.id) : [targetId];
      parentSetId = asset.set?.id || null;
      title = asset.title;
      if (parentSetId) await assertNoCollection(tx, scope, parentSetId);
    }
    const id = randomUUID();
    const count =
      kind === "set"
        ? (
            await queryRows<{ n: number }>(
              tx,
              sql`SELECT (SELECT COUNT(*) FROM kb_images WHERE imageSetId=${targetId} AND recycleId IS NULL)+(SELECT COUNT(*) FROM kb_videos WHERE imageSetId=${targetId} AND recycleId IS NULL) AS n`
            )
          )[0].n
        : ids.length;
    await tx.execute(
      sql`INSERT INTO knowledge_recycle_bin (id,workspaceId,deletedBy,kind,targetId,parentSetId,title,itemCount) VALUES (${id},${scope.workspaceId},${scope.userId},${kind},${targetId},${parentSetId},${title.slice(0, 512)},${count})`
    );
    if (kind === "set") {
      await tx.execute(
        sql`UPDATE kb_image_sets SET recycleId=${id} WHERE id=${targetId} AND workspaceId=${scope.workspaceId}`
      );
      // Separately trashed children retain their own entry and are not restored with the set.
      await tx.execute(
        sql`UPDATE kb_images SET recycleId=${id},labelRevision=labelRevision+1 WHERE imageSetId=${targetId} AND recycleId IS NULL`
      );
      await tx.execute(
        sql`UPDATE kb_videos SET recycleId=${id},labelRevision=labelRevision+1 WHERE imageSetId=${targetId} AND workspaceId=${scope.workspaceId} AND recycleId IS NULL`
      );
    } else
      await tx.execute(
        sql`UPDATE ${sql.identifier(kind === "image" ? "kb_images" : "kb_videos")} SET recycleId=${id},labelRevision=labelRevision+1 WHERE id IN (${sql.join(
          ids.map(i => sql`${i}`),
          sql`,`
        )})`
      );
    if (permanent)
      await purgeEntry(tx, scope, {
        id,
        workspaceId: scope.workspaceId,
        kind,
        targetId,
        parentSetId,
        title,
        itemCount: count,
        deletedAt: "",
      });
    return { id, count, permanent };
  });
}

export async function restoreAsset(scope: AssetScope, id: string) {
  requireLibraryAdmin(scope);
  return (await requireDb()).transaction(async tx => {
    const entry = await entryFor(tx, scope, id);
    // Prevent restoring an orphan while its parent remains in the recycle bin.
    if (entry.parentSetId) await parentLock(tx, scope, entry.parentSetId);
    else if (entry.kind === "set")
      await parentLock(tx, scope, entry.targetId, false);
    await tx.execute(
      sql`UPDATE kb_images SET recycleId=NULL WHERE recycleId=${id}`
    );
    await tx.execute(
      sql`UPDATE kb_videos SET recycleId=NULL WHERE recycleId=${id} AND workspaceId=${scope.workspaceId}`
    );
    await tx.execute(
      sql`UPDATE kb_image_sets SET recycleId=NULL WHERE recycleId=${id} AND workspaceId=${scope.workspaceId}`
    );
    await tx.execute(
      sql`DELETE FROM knowledge_recycle_bin WHERE id=${id} AND workspaceId=${scope.workspaceId}`
    );
    return { restored: true };
  });
}
async function entryFor(db: Executor, scope: AssetScope, id: string) {
  const [entry] = await queryRows<RecycleRow>(
    db,
    sql`SELECT * FROM knowledge_recycle_bin WHERE id=${id} AND workspaceId=${scope.workspaceId} FOR UPDATE`
  );
  if (!entry) throw notFound();
  return entry;
}
export async function purgeRecycled(scope: AssetScope, id: string) {
  requireLibraryAdmin(scope);
  return (await requireDb()).transaction(async tx => {
    const entry = await entryFor(tx, scope, id);
    if (entry.parentSetId)
      await parentLock(tx, scope, entry.parentSetId, false);
    if (entry.kind === "set")
      await parentLock(tx, scope, entry.targetId, false);
    await purgeEntry(tx, scope, entry);
    return { deleted: true };
  });
}
async function purgeEntry(db: Executor, scope: AssetScope, entry: RecycleRow) {
  const imageWhere =
    entry.kind === "set"
      ? sql`imageSetId=${entry.targetId}`
      : sql`recycleId=${entry.id}`;
  const videoWhere =
    entry.kind === "set"
      ? sql`imageSetId=${entry.targetId} AND workspaceId=${scope.workspaceId}`
      : sql`recycleId=${entry.id} AND workspaceId=${scope.workspaceId}`;
  const images = await queryRows<{
    id: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    sourceUrlHash: string | null;
  }>(
    db,
    sql`SELECT id,imageUrl,thumbnailUrl,sourceUrlHash FROM kb_images WHERE ${imageWhere}`
  );
  const videos = await queryRows<{
    id: number;
    videoUrl: string;
    thumbnailUrl: string | null;
    sourceHash: string;
    userId: number;
  }>(
    db,
    sql`SELECT id,videoUrl,thumbnailUrl,sourceHash,userId FROM kb_videos WHERE ${videoWhere}`
  );
  const references = new Set(
    [
      ...images.flatMap(i => [i.imageUrl, i.thumbnailUrl]),
      ...videos.flatMap(v => [
        v.videoUrl,
        v.thumbnailUrl,
        `storage://local/knowledge/${scope.workspaceId}/videos/${v.userId}/${v.sourceHash}.flac`,
      ]),
    ].filter((v): v is string => Boolean(v))
  );
  for (const reference of references)
    await db.execute(
      sql`INSERT INTO knowledge_object_cleanup (workspaceId,reference) VALUES (${scope.workspaceId},${reference})`
    );
  // Remove this video's source slot too, so the ASIN renderer cannot fall back to the old URL.
  if (entry.kind === "video" && entry.parentSetId) {
    const ids = videos.map(v => v.id);
    if (ids.length)
      await db.execute(
        sql`UPDATE kb_image_sets s SET videos=(SELECT COALESCE(JSON_ARRAYAGG(j.body),JSON_ARRAY()) FROM JSON_TABLE(COALESCE(s.videos,JSON_ARRAY()),'$[*]' COLUMNS(body JSON PATH '$')) j WHERE NOT EXISTS (SELECT 1 FROM kb_videos v WHERE v.recycleId=${entry.id} AND v.sourceHash=JSON_UNQUOTE(JSON_EXTRACT(j.body,'$.hash')) AND v.videoRole=JSON_UNQUOTE(JSON_EXTRACT(j.body,'$.role')) AND COALESCE(v.moduleId,'')=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(j.body,'$.moduleId')),''))) WHERE s.id=${entry.parentSetId} AND s.workspaceId=${scope.workspaceId}`
      );
  }
  if (entry.kind === "image" && entry.parentSetId) {
    const [parent] = await queryRows<{ sourceLayout: unknown }>(
      db,
      sql`SELECT sourceLayout FROM kb_image_sets WHERE id=${entry.parentSetId} AND workspaceId=${scope.workspaceId}`
    );
    if (parent) {
      const raw =
        typeof parent.sourceLayout === "string"
          ? JSON.parse(parent.sourceLayout)
          : parent.sourceLayout;
      await db.execute(
        sql`UPDATE kb_image_sets SET sourceLayout=${JSON.stringify(
          layoutWithoutDeletedImages(
            raw,
            images.flatMap(i => (i.sourceUrlHash ? [i.sourceUrlHash] : []))
          )
        )} WHERE id=${entry.parentSetId} AND workspaceId=${scope.workspaceId}`
      );
    }
  }
  await db.execute(sql`DELETE FROM kb_images WHERE ${imageWhere}`);
  await db.execute(sql`DELETE FROM kb_videos WHERE ${videoWhere}`);
  const imageIds = images.map(i => i.id),
    videoIds = videos.map(v => v.id);
  if (imageIds.length)
    await db.execute(
      sql`DELETE FROM knowledge_adjustments WHERE workspaceId=${scope.workspaceId} AND kind='image' AND targetId IN (${sql.join(
        imageIds.map(id => sql`${id}`),
        sql`,`
      )})`
    );
  if (videoIds.length)
    await db.execute(
      sql`DELETE FROM knowledge_adjustments WHERE workspaceId=${scope.workspaceId} AND kind='video' AND targetId IN (${sql.join(
        videoIds.map(id => sql`${id}`),
        sql`,`
      )})`
    );
  if (entry.kind === "set") {
    await db.execute(sql`DELETE FROM knowledge_adjustments WHERE workspaceId=${scope.workspaceId} AND kind='set' AND targetId=${entry.targetId}`);
    await requestSetCacheExpiry(db, scope.workspaceId, entry.targetId);
    await db.execute(
      sql`DELETE FROM kb_image_sets WHERE id=${entry.targetId} AND workspaceId=${scope.workspaceId} AND recycleId=${entry.id}`
    );
    await db.execute(
      sql`DELETE FROM knowledge_recycle_bin WHERE parentSetId=${entry.targetId} AND workspaceId=${scope.workspaceId}`
    );
  }
  await db.execute(
    sql`DELETE FROM knowledge_recycle_bin WHERE id=${entry.id} AND workspaceId=${scope.workspaceId}`
  );
  await db.execute(
    sql`INSERT INTO ai_jobs (workspaceId,userId,runId,kind,module,${sql.identifier("procedure")},status,queueName,maxAttempts,timeoutSeconds,input) VALUES (${scope.workspaceId},${scope.userId},${"kb-cleanup-" + randomUUID()},'knowledge.objects.cleanup','knowledge','knowledgeAssets.delete','queued','knowledge_tags',3,600,${JSON.stringify({})})`
  );
}

// A conservative reachability check protects shared business files, including recycle-bin assets.
export async function cleanupKnowledgeObjects(
  db: Executor,
  signal: AbortSignal
) {
  if (!knowledgeCacheCleanupEnabled()) return { checked: 0, disabled: true };
  const pending = await queryRows<{ id: number; reference: string }>(
    db,
    sql`SELECT id,reference FROM knowledge_object_cleanup WHERE state='pending' ORDER BY id LIMIT 100`
  );
  const columns = await queryRows<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    db,
    sql`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('varchar','text','mediumtext','longtext','json') AND TABLE_NAME NOT IN ('knowledge_object_cleanup','knowledge_adjustments','knowledge_tag_improvements','ai_jobs','emperor_skill_runs') AND TABLE_NAME NOT LIKE '%audit%' AND TABLE_NAME NOT LIKE '%log%'`
  );
  const tables = new Map<string, string[]>();
  for (const column of columns)
    tables.set(column.TABLE_NAME, [
      ...(tables.get(column.TABLE_NAME) || []),
      column.COLUMN_NAME,
    ]);
  const deadline = Date.now() + 30_000;
  let checked = 0;
  for (const object of pending) {
    if (Date.now() >= deadline) break;
    signal.throwIfAborted();
    checked++;
    if (!object.reference.startsWith("storage://")) {
      await db.execute(
        sql`UPDATE knowledge_object_cleanup SET state='external' WHERE id=${object.id}`
      );
      continue;
    }
    let referenced = false;
    for (const [table, fields] of tables) {
      const [match] = await queryRows(
        db,
        sql`SELECT 1 FROM ${sql.identifier(table)} WHERE (${sql.join(
          fields.map(
            field =>
              sql`LOCATE(${object.reference},CAST(${sql.identifier(field)} AS CHAR))>0`
          ),
          sql` OR `
        )}) AND ${retainedCacheReferenceRows(table, object.reference)} LIMIT 1`
      );
      if (match) {
        referenced = true;
        break;
      }
    }
    if (referenced) {
      await db.execute(
        sql`UPDATE knowledge_object_cleanup SET state='shared' WHERE id=${object.id}`
      );
      continue;
    }
    await storageDeleteOwnedObject(object.reference);
    await db.execute(
      sql`UPDATE knowledge_object_cleanup SET state='deleted' WHERE id=${object.id}`
    );
  }
  return { checked };
}
registerAiJobHandler({
  id: "knowledge.objects.cleanup",
  match: job => job.kind === "knowledge.objects.cleanup",
  handler: async (_job, ctx) =>
    cleanupKnowledgeObjects(await requireDb(), ctx.signal),
});
