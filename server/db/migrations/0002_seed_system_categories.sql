-- =========================================================================
-- Costra 系统预设分类（family_id = NULL, is_system = true）
-- 参考：docs/design/ia.md §分类体系 · Design-Agent 给出的 12 个基础分类
-- =========================================================================

BEGIN;

INSERT INTO categories (id, family_id, name, type, icon, color, sort_order, is_system)
VALUES
    -- 支出
    (gen_random_uuid(), NULL, '餐饮',   'expense', 'icon.category.food',      'color.category.food',      1,  true),
    (gen_random_uuid(), NULL, '交通',   'expense', 'icon.category.transport', 'color.category.transport', 2,  true),
    (gen_random_uuid(), NULL, '购物',   'expense', 'icon.category.shopping',  'color.category.shopping',  3,  true),
    (gen_random_uuid(), NULL, '居家',   'expense', 'icon.category.home',      'color.category.home',      4,  true),
    (gen_random_uuid(), NULL, '娱乐',   'expense', 'icon.category.fun',       'color.category.fun',       5,  true),
    (gen_random_uuid(), NULL, '医疗',   'expense', 'icon.category.medical',   'color.category.medical',   6,  true),
    (gen_random_uuid(), NULL, '教育',   'expense', 'icon.category.edu',       'color.category.edu',       7,  true),
    (gen_random_uuid(), NULL, '其他',   'expense', 'icon.category.other',     'color.category.other',     99, true),
    -- 收入
    (gen_random_uuid(), NULL, '工资',   'income',  'icon.category.salary',    'color.category.salary',    1,  true),
    (gen_random_uuid(), NULL, '兼职',   'income',  'icon.category.side',      'color.category.side',      2,  true),
    (gen_random_uuid(), NULL, '理财',   'income',  'icon.category.invest',    'color.category.invest',    3,  true),
    (gen_random_uuid(), NULL, '其他',   'income',  'icon.category.other',     'color.category.other',     99, true);

COMMIT;
