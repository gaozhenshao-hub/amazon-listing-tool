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
  JWT_SECRET
  AUTH_MODE
  VITE_AUTH_MODE
  STORAGE_PROVIDER
  S3_ENDPOINT
  S3_BUCKET
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  LLM_PROVIDER
  EXTERNAL_LLM_BASE_URL
  EXTERNAL_LLM_API_KEY
  EXTERNAL_LLM_MODEL
)

for key in "${required_keys[@]}"; do
  grep -qE "^${key}=.+" "${ENV_FILE}" || fail "Missing required key: ${key}"
done

grep -q '^AUTH_MODE=local$' "${ENV_FILE}" || fail "AUTH_MODE must be local for independent deployment"
grep -q '^VITE_AUTH_MODE=local$' "${ENV_FILE}" || fail "VITE_AUTH_MODE must be local for independent deployment"
grep -q '^STORAGE_PROVIDER=oss$' "${ENV_FILE}" || fail "STORAGE_PROVIDER must be oss for the selected Aliyun design"
grep -q '^LLM_PROVIDER=external$' "${ENV_FILE}" || fail "LLM_PROVIDER must be external for the selected model gateway design"
! grep -qE 'REPLACE_WITH|CHANGE_ME|YOUR_LLM_GATEWAY|GENERATE_A_LONG' "${ENV_FILE}" || fail "Environment file still contains template placeholders"
pass "Independent authentication, OSS and external LLM settings are present"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config >/dev/null
pass "Compose configuration parses successfully"

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
