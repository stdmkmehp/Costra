// pages-recurring/returnFeedback.ts · 定时记账「返回后一次性反馈」通道
//
// 背景：编辑页在 `wx.navigateBack()` 后页面随即销毁，若由编辑页自己
// `setTimeout(() => wx.showToast(...))`，真机上该 timer 可能随页面销毁而失效，
// 导致返回后的 toast 不出现。
//
// 方案：编辑页返回前把要提示的文案写入本模块；列表页 `onShow` 消费并 `wx.showToast`。
// toast 由存活的列表页发起，不依赖即将销毁页面的 timer。
// 本模块为「一次性」通道：消费后立即清空，避免跨页面残留。

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
