#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" != "--confirm-restore" ]]; then
  echo "Usage: restore-mysql.sh <oss-object-key> --confirm-restore" >&2
  echo "This command replaces the target database. Stop web, worker and scheduler first." >&2
  exit 2
fi

for name in MYSQL_HOST MYSQL_DATABASE S3_BUCKET S3_ENDPOINT BACKUP_ENCRYPTION_KEY; do
  [[ -n "${!name:-}" ]] || { echo "[FAIL] Missing required environment variable: ${name}" >&2; exit 1; }
done

if [[ "${MYSQL_ROOT_SOCKET_AUTH:-false}" != "true" ]]; then
  [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || { echo "[FAIL] Missing required environment variable: MYSQL_ROOT_PASSWORD" >&2; exit 1; }
fi

object_key="$1"
work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT
encrypted_path="${work_dir}/restore.sql.gz.enc"
archive_path="${work_dir}/restore.sql.gz"
endpoint_args=(--endpoint-url "${S3_ENDPOINT}")
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

echo "[WARN] Replacing database ${MYSQL_DATABASE} from ${object_key}"
aws s3 cp "s3://${S3_BUCKET}/${object_key}" "${encrypted_path}" "${endpoint_args[@]}" --only-show-errors
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${encrypted_path}" \
  -out "${archive_path}"
gzip -t "${archive_path}"

mysql_root=(mysql --user=root)
if [[ "${MYSQL_ROOT_SOCKET_AUTH:-false}" == "true" ]]; then
  # mysql client honors MYSQL_HOST from the application environment before the
  # explicit socket protocol option. Clear it for local root socket recovery.
  unset MYSQL_HOST
  mysql_root+=(--protocol=socket)
else
  export MYSQL_PWD="${MYSQL_ROOT_PASSWORD}"
  mysql_root+=(--protocol=TCP "--host=${MYSQL_HOST}")
fi

"${mysql_root[@]}" \
  -e "DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`; CREATE DATABASE \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
gzip -dc "${archive_path}" | "${mysql_root[@]}" "${MYSQL_DATABASE}"
unset MYSQL_PWD || true

echo "[PASS] Database restore completed. Run migrations and application health checks before reopening traffic."
