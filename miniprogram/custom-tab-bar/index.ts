// custom-tab-bar/index.ts · 5 Tab 中置式自定义 TabBar
// 卡号: COSTRA-201 / COSTRA-210 · 中间 [+] 按钮通过 eventBus 触发记账覆盖层（不跳路由） + 切Tab防御性关闭
// COSTRA-205: 覆盖层显隐时同步隐藏/显示 TabBar（解决键盘底部被遮挡）
// 设计源: design/ui/design_spec.md §3 + design/ui/interaction_flow.md §2
// 微信文档: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/custom-tabbar.html
//
// hidden 状态机（2026-06-05 重构）：
//   tabbar 是 hidden 真相源，外部不再直接 setData({hidden})。
//   内部根据两个独立维度合成：
//     _unlocked：页面 onShow 中 markUnlocked() 解锁，单向不可逆（防冷启动闪烁）
//     _panelOpen：是否有任何全屏面板打开，由 HIDE_TAB_BAR/SHOW_TAB_BAR 事件维护
//   hidden = !_unlocked || _panelOpen
//
//   优势：
//   1. 解决退后台再前台时 page.onShow 与面板状态的 race（page.onShow 不再直接覆盖 hidden）
//   2. tabbar 进后台不 detach，_panelOpen 在前后台切换时保留，无需 page 重新校正
//   3. family/ledger 等 page.onShow 不再需要重复实现"是否有面板打开"的判断逻辑

import { eventBus, EventNames } from '../services/eventBus';
import { getItem, setItem } from '../services/storage';
import { getToken } from '../services/auth';

/** Tab 路由映射 · index 2 是 [+] 不走路由 */
const TAB_ROUTES: Record<number, string> = {
  0: '/pages/ledger/index',
  1: '/pages/statistics/index',
  // 2: 记账按钮 · 不跳路由 · 通过 eventBus 显示覆盖层
  3: '/pages/family/index',
  4: '/pages/mine/index',
};

/**
 * storage key：用户是否已点击过「我的」tab。
 * 只要点过一次，本次及后续启动都不再显示 tabBar 红点（与资料是否填写解绑）。
 */
const MINE_TAB_VISITED_KEY = '__costra_mine_tab_visited';

Component({
  data: {
    /** 当前选中 index（0-4）· index 2 是 [+] 不会被 selected */
    selected: 0,
    /**
     * 是否隐藏 TabBar（由内部 _unlocked + _panelOpen 合成 · 外部不应直接 setData）
     * 初始 true：冷启动时 _unlocked=false 即 hidden=true，防止未登录用户闪烁 tabBar 后再跳登录页。
     */
    hidden: true,
    /**
     * 「我的」tab 红点：
     * - 显示：has_completed_profile=false 且用户尚未点过 mine tab
     * - 消除：点击「我的」tab 即刻消失 + 写 storage，与资料是否真正填写无关
     */
    showProfileBadge: false,
  },

  lifetimes: {
    attached() {
      // 初始化实例状态（Component 不支持顶层声明实例属性，挂在 this 上）
      const self = this as unknown as Record<string, unknown>;
      self._unlocked = false;
      self._panelOpen = false;

      // 隐藏 TabBar：记账覆盖层 SHOW + 任何全屏面板 HIDE_TAB_BAR
      const hideHandler = () => {
        (this as unknown as Record<string, unknown>)._panelOpen = true;
        this._applyHidden();
      };
      (this as unknown as Record<string, unknown>)._hideHandler = hideHandler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, hideHandler);
      eventBus.on(EventNames.HIDE_TAB_BAR, hideHandler);

      // 恢复 TabBar：覆盖层 HIDE + 全屏面板 SHOW_TAB_BAR
      const showHandler = () => {
        (this as unknown as Record<string, unknown>)._panelOpen = false;
        this._applyHidden();
      };
      (this as unknown as Record<string, unknown>)._showHandler = showHandler;
      eventBus.on(EventNames.HIDE_EXPENSE_OVERLAY, showHandler);
      eventBus.on(EventNames.SHOW_TAB_BAR, showHandler);

      // 订阅 PROFILE_INCOMPLETE 事件（覆盖冷启动已登录 / 登录成功后的 emit）
      const badgeOnHandler = () => { this._tryShowBadge(); };
      (this as unknown as Record<string, unknown>)._badgeOnHandler = badgeOnHandler;
      eventBus.on(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);

      // 主动检测一次：应对 tabBar attach 晚于 emit 的时序竞争
      // 场景：冷启动 bootstrap 极快，emit 发出时 tabBar 尚未 attach，事件被错过
      this._tryShowBadge();
    },

    detached() {
      const hideHandler = (this as unknown as Record<string, unknown>)._hideHandler as (() => void) | undefined;
      if (hideHandler) {
        eventBus.off(EventNames.SHOW_EXPENSE_OVERLAY, hideHandler);
        eventBus.off(EventNames.HIDE_TAB_BAR, hideHandler);
      }
      const showHandler = (this as unknown as Record<string, unknown>)._showHandler as (() => void) | undefined;
      if (showHandler) {
        eventBus.off(EventNames.HIDE_EXPENSE_OVERLAY, showHandler);
        eventBus.off(EventNames.SHOW_TAB_BAR, showHandler);
      }
      const badgeOnHandler = (this as unknown as Record<string, unknown>)._badgeOnHandler as (() => void) | undefined;
      if (badgeOnHandler) {
        eventBus.off(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);
      }
    },
  },

  methods: {
    /**
     * 尝试显示红点：需同时满足
     *   1. 当前 token 的 has_completed_profile=false
     *   2. 用户尚未点击过 mine tab（storage 无已访问标记）
     */
    _tryShowBadge() {
      const token = getToken();
      if (!token || token.raw.user.has_completed_profile) return;
      void getItem<boolean>(MINE_TAB_VISITED_KEY).then((visited) => {
        if (!visited) {
          this.setData({ showProfileBadge: true });
        }
      });
    },

    /**
     * 切换 Tab · index 2 特殊处理为 emit 事件
     * 交互规范: interaction_flow.md §2 — "不发生页面路由跳转"
     */
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);

      if (index === 2) {
        // 中间 [+] 按钮 · 触发记账覆盖层
        eventBus.emit(EventNames.SHOW_EXPENSE_OVERLAY);
        return;
      }

      // 点击「我的」tab：立即消红点 + 持久化已访问标记（与资料是否填写解绑）
      if (index === 4 && this.data.showProfileBadge) {
        this.setData({ showProfileBadge: false });
        void setItem(MINE_TAB_VISITED_KEY, true);
      }

      // COSTRA-210 方案 C：普通 Tab 切换前防御性 emit HIDE
      // 根因：overlay 多实例 + SHOW 广播，切 Tab 时后台实例可能 visible=true 残留。
      // 在 wx.switchTab 前广播 HIDE，确保所有 overlay 实例同步关闭。
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);

      const url = TAB_ROUTES[index];
      if (url) {
        wx.switchTab({ url });
      }
    },

    /**
     * 各 Tab 页 onShow 调用：仅传 selected，不再传 hidden（hidden 由 tabbar 内部计算）。
     * 调用此方法即视为"页面就绪"，会单向解锁 _unlocked。
     */
    markActive(idx: number) {
      (this as unknown as Record<string, unknown>)._unlocked = true;
      const panelOpen = (this as unknown as Record<string, unknown>)._panelOpen as boolean;
      const patch: { selected: number; hidden?: boolean } = { selected: idx };
      if (this.data.hidden !== panelOpen) {
        patch.hidden = panelOpen;
      }
      this.setData(patch);
    },

    /** 内部：根据 _unlocked + _panelOpen 应用 hidden。 */
    _applyHidden() {
      const self = this as unknown as Record<string, unknown>;
      const unlocked = self._unlocked as boolean;
      const panelOpen = self._panelOpen as boolean;
      const nextHidden = !unlocked || panelOpen;
      if (this.data.hidden !== nextHidden) {
        this.setData({ hidden: nextHidden });
      }
    },
  },
});
