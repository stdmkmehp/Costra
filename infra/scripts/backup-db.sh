#!/usr/bin/env bash
# =============================================================================
# Costra · DB + Avatars 定时备份（pg_dump + gzip · tar · 每 4 小时错峰 · 保留 14 天）
# =============================================================================
# 适用场景：cron 定时调用 · 生成 gzip 压缩的 SQL 备份 + avatars 目录打包
#           也可被 redeploy.sh 调用（--db-only 只备份 DB · 跳过 avatars · 最小化停机窗口）
#
# 流程：
#   1. 前置检查（容器 healthy · 磁盘空间 · 源目录存在）
#   2. pg_dump + gzip（ionice 降低 I/O 优先级 · 不影响线上）+ 校验
#   3. avatars 目录 tar + gzip 打包 + 校验（--db-only 时跳过）
#   4. 清理过期备份（保留最近 N 天 · sql.gz 与 avatars.tar.gz 同规则）
#   5. 输出摘要
#
# 用法：
#   ./backup-db.sh                    # 标准执行
#   ./backup-db.sh --retain-days 7    # 自定义保留天数
#   ./backup-db.sh --no-cleanup       # 跳过清理旧备份
#   ./backup-db.sh --db-only          # 只备份 DB · 跳过 avatars（被 redeploy.sh 调用）
#   ./backup-db.sh --container costra-standby-pg --prefix standby \
#     --backup-dir /data/slave/backups                            # 备份从库（机器②）
#   ./backup-db.sh --dry-run          # 仅打印不执行
#
# cron 配置：主库唯一事实源是 maintenance.sh 的 CRON_SCHEDULE；从库组合任务见
# docs/ops/pg-standby-backup.md §5.2。不要从本文件复制另一套硬编码时间。
#
# 退出码：
#   0 = 备份成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# 备份包含完整业务数据，默认只允许 owner 读写；发布前始终保持同目录临时文件。
umask 077

# --- 默认参数 ---
PG_CONTAINER="costra-postgres"
BACKUP_DIR="${COSTRA_DATA}/backups"
AVATARS_SRC="${COSTRA_DATA}/uploads/avatars"
RETAIN_DAYS=14
NO_CLEANUP=0
DB_ONLY=0
BACKUP_PREFIX="scheduled"

# --- 解析参数 ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --retain-days)
      [[ $# -ge 2 ]] || die "--retain-days 需要一个天数值"
      RETAIN_DAYS=$2
      shift 2
      ;;
    --no-cleanup)
      NO_CLEANUP=1
      shift
      ;;
    --db-only)
      DB_ONLY=1
      shift
      ;;
    --prefix)
      [[ $# -ge 2 ]] || die "--prefix 需要一个前缀值"
      BACKUP_PREFIX=$2
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || die "--container 需要一个容器名"
      PG_CONTAINER=$2
      shift 2
      ;;
    --backup-dir)
      [[ $# -ge 2 ]] || die "--backup-dir 需要一个目录路径"
      BACKUP_DIR=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -29
      exit 0
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

require_cmd docker
require_cmd gzip
require_cmd tar
if [[ "${DRY_RUN}" != "1" ]]; then
  require_cmd ionice
  require_cmd flock "yum install -y util-linux / apt install -y util-linux"
fi
[[ "${RETAIN_DAYS}" =~ ^[0-9]+$ ]] || die "--retain-days 必须是非负整数：${RETAIN_DAYS}"
[[ "${BACKUP_PREFIX}" =~ ^[A-Za-z0-9_-]+$ ]] || die "--prefix 仅允许字母/数字/下划线/中划线：${BACKUP_PREFIX}"
[[ "${PG_CONTAINER}" =~ ^[A-Za-z0-9_.-]+$ ]] || die "--container 含非法字符：${PG_CONTAINER}"
[[ "${BACKUP_DIR}" == /* ]] || die "--backup-dir 必须是绝对路径：${BACKUP_DIR}"

# 脚本自身加锁，覆盖 maintenance 委托、standby cron 与人工直调三条入口；
# dry-run 不创建锁文件，保持真正只读。
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "正式执行时将按 ${PG_CONTAINER}|${BACKUP_DIR} 获取非阻塞 flock"
else
  LOCK_KEY=$(printf '%s' "${PG_CONTAINER}|${BACKUP_DIR}" | cksum | awk '{print $1}')
  LOCK_FILE="/tmp/costra-backup-${LOCK_KEY}.lock"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || die "另一个针对 ${PG_CONTAINER} → ${BACKUP_DIR} 的备份仍在运行 · 本次跳过"
fi

BACKUP_TMP=""
AVATARS_TMP=""
_cleanup_partial_backups() {
  [[ -z "${BACKUP_TMP}" ]] || rm -f -- "${BACKUP_TMP}"
  [[ -z "${AVATARS_TMP}" ]] || rm -f -- "${AVATARS_TMP}"
}
trap _cleanup_partial_backups EXIT

# =============================================================================
# Step 1: 前置检查
# =============================================================================
log_step "[1/4] 前置检查"

# 检查 postgres 容器 healthy
HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
if [[ "${HEALTH}" != "healthy" ]]; then
  die "${PG_CONTAINER} 状态异常（${HEALTH}）· 跳过本次备份"
fi
log_success "${PG_CONTAINER} healthy ✓"

# 检查磁盘空间（至少留 500MB）并收紧备份目录权限。dry-run 只找最近
# 已存在父目录做 df，不创建目录或改变权限。
DF_TARGET="${BACKUP_DIR}"
if [[ "${DRY_RUN}" == "1" ]]; then
  while [[ ! -e "${DF_TARGET}" && "${DF_TARGET}" != "/" ]]; do
    DF_TARGET=$(dirname "${DF_TARGET}")
  done
  [[ -d "${BACKUP_DIR}" ]] \
    || log_dry "正式执行时将创建 ${BACKUP_DIR} 并 chmod 0700"
else
  mkdir -p "${BACKUP_DIR}"
  chmod 0700 "${BACKUP_DIR}"
fi
AVAIL_KB=$(df "${DF_TARGET}" | awk 'NR==2{print $4}')
AVAIL_MB=$((AVAIL_KB / 1024))
if [[ "${AVAIL_MB}" -lt 500 ]]; then
  die "磁盘空间不足（可用 ${AVAIL_MB}MB < 500MB）· 跳过本次备份 · 请清理磁盘"
fi
log_success "磁盘空间: ${AVAIL_MB}MB 可用 ✓"

# pg_dump 通过容器内 Unix socket 执行，不读取或传递 PG_COSTRA_PW。

# avatars 源目录检查（缺失或 --db-only 时跳过 avatars 步骤 · 不阻断 DB 备份）
AVATARS_SKIP=0
if [[ "${DB_ONLY}" == "1" ]]; then
  log_info "--db-only · 跳过 avatars 备份"
  AVATARS_SKIP=1
elif [[ ! -d "${AVATARS_SRC}" ]]; then
  log_warn "avatars 目录不存在：${AVATARS_SRC} · 将跳过 avatars 备份"
  AVATARS_SKIP=1
fi

# =============================================================================
# Step 2: pg_dump + gzip（ionice 降低 I/O 优先级）+ 校验
# =============================================================================
log_step "[2/4] pg_dump + gzip 备份"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}-${TIMESTAMP}.sql.gz"
BACKUP_TMP="${BACKUP_DIR}/.${BACKUP_PREFIX}-${TIMESTAMP}.sql.gz.partial.$$"

log_info "临时输出: ${BACKUP_TMP}（全部校验通过后原子发布为 ${BACKUP_FILE}）"

START_TS=$(date +%s)

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "ionice -c3 docker exec ... pg_dump | gzip > ${BACKUP_TMP}"
  log_dry "校验成功后原子 mv ${BACKUP_TMP} ${BACKUP_FILE}"
else
  # ionice class 3 = idle（仅在磁盘空闲时才跑 I/O · 不影响线上）
  # 临时关闭 errexit/pipefail，自己捕获 PIPESTATUS；partial 由 EXIT trap 清理。
  set +e
  set +o pipefail
  ionice -c3 docker exec "${PG_CONTAINER}" \
    pg_dump -U costra -d costra --no-owner --no-acl \
    | gzip > "${BACKUP_TMP}"
  PIPE_STATUS=("${PIPESTATUS[@]}")
  set -e
  set -o pipefail

  DUMP_EXIT=${PIPE_STATUS[0]}
  GZIP_EXIT=${PIPE_STATUS[1]}
  if [[ ${DUMP_EXIT} -ne 0 || ${GZIP_EXIT} -ne 0 ]]; then
    die "pg_dump 失败（pg_dump=${DUMP_EXIT} · gzip=${GZIP_EXIT}）· 未发布最终文件"
  fi
fi

ELAPSED=$(( $(date +%s) - START_TS ))
log_success "备份完成（耗时 ${ELAPSED}s）"

# 校验 DB partial；最终 SQL 文件要最后发布，作为整组备份完成标志。
if [[ "${DRY_RUN}" != "1" ]]; then
  [[ -f "${BACKUP_TMP}" ]] || die "备份临时文件不存在：${BACKUP_TMP}"

  FILE_SIZE=$(stat -c%s "${BACKUP_TMP}" 2>/dev/null || stat -f%z "${BACKUP_TMP}" 2>/dev/null || echo "0")
  FILE_SIZE_KB=$((FILE_SIZE / 1024))

  [[ "${FILE_SIZE}" -ge 500 ]] \
    || die "备份文件过小（${FILE_SIZE} bytes）· 可能 dump 失败 · 未发布"

  gzip -t "${BACKUP_TMP}" 2>/dev/null \
    || die "gzip 校验失败 · 备份文件损坏 · 未发布"

  chmod 0600 "${BACKUP_TMP}"
  log_success "DB partial 大小: ${FILE_SIZE_KB}KB · gzip 完整性 ✓"
fi

# =============================================================================
# Step 3: avatars 目录 tar + gzip 打包 + 校验
# =============================================================================
if [[ "${AVATARS_SKIP}" == "1" ]]; then
  log_step "[3/4] Avatars 打包备份 → 已跳过（源目录不存在）"
else
  log_step "[3/4] Avatars 打包备份"

  # -C 到 uploads 父目录打包 avatars/ · 解包时 tar -xzf -C /data/uploads 即可还原
  AVATARS_PARENT="$(dirname "${AVATARS_SRC}")"
  AVATARS_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}-${TIMESTAMP}.avatars.tar.gz"
  AVATARS_TMP="${BACKUP_DIR}/.${BACKUP_PREFIX}-${TIMESTAMP}.avatars.tar.gz.partial.$$"

  log_info "临时输出: ${AVATARS_TMP}（校验后先于 SQL 完成标志发布）"

  START_TS=$(date +%s)

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "ionice -c3 tar -czf ${AVATARS_TMP} -C ${AVATARS_PARENT} avatars"
  else
    if ! ionice -c3 tar -czf "${AVATARS_TMP}" -C "${AVATARS_PARENT}" avatars; then
      die "tar 打包 avatars 失败 · 未发布最终文件"
    fi
  fi

  ELAPSED=$(( $(date +%s) - START_TS ))
  log_success "avatars 打包完成（耗时 ${ELAPSED}s）"

  # 校验 avatars partial（gzip 层 + tar 结构 · 空目录也是合法归档）。
  if [[ "${DRY_RUN}" != "1" ]]; then
    [[ -f "${AVATARS_TMP}" ]] || die "avatars 临时归档不存在：${AVATARS_TMP}"
    gzip -t "${AVATARS_TMP}" 2>/dev/null \
      || die "avatars gzip 校验失败 · 归档损坏 · 未发布"
    tar -tzf "${AVATARS_TMP}" >/dev/null 2>&1 \
      || die "avatars tar 结构校验失败 · 归档损坏 · 未发布"

    FILE_SIZE=$(stat -c%s "${AVATARS_TMP}" 2>/dev/null || stat -f%z "${AVATARS_TMP}" 2>/dev/null || echo "0")
    FILE_SIZE_KB=$((FILE_SIZE / 1024))
    chmod 0600 "${AVATARS_TMP}"
    log_success "avatars partial 大小: ${FILE_SIZE_KB}KB · tar.gz 完整性 ✓"
  fi
fi

# 先发布可选 avatars，再以 SQL 文件的原子 rename 作为整个备份完成标志。
if [[ "${DRY_RUN}" != "1" ]]; then
  if [[ "${AVATARS_SKIP}" != "1" ]]; then
    mv -f -- "${AVATARS_TMP}" "${AVATARS_FILE}"
    AVATARS_TMP=""
  fi
  mv -f -- "${BACKUP_TMP}" "${BACKUP_FILE}"
  BACKUP_TMP=""
  log_success "备份已原子发布 ✓"
fi

# =============================================================================
# Step 4: 清理过期备份（sql.gz 与 avatars.tar.gz 同规则）
# =============================================================================
if [[ "${NO_CLEANUP}" != "1" ]]; then
  log_step "[4/4] 清理过期备份（保留 ${RETAIN_DAYS} 天）"

  if [[ "${DRY_RUN}" == "1" ]]; then
    EXPIRED=$(find "${BACKUP_DIR}" \( -name "${BACKUP_PREFIX}-*.sql.gz" -o -name "${BACKUP_PREFIX}-*.avatars.tar.gz" \) -mtime +${RETAIN_DAYS} -type f 2>/dev/null | wc -l | tr -d ' ')
    log_dry "将删除 ${EXPIRED} 个过期文件"
  else
    EXPIRED_COUNT=0
    while IFS= read -r -d '' expired_file; do
      rm -f -- "${expired_file}"
      EXPIRED_COUNT=$((EXPIRED_COUNT + 1))
    done < <(find "${BACKUP_DIR}" -type f \
      \( -name "${BACKUP_PREFIX}-*.sql.gz" -o -name "${BACKUP_PREFIX}-*.avatars.tar.gz" \) \
      -mtime +"${RETAIN_DAYS}" -print0 2>/dev/null)
    if [[ "${EXPIRED_COUNT}" -gt 0 ]]; then
      log_success "已清理 ${EXPIRED_COUNT} 个过期备份"
    else
      log_info "无过期文件需要清理"
    fi
  fi
else
  log_step "[4/4] 清理 → 已 --no-cleanup 跳过"
fi

# =============================================================================
# 摘要
# =============================================================================
echo ""
if [[ "${DRY_RUN}" != "1" ]]; then
  SQL_COUNT=$(find "${BACKUP_DIR}" -name "*.sql.gz" -type f 2>/dev/null | wc -l | tr -d ' ')
  AVATARS_COUNT=$(find "${BACKUP_DIR}" -name "*.avatars.tar.gz" -type f 2>/dev/null | wc -l | tr -d ' ')
  TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | awk '{print $1}')
  log_success "DB 备份完成 · ${BACKUP_FILE}"
  if [[ "${AVATARS_SKIP}" != "1" ]]; then
    log_success "Avatars 备份完成 · ${AVATARS_FILE}"
  fi
  log_info "备份目录: ${BACKUP_DIR} · SQL ${SQL_COUNT} 个 · Avatars ${AVATARS_COUNT} 个 · 总计 ${TOTAL_SIZE}"
fi

exit 0
