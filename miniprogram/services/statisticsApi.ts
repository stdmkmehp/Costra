// services/statisticsApi.ts · 统计页 API 调用层
// 卡号: COSTRA-225 · 配套后端 COSTRA-224
// 契约事实源: api/openapi.yaml /families/{id}/statistics/* + server/src/services/statisticsService.ts
// 金额单位: API 返回 cents（整数），前端展示时 ÷ 100

import { request } from './request';

// ─── 类型定义（与后端 statisticsService.ts 对齐）─────────────────────────────────

export interface StatCategoryRankItem {
  category_id: string | null;
  category_name: string;
  icon: string;
  amount: number;
  entry_count: number;
  ratio_bps: number;
}

export interface StatTotals {
  expense: number;
  income: number;
  balance: number;
  entry_count: number;
}

export interface MonthlyExtremes {
  avg_daily_expense: number;
  max_single_expense: number;
  max_single_note: string | null;
  max_single_category_name: string | null;
  max_day_expense: number;
}

export interface DailyTrendItem {
  day: number;
  expense: number;
  income: number;
}

export interface MonthlyStatistics {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  month: string;
  timezone: 'Asia/Shanghai';
  range_start: string;
  range_end: string;
  currency: 'CNY';
  totals: StatTotals;
  daily_trend: DailyTrendItem[];
  extremes: MonthlyExtremes;
  category_ranks: StatCategoryRankItem[];
  /** COSTRA-260: null 表示全部，string 表示按 user_id 过滤 */
  filtered_user_id?: string | null;
}

export interface MonthlyTrendItem {
  month: number;
  expense: number;
  income: number;
  balance: number;
  entry_count: number;
}

export interface YearlyExtremes {
  avg_monthly_expense: number;
  max_single_expense: number;
  max_single_note: string | null;
  max_single_category_name: string | null;
  max_month_expense: number;
  max_month_label: string;
  top_category_name: string | null;
  top_category_amount: number;
}

export interface YearlyStatistics {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  year: string;
  timezone: 'Asia/Shanghai';
  range_start: string;
  range_end: string;
  currency: 'CNY';
  totals: StatTotals;
  monthly_trend: MonthlyTrendItem[];
  extremes: YearlyExtremes;
  category_ranks: StatCategoryRankItem[];
  /** COSTRA-260: null 表示全部，string 表示按 user_id 过滤 */
  filtered_user_id?: string | null;
}

export interface DrillDownLevel2Response {
  level: 2;
  parent_category_id: string;
  parent_category_name: string;
  parent_amount: number;
  items: StatCategoryRankItem[];
  total_count: number;
  has_more: boolean;
}

export interface DrillDownEntryItem {
  entry_id: string;
  amount: number;
  note: string | null;
  occurred_at: string;
  shared_type: 'shared' | 'personal' | null;
  source_recurring_id: string | null;
  created_by: string;
  nickname: string;
  avatar_url: string | null;
}

export interface DrillDownLevel3Response {
  level: 3;
  category_id: string;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  category_amount: number;
  items: DrillDownEntryItem[];
  total_count: number;
  has_more: boolean;
}

// ─── 缓存层（stale-while-revalidate · 与 familyApi 一致风格）────────────────────

const STAT_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const MAX_CACHE_SIZE = 20;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _monthlyCache = new Map<string, CacheEntry<MonthlyStatistics>>();
const _yearlyCache = new Map<string, CacheEntry<YearlyStatistics>>();
/** L2/L3 page-lifetime 缓存（不带 TTL · 由 SYNC_DONE 主动失效） */
const _drillCache = new Map<string, DrillDownLevel2Response | DrillDownLevel3Response>();

function monthlyKey(familyId: string, month: string, userId?: string): string {
  return `${familyId}:${month}:${userId ?? 'all'}`;
}

function yearlyKey(familyId: string, year: string, userId?: string): string {
  return `${familyId}:${year}:${userId ?? 'all'}`;
}

function setCacheLRU<T>(map: Map<string, CacheEntry<T>>, key: string, data: T): void {
  if (map.size >= MAX_CACHE_SIZE && !map.has(key)) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of map) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) map.delete(oldestKey);
  }
  map.set(key, { data, timestamp: Date.now() });
}

export function getCachedMonthly(familyId: string, month: string, userId?: string): MonthlyStatistics | null {
  const entry = _monthlyCache.get(monthlyKey(familyId, month, userId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > STAT_CACHE_TTL) return null;
  return entry.data;
}

export function getCachedYearly(familyId: string, year: string, userId?: string): YearlyStatistics | null {
  const entry = _yearlyCache.get(yearlyKey(familyId, year, userId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > STAT_CACHE_TTL) return null;
  return entry.data;
}

/**
 * 失效指定家庭的所有统计缓存（SYNC_DONE 时调用）
 */
export function invalidateStatisticsCache(familyId: string): void {
  for (const key of _monthlyCache.keys()) {
    if (key.startsWith(`${familyId}:`)) _monthlyCache.delete(key);
  }
  for (const key of _yearlyCache.keys()) {
    if (key.startsWith(`${familyId}:`)) _yearlyCache.delete(key);
  }
  for (const key of _drillCache.keys()) {
    if (key.startsWith(`${familyId}:`)) _drillCache.delete(key);
  }
}

// ─── API 函数 ────────────────────────────────────────────────────────────────────

/**
 * 月度统计
 * GET /v1/families/{id}/statistics/monthly?month=YYYY-MM[&top_n=20][&user_id=...]
 */
export async function getMonthlyStatistics(
  familyId: string,
  month: string,
  options?: { topN?: number; userId?: string },
): Promise<MonthlyStatistics> {
  const params: Record<string, string | number> = { month };
  if (options?.topN) params.top_n = options.topN;
  if (options?.userId) params.user_id = options.userId;
  const data = await request<MonthlyStatistics>({
    method: 'GET',
    path: `/families/${familyId}/statistics/monthly`,
    query: params,
  });
  setCacheLRU(_monthlyCache, monthlyKey(familyId, month, options?.userId), data);
  return data;
}

/**
 * 年度统计
 * GET /v1/families/{id}/statistics/yearly?year=YYYY[&top_n=20][&user_id=...]
 */
export async function getYearlyStatistics(
  familyId: string,
  year: string,
  options?: { topN?: number; userId?: string },
): Promise<YearlyStatistics> {
  const params: Record<string, string | number> = { year };
  if (options?.topN) params.top_n = options.topN;
  if (options?.userId) params.user_id = options.userId;
  const data = await request<YearlyStatistics>({
    method: 'GET',
    path: `/families/${familyId}/statistics/yearly`,
    query: params,
  });
  setCacheLRU(_yearlyCache, yearlyKey(familyId, year, options?.userId), data);
  return data;
}

/**
 * 下钻：二级分类排行
 * GET /v1/families/{id}/statistics/drill-down?month|year=...&level=2&parent_category_id=...[&user_id=...]
 */
export async function drillDownLevel2(
  familyId: string,
  scope: { month?: string; year?: string },
  parentCategoryId: string,
  options?: { limit?: number; offset?: number; userId?: string },
): Promise<DrillDownLevel2Response> {
  const userId = options?.userId;
  const cacheKey = `${familyId}:${scope.month ?? scope.year}:L2:${parentCategoryId}:${userId ?? 'all'}:${options?.limit ?? 10}:${options?.offset ?? 0}`;
  const cached = _drillCache.get(cacheKey);
  if (cached && cached.level === 2) return cached;

  const params: Record<string, string | number> = {
    level: 2,
    parent_category_id: parentCategoryId,
  };
  if (scope.month) params.month = scope.month;
  if (scope.year) params.year = scope.year;
  if (options?.limit != null) params.limit = options.limit;
  if (options?.offset != null) params.offset = options.offset;
  if (userId) params.user_id = userId;

  const data = await request<DrillDownLevel2Response>({
    method: 'GET',
    path: `/families/${familyId}/statistics/drill-down`,
    query: params,
  });
  _drillCache.set(cacheKey, data);
  return data;
}

/**
 * 下钻：单笔明细
 * GET /v1/families/{id}/statistics/drill-down?month|year=...&level=3&category_id=...[&user_id=...]
 */
export async function drillDownLevel3(
  familyId: string,
  scope: { month?: string; year?: string },
  categoryId: string,
  options?: { limit?: number; offset?: number; userId?: string },
): Promise<DrillDownLevel3Response> {
  const userId = options?.userId;
  const cacheKey = `${familyId}:${scope.month ?? scope.year}:L3:${categoryId}:${userId ?? 'all'}:${options?.limit ?? 10}:${options?.offset ?? 0}`;
  const cached = _drillCache.get(cacheKey);
  if (cached && cached.level === 3) return cached;

  const params: Record<string, string | number> = {
    level: 3,
    category_id: categoryId,
  };
  if (scope.month) params.month = scope.month;
  if (scope.year) params.year = scope.year;
  if (options?.limit != null) params.limit = options.limit;
  if (options?.offset != null) params.offset = options.offset;
  if (userId) params.user_id = userId;

  const data = await request<DrillDownLevel3Response>({
    method: 'GET',
    path: `/families/${familyId}/statistics/drill-down`,
    query: params,
  });
  _drillCache.set(cacheKey, data);
  return data;
}
