-- Legacy advertising uploads were created before workspace isolation.
-- Assign only records with no scope to the owning user's current default workspace.
-- Metrics and advertising operation fields remain unchanged.
UPDATE ad_campaign_reports r
INNER JOIN users u ON u.id = r.user_id
SET r.workspaceId = u.defaultWorkspaceId
WHERE r.workspaceId IS NULL
  AND u.defaultWorkspaceId IS NOT NULL;

UPDATE ad_keyword_weekly r
INNER JOIN users u ON u.id = r.user_id
SET r.workspaceId = u.defaultWorkspaceId
WHERE r.workspaceId IS NULL
  AND u.defaultWorkspaceId IS NOT NULL;
