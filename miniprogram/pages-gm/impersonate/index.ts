// pages-gm/impersonate/index.ts · GM 切换登录身份页
// 事实源: docs/ops/gm-impersonate-design.md §3.4
//
// 切换流程（复用 mine 页 logout 清理语义 + D7 远端吊销）：
//   确认弹窗 → syncOnce('hide') → pendingCount>0 二次弹窗
//   → stopScheduler → revokeSessionRemote → clearToken → resetLocalData
//   → gmLoginAs → startScheduler → reLaunch(/pages/ledger/index)
// 不设置 globalData.userLoggedOut（impersonate 后已是登录态，非登出）。

import { getToken, gmLoginAs, revokeSessionRemote, clearToken } from '../../services/auth';
import { listGmUsers, type GmUserItem } from '../../services/gmApi';
import { syncOnce, stopScheduler, startScheduler } from '../../services/syncScheduler';
import { pendingCount } from '../../services/outbox';
import { logger } from '../../utils/logger';

interface GmUserView extends GmUserItem {
  created_text: string;
  initial: string;
}

const FAKE_OPENID_PATTERN = /^gm_fake_[A-Za-z0-9_-]{4,64}$/;

Page({
  data: {
    items: [] as GmUserView[],
    page: 1,
    hasMore: false,
    loading: false,
    switching: false,
    fakeOpenid: '',
  },

  onLoad() {
    // 防御：非 GM 用户直接返回（服务端仍有 requireGm 实时查库兜底）
    if (getToken()?.raw.user.is_gm !== true) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => { wx.navigateBack({ fail: () => { /* 无栈可退时静默 */ } }); }, 600);
      return;
    }
    void this._loadPage(1);
  },

  onFakeInput(e: WechatMiniprogram.Input) {
    this.setData({ fakeOpenid: (e.detail.value || '').trim() });
  },

  onTapFakeLogin() {
    if (this.data.switching) return;
    const fakeOpenid = this.data.fakeOpenid;
    if (!FAKE_OPENID_PATTERN.test(fakeOpenid)) {
      wx.showToast({ title: '须为 gm_fake_ 前缀（4~64 位）', icon: 'none' });
      return;
    }
    void this._switchTo({ fakeOpenid }, fakeOpenid);
  },

  onTapUser(e: WechatMiniprogram.TouchEvent) {
    if (this.data.switching) return;
    const item = e.currentTarget.dataset.item as GmUserView;
    if (!item?.id) return;
    void this._switchTo({ userId: item.id }, item.nickname);
  },

  /** 切换中遮罩的 touchmove 截断（防滚动穿透） */
  noop() { /*  intentionally empty */ },

  onPrevPage() {
    if (this.data.loading || this.data.page <= 1) return;
    void this._loadPage(this.data.page - 1);
  },

  onNextPage() {
    if (this.data.loading || !this.data.hasMore) return;
    void this._loadPage(this.data.page + 1);
  },

  async _loadPage(page: number) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const resp = await listGmUsers(page);
      this.setData({
        items: resp.items.map(_toView),
        page: resp.page,
        hasMore: resp.has_more,
        loading: false,
      });
    } catch (err) {
      logger.warn('gm', 'list gm users failed', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async _switchTo(target: { userId?: string; fakeOpenid?: string }, label: string) {
    const res = await wx.showModal({
      title: '切换登录身份',
      content: `确定切换到「${label}」吗？当前账号将退出。`,
    });
    if (!res.confirm) return;

    // 在本地清理前捕获 GM access_token（clearToken 后 request 无法自动注入 Bearer）
    const gmAccessToken = getToken()?.raw.access_token;
    if (!gmAccessToken) {
      wx.showToast({ title: '登录态已失效', icon: 'none' });
      return;
    }

    this.setData({ switching: true });
    try {
      // 切换前主动推送本地未同步数据（syncOnce 需 familyId + 登录态，必须在清理前调用）
      try { await syncOnce('hide'); } catch { /* 吞错 · 切换必须可继续 */ }
      let pending = 0;
      try { pending = await pendingCount(); } catch { /* 读取失败按无未上行处理，不阻塞切换 */ }
      if (pending > 0) {
        const confirmRes = await wx.showModal({
          title: '切换登录身份',
          content: '最新记录可能尚未同步，切换后可能丢失，是否确认切换？',
        });
        if (!confirmRes.confirm) return;
      }

      // 全部确认通过后才停调度：取消分支零成本，调度器保持存活
      stopScheduler();
      // D7：远端吊销当前会话（须在 clearToken 前携带 refresh_token · 吞错不阻塞）
      await revokeSessionRemote();
      await clearToken();
      try {
        // 动态引入 localReset 以避免循环依赖（localReset → *Api → request → auth）
        const { resetLocalData } = await import('../../services/localReset');
        await resetLocalData();
      } catch (err) {
        logger.warn('gm', 'reset local data on impersonate failed', err);
      }

      try {
        await gmLoginAs(target, gmAccessToken);
      } catch (err) {
        // 本地已全清但登录失败：回登录页走标准登录闭环
        logger.warn('gm', 'gm impersonate login failed', err);
        wx.showToast({ title: '切换失败，请重新登录', icon: 'none' });
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      startScheduler(); // 已幂等
      wx.reLaunch({ url: '/pages/ledger/index' });
    } finally {
      this.setData({ switching: false });
    }
  },
});

function _toView(u: GmUserItem): GmUserView {
  return {
    ...u,
    created_text: _formatDate(u.created_at),
    initial: (u.nickname || '?').slice(0, 1),
  };
}

function _formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
