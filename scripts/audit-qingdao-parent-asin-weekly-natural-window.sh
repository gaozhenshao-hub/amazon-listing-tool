#!/usr/bin/env bash
set -euo pipefail

# One-shot audit for the natural parent-ASIN weekly MCP schedule.
# It intentionally issues no LingXing request and performs no application writes.

OUT_DIR="/var/log/amazon-listing-tool"
OUT_FILE="${OUT_DIR}/parent-asin-weekly-mcp-natural-window-audit-2026-09-07.json"
TMP_FILE="${OUT_FILE}.tmp"

mkdir -p "${OUT_DIR}"

json_escape() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'
}

service_state() {
  systemctl is-active "$1" 2>/dev/null || true
}

task_summary=$(mysql --batch --skip-column-names amz_listing <<'SQL' | json_escape
SELECT CONCAT(
  '{"task_count":', COUNT(*),
  ',"active_count":', COALESCE(SUM(isActive = 1), 0),
  ',"auto_apply_count":', COALESCE(SUM(autoApply = 1), 0),
  ',"next_run_epoch":', COALESCE(MAX(nextRunAt), 0),
  '}'
) AS summary
FROM emperor_scheduled_tasks
WHERE externalScheduleId LIKE 'parent_asin_weekly_mcp:%';
SQL
)

batch_summary=$(mysql --batch --skip-column-names amz_listing <<'SQL' | json_escape
SELECT CONCAT(
  '{"batch_count":', COUNT(*),
  ',"applied_count":', COALESCE(SUM(status = 'applied'), 0),
  ',"review_count":', COALESCE(SUM(status = 'ready_for_review'), 0),
  ',"failed_count":', COALESCE(SUM(status = 'failed'), 0),
  '}'
) AS summary
FROM ops_external_sync_batches
WHERE data_domain = 'parent_asin_weekly_mcp';
SQL
)

fact_summary=$(mysql --batch --skip-column-names amz_listing <<'SQL' | json_escape
SELECT CONCAT(
  '{"fact_count":', COUNT(*),
  ',"complete_identity_count":', COALESCE(SUM(
    store_name IS NOT NULL AND store_name <> '' AND
    country IS NOT NULL AND country <> '' AND
    parent_asin IS NOT NULL AND parent_asin <> '' AND
    week_start_date IS NOT NULL AND week_end_date IS NOT NULL
  ), 0),
  ',"unique_identity_count":', COUNT(DISTINCT CONCAT_WS('|', store_name, country, parent_asin, week_start_date, week_end_date)),
  '}'
) AS summary
FROM lingxing_product_weekly
WHERE source_kind = 'lingxing_mcp_parent_asin_weekly';
SQL
)

cat >"${TMP_FILE}" <<EOF
{
  "generated_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "mode": "read_only_natural_window_audit",
  "services": {
    "web": "$(service_state amazon-listing-web.service)",
    "worker": "$(service_state amazon-listing-worker.service)",
    "scheduler": "$(service_state amazon-listing-scheduler.service)"
  },
  "parent_asin_weekly_mcp_task": ${task_summary:-"{}"},
  "parent_asin_weekly_mcp_batches": ${batch_summary:-"{}"},
  "parent_asin_weekly_mcp_facts": ${fact_summary:-"{}"}
}
EOF

mv "${TMP_FILE}" "${OUT_FILE}"
echo "audit_written=${OUT_FILE}"
