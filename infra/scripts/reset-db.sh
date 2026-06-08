#!/usr/bin/env bash
# =============================================================================
# Costra · 完全清空数据（危险操作 · 双重确认）
# =============================================================================
# 用途：清空 prod/staging 的全部数据（PostgreSQL + Redis），恢复到"空白"状态。
#       清空后可配合 06-migrate.sh 重建 schema。
#
# 清空范围：
#   PostgreSQL：
#   - 所有用户表
#   - 所有序列（entries_change_seq 等）
#   - 所有自定义类型（ENUM: family_role, category_type, entry_type 等）
#   - 所有函数（touch_updated_at 等）
#   - 所有扩展保留（pgcrypto, citext 不删 · 重建 schema 需要）
#   Redis：
#   - 所有 key（FLUSHALL · 包括 session / 缓存等）
#
# 用法：
#   ./reset-db.sh                    # 标准清空（备份 → 确认 → 清空 PG + Redis）
#   ./reset-db.sh --skip-backup      # 跳过备份（不推荐 · 仅调试）
#   ./reset-db.sh --rebuild          # 清空后自动重跑 06-migrate.sh 重建 schema
#   ./reset-db.sh --yes              # 跳过第一次确认（仍需输入确认短语）
#   ./reset-db.sh --no-confirm       # 跳过所有确认（⚠️ 极度危险 · 仅 CI/脚本调用）
#   ./reset-db.sh --dry-run          # 只打印不执行
#
# 退出码：
#   0 = 清空成功（+ 可选 rebuild 成功）
#   1 = 失败或用户取消
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_BACKUP=0
REBUILD=0
NO_CONFIRM=0
PG_CONTAINER="costra-postgres"
REDIS_CONTAINER="costra-redis"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backup)      SKIP_BACKUP=1; shift ;;
    --rebuild)          REBUILD=1; shift ;;
    --no-confirm)       NO_CONFIRM=1; ASSUME_YES=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_root
require_cmd docker

# 确认 postgres 容器在跑
if [[ "${DRY_RUN}" != "1" ]]; then
  STATUS=$(docker inspect --format '{{.State.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
  [[ "${STATUS}" == "running" ]] || die "${PG_CONTAINER} 不在运行（status=${STATUS}）· 请先跑 05-start-stack.sh"
fi

# 确认 redis 容器在跑
if [[ "${DRY_RUN}" != "1" ]]; then
  REDIS_STATUS=$(docker inspect --format '{{.State.Status}}' "${REDIS_CONTAINER}" 2>/dev/null || echo "missing")
  [[ "${REDIS_STATUS}" == "running" ]] || die "${REDIS_CONTAINER} 不在运行（status=${REDIS_STATUS}）· 请先跑 05-start-stack.sh"
fi

# 取出密码（从 server.env）
require_file "${COSTRA_ENV_FILE}"
PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"

REDIS_PW=$(grep '^REDIS_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
[[ -n "${REDIS_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 REDIS_PW"

# =============================================================================
# 安全确认（双重保护）
# =============================================================================
print_section_header "⚠️  危险操作：完全清空数据"

echo ""
log_warn "┌─────────────────────────────────────────────────────────────┐"
log_warn "│  本操作将 不可逆 地删除以下数据：                           │"
log_warn "│                                                             │"
log_warn "│  PostgreSQL：                                               │"
log_warn "│    • 所有用户数据（users / families / entries / ...）       │"
log_warn "│    • 所有表结构（schema）                                   │"
log_warn "│    • 所有序列 / 类型 / 函数                                 │"
log_warn "│                                                             │"
log_warn "│  Redis：                                                    │"
log_warn "│    • 所有 key（session / 缓存 / 全部清空）                  │"
log_warn "│                                                             │"
log_warn "│  清空后数据库将回到完全空白状态。                           │"
log_warn "│  如需恢复 schema，请在清空后运行 06-migrate.sh              │"
log_warn "│  或使用 --rebuild 参数自动重建。                            │"
log_warn "└─────────────────────────────────────────────────────────────┘"
echo ""

# 第一层确认
if [[ "${ASSUME_YES}" != "1" ]]; then
  confirm "确认要清空所有数据（PostgreSQL + Redis）？" || die "用户取消"
fi

# 第二层确认（输入确认短语 · --no-confirm 跳过）
if [[ "${NO_CONFIRM}" != "1" && "${DRY_RUN}" != "1" ]]; then
  echo ""
  log_warn "请输入确认短语 'RESET ALL DATA' 以继续："
  local_reply=""
  read -rp "> " local_reply
  if [[ "${local_reply}" != "RESET ALL DATA" ]]; then
    die "确认短语不匹配 · 操作已取消"
  fi
  echo ""
fi

# =============================================================================
# 主流程
# =============================================================================

# --- Step 1: 备份 ---
if [[ "${SKIP_BACKUP}" == "1" ]]; then
  log_step "[1/4] 备份 → 已 --skip-backup · 跳过"
else
  log_step "[1/4] pg_dump 备份（清空前最后一次备份）"

  DUMP_DIR="${COSTRA_DATA}/backups"
  mkdir -p "${DUMP_DIR}"
  DUMP_FILE="${DUMP_DIR}/pre-reset-$(date +%Y%m%d-%H%M%S).sql"
  run_cmd bash -c "docker exec '${PG_CONTAINER}' pg_dump -U costra -d costra > '${DUMP_FILE}'"

  if [[ "${DRY_RUN}" != "1" ]]; then
    SIZE=$(ls -lh "${DUMP_FILE}" | awk '{print $5}')
    log_success "已备份: ${DUMP_FILE} (${SIZE})"
    log_info "恢复命令: docker exec -i ${PG_CONTAINER} psql -U costra -d costra < ${DUMP_FILE}"
  fi
fi

# --- Step 2: 清空 PostgreSQL ---
log_step "[2/4] 清空 PostgreSQL（DROP 所有对象）"

# 使用 DROP SCHEMA public CASCADE + 重建的方式，最干净彻底
# 保留扩展（pgcrypto / citext）因为它们装在 public schema 里会被一起删，需要重建
RESET_SQL='
-- 删除 public schema 下所有对象（表/序列/类型/函数/触发器）
DROP SCHEMA public CASCADE;

-- 重建空的 public schema
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO costra;
GRANT ALL ON SCHEMA public TO public;

-- 重建常用扩展（migration 0001 需要）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
'

run_cmd docker exec "${PG_CONTAINER}" psql -U costra -d costra -c "${RESET_SQL}"

if [[ "${DRY_RUN}" != "1" ]]; then
  # 验证清空结果
  TABLE_COUNT=$(docker exec "${PG_CONTAINER}" psql -U costra -d costra -At -c \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tr -d ' \n')

  if [[ "${TABLE_COUNT}" == "0" ]]; then
    log_success "PostgreSQL 已完全清空 · 0 张表"
  else
    log_warn "清空后仍有 ${TABLE_COUNT} 张表 · 可能有残留"
  fi
fi

# --- Step 3: 清空 Redis ---
log_step "[3/4] 清空 Redis（FLUSHALL）"

run_cmd docker exec "${REDIS_CONTAINER}" redis-cli -a "${REDIS_PW}" --no-auth-warning FLUSHALL

if [[ "${DRY_RUN}" != "1" ]]; then
  # 验证清空结果
  KEY_COUNT=$(docker exec "${REDIS_CONTAINER}" redis-cli -a "${REDIS_PW}" --no-auth-warning DBSIZE 2>/dev/null | grep -oE '[0-9]+')

  if [[ "${KEY_COUNT}" == "0" ]]; then
    log_success "Redis 已完全清空 · 0 个 key"
  else
    log_warn "清空后仍有 ${KEY_COUNT} 个 key · 可能有残留"
  fi
fi

# --- Step 4: 可选重建 ---
if [[ "${REBUILD}" == "1" ]]; then
  log_step "[4/4] 重建 schema（调用 06-migrate.sh）"

  MIGRATE_ARGS=(--skip-dump)
  [[ "${DRY_RUN}" == "1" ]] && MIGRATE_ARGS+=(--dry-run)
  [[ "${ASSUME_YES}" == "1" ]] && MIGRATE_ARGS+=(--yes)

  if "${SCRIPT_DIR}/06-migrate.sh" "${MIGRATE_ARGS[@]}"; then
    log_success "schema 重建完成"
  else
    log_error "06-migrate.sh 执行失败 · 请手动排查后重跑"
    exit 1
  fi
else
  log_step "[4/4] 重建 schema → 未指定 --rebuild · 跳过"
  log_info "如需重建 schema，请运行："
  log_info "  ${SCRIPT_DIR}/06-migrate.sh"
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "数据重置完成"

if [[ "${REBUILD}" == "1" ]]; then
  log_success "PostgreSQL + Redis 已清空并重建 schema · 处于全新空数据状态"
else
  log_success "PostgreSQL + Redis 已清空 · 当前为空白状态"
  log_info "下一步："
  log_info "  - 重建 schema：./06-migrate.sh"
  log_info "  - 从备份恢复：docker exec -i ${PG_CONTAINER} psql -U costra -d costra < <备份文件>"
fi

exit 0
