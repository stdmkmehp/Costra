#!/usr/bin/env bash
# scripts/restore-database.sh · 将 dump 原样恢复到固定工作数据库
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

: "${DUMP_FILE:?缺少 DUMP_FILE}"
: "${REPORT_DB:?缺少 REPORT_DB}"
: "${PG_HOST:?缺少 PG_HOST}"
: "${PG_USER:?缺少 PG_USER}"
: "${PG_DB:?缺少 PG_DB}"
: "${PGPASSWORD:?缺少 PGPASSWORD}"

log_info "清空旧分析数据库: ${REPORT_DB}"
psql_admin "DROP DATABASE IF EXISTS ${REPORT_DB} WITH (FORCE);" >/dev/null

log_info "创建分析数据库: ${REPORT_DB}"
psql_admin "CREATE DATABASE ${REPORT_DB} OWNER ${PG_USER};" >/dev/null

log_info "原样解压并导入 dump..."
gunzip -c "${DUMP_FILE}" \
  | psql -h "${PG_HOST}" -U "${PG_USER}" -d "${REPORT_DB}" \
      -v ON_ERROR_STOP=1 \
      --quiet \
  >/dev/null

log_info "dump 导入完成，执行 sanity check..."
SANITY_RESULT=$(psql -h "${PG_HOST}" -U "${PG_USER}" -d "${REPORT_DB}" \
  -v ON_ERROR_STOP=1 \
  --csv --tuples-only \
  -c "
    SELECT
      (SELECT count(*) FROM users) AS users_count,
      (SELECT count(*) FROM families) AS families_count,
      (SELECT count(*) FROM ledgers) AS ledgers_count,
      (SELECT count(*) FROM entries) AS entries_count,
      (SELECT count(*) FROM categories) AS categories_count;
  ") || die "Sanity check 失败：核心表查询报错，请检查 dump 是否完整"

log_info "Sanity check 通过: ${SANITY_RESULT}"
