// custom-tab-bar/index.ts · 5 Tab 中置式自定义 TabBar
// 卡号: COSTRA-201 / COSTRA-210 · 中间 [+] 按钮通过 eventBus 触发记账覆盖层（不跳路由） + 切Tab防御性关闭
// COSTRA-205: 覆盖层显隐时同步隐藏/显示 TabBar（解决键盘底部被遮挡）
// 设计源: design/ui/design_spec.md §3 + design/ui/interaction_flow.md §2
// 微信文档: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/custom-tabbar.html

import { eventBus, EventNames } from '../services/eventBus';

/** Tab 路由映射 · index 2 是 [+] 不走路由 */
const TAB_ROUTES: Record<number, string> = {
  0: '/pages/ledger/index',
  1: '/pages/statistics/index',
  // 2: 记账按钮 · 不跳路由 · 通过 eventBus 显示覆盖层
  3: '/pages/family/index',
  4: '/pages/mine/index',
};

Component({
  data: {
    /** 当前选中 index（0-4）· index 2 是 [+] 不会被 selected */
    selected: 0,
    /** 是否隐藏 TabBar（覆盖层显示时隐藏，避免遮挡键盘） */
    hidden: false,
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
    },
  },

  methods: {
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
     * 外部调用 · 各 Tab 页 onShow 中通过 this.getTabBar()?.setSelected(n) 更新选中态
     */
    setSelected(idx: number) {
      this.setData({ selected: idx });
    },
  },
});
