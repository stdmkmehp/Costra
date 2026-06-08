#!/usr/bin/env bash
# =========================================================================
# Costra · Server · curl 实测 seed: 给指定 user.id 建 family/ledger/family_members
# =========================================================================
# 用法：
#   USER_ID='019e1a8d-2d20-...' ./scripts/dev/seed-curl-test.sh
# 或经 npm scripts：
#   USER_ID=$USER_ID npm run db:seed:curl-test
#
# 用途：COSTRA-104 Human curl 实测前置 · 见 docs/qa/costra-104-curl-verify.md §2.5
#   - 创建固定 family_id = 00000000-...0F0
#   - 创建固定 ledger_id = 00000000-...001（手册步骤 C/D/E 全部硬编码此 id）
#   - user 设为 family 的 owner 成员（entries 权限校验链路必需）
#
# 后续治理：FU-EPIC-FAMILY-LEDGER-CRUD（Sprint-3 候选 COSTRA-155）实装真业务 CRUD 后此脚本可废弃
# =========================================================================
set -euo pipefail

if [[ -z "${USER_ID:-}" ]]; then
  echo "❌ Error: USER_ID environment variable required"
  echo ""
  echo "Usage:"
  echo "  USER_ID=\$(echo \$RESPONSE | jq -r '.user.id') $0"
  echo ""
  echo "Hint: 先跑步骤 B（POST /auth/wx-login）保留 RESPONSE 再调本脚本"
  exit 1
fi

DB_URL="${DB_URL:-postgres://costra:costra_dev_pw@localhost:5432/costra}"
FAMILY_ID="${FAMILY_ID:-00000000-0000-0000-0000-0000000000F0}"
LEDGER_ID="${LEDGER_ID:-00000000-0000-0000-0000-000000000001}"

echo "==> Seeding curl-test data"
echo "==> DB:        $DB_URL"
echo "==> USER_ID:   $USER_ID"
echo "==> FAMILY_ID: $FAMILY_ID"
echo "==> LEDGER_ID: $LEDGER_ID"
echo ""

psql "$DB_URL" -v user_id="'$USER_ID'" \
                -v family_id="'$FAMILY_ID'" \
                -v ledger_id="'$LEDGER_ID'" <<'SQL'
BEGIN;

INSERT INTO families (id, name, owner_id)
VALUES (:family_id, 'CurlTestFamily', :user_id)
ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

INSERT INTO ledgers (id, family_id, name)
VALUES (:ledger_id, :family_id, 'Main')
ON CONFLICT (id) DO NOTHING;

INSERT INTO family_members (family_id, user_id, role)
VALUES (:family_id, :user_id, 'owner')
ON CONFLICT DO NOTHING;

COMMIT;

-- 验证（期望 3 行 count=1）
SELECT 'families' AS t, count(*) FROM families WHERE id = :family_id
UNION ALL SELECT 'ledgers',  count(*) FROM ledgers  WHERE id = :ledger_id
UNION ALL SELECT 'members',  count(*) FROM family_members WHERE family_id = :family_id AND user_id = :user_id;
SQL

echo ""
echo "✅ Seed complete. Ready to POST /entries with ledger_id=$LEDGER_ID"
