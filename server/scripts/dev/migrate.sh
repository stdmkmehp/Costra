#!/usr/bin/env bash
# =========================================================================
# Costra · Server · 跑齐所有 DB migrations（按文件名顺序 · 幂等可重跑）
# =========================================================================
# 用法：
#   ./scripts/dev/migrate.sh                          # 默认 dev DB URL
#   DB_URL='postgres://...' ./scripts/dev/migrate.sh  # 自定义
# 或经 npm scripts：
#   npm run db:migrate
# =========================================================================
set -euo pipefail

DB_URL="${DB_URL:-postgres://costra:costra_dev_pw@localhost:5432/costra}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../../db/migrations" && pwd)"

echo "==> Running migrations from $MIGRATIONS_DIR"
echo "==> DB: $DB_URL"
echo ""

for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "=== $(basename "$f") ==="
  psql "$DB_URL" -f "$f"
  echo ""
done

echo "✅ All migrations applied."
