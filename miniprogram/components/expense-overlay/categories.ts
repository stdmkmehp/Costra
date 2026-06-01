// components/expense-overlay/categories.ts · 记账覆盖层分类数据（硬编码 · 后续卡对接 API 替换）
// 卡号: COSTRA-204 · 数据源: design/ui/category_dictionary.md

/** 一级分类 */
export interface CategoryTier1 {
  id: string;
  name: string;
  icon: string;
  children: CategoryTier2[];
}

/** 二级分类 */
export interface CategoryTier2 {
  id: string;
  name: string;
}

/** 去重直选归属映射：二级名 → 一级 id */
export interface DedupMapping {
  [subName: string]: string;
}

// ─── 支出分类 ──────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES: readonly CategoryTier1[] = [
  {
    id: 'food', name: '餐饮', icon: '餐',
    children: [
      { id: 'food_dining', name: '餐饮' },
      { id: 'food_delivery', name: '外卖' },
      { id: 'food_groceries', name: '买菜' },
      { id: 'food_snacks', name: '零食' },
      { id: 'food_beverages', name: '饮料' },
      { id: 'food_drinks', name: '酒水' },
    ],
  },
  {
    id: 'transport', name: '交通', icon: '行',
    children: [
      { id: 'transport_transit', name: '交通' },
      { id: 'transport_taxi', name: '打车' },
      { id: 'transport_bus', name: '公交' },
      { id: 'transport_subway', name: '地铁' },
      { id: 'transport_train', name: '火车/高铁' },
      { id: 'transport_flight', name: '机票' },
    ],
  },
  {
    id: 'shopping', name: '购物', icon: '购',
    children: [
      { id: 'shopping_general', name: '购物' },
      { id: 'shopping_daily', name: '日用' },
      { id: 'shopping_clothing', name: '服饰' },
      { id: 'shopping_electronics', name: '数码' },
      { id: 'shopping_snacks', name: '零食' },
      { id: 'shopping_tissues', name: '纸巾' },
      { id: 'shopping_beverages', name: '饮料' },
    ],
  },
  {
    id: 'lifestyle', name: '生活', icon: '活',
    children: [
      { id: 'lifestyle_general', name: '生活' },
      { id: 'lifestyle_groceries', name: '买菜' },
      { id: 'lifestyle_beauty', name: '护肤美容' },
      { id: 'lifestyle_pets', name: '宠物' },
      { id: 'lifestyle_housing', name: '住房' },
      { id: 'lifestyle_utilities', name: '水电煤' },
      { id: 'lifestyle_phone', name: '话费网费' },
      { id: 'lifestyle_maintenance', name: '物业维修' },
      { id: 'lifestyle_home', name: '家居' },
    ],
  },
  {
    id: 'travel', name: '旅行', icon: '旅',
    children: [
      { id: 'travel_general', name: '旅行' },
      { id: 'travel_flight', name: '机票' },
      { id: 'travel_hotel', name: '酒店' },
      { id: 'travel_transit', name: '交通' },
      { id: 'travel_train', name: '火车' },
      { id: 'travel_dining', name: '餐饮' },
    ],
  },
  {
    id: 'entertainment', name: '文娱', icon: '娱',
    children: [
      { id: 'entertainment_general', name: '文娱' },
      { id: 'entertainment_games', name: '游戏' },
      { id: 'entertainment_movies', name: '电影' },
      { id: 'entertainment_tickets', name: '门票' },
      { id: 'entertainment_education', name: '教育' },
      { id: 'entertainment_medical', name: '医疗' },
      { id: 'entertainment_books', name: '书籍' },
      { id: 'entertainment_sports', name: '运动' },
    ],
  },
  {
    id: 'auto', name: '汽车', icon: '车',
    children: [
      { id: 'auto_general', name: '汽车' },
      { id: 'auto_gas', name: '加油' },
      { id: 'auto_parking', name: '停车' },
      { id: 'auto_maintenance', name: '保养' },
      { id: 'auto_tolls', name: '过路费' },
    ],
  },
  {
    id: 'others', name: '其他', icon: '他',
    children: [
      { id: 'others_general', name: '其他' },
      { id: 'others_social', name: '人情' },
      { id: 'others_donations', name: '捐赠' },
      { id: 'others_lost', name: '丢失' },
    ],
  },
] as const;

// ─── 收入分类 ──────────────────────────────────────────────────────────────────

export const INCOME_CATEGORIES: readonly CategoryTier1[] = [
  {
    id: 'career', name: '职业收入', icon: '薪',
    children: [
      { id: 'career_salary', name: '工资' },
      { id: 'career_bonus', name: '奖金' },
      { id: 'career_parttime', name: '兼职' },
      { id: 'career_reimbursement', name: '报销' },
    ],
  },
  {
    id: 'investment', name: '投资与资产', icon: '投',
    children: [
      { id: 'investment_general', name: '理财' },
      { id: 'investment_rent', name: '收租' },
      { id: 'investment_interest', name: '利息' },
    ],
  },
  {
    id: 'windfall', name: '意外所得', icon: '运',
    children: [
      { id: 'windfall_gifts', name: '人情' },
      { id: 'windfall_lottery', name: '中奖' },
      { id: 'windfall_secondhand', name: '闲置出售' },
      { id: 'windfall_others', name: '其他' },
    ],
  },
] as const;

// ─── 去重直选归属映射 ──────────────────────────────────────────────────────────
// 数据源: category_dictionary.md "默认直选归属映射表"

export const DEDUP_MAPPING: DedupMapping = {
  '餐饮': 'food',
  '机票': 'transport',
  '零食': 'food',
  '买菜': 'food',
  '饮料': 'food',
} as const;

// ─── 去重二级分类列表构建 ──────────────────────────────────────────────────────

/** 构建去重后的二级分类列表（同名仅展示一次） */
export function buildDedupedSubCategories(categories: readonly CategoryTier1[]): CategoryTier2[] {
  const seen = new Set<string>();
  const result: CategoryTier2[] = [];
  for (const tier1 of categories) {
    for (const sub of tier1.children) {
      if (!seen.has(sub.name)) {
        seen.add(sub.name);
        result.push({ id: sub.id, name: sub.name });
      }
    }
  }
  return result;
}

export const EXPENSE_DEDUPED_SUBS = buildDedupedSubCategories(EXPENSE_CATEGORIES);
export const INCOME_DEDUPED_SUBS = buildDedupedSubCategories(INCOME_CATEGORIES);
