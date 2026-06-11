// components/expense-overlay/categories.ts · 记账覆盖层分类数据（动态 API 数据源）
// 卡号: COSTRA-219 · 分类数据模型替换硬编码
// 历史记录: COSTRA-204 首建（硬编码）→ COSTRA-219 改为 API + 缓存 → 2026-06-05 新增 loadCategoriesSync
// 设计源: design/ui/category_dictionary.md

import {
  getCategories,
  getCategoriesSync,
  refreshCategories,
  buildCategoryTree,
  buildDedupMapping,
  buildDedupedSubCategories,
  warmUpMemoryCache,
  computeCategoriesSignature,
  type CategoryItem,
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
  /**
   * 转移类目树（migration 0004 新增 · 不计入收支统计）。
   * 转移类目不进入全局二级展示区（display_order=NULL），故无 dedupedSubs。
   */
  transfer: CategoryTier1[];
  expenseDedupedSubs: CategoryTier2[];
  incomeDedupedSubs: CategoryTier2[];
  dedupMapping: DedupMapping;
  /** 数据签名（基于 items 的 UI 相关字段），用于增量刷新比对 */
  signature: string;
}

// ─── 工具：把扁平 items 组装成 CategoryData ─────────────────────────────────────

function buildCategoryData(items: CategoryItem[]): CategoryData {
  const tree = buildCategoryTree(items);
  const dedupMapping = buildDedupMapping(items);
  const expenseDedupedSubs = buildDedupedSubCategories(items, 'expense');
  const incomeDedupedSubs = buildDedupedSubCategories(items, 'income');
  return {
    expense: tree.expense,
    income: tree.income,
    transfer: tree.transfer,
    expenseDedupedSubs,
    incomeDedupedSubs,
    dedupMapping,
    signature: computeCategoriesSignature(items),
  };
}

// ─── 异步加载 ──────────────────────────────────────────────────────────────────

/**
 * 从 categoryService 异步加载分类数据
 * 优先 API → 缓存 → fallback（永远 await 完成）
 *
 * 使用场景：可以容忍网络等待的路径（极少见，目前没有调用方）。
 * 大多数 UI 路径应使用 loadCategoriesSync + refreshCategoryDataAsync 组合。
 *
 * @param familyId 当前活跃家庭 ID
 */
export async function loadCategories(familyId: string): Promise<CategoryData> {
  const items = await getCategories(familyId);
  warmUpMemoryCache(familyId, items);
  return buildCategoryData(items);
}

// ─── 同步加载 + 后台刷新（用户感知敏感路径）─────────────────────────────────────

/**
 * 同步加载分类数据（永不阻塞，永不调网络）。
 * 用于"打开记账面板/分类编辑面板"等用户感知敏感路径。
 *
 * 命中策略：内存缓存命中 → 用之；否则用内嵌 fallback。
 */
export function loadCategoriesSync(familyId: string): CategoryData {
  const items = getCategoriesSync(familyId);
  return buildCategoryData(items);
}

/**
 * 后台异步刷新分类数据（fire-and-forget 风格）。
 * 与 loadCategoriesSync 配合：先同步打开 UI，再后台异步刷新。
 *
 * 调用方负责自行比对返回值的 signature 与刷新前 oldSignature 决定是否 setData。
 *
 * @param familyId 活跃家庭 ID
 * @returns 最新 CategoryData（含 signature）
 */
export async function refreshCategoryDataAsync(familyId: string): Promise<CategoryData> {
  const items = await refreshCategories(familyId);
  return buildCategoryData(items);
}

