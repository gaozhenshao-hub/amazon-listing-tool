-- Keep the independently deployed local scheduler and Emperor control plane on
-- the same existing LingXing schedule. This migration does not create a second
-- Heartbeat job and does not touch any weekly facts or sync batches.
INSERT INTO emperor_scheduled_tasks
  (slug, workspaceId, name, description, skillSlug, cronExpr, inputTemplate,
   isActive, triggerMode, systemManaged, dataDomain, externalScheduleId,
   externalTaskUid, managePath, lastBatchId, createdByUserId)
SELECT
  CONCAT('lingxing-sync-parent_asin_weekly_mcp-workspace-', s.workspaceId),
  s.workspaceId,
  '领星 · 父ASIN周报',
  '北京时间每周一16:10读取上一自然周领星MCP父ASIN周报；完整性校验通过后直接幂等追加周事实，冲突或异常阻断并保留审计',
  'internal.lingxing.read',
  s.cron_expression,
  JSON_OBJECT(
    'dataDomain', 'parent_asin_weekly_mcp',
    'externalTaskUid', s.schedule_cron_task_uid,
    'scheduleId', s.id,
    'autoApply', s.auto_apply = 1
  ),
  s.enabled,
  'heartbeat',
  1,
  'parent_asin_weekly_mcp',
  s.id,
  s.schedule_cron_task_uid,
  '/ops/lingxing-sync',
  s.last_batch_id,
  s.owner_user_id
FROM ops_lingxing_sync_schedules s
WHERE s.data_domain = 'parent_asin_weekly_mcp'
  AND s.schedule_cron_task_uid IS NOT NULL
  AND s.schedule_cron_task_uid <> ''
ON DUPLICATE KEY UPDATE
  workspaceId = VALUES(workspaceId),
  name = VALUES(name),
  description = VALUES(description),
  skillSlug = VALUES(skillSlug),
  cronExpr = VALUES(cronExpr),
  inputTemplate = VALUES(inputTemplate),
  isActive = VALUES(isActive),
  triggerMode = 'heartbeat',
  systemManaged = 1,
  dataDomain = VALUES(dataDomain),
  externalScheduleId = VALUES(externalScheduleId),
  externalTaskUid = VALUES(externalTaskUid),
  managePath = '/ops/lingxing-sync',
  lastBatchId = VALUES(lastBatchId),
  createdByUserId = VALUES(createdByUserId);
