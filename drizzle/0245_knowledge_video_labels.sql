ALTER TABLE kb_videos
  ADD COLUMN imageSetId int NULL,
  ADD COLUMN sourceKey varchar(191) NULL,
  ADD COLUMN sourceHash varchar(64) NULL,
  ADD COLUMN videoRole varchar(16) NULL,
  ADD COLUMN videoPosition int NOT NULL DEFAULT 0,
  ADD COLUMN moduleId varchar(80) NULL,
  ADD COLUMN labelStatus varchar(20) NOT NULL DEFAULT 'unlabeled',
  ADD COLUMN labelRevision int NOT NULL DEFAULT 0,
  ADD COLUMN labelRunId varchar(80) NULL,
  ADD COLUMN labelError varchar(300) NULL,
  ADD COLUMN processing json NULL,
  ADD COLUMN aiOriginalAnalysis text NULL,
  ADD UNIQUE KEY kb_video_workspace_source (workspaceId,sourceKey),
  ADD KEY kb_video_workspace_set (workspaceId,imageSetId),
  ADD KEY kb_video_workspace_owner (workspaceId,userId,status);

INSERT INTO kb_videos (userId,workspaceId,asin,videoUrl,videoTitle,duration,thumbnailUrl,status,visibility,origin_instance_id,imageSetId,sourceKey,sourceHash,videoRole,videoPosition,moduleId)
SELECT s.userId,s.workspaceId,s.asin,v.url,COALESCE(NULLIF(v.title,''),s.productTitle),CEIL(v.duration),v.poster,'confirmed',s.visibility,'knowledge_video_v1',s.id,
 CONCAT('set:',s.id,':',v.role,':',COALESCE(v.moduleId,''),':',v.hash),v.hash,v.role,v.position,v.moduleId
FROM kb_image_sets s JOIN JSON_TABLE(COALESCE(s.videos,JSON_ARRAY()),'$[*]' COLUMNS(
 hash varchar(64) PATH '$.hash',role varchar(16) PATH '$.role',position int PATH '$.position',moduleId varchar(80) PATH '$.moduleId' NULL ON EMPTY,
 title varchar(512) PATH '$.title' NULL ON EMPTY,duration double PATH '$.duration' NULL ON EMPTY,url varchar(1024) PATH '$.videoUrl' NULL ON EMPTY,
 poster varchar(1024) PATH '$.posterUrl' NULL ON EMPTY,state varchar(16) PATH '$.status')) v
WHERE s.origin_instance_id='unified_amazon_acquisition' AND v.state='ready' AND v.url IS NOT NULL AND v.poster IS NOT NULL;
