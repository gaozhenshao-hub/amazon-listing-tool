-- Preserve the official LingXing store identity and batch hash on immutable ASIN-day snapshots.
-- This is an additive migration: existing Excel snapshots remain untouched and simply have NULL provenance.
ALTER TABLE ops_asin_daily_snapshots
  ADD COLUMN source_store_id varchar(64) NULL AFTER source_type;
