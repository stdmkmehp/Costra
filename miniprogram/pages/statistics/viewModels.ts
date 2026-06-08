// pages/statistics/viewModels.ts · 统计页视图模型工厂函数与常量
// 卡号: COSTRA-264 · P0 拆分 index.ts 低于 1000 行
// Refs: COSTRA-264

import type { MonthlyView, YearlyView, L1Display } from './types';
import type { StatCategoryRankItem } from '../../services/statisticsApi';
import { fmtYuan } from './formatters';

/**
 * L1 不限项：用户期望统计页所有一级分类全部展示（数据量天然受控，design/categories.yaml ~15 项）。
 * 取值与后端 topN 上限保持一致（routes/statistics.ts schema max=50），
 * 调用方（getMonthlyStatistics/Yearly）显式传 topN: L1_VISIBLE 让后端按上限返回。
 */
export const L1_VISIBLE = 50;
/** L2/L3 仅显示前 5 项 + has_more 提示文案（不显示数量）。limit = VISIBLE + 1 探测溢出。 */
export const L2_VISIBLE = 5;
export const L3_VISIBLE = 5;

/** 初始 MonthlyView */
export function emptyMonthlyView(): MonthlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], l1: [],
    isEmpty: false, loading: false, loaded: false,
  };
}

/** 初始 YearlyView */
export function emptyYearlyView(): YearlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], months: [], l1: [],
    isEmpty: false, loading: false, loaded: false,
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

/**
 * 构建 L1 展示项（保留旧展开态 + 子树）
 *
 * 2026-06-08 子树脏标记机制（B1 方案）：
 *   - 若 prev 节点 subtreeStale=true（_invalidateCurrentDimViews 打的）：
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
    expanded: prev?.expanded ?? false,
    loadingL2: false,
    // B1：stale 时也保留旧 L2 子树（含每个 L2 的 subtreeStale 标记），让自动重拉路径
    // 在 _loadL2Data 合并 prev 时能正确继承 expanded + L3 数据，避免下钻被收起。
    l2Items: prev?.l2Items ?? [],
    l2HasMore: prev?.l2HasMore ?? false,
    subtreeStale: stale,
  };
}
