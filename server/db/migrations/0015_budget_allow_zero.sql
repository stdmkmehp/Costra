--============================================================================
-- Costra · Migration 0015 · budgets 允许 amount_cents = 0
--============================================================================
--卡号占位：COSTRA-4xx
-- 事实源：用户需求 · "预算设为 0 = 不设预算"
--
-- 变更：
--   放宽 CHECK 约束：amount_cents > 0 → amount_cents >= 0
--   amount_cents = 0 语义：用户主动选择不设预算，显示按空态处理
--============================================================================

BEGIN;

ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_amount_cents_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_amount_cents_check CHECK (amount_cents >= 0);

COMMIT;
