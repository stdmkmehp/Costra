-- 0007_category_icon_keys.sql
-- ═══════════════════════════════════════════════════════════════════════════════
-- 将系统分类 icon 列由「单字符」刷为「语义 icon_key」（对齐 design/categories.yaml）。
-- icon_key 端侧经 miniprogram/services/iconMap.ts 映射为 costra-icons 字体字形渲染。
--
-- 幂等：按 (name, type, parent) 定位；仅系统分类（family_id IS NULL）；只更新 icon 列。
-- 家庭自定义分类（family_id 非空）不受影响。
--
-- 说明：0001/0004 seed 仍保留历史「单字符」基线；本迁移在其后统一转换为 key，
-- 因此 fresh DB（0001→…→0007）与已部署 DB 收敛到同一结果。
--
-- ⚠️ 发布顺序：必须先发布「能识别 icon_key」的小程序新版并铺开，再执行本迁移，
--    否则线上旧版会把 key 当文本直接渲染。详见 docs/design/category-icon-migration-plan.md §8。
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 一级分类（parent_id IS NULL）───
UPDATE categories AS c SET icon = v.k FROM (VALUES
  ('餐饮', 'expense', 'dining'),
  ('交通', 'expense', 'transport'),
  ('购物', 'expense', 'shopping'),
  ('生活', 'expense', 'life'),
  ('旅行', 'expense', 'travel'),
  ('文娱', 'expense', 'entertainment'),
  ('转账', 'expense', 'transfer'),
  ('其他', 'expense', 'other'),
  ('职业收入', 'income', 'salary'),
  ('投资与资产', 'income', 'investment'),
  ('意外收入', 'income', 'windfall'),
  ('储值', 'transfer', 'stored_value'),
  ('账户互转', 'transfer', 'account_transfer'),
  ('赊销', 'transfer', 'credit')
) AS v(name, type, k)
WHERE c.family_id IS NULL AND c.parent_id IS NULL
  AND c.name = v.name AND c.type = v.type AND c.deleted_at IS NULL;

-- ─── 二级分类（按 父名 + 子名 + type 定位；含去重复用：多个节点 → 同一 key）───
UPDATE categories AS c SET icon = v.k FROM (VALUES
  -- 餐饮
  ('餐饮', '餐饮', 'expense', 'dining'),
  ('餐饮', '早餐', 'expense', 'breakfast'),
  ('餐饮', '午餐', 'expense', 'lunch'),
  ('餐饮', '晚餐', 'expense', 'dinner'),
  ('餐饮', '外卖', 'expense', 'takeout'),
  ('餐饮', '买菜', 'expense', 'groceries'),
  ('餐饮', '水果', 'expense', 'fruit'),
  ('餐饮', '零食', 'expense', 'snack'),
  ('餐饮', '饮料', 'expense', 'drink'),
  ('餐饮', '酒水', 'expense', 'alcohol'),
  ('餐饮', '柴米油盐', 'expense', 'condiment'),
  ('餐饮', '聚餐', 'expense', 'gathering_meal'),
  ('餐饮', '宴请', 'expense', 'banquet'),
  -- 交通
  ('交通', '交通', 'expense', 'transport'),
  ('交通', '打车', 'expense', 'taxi'),
  ('交通', '公交地铁', 'expense', 'transit'),
  ('交通', '加油', 'expense', 'fuel'),
  ('交通', '停车', 'expense', 'parking'),
  ('交通', '火车高铁', 'expense', 'train'),
  ('交通', '机票', 'expense', 'flight'),
  ('交通', '汽车保养', 'expense', 'car_maintenance'),
  ('交通', '保险', 'expense', 'insurance'),
  ('交通', '过路费', 'expense', 'toll'),
  -- 购物
  ('购物', '购物', 'expense', 'shopping'),
  ('购物', '日用', 'expense', 'daily_goods'),
  ('购物', '服饰', 'expense', 'clothing'),
  ('购物', '数码', 'expense', 'digital'),
  ('购物', '零食', 'expense', 'snack'),
  ('购物', '纸巾', 'expense', 'tissue'),
  ('购物', '饮料', 'expense', 'drink'),
  ('购物', '护肤美妆', 'expense', 'cosmetics'),
  -- 生活
  ('生活', '生活', 'expense', 'life'),
  ('生活', '日用', 'expense', 'daily_goods'),
  ('生活', '买菜', 'expense', 'groceries'),
  ('生活', '柴米油盐', 'expense', 'condiment'),
  ('生活', '宠物', 'expense', 'pet'),
  ('生活', '美容美发', 'expense', 'beauty'),
  ('生活', '水费', 'expense', 'water_bill'),
  ('生活', '电费', 'expense', 'electricity_bill'),
  ('生活', '燃气费', 'expense', 'gas_bill'),
  ('生活', '话费网费', 'expense', 'telecom_bill'),
  ('生活', '物业维修', 'expense', 'repair'),
  ('生活', '医疗', 'expense', 'medical'),
  ('生活', '母婴', 'expense', 'baby'),
  ('生活', '租房', 'expense', 'rent'),
  -- 旅行
  ('旅行', '旅行', 'expense', 'travel'),
  ('旅行', '机票', 'expense', 'flight'),
  ('旅行', '酒店', 'expense', 'hotel'),
  ('旅行', '交通', 'expense', 'transport'),
  ('旅行', '火车高铁', 'expense', 'train'),
  ('旅行', '餐饮', 'expense', 'dining'),
  -- 文娱
  ('文娱', '文娱', 'expense', 'entertainment'),
  ('文娱', '订阅会员', 'expense', 'subscription'),
  ('文娱', '演出', 'expense', 'performance'),
  ('文娱', '游戏', 'expense', 'game'),
  ('文娱', '运动', 'expense', 'sports'),
  ('文娱', '电影', 'expense', 'movie'),
  ('文娱', '门票', 'expense', 'ticket'),
  ('文娱', '教育', 'expense', 'education'),
  -- 转账
  ('转账', '转账', 'expense', 'transfer'),
  ('转账', '还贷', 'expense', 'loan_repay'),
  ('转账', '垫付', 'expense', 'advance_pay'),
  -- 其他
  ('其他', '其他', 'expense', 'other'),
  ('其他', '红包', 'expense', 'red_packet'),
  ('其他', '礼金', 'expense', 'cash_gift'),
  ('其他', '赡养', 'expense', 'support_family'),
  ('其他', '捐赠', 'expense', 'donation'),
  ('其他', '丢失', 'expense', 'lost'),
  ('其他', '礼物', 'expense', 'gift'),
  ('其他', '罚款', 'expense', 'fine'),
  -- 职业收入
  ('职业收入', '工资', 'income', 'salary'),
  ('职业收入', '奖金', 'income', 'bonus'),
  ('职业收入', '兼职', 'income', 'part_time'),
  ('职业收入', '报销', 'income', 'reimbursement'),
  -- 投资与资产
  ('投资与资产', '理财', 'income', 'investment'),
  ('投资与资产', '收租', 'income', 'rent_income'),
  ('投资与资产', '利息', 'income', 'interest'),
  -- 意外收入
  ('意外收入', '其他', 'income', 'windfall'),
  ('意外收入', '转账', 'income', 'transfer'),
  ('意外收入', '红包', 'income', 'red_packet'),
  ('意外收入', '退款', 'income', 'refund'),
  ('意外收入', '中奖', 'income', 'lottery'),
  ('意外收入', '闲置出售', 'income', 'resale'),
  ('意外收入', '礼金', 'income', 'cash_gift'),
  -- 储值
  ('储值', '储值', 'transfer', 'stored_value'),
  ('储值', '公交卡储值', 'transfer', 'transit_card'),
  ('储值', '饭卡储值', 'transfer', 'meal_card'),
  -- 账户互转
  ('账户互转', '账户互转', 'transfer', 'account_transfer'),
  -- 赊销
  ('赊销', '赊销', 'transfer', 'credit'),
  ('赊销', '花呗', 'transfer', 'huabei'),
  ('赊销', '白条', 'transfer', 'baitiao'),
  ('赊销', '月付', 'transfer', 'monthly_pay'),
  ('赊销', '信用卡', 'transfer', 'credit_card')
) AS v(pname, name, type, k)
WHERE c.family_id IS NULL AND c.deleted_at IS NULL
  AND c.name = v.name AND c.type = v.type
  AND c.parent_id = (
    SELECT p.id FROM categories p
    WHERE p.name = v.pname AND p.type = v.type
      AND p.parent_id IS NULL AND p.family_id IS NULL AND p.deleted_at IS NULL
    LIMIT 1
  );

COMMIT;
