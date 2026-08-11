-- Round 6: backfill the explicit Agent binding contract for Jobs that already own a Checkpoint.

-- listingWorkflow was a short-lived module key that did not match the Listing history UI.
UPDATE `ai_jobs`
SET `module`='listing'
WHERE `module`='listingWorkflow';

UPDATE `ai_jobs` j
JOIN (
  SELECT `aiJobRunId`, MAX(`id`) AS `checkpointId`
  FROM `emperor_agent_checkpoints`
  WHERE `aiJobRunId` IS NOT NULL
  GROUP BY `aiJobRunId`
) latest ON latest.`aiJobRunId`=j.`runId`
JOIN `emperor_agent_checkpoints` c ON c.`id`=latest.`checkpointId`
SET j.`input`=JSON_SET(
  COALESCE(j.`input`, JSON_OBJECT()),
  '$.agentRunId', c.`runId`,
  '$.agentNodeId', c.`nodeId`
)
WHERE j.`module` IN (
  'adAnalysis','imageWorkflow','keywordWorkflow','listing',
  'operations','productDevelopment','videoScript'
)
AND (
  JSON_UNQUOTE(JSON_EXTRACT(j.`input`, '$.agentRunId')) IS NULL
  OR JSON_UNQUOTE(JSON_EXTRACT(j.`input`, '$.agentNodeId')) IS NULL
);
