#!/usr/bin/env bash
set -euo pipefail

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { echo "[FAIL] Missing required environment variable: ${name}" >&2; exit 1; }
}

for name in MYSQL_HOST MYSQL_DATABASE MYSQL_APP_USER MYSQL_APP_PASSWORD S3_BUCKET S3_ENDPOINT S3_REGION BACKUP_ENCRYPTION_KEY; do
  require_value "${name}"
done

retention_days="${BACKUP_RETENTION_DAYS:-14}"
[[ "${retention_days}" =~ ^[0-9]+$ ]] && (( retention_days >= 7 )) || {
  echo "[FAIL] BACKUP_RETENTION_DAYS must be an integer of at least 7" >&2
  exit 1
}

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_prefix="${BACKUP_OSS_PREFIX:-backups/mysql}"
backup_prefix="${backup_prefix#/}"
backup_prefix="${backup_prefix%/}"
dump_path="${work_dir}/${MYSQL_DATABASE}-${timestamp}.sql"
archive_path="${dump_path}.gz"
encrypted_path="${archive_path}.enc"
object_key="${backup_prefix}/${MYSQL_DATABASE}-${timestamp}.sql.gz.enc"

export MYSQL_PWD="${MYSQL_APP_PASSWORD}"
echo "[INFO] Creating consistent logical MySQL backup for ${MYSQL_DATABASE}"
mysqldump \
  --protocol=TCP \
  --host="${MYSQL_HOST}" \
  --user="${MYSQL_APP_USER}" \
  --single-transaction \
  --routines \
  --events \
  --triggers \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  "${MYSQL_DATABASE}" > "${dump_path}"
unset MYSQL_PWD

gzip -9 "${dump_path}"
openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${archive_path}" \
  -out "${encrypted_path}"
sha256sum "${encrypted_path}" > "${encrypted_path}.sha256"

endpoint_args=(--endpoint-url "${S3_ENDPOINT}")
echo "[INFO] Uploading encrypted backup to private OSS: ${object_key}"
aws s3 cp "${encrypted_path}" "s3://${S3_BUCKET}/${object_key}" "${endpoint_args[@]}" --only-show-errors
aws s3 cp "${encrypted_path}.sha256" "s3://${S3_BUCKET}/${object_key}.sha256" "${endpoint_args[@]}" --only-show-errors
aws s3api head-object --bucket "${S3_BUCKET}" --key "${object_key}" "${endpoint_args[@]}" >/dev/null

cutoff="$(date -u -d "-${retention_days} days" +%Y-%m-%dT%H:%M:%SZ)"
old_keys="$(aws s3api list-objects-v2 --bucket "${S3_BUCKET}" --prefix "${backup_prefix}/" "${endpoint_args[@]}" --query "Contents[?LastModified<=\`${cutoff}\`].Key" --output text || true)"
if [[ -n "${old_keys}" && "${old_keys}" != "None" ]]; then
  while IFS= read -r old_key; do
    [[ -z "${old_key}" ]] && continue
    aws s3api delete-object --bucket "${S3_BUCKET}" --key "${old_key}" "${endpoint_args[@]}" >/dev/null
    echo "[INFO] Deleted expired backup object: ${old_key}"
  done < <(tr '\t' '\n' <<< "${old_keys}")
fi

echo "[PASS] Encrypted backup verified in OSS: ${object_key}"
