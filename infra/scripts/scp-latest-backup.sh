#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# Costra · 将最新备份 scp 到远程机器
# =============================================================================
# 用法：
#   ./scp-latest-backup.sh                     # 使用默认远程配置
#   ./scp-latest-backup.sh --host 10.0.0.1     # 指定远程主机
#   ./scp-latest-backup.sh --prefix manual     # 指定备份前缀（默认 scheduled）
#   ./scp-latest-backup.sh --dry-run           # 仅打印不执行
#
# 默认传输内容（与 backup-db.sh 产物对齐）：
#   - 最新的 scheduled-*.sql.gz（DB 备份）
#   - 最新的 scheduled-*.avatars.tar.gz（avatars 打包备份）
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BACKUP_DIR="${COSTRA_DATA}/backups"
REMOTE_USER="root"
REMOTE_HOST=""
REMOTE_DIR="/data/backups/"
REMOTE_PASS="${COSTRA_SCP_PASS:-}"
BACKUP_PREFIX="scheduled"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       REMOTE_HOST=$2; shift 2 ;;
    --user)       REMOTE_USER=$2; shift 2 ;;
    --remote-dir) REMOTE_DIR=$2; shift 2 ;;
    --prefix)     BACKUP_PREFIX=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -16
      exit 0
      ;;
    *) die "未知参数: $1" ;;
  esac
done

[[ -n "${REMOTE_HOST}" ]] || die "请指定 --host（远程机器 IP 或域名）"
require_cmd expect
if [[ "${DRY_RUN}" != "1" && -z "${REMOTE_PASS}" ]]; then
  die "请设置环境变量 COSTRA_SCP_PASS（远程机器密码）"
fi

# --- 查找最新备份文件 ---
find_latest() {
  local pattern=$1
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${pattern}" \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -1 \
    | sed 's/^[^ ]* //'
}

LATEST_SQL=$(find_latest "${BACKUP_PREFIX}-*.sql.gz")
LATEST_AVATARS=$(find_latest "${BACKUP_PREFIX}-*.avatars.tar.gz")

if [[ -z "${LATEST_SQL}" && -z "${LATEST_AVATARS}" ]]; then
  die "未找到任何备份文件（${BACKUP_DIR}/${BACKUP_PREFIX}-*.sql.gz / *.avatars.tar.gz）"
fi

# --- SCP 传输函数 ---
do_scp() {
  local file=$1
  local label=$2

  if [[ -z "${file}" ]]; then
    log_warn "${label} 备份不存在 · 跳过"
    return 0
  fi

  log_info "${label}: $(basename "${file}")"
  log_info "目标: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "scp -p ${file} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
    return 0
  fi

  expect -c "
    set timeout 60
    spawn scp -p ${file} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}
    expect {
      \"password:\" { send \"${REMOTE_PASS}\r\"; exp_continue }
      \"yes/no\"   { send \"yes\r\"; exp_continue }
      eof
    }
  " || die "${label} 传输失败"

  log_success "${label} 传输完成"
}

# --- 执行传输 ---
print_section_header "传输最新备份到 ${REMOTE_HOST}"

do_scp "${LATEST_SQL}" "DB 备份"
do_scp "${LATEST_AVATARS}" "Avatars 备份"

echo ""
if [[ "${DRY_RUN}" != "1" ]]; then
  log_success "全部传输完成"
else
  log_info "DRY-RUN 模式 · 未实际传输"
fi
exit 0
