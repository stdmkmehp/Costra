// pages/home/index.ts
// 首页（tabBar #1）：本月概览 + 最近 5 笔 + 快捷入口。
// 卡号: COSTRA-102 · 承接 COSTRA-118 E.P1-4（TODO 注释纠正）
// Refs: COSTRA-030, docs/design/ia.md §首页
import { hasValidSession, getToken } from '../../services/auth';
import { formatMoney } from '../../utils/money';

Page({
  data: {
    userName: '',          // 来自 AuthTokenPair.user.nickname（OpenAPI 事实源）
    userAvatar: '',        // 来自 AuthTokenPair.user.avatar_url
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
    this.hydrateUser();
    this.refresh();
  },

  /**
   * 从 Token.raw.user 直接取画像
   * 不需要额外调 /users/me（AuthTokenPair 已带 user）· 节省启动期 RTT
   * 兜底：昵称空 → "微信用户" 占位（FU 登记：服务端返回 nickname 为空的边界）
   */
  hydrateUser() {
    const tk = getToken();
    const u = tk?.raw?.user;
    this.setData({
      userName: (u && u.nickname) || '微信用户',
      userAvatar: (u && u.avatar_url) || '',
    });
  },

  refresh() {
    // TODO(COSTRA-401 或 Epic-F /reports/monthly): 调 POST /reports/monthly { ledger_id, month }
    //   · P1-4 订正：原骨架 TODO 引用的 GET /v1/ledger/summary?range=current-month 不在 OpenAPI，
    //     实契约为 GET /reports/monthly（见 server/api/openapi.yaml /reports/monthly），
    //     但对应本卡 Sprint-1 节奏下不立即接通 · 属 Epic-F 范围。
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
