-- P1 Agent recovery protocol: add only forward-compatible state metadata.
ALTER TABLE emperor_agent_runs
  ADD COLUMN stateVersion INT NOT NULL DEFAULT 0,
  ADD COLUMN recoverySnapshotId VARCHAR(80) NULL;

CREATE INDEX idx_emperor_agent_runs_recovery_snapshot
  ON emperor_agent_runs (recoverySnapshotId);
