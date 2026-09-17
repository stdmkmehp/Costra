#!/usr/bin/env bash
# scripts/run-queries.sh · 按显式清单执行 SQL 查询
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYZE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

: "${REPORT_DB:?缺少 REPORT_DB}"
: "${TMP_DIR:?缺少 TMP_DIR}"
: "${WINDOW_START_ISO:?缺少 WINDOW_START_ISO}"
: "${WINDOW_END_ISO:?缺少 WINDOW_END_ISO}"
: "${PG_HOST:?缺少 PG_HOST}"
: "${PG_USER:?缺少 PG_USER}"
: "${PGPASSWORD:?缺少 PGPASSWORD}"

SQL_FILES=(
  "10-summary"
  "20-new-users"
  "30-new-ledgers"
  "40-new-entries"
  "50-new-invites"
  "55-import-jobs"
  "56-export-jobs"
  "57-tip-orders"
  "60-active-users"
  "65-auto-only-users"
  "70-retention"
  "80-daily-trend"
  "90-anomaly"
)

SQL_DIR="${ANALYZE_ROOT}/sql"
[[ -d "${SQL_DIR}" ]] || die "sql/ 目录不存在: ${SQL_DIR}"

for name in "${SQL_FILES[@]}"; do
  sql_file="${SQL_DIR}/${name}.sql"
  [[ -f "${sql_file}" ]] || die "SQL 文件缺失: ${sql_file}（见 run-queries.sh 注释了解如何新增）"

  log_info "  → ${name}"
  psql -h "${PG_HOST}" -U "${PG_USER}" -d "${REPORT_DB}" \
    -v ON_ERROR_STOP=1 \
    -v "window_start=${WINDOW_START_ISO}" \
    -v "window_end=${WINDOW_END_ISO}" \
    --csv \
    < "${sql_file}" \
    > "${TMP_DIR}/${name}.csv"

  local_line_count=$(wc -l < "${TMP_DIR}/${name}.csv" | tr -d ' ')
  if [[ "${local_line_count}" -lt 1 ]]; then
    log_warn "  ⚠ ${name}.csv 为空（可能是正常的，窗口内无数据）"
  else
    log_info "    输出 ${local_line_count} 行（含表头）"
  fi
done

log_info "所有 ${#SQL_FILES[@]} 个 SQL 查询完成"
