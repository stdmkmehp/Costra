--============================================================================
-- Costra · Migration 0011 · Recurring Entries（定时记账）
-- ============================================================================
-- 卡号占位：COSTRA-5xx（T2· Sprint-4· Epic-E）
-- 事实源：
--   docs/design/recurring-entry-product-spec.md v0.3.2
--   docs/design/recurring-entry-tech-spec.md v0.2.1 §4
--
-- 主要变更：
--   1. 新增 3 个 ENUM：recurring_period / recurring_bucket / recurring_status
--   2. 新增主表 `recurring_rules`（含数组字段 · 长度 CHECK · period与字段互斥 CHECK）
--   3. `entries` 表新增 `source_recurring_id` 外键（ON DELETE SET NULL）
--
-- ★硬约定：本SQL 必须与 `server/test/setup.ts` 的简化 pg-mem DDL 同步
--   （见 docs/spike/pgmem-array-check.md 说明的ENUM → TEXT + CHECK 替代规则）
-- ============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ENUM 类型
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE recurring_period AS ENUM (
    'weekly',      -- 每周
    'monthly',     -- 每月
    'yearly'       -- 每年
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recurring_bucket AS ENUM (
    'dawn',        -- 00:00-05:59（hash 落点内缩到 00:30-05:29）
    'morning',     -- 06:00-11:59（hash 落点内缩到 06:30-11:29）
    'afternoon',   -- 12:00-17:59（hash 落点内缩到 12:30-17:29）
    'night'        -- 18:00-23:59（hash 落点内缩到 18:30-23:29）
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recurring_status AS ENUM (
    'active',       -- 正常运行
    'paused',       -- 用户手动禁用
    'ended',        -- 达到 end_date 后自然停止
    'auto_paused'   -- 系统兜底禁用（账本失效 / 连续失败 3 次 / 用户离开家庭）
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 主表 recurring_rules
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recurring_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ★ RESTRICT 而非 CASCADE：账本被删时不联动删规则，走 auto_paused 状态（product-spec §7.1）
  ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- ─── 记账模板字段（透传给生成的 entry）────────────────────────────
  type            entry_type NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'CNY',
  category_id     UUID REFERENCES categories(id),
  account_id      UUID,
  to_account_id   UUID,
  note            TEXT CHECK (char_length(COALESCE(note, '')) <= 200),
  shared_type     entry_shared_type,
  CONSTRAINT chk_recurring_shared_type_scope CHECK (
    shared_type IS NULL OR type = 'expense'
  ),

  -- ─── 周期配置 ────────────────────────────────────────────────────
  period          recurring_period NOT NULL,

  -- 周期间隔倍数：period=weekly + period_interval=3表示"每3周"
  period_interval SMALLINT NOT NULL DEFAULT 1
                CONSTRAINT chk_period_interval_positive CHECK (period_interval >= 1),

  -- weekly：ISO weekday 1=周一..7=周日
  days_of_week    SMALLINT[],

  -- monthly：1..31
  days_of_month   SMALLINT[],

  -- yearly：元素编码= month*100 + day（1/1→101, 12/25→1225, 2/29→229）
  year_month_days INTEGER[],

  -- ─── 时段（product-spec §4.5）──────────────────────────────────
  execute_bucket  recurring_bucket NOT NULL,
  -- ★ execute_hour/minute 由后端 assignBucketMinute() 在 create/patch 事务内写入
  --   客户端 API 不接受这两个字段
  execute_hour    SMALLINT NOT NULL CHECK (execute_hour   BETWEEN 0 AND 23),
  execute_minute  SMALLINT NOT NULL CHECK (execute_minute BETWEEN 0 AND 59),

  timezone        TEXT NOT NULL,-- 快照自users.timezone

  -- ─── 生命周期 ────────────────────────────────────────────────
  start_date      DATE NOT NULL,
  end_date        DATE,
  status          recurring_status NOT NULL DEFAULT 'active',

  -- ─── 调度水位（tech-spec §3.4）─────────────────────────────────
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,
    -- 枚举：ok | ok_with_skipped
    --failed_ledger_deleted | failed_user_left_family | failed_other
    --      auto_paused_after_3_failures
  consecutive_failures SMALLINT NOT NULL DEFAULT 0
                       CHECK (consecutive_failures >= 0),

  -- ─── 审计 / 版本 ─────────────────────────────────────────────
  -- 复用 entries 的全局单调递增序列（recurring_rules与 entries 都写它）
  change_seq      BIGINT NOT NULL DEFAULT nextval('entries_change_seq'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,

  -- ═══ 完整性CHECK ══════════════════════════════════════════════
  -- period 与字段的互斥关系
  CONSTRAINT chk_recurring_period_fields CHECK (
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
       AND days_of_month   IS NULL)
  ),

  -- 数组长度上限（差异化 · 对应产品 §4.2）
  CONSTRAINT chk_recurring_days_of_week_len CHECK (
    days_of_week IS NULL OR
    (cardinality(days_of_week) BETWEEN 1 AND 7)
  ),
  CONSTRAINT chk_recurring_days_of_month_len CHECK (
    days_of_month IS NULL OR
    (cardinality(days_of_month) BETWEEN 1 AND 14)
  ),
  CONSTRAINT chk_recurring_year_month_days_len CHECK (
    year_month_days IS NULL OR
    (cardinality(year_month_days) BETWEEN 1 AND 12)
  ),

  -- 结束日可以等于起始日（闭区间）
  CONSTRAINT chk_recurring_end_after_start CHECK (
    end_date IS NULL OR end_date >= start_date
  )

  -- 说明：数组元素范围 CHECK（如 dow∈ [1,7]、dom ∈ [1,31]、
  --      year_month_days 元素形如 MMDD 合法性）由recurringService.validateCreate校验
  --      不下沉到 DB 层，避免复杂子查询导致 pg-mem 不兼容
);

-- ═══ 索引 ═══════════════════════════════════════════════════════
-- 调度器 tick 主查询：WHERE status='active' AND next_run_at <= now() AND deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_run
  ON recurring_rules (next_run_at)
  WHERE status = 'active' AND deleted_at IS NULL;

-- 用户列表页查询：WHERE created_by = $userId
CREATE INDEX IF NOT EXISTS idx_recurring_rules_created_by
  ON recurring_rules (created_by)
  WHERE deleted_at IS NULL;

-- 账本失效级联降级：SELECT rules WHERE ledger_id = $ledgerId AND status='active'
CREATE INDEX IF NOT EXISTS idx_recurring_rules_ledger
  ON recurring_rules (ledger_id)
  WHERE deleted_at IS NULL;

-- sync change_seq 用（当前v0.2规则不参与 pull sync · 但保留索引供审计查询）
CREATE INDEX IF NOT EXISTS idx_recurring_rules_change_seq
  ON recurring_rules (change_seq);

-- ═══ 触发器（复用 0001_init.sql 定义的通用函数）═══════════════════
CREATE TRIGGER trg_recurring_rules_updated_at
  BEFORE UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. entries 表新增 source_recurring_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS source_recurring_id UUID
    REFERENCES recurring_rules(id) ON DELETE SET NULL;

-- ON DELETE SET NULL：删除定时规则时保留历史 entry，只清空外键
-- 与产品 §8.2 "编辑/删除历史生成的 entry 不影响定时执行" 对齐

CREATE INDEX IF NOT EXISTS idx_entries_source_recurring
  ON entries (source_recurring_id)
  WHERE source_recurring_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
