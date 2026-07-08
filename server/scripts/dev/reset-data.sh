#!/usr/bin/env bash
# =========================================================================
# Costra · Server · 重置开发数据库（DROP 全部 → migrate 重建）
# =========================================================================
# 用法：
#   ./scripts/dev/reset-data.sh                          # 默认：migrate.sh 重建
#   ./scripts/dev/reset-data.sh /path/to/backup.sql      # 从 SQL 备份导入
#   ./scripts/dev/reset-data.sh /path/to/backup.sql.gz   # 从 gzip SQL 备份导入
#   SQL_FILE='/path/to/backup.sql' ./scripts/dev/reset-data.sh
#   DB_URL='...' REDIS_URL='...' ./scripts/dev/reset-data.sh
# 或：
#   npm run db:reset-data
#
# 行为：
#   1. DROP SCHEMA public CASCADE（清空所有表/序列/类型/函数/触发器）
#   2. 重建空 public schema + 扩展（pgcrypto / citext）
#   3. 恢复 schema + 数据，二选一：
#        - 未指定 SQL_FILE：调 migrate.sh 顺序跑全部 migration（幂等）→ schema + 系统分类
#        - 指定 SQL_FILE：直接 psql 导入现成 SQL 备份（.sql / .sql.gz · 原子事务）
#   4. Redis FLUSHALL（清缓存）
#
# 与 infra/scripts/reset-db.sh 的区别：
#   - 面向 dev 本地环境（psql 直连 · 无 Docker）
#   - 无双重确认 / 备份步骤（开发环境不需要）
# =========================================================================
set -euo pipefail

DB_URL="${DB_URL:-postgres://costra:costra_dev_pw@localhost:5432/costra}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
# SQL 备份文件（可选）：支持 env SQL_FILE 或第一个位置参数
SQL_FILE="${SQL_FILE:-${1:-}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 若指定了 SQL_FILE：校验存在性 + 格式（.sql / .sql.gz）
if [[ -n "$SQL_FILE" ]]; then
  [[ -f "$SQL_FILE" ]] || { echo "❌ SQL 备份文件不存在: $SQL_FILE" >&2; exit 1; }
  case "$SQL_FILE" in
    *.sql|*.sql.gz) ;;
    *) echo "❌ 不支持的备份格式: ${SQL_FILE}（仅支持 .sql / .sql.gz）" >&2; exit 1 ;;
  esac
fi

echo "==> Resetting dev database（DROP + rebuild）"
echo "==> DB:    $DB_URL"
echo "==> Redis: $REDIS_URL"
if [[ -n "$SQL_FILE" ]]; then
  echo "==> 来源:  SQL 备份导入 → $SQL_FILE"
else
  echo "==> 来源:  migrate.sh 重建"
fi
echo ""

# --- Step 1: DROP SCHEMA public CASCADE ---
echo "=== [1/3] DROP SCHEMA public CASCADE ==="
psql "$DB_URL" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
SQL

# 验证清空
TABLE_COUNT=$(psql "$DB_URL" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tr -d ' \n')
echo "    清空后表数量: ${TABLE_COUNT}（应为 0）"

# --- Step 2: 重建 schema + 数据（migrate.sh 或导入 SQL 备份）---
echo ""
if [[ -n "$SQL_FILE" ]]; then
  echo "=== [2/3] 导入 SQL 备份（${SQL_FILE}）==="
  if [[ "$SQL_FILE" == *.sql.gz ]]; then
    gzip -dc "$SQL_FILE" | psql "$DB_URL" --single-transaction -v ON_ERROR_STOP=1
  else
    psql "$DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$SQL_FILE"
  fi
else
  echo "=== [2/3] 重建 schema（migrate.sh）==="
  "$SCRIPT_DIR/migrate.sh"
fi

# 验证重建结果
echo ""
echo "=== Verify ==="
psql "$DB_URL" -c "
SELECT 'tables' AS metric, count(*)::text FROM pg_tables WHERE schemaname='public'
UNION ALL SELECT 'categories(sys)', count(*)::text FROM categories WHERE is_system = true
UNION ALL SELECT '  - L1 (parent)',  count(*)::text FROM categories WHERE is_system = true AND parent_id IS NULL
UNION ALL SELECT '  - L2 (child)',   count(*)::text FROM categories WHERE is_system = true AND parent_id IS NOT NULL;"

# --- Step 3: Redis FLUSHALL ---
echo ""
echo "=== [3/3] Redis FLUSHALL ==="
redis-cli -u "$REDIS_URL" FLUSHALL

echo ""
if [[ -n "$SQL_FILE" ]]; then
  echo "✅ Dev database reset complete. Data imported from SQL backup: $SQL_FILE"
else
  echo "✅ Dev database reset complete. Schema rebuilt. System categories restored (73 = 11 L1 + 62 L2)."
fi
