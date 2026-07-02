// pages/statistics/viewModels.ts · 统计页视图模型工厂函数与常量
// 卡号: COSTRA-264 · P0 拆分 index.ts 低于 1000 行
// Refs: COSTRA-264

import type { MonthlyView, YearlyView, L1Display, SummaryGridItem, TrendChartMeta } from './types';
import type { MonthlyStatistics, StatCategoryRankItem, DailyTrendItem, MonthlyTrendItem } from '../../services/statisticsApi';
import { fmtYuan, fmtRatio, buildEmptyTitleMonth } from './formatters';

/**
 * L1 不限项：用户期望统计页所有一级分类全部展示（数据量天然受控，design/categories.yaml ~15 项）。
 * 取值与后端 topN 上限保持一致（routes/statistics.ts schema max=50），
 * 调用方（getMonthlyStatistics/Yearly）显式传 topN: L1_VISIBLE 让后端按上限返回。
 */
export const L1_VISIBLE = 50;
/** L2/L3 仅显示前 5 项 + has_more 提示文案（不显示数量）。limit = VISIBLE + 1 探测溢出。 */
export const L2_VISIBLE = 5;
export const L3_VISIBLE = 5;

export function emptyTrendChartMeta(): TrendChartMeta {
  return { periodDividers: [], currentIndex: -1, peakIndex: -1, peakLabel: '' };
}

/** 初始 MonthlyView */
export function emptyMonthlyView(): MonthlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], chartMeta: emptyTrendChartMeta(), summary: [], l1: [],
    isEmpty: false, loading: false, loaded: false,
    emptyTitle: '暂无记录', emptyHint: '',
  };
}

/** 初始 YearlyView */
export function emptyYearlyView(): YearlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], chartMeta: emptyTrendChartMeta(), summary: [], months: [], l1: [],
    isEmpty: false, loading: false, loaded: false,
    emptyTitle: '暂无记录', emptyHint: '',
  };
}

/**
 * 计算 swiper 初始高度（避免 800px 硬编码大留白）
 * 策略：windowHeight * 0.5，兜底 420
 */
export function getInitialSwiperHeightPx(): number {
  try {
    const info = wx.getWindowInfo();
    if (info && info.windowHeight > 0) {
      return Math.round(info.windowHeight * 0.5);
    }
  } catch {
    // fallback
  }
  return 420;
}

export function buildMonthlyTrendChartMeta(month: string, dailyTrend: DailyTrendItem[]): TrendChartMeta {
  const parsed = parseMonthValue(month);
  if (!parsed || dailyTrend.length === 0) return emptyTrendChartMeta();

  const { year, monthNum } = parsed;
  const periodDividers = dailyTrend
    .map((item, index) => (new Date(year, monthNum - 1, item.day).getDay() === 1 ? index : -1))
    .filter((index) => index >= 0);
  const today = getTodayParts();
  const currentIndex = today.year === year && today.month === monthNum
    ? dailyTrend.findIndex((item) => item.day === today.day)
    : -1;
  const peakIndex = findPeakIndex(dailyTrend.map((item) => item.expense));
  const peakItem = peakIndex >= 0 ? dailyTrend[peakIndex] : null;

  return {
    periodDividers,
    currentIndex,
    peakIndex,
    peakLabel: peakItem ? `${monthNum}/${peakItem.day} · ${fmtYuan(peakItem.expense)}` : '',
  };
}

export function buildYearlyTrendChartMeta(year: string, monthlyTrend: MonthlyTrendItem[]): TrendChartMeta {
  const yearNum = parseInt(year, 10);
  if (!Number.isFinite(yearNum) || monthlyTrend.length === 0) return emptyTrendChartMeta();

  const periodDividers = monthlyTrend
    .map((item, index) => ([3, 6, 9].includes(item.month) ? index : -1))
    .filter((index) => index >= 0);
  const today = getTodayParts();
  const currentIndex = today.year === yearNum
    ? monthlyTrend.findIndex((item) => item.month === today.month)
    : -1;
  const peakIndex = findPeakIndex(monthlyTrend.map((item) => item.expense));
  const peakItem = peakIndex >= 0 ? monthlyTrend[peakIndex] : null;

  return {
    periodDividers,
    currentIndex,
    peakIndex,
    peakLabel: peakItem ? `${peakItem.month}月 · ${fmtYuan(peakItem.expense)}` : '',
  };
}

function parseMonthValue(month: string): { year: number; monthNum: number } | null {
  const matched = /^(\d{4})-(\d{2})$/.exec(month);
  if (!matched) return null;
  const year = parseInt(matched[1], 10);
  const monthNum = parseInt(matched[2], 10);
  if (!Number.isFinite(year) || monthNum < 1 || monthNum > 12) return null;
  return { year, monthNum };
}

function getTodayParts(): { year: number; month: number; day: number } {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
}

function findPeakIndex(values: number[]): number {
  let peakIndex = -1;
  let peakValue = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value > peakValue) {
      peakValue = value;
      peakIndex = i;
    }
  }
  return peakIndex;
}

/**
 * 构建 L1 展示项（保留旧展开态 + 子树）
 *
 * 2026-06-08 子树脏标记机制（B1 方案）：
 *   - 若 prev 节点 subtreeStale=true（_invalidateAllDimViews 打的）：
 *     · subtreeStale 透传给新节点（不清除）；
 *     · l2Items / l2HasMore 直接继承 prev（含每个 L2 节点已带的 subtreeStale 标记），
 *       让用户已展开的下钻面板（包括 L3 单笔列表）保持显示，避免"刷新即收起"体验。
 *     · onTapL1 看到 subtreeStale=true 会绕过缓存早返回，强制走 _loadL2Data；
 *     · _refreshExpandedSubtreesIfNeeded 也会对 expanded 节点 fire-and-forget 重拉 L2，
 *       _loadL2Data 内部用 prev 合并保留 expanded + L3，再级联 _loadL3Data 重拉 L3。
 *     · 代价：数据变更（新增/修改记账）后约 1~2 次网络往返期间，L2/L3 显示的还是旧值
 *       （L1 已经是新值），过渡到正确值，用户感知极弱。
 *   - 其余情况（首次构建 / 切月切账本由调用方整体清 byMember）按"继承旧展开态"处理。
 */
export function buildL1Display(c: StatCategoryRankItem, prevList: L1Display[]): L1Display {
  const id = c.category_id || '';
  const prev = prevList.find((p) => p.category_id === id);
  const stale = prev?.subtreeStale ?? false;
  return {
    category_id: id,
    category_name: c.category_name,
    icon: c.icon,
    amount: fmtYuan(c.amount),
    amountCents: c.amount,
    ratio_bps: c.ratio_bps,
    ratioText: fmtRatio(c.ratio_bps),
    expanded: prev?.expanded ?? false,
    loadingL2: false,
    // B1：stale 时也保留旧 L2 子树（含每个 L2 的 subtreeStale 标记），让自动重拉路径
    // 在 _loadL2Data 合并 prev 时能正确继承 expanded + L3 数据，避免下钻被收起。
    l2Items: prev?.l2Items ?? [],
    l2HasMore: prev?.l2HasMore ?? false,
    subtreeStale: stale,
  };
}

export function buildMonthlyView(
  stats: MonthlyStatistics,
  prevList: L1Display[],
  month: string,
  emptyHint: string,
): MonthlyView {
  const { totals, daily_trend, extremes, category_ranks } = stats;
  const summary: SummaryGridItem[] = [
    { label: '日均支出', value: fmtYuan(extremes.avg_daily_expense) },
    { label: '最大单笔', value: fmtYuan(extremes.max_single_expense) },
    { label: '单日最高', value: fmtYuan(extremes.max_day_expense) },
    { label: '记账笔数', value: `${totals.entry_count}` },
  ];
  const l1: L1Display[] = category_ranks
    .slice(0, L1_VISIBLE)
    .map((c) => buildL1Display(c, prevList));
  const isEmpty = totals.expense === 0 && totals.income === 0;
  return {
    totalExpense: fmtYuan(totals.expense),
    totalIncome: fmtYuan(totals.income),
    totalBalance: fmtYuan(totals.balance),
    trend: daily_trend.map((d) => d.expense),
    chartMeta: buildMonthlyTrendChartMeta(month, daily_trend),
    summary,
    l1,
    isEmpty,
    loading: false,
    loaded: true,
    emptyTitle: buildEmptyTitleMonth(month),
    emptyHint: isEmpty ? emptyHint : '',
  };
}
