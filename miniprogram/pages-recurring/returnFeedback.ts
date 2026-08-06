// pages-recurring/returnFeedback.ts · 定时记账「返回后一次性反馈」通道
//
// 背景：编辑页在 `wx.navigateBack()` 后页面随即销毁，若由编辑页自己
// `setTimeout(() => wx.showToast(...))`，真机上该 timer 可能随页面销毁而失效，
// 导致返回后的 toast 不出现。
//
// 方案：编辑页返回前把要提示的文案写入本模块；列表页 `onShow` 消费并 `wx.showToast`。
// toast 由存活的列表页发起，不依赖即将销毁页面的 timer。
// 本模块为「一次性」通道：消费后立即清空，避免跨页面残留。
//
// 扩展（右滑自动保存）：右滑返回时编辑页在 onUnload 同步发起异步保存（fire-and-forget），
// 保存由 AppService 承载、页面销毁后仍会跑完。编辑页把该保存 Promise 写入本模块，
// 列表页 onShow 可以 await 它拿到最终结果再弹 toast，避免「乐观 toast 被失败覆盖」的闪烁。

/** 右滑自动保存的结果类型（与编辑页 SaveOutcome 对齐，仅保留列表页需要展示的状态） */
export type PendingSaveResult =
  | { status: 'success' }
  | { status: 'invalid' }
  | { status: 'network_error' }
  | { status: 'version_conflict' }
  | { status: 'error'; message: string };

let pendingToast: string | null = null;

/** 编辑页返回前写入一次性返回反馈文案。 */
export function setRecurringReturnToast(title: string): void {
  pendingToast = title;
}

/** 列表页 onShow 消费：取走 pending 文案并清空；无 pending 时返回 null。 */
export function consumeRecurringReturnToast(): string | null {
  const title = pendingToast;
  pendingToast = null;
  return title;
}

// ─── 右滑自动保存的异步结果通道 ───────────────────────────────────────────────

let pendingSave: Promise<PendingSaveResult> | null = null;

/**
 * 编辑页 onUnload 同步发起保存后，把保存 Promise 写入本通道。
 * 列表页 onShow 通过 await consumePendingSave() 拿到最终结果决定 toast 文案。
 * 消费后立即清空，避免跨页面残留。
 */
export function setPendingSave(p: Promise<PendingSaveResult>): void {
  pendingSave = p;
}

/**
 * 列表页 onShow 消费：取走 pending save Promise 并清空；无 pending 时返回 null。
 * 返回的 Promise 一定 resolve（不会 reject），调用方可安全 await。
 */
export function consumePendingSave(): Promise<PendingSaveResult> | null {
  const p = pendingSave;
  pendingSave = null;
  return p;
}
