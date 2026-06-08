-- =========================================================================
-- Costra · 0007 families 表加 kind 列（个人家庭 vs 共享家庭区分）
-- =========================================================================
-- 卡号：COSTRA-164 · ADR-0007 v1.1 §4.1 + §5.7
-- 触发：Human 2026-05-27 追加需求 · 个人 family 与用户主动创建 family 在产品行为上有差异
--   （不可删 / 不可邀请 / UI 暴露差异 / 未来可能更多差异逻辑）· 必须从数据层区分
--
-- 设计决策：
--   ① ENUM 不用 BOOLEAN：未来可能扩展 'work'/'project'/'shared_external' · ENUM ALTER TYPE ADD VALUE 比加列轻
--   ② DEFAULT 'shared'：用户主动创建走 DEFAULT · personal 由 server 显式赋值（authService bootstrap）
--   ③ partial unique index 防御性：每用户最多 1 个 personal · 即使代码 bug 重复 INSERT 也被 DB 拦截
--   ④ 历史回填：dev/staging/prod 表小（家庭记账数据量极低）· 一次 UPDATE 安全
-- =========================================================================

BEGIN;

-- ─── 1. 创建 ENUM 类型 ───────────────────────────────────────────────────
-- 'personal'：server bootstrap 创建的个人 family · 不可删 · 不可邀请
-- 'shared'：用户主动创建（POST /families · COSTRA-201 Sprint-4）/ 接受邀请加入
DO $$ BEGIN
  CREATE TYPE family_kind AS ENUM ('personal', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. 加列（默认 shared 兼容存量数据语义）───────────────────────────────
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS kind family_kind NOT NULL DEFAULT 'shared';

-- ─── 3. 历史回填 · 每用户第一个自己 owner 的 family 标记为 personal ────────
-- 范式参 0006_entries_change_seq.sql §3 ROW_NUMBER 回填
-- 排序键选 created_at ASC, id ASC 而非 0006 的 updated_at ASC（v2.0 落地 FU-164-005）：
--   ① "个人 family" 应按"创建时间"判定 · 而非"最近更新时间"（用户改名等会动 updated_at · 不应改变身份）
--   ② created_at ASC, id ASC 双键防同毫秒并发创建的歧义（UUID v7 在 id 中已含时间序 · 双键冗余但更显式）
--   ③ 边缘场景：dev/staging 现有数据均无并发同毫秒 · 0 风险 · prod 无业务数据 · 0 行 UPDATE
WITH ranked AS (
  SELECT id, owner_id,
    ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC, id ASC) AS rn
  FROM families
  WHERE deleted_at IS NULL
)
UPDATE families
SET kind = 'personal'
FROM ranked
WHERE families.id = ranked.id AND ranked.rn = 1;

-- ─── 4. 防御性约束：每用户最多 1 个 personal family ─────────────────────
-- 范式参 0001_init.sql:99-101 uq_categories_family_name_type partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_families_one_personal_per_owner
  ON families (owner_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;

COMMIT;
