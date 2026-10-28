CREATE TABLE IF NOT EXISTS design_conversations (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  title varchar(120) NOT NULL DEFAULT '新对话',
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deletedAt datetime(3) NULL,
  INDEX design_conversation_owner (workspaceId,userId,deletedAt,updatedAt)
);
CREATE TABLE IF NOT EXISTS design_generations (
  id varchar(36) PRIMARY KEY,
  conversationId varchar(36) NOT NULL,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  requestId varchar(36) NOT NULL,
  prompt text NOT NULL,
  params json NOT NULL,
  referenceIds json NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'queued',
  providerId int NULL,
  providerTaskId varchar(120) NULL,
  assetIds json NULL,
  usageInfo json NULL,
  errorText varchar(500) NULL,
  progress int NOT NULL DEFAULT 0,
  leaseToken varchar(36) NULL,
  leaseUntil datetime(3) NULL,
  nextPollAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  submittedAt datetime(3) NULL,
  finishedAt datetime(3) NULL,
  deletedAt datetime(3) NULL,
  UNIQUE KEY design_request_once (workspaceId,userId,requestId),
  INDEX design_turn_history (conversationId,createdAt,id),
  INDEX design_worker_queue (status,nextPollAt,leaseUntil)
);
CREATE TABLE IF NOT EXISTS design_assets (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  kind varchar(16) NOT NULL,
  name varchar(180) NOT NULL,
  mime varchar(40) NOT NULL,
  bytes int NOT NULL,
  sha256 char(64) NOT NULL,
  fileName varchar(48) NOT NULL,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX design_asset_owner (workspaceId,userId)
);
UPDATE role_permissions SET modules=JSON_ARRAY_APPEND(modules,'$','design')
WHERE role IN ('super_admin','admin','designer') AND JSON_VALID(modules)
AND JSON_CONTAINS(modules,JSON_QUOTE('design'))=0;
