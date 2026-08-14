#!/usr/bin/env bash
# scripts/analyze-in-container.sh · 容器内真实分析入口
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYZE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/parse-args.sh
source "${SCRIPT_DIR}/lib/parse-args.sh"

parse_args "$@"

# /app/.env 由宿主机 env 文件（默认 /data/conf/analytics.env）经 compose 单文件只读挂载而来
ENV_FILE="${ANALYZE_ROOT}/.env"
require_env_file "${ENV_FILE}"
load_env "${ENV_FILE}"

: "${DUMP_INBOX:?需要设置 DUMP_INBOX}"
: "${REPORTS_DIR:?需要设置 REPORTS_DIR}"
: "${PG_DB:?需要设置 PG_DB}"
: "${PG_USER:?需要设置 PG_USER}"
: "${PG_PASSWORD:?需要设置 PG_PASSWORD}"

PG_HOST="${PG_HOST:-postgres}"
REPORT_DB="${REPORT_DB:-costra_report_work}"
LOG_DIR="${LOG_DIR:-${ANALYZE_ROOT}/logs}"
RUN_ID="run_$(date +%s)_$$"
TMP_DIR="/tmp/costra-analyze/${RUN_ID}"
LOG_FILE="${LOG_DIR}/run-$(date +%Y%m%d-%H%M%S)-$$.log"

export PG_HOST REPORT_DB RUN_ID TMP_DIR LOG_DIR LOG_FILE PGPASSWORD="${PG_PASSWORD}"

mkdir -p "${LOG_DIR}" "${REPORTS_DIR}" "${TMP_DIR}"
: > "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

require_cmd node
require_cmd gzip
require_cmd psql

cleanup() {
  set +e
  psql_admin "DROP DATABASE IF EXISTS ${REPORT_DB} WITH (FORCE);" >/dev/null 2>&1 || true
  [[ ! -d "${TMP_DIR}" ]] || rm -rf "${TMP_DIR}"
}

on_error() {
  local exit_code="$1" line_no="$2"
  trap - ERR INT TERM
  set +e
  log_error "脚本在第 ${line_no} 行失败，退出码: ${exit_code}"
  node "${SCRIPT_DIR}/send-failure-mail.mjs" \
    --exit-code "${exit_code}" --line "${line_no}" \
    --log-file "${LOG_FILE}" --database "${REPORT_DB}" \
    --dump "${DUMP_FILE:-UNKNOWN}" \
    || log_warn "失败告警邮件发送失败"
  cleanup
  exit "${exit_code}"
}

on_signal() {
  trap - ERR INT TERM
  log_warn "收到 ${1}，清理后退出"
  cleanup
  exit 130
}

trap 'on_error $? $LINENO' ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

log_step "[1/6] 选定 dump 文件"
# shellcheck source=pick-dump.sh
source "${SCRIPT_DIR}/pick-dump.sh"
pick_dump
if [[ "${NO_DUMP:-0}" == "1" ]]; then
  exit 0
fi

log_info "dump 文件: ${DUMP_FILE}"
log_info "dump mtime: ${DUMP_MTIME_ISO}"

if [[ -z "${ANCHOR_ISO}" ]]; then
  ANCHOR_ISO="${DUMP_MTIME_ISO}"
  log_info "anchor（从 dump mtime 派生）: ${ANCHOR_ISO}"
else
  log_info "anchor（手动指定）: ${ANCHOR_ISO}"
fi

ANCHOR_EPOCH=$(iso_to_epoch "${ANCHOR_ISO}")
WINDOW_SEC=$(( WINDOW_MS / 1000 ))
WINDOW_START_ISO=$(epoch_to_cst_iso $(( ANCHOR_EPOCH - WINDOW_SEC )))
WINDOW_END_ISO=$(epoch_to_cst_iso "${ANCHOR_EPOCH}")
export ANCHOR_ISO WINDOW_START_ISO WINDOW_END_ISO WINDOW_MS WINDOW_SEC

log_info "分析窗口: ${WINDOW_START_ISO} → ${WINDOW_END_ISO}（${WINDOW_STR}）"

log_step "[2/6] 重建分析数据库 ${REPORT_DB}"
"${SCRIPT_DIR}/restore-database.sh"

log_step "[3/6] 跑 SQL 查询"
"${SCRIPT_DIR}/run-queries.sh"

log_step "[4/6] 渲染 markdown 报告"
REPORT_OUT_PATH=$(node "${SCRIPT_DIR}/render.mjs" \
  --tmp "${TMP_DIR}" \
  --anchor "${ANCHOR_ISO}" \
  --window-ms "${WINDOW_MS}" \
  --dump-mtime "${DUMP_MTIME_ISO}" \
  --reports-dir "${REPORTS_DIR}" \
  --get-path-only)

mkdir -p "$(dirname "${REPORT_OUT_PATH}")"
node "${SCRIPT_DIR}/render.mjs" \
  --tmp "${TMP_DIR}" \
  --anchor "${ANCHOR_ISO}" \
  --window-ms "${WINDOW_MS}" \
  --dump-mtime "${DUMP_MTIME_ISO}" \
  --reports-dir "${REPORTS_DIR}" \
  --out "${REPORT_OUT_PATH}"

log_info "报告路径: ${REPORT_OUT_PATH}"

log_step "[5/6] 发送邮件 / 输出"
if [[ "${STDOUT_MODE}" == "1" || "${MAIL_TO:-}" == PLACEHOLDER* ]]; then
  log_info "→ stdout 模式"
  echo ""
  cat "${REPORT_OUT_PATH}"
  echo ""
else
  node "${SCRIPT_DIR}/send-mail.mjs" \
    --report "${REPORT_OUT_PATH}" \
    --subject-file "${TMP_DIR}/subject.txt"
fi

log_step "[6/6] 清理"
cleanup

log_success "完成 · 输出: ${REPORT_OUT_PATH}"
