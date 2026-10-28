CREATE TABLE IF NOT EXISTS design_prompt_library (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  title varchar(120) NOT NULL,
  category varchar(40) NOT NULL,
  prompt text NOT NULL,
  notes text NOT NULL,
  params json NOT NULL,
  sourceGenerationId varchar(36) NULL,
  exampleAssetId varchar(36) NULL,
  revision int NOT NULL DEFAULT 1,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deletedAt datetime(3) NULL,
  UNIQUE KEY design_prompt_source (workspaceId,userId,sourceGenerationId),
  INDEX design_prompt_workspace (workspaceId,deletedAt,updatedAt)
);
