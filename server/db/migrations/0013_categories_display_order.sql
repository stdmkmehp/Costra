-- 0013_categories_display_order.sql
--
-- 卡号：(分类展示顺序优化 · 2026-06-05)
-- 事实源：见 .codebuddy plan categories-display-order
--
-- 目标：
--   1. 引入 is_parent_default 字段，精确标记"点父一级时自动选中的默认子分类"，
--      不再依赖名称匹配（如"职业收入→工资"等非同名默认子也能正确表达）。
--   2. 引入 display_order 字段，控制全局二级展示区的展示顺序，
--      NULL = 不在全局展示区展示；有值 = 按升序展示（支出/收入 type 内独立编号）。
--
-- 字段语义对照：
--   is_direct_default —— 同名二级分类的"输入路由归属"标志（不变）
--   sort_order        —— 父级展开时的子分类顺序（不变）
--   is_parent_default —— 点父一级时的默认选中子（新增；UI 用此字段过滤全局展示区）
--   display_order     —— 全局展示区的展示顺序（新增；NULL=不展示）
--
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / UPDATE 全幂等
--
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. 新增字段
-- ---------------------------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_parent_default BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS display_order SMALLINT;

-- ---------------------------------------------------------------------------
-- 2. Partial unique index：每个父级最多 1 个 is_parent_default=true
--    仅对 "活跃 + 有父级 + is_parent_default=true" 的二级分类生效
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_parent_default
  ON categories (parent_id)
  WHERE is_parent_default = true AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. 回填 is_parent_default
--    规则：每个一级分类下 sort_order=1 的二级分类即为该一级的默认子分类
--    （0008 seed 中此约定一致：餐饮-餐饮、交通-交通、…、职业收入-工资、投资与资产-理财、意外收入-其他）
-- ---------------------------------------------------------------------------
UPDATE categories AS child
   SET is_parent_default = true
 WHERE child.parent_id IS NOT NULL
   AND child.deleted_at IS NULL
   AND child.is_system = true
   AND child.family_id IS NULL
   AND child.sort_order = 1;

-- ---------------------------------------------------------------------------
-- 4. 回填 display_order（支出 48 条，按高频排序）
--    使用 (name, type, parent_name) 三元组精确匹配，避免同名歧义。
--    is_parent_default=true 的子分类、is_direct_default=false 的同名副本，
--    均保持 display_order = NULL（不在全局展示区出现）。
-- ---------------------------------------------------------------------------

-- 支出
UPDATE categories AS c SET display_order = 1
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '外卖' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 2
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '买菜' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 3
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '打车' AND p.name = '交通';

UPDATE categories AS c SET display_order = 4
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '日用' AND p.name = '购物';

UPDATE categories AS c SET display_order = 5
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '水果' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 6
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '零食' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 7
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '饮料' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 8
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '公交' AND p.name = '交通';

UPDATE categories AS c SET display_order = 9
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '地铁' AND p.name = '交通';

UPDATE categories AS c SET display_order = 10
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '服饰' AND p.name = '购物';

UPDATE categories AS c SET display_order = 11
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '水电煤' AND p.name = '生活';

UPDATE categories AS c SET display_order = 12
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '话费网费' AND p.name = '生活';

UPDATE categories AS c SET display_order = 13
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '聚餐' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 14
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '柴米油盐' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 15
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '订阅会员' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 16
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '加油' AND p.name = '交通';

UPDATE categories AS c SET display_order = 17
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '停车' AND p.name = '交通';

UPDATE categories AS c SET display_order = 18
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '医疗' AND p.name = '生活';

UPDATE categories AS c SET display_order = 19
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '电影' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 20
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '运动' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 21
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '美容美发' AND p.name = '生活';

UPDATE categories AS c SET display_order = 22
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '酒店' AND p.name = '旅行';

UPDATE categories AS c SET display_order = 23
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '宴请' AND p.name = '餐饮';

UPDATE categories AS c SET display_order = 24
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '火车/高铁' AND p.name = '交通';

UPDATE categories AS c SET display_order = 25
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '机票' AND p.name = '交通';

UPDATE categories AS c SET display_order = 26
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '还贷' AND p.name = '转账';

UPDATE categories AS c SET display_order = 27
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '护肤美妆' AND p.name = '购物';

UPDATE categories AS c SET display_order = 28
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '数码' AND p.name = '购物';

UPDATE categories AS c SET display_order = 29
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '游戏' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 30
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '宠物' AND p.name = '生活';

UPDATE categories AS c SET display_order = 31
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '门票' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 32
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '演出' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 33
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '教育' AND p.name = '文娱';

UPDATE categories AS c SET display_order = 34
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '母婴' AND p.name = '生活';

UPDATE categories AS c SET display_order = 35
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '汽车保养' AND p.name = '交通';

UPDATE categories AS c SET display_order = 36
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '保险' AND p.name = '交通';

UPDATE categories AS c SET display_order = 37
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '过路费' AND p.name = '交通';

UPDATE categories AS c SET display_order = 38
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '物业维修' AND p.name = '生活';

UPDATE categories AS c SET display_order = 39
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '租房' AND p.name = '生活';

UPDATE categories AS c SET display_order = 40
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '纸巾' AND p.name = '购物';

UPDATE categories AS c SET display_order = 41
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '红包' AND p.name = '其他';

UPDATE categories AS c SET display_order = 42
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '礼金' AND p.name = '其他';

UPDATE categories AS c SET display_order = 43
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '礼物' AND p.name = '其他';

UPDATE categories AS c SET display_order = 44
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '赡养' AND p.name = '其他';

UPDATE categories AS c SET display_order = 45
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '捐赠' AND p.name = '其他';

UPDATE categories AS c SET display_order = 46
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '垫付' AND p.name = '其他';

UPDATE categories AS c SET display_order = 47
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '丢失' AND p.name = '其他';

UPDATE categories AS c SET display_order = 48
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'expense' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '酒水' AND p.name = '餐饮';

-- ---------------------------------------------------------------------------
-- 5. 回填 display_order（收入 10 条，独立从 1 起编号）
--    收入侧 is_parent_default 由 sort_order=1 回填得到：
--      职业收入→工资、投资与资产→理财、意外收入→其他
--    其余 10 条配 display_order
-- ---------------------------------------------------------------------------

-- 收入
UPDATE categories AS c SET display_order = 1
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '奖金' AND p.name = '职业收入';

UPDATE categories AS c SET display_order = 2
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '兼职' AND p.name = '职业收入';

UPDATE categories AS c SET display_order = 3
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '报销' AND p.name = '职业收入';

UPDATE categories AS c SET display_order = 4
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '收租' AND p.name = '投资与资产';

UPDATE categories AS c SET display_order = 5
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '利息' AND p.name = '投资与资产';

UPDATE categories AS c SET display_order = 6
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '红包' AND p.name = '意外收入';

UPDATE categories AS c SET display_order = 7
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '转账' AND p.name = '意外收入';

UPDATE categories AS c SET display_order = 8
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '礼金' AND p.name = '意外收入';

UPDATE categories AS c SET display_order = 9
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '中奖' AND p.name = '意外收入';

UPDATE categories AS c SET display_order = 10
  FROM categories AS p
 WHERE c.parent_id = p.id AND p.parent_id IS NULL
   AND c.type = 'income' AND c.family_id IS NULL AND c.deleted_at IS NULL
   AND c.name = '闲置出售' AND p.name = '意外收入';

-- ===========================================================================
-- END · 0013_categories_display_order.sql
-- ===========================================================================
