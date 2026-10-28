/** Explicit scoped rollout: index captured videos, reclassify old video taxonomy,
 * and fill independently owned carousel labels. Never touches uploaded bytes. */
import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import { videoRows, syncCapturedVideos } from "../server/domains/knowledge/videoLibrary";
import { enqueueVideoTags } from "../server/domains/knowledge/videoTagging";
import { enqueueAutomaticTags } from "../server/domains/knowledge/automaticTagging";
import { VIDEO_TYPES } from "../shared/videoLabels";

const userId=Number(process.env.KNOWLEDGE_MAINTENANCE_ACTOR),workspaceId=Number(process.env.KNOWLEDGE_MAINTENANCE_WORKSPACE);
if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(workspaceId)||workspaceId<1)throw Error("Explicit scope required");
try {
  const db=await requireDb("media tag rollout");
  const [actor]=await videoRows<{role:string}>(sql`SELECT role FROM users WHERE id=${userId} AND status='active'`);
  if(!actor||!["admin","super_admin"].includes(actor.role))throw Error("Administrator required");
  const collections=await videoRows<{id:number;userId:number}>(sql`SELECT id,userId FROM kb_image_sets WHERE workspaceId=${workspaceId} AND status='confirmed'`);
  for(const set of collections)await syncCapturedVideos(set.id,workspaceId);
  const videos=await videoRows<{id:number;labelRevision:number;labelStatus:string;videoTitle:string;aiAnalysis:string|null;userEditedAnalysis:string|null}>(sql`SELECT id,labelRevision,labelStatus,videoTitle,aiAnalysis,userEditedAnalysis FROM kb_videos WHERE workspaceId=${workspaceId} AND origin_instance_id='knowledge_video_v1' AND status='confirmed' AND visibility<>'private'`);
  for(const video of videos) {
    let labels: any=null;try{labels=JSON.parse(video.userEditedAnalysis||video.aiAnalysis||"null");}catch{}
    if(labels && (VIDEO_TYPES as readonly string[]).includes(labels.type) && !Object.hasOwn(labels,"displayTags"))continue;
    const feedback=video.videoTitle === "煮锅" ? "用户已核对：这条煮锅视频主要展示烹饪食物与使用场景，类型应为产品展示（侧重场景）。内容片段仍依据画面和语音判断。" : "使用当前五类视频分类，重新核对整条视频的主要表达重心，保留十项内容标签及对应时间段。";
    const job=await enqueueVideoTags({workspaceId,userId,role:actor.role},video.id,video.labelRevision,feedback);
    console.log(JSON.stringify({videoId:video.id,runId:job.runId}));
  }
  // The first carousel image formerly held a module-wide AI result. Clear only
  // that generated result once; human-confirmed labels are explicitly preserved.
  const migration=`knowledge-carousel-independent-v1-workspace-${workspaceId}`;
  const [prior]=await videoRows<{status:string}>(sql`SELECT status FROM app_schema_migrations WHERE migrationName=${migration}`);
  if(!prior)await db.transaction(async tx=>{
    await tx.execute(sql`INSERT INTO app_schema_migrations(migrationName,checksum,status,executionId,startedAt) VALUES (${migration},'carousel-independent-v1','started',${migration},NOW())`);
    await tx.execute(sql`UPDATE kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId SET i.tagImageTypeMain=NULL,i.tagImageTypeSub=NULL,i.tagSellingPointCategory=NULL,i.tagSellingPointDetail=NULL,i.tagComposition=NULL WHERE s.workspaceId=${workspaceId} AND s.status='confirmed' AND i.imagePosition='aplus' AND i.tagsConfirmed=0 AND i.analysisConfirmed=0 AND EXISTS (SELECT 1 FROM JSON_TABLE(s.sourceLayout,'$.modules[*]' COLUMNS(body JSON PATH '$')) m WHERE JSON_UNQUOTE(JSON_EXTRACT(m.body,'$.kind'))='carousel' AND JSON_UNQUOTE(JSON_EXTRACT(m.body,'$.cards[0].images[0].hash'))=i.sourceUrlHash)`);
    await tx.execute(sql`UPDATE app_schema_migrations SET status='succeeded',finishedAt=NOW() WHERE migrationName=${migration}`);
  });
  for(const set of collections) {
    const job=await enqueueAutomaticTags({workspaceId,userId:set.userId,imageSetId:set.id});
    if(job)console.log(JSON.stringify({imageSetId:set.id,runId:job.runId}));
  }
} finally { await closeDbConnection(); }
