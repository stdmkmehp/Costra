--============================================================================
-- Costra · Migration 0012 · Workday Calendars（节假日数据表）
-- ============================================================================
-- 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
-- 事实源：
--   docs/design/workday-recurring-tech-spec.md §4
--
-- 主要变更：
--   1. 新增表 `workday_calendars`（一年一行 · 存放假日 + 调休补班日）
--   2. `recurring_period` ENUM 增加第四档 `workday`（每个工作日执行）
--   3. 放宽 `recurring_rules.chk_recurring_period_fields`：允许 workday 时
--      三个 days 数组全为 NULL
--
-- ★硬约定：本SQL 必须与 `server/test/setup.ts` 的简化 pg-mem DDL 同步
--   （ENUM → TEXT + CHECK 替代规则 · pg-mem 不支持的部分跳过，见 setup.ts 注释）
--
-- ★PostgreSQL enum 限制：`ALTER TYPE ... ADD VALUE` 后，新值在同一事务内
--   不能被 CHECK 约束等表达式使用（会报 `unsafe use of new value`）。
--   因此本 migration 拆成两段：
--   第一段：建表 + 加 enum 值（单语句隐式提交）
--   第二段：改 CHECK 约束（在独立事务里使用已提交的 'workday' 值）
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 第一段：建表 + 加 enum 值（DDL 语句各自隐式提交，不包在 BEGIN/COMMIT 内）
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. 新表 workday_calendars

CREATE TABLE IF NOT EXISTS workday_calendars (
  year        SMALLINT PRIMARY KEY,
  holidays    TEXT[] NOT NULL,      -- ['01-01', '02-15', ...]  MM-DD 格式 · 放假日
  workdays    TEXT[] NOT NULL,      -- ['02-08', '02-28', ...]  MM-DD 格式 · 调休补班日
  source      TEXT,                 -- '国务院办公厅关于XXXX年部分节假日安排的通知'
  source_url  TEXT,                 -- 公告链接
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 约束：holidays 和 workdays 不能有交集（不能又放假又补班）
-- pg-mem 可能不支持数组重叠运算符 && → 测试环境跳过此 CHECK（见 setup.ts）
ALTER TABLE workday_calendars ADD CONSTRAINT chk_holidays_workdays_disjoint
  CHECK (NOT (holidays && workdays));

-- 2. recurring_period ENUM 增加 workday
--    ALTER TYPE ... ADD VALUE 不能在事务块内执行后立刻在同事务使用新值，
--    故不包 BEGIN/COMMIT，由 PG 隐式提交。
ALTER TYPE recurring_period ADD VALUE IF NOT EXISTS 'workday';

-- ═══════════════════════════════════════════════════════════════════════════
-- 第二段：放宽 chk_recurring_period_fields（独立事务 · 此时 'workday' 已提交可用）
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE recurring_rules DROP CONSTRAINT chk_recurring_period_fields;

ALTER TABLE recurring_rules ADD CONSTRAINT chk_recurring_period_fields CHECK (
  (period = 'weekly'
     AND days_of_week    IS NOT NULL
     AND days_of_month   IS NULL
     AND year_month_days IS NULL) OR
  (period = 'monthly'
     AND days_of_month   IS NOT NULL
     AND days_of_week    IS NULL
     AND year_month_days IS NULL) OR
  (period = 'yearly'
     AND year_month_days IS NOT NULL
     AND days_of_week    IS NULL
     AND days_of_month   IS NULL) OR
  (period = 'workday'
     AND days_of_week    IS NULL
     AND days_of_month   IS NULL
     AND year_month_days IS NULL)
);

COMMIT;
