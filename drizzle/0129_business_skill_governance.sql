ALTER TABLE emperor_skill_runs
  ADD COLUMN skillVersion INT NULL AFTER skillName,
  ADD COLUMN skillPromptHash VARCHAR(64) NULL AFTER skillVersion,
  ADD COLUMN skillManifestHash VARCHAR(64) NULL AFTER skillPromptHash,
  ADD COLUMN migrationSource VARCHAR(255) NULL AFTER skillManifestHash,
  ADD COLUMN provider VARCHAR(64) NULL AFTER modelSlug;

ALTER TABLE emperor_model_providers
  ADD COLUMN costPer1kInputTokens DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER capabilityTags,
  ADD COLUMN costPer1kOutputTokens DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER costPer1kInputTokens,
  ADD COLUMN maxContextTokens INT NOT NULL DEFAULT 128000 AFTER costPer1kOutputTokens;

CREATE INDEX idx_emperor_skill_runs_skill_version_created
  ON emperor_skill_runs (skillSlug, skillVersion, createdAt);

CREATE INDEX idx_emperor_skill_runs_workspace_status_created
  ON emperor_skill_runs (workspaceId, status, createdAt);
