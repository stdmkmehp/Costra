#!/usr/bin/env bash
# =============================================================================
# Costra · 备份重放到隔离 PostgreSQL 容器（安全验证 SQL / migration / 恢复流程）
# =============================================================================
# 适用场景：
#   1. 验证某个备份文件是否能正常恢复（结构 + 数据完整性）
#   2. 在隔离环境跑 migration SQL 看效果（不接触正式 PG 实例）
#   3. 还原某个时间点的数据做临时查询 / 审计
#
# 安全设计：
#   - 自动拉起独立 PostgreSQL 容器（默认名：costra-replay-pg-<db-slug>）
#   - 不复用 prod 的 costra-postgres，不加入 prod compose 网络，不暴露端口
#   - 验证数据写入独立目录 /data/replay-pg/<db-slug>/pgsql
#   - 通过 CPU / 内存限制降低对 prod 宿主机其他服务的干扰
#   - 验证库使用约定的固定密码（VERIFY_PG_PW · 见下）：容器 --network none 完全隔离
#     不暴露端口、不接 prod 网络 · 所以密码只是脚本间的约定值，不构成风险
#
# 用法：
#   # 重放备份到默认验证库 costra_verify（隔离容器内）
#   ./replay-db.sh /data/backups/pre-migrate-20260610-172000.sql
#   ./replay-db.sh /data/backups/scheduled-20260611-011700.sql.gz
#
#   # 指定自定义验证库名（影响容器名 / 数据目录 / 库名）
#   ./replay-db.sh --db-name costra_verify_migration_test /data/backups/xxx.sql
#
#   # 预览模式
#   ./replay-db.sh --dry-run /data/backups/xxx.sql.gz
#
#   # 列出可用备份（.sql / .sql.gz）
#   ./replay-db.sh --list
#
# 退出码：
#   0 = 重放成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BACKUP_FILE=""
LIST_MODE=0
BACKUP_DIR="${COSTRA_DATA}/backups"
DB_VERIFY="costra_verify"
REPLAY_IMAGE="postgres:15-alpine"
REPLAY_BASE_DIR="${COSTRA_DATA}/replay-pg"
REPLAY_CPUS="0.50"
REPLAY_MEMORY="768m"
REPLAY_PIDS_LIMIT="256"
PG_USER="costra"
# 验证库的固定密码来自 lib/common.sh: VERIFY_PG_PW（团队约定值 · 容器完全隔离）

# --- 解析参数 ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file)
      [[ $# -ge 2 ]] || die "--backup-file 需要一个备份文件路径"
      BACKUP_FILE=$2
      shift 2
      ;;
    --db-name)
      [[ $# -ge 2 ]] || die "--db-name 需要一个数据库名"
      DB_VERIFY=$2
      shift 2
      ;;
    --list)
      LIST_MODE=1
      shift
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
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -42
      exit 0
      ;;
    -*)
      die "未知参数: $1 · 用 --help 查看"
      ;;
    *)
      if [[ -z "${BACKUP_FILE}" ]]; then
        BACKUP_FILE=$1
        shift
      else
        die "多余的位置参数: $1 · 仅允许一个备份文件路径"
      fi
      ;;
  esac
done

# --- list 模式 ---
if [[ "${LIST_MODE}" == "1" ]]; then
  echo "可用备份（${BACKUP_DIR}）："
  echo ""
  if [[ -d "${BACKUP_DIR}" ]]; then
    FOUND=0
    while IFS= read -r file; do
      FOUND=1
      ls -lh "$file"
    done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name '*.sql' -o -name '*.sql.gz' \) | sort)

    if [[ "${FOUND}" != "1" ]]; then
      echo "  （无 .sql / .sql.gz 备份文件）"
    fi
  else
    echo "  备份目录不存在：${BACKUP_DIR}"
  fi
  exit 0
fi

# --- 校验 ---
require_root
require_cmd docker

[[ -n "${BACKUP_FILE}" ]] || die "请指定备份文件路径 · 用法：./replay-db.sh /data/backups/xxx.sql(.gz) · 或 --list 查看可用备份"
[[ -f "${BACKUP_FILE}" ]] || die "备份文件不存在：${BACKUP_FILE}"
case "${BACKUP_FILE}" in
  *.sql) ;;
  *.sql.gz)
    require_cmd gzip
    ;;
  *) die "不支持的备份格式：${BACKUP_FILE} · 仅支持 .sql / .sql.gz" ;;
esac
[[ "${DB_VERIFY}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "db-name 不合法：${DB_VERIFY} · 仅允许字母/数字/下划线，且不能数字开头"

FILE_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
if [[ "${FILE_SIZE}" -lt 100 ]]; then
  die "备份文件过小（${FILE_SIZE} bytes）· 可能是空 dump · 请确认文件内容"
fi

DB_SLUG=$(printf '%s' "${DB_VERIFY}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
DB_SLUG=${DB_SLUG#-}
DB_SLUG=${DB_SLUG%-}
[[ -n "${DB_SLUG}" ]] || DB_SLUG="verify"

REPLAY_CONTAINER="costra-replay-pg-${DB_SLUG}"
REPLAY_DIR="${REPLAY_BASE_DIR}/${DB_SLUG}"
REPLAY_DATA_DIR="${REPLAY_DIR}/pgsql"

# 防御性检查：只允许清理 replay 专用目录
case "${REPLAY_DIR}" in
  "${REPLAY_BASE_DIR}"/*) ;;
  *) die "内部错误：REPLAY_DIR 越界（${REPLAY_DIR}）" ;;
esac

# =============================================================================
# 确认
# =============================================================================
print_section_header "📋 Costra · 备份重放（隔离 PG 容器）"

log_info "备份文件     : ${BACKUP_FILE}"
log_info "文件大小     : $(ls -lh "${BACKUP_FILE}" | awk '{print $5}')"
log_info "验证库名     : ${DB_VERIFY}"
log_info "容器名       : ${REPLAY_CONTAINER}"
log_info "数据目录     : ${REPLAY_DATA_DIR}"
log_info "镜像         : ${REPLAY_IMAGE}"
log_info "资源限制     : cpu=${REPLAY_CPUS} · mem=${REPLAY_MEMORY} · pids=${REPLAY_PIDS_LIMIT}"
log_warn "隔离说明     : 不连接 prod 的 costra-postgres，不加入 prod 网络，不暴露端口"
echo ""

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行命令"
fi

confirm "是否启动隔离容器并重放备份到 ${DB_VERIFY}？" || die "用户取消"

# =============================================================================
# 主流程
# =============================================================================

# --- Step 1: 清理旧容器与旧目录 ---
log_step "[1/5] 清理旧验证容器和数据目录"

EXISTING=$(docker ps -aq -f "name=^${REPLAY_CONTAINER}$" 2>/dev/null || true)
if [[ -n "${EXISTING}" ]]; then
  run_cmd docker rm -f "${REPLAY_CONTAINER}"
  log_info "已删除旧容器 ${REPLAY_CONTAINER}"
fi

if [[ -d "${REPLAY_DIR}" ]]; then
  run_cmd rm -rf "${REPLAY_DIR}"
  log_info "已清理旧数据目录 ${REPLAY_DIR}"
fi

run_cmd mkdir -p "${REPLAY_DATA_DIR}"
# REPLAY_IMAGE 是 postgres:15-alpine · 容器内 postgres 用户 uid=70（debian 变体才是 999）
run_cmd chown -R "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" "${REPLAY_DIR}"
log_success "隔离目录已准备好"

# --- Step 2: 启动隔离 PostgreSQL 容器 ---
log_step "[2/5] 启动隔离 PostgreSQL 容器"

# 确保镜像在本地（--network none 启动后没法再去拉镜像）
if ! docker image inspect "${REPLAY_IMAGE}" >/dev/null 2>&1; then
  log_info "本地未找到镜像 ${REPLAY_IMAGE} · 拉取中..."
  run_cmd docker pull "${REPLAY_IMAGE}"
fi

run_cmd docker run -d \
  --name "${REPLAY_CONTAINER}" \
  --hostname "${REPLAY_CONTAINER}" \
  --restart no \
  --network none \
  --cpus "${REPLAY_CPUS}" \
  --memory "${REPLAY_MEMORY}" \
  --pids-limit "${REPLAY_PIDS_LIMIT}" \
  -e POSTGRES_USER="${PG_USER}" \
  -e POSTGRES_PASSWORD="${VERIFY_PG_PW}" \
  -e POSTGRES_DB="${DB_VERIFY}" \
  -e TZ="Asia/Shanghai" \
  -v "${REPLAY_DATA_DIR}:/var/lib/postgresql/data" \
  "${REPLAY_IMAGE}" >/dev/null

if [[ "${DRY_RUN}" != "1" ]]; then
  log_info "等待 PostgreSQL 就绪..."
  READY=0
  for _ in $(seq 1 30); do
    if docker exec "${REPLAY_CONTAINER}" \
      pg_isready -h 127.0.0.1 -U "${PG_USER}" -d "${DB_VERIFY}" >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 2
  done

  [[ "${READY}" == "1" ]] || die "隔离 PostgreSQL 容器启动超时 · 请检查 docker logs ${REPLAY_CONTAINER}"
fi

log_success "隔离容器已启动（隔离 --network none · 密码=VERIFY_PG_PW）"

# --- Step 3: 恢复备份 ---
log_step "[3/5] 恢复备份到隔离容器（--single-transaction · 原子性）"

if [[ "${BACKUP_FILE}" == *.sql.gz ]]; then
  run_cmd bash -c "gzip -dc '${BACKUP_FILE}' | docker exec -i -e PGPASSWORD='${VERIFY_PG_PW}' '${REPLAY_CONTAINER}' \
    psql -h 127.0.0.1 -U '${PG_USER}' -d '${DB_VERIFY}' \
    --single-transaction \
    -v ON_ERROR_STOP=1"
else
  run_cmd bash -c "docker exec -i -e PGPASSWORD='${VERIFY_PG_PW}' '${REPLAY_CONTAINER}' \
    psql -h 127.0.0.1 -U '${PG_USER}' -d '${DB_VERIFY}' \
    --single-transaction \
    -v ON_ERROR_STOP=1 \
    < '${BACKUP_FILE}'"
fi

log_success "备份重放完成"

# --- Step 4: 安装扩展 ---
log_step "[4/5] 安装扩展（pgcrypto + citext）"

run_cmd docker exec -e PGPASSWORD="${VERIFY_PG_PW}" "${REPLAY_CONTAINER}" \
  psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB_VERIFY}" -c "
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS citext;
"
log_success "扩展已就绪"

# --- Step 5: 验证 ---
log_step "[5/5] 验证恢复结果"

if [[ "${DRY_RUN}" != "1" ]]; then
  TABLE_COUNT=$(docker exec -e PGPASSWORD="${VERIFY_PG_PW}" "${REPLAY_CONTAINER}" \
    psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB_VERIFY}" -At -c "
      SELECT count(*) FROM pg_tables WHERE schemaname='public';
    " | tr -d ' \n')

  if [[ "${TABLE_COUNT}" -lt 5 ]]; then
    log_warn "表数量 ${TABLE_COUNT} · 偏少 · 恢复可能不完整"
  else
    log_success "表数量: ${TABLE_COUNT} ✓"
  fi

  log_info "已恢复的表："
  { docker exec -e PGPASSWORD="${VERIFY_PG_PW}" "${REPLAY_CONTAINER}" \
    psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB_VERIFY}" -c '\dt' || true; } | head -25

  echo ""
  log_info "数据抽检："
  for tbl in users families ledgers entries; do
    COUNT=$(docker exec -e PGPASSWORD="${VERIFY_PG_PW}" "${REPLAY_CONTAINER}" \
      psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB_VERIFY}" -At -c \
      "SELECT count(*) FROM ${tbl};" 2>/dev/null || echo "N/A")
    log_info "  ${tbl}: ${COUNT} rows"
  done
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ 重放完成"
log_success "隔离验证容器 ${REPLAY_CONTAINER} 已就绪 · 备份来源: ${BACKUP_FILE}"
log_info "说明：该容器不属于 prod compose，不连接 costra_default，不暴露任何端口"

echo ""
log_info "连接验证库（密码：${VERIFY_PG_PW}）："
log_info "  docker exec -it -e PGPASSWORD='${VERIFY_PG_PW}' ${REPLAY_CONTAINER} psql -U ${PG_USER} -d ${DB_VERIFY}"
echo ""
log_info "对验证库执行 SQL 文件（推荐 · 密码自动注入）："
log_info "  ./psql-exec.sh --target verify ./your-migration.sql"
log_info "  ./psql-exec.sh --target verify ./your-backup.sql.gz"
echo ""
log_info "查看日志："
log_info "  docker logs ${REPLAY_CONTAINER} --tail 100"
echo ""
log_info "用完清理："
log_info "  docker rm -f ${REPLAY_CONTAINER}"
log_info "  rm -rf ${REPLAY_DIR}"

exit 0
