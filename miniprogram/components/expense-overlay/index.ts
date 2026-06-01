// components/expense-overlay/index.ts · 记账覆盖层占位组件
// 卡号: COSTRA-201 · 由 custom-tab-bar [+] 按钮通过 eventBus 触发
// 交互规范: interaction_flow.md §2 — "不发生页面路由跳转"

import { eventBus, EventNames } from '../../services/eventBus';

/** handler 类型 · 用于 lifetimes 中订阅/取消订阅 */
type ShowHandler = () => void;

Component({
  data: {
    visible: false,
  },

  lifetimes: {
    attached() {
      // 订阅显示事件 · 保存 handler 引用供 detached 取消
      const handler: ShowHandler = () => {
        this.setData({ visible: true });
      };
      // 微信 Component this 无 _showHandler 类型声明 · 通过 unknown 中转挂载
      (this as unknown as Record<string, unknown>)._showHandler = handler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, handler);
    },

    detached() {
      // 取消订阅 · 防止内存泄漏
      const handler = (this as unknown as Record<string, unknown>)._showHandler as ShowHandler | undefined;
      if (handler) {
        eventBus.off(EventNames.SHOW_EXPENSE_OVERLAY, handler);
      }
    },
  },

  methods: {
    /** 关闭覆盖层 */
    onClose() {
      this.setData({ visible: false });
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
    },

    /** 阻止触摸事件穿透到底层页面 */
    noop() {
      // intentionally empty
    },
  },
});
