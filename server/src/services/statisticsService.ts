/**
 * Costra · Server · 统计页业务编排层
 *
 * 卡号：COSTRA-224 / COSTRA-260 · 事实源：docs/design/statistics-page-tech-spec.md §3
 *
 * 职责：
 *   - getMonthlyStatistics: 月度统计主接口
 *   - getYearlyStatistics: 年度统计主接口
 *   - getDrillDown: L2/L3 下钻
 *   - 校验 month/year/level/分页参数
 *   - 权限守门复用 familyService.assertActiveMember
 *   - Asia/Shanghai 时区下的日/月分桶（JS 实现 · 不依赖 PG date_trunc + AT TIME ZONE）
 *
 * 设计原则：
 *   - 金额全程 integer cents，不使用 float
 *   - ratio 使用 basis points (0~10000)，四舍五入
 *   - 空月份/空年份返回全 0 与空数组，不返回 404
 *   - 与 family summary 口径一致：transfer 不计入；shared_type IS NULL 的 expense 不计入
 *   - 已退出成员的历史 expense 仍计入
 *
 * COSTRA-260: 新增 userId（成员维度过滤）支持：
 *   - 不传 userId = 家庭总览（行为不变）
 *   - 传 userId：按 entries.created_by = userId 过滤
 *   - 越权防护：userId 必须是该 family 的成员（active 或 left），否则 FORBIDDEN
 *   - 响应 payload 加 filtered_user_id 顶层字段（monthly / yearly）
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as familyService from './familyService.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as statsRepo from '../repositories/statisticsRepo.js';

// === Wire 响应类型 ===

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
  day: number;        // 1~31
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
  filtered_user_id: string | null;
  totals: StatTotals;
  daily_trend: DailyTrendItem[];
  extremes: MonthlyExtremes;
  /** 支出分类排行（一级折叠） */
  category_ranks: StatCategoryRankItem[];
  /** 收入分类排行（一级折叠） · 收入分类排行迭代新增 */
  income_category_ranks: StatCategoryRankItem[];
}

export interface MonthlyTrendItem {
  month: number;      // 1~12
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
  max_month_label: string;          // '8月' · 没数据时空串
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
  filtered_user_id: string | null;
  totals: StatTotals;
  monthly_trend: MonthlyTrendItem[];
  extremes: YearlyExtremes;
  /** 支出分类排行（一级折叠） */
  category_ranks: StatCategoryRankItem[];
  /** 收入分类排行（一级折叠） · 收入分类排行迭代新增 */
  income_category_ranks: StatCategoryRankItem[];
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

export interface DrillDownLevel3Response {
  level: 3;
  category_id: string;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  category_amount: number;
  items: Array<{
    entry_id: string;
    amount: number;
    note: string | null;
    occurred_at: string;
    shared_type: 'shared' | 'personal' | null;
    source_recurring_id: string | null;
    created_by: string;
    nickname: string;
    avatar_url: string | null;
  }>;
  total_count: number;
  has_more: boolean;
}

// === 辅助函数 ===

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 计算 basis points（万分比），四舍五入 */
function calcBps(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 10000);
}

/** 校验 month=YYYY-MM */
function validateMonth(month: string): void {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be YYYY-MM format',
      details: { field: 'month', value: month, constraint: 'YYYY-MM' },
    });
  }
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be between 01 and 12',
      details: { field: 'month', value: month, constraint: '01-12' },
    });
  }
}

/** 校验 year=YYYY */
function validateYear(year: string): void {
  if (!/^\d{4}$/.test(year)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'year must be YYYY format',
      details: { field: 'year', value: year, constraint: 'YYYY' },
    });
  }
  const y = Number(year);
  if (y < 1900 || y > 9999) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'year out of range',
      details: { field: 'year', value: year, constraint: '1900-9999' },
    });
  }
}

/**
 * 解析 month=YYYY-MM 为 UTC 区间 [start, end)
 * 时区固定 Asia/Shanghai (+08:00)
 */
function parseMonthRange(month: string): { rangeStartUtc: string; rangeEndUtc: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const startShanghai = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - SHANGHAI_OFFSET_MS);
  const endShanghai = new Date(Date.UTC(year, mon, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - SHANGHAI_OFFSET_MS);
  return {
    rangeStartUtc: startUtc.toISOString(),
    rangeEndUtc: endUtc.toISOString(),
  };
}

/** 解析 year=YYYY 为 UTC 区间 [start, end)（Asia/Shanghai 时区） */
function parseYearRange(year: string): { rangeStartUtc: string; rangeEndUtc: string } {
  const y = Number(year);
  const startShanghai = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - SHANGHAI_OFFSET_MS);
  const endShanghai = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - SHANGHAI_OFFSET_MS);
  return {
    rangeStartUtc: startUtc.toISOString(),
    rangeEndUtc: endUtc.toISOString(),
  };
}

/** UTC ISO → Asia/Shanghai 的日（1~31） */
function getShanghaiDay(occurredAtUtc: string): number {
  const utc = new Date(occurredAtUtc);
  const shanghai = new Date(utc.getTime() + SHANGHAI_OFFSET_MS);
  return shanghai.getUTCDate();
}

/** UTC ISO → Asia/Shanghai 的月（1~12） */
function getShanghaiMonth(occurredAtUtc: string): number {
  const utc = new Date(occurredAtUtc);
  const shanghai = new Date(utc.getTime() + SHANGHAI_OFFSET_MS);
  return shanghai.getUTCMonth() + 1;
}

/** 当月天数（按 Asia/Shanghai 即可，因日期与 UTC+8 月份一致） */
function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 当前时刻在 Asia/Shanghai 时区下的 { year, month(1~12), day(1~31) } */
function getShanghaiNowParts(): { year: number; month: number; day: number } {
  const shanghai = new Date(Date.now() + SHANGHAI_OFFSET_MS);
  return {
    year: shanghai.getUTCFullYear(),
    month: shanghai.getUTCMonth() + 1,
    day: shanghai.getUTCDate(),
  };
}

/**
 * 计算某月「至今已过去的天数」，作为日均支出的分母。
 *   - 历史月：整月天数（daysInMonth）
 *   - 当前月：今天的日期（如 2 号→2，避免月初除以整月导致日均被低估）
 *   - 未来月：0（尚未开始，调用方据此把日均置 0）
 */
function elapsedDaysInMonth(year: number, month: number, daysInMonth: number): number {
  const now = getShanghaiNowParts();
  if (year > now.year || (year === now.year && month > now.month)) return 0;
  if (year === now.year && month === now.month) return now.day;
  return daysInMonth;
}

/**
 * 计算某年「至今已过去的月份数」，作为月均支出的分母。
 *   - 历史年：12
 *   - 当前年：当前月份（如 7 月→7）
 *   - 未来年：0
 */
function elapsedMonthsInYear(year: number): number {
  const now = getShanghaiNowParts();
  if (year > now.year) return 0;
  if (year === now.year) return now.month;
  return 12;
}

/**
 * COSTRA-260: 成员维度越权校验。
 *
 * 如果 input.userId 存在且不等于 callerUserId，
 * 校验 input.userId 是否为 familyId 的成员（active 或 left 都算）。
 * 不通过抛 FAMILY_NOT_MEMBER。
 *
 * userId === callerUserId 时跳过第二次校验（callerUserId 已经被 assertActiveMember 校验过）。
 */
async function assertUserIdBelongsToFamily(
  callerUserId: string,
  familyId: string,
  targetUserId?: string,
): Promise<void> {
  if (!targetUserId) return;
  if (targetUserId === callerUserId) return;
  const belongs = await familyMemberRepo.isMemberIncludingLeft(targetUserId, familyId);
  if (!belongs) {
    throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
      message: 'target user_id is not a member of this family',
      details: { family_id: familyId, user_id: targetUserId },
    });
  }
}

// === L1 排行构建（共享逻辑） ===

interface L1AggMap {
  byParentId: Map<string, { amount: number; entry_count: number }>;
  totalExpense: number;
}

/**
 * 从 entry category_id 聚合 + categories meta，折叠成"一级分类"聚合。
 *
 * 逻辑：
 *   - 二级分类按 parent_id 归并到一级
 *   - 一级分类直记（`POST /categories` 的 parent_id 可空，家庭可自建一级分类；
 *     导入 / sync / 历史数据也可能写入一级 id）→ 以自身 id 参与排行，
 *     否则这些金额会被静默丢弃，并连带缩小 ratio 分母
 *   - meta 缺失（分类已软删，不可见）才跳过
 */
function foldCategoriesToL1(
  categoryAggs: statsRepo.CategoryRankAggRow[],
  categoryMetas: Map<string, statsRepo.CategoryMeta>,
): L1AggMap {
  const byParentId = new Map<string, { amount: number; entry_count: number }>();
  let totalExpense = 0;

  for (const agg of categoryAggs) {
    const meta = categoryMetas.get(agg.category_id);
    if (!meta) continue;
    const parentId = meta.parent_id ?? meta.id;
    const acc = byParentId.get(parentId) ?? { amount: 0, entry_count: 0 };
    acc.amount += agg.amount;
    acc.entry_count += agg.entry_count;
    byParentId.set(parentId, acc);
    totalExpense += agg.amount;
  }
  return { byParentId, totalExpense };
}

/** 把 L1 聚合 + parent meta 转为排行 items（amount > 0 · 降序 · top_n 截断） */
function buildL1RankItems(
  l1: L1AggMap,
  parentMetas: Map<string, statsRepo.CategoryMeta>,
  topN: number,
): StatCategoryRankItem[] {
  const items: StatCategoryRankItem[] = [];
  for (const [parentId, agg] of l1.byParentId.entries()) {
    if (agg.amount <= 0) continue;
    const meta = parentMetas.get(parentId);
    items.push({
      category_id: parentId,
      category_name: meta?.name ?? '未分类',
      icon: meta?.icon ?? '',
      amount: agg.amount,
      entry_count: agg.entry_count,
      ratio_bps: calcBps(agg.amount, l1.totalExpense),
    });
  }
  return items
    .sort((a, b) => (b.amount - a.amount) || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'))
    .slice(0, topN);
}

// === 排行构建高层 · 收入分类排行迭代 ===
//
// monthly / yearly 都是"支出+收入并列输出 category_ranks"。
// 抽取模式：拉两次分类聚合（expense/income）→ 合并去重后一次批量查 category meta →
// 分别 foldCategoriesToL1 → 合并一级 id 一次批量查 parent meta → 分别 buildL1RankItems。
// 见 getMonthlyStatistics / getYearlyStatistics 内联实现。

// === API 1: 月度统计 ===

export async function getMonthlyStatistics(
  userId: string,
  input: { familyId: string; month: string; topN?: number; userId?: string },
): Promise<MonthlyStatistics> {
  validateMonth(input.month);
  const topN = input.topN ?? 20;
  if (topN < 1 || topN > 50) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'top_n must be between 1 and 50',
      details: { field: 'top_n', value: topN, constraint: '1-50' },
    });
  }

  await familyService.assertActiveMember(userId, input.familyId);
  await assertUserIdBelongsToFamily(userId, input.familyId, input.userId);

  const family = await familyRepo.findById(input.familyId);
  if (!family) throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });

  const ledger = await ledgerRepo.findFirstByFamilyId(input.familyId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'family ledger not found',
      details: { ledger_missing: true },
    });
  }

  const { rangeStartUtc, rangeEndUtc } = parseMonthRange(input.month);
  const createdBy = input.userId;

  // 1) 拉取所有 entries（在 service 层做日分桶 + extremes 计算）
  // 2) 并行拉取支出 / 收入的二级分类聚合（用于 L1 排行）
  const [entries, expenseL2Aggs, incomeL2Aggs] = await Promise.all([
    statsRepo.listEntriesInRange(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy }),
    statsRepo.getCategoryAggregates(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy, entryType: 'expense' }),
    statsRepo.getCategoryAggregates(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy, entryType: 'income' }),
  ]);

  // === totals + daily_trend + extremes（在 JS 中分桶） ===
  const [yearStr, monthStr] = input.month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysInMonth = getDaysInMonth(year, monthNum);

  const dailyExpense: number[] = new Array(daysInMonth + 1).fill(0);  // index 1..daysInMonth
  const dailyIncome: number[] = new Array(daysInMonth + 1).fill(0);

  let totalExpense = 0;
  let totalIncome = 0;
  let entryCount = 0;
  let maxSingleExpense = 0;
  let maxSingleNote: string | null = null;
  let maxSingleCategoryId: string | null = null;

  for (const e of entries) {
    entryCount += 1;
    const day = getShanghaiDay(e.occurred_at);
    if (day < 1 || day > daysInMonth) continue;  // 不应该发生 · 防御
    if (e.type === 'expense') {
      totalExpense += e.amount;
      dailyExpense[day] += e.amount;
      if (e.amount > maxSingleExpense) {
        maxSingleExpense = e.amount;
        maxSingleNote = e.note;
        maxSingleCategoryId = e.category_id;
      }
    } else if (e.type === 'income') {
      totalIncome += e.amount;
      dailyIncome[day] += e.amount;
    }
  }

  const dailyTrend: DailyTrendItem[] = [];
  let maxDayExpense = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    dailyTrend.push({
      day: d,
      expense: dailyExpense[d],
      income: dailyIncome[d],
    });
    if (dailyExpense[d] > maxDayExpense) maxDayExpense = dailyExpense[d];
  }

  // 日均支出分母用「至今已过天数」而非整月天数：当前月月初不会被整月摊薄。
  const elapsedDays = elapsedDaysInMonth(year, monthNum, daysInMonth);
  const avgDaily = elapsedDays > 0 ? Math.round(totalExpense / elapsedDays) : 0;

  // === L1 排行（支出 + 收入并列）===
  // 一次批量查询覆盖支出+收入的所有二级 category（合并去重），避免多次 SQL。
  const l2IdSet = new Set<string>();
  for (const a of expenseL2Aggs) l2IdSet.add(a.category_id);
  for (const a of incomeL2Aggs) l2IdSet.add(a.category_id);
  const l2Metas = await statsRepo.getCategoriesByIds(Array.from(l2IdSet));
  const l2MetaMap = new Map(l2Metas.map((m) => [m.id, m]));

  // 最大单笔的二级分类名（仅支出语义 · extremes 面向支出侧）
  const maxSingleCategoryName = maxSingleCategoryId
    ? (l2MetaMap.get(maxSingleCategoryId)?.name ?? null)
    : null;

  // 折叠成一级（含一级直记）→ 收集所有一级 id → 一次批量拿 parent meta
  const expenseL1 = foldCategoriesToL1(expenseL2Aggs, l2MetaMap);
  const incomeL1 = foldCategoriesToL1(incomeL2Aggs, l2MetaMap);
  const parentIdSet = new Set<string>();
  for (const id of expenseL1.byParentId.keys()) parentIdSet.add(id);
  for (const id of incomeL1.byParentId.keys()) parentIdSet.add(id);
  const parentMetas = await statsRepo.getCategoriesByIds(Array.from(parentIdSet));
  const parentMetaMap = new Map(parentMetas.map((m) => [m.id, m]));

  const categoryRanks = buildL1RankItems(expenseL1, parentMetaMap, topN);
  const incomeCategoryRanks = buildL1RankItems(incomeL1, parentMetaMap, topN);

  return {
    family_id: family.id,
    family_name: family.name,
    family_kind: family.kind,
    ledger_id: ledger.id,
    ledger_name: ledger.name,
    month: input.month,
    timezone: 'Asia/Shanghai',
    range_start: rangeStartUtc,
    range_end: rangeEndUtc,
    currency: 'CNY',
    filtered_user_id: input.userId ?? null,
    totals: {
      expense: totalExpense,
      income: totalIncome,
      balance: totalIncome - totalExpense,
      entry_count: entryCount,
    },
    daily_trend: dailyTrend,
    extremes: {
      avg_daily_expense: avgDaily,
      max_single_expense: maxSingleExpense,
      max_single_note: maxSingleNote,
      max_single_category_name: maxSingleCategoryName,
      max_day_expense: maxDayExpense,
    },
    category_ranks: categoryRanks,
    income_category_ranks: incomeCategoryRanks,
  };
}

// === API 2: 年度统计 ===

export async function getYearlyStatistics(
  userId: string,
  input: { familyId: string; year: string; topN?: number; userId?: string },
): Promise<YearlyStatistics> {
  validateYear(input.year);
  const topN = input.topN ?? 20;
  if (topN < 1 || topN > 50) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'top_n must be between 1 and 50',
      details: { field: 'top_n', value: topN, constraint: '1-50' },
    });
  }

  await familyService.assertActiveMember(userId, input.familyId);
  await assertUserIdBelongsToFamily(userId, input.familyId, input.userId);

  const family = await familyRepo.findById(input.familyId);
  if (!family) throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });

  const ledger = await ledgerRepo.findFirstByFamilyId(input.familyId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'family ledger not found',
      details: { ledger_missing: true },
    });
  }

  const { rangeStartUtc, rangeEndUtc } = parseYearRange(input.year);
  const createdBy = input.userId;

  const [entries, expenseL2Aggs, incomeL2Aggs] = await Promise.all([
    statsRepo.listEntriesInRange(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy }),
    statsRepo.getCategoryAggregates(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy, entryType: 'expense' }),
    statsRepo.getCategoryAggregates(ledger.id, rangeStartUtc, rangeEndUtc, { createdBy, entryType: 'income' }),
  ]);

  // === totals + monthly_trend + extremes ===
  const monthlyExpense: number[] = new Array(13).fill(0);   // index 1..12
  const monthlyIncome: number[] = new Array(13).fill(0);
  const monthlyEntryCount: number[] = new Array(13).fill(0);

  let totalExpense = 0;
  let totalIncome = 0;
  let entryCount = 0;
  let maxSingleExpense = 0;
  let maxSingleNote: string | null = null;
  let maxSingleCategoryId: string | null = null;

  for (const e of entries) {
    entryCount += 1;
    const m = getShanghaiMonth(e.occurred_at);
    if (m < 1 || m > 12) continue;
    monthlyEntryCount[m] += 1;
    if (e.type === 'expense') {
      totalExpense += e.amount;
      monthlyExpense[m] += e.amount;
      if (e.amount > maxSingleExpense) {
        maxSingleExpense = e.amount;
        maxSingleNote = e.note;
        maxSingleCategoryId = e.category_id;
      }
    } else if (e.type === 'income') {
      totalIncome += e.amount;
      monthlyIncome[m] += e.amount;
    }
  }

  const monthlyTrend: MonthlyTrendItem[] = [];
  let maxMonthExpense = 0;
  let maxMonthIdx = 0;
  for (let m = 1; m <= 12; m++) {
    monthlyTrend.push({
      month: m,
      expense: monthlyExpense[m],
      income: monthlyIncome[m],
      balance: monthlyIncome[m] - monthlyExpense[m],
      entry_count: monthlyEntryCount[m],
    });
    if (monthlyExpense[m] > maxMonthExpense) {
      maxMonthExpense = monthlyExpense[m];
      maxMonthIdx = m;
    }
  }
  // 月均支出分母用「至今已过月份数」（当前年=当前月，历史年=12），与月度日均口径一致，
  // 不再用"有数据的最大月"——避免最近月份未记账时分母偏小导致月均虚高。
  const monthsCount = elapsedMonthsInYear(Number(input.year));
  const avgMonthly = monthsCount > 0 ? Math.round(totalExpense / monthsCount) : 0;

  // === L1 排行（全年 · 支出 + 收入并列）===
  const l2IdSet = new Set<string>();
  for (const a of expenseL2Aggs) l2IdSet.add(a.category_id);
  for (const a of incomeL2Aggs) l2IdSet.add(a.category_id);
  const l2Metas = await statsRepo.getCategoriesByIds(Array.from(l2IdSet));
  const l2MetaMap = new Map(l2Metas.map((m) => [m.id, m]));

  // 最大单笔的二级分类名（仅支出语义 · extremes 面向支出侧）
  const maxSingleCategoryName = maxSingleCategoryId
    ? (l2MetaMap.get(maxSingleCategoryId)?.name ?? null)
    : null;

  const expenseL1 = foldCategoriesToL1(expenseL2Aggs, l2MetaMap);
  const incomeL1 = foldCategoriesToL1(incomeL2Aggs, l2MetaMap);
  const parentIdSet = new Set<string>();
  for (const id of expenseL1.byParentId.keys()) parentIdSet.add(id);
  for (const id of incomeL1.byParentId.keys()) parentIdSet.add(id);
  const parentMetas = await statsRepo.getCategoriesByIds(Array.from(parentIdSet));
  const parentMetaMap = new Map(parentMetas.map((m) => [m.id, m]));

  const categoryRanks = buildL1RankItems(expenseL1, parentMetaMap, topN);
  const incomeCategoryRanks = buildL1RankItems(incomeL1, parentMetaMap, topN);

  // top_category：全年最贵的一级支出分类（保留原语义 · 收入不入 extremes）
  const top = categoryRanks[0];

  return {
    family_id: family.id,
    family_name: family.name,
    family_kind: family.kind,
    ledger_id: ledger.id,
    ledger_name: ledger.name,
    year: input.year,
    timezone: 'Asia/Shanghai',
    range_start: rangeStartUtc,
    range_end: rangeEndUtc,
    currency: 'CNY',
    filtered_user_id: input.userId ?? null,
    totals: {
      expense: totalExpense,
      income: totalIncome,
      balance: totalIncome - totalExpense,
      entry_count: entryCount,
    },
    monthly_trend: monthlyTrend,
    extremes: {
      avg_monthly_expense: avgMonthly,
      max_single_expense: maxSingleExpense,
      max_single_note: maxSingleNote,
      max_single_category_name: maxSingleCategoryName,
      max_month_expense: maxMonthExpense,
      max_month_label: maxMonthIdx > 0 ? `${maxMonthIdx}月` : '',
      top_category_name: top ? top.category_name : null,
      top_category_amount: top ? top.amount : 0,
    },
    category_ranks: categoryRanks,
    income_category_ranks: incomeCategoryRanks,
  };
}

// === API 3: 下钻 L2 / L3 ===

export interface DrillDownInput {
  familyId: string;
  /** month 与 year 二选一 */
  month?: string;
  year?: string;
  level: 2 | 3;
  parentCategoryId?: string;
  categoryId?: string;
  limit?: number;
  offset?: number;
  /** COSTRA-260: 成员维度过滤 */
  userId?: string;
  /**
   * 收入分类排行迭代：下钻的分类语义。
   *   - 'expense'（默认）：支出侧二级 / L3 明细
   *   - 'income'：收入侧二级 / L3 明细
   * 未传时缺省 'expense'，保 API 向后兼容。新客户端应显式传。
   */
  entryType?: 'expense' | 'income';
}

export async function getDrillDown(
  userId: string,
  input: DrillDownInput,
): Promise<DrillDownLevel2Response | DrillDownLevel3Response> {
  // 参数校验
  if (input.level !== 2 && input.level !== 3) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'level must be 2 or 3',
      details: { field: 'level', value: input.level },
    });
  }
  if (!input.month && !input.year) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month or year is required',
    });
  }
  if (input.month && input.year) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month and year are mutually exclusive',
    });
  }
  if (input.month) validateMonth(input.month);
  if (input.year) validateYear(input.year);

  if (input.level === 2 && !input.parentCategoryId) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'parent_category_id is required when level=2',
    });
  }
  if (input.level === 3 && !input.categoryId) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'category_id is required when level=3',
    });
  }

  const limit = input.limit ?? 10;
  const offset = input.offset ?? 0;
  if (limit < 1 || limit > 50) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'limit must be between 1 and 50',
      details: { field: 'limit', value: limit },
    });
  }
  if (offset < 0) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'offset must be >= 0',
      details: { field: 'offset', value: offset },
    });
  }

  await familyService.assertActiveMember(userId, input.familyId);
  await assertUserIdBelongsToFamily(userId, input.familyId, input.userId);

  const ledger = await ledgerRepo.findFirstByFamilyId(input.familyId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'family ledger not found',
      details: { ledger_missing: true },
    });
  }

  const { rangeStartUtc, rangeEndUtc } = input.month
    ? parseMonthRange(input.month)
    : parseYearRange(input.year!);

  const createdBy = input.userId;
  const entryType = input.entryType ?? 'expense';

  if (input.level === 2) {
    return await drillDownL2(
      ledger.id,
      rangeStartUtc,
      rangeEndUtc,
      input.parentCategoryId!,
      limit,
      offset,
      createdBy,
      entryType,
    );
  }
  return await drillDownL3(
    ledger.id,
    rangeStartUtc,
    rangeEndUtc,
    input.categoryId!,
    limit,
    offset,
    createdBy,
    entryType,
  );
}

async function drillDownL2(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  parentCategoryId: string,
  limit: number,
  offset: number,
  createdBy: string | undefined,
  entryType: 'expense' | 'income',
): Promise<DrillDownLevel2Response> {
  // 拿 parent 元信息
  const parentMetas = await statsRepo.getCategoriesByIds([parentCategoryId]);
  const parentMeta = parentMetas[0];

  // 拿子分类聚合
  const aggs = await statsRepo.getSubCategoryAggregates(
    ledgerId, rangeStartUtc, rangeEndUtc, parentCategoryId, { createdBy, entryType },
  );
  const subIds = aggs.map((a) => a.category_id);
  const subMetas = await statsRepo.getCategoriesByIds(subIds);
  const subMetaMap = new Map(subMetas.map((m) => [m.id, m]));

  const filtered = aggs.filter((a) => a.amount > 0);
  const parentAmount = filtered.reduce((sum, a) => sum + a.amount, 0);

  // 排序 + 分页
  filtered.sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    const an = subMetaMap.get(a.category_id)?.name ?? '';
    const bn = subMetaMap.get(b.category_id)?.name ?? '';
    return an.localeCompare(bn, 'zh-Hans-CN');
  });

  const total = filtered.length;
  const sliced = filtered.slice(offset, offset + limit);

  const items: StatCategoryRankItem[] = sliced.map((a) => {
    const meta = subMetaMap.get(a.category_id);
    return {
      category_id: a.category_id,
      category_name: meta?.name ?? '未分类',
      icon: meta?.icon ?? '',
      amount: a.amount,
      entry_count: a.entry_count,
      ratio_bps: calcBps(a.amount, parentAmount),
    };
  });

  return {
    level: 2,
    parent_category_id: parentCategoryId,
    parent_category_name: parentMeta?.name ?? '未分类',
    parent_amount: parentAmount,
    items,
    total_count: total,
    has_more: offset + items.length < total,
  };
}

async function drillDownL3(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  categoryId: string,
  limit: number,
  offset: number,
  createdBy: string | undefined,
  entryType: 'expense' | 'income',
): Promise<DrillDownLevel3Response> {
  const categoryMetas = await statsRepo.getCategoriesByIds([categoryId]);
  const categoryMeta = categoryMetas[0];
  const parentId = categoryMeta?.parent_id ?? null;
  const parentMetas = parentId ? await statsRepo.getCategoriesByIds([parentId]) : [];
  const parentMeta = parentMetas[0] ?? null;

  const { items, total } = await statsRepo.listEntriesByCategory(
    ledgerId, rangeStartUtc, rangeEndUtc, categoryId, limit, offset, { createdBy, entryType },
  );

  // 分类总额：先单独查（不复用 items 的 SUM，因为 items 已分页）
  const aggRow = await statsRepo.getCategoryAggregates(ledgerId, rangeStartUtc, rangeEndUtc, { createdBy, entryType });
  const thisCat = aggRow.find((a) => a.category_id === categoryId);
  const categoryAmount = thisCat?.amount ?? 0;

  return {
    level: 3,
    category_id: categoryId,
    category_name: categoryMeta?.name ?? '未分类',
    parent_category_id: parentId,
    parent_category_name: parentMeta?.name ?? null,
    category_amount: categoryAmount,
    items,
    total_count: total,
    has_more: offset + items.length < total,
  };
}
