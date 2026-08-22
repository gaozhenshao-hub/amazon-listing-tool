-- P1 direct Skill recovery protocol: forward-only state metadata.
ALTER TABLE emperor_skill_runs
  ADD COLUMN stateVersion INT NOT NULL DEFAULT 0,
  ADD COLUMN recoverySnapshotId VARCHAR(80) NULL;

CREATE INDEX idx_emperor_skill_runs_recovery_snapshot
  ON emperor_skill_runs (recoverySnapshotId);
