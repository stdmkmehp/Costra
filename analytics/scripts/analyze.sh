#!/usr/bin/env bash
# scripts/analyze.sh · 宿主机薄 wrapper
# 宿主机只负责启动独立 compose 并进入 analyzer 容器执行真正分析。
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYZE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${ANALYZE_ROOT}/.env"
require_env_file "${ENV_FILE}"
load_env "${ENV_FILE}"

: "${DUMP_INBOX:?需要设置 DUMP_INBOX}"
: "${REPORTS_DIR:?需要设置 REPORTS_DIR}"
LOG_DIR="${LOG_DIR:-${ANALYZE_ROOT}/logs}"

mkdir -p "${DUMP_INBOX}" "${REPORTS_DIR}" "${LOG_DIR}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "依赖命令不存在: docker compose 或 docker-compose"
  fi
}

cd "${ANALYZE_ROOT}"
compose up -d --build postgres analyzer
compose exec -T analyzer bash /app/scripts/analyze-in-container.sh "$@"
