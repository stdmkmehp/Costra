// pages-gm/impersonate/index.ts · GM 切换登录身份页
// 事实源: docs/ops/gm-impersonate-design.md §3.4（v2 · 2026-09-02 双榜单改造）
//
// 双榜单（近7天活跃 / 最近注册）一次全量下发（各 Top 200 · 服务端 Redis 缓存 30min），
// 每区客户端本地翻页（每页 10 条 · 独立页码）：本地切片瞬时、每页条数固定 ⇒ 列表高度恒定，
// 翻页按钮位置不动（根治旧版"翻页发请求 → loading 跳动 → 按钮滑出屏幕"）。
//
// 切换流程（复用 mine 页 logout 清理语义 + D7 远端吊销）：
//   确认弹窗 → syncOnce('hide') → pendingCount>0 二次弹窗
//   → stopScheduler → revokeSessionRemote → clearToken → resetLocalData
//   → gmLoginAs → startScheduler → reLaunch(/pages/ledger/index)
// 不设置 globalData.userLoggedOut（impersonate 后已是登录态，非登出）。

import { getToken, gmLoginAs, revokeSessionRemote, clearToken } from '../../services/auth';
import { listGmUsers, type GmActiveUserItem, type GmRecentUserItem } from '../../services/gmApi';
import { syncOnce, stopScheduler, startScheduler } from '../../services/syncScheduler';
import { pendingCount } from '../../services/outbox';
import { resetLocalData } from '../../services/localReset';
import { logger } from '../../utils/logger';

/** 每区每页条数（双区同页 · 条数固定保证翻页时布局高度恒定） */
const PAGE_SIZE = 10;

interface ActiveView extends GmActiveUserItem {
  meta_text: string;
  initial: string;
}

interface RecentView extends GmRecentUserItem {
  meta_text: string;
  initial: string;
}

Page({
  data: {
    activeItems: [] as ActiveView[],
    recentItems: [] as RecentView[],
    activePage: 1,
    recentPage: 1,
    activePages: 1,
    recentPages: 1,
    activeTotal: 0,
    recentTotal: 0,
    loading: true,
    switching: false,
  },

  // 全量榜单挂实例属性（非渲染态 · 避免大数组进 data 参与 diff）；
  // onLoad 每次整体重新赋值替换引用，初始空数组永不被原地修改，多实例无共享隐患
  _activeAll: [] as ActiveView[],
  _recentAll: [] as RecentView[],

  onLoad() {
    // 防御：非 GM 用户直接返回（服务端仍有 requireGm 实时查库兜底）
    if (getToken()?.raw.user.is_gm !== true) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => { wx.navigateBack({ fail: () => { /* 无栈可退时静默 */ } }); }, 600);
      return;
    }
    void this._loadLists();
  },

  onTapCreateFake() {
    if (this.data.switching) return;
    void this._switchTo({ createFake: true }, '新伪造账号');
  },

  onTapUser(e: WechatMiniprogram.TouchEvent) {
    if (this.data.switching) return;
    const item = e.currentTarget.dataset.item as ActiveView | RecentView;
    if (!item?.id) return;
    void this._switchTo({ userId: item.id }, item.nickname);
  },

  /** 切换中遮罩的 touchmove 截断（防滚动穿透） */
  noop() { /*  intentionally empty */ },

  onActivePrev() {
    if (this.data.activePage > 1) this._setActivePage(this.data.activePage - 1);
  },

  onActiveNext() {
    if (this.data.activePage < this.data.activePages) this._setActivePage(this.data.activePage + 1);
  },

  onRecentPrev() {
    if (this.data.recentPage > 1) this._setRecentPage(this.data.recentPage - 1);
  },

  onRecentNext() {
    if (this.data.recentPage < this.data.recentPages) this._setRecentPage(this.data.recentPage + 1);
  },

  async _loadLists() {
    this.setData({ loading: true });
    try {
      const resp = await listGmUsers();
      this._activeAll = resp.active.map(_toActiveView);
      this._recentAll = resp.recent.map(_toRecentView);
      this.setData({
        activePage: 1,
        recentPage: 1,
        activePages: _pageCount(this._activeAll.length),
        recentPages: _pageCount(this._recentAll.length),
        activeTotal: this._activeAll.length,
        recentTotal: this._recentAll.length,
        activeItems: _slicePage(this._activeAll, 1),
        recentItems: _slicePage(this._recentAll, 1),
        loading: false,
      });
    } catch (err) {
      logger.warn('gm', 'list gm users failed', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  _setActivePage(page: number) {
    this.setData({ activePage: page, activeItems: _slicePage(this._activeAll, page) });
  },

  _setRecentPage(page: number) {
    this.setData({ recentPage: page, recentItems: _slicePage(this._recentAll, page) });
  },

  async _switchTo(target: { userId?: string; createFake?: boolean }, label: string) {
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
        // 注：localReset → *Api → request → auth 是 CommonJS 循环依赖但无害——顶层无同步调用，
        // 运行时 exports 早已填齐；早期动态 import() 的写法在小程序运行时不受支持（Failed to fetch
        // dynamically imported module），会导致本地数据清理静默失败 → GM 切换身份后串账。
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

function _pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function _slicePage<T>(all: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return all.slice(start, start + PAGE_SIZE);
}

function _toActiveView(u: GmActiveUserItem): ActiveView {
  return {
    ...u,
    meta_text: `近7天 ${u.entry_count_7d} 笔 · 最后活跃 ${_formatDateTime(u.last_active_at)} · ${u.id_short}`,
    initial: (u.nickname || '?').slice(0, 1),
  };
}

function _toRecentView(u: GmRecentUserItem): RecentView {
  return {
    ...u,
    meta_text: `${_formatDate(u.created_at)} 注册 · ${u.id_short}`,
    initial: (u.nickname || '?').slice(0, 1),
  };
}

function _formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
