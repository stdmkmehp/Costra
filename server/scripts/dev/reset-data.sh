#!/usr/bin/env bash
# =========================================================================
# Costra · Server · 清业务数据（保留 schema + 系统分类 + redis flushall）
# =========================================================================
# 用法：
#   ./scripts/dev/reset-data.sh                       # 默认 dev DB + redis
#   DB_URL='...' REDIS_URL='...' ./scripts/dev/reset-data.sh
# 或：
#   npm run db:reset-data
#
# 行为：
#   - TRUNCATE 业务表（entries / ledgers / family_members / families / users / sessions / idempotency_keys）
#   - RESTART IDENTITY CASCADE（外键级联）
#   - 保留：categories（系统预设 12 条 · 0002_seed_system_categories.sql）+ migrations 状态
#   - redis FLUSHALL（清缓存）
# =========================================================================
set -euo pipefail

DB_URL="${DB_URL:-postgres://costra:costra_dev_pw@localhost:5432/costra}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "==> Resetting business data"
echo "==> DB:    $DB_URL"
echo "==> Redis: $REDIS_URL"
echo ""

echo "=== TRUNCATE business tables（保留 categories 系统预设）==="
psql "$DB_URL" <<'SQL'
TRUNCATE
  idempotency_keys,
  entries,
  ledgers,
  family_invites,
  family_members,
  families,
  user_sessions,
  users
RESTART IDENTITY CASCADE;
SQL

echo ""
echo "=== Verify counts (业务表应 0 · categories 应 12 系统预设) ==="
psql "$DB_URL" -c "
SELECT 'users'         AS t, count(*) FROM users
UNION ALL SELECT 'families',        count(*) FROM families
UNION ALL SELECT 'ledgers',         count(*) FROM ledgers
UNION ALL SELECT 'entries',         count(*) FROM entries
UNION ALL SELECT 'idempotency_keys',count(*) FROM idempotency_keys
UNION ALL SELECT 'categories(sys)', count(*) FROM categories WHERE is_system = true;"

echo ""
echo "=== Redis FLUSHALL ==="
redis-cli -u "$REDIS_URL" FLUSHALL

echo ""
echo "=== 重跑 0002 seed（TRUNCATE families CASCADE 会一并清掉 categories · 需重 seed 系统预设）==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql "$DB_URL" -f "$SCRIPT_DIR/../../db/migrations/0002_seed_system_categories.sql"

echo ""
echo "=== Verify categories(sys) restored ==="
psql "$DB_URL" -c "SELECT count(*) AS sys_categories FROM categories WHERE is_system = true;"

echo ""
echo "✅ Business data cleared. Schema preserved. System categories restored."
