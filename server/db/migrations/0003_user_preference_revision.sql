-- Costra · migration 0003 · users preference revision
-- 目标：让 /users/me/preference 支持最后一次选择胜出，并记录偏好更新时间。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_family_id UUID,
  ADD COLUMN IF NOT EXISTS preferred_ledger_id UUID,
  ADD COLUMN IF NOT EXISTS preferred_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_updated_at TIMESTAMPTZ;

UPDATE users
   SET preferred_updated_at = updated_at
 WHERE preferred_updated_at IS NULL
   AND (preferred_family_id IS NOT NULL OR preferred_ledger_id IS NOT NULL);
