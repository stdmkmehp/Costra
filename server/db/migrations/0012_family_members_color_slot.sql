-- =========================================================================
-- Costra · 0012 family_members 表加 color_slot 列（成员持久化配色）
-- =========================================================================
-- 卡号：COSTRA-COLOR-SLOT · 触发：协作页 Segmented Bar 灰阶配色相邻段区分不明显
--
-- 设计决策：
--   ① 用 SMALLINT 而非 HEX：DB 只存语义索引（0~7），色板由前端定义；
--      未来想换设计风格只动小程序即可，后端无需 migration。
--   ② NULL 语义 = "已 left 的成员，slot 已释放"：active 成员必非 NULL；
--      left_at IS NOT NULL ↔ color_slot IS NULL（应用层维护一致性）。
--   ③ partial unique index `WHERE left_at IS NULL`：保证 active 成员之间唯一，
--      已 left 成员 NULL 不参与 unique 比较，新人加入可立即复用空位。
--      参 0001_init.sql:55 idx_family_members_user 同款 partial 写法。
--   ④ CHECK 约束 0~7：与小程序 maxFamilyMembers=8 + 8 色色板上限对齐；
--      若未来扩容（>8 人）需要先扩色板再放约束。
--   ⑤ 历史回填：按 (family_id, joined_at ASC) ROW_NUMBER 分配 0..N；
--      容量内 N≤7 必然成立（受 maxFamilyMembers=8 约束）。
--      仅回填 active 成员（left_at IS NULL），left 成员保持 NULL 语义。
-- =========================================================================

BEGIN;

-- ─── 1. 加列 ────────────────────────────────────────────────────────────
-- nullable：left 成员 NULL；active 成员由应用层保证非 NULL。
-- CHECK 0~7：硬上限，与 8 色色板对齐。
ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS color_slot SMALLINT
    CHECK (color_slot IS NULL OR (color_slot BETWEEN 0 AND 7));

-- ─── 2. 历史回填 · 按 joined_at 给现有 active 成员分配 0..N ────────────
-- 范式参 0007_families_kind.sql §3 ROW_NUMBER 回填
-- 排序键 (joined_at ASC, user_id ASC)：
--   ① 先到先占低 slot · owner 最早 joined → 必占 slot 0
--   ② user_id ASC 防同毫秒并发（dev/staging 现网无此情况，纯防御）
-- 容量断言：每 family active 成员 ≤ maxFamilyMembers=8 → ROW_NUMBER-1 必 ∈ [0,7]
WITH ranked AS (
  SELECT family_id, user_id,
    ROW_NUMBER() OVER (
      PARTITION BY family_id
      ORDER BY joined_at ASC, user_id ASC
    ) - 1 AS slot
  FROM family_members
  WHERE left_at IS NULL
)
UPDATE family_members fm
SET color_slot = ranked.slot
FROM ranked
WHERE fm.family_id = ranked.family_id
  AND fm.user_id = ranked.user_id;

-- ─── 3. partial unique index · 同 family active 成员 slot 唯一 ──────────
-- 范式参 0001_init.sql:55 idx_family_members_user · 0007:48 uq_families_one_personal_per_owner
-- left_at IS NOT NULL 的成员 color_slot 为 NULL，不参与此索引，新人可立即复用。
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_color_slot_active
  ON family_members (family_id, color_slot)
  WHERE left_at IS NULL;

COMMIT;
