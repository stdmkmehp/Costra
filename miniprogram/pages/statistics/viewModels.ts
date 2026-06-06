// pages/statistics/viewModels.ts · 统计页视图模型工厂函数与常量
// 卡号: COSTRA-264 · P0 拆分 index.ts 低于 1000 行
// Refs: COSTRA-264

import type { MonthlyView, YearlyView, L1Display } from './types';
import type { StatCategoryRankItem } from '../../services/statisticsApi';
import { fmtYuan } from './formatters';

/** L1 排行长列表省略：保留前 N 项 */
export const L1_VISIBLE = 6;
export const L2_VISIBLE = 6;
export const L3_VISIBLE = 10;

/** 初始 MonthlyView */
export function emptyMonthlyView(): MonthlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], l1: [], l1HasMore: false, l1MoreCount: 0,
    isEmpty: false, loading: false, loaded: false,
  };
}

/** 初始 YearlyView */
export function emptyYearlyView(): YearlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], months: [], l1: [], l1HasMore: false, l1MoreCount: 0,
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

/** 构建 L1 展示项（保留旧展开态） */
export function buildL1Display(c: StatCategoryRankItem, prevList: L1Display[]): L1Display {
  const id = c.category_id || '';
  const prev = prevList.find((p) => p.category_id === id);
  return {
    category_id: id,
    category_name: c.category_name,
    icon: c.icon,
    amount: fmtYuan(c.amount),
    amountCents: c.amount,
    ratio_bps: c.ratio_bps,
    expanded: prev?.expanded ?? false,
    loadingL2: false,
    l2Items: prev?.l2Items ?? [],
    l2HasMore: prev?.l2HasMore ?? false,
    l2MoreCount: prev?.l2MoreCount ?? 0,
  };
}
