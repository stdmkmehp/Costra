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
psql_admin "CREATE DATABASE ${REPORT_DB} OWNER \"${PG_USER}\";" >/dev/null

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

log_info "补全分析所需表/列（兼容旧 dump）..."
# migration 0020/0021 之前的历史 dump 缺 tip_orders / data_jobs / import_detect_sessions，
# 此处建最小列集空表兜底，使 55/56/57 查询返回空结果而非整轮分析报错；
# 新 dump 已含真实表，CREATE TABLE IF NOT EXISTS 为 no-op。
psql -h "${PG_HOST}" -U "${PG_USER}" -d "${REPORT_DB}" \
  -v ON_ERROR_STOP=1 --quiet <<'SQL' >/dev/null
ALTER TABLE entries ADD COLUMN IF NOT EXISTS source_recurring_id UUID;
CREATE TABLE IF NOT EXISTS data_jobs (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL,
  user_id         UUID,
  family_id       UUID,
  ledger_id       UUID,
  detect_id       UUID,
  error_code      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  result_summary  JSONB,
  export_from     TIMESTAMPTZ,
  export_to       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS import_detect_sessions (
  id         UUID PRIMARY KEY,
  file_name  TEXT
);
CREATE TABLE IF NOT EXISTS tip_orders (
  id            UUID PRIMARY KEY,
  user_id       UUID,
  product_key   TEXT,
  product_title TEXT,
  price_cents   BIGINT,
  support_delta INTEGER,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ
);
SQL
log_info "表/列补全完成"
