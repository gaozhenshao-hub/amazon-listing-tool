ALTER TABLE kb_images
  MODIFY COLUMN imageSetId int NULL,
  ADD COLUMN userId int NULL,
  ADD COLUMN workspaceId int NULL,
  ADD COLUMN uploadTitle varchar(512) NULL,
  ADD COLUMN uploadHash varchar(64) NULL,
  ADD COLUMN visibility enum('private','team') NOT NULL DEFAULT 'team',
  ADD COLUMN tagAccentColor varchar(30) NULL,
  ADD COLUMN labelStatus enum('pending','queued','running','complete','failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN labelRevision int NOT NULL DEFAULT 0,
  ADD COLUMN labelRunId varchar(100) NULL,
  ADD COLUMN labelError varchar(512) NULL,
  ADD UNIQUE KEY kb_image_upload_identity (workspaceId,userId,uploadHash),
  ADD KEY kb_image_upload_scope (workspaceId,imageSetId,createdAt,id);
