#!/usr/bin/env bash
# scripts/lib/common.sh · Costra Analyze 公共函数库

if [[ -t 2 ]]; then
  _CLR_RESET='\033[0m'
  _CLR_BOLD='\033[1m'
  _CLR_BLUE='\033[0;34m'
  _CLR_GREEN='\033[0;32m'
  _CLR_YELLOW='\033[0;33m'
  _CLR_RED='\033[0;31m'
else
  _CLR_RESET='' _CLR_BOLD='' _CLR_BLUE='' _CLR_GREEN='' _CLR_YELLOW='' _CLR_RED=''
fi

log_step() { echo -e "${_CLR_BOLD}${_CLR_BLUE}==> $*${_CLR_RESET}" >&2; }
log_info() { echo -e "${_CLR_BLUE}    $*${_CLR_RESET}" >&2; }
log_warn() { echo -e "${_CLR_YELLOW}  ⚠ $*${_CLR_RESET}" >&2; }
log_success() { echo -e "${_CLR_GREEN}  ✓ $*${_CLR_RESET}" >&2; }
log_error() { echo -e "${_CLR_RED}  ✗ $*${_CLR_RESET}" >&2; }

die() {
  log_error "FATAL: $*"
  exit 1
}

require_env_file() {
  local env_file="$1"
  [[ -f "${env_file}" ]] || die "env 文件不存在: ${env_file} · 请参照 .env.example 创建并填写配置（0600）"
}

load_env() {
  local env_file="$1"
  while IFS= read -r line; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    local key val
    key="${line%%=*}"
    val="${line#*=}"
    if [[ "${val}" != *'"'* && "${val}" != *"'"* ]]; then
      val="${val%%#*}"
    fi
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    val="${val#\'}" ; val="${val%\'}"
    val="${val#\"}" ; val="${val%\"}"
    if [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "${key}=${val}"
    fi
  done < "${env_file}"
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || die "依赖命令不存在: ${cmd}"
}

psql_admin() {
  local sql="$1"
  psql -h "${PG_HOST:-postgres}" -U "${PG_USER}" -d "${PG_DB}" \
    -v ON_ERROR_STOP=1 \
    -c "${sql}"
}

psql_report() {
  local sql="$1"
  psql -h "${PG_HOST:-postgres}" -U "${PG_USER}" -d "${REPORT_DB}" \
    -v ON_ERROR_STOP=1 \
    -c "${sql}"
}

file_mtime_epoch() {
  local file="$1"
  if stat -c '%Y' "${file}" >/dev/null 2>&1; then
    stat -c '%Y' "${file}"
  else
    stat -f '%m' "${file}"
  fi
}

epoch_to_cst_iso() {
  local epoch="$1"
  node -e '
    const epoch = Number(process.argv[1]);
    if (!Number.isFinite(epoch)) process.exit(1);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(epoch * 1000));
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    process.stdout.write(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`);
  ' "${epoch}" || die "无法格式化 epoch: ${epoch}"
}

file_mtime_iso() {
  epoch_to_cst_iso "$(file_mtime_epoch "$1")"
}

iso_to_epoch() {
  local iso="$1"
  node -e '
    const ms = Date.parse(process.argv[1]);
    if (!Number.isFinite(ms)) process.exit(1);
    process.stdout.write(String(Math.floor(ms / 1000)));
  ' "${iso}" || die "无法解析日期: ${iso}"
}
