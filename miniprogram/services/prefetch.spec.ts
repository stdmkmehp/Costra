// services/prefetch.spec.ts · 首屏后预热调度兜底单测
// 覆盖：LEDGER_DISPLAY_READY 与 3s 兜底定时器「先到先触发」、幂等放行、重复调度跳过。
// 设计：mock 各 API 依赖（让 prefetchHomeData 进入即返回），用真实 eventBus 驱动事件，
//       以 getActiveFamilyId 是否被调用作为「prefetch 已触发」的可观测信号。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scheduleHomeDataPrefetchAfterLedgerReady, __test__ } from './prefetch';
import { eventBus, EventNames } from './eventBus';

// ─── mock 依赖（仅为让 prefetchHomeData 可静默走完）───────────────────────────

vi.mock('./family', () => ({
  getActiveFamilyId: vi.fn(),
}));
vi.mock('./statisticsApi', () => ({
  getMonthlyStatistics: vi.fn(),
}));
vi.mock('./familyApi', () => ({
  getFamilySummary: vi.fn(),
}));
vi.mock('./userOverviewApi', () => ({
  getUserOverview: vi.fn(),
}));
vi.mock('./perf', () => ({
  markPerf: vi.fn(),
  markPerfError: vi.fn(),
}));
vi.mock('../pages/statistics/viewModels', () => ({
  buildMonthlyView: vi.fn(() => ({})),
}));

import { getActiveFamilyId } from './family';

const mockedGetActiveFamilyId = vi.mocked(getActiveFamilyId);

/** 等待已排队的微任务（prefetchHomeData 内的 await）落地 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('services/prefetch · 首屏后预热调度兜底', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __test__.reset();
    vi.clearAllMocks();
    // 默认返回 null：prefetchHomeData 进入后即 'no-family' 返回，不触网
    mockedGetActiveFamilyId.mockResolvedValue(null);
  });

  afterEach(() => {
    __test__.reset();
    vi.useRealTimers();
  });

  // T1: LEDGER_DISPLAY_READY 到达 → 立即放行预热，并清掉兜底定时器（不会二次触发）
  it('T1: LEDGER_DISPLAY_READY triggers prefetch and cancels fallback timer', async () => {
    scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');
    expect(mockedGetActiveFamilyId).not.toHaveBeenCalled();

    eventBus.emit(EventNames.LEDGER_DISPLAY_READY, { failed: false });
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);

    // 兜底定时器已被清除：推进时间不应再次触发
    vi.advanceTimersByTime(5000);
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);
  });

  // T2: 始终无事件 → 3s 兜底定时器到点直接预热
  it('T2: fallback timer triggers prefetch when no event arrives', async () => {
    scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');

    vi.advanceTimersByTime(2999);
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);
  });

  // T3: 失败态结算信号同样放行预热（成功/失败都释放）
  it('T3: failed display-ready signal still releases prefetch', async () => {
    scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');

    eventBus.emit(EventNames.LEDGER_DISPLAY_READY, { failed: true });
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);
  });

  // T4: 兜底定时器先触发后，迟到的事件不再二次触发（幂等）
  it('T4: late event after fallback fire does not double-trigger', async () => {
    scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');

    vi.advanceTimersByTime(3000);
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);

    eventBus.emit(EventNames.LEDGER_DISPLAY_READY, { failed: false });
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);
  });

  // T5: 已调度时重复调度被跳过（不新增订阅/定时器，仍只触发一次）
  it('T5: duplicate schedule is skipped', async () => {
    scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');
    expect(__test__.getScheduled()).toBe(true);
    scheduleHomeDataPrefetchAfterLedgerReady('login-success');

    eventBus.emit(EventNames.LEDGER_DISPLAY_READY, { failed: false });
    await flushMicrotasks();
    expect(mockedGetActiveFamilyId).toHaveBeenCalledTimes(1);
  });
});
