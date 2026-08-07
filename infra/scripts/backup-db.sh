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
#   ./backup-db.sh --dry-run          # 仅打印不执行
#
# cron 配置（推荐统一走 maintenance.sh 入口 · 见 docs/db/maintenance-cron-plan.md）：
#   实际写入 cron 时路径需为真实绝对路径（cron 不展开 shell 变量）· 即 ${COSTRA_ROOT} 的展开值。
#   例（COSTRA_ROOT=/root/Costra 时）：
#   17 1,5,9,13,17,21 * * * root /root/Costra/infra/scripts/maintenance.sh backup >> /data/logs/maintenance-backup.log 2>&1
#
# 退出码：
#   0 = 备份成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

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
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -28
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
require_cmd ionice
[[ "${RETAIN_DAYS}" =~ ^[0-9]+$ ]] || die "--retain-days 必须是非负整数：${RETAIN_DAYS}"
[[ "${BACKUP_PREFIX}" =~ ^[A-Za-z0-9_-]+$ ]] || die "--prefix 仅允许字母/数字/下划线/中划线：${BACKUP_PREFIX}"

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

# 检查磁盘空间（至少留 500MB）
mkdir -p "${BACKUP_DIR}"
AVAIL_KB=$(df "${BACKUP_DIR}" | awk 'NR==2{print $4}')
AVAIL_MB=$((AVAIL_KB / 1024))
if [[ "${AVAIL_MB}" -lt 500 ]]; then
  die "磁盘空间不足（可用 ${AVAIL_MB}MB < 500MB）· 跳过本次备份 · 请清理磁盘"
fi
log_success "磁盘空间: ${AVAIL_MB}MB 可用 ✓"

# 取出 PG 密码
require_file "${COSTRA_ENV_FILE}"
PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"

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

log_info "输出: ${BACKUP_FILE}"

START_TS=$(date +%s)

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "ionice -c3 docker exec ... pg_dump | gzip > ${BACKUP_FILE}"
else
  # ionice class 3 = idle（仅在磁盘空闲时才跑 I/O · 不影响线上）
  # 临时关闭 errexit/pipefail，自己捕获 PIPESTATUS，确保失败时能清理残留
  set +e
  set +o pipefail
  ionice -c3 docker exec "${PG_CONTAINER}" \
    pg_dump -U costra -d costra --no-owner --no-acl \
    | gzip > "${BACKUP_FILE}"
  PIPE_STATUS=("${PIPESTATUS[@]}")
  set -e
  set -o pipefail

  DUMP_EXIT=${PIPE_STATUS[0]}
  GZIP_EXIT=${PIPE_STATUS[1]}
  if [[ ${DUMP_EXIT} -ne 0 || ${GZIP_EXIT} -ne 0 ]]; then
    rm -f "${BACKUP_FILE}"
    die "pg_dump 失败（pg_dump=${DUMP_EXIT} · gzip=${GZIP_EXIT}）"
  fi
fi

ELAPSED=$(( $(date +%s) - START_TS ))
log_success "备份完成（耗时 ${ELAPSED}s）"

# 校验 DB 备份文件
if [[ "${DRY_RUN}" != "1" ]]; then
  if [[ ! -f "${BACKUP_FILE}" ]]; then
    die "备份文件不存在：${BACKUP_FILE}"
  fi

  FILE_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
  FILE_SIZE_KB=$((FILE_SIZE / 1024))

  if [[ "${FILE_SIZE}" -lt 500 ]]; then
    rm -f "${BACKUP_FILE}"
    die "备份文件过小（${FILE_SIZE} bytes）· 可能 dump 失败 · 已删除"
  fi

  # gzip 完整性校验
  if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
    rm -f "${BACKUP_FILE}"
    die "gzip 校验失败 · 备份文件损坏 · 已删除"
  fi

  log_success "文件大小: ${FILE_SIZE_KB}KB · gzip 完整性 ✓"
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

  log_info "输出: ${AVATARS_FILE}"

  START_TS=$(date +%s)

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "ionice -c3 tar -czf ${AVATARS_FILE} -C ${AVATARS_PARENT} avatars"
  else
    if ! ionice -c3 tar -czf "${AVATARS_FILE}" -C "${AVATARS_PARENT}" avatars; then
      rm -f "${AVATARS_FILE}"
      die "tar 打包 avatars 失败"
    fi
  fi

  ELAPSED=$(( $(date +%s) - START_TS ))
  log_success "avatars 打包完成（耗时 ${ELAPSED}s）"

  # 校验 avatars 归档（gzip 层 + tar 结构 · 空目录也是合法归档 · 不做最小体积判断）
  if [[ "${DRY_RUN}" != "1" ]]; then
    if [[ ! -f "${AVATARS_FILE}" ]]; then
      die "avatars 归档不存在：${AVATARS_FILE}"
    fi

    if ! gzip -t "${AVATARS_FILE}" 2>/dev/null; then
      rm -f "${AVATARS_FILE}"
      die "avatars gzip 校验失败 · 归档损坏 · 已删除"
    fi

    if ! tar -tzf "${AVATARS_FILE}" >/dev/null 2>&1; then
      rm -f "${AVATARS_FILE}"
      die "avatars tar 结构校验失败 · 归档损坏 · 已删除"
    fi

    FILE_SIZE=$(stat -c%s "${AVATARS_FILE}" 2>/dev/null || stat -f%z "${AVATARS_FILE}" 2>/dev/null || echo "0")
    FILE_SIZE_KB=$((FILE_SIZE / 1024))
    log_success "文件大小: ${FILE_SIZE_KB}KB · tar.gz 完整性 ✓"
  fi
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
    EXPIRED_FILES=$(find "${BACKUP_DIR}" \( -name "${BACKUP_PREFIX}-*.sql.gz" -o -name "${BACKUP_PREFIX}-*.avatars.tar.gz" \) -mtime +${RETAIN_DAYS} -type f 2>/dev/null)
    if [[ -n "${EXPIRED_FILES}" ]]; then
      EXPIRED_COUNT=$(echo "${EXPIRED_FILES}" | wc -l | tr -d ' ')
      echo "${EXPIRED_FILES}" | xargs rm -f
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
