ALTER TABLE ops_lingxing_sync_schedules
  ADD COLUMN auto_apply TINYINT NOT NULL DEFAULT 0 AFTER enabled;
