// components/expense-overlay/categories.ts · 记账覆盖层分类数据（动态 API 数据源）
// 卡号: COSTRA-219 · 分类数据模型替换硬编码
// 历史记录: COSTRA-204 首建（硬编码）→ COSTRA-219 改为 API + 缓存
// 设计源: design/ui/category_dictionary.md

import {
  getCategories,
  buildCategoryTree,
  buildDedupMapping,
  buildDedupedSubCategories,
  warmUpMemoryCache,
} from '../../services/categoryService';

// ─── 导出接口（保留兼容 · id 改为 UUID string）─────────────────────────────────

/** 一级分类 */
export interface CategoryTier1 {
  id: string;
  name: string;
  icon: string;
  color?: string;
  children: CategoryTier2[];
}

/** 二级分类 */
export interface CategoryTier2 {
  id: string;
  name: string;
  icon: string;
  color?: string;
}

/** 去重直选归属映射：二级名 → 一级 id */
export interface DedupMapping {
  [subName: string]: string;
}

// ─── loadCategories 结果 ──────────────────────────────────────────────────────

export interface CategoryData {
  expense: CategoryTier1[];
  income: CategoryTier1[];
  expenseDedupedSubs: CategoryTier2[];
  incomeDedupedSubs: CategoryTier2[];
  dedupMapping: DedupMapping;
}

// ─── 异步加载 ──────────────────────────────────────────────────────────────────

/**
 * 从 categoryService 加载分类数据
 * 优先 API → 缓存 → fallback
 *
 * @param familyId 当前活跃家庭 ID
 * @returns 分类树 + 去重列表 + 去重映射
 */
export async function loadCategories(familyId: string): Promise<CategoryData> {
  const items = await getCategories(familyId);

  // 预热内存缓存（供 getCategoryById 快速查找）
  warmUpMemoryCache(familyId, items);

  const tree = buildCategoryTree(items);
  const dedupMapping = buildDedupMapping(items);

  const expenseDedupedSubs = buildDedupedSubCategories(items, 'expense');
  const incomeDedupedSubs = buildDedupedSubCategories(items, 'income');

  return {
    expense: tree.expense,
    income: tree.income,
    expenseDedupedSubs,
    incomeDedupedSubs,
    dedupMapping,
  };
}
