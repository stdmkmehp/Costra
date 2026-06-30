-- =========================================================================
-- 0006_categories_sort_order_by_display · 二级分类 sort_order 按 display_order 重排
-- =========================================================================
-- 配套设计：docs/design/categories-sort-order-by-display-spec.md
-- 本迁移可安全重跑（幂等）
--
-- 目标：让"点开一级分类后展开的二级分类"顺序跟随 display_order（高频在前），
--       无需改动前端 buildCategoryTree（它被动按 sort_order 渲染 children）。
--
-- 排序规则（每个一级分类内，重排后 sort_order = 1..N）：
--   ① 父默认子（is_parent_default=true）置顶
--   ② 其余按有效 display_order 升序：COALESCE(自身 display_order, 同名 canonical display_order)
--      —— 同名去重副本（自身 display_order=NULL）借用"带 display_order 的同名那份"的值
--   ③ 既无自身也无同名 canonical 的长尾（含全部 transfer）按原 sort_order 垫底
--
-- 作用域：仅系统分类（family_id IS NULL）的二级分类（parent_id IS NOT NULL）。
--         一级分类、家庭自定义分类不动。
--
-- 兼容性：
--   - 仅 UPDATE sort_order（纯展示字段），不 delete/insert、不碰 entries/budgets FK → 零数据风险
--   - sort_order 变化 → categories_revision 签名变化 → 客户端下次 sync 强刷，收敛到新顺序
--   - 幂等可重跑（ROW_NUMBER 纯派生 + IS DISTINCT FROM 守卫）
--   - 线上单独执行本文件即可（不依赖 0001/0004 重跑）；
--     依赖 display_order 已由 0004 写入（线上既有库已满足；全新建库按文件名在 0004 之后执行）
-- =========================================================================

BEGIN;

WITH canonical AS (
  -- 每个二级分类名在同 type 内的"权威 display_order"（借用源）。
  -- display_order 全局唯一，故每个 (name,type) 至多一份非空，MIN 取到该值。
  SELECT name, type, MIN(display_order) AS canon_display_order
    FROM categories
   WHERE family_id IS NULL
     AND parent_id IS NOT NULL
     AND display_order IS NOT NULL
     AND deleted_at IS NULL
   GROUP BY name, type
),
ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.parent_id
      ORDER BY
        CASE WHEN c.is_parent_default THEN 0 ELSE 1 END,           -- ① 父默认子置顶
        COALESCE(c.display_order, can.canon_display_order) ASC NULLS LAST,  -- ② 自身/借用 canonical
        c.sort_order ASC,                                          -- ③ 长尾按原 sort_order 兜底
        c.id ASC                                                   -- 终极确定性兜底
    ) AS new_sort_order
  FROM categories c
  LEFT JOIN canonical can
    ON can.name = c.name AND can.type = c.type
  WHERE c.family_id IS NULL
    AND c.parent_id IS NOT NULL        -- 仅二级
    AND c.deleted_at IS NULL
)
UPDATE categories t
   SET sort_order = r.new_sort_order,
       updated_at = now()
  FROM ranked r
 WHERE t.id = r.id
   AND t.sort_order IS DISTINCT FROM r.new_sort_order;   -- 幂等：值未变不写

COMMIT;

-- =========================================================================
-- 验收（SELECT 不影响幂等性，仅供 psql 输出参考；可逐父对照 spec §3 表）
-- =========================================================================
-- 期望（购物）：购物(默认) → 日用 → 零食 → 饮料 → 服饰 → 护肤美妆 → 数码 → 纸巾
-- SELECT p.name AS parent, c.sort_order, c.name, c.display_order, c.is_parent_default
--   FROM categories c
--   JOIN categories p ON p.id = c.parent_id
--  WHERE c.family_id IS NULL AND c.type = 'expense' AND p.name = '购物'
--  ORDER BY c.sort_order;
--
-- 期望（生活）：生活(默认) → 日用 → 买菜 → 水费 → 电费 → 燃气费 → 话费网费 → 柴米油盐 → 医疗 → 美容美发 → 宠物 → 母婴 → 物业维修 → 租房
-- SELECT p.name AS parent, c.sort_order, c.name, c.display_order, c.is_parent_default
--   FROM categories c
--   JOIN categories p ON p.id = c.parent_id
--  WHERE c.family_id IS NULL AND c.type = 'expense' AND p.name = '生活'
--  ORDER BY c.sort_order;
-- =========================================================================
