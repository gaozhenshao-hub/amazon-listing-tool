-- Indexes follow the two independently-added provenance columns for compatibility.
ALTER TABLE ops_asin_daily_snapshots
  ADD KEY ops_asin_daily_source_identity_idx (workspaceId, source_store_id, country, asin, report_date),
  ADD KEY ops_asin_daily_batch_hash_idx (workspaceId, source_batch_hash);
