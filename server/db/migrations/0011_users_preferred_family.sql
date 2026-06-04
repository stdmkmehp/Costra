-- =========================================================================
-- Migration 0011 · users.preferred_family_id / preferred_ledger_id
-- 用途：服务端持久化用户上次选择的 family + ledger，设备清除本地 storage 后
--       可通过 GET /users/me/preference 恢复，实现跨设备 / 重装偏好保留。
-- 幂等：ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- =========================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_ledger_id  UUID REFERENCES ledgers(id)  ON DELETE SET NULL;

-- 无需索引（仅单行点查 WHERE id = $1）

COMMIT;
