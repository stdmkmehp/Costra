#!/usr/bin/env bash
# =============================================================================
# Costra · 在 PostgreSQL 容器里执行一个 SQL 文件（prod 或 verify）
# =============================================================================
# 适用场景：
#   - 想在 verify 隔离库里跑某个 migration / 临时 SQL，验证效果
#   - 想直接给 prod 库打补丁（高危 · 强制 confirm + 默认建议先 backup-db.sh）
#
# 替代了原来又长又容易写错的命令：
#   docker exec -i -e PGPASSWORD='xxxxx' costra-replay-pg-costra-verify \
#       psql -h 127.0.0.1 -U costra -d costra_verify \
#       -v ON_ERROR_STOP=1 < ./0003.sql
#   docker exec -i costra-postgres psql -U costra -d costra \
#       -v ON_ERROR_STOP=1 < ./0003.sql
#
# 用法：
#   # 默认对 verify 容器跑（隔离 · 用约定密码 VERIFY_PG_PW）
#   ./psql-exec.sh ./server/db/migrations/0003_user_preference_revision.sql
#   ./psql-exec.sh ./some-backup.sql.gz
#
#   # 显式指定目标
#   ./psql-exec.sh --target verify ./0003.sql
#   ./psql-exec.sh --target prod   ./0003.sql       # 高危 · 必 confirm
#
#   # verify 自定义库（要和 replay-db.sh --db-name 对上）
#   ./psql-exec.sh --target verify --db-name costra_verify_x ./0003.sql
#
#   # 一路 yes（搭配 prod 也跳 confirm · 慎用）
#   ./psql-exec.sh --target prod -y ./0003.sql
#
#   # 只看会跑什么命令
#   ./psql-exec.sh --dry-run ./0003.sql
#
# 密码来源：
#   - verify : lib/common.sh 里的 VERIFY_PG_PW（团队约定值 · 容器完全隔离）
#   - prod   : /data/conf/server.env 里的 PG_COSTRA_PW
#
# 退出码：
#   0 = SQL 全部跑过
#   1 = 失败 / 校验未过 / 用户取消
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
TARGET="verify"          # verify | prod
DB_VERIFY="costra_verify"
PROD_CONTAINER="costra-postgres"
PROD_DB="costra"
PG_USER="costra"
SQL_FILE=""

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || die "--target 需要一个值: prod | verify"
      TARGET=$2
      shift 2
      ;;
    --db-name)
      [[ $# -ge 2 ]] || die "--db-name 需要一个数据库名"
      DB_VERIFY=$2
      shift 2
      ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -45
      exit 0
      ;;
    -*)
      die "未知参数: $1 · 用 --help 查看"
      ;;
    *)
      if [[ -z "${SQL_FILE}" ]]; then
        SQL_FILE=$1
        shift
      else
        die "多余的位置参数: $1 · 仅允许一个 SQL 文件路径"
      fi
      ;;
  esac
done

# --- 校验 ---
require_root
require_cmd docker

[[ "${TARGET}" == "prod" || "${TARGET}" == "verify" ]] || die "--target 只接受 prod 或 verify · got: ${TARGET}"

[[ -n "${SQL_FILE}" ]] || die "请指定 SQL 文件 · 用法：./psql-exec.sh [--target prod|verify] <file.sql|file.sql.gz>"
[[ -f "${SQL_FILE}" ]] || die "文件不存在：${SQL_FILE}"

case "${SQL_FILE}" in
  *.sql) ;;
  *.sql.gz) require_cmd gzip ;;
  *) die "不支持的文件格式：${SQL_FILE} · 仅支持 .sql / .sql.gz" ;;
esac

# --- 根据 target 选择容器 / 库 / 密码 ---
if [[ "${TARGET}" == "prod" ]]; then
  CONTAINER="${PROD_CONTAINER}"
  DB="${PROD_DB}"
  # prod 容器：从 server.env 读取 PG_COSTRA_PW（参考 06-migrate.sh）
  require_file "${COSTRA_ENV_FILE}"
  PG_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
  [[ -n "${PG_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"
  RISKY=1
else
  [[ "${DB_VERIFY}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "db-name 不合法：${DB_VERIFY}"
  DB_SLUG=$(printf '%s' "${DB_VERIFY}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
  DB_SLUG=${DB_SLUG#-}
  DB_SLUG=${DB_SLUG%-}
  [[ -n "${DB_SLUG}" ]] || DB_SLUG="verify"
  CONTAINER="costra-replay-pg-${DB_SLUG}"
  DB="${DB_VERIFY}"
  # verify 容器：固定密码 VERIFY_PG_PW（lib/common.sh）· 容器 --network none 完全隔离
  PG_PW="${VERIFY_PG_PW}"
  RISKY=0
fi

# 容器必须在跑
if [[ "${DRY_RUN}" != "1" ]]; then
  STATUS=$(docker inspect --format '{{.State.Status}}' "${CONTAINER}" 2>/dev/null || echo "missing")
  if [[ "${STATUS}" != "running" ]]; then
    if [[ "${TARGET}" == "verify" ]]; then
      die "${CONTAINER} 不在运行（status=${STATUS}）· 请先跑 ./replay-db.sh <backup-file> 拉起验证容器"
    else
      die "${CONTAINER} 不在运行（status=${STATUS}）· 请先跑 ./05-start-stack.sh"
    fi
  fi
fi

# =============================================================================
# 确认
# =============================================================================
print_section_header "🩺 Costra · psql-exec → ${TARGET}"

log_info "目标          : ${TARGET}"
log_info "容器          : ${CONTAINER}"
log_info "数据库        : ${DB}"
log_info "用户          : ${PG_USER}"
log_info "SQL 文件      : ${SQL_FILE} ($(ls -lh "${SQL_FILE}" | awk '{print $5}'))"
log_info "执行模式      : SQL 文件自管事务 (BEGIN/COMMIT) · -v ON_ERROR_STOP=1（遇错即停）"
echo ""

if [[ "${RISKY}" == "1" ]]; then
  log_warn "⚠️  目标是 prod 数据库 · 强烈建议先跑 ./backup-db.sh 做备份再继续"
  confirm "确认对 prod 数据库（${CONTAINER} · ${DB}）执行 ${SQL_FILE}？" || die "用户取消"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行命令"
fi

# =============================================================================
# 执行
# =============================================================================
log_step "执行 SQL"

PSQL_ARGS=(psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB}" -v ON_ERROR_STOP=1)

if [[ "${SQL_FILE}" == *.sql.gz ]]; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "gzip -dc '${SQL_FILE}' | docker exec -i -e PGPASSWORD=*** '${CONTAINER}' ${PSQL_ARGS[*]}"
  else
    gzip -dc "${SQL_FILE}" | docker exec -i -e "PGPASSWORD=${PG_PW}" "${CONTAINER}" "${PSQL_ARGS[@]}"
  fi
else
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "docker exec -i -e PGPASSWORD=*** '${CONTAINER}' ${PSQL_ARGS[*]} < '${SQL_FILE}'"
  else
    docker exec -i -e "PGPASSWORD=${PG_PW}" "${CONTAINER}" "${PSQL_ARGS[@]}" < "${SQL_FILE}"
  fi
fi

log_success "SQL 执行完成（事务已提交）"

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ ${TARGET} ← ${SQL_FILE}"

if [[ "${TARGET}" == "verify" ]]; then
  log_info "进入 verify 库（密码：${VERIFY_PG_PW}）："
  log_info "  docker exec -it -e PGPASSWORD='${VERIFY_PG_PW}' ${CONTAINER} psql -U ${PG_USER} -d ${DB}"
else
  log_info "进入 prod 库："
  log_info "  docker exec -it -e PGPASSWORD=\"\$(grep ^PG_COSTRA_PW= ${COSTRA_ENV_FILE} | cut -d= -f2-)\" \\"
  log_info "    ${CONTAINER} psql -h 127.0.0.1 -U ${PG_USER} -d ${DB}"
fi

exit 0
