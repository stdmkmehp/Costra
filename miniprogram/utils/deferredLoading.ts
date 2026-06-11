// utils/deferredLoading.ts · "加载中"延迟显示工具（COSTRA-304 体感优化）
// Refs: docs/code-review-categories-restructure-2026-06-11.md（同期相关）
//
// ═══════════════════════════════════════════════════════════════════════
// 背景
//
// 统计页/协作页排行区第一次点开下钻时，会"闪一下加载中"再立刻刷新出列表。
// 当端到端 RTT 在 100~300ms 区间，"加载中"出现-消失只持续不到一帧，反成视觉噪声。
//
// 业界共识：100ms 以内用户感觉"瞬时"，无需任何反馈；超过 ~300ms 才需要 loading 反馈。
//
// 本工具的策略：点击后不立刻显示"加载中"，先启动一个 275ms 延时定时器；
//   - 数据在 275ms 内回来 → cancel 定时器 → loading 永不显示，列表直出。
//   - 275ms 内未回 → 定时器到点显示"加载中…"，继续等数据。
//
// 端到端估算（统计页 L2 下钻为例）：
//   - 乐观路径（强网+热连接+热缓存）：~165ms → 直出，体验最干净
//   - 典型路径（家用 4G/Wi-Fi）：~275ms → 几乎吞掉 loading
//   - 慢路径（弱网/冷查询）：~600ms → 显示 loading 仅多等 75ms（用户感知不到）
//   - 极端路径（边缘网络）：~900ms → 显示 loading 是必需的反馈
//
// 阈值定为 275ms，单一来源；上线后可基于 services/perf.ts 真机数据再调优。
// ═══════════════════════════════════════════════════════════════════════

/**
 * "加载中"延迟显示阈值（毫秒）。
 *
 * 设计取值的取舍空间：
 *   - 过小（≤150ms）：典型路径仍闪 50~100ms loading，改造收益打折。
 *   - 过大（≥400ms）：慢路径下用户已经在等待了仍无反馈，会反复点击。
 *   - 275ms 平衡点：吞掉乐观+典型路径的 loading，慢路径仅推迟显示 75ms。
 *
 * 单测可通过 scheduleDeferredLoading(onFire, customDelayMs) 注入更短值快速验证。
 */
export const LOADING_DELAY_MS = 275;

/**
 * deferred loading 句柄。
 *
 * 调用方契约（必须遵守）：
 *   1. 句柄须保留到 settle 时刻。settle 路径（数据到达 / 失败 / 用户主动收起 /
 *      切换上下文 / 视图失效 / 页面卸载）**必须**调用 cancel()。
 *   2. settle 时根据 fired 字段决定是否需要写回 loading:false：
 *        const update = { ...data };
 *        if (handle.fired) update[loadingKey] = false;
 *        this.setData(update);
 *      未 fire 过则不写 loading 字段，保持"loading 从未显示过"的视觉。
 *   3. fired 表示定时器已到点并调用过 onFire；若 onFire 内部自校验后未实际写 loading:true，
 *      fired 仍为 true，因此调用方应把它理解为"可能显示过 loading"的保守信号。
 *   4. onFire 回调内部应做"是否仍然有效"的自校验，再决定是否真的写 loading:true。
 */
export interface DeferredLoadingHandle {
  /**
   * 取消定时器。
   *
   * - 若 onFire 尚未触发：取消后 onFire 永不会执行。
   * - 若 onFire 已经触发：调用方应根据 fired 字段决定是否需要 setData(loading:false)。
   *
   * 多次调用幂等。
   */
  cancel(): void;
  /**
   * 定时器是否已到点并调用过 onFire。
   *
   * - false：loading 一定从未显示过 → settle 时不需要写 loading:false。
   * - true：loading 可能已经显示过 → settle 时可保守写 loading:false 关闭它。
   */
  readonly fired: boolean;
}

/**
 * 调度一次延迟 loading 显示。
 *
 * @param onFire 到点后执行的回调。回调内部应：
 *   (1) 自校验当前节点/视图是否仍处于"等待数据"状态（避免与并发事件竞态写脏 setData）；
 *   (2) 通过最小数据路径写入 `loading: true`。
 * @param delayMs 自定义延迟时长（默认 LOADING_DELAY_MS = 275ms）。单测注入更短值时使用。
 * @returns DeferredLoadingHandle，调用方须妥善持有并在 settle/收起/切换/卸载时 cancel。
 *
 * 实现注意：
 *   - 内部使用 setTimeout，宿主线程顺序执行；onFire 入队后 cancel 仍可能"差一步"取消失败。
 *   - 因此回调内置 cancelled 标志保护，cancel() 后即便回调已出队也会被忽略。
 */
export function scheduleDeferredLoading(
  onFire: () => void,
  delayMs: number = LOADING_DELAY_MS,
): DeferredLoadingHandle {
  let cancelled = false;
  let fired = false;
  const timerId = setTimeout(() => {
    if (cancelled) return;
    fired = true;
    onFire();
  }, delayMs);

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timerId);
    },
    get fired(): boolean {
      return fired;
    },
  };
}
