// pages/home/index.ts
// 首页（tabBar #1）：本月概览 + 最近 5 笔 + 快捷入口。
// 卡号: COSTRA-102 · 承接 COSTRA-118 E.P1-4（TODO 注释纠正）
// COSTRA-125: onLoad 加 bootstrapPromise gate
// COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race · 修复 first-rendering-data 错误
// Refs: COSTRA-030, docs/design/ia.md §首页 · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (e)
import { hasValidSession, getToken } from '../../services/auth';
import { formatMoney } from '../../utils/money';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

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

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    // 等 bootstrap 完成再判登录态 · 避免冷启动竞速误跳 login
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
      }
    });
  },

  onShow() {
    // COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race
    // 实测推翻"onShow 必在 onLoad 之后"假设：reLaunch 后 onShow 先触发，bootstrap 未完成时 hasValidSession() 返回 false
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this.hydrateUser();
      this.refresh();
    });
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
