CREATE TABLE IF NOT EXISTS design_material_projects (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  name varchar(180) NOT NULL,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX design_material_project_owner (workspaceId,userId,updatedAt)
);
CREATE TABLE IF NOT EXISTS design_material_files (
  id varchar(36) PRIMARY KEY,
  workspaceId int NOT NULL,
  userId int NOT NULL,
  projectId varchar(36) NULL,
  name varchar(180) NOT NULL,
  mime varchar(100) NOT NULL,
  bytes bigint unsigned NOT NULL,
  sha256 varchar(64) NOT NULL,
  storageName varchar(50) NOT NULL,
  revision int NOT NULL DEFAULT 1,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deletedAt datetime(3) NULL,
  INDEX design_material_location (workspaceId,projectId,deletedAt,createdAt),
  INDEX design_material_owner (workspaceId,userId),
  INDEX design_material_duplicate (workspaceId,projectId,sha256)
);
