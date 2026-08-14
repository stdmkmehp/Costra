#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §3.3 建持久化目录 + 关键 chown
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §3.3
#
# v1.5.1 实测踩坑：宿主机 root 创建的目录 owner 是 root · 但 redis 容器内进程
# 是 redis 用户（uid=999）· 写不进日志 → fatal exit · 反复 restart 17 次。
# 本脚本一把梭做完 mkdir + chown · 杜绝该坑。
#
# 用法：
#   ./02-prepare-dirs.sh           # 标准跑
#   ./02-prepare-dirs.sh --dry-run # 只打印不执行
#   ./02-prepare-dirs.sh -y        # 跳过确认
#
# 退出码：
#   0 = 全部目录就绪 + owner 验证通过
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | head -25
      exit 0
      ;;
    *) die "未知参数: $1" ;;
  esac
done

require_root

# =============================================================================
# 主流程
# =============================================================================
print_section_header "02 · 建持久化目录 + chown（§3.3）"

# --- Step 1: 建目录 ---
log_step "[1/3] 建持久化目录树"

DIRS_TO_CREATE=(
  "${COSTRA_DATA}/conf"
  "${COSTRA_DATA}/pgsql"
  "${COSTRA_DATA}/redis"
  "${COSTRA_DATA}/logs/postgres"
  "${COSTRA_DATA}/logs/redis"
  "${COSTRA_DATA}/logs/server"
  "${COSTRA_DATA}/logs/nginx"
  "${COSTRA_DATA}/certbot/www"
  "${COSTRA_DATA}/backups"
  "${COSTRA_DATA}/uploads/avatars"
)

for dir in "${DIRS_TO_CREATE[@]}"; do
  if [[ -d "${dir}" ]]; then
    log_info "已存在：${dir}"
  else
    run_cmd mkdir -p "${dir}"
    log_success "已创建：${dir}"
  fi
done

# 严格权限：conf 和 backups 仅 root 可读（含密码 / DB dump 可能含敏感数据）
run_cmd chmod 0700 "${COSTRA_DATA}/conf" "${COSTRA_DATA}/backups"

# --- Step 2: chown（v1.5.1 关键 · 修坑 3） ---
log_step "[2/3] 设置 owner（容器内进程 uid 与宿主机不一致）"

# uid=999 → redis 容器内进程（redis:7-alpine）
RUN_AS_999=(
  "${COSTRA_DATA}/redis"
  "${COSTRA_DATA}/logs/redis"
)

# uid=70 → postgres 容器内进程（postgres:15-alpine · debian 变体是 999 · 见 common.sh）。
# logging_collector 会把 PG 日志写入该目录，owner 必须与容器进程一致。
RUN_AS_70=(
  "${COSTRA_DATA}/logs/postgres"
)

# uid=1000 → server 容器（node 用户 · Dockerfile USER node）
RUN_AS_1000=(
  "${COSTRA_DATA}/logs/server"
  "${COSTRA_DATA}/uploads"
)

log_info "chown ${UID_REDIS}:${UID_REDIS} → ${RUN_AS_999[*]}"
run_cmd chown -R "${UID_REDIS}:${UID_REDIS}" "${RUN_AS_999[@]}"

log_info "chown ${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE} → ${RUN_AS_70[*]}"
run_cmd chown -R "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" "${RUN_AS_70[@]}"

log_info "chown ${UID_NODE}:${UID_NODE} → ${RUN_AS_1000[*]}"
run_cmd chown -R "${UID_NODE}:${UID_NODE}" "${RUN_AS_1000[@]}"

log_info "/data/pgsql 不动（PG entrypoint 自动 chown）· /data/logs/nginx 不动（nginx root）"

# --- Step 3: 验证 owner ---
log_step "[3/3] 验证 owner（如有 root:root 立即报错）"

# _verify_owner <uid> <dir...>: 校验目录 owner 是否等于给定 uid，失败计入全局 VERIFY_FAIL
_verify_owner() {
  local uid=$1
  shift
  local dir owner
  for dir in "$@"; do
    owner=$(stat -c '%u:%g' "${dir}" 2>/dev/null || echo "missing")
    if [[ "${owner}" == "${uid}:${uid}" ]]; then
      log_success "  ${dir} owner=${owner} ✓"
    else
      log_error "  ${dir} owner=${owner}（期望 ${uid}:${uid}）"
      VERIFY_FAIL=$((VERIFY_FAIL + 1))
    fi
  done
}

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "（dry-run 模式跳过验证）"
else
  VERIFY_FAIL=0
  _verify_owner "${UID_REDIS}" "${RUN_AS_999[@]}"
  _verify_owner "${UID_POSTGRES_ALPINE}" "${RUN_AS_70[@]}"
  _verify_owner "${UID_NODE}" "${RUN_AS_1000[@]}"

  if [[ "${VERIFY_FAIL}" -gt 0 ]]; then
    log_error "${VERIFY_FAIL} 个目录 owner 不正确 · 请检查权限或重跑"
    exit 1
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "持久化目录就绪 · 可以进入 §3.4 (03-generate-env.sh)"
exit 0
