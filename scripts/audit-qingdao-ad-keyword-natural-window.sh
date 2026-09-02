#!/usr/bin/env bash
set -euo pipefail

# 仅供青岛生产环境一次性自然窗口验收使用。
# 此脚本不调用领星、不修改数据库，仅写入脱敏聚合审计快照。
app_dir="/opt/amazon-listing-tool"
audit_dir="${app_dir}/.manus-audits"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="${audit_dir}/ad-keyword-natural-window-${timestamp}.txt"

install -d -m 0750 "${audit_dir}"
umask 077

{
  echo "captured_at_utc=$(date -u +%FT%TZ)"
  echo "captured_at_beijing=$(TZ=Asia/Shanghai date +%FT%T%z)"
  echo "-- services --"
  systemctl show amazon-listing-web.service amazon-listing-worker.service amazon-listing-scheduler.service amz-ad-keyword-backfill.service \
    -p Id -p ActiveState -p SubState -p Result --no-pager
  echo "-- active_backfill_node_count --"
  ps -C node -o args= | awk '/run-qingdao-lingxing-backfill/ {count++} END {print count+0}'
  echo "-- ad_daily_task --"
  mysql --batch --skip-column-names amz_listing -e "
    SELECT isActive, nextRunAt, lastRunAt, lastRunStatus, runCount
    FROM emperor_scheduled_tasks
    WHERE workspaceId=1 AND dataDomain='ad_keyword';"
  echo "-- batch_status --"
  mysql --batch --skip-column-names amz_listing -e "
    SELECT status, COUNT(*)
    FROM ops_external_sync_batches
    WHERE workspaceId=1 AND data_domain='ad_keyword'
    GROUP BY status
    ORDER BY status;"
  echo "-- row_status --"
  mysql --batch --skip-column-names amz_listing -e "
    SELECT r.row_status, COUNT(*)
    FROM ops_external_sync_rows r
    JOIN ops_external_sync_batches b ON b.id=r.batch_id
    WHERE b.workspaceId=1 AND b.data_domain='ad_keyword'
    GROUP BY r.row_status
    ORDER BY r.row_status;"
  echo "-- applied_scope_coverage --"
  mysql --batch --skip-column-names amz_listing -e "
    SELECT MIN(JSON_UNQUOTE(JSON_EXTRACT(scope,'$.startDate'))),
           MAX(JSON_UNQUOTE(JSON_EXTRACT(scope,'$.endDate'))),
           COUNT(*)
    FROM ops_external_sync_batches
    WHERE workspaceId=1 AND data_domain='ad_keyword' AND status='applied';"
} > "${output_file}"

printf '%s\n' "${output_file}"
