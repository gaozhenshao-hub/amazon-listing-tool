-- The batch hash is separate from 0172 because the current MySQL-compatible
-- engine does not resolve a just-added column inside the same ALTER statement.
ALTER TABLE ops_asin_daily_snapshots
  ADD COLUMN source_batch_hash varchar(64) NULL AFTER source_store_id;
