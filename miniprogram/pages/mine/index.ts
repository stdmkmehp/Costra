// pages/mine/index.ts
// 我的页（Tab5 / selected 4）：用户信息 + 宏观数据 + 功能列表 + 合规 footer。
//
// 卡号：mine-overview（设计源 design/ui/design_spec.md §6.6）
// 历史卡号：COSTRA-125（onLoad gate）/ COSTRA-127（onShow gate）/ COSTRA-201（custom-tab-bar + expense-overlay）/ COSTRA-216（safeArea）
//
// 改造要点（2026-06-08）：
//   - 顶部用户区：头像居中放大（160rpx），昵称居中，下方"已记账 X 天"
//   - 宏观数据：横向 2 列（记账天数 / 记账笔数）· 走 GET /users/me/overview
//   - 功能列表：创建协作 / 导入导出 / 定时记账 / 公告 / 意见反馈 / 关于 Costra / 设置 — 导入导出与定时记账为预留 toast「即将支持」，意见反馈使用无样式 button 承载 open-type=feedback，内层 view 复用普通菜单项布局
//   - 退出登录 / 合规 footer 完整保留（ICP 备案号仅展示，不再点击复制）

import { hasValidSession, getSession, logout, getToken } from '../../services/auth';
import { defaultNickname } from '../../config/defaults';
import { triggerOnPageShow, syncOnce, stopScheduler } from '../../services/syncScheduler';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { eventBus, EventNames, type SyncDonePayload, type ProfileUpdatedPayload } from '../../services/eventBus';
import {
  getUserOverview,
  getCachedUserOverview,
  invalidateUserOverview,
} from '../../services/userOverviewApi';
import { hasUnreadAnnouncements } from '../../services/announcementApi';

interface AppWithBootstrapAndGlobal {
  bootstrapPromise: Promise<void>;
  globalData: { pendingFamilyAction?: 'create' | null };
}

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    statusBarHeight: 0,
    showProfileBadge: false,
    showBulletinBadge: false,
    appVersion: '',
    // 宏观数据（mine-overview）
    ledgerDays: 0,
    entryCount: 0,
    overviewLoaded: false,
  },

  _profileBadgeOnHandler: null as (() => void) | null,
  _profileBadgeOffHandler: null as (() => void) | null,
  _announcementUnreadHandler: null as (() => void) | null,
  _entrySavedHandler: null as (() => void) | null,
  _entryUpdatedHandler: null as (() => void) | null,
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  _profileUpdatedHandler: null as ((payload?: unknown) => void) | null,

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    // COSTRA-216: 获取安全区指标，设置自定义导航栏高度
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
    });

    // 读取小程序版本号（线上版本有值，开发/体验版为空）
    try {
      const info = wx.getAccountInfoSync();
      const ver = info?.miniProgram?.version;
      if (ver) this.setData({ appVersion: ver });
    } catch { /* 降级：不显示版本号 */ }

    // 订阅红点事件
    const badgeOnHandler = () => { this.setData({ showProfileBadge: true }); };
    this._profileBadgeOnHandler = badgeOnHandler;
    eventBus.on(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);

    const badgeOffHandler = () => { this.setData({ showProfileBadge: false }); };
    this._profileBadgeOffHandler = badgeOffHandler;
    eventBus.on(EventNames.PROFILE_COMPLETED, badgeOffHandler);

    // 公告未读状态变更 → 刷新公告红点
    const announcementUnreadHandler = () => { void this._checkBulletinBadge(); };
    this._announcementUnreadHandler = announcementUnreadHandler;
    eventBus.on(EventNames.ANNOUNCEMENT_UNREAD_CHANGED, announcementUnreadHandler);

    // mine-overview: 数据变更 → 失效缓存 + 重拉
    const entrySavedHandler = () => { void this._refreshOverview(); };
    this._entrySavedHandler = entrySavedHandler;
    eventBus.on(EventNames.ENTRY_SAVED, entrySavedHandler);

    const entryUpdatedHandler = () => { void this._refreshOverview(); };
    this._entryUpdatedHandler = entryUpdatedHandler;
    eventBus.on(EventNames.ENTRY_UPDATED, entryUpdatedHandler);

    // SYNC_DONE: 拉到/推送了数据时也刷新（其他端记账后下行同步会改变 entries）
    const syncDoneHandler = (payload?: unknown) => {
      const p = payload as SyncDonePayload | undefined;
      if (!p) return;
      if (p.pulled <= 0 && p.pushed <= 0) return;
      void this._refreshOverview();
    };
    this._syncDoneHandler = syncDoneHandler;
    eventBus.on(EventNames.SYNC_DONE, syncDoneHandler);

    // PROFILE_UPDATED: 画像变更后即时刷新头像和昵称（不必等 onShow 重读 token）
    const profileUpdatedHandler = (payload?: unknown) => {
      const p = payload as ProfileUpdatedPayload | undefined;
      if (!p) return;
      this.setData({
        nickname: p.nickname || defaultNickname,
        avatarUrl: p.avatarUrl || '',
      });
    };
    this._profileUpdatedHandler = profileUpdatedHandler;
    eventBus.on(EventNames.PROFILE_UPDATED, profileUpdatedHandler);

    // 等 bootstrap 完成再判登录态
    const app = getApp<AppWithBootstrapAndGlobal>();
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
      this._profileBadgeOnHandler = null;
    }
    if (this._profileBadgeOffHandler) {
      eventBus.off(EventNames.PROFILE_COMPLETED, this._profileBadgeOffHandler);
      this._profileBadgeOffHandler = null;
    }
    if (this._announcementUnreadHandler) {
      eventBus.off(EventNames.ANNOUNCEMENT_UNREAD_CHANGED, this._announcementUnreadHandler);
      this._announcementUnreadHandler = null;
    }
    if (this._entrySavedHandler) {
      eventBus.off(EventNames.ENTRY_SAVED, this._entrySavedHandler);
      this._entrySavedHandler = null;
    }
    if (this._entryUpdatedHandler) {
      eventBus.off(EventNames.ENTRY_UPDATED, this._entryUpdatedHandler);
      this._entryUpdatedHandler = null;
    }
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
    if (this._profileUpdatedHandler) {
      eventBus.off(EventNames.PROFILE_UPDATED, this._profileUpdatedHandler);
      this._profileUpdatedHandler = null;
    }
  },

  onShow() {
    // COSTRA-127: onShow 加 bootstrapPromise gate · 避免与 onLoad gate 形成 race
    const app = getApp<AppWithBootstrapAndGlobal>();
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

      // 宏观数据：cache-first（首屏命中即渲染）+ 后台拉新校准
      const cached = getCachedUserOverview();
      if (cached) {
        this.setData({
          ledgerDays: cached.ledger_days,
          entryCount: cached.entry_count,
          overviewLoaded: true,
        });
      }
      void this._refreshOverview();

      // 公告红点：mine 页 onShow 时检查未读，显示红点
      // mine 页红点点到 mine 页即消失（showBulletinBadge 重置），
      // 但公告菜单项的红点需用户真正阅读后才消失（后端 is_read 驱动）
      void this._checkBulletinBadge();

      // COSTRA-150: 页面 onShow 触发同步调度（debounce 5s）
      triggerOnPageShow('mine');

      // COSTRA-201: 更新 custom-tab-bar 选中态为 index 4（我的）+ 解锁显示
      // tabbar 自治 hidden（由 _unlocked + _panelOpen 合成）· 此处仅同步 selected 并解锁
      (this.getTabBar?.() as { markActive?: (idx: number) => void } | undefined)?.markActive?.(4);
    });
  },

  /** 拉取并写入宏观数据（可重入安全 · 失败静默不打扰） */
  async _refreshOverview() {
    try {
      const fresh = await getUserOverview();
      this.setData({
        ledgerDays: fresh.ledger_days,
        entryCount: fresh.entry_count,
        overviewLoaded: true,
      });
    } catch {
      // 静默：保持原值；首次失败时用 0 兜底（data 默认 0），不弹 toast 打扰
    }
  },

  /** 检查公告未读红点 */
  async _checkBulletinBadge() {
    try {
      const hasUnread = await hasUnreadAnnouncements();
      this.setData({ showBulletinBadge: hasUnread });
    } catch { /* 静默 */ }
  },

  onTapProfile() {
    wx.navigateTo({ url: '/pages/profile-setup/index' });
  },

  onTapSettings() {
    wx.showToast({ title: '暂无设置内容', icon: 'none' });
  },

  onTapPrivacy() {
    wx.navigateTo({ url: '/pages-family/privacy/index' });
  },

  onTapCreateFamily() {
    // 写入 pending action，让协作页 onShow 消费后自动打开创建弹窗
    const app = getApp<AppWithBootstrapAndGlobal>();
    app.globalData.pendingFamilyAction = 'create';
    wx.switchTab({ url: '/pages/family/index' });
  },

  onTapBulletin() {
    wx.navigateTo({ url: '/pages-family/bulletin/index' });
  },

  onTapAbout() {
    wx.navigateTo({ url: '/pages-family/about/index' });
  },

  /** 导入导出 / 意见反馈 — 一期占位 */
  onTapComingSoon() {
    wx.showToast({ title: '即将支持', icon: 'none' });
  },

  async onTapLogout() {
    const res = await wx.showModal({ title: '退出登录', content: '确定要退出吗？' });
    if (res.confirm) {
      // 退出前主动推送本地未同步数据 · 保证用户离开前数据尽量上行
      // syncOnce 需要 familyId + 登录态，必须在 logout() 清除前调用
      try { await syncOnce('hide'); } catch { /* 吞错 · logout 必须成功 */ }
      stopScheduler();
      // mine-overview: 退出登录时清缓存，避免下次冷启动登录后命中陈旧数据
      invalidateUserOverview();
      // COSTRA-102 D2.2：logout 已改为 async（含真调 POST /auth/logout 204）
      // 内部已自带 wx.reLaunch，此处无需再跳
      await logout();
    }
  },

  // ICP 备案号仅展示，不再提供点击复制/弹窗（工信部备案查询由用户自行访问 beian.miit.gov.cn）
  // Refs: 沪ICP备2026017253号-1X（小程序）· 沪ICP备2026017253号-2（后端 costra.cloud）
});
