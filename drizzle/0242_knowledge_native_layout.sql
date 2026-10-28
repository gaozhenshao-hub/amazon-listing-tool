ALTER TABLE kb_image_sets ADD COLUMN sourceLayout JSON NULL;
ALTER TABLE kb_images ADD COLUMN sourceUrlHash VARCHAR(64) NULL;
CREATE INDEX kb_images_set_order_idx ON kb_images (imageSetId, positionIndex, id);
CREATE INDEX kb_sets_workspace_updated_idx ON kb_image_sets (workspaceId, updatedAt, id);
ALTER TABLE kb_images ADD COLUMN thumbnailUrl VARCHAR(1024) NULL;
ALTER TABLE acquisition_asset_candidates ADD COLUMN thumbnail_storage_key VARCHAR(1024) NULL;
