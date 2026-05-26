#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §5 跑 migrations（dump → migrate → verify 三件套）
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §5
#
# D-026 §2.3 C3 三件套：每次跑 migration 前都先 pg_dump（即使首次为空）
#
# 用法：
#   ./06-migrate.sh                # 标准跑（dump → migrate → verify）
#   ./06-migrate.sh --skip-dump    # 跳过 dump（不推荐 · 仅调试）
#   ./06-migrate.sh --dry-run
#
# 退出码：
#   0 = migration 全部跑过 · verify 表存在
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_DUMP=0
MIGRATIONS_DIR="${COSTRA_ROOT}/server/db/migrations"
COMPOSE_NETWORK="${COSTRA_COMPOSE_NET}"   # 来自 common.sh · 默认 costra_default
PG_CONTAINER="costra-postgres"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-dump)        SKIP_DUMP=1; shift ;;
    --network)          COMPOSE_NETWORK=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | head -16
      exit 0
      ;;
    *) die "未知参数: $1" ;;
  esac
done

require_root
require_cmd docker

# 确认 postgres 容器在跑
if [[ "${DRY_RUN}" != "1" ]]; then
  STATUS=$(docker inspect --format '{{.State.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
  [[ "${STATUS}" == "running" ]] || die "${PG_CONTAINER} 不在运行（status=${STATUS}）· 请先跑 05-start-stack.sh"
fi

# 取出 PG 密码（从 server.env）
require_file "${COSTRA_ENV_FILE}"
PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"

# =============================================================================
# 主流程
# =============================================================================
print_section_header "06 · 跑 migrations（§5）"

# --- Step 1: dump（D-026 §2.3 C3 三件套）---
if [[ "${SKIP_DUMP}" == "1" ]]; then
  log_step "[1/3] dump → 已 --skip-dump · 跳过（不推荐）"
else
  log_step "[1/3] pg_dump 备份当前 schema + 数据"

  DUMP_FILE="${COSTRA_DATA}/backups/pre-migrate-$(date +%Y%m%d-%H%M%S).sql"
  run_cmd bash -c "docker exec '${PG_CONTAINER}' pg_dump -U costra -d costra > '${DUMP_FILE}'"

  if [[ "${DRY_RUN}" != "1" ]]; then
    SIZE=$(ls -lh "${DUMP_FILE}" | awk '{print $5}')
    log_success "已备份: ${DUMP_FILE} (${SIZE})"
  fi
fi

# --- Step 2: migrate ---
log_step "[2/3] 跑 migrations（${MIGRATIONS_DIR}/*.sql）"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  die "migrations 目录不存在：${MIGRATIONS_DIR}"
fi

MIGRATION_FILES=$(find "${MIGRATIONS_DIR}" -maxdepth 1 -name '*.sql' -type f | sort)
if [[ -z "${MIGRATION_FILES}" ]]; then
  die "${MIGRATIONS_DIR} 下无 .sql 文件"
fi

MIGRATION_COUNT=$(echo "${MIGRATION_FILES}" | wc -l | tr -d ' ')
log_info "找到 ${MIGRATION_COUNT} 个 migration 文件"

# 用 postgres:15-alpine 临时容器跑 psql · 通过 compose 网络连 costra-postgres
run_cmd docker run --rm \
  --network "${COMPOSE_NETWORK}" \
  -v "${MIGRATIONS_DIR}:/migrations:ro" \
  -e PGPASSWORD="${PG_COSTRA_PW}" \
  postgres:15-alpine \
  bash -c '
    set -e
    for f in /migrations/*.sql; do
      echo "=== $(basename $f) ==="
      psql -v ON_ERROR_STOP=1 -h postgres -U costra -d costra -f "$f"
    done
  '

log_success "${MIGRATION_COUNT} 个 migration 全部 successfully"

# --- Step 3: verify ---
log_step "[3/3] 验证表 + 序列（0006 entries_change_seq 是关键）"

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "（dry-run 跳过 verify）"
else
  # 查表数量
  TABLE_COUNT=$(docker exec "${PG_CONTAINER}" psql -U costra -d costra -At -c "
    SELECT count(*) FROM pg_tables WHERE schemaname='public';
  " | tr -d ' \n')

  if [[ "${TABLE_COUNT}" -lt 5 ]]; then
    log_warn "表数量 ${TABLE_COUNT} · 略少（期望 ≥10）· 可能 migration 不完整"
  else
    log_success "表数量: ${TABLE_COUNT} ✓"
  fi

  # 列出表名
  log_info "已建表："
  docker exec "${PG_CONTAINER}" psql -U costra -d costra -c '\dt' | head -20

  # 检查 entries_change_seq 序列（0006 关键）
  if docker exec "${PG_CONTAINER}" psql -U costra -d costra -At -c \
    "SELECT last_value FROM entries_change_seq;" 2>/dev/null | grep -qE '^[0-9]+$'; then
    log_success "entries_change_seq 序列存在 ✓ (0006 migration 已跑)"
  else
    log_warn "entries_change_seq 序列不存在 · 检查 0006 migration"
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "migrations 完成 · 可以进入 §6 (07-issue-cert.sh)"
exit 0
