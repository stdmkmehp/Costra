#!/usr/bin/env bash
# =============================================================================
# Costra · 用 prod 最新备份刷新 staging 数据（仅机器②）
# =============================================================================
# 适用场景：staging 需要一份与 prod 一致的真实数据（联调 / 排查 / 数据变更验证）。
#
# 数据源（只读）：/data/slave/backups（机器② 本地）
#   standby-YYYYMMDD-HHMMSS.sql.gz            从库每 6h pg_dump（= prod 数据）
#   文件名时间戳定长 · 字典序即时间序 · 自动取最新一份。
#
# 头像归档（scheduled-*.avatars.tar.gz）段已于 2026-10-17 随头像 COS 化移除
# （cos-offload-phase2-avatar §9.3）：staging 库恢复后头像 URL 指向 prod 头像桶
# （公有读 · 可正常显示），staging 自己新上传的进 staging 桶，无需文件级同步。
#
# 恢复目标 = 本机 staging 栈（project costra · stg.costra.cloud）：
#   1. costra-redis          ← FLUSHALL（旧 session/缓存与恢复后的数据不匹配 · 随 DB 恢复）
#   2. costra-postgres       ← 委托 restore-db.sh（清空 → 单事务恢复 → 重启 server）
#
# 用法：
#   ./restore-staging-from-prod.sh                    # 自动取最新 standby-*.sql.gz 恢复 DB
#   ./restore-staging-from-prod.sh --dry-run          # 仅打印不执行（不带 -y 时 restore-db.sh 仍会确认）
#   ./restore-staging-from-prod.sh -y                 # 全链路自动确认（透传 restore-db.sh · 无人值守）
#
# 注：本脚本只做"自动取最新"；要恢复指定备份文件，直接用 restore-db.sh。
#
# 红线：
#   - 仅允许在机器② 运行（防呆：本机必须存在 costra-standby-pg 容器）；
#     机器① 的 costra-postgres 是 prod 主库，误跑等于清空 prod。
#   - 备份文件只读 · 绝不写 /data/slave/backups（那是分析栈的 DUMP_INBOX）。
#
# 退出码：
#   0 = 成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BACKUP_DIR="/data/slave/backups"
SQL_FILE=""
REDIS_CONTAINER="costra-redis"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-y|--yes)
      shift   # common 已处理 · noop
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -34
      exit 0
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

require_root
require_cmd docker

# --- 防呆：仅机器②（staging/从库/分析机）允许运行 ---
# 机器② 必有 costra-standby-pg 容器（stopped 也算 · 同 install-standby-cron.sh 防呆）；
# 机器①（prod）没有 → 误跑直接拒绝（那里的 costra-postgres 是 prod 主库）。
if ! docker inspect costra-standby-pg >/dev/null 2>&1; then
  die "本机无 costra-standby-pg 容器 · 本脚本只允许在机器②（staging/从库机）运行 · 机器① 的 costra-postgres 是 prod 主库"
fi

[[ -d "${BACKUP_DIR}" ]] || die "备份目录不存在：${BACKUP_DIR}"

# =============================================================================
# 定位备份文件（文件名时间戳定长 · LC_ALL=C 字典序 = 时间序 · 取最新）
# =============================================================================
SQL_FILE=$({ ls -1 "${BACKUP_DIR}"/standby-*.sql.gz 2>/dev/null || true; } | LC_ALL=C sort | tail -n 1)
[[ -n "${SQL_FILE}" ]] || die "未找到 standby-*.sql.gz（${BACKUP_DIR}）· 从库备份 cron 是否正常？"

# 备份新鲜度（备份节奏每 6h · 超 24h 提醒不阻断：可能就是想用旧备份）
_mtime_hours_ago() {
  local path=$1 mtime
  mtime=$(stat -c %Y "${path}" 2>/dev/null || stat -f %m "${path}" 2>/dev/null || echo 0)
  echo $(( ( $(date +%s) - mtime ) / 3600 ))
}

AGE=$(_mtime_hours_ago "${SQL_FILE}")
if [[ "${AGE}" -gt 24 ]]; then
  log_warn "$(basename "${SQL_FILE}") 已 ${AGE}h 未更新（备份节奏 6h）· 请确认备份 cron 是否正常 / 是否有意使用旧备份"
fi

# =============================================================================
# 确认
# =============================================================================
print_section_header "⚠️  Costra · staging 数据刷新（prod 最新备份）"

log_warn "本操作将覆盖本机 staging 栈（project costra · stg.costra.cloud）的数据："
log_warn "  1. costra-redis FLUSHALL（全部 key 清空）"
log_warn "  2. costra-postgres 清空后恢复 ← $(basename "${SQL_FILE}")（含停/启 costra-server）"
log_info "prod 不受影响（备份文件只读 · 来源 ${BACKUP_DIR}）"
echo ""

log_info "DB 备份:   ${SQL_FILE} · $(ls -lh "${SQL_FILE}" | awk '{print $5, $6, $7, $8}')"
echo ""

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行"
else
  confirm "⚠️  确认覆盖 staging 数据？此操作不可逆！" || die "用户取消"
fi

# =============================================================================
# Step 1: 清空 Redis（旧 session/缓存与恢复后的数据不匹配 · 随 DB 恢复）
# =============================================================================
log_step "[1/2] 清空 Redis（FLUSHALL）"

require_file "${COSTRA_ENV_FILE}"
REDIS_PW=$(grep '^REDIS_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${REDIS_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 REDIS_PW"

REDIS_STATUS=$(docker inspect --format '{{.State.Status}}' "${REDIS_CONTAINER}" 2>/dev/null || echo "missing")
if [[ "${REDIS_STATUS}" == "running" ]]; then
  run_cmd docker exec "${REDIS_CONTAINER}" redis-cli -a "${REDIS_PW}" --no-auth-warning FLUSHALL
  [[ "${DRY_RUN}" == "1" ]] || log_success "Redis 已 FLUSHALL"
else
  log_warn "${REDIS_CONTAINER} 不在运行（status=${REDIS_STATUS}）· 跳过"
fi

# =============================================================================
# Step 2: 恢复 DB（委托 restore-db.sh · 自带双确认 + 停/启 server + 单事务恢复）
# =============================================================================
log_step "[2/2] 恢复 DB（委托 restore-db.sh）"

RESTORE_ARGS=(--backup-file "${SQL_FILE}")
[[ "${DRY_RUN}" == "1" ]] && RESTORE_ARGS+=(--dry-run)
[[ "${ASSUME_YES}" == "1" ]] && RESTORE_ARGS+=(-y)

log_info "委托 → restore-db.sh ${RESTORE_ARGS[*]}"
if ! "${SCRIPT_DIR}/restore-db.sh" ${RESTORE_ARGS[@]+"${RESTORE_ARGS[@]}"}; then
  die "restore-db.sh 失败 · DB 未恢复（排查后可直接重跑本脚本）"
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ staging 刷新完成"
log_success "DB ← ${SQL_FILE}"
log_info "验证建议："
log_info "  - curl -s http://localhost:8080/healthz"
log_info "  - 小程序体验版指向 stg.costra.cloud 登录核对数据"
log_info "  - 若 staging 代码含 prod 尚未执行的 migration，请手动跑 ./06-migrate.sh"

exit 0
