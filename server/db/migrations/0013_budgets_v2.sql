--============================================================================
-- Costra · Migration 0013 · budgets 表删除重建
--============================================================================
-- 卡号占位：COSTRA-4xx
-- 事实源：
--   docs/design/asset-and-budget-spec.md v2 §3.2
--
-- 主要变更：
--   1. DROP TABLE budgets + DROP TYPE budget_period
--   2. 重建 budgets 表：仅 (ledger_id, month) 维度的月度总预算
--      去掉 category_id / period / alert_threshold / alerted_at
--      amount 改名为 amount_cents（与项目"金额字段"命名约定对齐）
--      加 updated_by 便于多人账本审计
--
-- 安全性：
--   - budgets 在线上未被使用（MVP 没有预算 UI），删表无数据丢失
--   - 停服前执行即可
--============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 删除旧 budgets 表
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS budgets CASCADE;

-- budget_period ENUM 仅旧表用，一并删除（IF EXISTS 已容错，无需 EXCEPTION 兜底）
DROP TYPE IF EXISTS budget_period;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 重建 budgets 表
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE budgets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id      UUID        NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  month          CHAR(7)     NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_cents   BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency       TEXT        NOT NULL DEFAULT 'CNY',
  updated_by     UUID        NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  version        INTEGER     NOT NULL DEFAULT 1
);

-- 唯一键：(ledger_id, month)
CREATE UNIQUE INDEX uq_budgets_ledger_month
  ON budgets (ledger_id, month)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_budgets_ledger_month ON budgets (ledger_id, month);
CREATE INDEX idx_budgets_updated_at ON budgets (updated_at);

-- updated_at 自动维护触发器（复用 0001_init.sql 定义的通用函数）
CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE budgets IS
'月度预算表（v2 重建 · COSTRA-4xx）。
 仅记录 (ledger_id, month) 维度的月度总预算；不做分类预算。
 amount_cents 单位为分；用户设置后客户端按 spent = SUM(当月 expense) 算剩余。';

COMMIT;
