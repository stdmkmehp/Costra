#!/usr/bin/env bash
# =============================================================================
# Costra · 用 prod 最新备份刷新 staging 数据（仅机器②）
# =============================================================================
# 适用场景：staging 需要一份与 prod 一致的真实数据（联调 / 排查 / 数据变更验证）。
#
# 数据源（只读）：/data/slave/backups（机器② 本地）
#   standby-YYYYMMDD-HHMMSS.sql.gz            从库每 6h pg_dump（= prod 数据）
#   scheduled-YYYYMMDD-HHMMSS.avatars.tar.gz  prod 每 6h backup-avatars 打包后 scp 过来
#   文件名时间戳定长 · 字典序即时间序 · 自动各取最新一份。
#
# 恢复目标 = 本机 staging 栈（project costra · stg.costra.cloud）：
#   1. /data/uploads/avatars ← 头像归档（临时目录解压校验后原子替换 · 属主对齐 02-prepare-dirs.sh）
#   2. costra-redis          ← FLUSHALL（旧 session/缓存与恢复后的数据不匹配 · 随 DB 恢复）
#   3. costra-postgres       ← 委托 restore-db.sh（清空 → 单事务恢复 → 重启 server）
#
# 用法：
#   ./restore-staging-from-prod.sh                    # 自动取最新 · avatars + DB
#   ./restore-staging-from-prod.sh --skip-avatars     # 只恢复 DB（+ Redis 清空）
#   ./restore-staging-from-prod.sh --skip-db          # 只恢复 avatars
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
AVATARS_FILE=""
SKIP_DB=0
SKIP_AVATARS=0
REDIS_CONTAINER="costra-redis"
AVATARS_DST="${COSTRA_DATA}/uploads/avatars"
UPLOADS_DIR="$(dirname "${AVATARS_DST}")"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-db)
      SKIP_DB=1
      shift
      ;;
    --skip-avatars)
      SKIP_AVATARS=1
      shift
      ;;
    --dry-run|-y|--yes)
      shift   # common 已处理 · noop
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -33
      exit 0
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

[[ "${SKIP_DB}" != "1" || "${SKIP_AVATARS}" != "1" ]] \
  || die "--skip-db 与 --skip-avatars 不能同时使用（至少恢复一项）"

require_root
require_cmd docker
require_cmd tar

# --- 防呆：仅机器②（staging/从库/分析机）允许运行 ---
# 机器② 必有 costra-standby-pg 容器（stopped 也算 · 同 install-standby-cron.sh 防呆）；
# 机器①（prod）没有 → 误跑直接拒绝（那里的 costra-postgres 是 prod 主库）。
if ! docker inspect costra-standby-pg >/dev/null 2>&1; then
  die "本机无 costra-standby-pg 容器 · 本脚本只允许在机器②（staging/从库机）运行 · 机器① 的 costra-postgres 是 prod 主库"
fi

[[ -d "${BACKUP_DIR}" ]] || die "备份目录不存在：${BACKUP_DIR}"

# =============================================================================
# 定位备份文件（文件名时间戳定长 · LC_ALL=C 字典序 = 时间序 · 各取最新）
# =============================================================================
if [[ "${SKIP_DB}" != "1" ]]; then
  SQL_FILE=$({ ls -1 "${BACKUP_DIR}"/standby-*.sql.gz 2>/dev/null || true; } | LC_ALL=C sort | tail -n 1)
  [[ -n "${SQL_FILE}" ]] || die "未找到 standby-*.sql.gz（${BACKUP_DIR}）· 从库备份 cron 是否正常？"
fi

if [[ "${SKIP_AVATARS}" != "1" ]]; then
  AVATARS_FILE=$({ ls -1 "${BACKUP_DIR}"/scheduled-*.avatars.tar.gz 2>/dev/null || true; } | LC_ALL=C sort | tail -n 1)
  [[ -n "${AVATARS_FILE}" ]] || die "未找到 scheduled-*.avatars.tar.gz（${BACKUP_DIR}）· prod backup-avatars 推送是否正常？"
fi

# 备份新鲜度（备份节奏每 6h · 超 24h 提醒不阻断：可能就是想用旧备份）
_file_age_hours() {
  local path=$1 mtime
  mtime=$(stat -c %Y "${path}" 2>/dev/null || stat -f %m "${path}" 2>/dev/null || echo 0)
  echo $(( ( $(date +%s) - mtime ) / 3600 ))
}

_check_freshness() {
  local path=$1 age
  age=$(_file_age_hours "${path}")
  if [[ "${age}" -gt 24 ]]; then
    log_warn "$(basename "${path}") 已 ${age}h 未更新（备份节奏 6h）· 请确认备份 cron 是否正常 / 是否有意使用旧备份"
  fi
}
[[ "${SKIP_DB}" == "1" ]] || _check_freshness "${SQL_FILE}"
[[ "${SKIP_AVATARS}" == "1" ]] || _check_freshness "${AVATARS_FILE}"

# =============================================================================
# 确认
# =============================================================================
print_section_header "⚠️  Costra · staging 数据刷新（prod 最新备份）"

log_warn "本操作将覆盖本机 staging 栈（project costra · stg.costra.cloud）的数据："
if [[ "${SKIP_AVATARS}" != "1" ]]; then
  log_warn "  1. /data/uploads/avatars 整目录替换 ← $(basename "${AVATARS_FILE}")"
fi
if [[ "${SKIP_DB}" != "1" ]]; then
  log_warn "  2. costra-redis FLUSHALL（全部 key 清空）"
  log_warn "  3. costra-postgres 清空后恢复 ← $(basename "${SQL_FILE}")（含停/启 costra-server）"
fi
log_info "prod 不受影响（备份文件只读 · 来源 ${BACKUP_DIR}）"
echo ""

if [[ "${SKIP_DB}" != "1" ]]; then
  log_info "DB 备份:   ${SQL_FILE} · $(ls -lh "${SQL_FILE}" | awk '{print $5, $6, $7, $8}')"
fi
if [[ "${SKIP_AVATARS}" != "1" ]]; then
  log_info "头像归档: ${AVATARS_FILE} · $(ls -lh "${AVATARS_FILE}" | awk '{print $5, $6, $7, $8}')"
fi
echo ""

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行"
else
  confirm "⚠️  确认覆盖 staging 数据？此操作不可逆！" || die "用户取消"
fi

# =============================================================================
# Step 1: 恢复 avatars
# =============================================================================
RESTORE_TMP=""
_cleanup_restore_tmp() {
  [[ -z "${RESTORE_TMP}" ]] || rm -rf -- "${RESTORE_TMP}"
}
trap _cleanup_restore_tmp EXIT

if [[ "${SKIP_AVATARS}" == "1" ]]; then
  log_step "[1/3] 恢复 avatars → 已 --skip-avatars · 跳过"
else
  log_step "[1/3] 恢复 avatars → ${AVATARS_DST}"

  # 归档完整性 + 顶层路径校验（只读 · dry-run 也执行 · 归档结构见 backup-db.sh：-C uploads avatars）
  if ! tar -tzf "${AVATARS_FILE}" >/dev/null 2>&1; then
    die "avatars 归档损坏（tar -tzf 校验失败）：${AVATARS_FILE}"
  fi
  BAD_ENTRIES=$({ tar -tzf "${AVATARS_FILE}" 2>/dev/null | grep -v '^avatars/' || true; })
  if [[ -n "${BAD_ENTRIES}" ]]; then
    die "avatars 归档含 avatars/ 之外的路径 · 拒绝解压：${AVATARS_FILE}"
  fi

  # 先解压到隐藏临时目录 · 全部成功后原子替换（中途失败不毁现有 avatars）
  RESTORE_TMP="${UPLOADS_DIR}/.avatars-restore.$$"
  run_cmd rm -rf -- "${RESTORE_TMP}"
  run_cmd mkdir -p -- "${RESTORE_TMP}"
  run_cmd tar -xzf "${AVATARS_FILE}" -C "${RESTORE_TMP}"
  run_cmd rm -rf -- "${AVATARS_DST}"
  run_cmd mv -f -- "${RESTORE_TMP}/avatars" "${AVATARS_DST}"
  run_cmd rm -rf -- "${RESTORE_TMP}"
  RESTORE_TMP=""

  # 属主对齐 02-prepare-dirs.sh：uploads 归 server 容器 node 用户（uid 1000）
  run_cmd chown -R "${UID_NODE}:${UID_NODE}" "${AVATARS_DST}"

  if [[ "${DRY_RUN}" != "1" ]]; then
    AVATAR_COUNT=$(find "${AVATARS_DST}" -type f 2>/dev/null | wc -l | tr -d ' ')
    log_success "avatars 已替换 · ${AVATAR_COUNT} 个文件"
  fi
fi

# =============================================================================
# Step 2: 清空 Redis（旧 session/缓存与恢复后的数据不匹配 · 随 DB 恢复）
# =============================================================================
if [[ "${SKIP_DB}" == "1" ]]; then
  log_step "[2/3] 清空 Redis → 已 --skip-db · 跳过"
else
  log_step "[2/3] 清空 Redis（FLUSHALL）"

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
fi

# =============================================================================
# Step 3: 恢复 DB（委托 restore-db.sh · 自带双确认 + 停/启 server + 单事务恢复）
# =============================================================================
if [[ "${SKIP_DB}" == "1" ]]; then
  log_step "[3/3] 恢复 DB → 已 --skip-db · 跳过"
else
  log_step "[3/3] 恢复 DB（委托 restore-db.sh）"

  RESTORE_ARGS=(--backup-file "${SQL_FILE}")
  [[ "${DRY_RUN}" == "1" ]] && RESTORE_ARGS+=(--dry-run)
  [[ "${ASSUME_YES}" == "1" ]] && RESTORE_ARGS+=(-y)

  log_info "委托 → restore-db.sh ${RESTORE_ARGS[*]}"
  if ! "${SCRIPT_DIR}/restore-db.sh" ${RESTORE_ARGS[@]+"${RESTORE_ARGS[@]}"}; then
    die "restore-db.sh 失败 · DB 未恢复（前序步骤已处理 · 排查后可加 --skip-avatars 单独重跑）"
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ staging 刷新完成"
if [[ "${SKIP_DB}" != "1" ]]; then
  log_success "DB ← ${SQL_FILE}"
fi
if [[ "${SKIP_AVATARS}" != "1" ]]; then
  log_success "avatars ← ${AVATARS_FILE}"
fi
log_info "验证建议："
log_info "  - curl -s http://localhost:8080/healthz"
log_info "  - 小程序体验版指向 stg.costra.cloud 登录核对数据"
log_info "  - 若 staging 代码含 prod 尚未执行的 migration，请手动跑 ./06-migrate.sh"

exit 0
