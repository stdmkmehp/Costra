-- ═══════════════════════════════════════════════════════════════════════════════
-- migration 0017: 成员配色体系改造 —— 座位号与颜色解耦
--
-- 背景：
--   原 color_slot 同时承载"座位号"（唯一、用于稳定排序）和"颜色"（用户偏好）两个语义。
--   改造后允许同 family 内多人选相同颜色，需将两语义拆分：
--     · seat_order（原 color_slot 改名）：座位号，保持唯一、单调递增、用于稳定排序
--     · color_choice（新增）：用户自选偏好色 0~7，允许撞色
--
-- 步骤：
--   1. RENAME COLUMN color_slot → seat_order
--   2. ADD COLUMN color_choice SMALLINT (0~7, nullable for left members)
--   3. 数据迁移：active 成员的 color_choice 初始化为当前 seat_order（保持升级后视觉不变）
--   4. DROP 旧 unique index（uq_family_members_color_slot_active）
--   5. CREATE 新 unique index on seat_order（座位号仍唯一，颜色允许重复）
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. 改名 color_slot → seat_order
ALTER TABLE family_members RENAME COLUMN color_slot TO seat_order;

-- 2. 新增 color_choice 列（用户自选偏好色，允许重复）
ALTER TABLE family_members
  ADD COLUMN color_choice SMALLINT
    CHECK (color_choice IS NULL OR (color_choice BETWEEN 0 AND 7));

-- 3. 数据迁移：active 成员的初始 color_choice = seat_order（视觉不变）
UPDATE family_members
   SET color_choice = seat_order
 WHERE left_at IS NULL AND color_choice IS NULL;

-- 4. 删除旧 unique index（基于 color_slot 名）
DROP INDEX IF EXISTS uq_family_members_color_slot_active;

-- 5. 创建新 unique index（基于 seat_order，保证座位号仍唯一）
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_seat_active
  ON family_members (family_id, seat_order)
  WHERE left_at IS NULL;
