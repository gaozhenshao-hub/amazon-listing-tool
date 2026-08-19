#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" != "--confirm-restore" ]]; then
  echo "Usage: restore-mysql.sh <oss-object-key> --confirm-restore" >&2
  echo "This command replaces the target database. Stop web, worker and scheduler first." >&2
  exit 2
fi

for name in MYSQL_HOST MYSQL_DATABASE MYSQL_ROOT_PASSWORD S3_BUCKET S3_ENDPOINT BACKUP_ENCRYPTION_KEY; do
  [[ -n "${!name:-}" ]] || { echo "[FAIL] Missing required environment variable: ${name}" >&2; exit 1; }
done

object_key="$1"
work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT
encrypted_path="${work_dir}/restore.sql.gz.enc"
archive_path="${work_dir}/restore.sql.gz"
endpoint_args=(--endpoint-url "${S3_ENDPOINT}")

echo "[WARN] Replacing database ${MYSQL_DATABASE} from ${object_key}"
aws s3 cp "s3://${S3_BUCKET}/${object_key}" "${encrypted_path}" "${endpoint_args[@]}" --only-show-errors
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${encrypted_path}" \
  -out "${archive_path}"
gzip -t "${archive_path}"

export MYSQL_PWD="${MYSQL_ROOT_PASSWORD}"
mysql --protocol=TCP --host="${MYSQL_HOST}" --user=root \
  -e "DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`; CREATE DATABASE \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
gzip -dc "${archive_path}" | mysql --protocol=TCP --host="${MYSQL_HOST}" --user=root "${MYSQL_DATABASE}"
unset MYSQL_PWD

echo "[PASS] Database restore completed. Run migrations and application health checks before reopening traffic."
