-- =========================================================================
-- 0010_transfer_category_display_order · 转移二级分类进入默认展示区
-- =========================================================================
-- 目标：转移类型的一级/二级分类展示规则与支出、收入保持一致。
--       唯一 UI 特例仅为二级分类末尾提示“转移记录不会计入收支统计”。
--
-- 规则：
--   - 父默认子（is_parent_default=true）仍不进入全局二级展示区：display_order=NULL
--   - 非父默认的转移二级分类按 display_order 进入默认二级展示区
--   - 一级分类 display_order 仍为 NULL
--
-- 幂等：按 (parent_name, child_name) 更新固定 display_order；未变化不写。
-- =========================================================================

BEGIN;

WITH order_map(parent_name, child_name, ord) AS (
  VALUES
    ('储值', '公交卡储值', 1),
    ('储值', '饭卡储值',   2),
    ('赊销', '花呗',       3),
    ('赊销', '白条',       4),
    ('赊销', '月付',       5),
    ('赊销', '信用卡',     6)
)
UPDATE categories c
   SET display_order = om.ord,
       updated_at = now()
  FROM categories p
  JOIN order_map om
    ON om.parent_name = p.name
 WHERE c.family_id IS NULL
   AND c.type = 'transfer'
   AND c.parent_id = p.id
   AND c.name = om.child_name
   AND p.family_id IS NULL
   AND p.type = 'transfer'
   AND p.parent_id IS NULL
   AND c.deleted_at IS NULL
   AND p.deleted_at IS NULL
   AND c.display_order IS DISTINCT FROM om.ord;

UPDATE categories c
   SET display_order = NULL,
       updated_at = now()
  FROM categories p
 WHERE c.family_id IS NULL
   AND c.type = 'transfer'
   AND c.parent_id = p.id
   AND c.is_parent_default = true
   AND p.family_id IS NULL
   AND p.type = 'transfer'
   AND p.parent_id IS NULL
   AND c.deleted_at IS NULL
   AND p.deleted_at IS NULL
   AND c.display_order IS NOT NULL;

COMMIT;
