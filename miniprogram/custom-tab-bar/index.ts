// custom-tab-bar/index.ts · 5 Tab 中置式自定义 TabBar
// 卡号: COSTRA-201 / COSTRA-210 · 中间 [+] 按钮通过 eventBus 触发记账覆盖层（不跳路由） + 切Tab防御性关闭
// COSTRA-205: 覆盖层显隐时同步隐藏/显示 TabBar（解决键盘底部被遮挡）
// 设计源: design/ui/design_spec.md §3 + design/ui/interaction_flow.md §2
// 微信文档: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/custom-tabbar.html

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
    /** 是否隐藏 TabBar（覆盖层显示时隐藏，避免遮挡键盘） */
    hidden: false,
    /**
     * 「我的」tab 红点：
     * - 显示：has_completed_profile=false 且用户尚未点过 mine tab
     * - 消除：点击「我的」tab 即刻消失 + 写 storage，与资料是否真正填写无关
     */
    showProfileBadge: false,
  },

  lifetimes: {
    attached() {
      // 隐藏 TabBar（记账覆盖层 + 任何全屏面板）
      const hideHandler = () => { this.setData({ hidden: true }); };
      (this as unknown as Record<string, unknown>)._hideHandler = hideHandler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, hideHandler);
      eventBus.on(EventNames.HIDE_TAB_BAR, hideHandler);

      // 恢复 TabBar
      const showHandler = () => { this.setData({ hidden: false }); };
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
     * 外部调用 · 各 Tab 页 onShow 中通过 this.getTabBar()?.setData?.({ selected: n }) 更新选中态
     */
    setSelected(idx: number) {
      this.setData({ selected: idx });
    },
  },
});
