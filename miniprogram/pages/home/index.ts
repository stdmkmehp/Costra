// pages/home/index.ts
// 首页（tabBar #1）：本月概览 + 最近 5 笔 + 快捷入口。骨架阶段仅占位数据。
// Refs: COSTRA-030, docs/design/ia.md §首页
import { hasValidSession } from '../../services/auth';
import { formatMoney } from '../../utils/money';

Page({
  data: {
    monthLabel: '本月',
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    recent: [] as Array<{ id: string; title: string; amount: string; time: string }>,
    incomeDisplay: '0.00',
    expenseDisplay: '0.00',
    netDisplay: '0.00',
  },

  onShow() {
    if (!hasValidSession()) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.refresh();
  },

  refresh() {
    // TODO(COSTRA-110): 接 GET /v1/ledger/summary?range=current-month
    const income = 0;
    const expense = 0;
    this.setData({
      incomeCents: income,
      expenseCents: expense,
      netCents: income - expense,
      incomeDisplay: formatMoney(income),
      expenseDisplay: formatMoney(expense),
      netDisplay: formatMoney(income - expense),
      recent: [],
    });
  },

  onTapAdd() {
    wx.navigateTo({ url: '/pages/entry/index' });
  },
});
