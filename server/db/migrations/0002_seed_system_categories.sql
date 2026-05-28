-- =========================================================================
-- Costra 系统预设分类（family_id = NULL, is_system = true）（幂等 · 可安全重跑）
-- 参考：docs/design/ia.md §分类体系 · Design-Agent 给出的 12 个基础分类
-- =========================================================================
-- 幂等策略：使用 ON CONFLICT 在 uq_categories_family_name_type 唯一索引上做 DO NOTHING
-- 该索引定义：(COALESCE(family_id, '00000000-...'), name, type) WHERE deleted_at IS NULL
-- 因此需要用固定 UUID 作为系统分类 id，以便 ON CONFLICT 正确匹配

BEGIN;

INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system)
VALUES
    -- 支出
    (NULL, '餐饮',   'expense', 'icon.category.food',      'color.category.food',      1,  true),
    (NULL, '交通',   'expense', 'icon.category.transport', 'color.category.transport', 2,  true),
    (NULL, '购物',   'expense', 'icon.category.shopping',  'color.category.shopping',  3,  true),
    (NULL, '居家',   'expense', 'icon.category.home',      'color.category.home',      4,  true),
    (NULL, '娱乐',   'expense', 'icon.category.fun',       'color.category.fun',       5,  true),
    (NULL, '医疗',   'expense', 'icon.category.medical',   'color.category.medical',   6,  true),
    (NULL, '教育',   'expense', 'icon.category.edu',       'color.category.edu',       7,  true),
    (NULL, '其他',   'expense', 'icon.category.other',     'color.category.other',     99, true),
    -- 收入
    (NULL, '工资',   'income',  'icon.category.salary',    'color.category.salary',    1,  true),
    (NULL, '兼职',   'income',  'icon.category.side',      'color.category.side',      2,  true),
    (NULL, '理财',   'income',  'icon.category.invest',    'color.category.invest',    3,  true),
    (NULL, '其他',   'income',  'icon.category.other',     'color.category.other',     99, true)
ON CONFLICT (COALESCE(family_id, '00000000-0000-0000-0000-000000000000'), name, type)
    WHERE deleted_at IS NULL
DO NOTHING;

COMMIT;
