#!/usr/bin/env bash
# =============================================================================
# Costra · DB 灾难恢复（从 pg_dump 备份还原）
# =============================================================================
# 适用场景：migration 搞坏了 DB / 需要回滚到某个备份点
#
# 流程：
#   1. 停止 server（防止恢复期间有新写入）
#   2. DROP SCHEMA public CASCADE → 清空所有用户对象
#   3. CREATE SCHEMA public + 授权
#   4. 恢复备份（--single-transaction · 原子性 · 任何错误全回滚）
#   5. 重装扩展（pgcrypto / citext）
#   6. 验证表结构
#   7. 重启 server
#
# 用法：
#   ./restore-db.sh /data/backups/pre-migrate-20260610-172000.sql
#   ./restore-db.sh --backup-file /data/backups/xxx.sql
#   ./restore-db.sh --list                                # 列出可用备份
#   ./restore-db.sh --dry-run /data/backups/xxx.sql       # 仅打印不执行
#
# ⚠️  危险操作：会清空当前 DB 全部数据并用备份覆盖！
#
# 退出码：
#   0 = 恢复成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BACKUP_FILE=""
LIST_MODE=0
PG_CONTAINER="costra-postgres"
BACKUP_DIR="${COSTRA_DATA}/backups"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file)  BACKUP_FILE=$2; shift 2 ;;
    --list)         LIST_MODE=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
      exit 0
      ;;
    -*)  die "未知参数: $1 · 用 --help 查看" ;;
    *)
      # 位置参数作为 backup file
      if [[ -z "${BACKUP_FILE}" ]]; then
        BACKUP_FILE=$1
      fi
      shift
      ;;
  esac
done

# --- list 模式 ---
if [[ "${LIST_MODE}" == "1" ]]; then
  echo "可用备份（${BACKUP_DIR}）："
  echo ""
  if [[ -d "${BACKUP_DIR}" ]]; then
    ls -lhtr "${BACKUP_DIR}"/*.sql 2>/dev/null || echo "  （无 .sql 备份文件）"
  else
    echo "  备份目录不存在：${BACKUP_DIR}"
  fi
  exit 0
fi

# --- 校验 ---
require_root
require_cmd docker

[[ -n "${BACKUP_FILE}" ]] || die "请指定备份文件路径 · 用法：./restore-db.sh /data/backups/xxx.sql · 或 --list 查看可用备份"
[[ -f "${BACKUP_FILE}" ]] || die "备份文件不存在：${BACKUP_FILE}"

# 文件大小检查（空文件保护）
FILE_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
if [[ "${FILE_SIZE}" -lt 100 ]]; then
  die "备份文件过小（${FILE_SIZE} bytes）· 可能是空 dump · 请确认文件内容"
fi

# 确认 postgres 容器在跑
STATUS=$(docker inspect --format '{{.State.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
[[ "${STATUS}" == "running" ]] || die "${PG_CONTAINER} 不在运行（status=${STATUS}）"

# 取出 PG 密码
require_file "${COSTRA_ENV_FILE}"
PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"

# =============================================================================
# 确认（三重保护）
# =============================================================================
print_section_header "⚠️  Costra · DB 灾难恢复"

log_warn "此操作将："
log_warn "  1. 停止 costra-server"
log_warn "  2. 清空当前数据库所有表和数据"
log_warn "  3. 用备份文件覆盖恢复"
echo ""
log_info "备份文件：${BACKUP_FILE}"
log_info "文件大小：$(ls -lh "${BACKUP_FILE}" | awk '{print $5}')"
echo ""

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行命令"
fi

confirm "⚠️  确认要清空并恢复数据库？此操作不可逆！" || die "用户取消"
confirm "⚠️  再次确认：当前 DB 所有数据将丢失！" || die "用户取消"

# =============================================================================
# 主流程
# =============================================================================

# --- Step 1: 停止 server ---
log_step "[1/6] 停止 costra-server（防止恢复期间写入）"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" stop server
log_success "server 已停止（容器保留 · 恢复后 up -d 重启）"

# --- Step 2: 清空 public schema ---
log_step "[2/6] 清空 public schema（DROP CASCADE）"

run_cmd docker exec "${PG_CONTAINER}" psql -U costra -d costra -c "
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO costra;
"
log_success "public schema 已重建"

# --- Step 3: 恢复备份 ---
log_step "[3/6] 恢复备份（--single-transaction · 原子性）"

run_cmd bash -c "docker exec -i '${PG_CONTAINER}' psql -U costra -d costra \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  < '${BACKUP_FILE}'"

log_success "备份恢复完成"

# --- Step 4: 重装扩展 ---
log_step "[4/6] 重装扩展（pgcrypto + citext）"

run_cmd docker exec "${PG_CONTAINER}" psql -U costra -d costra -c "
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS citext;
"
log_success "扩展已就绪"

# --- Step 5: 验证 ---
log_step "[5/6] 验证恢复结果"

if [[ "${DRY_RUN}" != "1" ]]; then
  # 表数量
  TABLE_COUNT=$(docker exec "${PG_CONTAINER}" psql -U costra -d costra -At -c "
    SELECT count(*) FROM pg_tables WHERE schemaname='public';
  " | tr -d ' \n')

  if [[ "${TABLE_COUNT}" -lt 5 ]]; then
    log_warn "表数量 ${TABLE_COUNT} · 偏少 · 恢复可能不完整"
  else
    log_success "表数量: ${TABLE_COUNT} ✓"
  fi

  # 列出表名
  log_info "已恢复的表："
  docker exec "${PG_CONTAINER}" psql -U costra -d costra -c '\dt' | head -25

  # 数据条数抽检
  echo ""
  log_info "数据抽检："
  for tbl in users families ledgers entries; do
    COUNT=$(docker exec "${PG_CONTAINER}" psql -U costra -d costra -At -c \
      "SELECT count(*) FROM ${tbl};" 2>/dev/null || echo "N/A")
    log_info "  ${tbl}: ${COUNT} rows"
  done
fi

# --- Step 6: 重启 server ---
log_step "[6/6] 重启 costra-server"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d server

# 等待 healthy
if [[ "${DRY_RUN}" != "1" ]]; then
  log_info "等待 server healthy..."
  HEALTHY_TIMEOUT=60
  START_TS=$(date +%s)

  while true; do
    HEALTH=$(docker inspect --format '{{.State.Health.Status}}' costra-server 2>/dev/null || echo "unknown")
    if [[ "${HEALTH}" == "healthy" ]]; then
      log_success "server healthy ✓"
      break
    fi

    ELAPSED=$(( $(date +%s) - START_TS ))
    if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
      log_warn "等待超时（${HEALTHY_TIMEOUT}s）· server 状态: ${HEALTH}"
      log_warn "请手动检查：docker logs costra-server --tail 50"
      break
    fi

    echo -n "."
    sleep 3
  done
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ DB 恢复完成"
log_success "已从备份恢复：${BACKUP_FILE}"
log_info "验证建议："
log_info "  - curl -s http://localhost:8080/healthz"
log_info "  - 登录小程序确认数据正常"

exit 0
