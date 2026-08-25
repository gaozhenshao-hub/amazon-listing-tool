-- P1 Plan recovery protocol: add forward-only concurrency and snapshot metadata.
ALTER TABLE emperor_conversation_plans
  ADD COLUMN stateVersion INT NOT NULL DEFAULT 0,
  ADD COLUMN recoverySnapshotId VARCHAR(80) NULL;

CREATE INDEX idx_emperor_conversation_plans_recovery_snapshot
  ON emperor_conversation_plans (recoverySnapshotId);
