ALTER TABLE emperor_scheduled_tasks
  ADD COLUMN workspaceId INT NULL,
  ADD COLUMN triggerMode ENUM('internal','heartbeat') NOT NULL DEFAULT 'internal',
  ADD COLUMN systemManaged INT NOT NULL DEFAULT 0,
  ADD COLUMN dataDomain VARCHAR(64) NULL,
  ADD COLUMN externalScheduleId INT NULL,
  ADD COLUMN externalTaskUid VARCHAR(65) NULL,
  ADD COLUMN managePath VARCHAR(255) NULL,
  ADD COLUMN lastBatchId INT NULL;

CREATE UNIQUE INDEX uk_emperor_scheduled_tasks_external_task_uid ON emperor_scheduled_tasks (externalTaskUid);
CREATE INDEX idx_emperor_scheduled_tasks_workspace_managed ON emperor_scheduled_tasks (workspaceId, systemManaged);

INSERT INTO emperor_scheduled_tasks (
  slug, workspaceId, name, description, skillSlug, cronExpr, inputTemplate, isActive,
  triggerMode, systemManaged, dataDomain, externalScheduleId, externalTaskUid, managePath,
  lastBatchId, lastRunAt, lastRunStatus, runCount, createdByUserId
)
SELECT
  CONCAT('lingxing-sync-', s.data_domain, '-workspace-', s.workspaceId),
  s.workspaceId,
  CASE s.data_domain
    WHEN 'product_performance_daily' THEN '领星 · 每日ASIN产品表现'
    WHEN 'fba_inventory' THEN '领星 · 每日FBA库存快照'
    WHEN 'ad_keyword' THEN '领星 · 每日广告关键词历史'
    WHEN 'parent_asin_weekly_rollup' THEN '领星 · 父ASIN周汇总草稿'
    ELSE CONCAT('领星 · ', s.data_domain)
  END,
  '由皇帝中台统一管理的领星官方MCP同步任务；实际读取仅经过受治理Tool Gateway。',
  'internal.lingxing.read',
  s.cron_expression,
  JSON_OBJECT('dataDomain', s.data_domain, 'externalTaskUid', s.schedule_cron_task_uid, 'scheduleId', s.id),
  s.enabled,
  'heartbeat', 1, s.data_domain, s.id, s.schedule_cron_task_uid, '/ops/lingxing-sync',
  s.last_batch_id, s.last_run_at,
  CASE WHEN s.last_status IN ('succeeded','failed','running') THEN s.last_status ELSE NULL END,
  0, s.owner_user_id
FROM ops_lingxing_sync_schedules s
WHERE s.schedule_cron_task_uid IS NOT NULL
ON DUPLICATE KEY UPDATE
  workspaceId = VALUES(workspaceId), name = VALUES(name), description = VALUES(description),
  skillSlug = VALUES(skillSlug), cronExpr = VALUES(cronExpr), inputTemplate = VALUES(inputTemplate),
  isActive = VALUES(isActive), triggerMode = VALUES(triggerMode), systemManaged = VALUES(systemManaged),
  dataDomain = VALUES(dataDomain), externalScheduleId = VALUES(externalScheduleId),
  externalTaskUid = VALUES(externalTaskUid), managePath = VALUES(managePath), lastBatchId = VALUES(lastBatchId),
  lastRunAt = VALUES(lastRunAt), lastRunStatus = VALUES(lastRunStatus), createdByUserId = VALUES(createdByUserId);
