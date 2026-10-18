-- CANDIDATE ONLY. Not registered, executed, or treated as physical approval.
-- Non-unique indexes support complete keyset windows and DB-persisted fairness.
CREATE INDEX ops_saihu_capture_due_idx ON ai_jobs(kind,projectId,status,workspaceId,id,leaseUntil);
CREATE INDEX ops_saihu_capture_served_idx ON ai_jobs(kind,projectId,workspaceId,startedAt);
CREATE INDEX ops_saihu_daily_history_idx ON ops_saihu_daily_report_batches(workspace_id,id);
CREATE INDEX ops_saihu_schedule_fair_idx ON ops_saihu_report_schedules(workspace_id,status,updated_at,next_run_at,plan_id);
