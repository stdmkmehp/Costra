-- =========================================================================
-- 0004_categories_restructure · 分类体系本次增量
-- =========================================================================
-- 配套设计：docs/design/categories-restructure-spec.md §3.2
-- 本迁移可安全重跑（幂等）
--
-- 执行步骤（顺序至关重要）：
--   A. ALTER TYPE category_type ADD VALUE 'transfer'  (独立语句，先自动提交)
--   B. UPSERT 新增分类（餐饮 早午晚餐 / 生活 水电燃气费 / transfer 三L1 + 子级）
--   C-1. 建 category_redirects 重定向表（永久保留，自文档化）+ 写入映射
--   C-2. 用 redirect 表驱动 entries / budgets 的重指向
--          entries 必须 bump change_seq/version/updated_at（让客户端能拉到）
--   D. 硬删 三餐 / 水电煤
--   E. 重排所有支出二级 display_order（按 spec §3 Step E 表）
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Step A · 扩展 category_type 枚举
-- ─────────────────────────────────────────────────────────────────────────
-- PG 限制：ADD VALUE 后不能在同一事务内立即使用该值；故此句独立段（裸语句
-- 在 psql 文件中按语句自动提交），使其在 Step B 之前对该会话/事务可见。
ALTER TYPE category_type ADD VALUE IF NOT EXISTS 'transfer';

-- ─────────────────────────────────────────────────────────────────────────
-- Step B~E · 单事务完成本次增量
-- ─────────────────────────────────────────────────────────────────────────
-- Step A 必须独立提交；其后所有业务变更放入同一事务，避免失败后留下半迁移状态。
BEGIN;

-- Step B · 新增分类（UPSERT 幂等）

-- 餐饮下：早餐/午餐/晚餐
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '早餐', 'expense', '餐', 'color.category.food', 2, true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 1),
  (NULL, '午餐', 'expense', '餐', 'color.category.food', 3, true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 2),
  (NULL, '晚餐', 'expense', '餐', 'color.category.food', 4, true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 3)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- 生活下：水费/电费/燃气费
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '水费',     'expense', '活', 'color.category.lifestyle', 7, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 13),
  (NULL, '电费',     'expense', '活', 'color.category.lifestyle', 8, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 14),
  (NULL, '燃气费',   'expense', '活', 'color.category.lifestyle', 9, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 15)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- 转移一级（type='transfer', parent_id IS NULL）
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '储值',     'transfer', '储', 'color.category.transfer', 1, true, NULL, false, false, NULL),
  (NULL, '账户互转', 'transfer', '互', 'color.category.transfer', 2, true, NULL, false, false, NULL),
  (NULL, '赊销',     'transfer', '销', 'color.category.transfer', 3, true, NULL, false, false, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- 转移二级 · 储值
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '储值',       'transfer', '储', 'color.category.transfer', 1, true, (SELECT id FROM categories WHERE name='储值'     AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true,  NULL),
  (NULL, '公交卡储值', 'transfer', '储', 'color.category.transfer', 2, true, (SELECT id FROM categories WHERE name='储值'     AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL),
  (NULL, '饭卡储值',   'transfer', '储', 'color.category.transfer', 3, true, (SELECT id FROM categories WHERE name='储值'     AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- 转移二级 · 账户互转
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '账户互转', 'transfer', '互', 'color.category.transfer', 1, true, (SELECT id FROM categories WHERE name='账户互转' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- 转移二级 · 赊销
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '赊销',     'transfer', '销', 'color.category.transfer', 1, true, (SELECT id FROM categories WHERE name='赊销' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true,  NULL),
  (NULL, '花呗',     'transfer', '销', 'color.category.transfer', 2, true, (SELECT id FROM categories WHERE name='赊销' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL),
  (NULL, '白条',     'transfer', '销', 'color.category.transfer', 3, true, (SELECT id FROM categories WHERE name='赊销' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL),
  (NULL, '月付',     'transfer', '销', 'color.category.transfer', 4, true, (SELECT id FROM categories WHERE name='赊销' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL),
  (NULL, '信用卡',   'transfer', '销', 'color.category.transfer', 5, true, (SELECT id FROM categories WHERE name='赊销' AND type='transfer' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order = EXCLUDED.display_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Step C-1 · 建立 category_redirects 重定向表 + 写入本次映射
-- ─────────────────────────────────────────────────────────────────────────
-- 表语义：硬删后服务端"category_id 不存在 → 找重定向 new_id"的唯一事实源
-- 永久保留，未来任何分类合并/改名均可复用。
CREATE TABLE IF NOT EXISTS category_redirects (
  old_id     UUID PRIMARY KEY,
  new_id     UUID NOT NULL REFERENCES categories(id),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_redirects_new_id ON category_redirects (new_id);

-- 三餐 → 餐饮·餐饮（餐饮一级的 is_parent_default=true 子）
INSERT INTO category_redirects (old_id, new_id, reason)
SELECT
  src.id,
  dst.id,
  '三餐 merged into 餐饮 (2026-06-11)'
FROM
  (SELECT id FROM categories
    WHERE family_id IS NULL AND type='expense' AND name='三餐'
      AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='餐饮' AND parent_id IS NULL LIMIT 1)
    LIMIT 1) src,
  (SELECT c.id FROM categories c
    JOIN categories p ON p.id = c.parent_id
   WHERE c.family_id IS NULL AND c.type='expense' AND c.name='餐饮'
     AND p.name='餐饮' AND p.parent_id IS NULL AND p.family_id IS NULL
     AND c.is_parent_default = true
   LIMIT 1) dst
ON CONFLICT (old_id) DO UPDATE SET
  new_id = EXCLUDED.new_id,
  reason = EXCLUDED.reason;

-- 水电煤 → 生活·生活
INSERT INTO category_redirects (old_id, new_id, reason)
SELECT
  src.id,
  dst.id,
  '水电煤 merged into 生活 (2026-06-11)'
FROM
  (SELECT id FROM categories
    WHERE family_id IS NULL AND type='expense' AND name='水电煤'
      AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='生活' AND parent_id IS NULL LIMIT 1)
    LIMIT 1) src,
  (SELECT c.id FROM categories c
    JOIN categories p ON p.id = c.parent_id
   WHERE c.family_id IS NULL AND c.type='expense' AND c.name='生活'
     AND p.name='生活' AND p.parent_id IS NULL AND p.family_id IS NULL
     AND c.is_parent_default = true
   LIMIT 1) dst
ON CONFLICT (old_id) DO UPDATE SET
  new_id = EXCLUDED.new_id,
  reason = EXCLUDED.reason;

-- ─────────────────────────────────────────────────────────────────────────
-- Step C-2 · 用 redirect 表驱动现有引用的重指向
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ entries 必须 bump change_seq/version/updated_at，否则客户端永远拉不到
--   依赖：sync 协议 §6.3 v1.2 watermark = change_seq
-- ⚠️ 不过滤 deleted_at：真实 FK 不区分软删行，必须清空所有历史引用后才能硬删分类。
UPDATE entries e
   SET category_id = r.new_id,
       change_seq  = nextval('entries_change_seq'),
       version     = version + 1,
       updated_at  = now()
  FROM category_redirects r
 WHERE e.category_id = r.old_id;

-- budgets 走 REST 刷新，无需 change_seq
UPDATE budgets b
   SET category_id = r.new_id,
       updated_at  = now()
  FROM category_redirects r
 WHERE b.category_id = r.old_id;

-- ─────────────────────────────────────────────────────────────────────────
-- Step D · 硬删 三餐 / 水电煤（此时已无引用）
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM categories
 WHERE family_id IS NULL
   AND type = 'expense'
   AND (
     (name = '三餐'  AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='餐饮' AND parent_id IS NULL LIMIT 1))
     OR
     (name = '水电煤' AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='生活' AND parent_id IS NULL LIMIT 1))
   );

-- ─────────────────────────────────────────────────────────────────────────
-- Step E · 重排所有支出二级 display_order（按 spec §3 Step E 表）
-- ─────────────────────────────────────────────────────────────────────────
-- 用一张 (parent_name, child_name, new_order) 临时映射 + 单条 UPDATE 完成。
-- 全表覆写 expense 二级的 display_order：先全部重置为 NULL，再按表回填。

-- 重置所有 expense 二级 display_order（保留 NULL 语义"不展示"）
UPDATE categories
   SET display_order = NULL
 WHERE family_id IS NULL
   AND type = 'expense'
   AND parent_id IS NOT NULL
   AND display_order IS NOT NULL;

-- 用 VALUES 提供 (parent_name, child_name, display_order) 三元组重排
WITH order_map(parent_name, child_name, ord) AS (
  VALUES
    ('餐饮','早餐',1), ('餐饮','午餐',2), ('餐饮','晚餐',3), ('餐饮','外卖',4),
    ('交通','公交地铁',5), ('交通','打车',6),
    ('购物','日用',7),
    ('餐饮','零食',8), ('餐饮','买菜',9), ('餐饮','水果',10), ('餐饮','饮料',11),
    ('文娱','订阅会员',12),
    ('生活','水费',13), ('生活','电费',14), ('生活','燃气费',15), ('生活','话费网费',16),
    ('购物','服饰',17),
    ('餐饮','柴米油盐',18), ('餐饮','聚餐',19),
    ('交通','加油',20), ('交通','停车',21),
    ('生活','医疗',22),
    ('文娱','电影',23), ('文娱','运动',24),
    ('生活','美容美发',25),
    ('旅行','酒店',26),
    ('餐饮','宴请',27),
    ('交通','火车高铁',28), ('交通','机票',29),
    ('转账','还贷',30),
    ('购物','护肤美妆',31), ('购物','数码',32),
    ('文娱','游戏',33),
    ('生活','宠物',34),
    ('文娱','门票',35), ('文娱','演出',36), ('文娱','教育',37),
    ('生活','母婴',38),
    ('交通','汽车保养',39), ('交通','保险',40), ('交通','过路费',41),
    ('生活','物业维修',42), ('生活','租房',43),
    ('购物','纸巾',44),
    ('其他','红包',45), ('其他','礼金',46), ('其他','礼物',47),
    ('其他','赡养',48), ('其他','捐赠',49),
    ('转账','垫付',50),
    ('其他','丢失',51),
    ('餐饮','酒水',52)
)
UPDATE categories c
   SET display_order = m.ord
  FROM order_map m
  JOIN categories p
    ON p.family_id IS NULL AND p.type = 'expense' AND p.parent_id IS NULL AND p.name = m.parent_name
 WHERE c.family_id IS NULL
   AND c.type = 'expense'
   AND c.parent_id = p.id
   AND c.name = m.child_name
   AND c.is_parent_default = false;  -- 父默认子永远 display_order=NULL

COMMIT;

-- =========================================================================
-- 验收（SELECT 不影响幂等性，仅供 psql 输出参考）
-- =========================================================================
-- 1) 三�