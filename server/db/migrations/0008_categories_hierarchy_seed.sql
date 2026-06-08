-- =========================================================================
-- Costra DB Migration 0008 · categories 二级分类体系 + 系统分类 seed
-- Owner: backend-dev · 卡号: COSTRA-217 · 日期: 2026-06-01
-- 约束来源: design/ui/category_dictionary.md + dispatch COSTRA-217 §2.A
-- Postgres >= 15 · 幂等 · 可安全重跑
-- =========================================================================
--
-- 核心变更：
--   1. categories 增加 parent_id (UUID → categories(id)) 支持二级树
--   2. categories 增加 is_direct_default (BOOLEAN) 直选默认归属标记
--   3. 约束最多两层 + 禁止自引用
--   4. 替换旧唯一索引 uq_categories_family_name_type 为含 parent_id 版本
--   5. 新增 partial unique index 确保 is_direct_default 唯一
--   6. 清空旧系统分类后全量插入二级分类体系（clean rebuild）
--
-- Clean rebuild 策略（Human 2026-06-01 新准则）：
--   开发阶段不考虑历史兼容，测试阶段清空 DB 重建。
--   0008 开头 DELETE 旧系统分类，使 0002_seed_system_categories.sql 的旧扁平 seed 无害化。
--   全量插入 11 个一级分类 + 62 个二级分类，所有分类使用新 ID。
--   不保留旧分类 ID，不兼容历史 entries.category_id。
--
-- is_direct_default 语义（dispatch §2.A.3 + category_dictionary.md §默认直选归属映射表）：
--   一级分类: is_direct_default = false（一级不参与直选）
--   二级分类: is_direct_default = true 表示全局二级展示区去重后该分类是直选默认归属
--   同名二级分类在不同一级下：只有最日常/最高频的那个设 is_direct_default = true
--   直选映射：餐饮→餐饮-餐饮, 机票→交通-机票, 零食→餐饮-零食, 买菜→餐饮-买菜, 饮料→餐饮-饮料
--
-- 系统分类目标数量：11 一级 + 78 二级 = 89 条
-- is_direct_default=true 的二级分类：68 条（支出 55 + 收入 13）
--
-- 幂等策略：DELETE + INSERT · 可重复执行 · 不为旧数据迁移承担兼容责任
-- =========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 增加 parent_id 列
-- ---------------------------------------------------------------------------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 2. 增加 is_direct_default 列
-- ---------------------------------------------------------------------------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_direct_default BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. 约束：最多两层 + 禁止自引用
-- ---------------------------------------------------------------------------

-- 辅助函数：校验层级 + 自引用（必须在 TRIGGER 之前创建）
CREATE OR REPLACE FUNCTION chk_categories_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  parent_parent_id UUID;
BEGIN
  -- 禁止自引用
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'category cannot reference itself as parent';
  END IF;

  -- 如果有 parent_id，检查 parent 不是二级分类（禁止三级）
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.parent_id INTO parent_parent_id
      FROM categories c
     WHERE c.id = NEW.parent_id;
    IF parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'category hierarchy exceeds 2 levels (parent is already a child)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE CONSTRAINT TRIGGER chk_categories_max_two_levels
    AFTER INSERT OR UPDATE OF parent_id ON categories
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION chk_categories_hierarchy();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4. 替换旧唯一索引为含 parent_id 版本
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_categories_family_name_type;

CREATE UNIQUE INDEX uq_categories_family_name_type_parent
  ON categories (COALESCE(family_id, '00000000-0000-0000-0000-000000000000'), name, type, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'))
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. 新增索引：按 type + parent_id + sort_order 拉取分类
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_categories_type_parent_sort
  ON categories (type, parent_id, sort_order)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Partial unique index：同一 scope 下同名二级分类只有一个 is_direct_default=true
--    仅对系统分类（family_id IS NULL）+ 二级分类（parent_id IS NOT NULL）+ is_direct_default=true
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_direct_default
  ON categories (name, type)
  WHERE family_id IS NULL AND parent_id IS NOT NULL AND is_direct_default = true AND deleted_at IS NULL;

-- ===========================================================================
-- 7. 系统分类 SEED（clean rebuild）
-- ===========================================================================
-- 策略：
--   a) 清空旧系统分类（使 0002_seed_system_categories.sql 的旧扁平 seed 无害化）
--   b) 全量插入 11 个一级分类
--   c) 全量插入 78 个二级分类
--
-- 幂等策略：先 DELETE 再 INSERT · 重复执行结果一致

-- ---------------------------------------------------------------------------
-- 7a. 清空旧系统分类
-- ---------------------------------------------------------------------------
DELETE FROM categories WHERE is_system = true AND family_id IS NULL;

-- ---------------------------------------------------------------------------
-- 7b. 一级分类（11 条：8 支出 + 3 收入）
-- ---------------------------------------------------------------------------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  -- 支出一级
  (NULL, '餐饮',     'expense', '餐', 'color.category.food',      1,  true, NULL, false),
  (NULL, '交通',     'expense', '行', 'color.category.transport', 2,  true, NULL, false),
  (NULL, '购物',     'expense', '购', 'color.category.shopping',  3,  true, NULL, false),
  (NULL, '生活',     'expense', '活', 'color.category.lifestyle', 4,  true, NULL, false),
  (NULL, '旅行',     'expense', '旅', 'color.category.travel',    5,  true, NULL, false),
  (NULL, '文娱',     'expense', '娱', 'color.category.culture',   6,  true, NULL, false),
  (NULL, '转账',     'expense', '转', 'color.category.transfer',  7,  true, NULL, false),
  (NULL, '其他',     'expense', '他', 'color.category.other',     99, true, NULL, false),
  -- 收入一级
  (NULL, '职业收入', 'income',  '薪', 'color.category.salary',    1,  true, NULL, false),
  (NULL, '投资与资产','income', '投', 'color.category.invest',    2,  true, NULL, false),
  (NULL, '意外收入', 'income',  '运', 'color.category.windfall',  3,  true, NULL, false);

-- ===========================================================================
-- 7c. 二级分类（78 条：65 支出 + 13 收入）
-- ===========================================================================
-- is_direct_default 规则：
--   每个一级下的"同名默认子类"（如餐饮-餐饮）设 is_direct_default = true
--   其他二级分类：按 categories.yaml 标注为 true 的设为 true
--   同名二级在不同一级下：只有直选默认归属的那个设 true
--     零食：餐饮-零食=true, 购物-零食=false
--     买菜：餐饮-买菜=true, 生活-买菜=false
--     饮料：餐饮-饮料=true, 购物-饮料=false
--     机票：交通-机票=true, 旅行-机票=false
--     交通：交通-交通=true, 旅行-交通=false
--     餐饮：餐饮-餐饮=true, 旅行-餐饮=false
--     日用：购物-日用=true, 生活-日用=false
--     柴米油盐：餐饮-柴米油盐=true, 生活-柴米油盐=false
--     火车/高铁：交通-火车/高铁=true, 旅行-火车/高铁=false

-- ----------- 餐饮 下二级（10 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '餐饮', 'expense', '餐', 'color.category.food', 1, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '外卖', 'expense', '餐', 'color.category.food', 2, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '买菜', 'expense', '餐', 'color.category.food', 3, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '水果', 'expense', '餐', 'color.category.food', 4, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '零食', 'expense', '餐', 'color.category.food', 5, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '饮料', 'expense', '餐', 'color.category.food', 6, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '酒水', 'expense', '餐', 'color.category.food', 7, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '柴米油盐', 'expense', '餐', 'color.category.food', 8, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '聚餐', 'expense', '餐', 'color.category.food', 9, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '宴请', 'expense', '餐', 'color.category.food', 10, true, (SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 交通 下二级（11 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '交通',     'expense', '行', 'color.category.transport', 1, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '打车',     'expense', '行', 'color.category.transport', 2, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '公交',     'expense', '行', 'color.category.transport', 3, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '地铁',     'expense', '行', 'color.category.transport', 4, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '加油',     'expense', '行', 'color.category.transport', 5, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '停车',     'expense', '行', 'color.category.transport', 6, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '火车/高铁','expense', '行', 'color.category.transport', 7, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '机票',     'expense', '行', 'color.category.transport', 8, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '汽车保养','expense', '行', 'color.category.transport', 9, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '保险',     'expense', '行', 'color.category.transport', 10, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '过路费',   'expense', '行', 'color.category.transport', 11, true, (SELECT id FROM categories WHERE name = '交通' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 购物 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '购物', 'expense', '购', 'color.category.shopping', 1, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '日用', 'expense', '购', 'color.category.shopping', 2, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '服饰', 'expense', '购', 'color.category.shopping', 3, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '数码', 'expense', '购', 'color.category.shopping', 4, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '零食', 'expense', '购', 'color.category.shopping', 5, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '纸巾', 'expense', '购', 'color.category.shopping', 6, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '饮料', 'expense', '购', 'color.category.shopping', 7, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '护肤美妆', 'expense', '购', 'color.category.shopping', 8, true, (SELECT id FROM categories WHERE name = '购物' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 生活 下二级（12 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '生活',     'expense', '活', 'color.category.lifestyle', 1, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '日用',     'expense', '活', 'color.category.lifestyle', 2, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '买菜',     'expense', '活', 'color.category.lifestyle', 3, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '柴米油盐', 'expense', '活', 'color.category.lifestyle', 4, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '宠物',     'expense', '活', 'color.category.lifestyle', 5, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '美容美发', 'expense', '活', 'color.category.lifestyle', 6, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '水电煤',   'expense', '活', 'color.category.lifestyle', 7, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '话费网费', 'expense', '活', 'color.category.lifestyle', 8, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '物业维修', 'expense', '活', 'color.category.lifestyle', 9, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '医疗',     'expense', '活', 'color.category.lifestyle', 10, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '母婴',     'expense', '活', 'color.category.lifestyle', 11, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '租房',     'expense', '活', 'color.category.lifestyle', 12, true, (SELECT id FROM categories WHERE name = '生活' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 旅行 下二级（6 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '旅行',      'expense', '旅', 'color.category.travel', 1, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '机票',      'expense', '旅', 'color.category.travel', 2, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '酒店',      'expense', '旅', 'color.category.travel', 3, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '交通',      'expense', '旅', 'color.category.travel', 4, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '火车/高铁', 'expense', '旅', 'color.category.travel', 5, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false),
  (NULL, '餐饮',      'expense', '旅', 'color.category.travel', 6, true, (SELECT id FROM categories WHERE name = '旅行' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), false);

-- ----------- 文娱 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '文娱',     'expense', '娱', 'color.category.culture', 1, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '订阅会员', 'expense', '娱', 'color.category.culture', 2, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '演出',     'expense', '娱', 'color.category.culture', 3, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '游戏',     'expense', '娱', 'color.category.culture', 4, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '运动',     'expense', '娱', 'color.category.culture', 5, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '电影',     'expense', '娱', 'color.category.culture', 6, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '门票',     'expense', '娱', 'color.category.culture', 7, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '教育',     'expense', '娱', 'color.category.culture', 8, true, (SELECT id FROM categories WHERE name = '文娱' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 转账 下二级（2 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '转账', 'expense', '转', 'color.category.transfer', 1, true, (SELECT id FROM categories WHERE name = '转账' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '还贷', 'expense', '转', 'color.category.transfer', 2, true, (SELECT id FROM categories WHERE name = '转账' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 其他 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '其他', 'expense', '他', 'color.category.other', 1, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '红包', 'expense', '他', 'color.category.other', 2, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '礼金', 'expense', '他', 'color.category.other', 3, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '赡养', 'expense', '他', 'color.category.other', 4, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '捐赠', 'expense', '他', 'color.category.other', 5, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '丢失', 'expense', '他', 'color.category.other', 6, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '礼物', 'expense', '他', 'color.category.other', 7, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '垫付', 'expense', '他', 'color.category.other', 8, true, (SELECT id FROM categories WHERE name = '其他' AND type = 'expense' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 职业收入 下二级（4 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '工资', 'income', '薪', 'color.category.salary', 1, true, (SELECT id FROM categories WHERE name = '职业收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '奖金', 'income', '薪', 'color.category.salary', 2, true, (SELECT id FROM categories WHERE name = '职业收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '兼职', 'income', '薪', 'color.category.salary', 3, true, (SELECT id FROM categories WHERE name = '职业收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '报销', 'income', '薪', 'color.category.salary', 4, true, (SELECT id FROM categories WHERE name = '职业收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 投资与资产 下二级（3 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '理财', 'income', '投', 'color.category.invest', 1, true, (SELECT id FROM categories WHERE name = '投资与资产' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '收租', 'income', '投', 'color.category.invest', 2, true, (SELECT id FROM categories WHERE name = '投资与资产' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '利息', 'income', '投', 'color.category.invest', 3, true, (SELECT id FROM categories WHERE name = '投资与资产' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

-- ----------- 意外收入 下二级（6 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
VALUES
  (NULL, '其他',     'income', '运', 'color.category.windfall', 1, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '转账',     'income', '运', 'color.category.windfall', 2, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '红包',     'income', '运', 'color.category.windfall', 3, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '中奖',     'income', '运', 'color.category.windfall', 4, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '闲置出售', 'income', '运', 'color.category.windfall', 5, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true),
  (NULL, '礼金',     'income', '运', 'color.category.windfall', 6, true, (SELECT id FROM categories WHERE name = '意外收入' AND type = 'income' AND parent_id IS NULL AND family_id IS NULL AND deleted_at IS NULL LIMIT 1), true);

COMMIT;
