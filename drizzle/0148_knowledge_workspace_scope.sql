-- 知识库核心记录的工作空间边界。历史记录归入现有默认工作空间 1。
ALTER TABLE kb_product_innovations ADD COLUMN workspaceId INT NOT NULL DEFAULT 1 AFTER userId;
ALTER TABLE kb_listing_copywriting ADD COLUMN workspaceId INT NOT NULL DEFAULT 1 AFTER userId;
ALTER TABLE kb_operation_skills ADD COLUMN workspaceId INT NOT NULL DEFAULT 1 AFTER userId;
ALTER TABLE kb_videos ADD COLUMN workspaceId INT NOT NULL DEFAULT 1 AFTER userId;
ALTER TABLE kb_image_sets ADD COLUMN workspaceId INT NOT NULL DEFAULT 1 AFTER userId;

CREATE INDEX idx_kb_product_innovations_workspace_status ON kb_product_innovations (workspaceId, status, updatedAt);
CREATE INDEX idx_kb_listing_copywriting_workspace_status ON kb_listing_copywriting (workspaceId, status, updatedAt);
CREATE INDEX idx_kb_operation_skills_workspace_status ON kb_operation_skills (workspaceId, status, updatedAt);
CREATE INDEX idx_kb_videos_workspace_status ON kb_videos (workspaceId, status, updatedAt);
CREATE INDEX idx_kb_image_sets_workspace_status ON kb_image_sets (workspaceId, status, updatedAt);
