#!/usr/bin/env bash
set -euo pipefail

# Read-only preflight check. It does not run migrations, start containers,
# modify firewall rules, or write secrets.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"
COMPOSE_FILE="${DEPLOY_DIR}/compose.yaml"
CHECK_HEALTH=false

for argument in "$@"; do
  case "${argument}" in
    --check-health)
      CHECK_HEALTH=true
      ;;
    *)
      ENV_FILE="${argument}"
      ;;
  esac
done

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

pass() {
  echo "[PASS] $*"
}

command -v docker >/dev/null 2>&1 || fail "Docker Engine is not installed"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
pass "Docker Engine and Compose plugin are available"

[[ -f "${ENV_FILE}" ]] || fail "Environment file not found: ${ENV_FILE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found: ${COMPOSE_FILE}"

required_keys=(
  DATABASE_URL
  MYSQL_DATABASE
  MYSQL_APP_USER
  MYSQL_APP_PASSWORD
  MYSQL_ROOT_PASSWORD
  JWT_SECRET
  AUTH_MODE
  VITE_AUTH_MODE
  STORAGE_PROVIDER
  S3_ENDPOINT
  S3_PUBLIC_ENDPOINT
  S3_BUCKET
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  LLM_PROVIDER
  EXTERNAL_LLM_BASE_URL
  EXTERNAL_LLM_API_KEY
  EXTERNAL_LLM_MODEL
  BACKUP_ENCRYPTION_KEY
  BACKUP_OSS_PREFIX
  BACKUP_RETENTION_DAYS
)

for key in "${required_keys[@]}"; do
  grep -qE "^${key}=.+" "${ENV_FILE}" || fail "Missing required key: ${key}"
done

grep -q '^AUTH_MODE=local$' "${ENV_FILE}" || fail "AUTH_MODE must be local for independent deployment"
grep -q '^VITE_AUTH_MODE=local$' "${ENV_FILE}" || fail "VITE_AUTH_MODE must be local for independent deployment"
grep -q '^STORAGE_PROVIDER=oss$' "${ENV_FILE}" || fail "STORAGE_PROVIDER must be oss for the selected Aliyun design"
grep -q '^LLM_PROVIDER=external$' "${ENV_FILE}" || fail "LLM_PROVIDER must be external for the selected model gateway design"
grep -qE '^DATABASE_URL=mysql://[^@]+@mysql:3306/.+' "${ENV_FILE}" || fail "DATABASE_URL must target the private mysql Compose service on port 3306"
grep -qE '^S3_ENDPOINT=https://oss-[a-z0-9-]+-internal\.aliyuncs\.com$' "${ENV_FILE}" || fail "S3_ENDPOINT must use an Aliyun internal OSS endpoint for ECS service traffic"
grep -qE '^S3_PUBLIC_ENDPOINT=https://oss-[a-z0-9-]+\.aliyuncs\.com$' "${ENV_FILE}" || fail "S3_PUBLIC_ENDPOINT must use an Aliyun public OSS endpoint for browser presigned URLs"
! grep -qE 'REPLACE_WITH|CHANGE_ME|YOUR_LLM_GATEWAY|GENERATE_A_LONG' "${ENV_FILE}" || fail "Environment file still contains template placeholders"
backup_retention_days="$(sed -n 's/^BACKUP_RETENTION_DAYS=//p' "${ENV_FILE}" | tail -1)"
[[ "${backup_retention_days}" =~ ^[0-9]+$ ]] && (( backup_retention_days >= 7 )) || fail "BACKUP_RETENTION_DAYS must be an integer of at least 7"
pass "Independent authentication, OSS and external LLM settings are present"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config >/dev/null
pass "Compose configuration parses successfully"
[[ -f "${DEPLOY_DIR}/backup/Dockerfile" ]] || fail "MySQL backup image Dockerfile is missing"
[[ -x "${DEPLOY_DIR}/scripts/backup-mysql.sh" ]] || fail "MySQL backup script must be executable"
[[ -x "${DEPLOY_DIR}/scripts/restore-mysql.sh" ]] || fail "MySQL restore script must be executable"
pass "Single-node MySQL backup and restore assets are present"

if command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    if ss -ltn "sport = :${port}" | grep -q LISTEN; then
      echo "[WARN] Port ${port} is already occupied; review existing reverse proxy before deployment"
    else
      pass "Port ${port} is available"
    fi
  done
fi

if [[ "${CHECK_HEALTH}" == "true" ]]; then
  command -v curl >/dev/null 2>&1 || fail "curl is required for --check-health"
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/health >/dev/null || fail "Health endpoint is not reachable"
  pass "Existing web health endpoint is reachable"
fi

echo "Preflight completed. No database migration, container startup, firewall change, or DNS change was performed."
