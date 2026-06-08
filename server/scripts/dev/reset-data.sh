#!/usr/bin/env bash
# =========================================================================
# Costra · Server · 重置开发数据库（DROP 全部 → migrate 重建）
# =========================================================================
# 用法：
#   ./scripts/dev/reset-data.sh                       # 默认 dev DB + redis
#   DB_URL='...' REDIS_URL='...' ./scripts/dev/reset-data.sh
# 或：
#   npm run db:reset-data
#
# 行为：
#   1. DROP SCHEMA public CASCADE（清空所有表/序列/类型/函数/触发器）
#   2. 重建空 public schema + 扩展（pgcrypto / citext）
#   3. 调用 migrate.sh 顺序跑全部 migration（幂等）恢复完整 schema + 系统分类
#   4. Redis FLUSHALL（清缓存）
#
# 与 infra/scripts/reset-db.sh 的区别：
#   - 面向 dev 本地环境（psql 直连 · 无 Docker）
#   - 无双重确认 / 备份步骤（开发环境不需要）
# =========================================================================
set -euo pipefail

DB_URL="${DB_URL:-postgres://costra:costra_dev_pw@localhost:5432/costra}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Resetting dev database（DROP + rebuild）"
echo "==> DB:    $DB_URL"
echo "==> Redis: $REDIS_URL"
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

# --- Step 2: 调 migrate.sh 重建全部 schema ---
echo ""
echo "=== [2/3] 重建 schema（migrate.sh）==="
"$SCRIPT_DIR/migrate.sh"

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
echo "✅ Dev database reset complete. Schema rebuilt. System categories restored (73 = 11 L1 + 62 L2)."
