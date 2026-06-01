// pages/mine/index.ts
// 我的页（Tab5 / selected 4）：用户信息 + 家庭入口 + 统计入口 + 设置。
// COSTRA-125: onLoad 加 bootstrapPromise gate
// COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race
// COSTRA-201: 适配 custom-tab-bar selected: 4 + 引入 expense-overlay
// Refs: COSTRA-030, docs/design/ia.md §我的 · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (e)
import { hasValidSession, getSession, logout } from '../../services/auth';
import { defaultNickname } from '../../config/defaults';
import { triggerOnPageShow } from '../../services/syncScheduler';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

Page({
  data: {
    nickname: '',
    avatarUrl: '',
  },

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    // 等 bootstrap 完成再判登录态
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
      }
    });
  },

  onShow() {
    // COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      const s = getSession();
      this.setData({
        nickname: s?.user?.nickname || defaultNickname,
        avatarUrl: s?.user?.avatarUrl || '',
      });
      // COSTRA-150: 页面 onShow 触发同步调度（debounce 5s）
      triggerOnPageShow('mine');

      // COSTRA-201: 更新 custom-tab-bar 选中态为 index 4（我的）
      this.getTabBar?.()?.setData?.({ selected: 4 });
    });
  },

  onTapFamily() {
    wx.navigateTo({ url: '/pages-family/home/index' });
  },
  onTapStat() {
    wx.navigateTo({ url: '/pages-stat/month/index' });
  },
  onTapSettings() {
    wx.navigateTo({ url: '/pages-family/settings/index' });
  },
  async onTapLogout() {
    const res = await wx.showModal({ title: '退出登录', content: '确定要退出吗？' });
    if (res.confirm) {
      // COSTRA-102 D2.2：logout 已改为 async（含真调 POST /auth/logout 204）
      // 内部已自带 wx.reLaunch，此处无需再跳
      await logout();
    }
  },

  // ICP 备案号点击：复制工信部链接 + 弹窗提示（满足腾讯云「显著位置 + 跳转 beian.miit.gov.cn」规范）
  // Refs: 沪ICP备2026017253号-1X（小程序）· 沪ICP备2026017253号-2（后端 costra.cloud）
  onTapIcp() {
    wx.setClipboardData({
      data: 'https://beian.miit.gov.cn/',
      success: () => {
        wx.showModal({
          title: '已复制工信部备案查询链接',
          content: '请在浏览器中粘贴打开以查询：沪ICP备2026017253号',
          showCancel: false,
        });
      },
    });
  },
});
