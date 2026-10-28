import { libraryFacets, type FacetSelection } from "../../../shared/libraryFacets";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { requireDb } from "../../repositories/dbClient";
import { resolveStoredObjectUrl } from "../../storage";
import { knowledgeVideoStorageKey } from "./videoDelivery";
import { readVideoLabels, type VideoLabels } from "../../../shared/videoLabels";

export type VideoScope = { workspaceId: number; userId: number; role?: string };
export type VideoRow = {
  id: number;
  userId: number;
  workspaceId: number;
  imageSetId: number | null;
  sourceHash: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  videoTitle: string | null;
  duration: number | null;
  videoRole: "main" | "aplus" | null;
  videoPosition: number;
  moduleId: string | null;
  labelStatus: string;
  labelRevision: number;
  labelRunId: string | null;
  labelError: string | null;
  aiAnalysis: string | null;
  aiOriginalAnalysis: string | null;
  userEditedAnalysis: string | null;
  processing: unknown;
  transcriptText: string | null;
  visibility: string;
  status: string;
  asin: string | null;
  setCategory: string | null;
  setStyle: string | null;
  setPrimaryColor: string | null;
  setAccentColor: string | null;
};
export async function videoRows<T>(query: SQL): Promise<T[]> {
  return (
    await (await requireDb("knowledge videos")).execute(query)
  )[0] as unknown as T[];
}
export function videoAccess(
  scope: VideoScope,
  mode: "mine" | "shared" | "all" = "all",
  edit = false
) {
  const owner = sql`v.userId=${scope.userId}`;
  const shared = sql`v.status='confirmed' AND v.visibility<>'private'`;
  const collection = sql`(v.imageSetId IS NULL OR (s.id IS NOT NULL AND s.workspaceId=${scope.workspaceId} AND (s.userId=${scope.userId} OR (s.status='confirmed' AND s.visibility<>'private'))))`;
  const visible = edit
    ? ["admin", "super_admin"].includes(scope.role || "")
      ? sql`(${owner} OR ${shared})`
      : owner
    : mode === "mine"
      ? owner
      : mode === "shared"
        ? shared
        : sql`(${owner} OR ${shared})`;
  return sql`v.recycleId IS NULL AND (s.id IS NULL OR s.recycleId IS NULL) AND v.workspaceId=${scope.workspaceId} AND v.origin_instance_id='knowledge_video_v1' AND v.status<>'archived' AND ${visible} AND ${collection}`;
}
const SELECT = sql`SELECT v.*,s.asin,s.setCategory,s.setStyle,s.setPrimaryColor,s.setAccentColor FROM kb_videos v LEFT JOIN kb_image_sets s ON s.id=v.imageSetId AND s.workspaceId=v.workspaceId`;
export async function requireVideo(
  scope: VideoScope,
  id: number,
  edit = false
) {
  const [row] = await videoRows<VideoRow>(
    sql`${SELECT} WHERE v.id=${id} AND ${videoAccess(scope, "all", edit)} LIMIT 1`
  );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "视频不存在或无权访问" });
  return row;
}
export function inheritedVideoLabels(row: VideoRow): VideoLabels | null {
  const labels = readVideoLabels(row.userEditedAnalysis || row.aiAnalysis);
  return labels && row.imageSetId
    ? {
        ...labels,
        category: row.setCategory || "",
        style: row.setStyle || "",
        primaryColor: row.setPrimaryColor || "",
        accentColor: row.setAccentColor || "",
      }
    : labels;
}
export function videoObjectAllowed(
  reference: string | null,
  scope: VideoScope,
  poster = false
) {
  if (knowledgeVideoStorageKey(reference, scope.workspaceId, poster))
    return true;
  return Boolean(
    reference &&
      new RegExp(
        `^storage://(?:local|s3|oss)/knowledge/${scope.workspaceId}/videos/[0-9]+/[a-f0-9]{64}\\.${poster ? "poster\\.webp" : "mp4"}$`
      ).test(reference)
  );
}
async function deliver(row: VideoRow, scope: VideoScope) {
  const videoUrl = videoObjectAllowed(row.videoUrl, scope)
    ? await resolveStoredObjectUrl(row.videoUrl).catch(() => null)
    : null;
  const posterUrl = videoObjectAllowed(row.thumbnailUrl, scope, true)
    ? await resolveStoredObjectUrl(row.thumbnailUrl!).catch(() => null)
    : null;
  return {
    id: row.id,
    imageSetId: row.imageSetId,
    asin: row.asin,
    title: row.videoTitle || "未命名视频",
    duration: row.duration,
    video: {
      hash: row.sourceHash,
      role: row.videoRole,
      position: row.videoPosition,
      moduleId: row.moduleId,
      title: row.videoTitle || "",
      duration: row.duration,
      videoUrl,
      posterUrl,
      status: videoUrl ? ("ready" as const) : ("failed" as const),
    },
    labels: inheritedVideoLabels(row),
    labelStatus: row.labelStatus,
    revision: row.labelRevision,
    error: row.labelError,
    canEdit:
      row.userId === scope.userId ||
      (["admin", "super_admin"].includes(scope.role || "") &&
        row.visibility !== "private"),
  };
}
export async function getLibraryVideo(scope: VideoScope, id: number) {
  return deliver(await requireVideo(scope, id), scope);
}
export async function listLibraryVideos(
  scope: VideoScope,
  input: {
    scope: "mine" | "shared" | "all";
    page: number;
    query?: string;
    role?: "main" | "aplus";
    type?: string;
    imageSetId?: number;
    content?: string;
    category?:string;style?:string;primaryColor?:string;accentColor?:string;groupBy?:string;
  }
) {
  const where = [videoAccess(scope, input.scope)];
  if (input.query)
    where.push(
      sql`(v.videoTitle LIKE ${"%" + input.query + "%"} OR s.asin LIKE ${"%" + input.query + "%"})`
    );
  if (input.role) where.push(sql`v.videoRole=${input.role}`);
  if (input.imageSetId) where.push(sql`v.imageSetId=${input.imageSetId}`);
  const labels = sql`COALESCE(v.userEditedAnalysis,v.aiAnalysis,'{}')`;
  const inherited={category:sql`s.setCategory`,style:sql`s.setStyle`,primaryColor:sql`s.setPrimaryColor`,accentColor:sql`s.setAccentColor`};
  const effective=Object.fromEntries(Object.entries(inherited).map(([key,column])=>[key,sql`IF(v.imageSetId IS NULL,JSON_UNQUOTE(JSON_EXTRACT(${labels},${'$.'.concat(key)})),${column})`])) as Record<keyof typeof inherited,SQL>;
  for(const key of Object.keys(inherited) as Array<keyof typeof inherited>) if(input[key]) where.push(sql`${effective[key]}=${input[key]==="__none"?"":input[key]}`);
  const groupFields={...effective,type:sql`JSON_UNQUOTE(JSON_EXTRACT(${labels},'$.type'))`,role:sql`v.videoRole`};
  const groupField=groupFields[input.groupBy as keyof typeof groupFields];
  const order=groupField?sql`${groupField} IS NULL,${groupField},`:sql``;
  if (input.type)
    where.push(
      sql`JSON_UNQUOTE(JSON_EXTRACT(${labels},'$.type'))=${input.type}`
    );
  if (input.content)
    where.push(
      sql`JSON_CONTAINS(JSON_EXTRACT(${labels},'$.segments[*].label'),${JSON.stringify(input.content)})`
    );
  const rows = await videoRows<VideoRow>(
    sql`${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} v.createdAt DESC,v.id DESC LIMIT 25 OFFSET ${(input.page - 1) * 24}`
  );
  return {
    items: await Promise.all(rows.slice(0, 24).map(row => deliver(row, scope))),
    hasMore: rows.length > 24,
  };
}
export async function saveVideoLabels(
  scope: VideoScope,
  id: number,
  revision: number,
  labels: VideoLabels,
  role: "main" | "aplus" | null
) {
  const row = await requireVideo(scope, id, true);
  if (row.imageSetId) labels = {...labels, category:row.setCategory || "",style:row.setStyle || "",primaryColor:row.setPrimaryColor || "",accentColor:row.setAccentColor || ""};
  const result = await (
    await requireDb("save video labels")
  ).execute(
    sql`UPDATE kb_videos v LEFT JOIN kb_image_sets s ON s.id=v.imageSetId AND s.workspaceId=v.workspaceId SET v.userEditedAnalysis=${JSON.stringify(labels)},v.labelRevision=v.labelRevision+1,v.labelStatus='complete',v.labelError=NULL,v.videoRole=IF(v.imageSetId IS NULL,${role},v.videoRole) WHERE v.id=${id} AND v.labelRevision=${revision} AND v.labelStatus NOT IN ('queued','running') AND ${videoAccess(scope, "all", true)}`
  );
  if ((result[0] as unknown as { affectedRows: number }).affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "视频正在处理或标签已更新，请刷新后编辑",
    });
  return getLibraryVideo(scope, id);
}
/** Index captured videos without duplicating their bytes or overwriting labels. */
export async function syncCapturedVideos(
  imageSetId: number,
  workspaceId: number
) {
  await (
    await requireDb("index captured videos")
  )
    .execute(sql`INSERT INTO kb_videos (userId,workspaceId,videoUrl,videoTitle,duration,thumbnailUrl,status,visibility,origin_instance_id,imageSetId,sourceKey,sourceHash,videoRole,videoPosition,moduleId)
    SELECT s.userId,s.workspaceId,v.url,COALESCE(NULLIF(v.title,''),s.productTitle),CEIL(v.duration),v.poster,'confirmed',s.visibility,'knowledge_video_v1',s.id,CONCAT('set:',s.id,':',v.role,':',COALESCE(v.moduleId,''),':',v.hash),v.hash,v.role,v.position,v.moduleId
    FROM kb_image_sets s JOIN JSON_TABLE(COALESCE(s.videos,JSON_ARRAY()),'$[*]' COLUMNS(hash varchar(64) PATH '$.hash',role varchar(16) PATH '$.role',position int PATH '$.position',moduleId varchar(80) PATH '$.moduleId' NULL ON EMPTY,title varchar(512) PATH '$.title' NULL ON EMPTY,duration double PATH '$.duration' NULL ON EMPTY,url varchar(1024) PATH '$.videoUrl' NULL ON EMPTY,poster varchar(1024) PATH '$.posterUrl' NULL ON EMPTY,state varchar(16) PATH '$.status')) v
    WHERE s.id=${imageSetId} AND s.workspaceId=${workspaceId} AND s.recycleId IS NULL AND v.state='ready' AND v.url IS NOT NULL AND v.poster IS NOT NULL
    ON DUPLICATE KEY UPDATE videoUrl=VALUES(videoUrl),thumbnailUrl=VALUES(thumbnailUrl),videoPosition=VALUES(videoPosition),status=IF(kb_videos.recycleId IS NULL,'confirmed',kb_videos.status)`);
  await (await requireDb()).execute(sql`UPDATE kb_videos v JOIN kb_image_sets s ON s.id=v.imageSetId AND s.workspaceId=v.workspaceId SET v.status='archived',v.labelRevision=v.labelRevision+1 WHERE s.id=${imageSetId} AND s.workspaceId=${workspaceId} AND v.recycleId IS NULL AND v.origin_instance_id='knowledge_video_v1' AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(COALESCE(s.videos,JSON_ARRAY()),'$[*]' COLUMNS(hash varchar(64) PATH '$.hash',role varchar(16) PATH '$.role',moduleId varchar(80) PATH '$.moduleId' NULL ON EMPTY)) j WHERE CAST(j.hash AS BINARY)=CAST(v.sourceHash AS BINARY) AND CAST(j.role AS BINARY)=CAST(v.videoRole AS BINARY) AND CAST(COALESCE(j.moduleId,'') AS BINARY)=CAST(COALESCE(v.moduleId,'') AS BINARY))`);

}

export async function videoBrowseFacets(scope:VideoScope,input:{scope:"mine"|"shared"|"all";query?:string;filters:FacetSelection;groupBy?:string}) {
  const where=[videoAccess(scope,input.scope)];
  if(input.query)where.push(sql`(v.videoTitle LIKE ${"%"+input.query+"%"} OR s.asin LIKE ${"%"+input.query+"%"})`);
  const labels=sql`COALESCE(v.userEditedAnalysis,v.aiAnalysis,'{}')`;
  const common={category:sql`s.setCategory`,style:sql`s.setStyle`,primaryColor:sql`s.setPrimaryColor`,accentColor:sql`s.setAccentColor`};
  const rows=await videoRows<Record<string,string|null>>(sql`SELECT ${sql.join(Object.entries(common).map(([key,column])=>sql`IF(v.imageSetId IS NULL,JSON_UNQUOTE(JSON_EXTRACT(${labels},${'$.'.concat(key)})),${column}) AS ${sql.identifier(key)}`),sql`,`)},v.videoRole AS role,JSON_UNQUOTE(JSON_EXTRACT(${labels},'$.type')) AS type,JSON_EXTRACT(${labels},'$.segments[*].label') AS content FROM kb_videos v LEFT JOIN kb_image_sets s ON s.id=v.imageSetId AND s.workspaceId=v.workspaceId WHERE ${sql.join(where,sql` AND `)}`);
  return libraryFacets(rows.map(row=>({...row,content:typeof row.content==="string"?JSON.parse(row.content):row.content})),input.filters,[...Object.keys(common),"role","type","content"],input.groupBy);
}
