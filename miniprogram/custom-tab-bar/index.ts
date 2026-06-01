// custom-tab-bar/index.ts · 5 Tab 中置式自定义 TabBar
// 卡号: COSTRA-201 · 中间 [+] 按钮通过 eventBus 触发记账覆盖层（不跳路由）
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
