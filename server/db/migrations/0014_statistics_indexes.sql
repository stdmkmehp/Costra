-- =========================================================================
-- Costra DB Migration 0014 · 统计页接口索引补齐
-- Owner: backend-dev · 卡号: COSTRA-224 · 日期: 2026-06-05
-- 约束来源: docs/design/statistics-page-tech-spec.md §3.3
-- Postgres >= 15 · 幂等 · 可安全重跑
-- =========================================================================
--
-- 核心变更：
--   1. entries.category_id 索引（partial · 排除软删）
--      支持 drill-down level=2 (WHERE category_id IN (子分类 IDs))
--          和 level=3 (WHERE category_id = ?)
--   2. categories.parent_id 索引（partial · 排除软删）
--      支持 L1 排行的 categories JOIN parent_id 查询
--      和 L2 排行的 WHERE c.parent_id = ? 筛选
--
-- 性能预期（R1 目标）：
--   - 单月 entries ≤ 5000 时
--     · /statistics/monthly P95 ≤ 500ms
--     · /statistics/yearly P95 ≤ 800ms
--     · /statistics/drill-down level=2 P95 ≤ 200ms
--     · /statistics/drill-down level=3 P95 ≤ 200ms
-- =========================================================================

BEGIN;

-- entries.category_id：drill-down L2/L3 性能关键
CREATE INDEX IF NOT EXISTS idx_entries_category_id
  ON entries (category_id)
  WHERE deleted_at IS NULL;

-- categories.parent_id：L1/L2 排行 JOIN 加速
CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON categories (parent_id)
  WHERE deleted_at IS NULL;

COMMIT;
