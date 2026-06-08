-- =========================================================================
-- Costra DB Migration 0009 · entries.shared_type 公共/个人支出标记
-- Owner: backend-dev · 卡号: COSTRA-217 · 日期: 2026-06-01
-- 约束来源: dispatch COSTRA-217 §2.B + design/ui/design_spec.md §6.3
-- Postgres >= 15 · 幂等 · 可安全重跑
-- =========================================================================
--
-- 核心变更：
--   1. 创建枚举 entry_shared_type: 'personal' / 'shared'
--   2. entries 增加 shared_type 列（nullable · 仅 expense 有值）
--   3. CHECK 约束：income/transfer 的 shared_type 必须为 NULL
--   4. 默认规则由服务层判定（单人 personal family → personal; 多人 shared family → shared）
--      DB 层不设 DEFAULT · 服务层必须显式写入
--
-- 语义（dispatch §2.B.2）：
--   - expense: 允许 personal / shared; 未传时由服务端默认
--   - income: 不适用公共收入概念, 必须为 NULL
--   - transfer: 暂不进入公共/个人统计, 必须为 NULL
--
-- sync/push 兼容（dispatch §2.B.5）：
--   - payload.shared_type 可选; 缺省走服务端默认规则
--   - 非法组合（type=income 且 shared_type=shared）服务端返回标准错误
-- =========================================================================

BEGIN;

-- 1. 创建枚举类型
DO $$ BEGIN
  CREATE TYPE entry_shared_type AS ENUM ('personal', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. 增加 shared_type 列
ALTER TABLE entries ADD COLUMN IF NOT EXISTS shared_type entry_shared_type;

-- 3. CHECK 约束：income/transfer 的 shared_type 必须为 NULL
--    仅 expense 允许有值
DO $$ BEGIN
  ALTER TABLE entries ADD CONSTRAINT chk_entries_shared_type_scope
    CHECK (
      shared_type IS NULL  -- income/transfer 必须为 NULL
      OR type = 'expense'  -- 只有 expense 可以有 shared_type
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. 索引：按 shared_type 筛选支出（家庭页公共/个人拆解查询）
CREATE INDEX IF NOT EXISTS idx_entries_shared_type
  ON entries (ledger_id, shared_type)
  WHERE shared_type IS NOT NULL AND deleted_at IS NULL;

COMMIT;
