-- =========================================================================
-- Costra DB Migration 0012 · recurring_rules.end_date 约束放宽为闭区间
-- Postgres >= 15 · 幂等 · 可安全重跑
-- 最后更新：2026-08-06
-- =========================================================================
-- 背景：0011 原 CHECK 约束 `end_date IS NULL OR end_date > start_date` 基于
--   纯日期字符串比较，禁止结束日等于起始日。但产品语义上，起始日 = 当天 0 点
--   生效、结束日 = 当天 23:59:59 截止（闭区间，见 recurringService.ts
--   endBoundary = DateTime.fromISO(end_date).endOf('day')），所以"同一天生效"
--   是合法且有意义的场景（规则只跑一天）。原约束把这一合法场景误杀。
--
--   改为 `end_date IS NULL OR end_date >= start_date`，允许结束日 = 起始日。
--
-- 幂等策略：
--   - 新环境：0011 已建旧约束 → 0012 DROP IF EXISTS 旧约束 + ADD 新约束
--   - 已部署：同上
--   - 重复跑：DO 块检测新约束已存在则跳过 ADD（避免 "constraint already exists" 报错）
-- =========================================================================

BEGIN;

-- 1. 删除旧的严格大于约束（若存在）
ALTER TABLE recurring_rules
  DROP CONSTRAINT IF EXISTS chk_recurring_end_after_start;

-- 2. 添加新的 ≥ 约束（仅当不存在时）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_recurring_end_after_start'
       AND conrelid = 'recurring_rules'::regclass
  ) THEN
    ALTER TABLE recurring_rules
      ADD CONSTRAINT chk_recurring_end_after_start
      CHECK (end_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

COMMIT;
