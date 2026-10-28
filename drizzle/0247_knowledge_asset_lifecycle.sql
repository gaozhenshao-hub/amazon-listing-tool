ALTER TABLE kb_image_sets ADD COLUMN recycleId varchar(36) NULL, ADD KEY kb_set_recycle (workspaceId,recycleId);
ALTER TABLE kb_images ADD COLUMN recycleId varchar(36) NULL, ADD KEY kb_image_recycle (recycleId,imageSetId);
ALTER TABLE kb_videos ADD COLUMN recycleId varchar(36) NULL, ADD KEY kb_video_recycle (workspaceId,recycleId);

CREATE TABLE knowledge_recycle_bin (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  deletedBy int NOT NULL,
  kind enum('set','image','video') NOT NULL,
  targetId int NOT NULL,
  parentSetId int NULL,
  title varchar(512) NOT NULL,
  itemCount int NOT NULL,
  deletedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY kb_recycle_workspace (workspaceId,deletedAt)
);

CREATE TABLE knowledge_adjustments (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  kind enum('image','video') NOT NULL,
  targetId int NOT NULL,
  revision int NOT NULL DEFAULT 0,
  state varchar(20) NOT NULL DEFAULT 'open',
  payload json NOT NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY kb_adjustment_scope (workspaceId,userId,state)
);

CREATE TABLE knowledge_tag_improvements (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  visibility enum('private','team') NOT NULL,
  kind enum('image','video') NOT NULL,
  content json NOT NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY kb_improvement_scope (workspaceId,kind,createdAt)
);

CREATE TABLE knowledge_object_cleanup (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  workspaceId int NOT NULL,
  reference varchar(1024) NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'pending',
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY kb_cleanup_state (state,id)
);
