// services/eventBus.ts · 全局事件总线
// 卡号: COSTRA-201 / COSTRA-220 · 极简发布/订阅模式 · 用于记账覆盖层控制 + 明细页响应式刷新
// 设计决策: 单例 import 模式（优于 globalData 挂载 · 更清晰的依赖关系）

type Handler = (data?: unknown) => void;

/** 事件名常量 · 防止拼写错误 */
export const EventNames = {
  /** 显示记账覆盖层 */
  SHOW_EXPENSE_OVERLAY: 'show-expense-overlay',
  /** 隐藏记账覆盖层 */
  HIDE_EXPENSE_OVERLAY: 'hide-expense-overlay',
  /** 记账保存成功（COSTRA-220: 明细页响应式刷新） */
  ENTRY_SAVED: 'entry-saved',
  /** 条目编辑保存成功（COSTRA-227: 明细页响应式刷新） */
  ENTRY_UPDATED: 'entry-updated',
  /** 隐藏 TabBar（通用：任何全屏面板打开时） */
  HIDE_TAB_BAR: 'hide-tab-bar',
  /** 显示 TabBar（通用：全屏面板关闭时） */
  SHOW_TAB_BAR: 'show-tab-bar',
  /** Outbox 入队（触发 mutation sync） */
  OUTBOX_ENQUEUED: 'outbox-enqueued',
  /** 同步完成（pulled>0 或 pushed>0 时由 syncScheduler emit · 各 tab 页订阅后即时刷新） */
  SYNC_DONE: 'sync-done',
  /** 用户画像未完善（has_completed_profile=false · bootstrap 检测后广播 · tabBar + mine 页订阅） */
  PROFILE_INCOMPLETE: 'profile-incomplete',
  /** 用户画像已完善（PATCH /users/me 成功后广播 · 清除红点） */
  PROFILE_COMPLETED: 'profile-completed',
  /**
   * 用户画像已更新（PATCH /users/me 成功后广播 · 携带新的昵称/头像URL）
   * 各 Tab 页订阅后即时刷新头像和昵称展示，无需等 onShow 重读 token 或重拉 API。
   * payload: ProfileUpdatedPayload
   */
  PROFILE_UPDATED: 'profile-updated',
  /** 分类数据已加载/更新到内存缓存（订阅方据此重渲展示分类名/图标的页面） */
  CATEGORIES_LOADED: 'categories-loaded',
  /**
   * 全局 active family/ledger 已切换（setActiveFamily 写完 storage 后广播）
   * 各 Tab 页订阅后重读 context 并刷新；统一收口"账本切换"反应链路。
   * payload: ActiveFamilyChangedPayload
   */
  ACTIVE_FAMILY_CHANGED: 'active-family-changed',
  /** 公告未读状态变更（有新公告或公告被标记已读后广播） */
  ANNOUNCEMENT_UNREAD_CHANGED: 'announcement-unread-changed',
} as const;

export type EventName = typeof EventNames[keyof typeof EventNames];

/**
 * SYNC_DONE 事件 payload
 * 仅在本次 sync 实际拉到/推送了数据时由 syncScheduler 广播，
 * 订阅方按需根据 pulled/pushed 决定是否刷新。
 */
export interface SyncDonePayload {
  /** 本次 sync 从服务端拉回的 entry 条数（>=0） */
  pulled: number;
  /** 本次 sync 成功推送到服务端的 op 条数（>=0） */
  pushed: number;
  /** 触发本次 sync 的来源 */
  trigger: 'launch' | 'network-recover' | 'page-show' | 'periodic' | 'mutation' | 'hide' | 'conflict-retry' | 'ledger-switch';
}

/**
 * PROFILE_UPDATED 事件 payload
 * profile-setup 保存成功后广播，各 Tab 页据此即时刷新头像和昵称展示。
 * 数据来源：本地 token（updateLocalUserProfile 已更新），无需再请求服务端。
 */
export interface ProfileUpdatedPayload {
  nickname: string;
  avatarUrl: string | null;
}

/**
 * ACTIVE_FAMILY_CHANGED 事件 payload
 * setActiveFamily 写完 storage 后广播，各 Tab 页据此同步切换。
 * 设计意图：把"账本切换"从隐式懒同步（onShow 重读 storage）改为显式事件驱动，
 *           让常驻 Tab 页（如 statistics 页 _initialized=true reShow 短路路径）也能即时响应。
 */
export interface ActiveFamilyChangedPayload {
  family_id: string;
  ledger_id: string;
  family_kind: 'personal' | 'shared';
  ledger_name: string;
  /** 触发来源（用于调试 + 必要时区分行为，如自身页面发起的切换可跳过自刷新） */
  source: 'ledger-switch' | 'family-switch' | 'family-create' | 'family-rename' | 'invite-confirm' | 'preference-restore' | 'logout' | 'other';
}

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
