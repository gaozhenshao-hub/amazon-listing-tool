-- Add lifecycle metadata only. Preserve all acquisition records and snapshot payloads.
ALTER TABLE acquisition_jobs
  ADD COLUMN ingested_set_id INT NULL,
  ADD COLUMN cache_expired_at TIMESTAMP NULL,
  ADD COLUMN cache_cleanup_requested_at TIMESTAMP NULL,
  ADD KEY idx_acq_cache_retention (consumer_type,status,cache_expired_at,completed_at),
  ADD KEY idx_acq_cache_set (workspace_id,ingested_set_id);
UPDATE acquisition_jobs j
JOIN acquisition_source_snapshots s ON s.job_id=j.id AND s.workspace_id=j.workspace_id
JOIN acquisition_confirmed_snapshots c ON c.snapshot_id=s.id AND c.workspace_id=j.workspace_id AND c.revision_id IS NULL
JOIN kb_image_sets k ON k.remote_id=c.id AND k.workspaceId=j.workspace_id AND k.origin_instance_id='unified_amazon_acquisition'
SET j.ingested_set_id=k.id WHERE j.consumer_type='kb_images' AND j.status='confirmed';
UPDATE acquisition_jobs j JOIN kb_image_sets k
  ON j.workspace_id=k.workspaceId AND j.consumer_ref LIKE CONCAT('kb-refresh:',k.id,':%')
SET j.ingested_set_id=k.id WHERE j.consumer_type='kb_images' AND j.status='confirmed' AND j.ingested_set_id IS NULL;
