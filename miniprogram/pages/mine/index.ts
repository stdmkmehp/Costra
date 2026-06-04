// pages/mine/index.ts
// 我的页（Tab5 / selected 4）：用户信息 + 家庭入口 + 统计入口 + 设置。
// COSTRA-125: onLoad 加 bootstrapPromise gate
// COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race
// COSTRA-201: 适配 custom-tab-bar selected: 4 + 引入 expense-overlay
// COSTRA-216: 补齐 custom navigation 安全区导航栏
// Refs: COSTRA-030, docs/design/ia.md §我的 · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (e)
import { hasValidSession, getSession, logout, getToken } from '../../services/auth';
import { defaultNickname } from '../../config/defaults';
import { triggerOnPageShow, syncOnce, stopScheduler } from '../../services/syncScheduler';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { eventBus, EventNames } from '../../services/eventBus';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    statusBarHeight: 0,
    navBarHeight: 0,
    showProfileBadge: false,
  },

  _profileBadgeOnHandler: null as (() => void) | null,
  _profileBadgeOffHandler: null as (() => void) | null,

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    // COSTRA-216: 获取安全区指标，设置自定义导航栏高度
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });

    // 订阅红点事件
    const badgeOnHandler = () => { this.setData({ showProfileBadge: true }); };
    this._profileBadgeOnHandler = badgeOnHandler;
    eventBus.on(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);

    const badgeOffHandler = () => { this.setData({ showProfileBadge: false }); };
    this._profileBadgeOffHandler = badgeOffHandler;
    eventBus.on(EventNames.PROFILE_COMPLETED, badgeOffHandler);

    // 等 bootstrap 完成再判登录态
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      // 同步当前红点状态（bootstrap 已 emit 但 mine 页此时才 onLoad · 需从 token 补读）
      const token = getToken();
      if (token && !token.raw.user.has_completed_profile) {
        this.setData({ showProfileBadge: true });
      }
    });
  },

  onUnload() {
    if (this._profileBadgeOnHandler) {
      eventBus.off(EventNames.PROFILE_INCOMPLETE, this._profileBadgeOnHandler);
    }
    if (this._profileBadgeOffHandler) {
      eventBus.off(EventNames.PROFILE_COMPLETED, this._profileBadgeOffHandler);
    }
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

      // COSTRA-201: 更新 custom-tab-bar 选中态为 index 4（我的）+ 解锁显示
      this.getTabBar?.()?.setData?.({ selected: 4, hidden: false });
    });
  },

  onTapProfile() {
    wx.navigateTo({ url: '/pages/profile-setup/index' });
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
      // 退出前主动推送本地未同步数据 · 保证用户离开前数据尽量上行
      // syncOnce 需要 familyId + 登录态，必须在 logout() 清除前调用
      try { await syncOnce('hide'); } catch { /* 吞错 · logout 必须成功 */ }
      stopScheduler();
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
