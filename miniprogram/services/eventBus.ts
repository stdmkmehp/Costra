// services/eventBus.ts · 全局事件总线
// 卡号: COSTRA-201 · 极简发布/订阅模式 · 用于记账覆盖层控制
// 设计决策: 单例 import 模式（优于 globalData 挂载 · 更清晰的依赖关系）

type Handler = (data?: unknown) => void;

/** 事件名常量 · 防止拼写错误 */
export const EventNames = {
  /** 显示记账覆盖层 */
  SHOW_EXPENSE_OVERLAY: 'show-expense-overlay',
  /** 隐藏记账覆盖层 */
  HIDE_EXPENSE_OVERLAY: 'hide-expense-overlay',
} as const;

export type EventName = typeof EventNames[keyof typeof EventNames];

class EventBus {
  private listeners: Map<string, Set<Handler>> = new Map();

  /** 订阅事件 · 返回的 handler 可用于 off 取消 */
  on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /** 取消订阅 · 必须传入 on 时相同的 handler 引用 */
  off(event: string, handler: Handler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** 发布事件 · 通知所有订阅者 */
  emit(event: string, data?: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error('[EventBus] handler error:', event, err);
        }
      });
    }
  }
}

/** 全局单例 · 直接 import 使用 */
export const eventBus = new EventBus();
