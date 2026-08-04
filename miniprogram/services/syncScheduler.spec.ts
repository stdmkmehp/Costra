// services/syncScheduler.spec.ts · 同步调度器单测
// 卡号: COSTRA-150（Sprint-3 头部第 2 张 · R1 实装）
// COSTRA-165: T2 重构 · mock family.ts service 而非 storage.getItem
// Refs: .team/dispatch/COSTRA-150-client-sync-scheduler.md §2.1 E 项
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncOnce, startScheduler, stopScheduler, triggerOnPageShow, triggerOnMutation, __test__ } from './syncScheduler';

// ─── mock 依赖 ────────────────────────────────────────────────────────────────

vi.mock('./sync', () => ({
  pushDelta: vi.fn(),
  syncPull: vi.fn(),
}));

vi.mock('./auth', () => ({
  isLoggedIn: vi.fn(),
}));

// COSTRA-165: mock family.ts 而非 storage.getItem（syncScheduler 不再直接依赖 storage）
vi.mock('./family', () => ({
  getActiveFamilyId: vi.fn(),
}));

vi.mock('./eventBus', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  EventNames: { OUTBOX_ENQUEUED: 'outbox-enqueued', SYNC_DONE: 'sync-done' },
}));

vi.mock('./recurringLocal', () => ({
  replayMutationQueue: vi.fn().mockResolvedValue(0),
}));

import { pushDelta } from './sync';
import { syncPull } from './sync';
import { isLoggedIn } from './auth';
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';
import { eventBus } from './eventBus';
import { replayMutationQueue } from './recurringLocal';

const mockedPushDelta = vi.mocked(pushDelta);
const mockedSyncPull = vi.mocked(syncPull);
const mockedIsLoggedIn = vi.mocked(isLoggedIn);
const mockedGetActiveFamilyId = vi.mocked(familyContextGetActiveFamilyId);
const mockedEventBusEmit = vi.mocked(eventBus.emit);
const mockedReplayMutationQueue = vi.mocked(replayMutationQueue);

// ─── 测 ───────────────────────────────────────────────────────────────────────

describe('services/syncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __test__.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T1: syncOnce 未登录跳过 → 返 null
  it('T1: syncOnce skips when not logged in', async () => {
    mockedIsLoggedIn.mockReturnValue(false);

    const result = await syncOnce('launch');

    expect(result).toBeNull();
    expect(mockedPushDelta).not.toHaveBeenCalled();
    expect(mockedSyncPull).not.toHaveBeenCalled();
  });

  // T2: syncOnce 无 family_id 跳过 → 返 null
  it('T2: syncOnce skips when no family_id', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue(null);

    const result = await syncOnce('launch');

    expect(result).toBeNull();
    expect(mockedReplayMutationQueue).toHaveBeenCalledTimes(1);
    expect(mockedPushDelta).not.toHaveBeenCalled();
  });

  // T3: syncOnce 正常路径 · pushDelta + syncPull 顺序调用 → 返 SyncResult 字段齐全
  // R1.x.2（BUG-150-D）：验证 pushed/conflicts/rejected/failed 真值传递
  //   修复前 sync.ts pushDelta 永远返回 pushed=0 · 此测试会捕获回归
  it('T3: syncOnce normal path calls pushDelta then syncPull · 三态真值传递', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 2, conflicts: 1, rejected: 1, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [{ id: 'e1' }, { id: 'e2' }], categories: [], budgets: [], ledgers: [] },
    });

    const result = await syncOnce('launch');

    expect(result).not.toBeNull();
    expect(result!.pushed).toBe(2);            // ⚠️ 修复前永远是 0
    expect(result!.conflicts).toBe(1);         // ⚠️ 新增字段
    expect(result!.rejected).toBe(1);          // ⚠️ 新增字段
    expect(result!.failed).toBe(0);            // ⚠️ 新增字段
    expect(result!.pulled).toBe(2);
    expect(result!.watermark).toBe(100);
    expect(result!.trigger).toBe('launch');

    // 验证调用顺序
    const pushCallOrder = mockedPushDelta.mock.invocationCallOrder[0];
    const pullCallOrder = mockedSyncPull.mock.invocationCallOrder[0];
    expect(pushCallOrder).toBeLessThan(pullCallOrder);

    expect(mockedSyncPull).toHaveBeenCalledWith('family-123', { limit: 200 });
  });

  // T4: syncOnce 并发触发第 2 次 mutex 跳过 → 返 null（第 2 次）
  it('T4: syncOnce mutex skips concurrent call', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');

    // 让 pushDelta 永远 pending · 使第一次 syncOnce 不结束
    let resolveFirst!: () => void;
    const pendingPromise = new Promise<{ pushed: number; conflicts: number; rejected: number; failed: number }>(
      (resolve) => { resolveFirst = () => resolve({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 }); }
    );
    mockedPushDelta.mockImplementation(() => pendingPromise);
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    // 发起第一次（pending）
    const firstPromise = syncOnce('launch');

    // 发起第二次（应被 mutex 跳过）
    const secondResult = await syncOnce('page-show');
    expect(secondResult).toBeNull();

    // 让第一次完成
    resolveFirst();
    const firstResult = await firstPromise;
    expect(firstResult).not.toBeNull();
  });

  // T5: syncOnce 5xx 静默失败 → 返 null · 不抛 · console.warn
  it('T5: syncOnce 5xx silent failure returns null', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockRejectedValue({ code: 'SERVER_ERROR', message: 'Internal Server Error' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await syncOnce('launch');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sync] ✗ fail')
    );

    warnSpy.mockRestore();
  });

  // T6: triggerOnPageShow debounce 5s → 第 2 次 5s 内跳过
  it('T6: triggerOnPageShow debounces within 5s', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    // 第一次调用
    triggerOnPageShow('home');
    await vi.runAllTimersAsync();

    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    // 5s 内第二次调用（应被 debounce）
    triggerOnPageShow('mine');

    // 仍然只有 1 次
    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    // 前进 5s 后再调用
    vi.advanceTimersByTime(5001);
    triggerOnPageShow('home');
    await vi.runAllTimersAsync();

    // 第二次生效
    expect(mockedPushDelta).toHaveBeenCalledTimes(2);
  });

  // T7: startScheduler / stopScheduler 周期 timer 启停
  it('T7: startScheduler creates periodic timer, stopScheduler clears it', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    // stub wx.onNetworkStatusChange（startScheduler 调用）
    const onNetworkCb = vi.fn();
    vi.stubGlobal('wx', {
      onNetworkStatusChange: onNetworkCb,
    });

    // 不传 ready · 立即触发 launch sync
    startScheduler();

    // 验证 wx.onNetworkStatusChange 被注册
    expect(onNetworkCb).toHaveBeenCalledTimes(1);

    // launch 触发（同步路径，flush microtasks 即可）
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    // 周期 60s 触发
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockedPushDelta).toHaveBeenCalledTimes(2);

    // 停止
    stopScheduler();

    // 再过 60s 不应触发
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockedPushDelta).toHaveBeenCalledTimes(2);

    __test__.reset();
    vi.unstubAllGlobals();
  });

  // T8: syncOnce trigger 字段透传
  it('T8: syncOnce trigger field passes through', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-456');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    const result = await syncOnce('network-recover');

    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('network-recover');
  });

  // T9: SYNC_DONE emits when pulled > 0（payload 携带正确字段）
  it('T9: emits SYNC_DONE with payload when pulled > 0', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('periodic');

    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', {
      pulled: 3,
      pushed: 0,
      trigger: 'periodic',
    });
  });

  // T10: SYNC_DONE emits when pushed > 0（payload 携带正确字段）
  it('T10: emits SYNC_DONE with payload when pushed > 0', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 2, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('mutation');

    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', {
      pulled: 0,
      pushed: 2,
      trigger: 'mutation',
    });
  });

  // T11: SYNC_DONE NOT emitted when both pushed=0 and pulled=0（避免空 sync 触发无意义 UI 刷新）
  it('T11: does NOT emit SYNC_DONE when pushed=0 and pulled=0', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('periodic');

    // 不应有 SYNC_DONE 的 emit 调用（OUTBOX_ENQUEUED 等其他事件不在本测断言范围）
    const syncDoneCalls = mockedEventBusEmit.mock.calls.filter(c => c[0] === 'sync-done');
    expect(syncDoneCalls).toHaveLength(0);
  });

  // T12: SYNC_DONE NOT emitted on failure path（5xx 等异常情况下不广播）
  it('T12: does NOT emit SYNC_DONE on failure path', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockRejectedValue({ code: 'SERVER_ERROR', message: 'boom' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await syncOnce('launch');

    const syncDoneCalls = mockedEventBusEmit.mock.calls.filter(c => c[0] === 'sync-done');
    expect(syncDoneCalls).toHaveLength(0);

    warnSpy.mockRestore();
  });

  // T13: startScheduler awaits ready promise before launch sync
  it('T13: startScheduler awaits ready promise before launching first sync', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    vi.stubGlobal('wx', { onNetworkStatusChange: vi.fn() });

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

    startScheduler(ready);

    // ready 未 resolve 之前不应触发 launch sync
    await vi.advanceTimersByTimeAsync(50);
    expect(mockedPushDelta).not.toHaveBeenCalled();

    // resolve ready · launch sync 立即触发（无需等待固定 500ms）
    resolveReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    stopScheduler();
    __test__.reset();
    vi.unstubAllGlobals();
  });

  // T14: startScheduler 即使 ready promise reject 也兜底触发 launch sync
  it('T14: startScheduler still launches sync even if ready promise rejects', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    vi.stubGlobal('wx', { onNetworkStatusChange: vi.fn() });

    const ready = Promise.reject(new Error('bootstrap failed'));

    startScheduler(ready);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    stopScheduler();
    __test__.reset();
    vi.unstubAllGlobals();
  });

  // T15: SYNC_DONE payload 在 pushed>0 且 pulled>0 同时非零时正确携带两个值
  // （reviewer Nit-2 · 补足 T9/T10 单字段非零之外的双字段非零路径）
  it('T15: emits SYNC_DONE with both pushed and pulled non-zero', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 5, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 200,
      changes: { entries: [{ id: 'e1' }, { id: 'e2' }], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('mutation');

    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', {
      pulled: 2,
      pushed: 5,
      trigger: 'mutation',
    });
  });

  // ─── conflict-retry 机制 ────────────────────────────────────────────────────

  // T16: conflicts > 0 时 1s 后自动触发 conflict-retry
  it('T16: schedules conflict-retry after 1s when conflicts > 0', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 1, conflicts: 1, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('mutation');
    expect(mockedPushDelta).toHaveBeenCalledTimes(1);
    expect(__test__.getConflictRetryCount()).toBe(1);

    // 1s 前不应重试
    await vi.advanceTimersByTimeAsync(900);
    expect(mockedPushDelta).toHaveBeenCalledTimes(1);

    // 1s 时触发重试
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    await vi.advanceTimersByTimeAsync(200);
    expect(mockedPushDelta).toHaveBeenCalledTimes(2);
  });

  // T17: rejected > 0 同样触发 conflict-retry
  it('T17: schedules conflict-retry when rejected > 0', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 2, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    await syncOnce('mutation');
    expect(__test__.getConflictRetryCount()).toBe(1);

    // 1s 后重试
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockedPushDelta).toHaveBeenCalledTimes(2);
  });

  // T18: conflict-retry 达到 MAX_CONFLICT_RETRIES(3) 后停止 + 强制 emit SYNC_DONE
  it('T18: stops retrying after MAX_CONFLICT_RETRIES and force-emits SYNC_DONE', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    // 每次都有 conflict
    mockedPushDelta.mockResolvedValue({ pushed: 1, conflicts: 1, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 第 1 次（mutation 触发）
    await syncOnce('mutation');
    expect(__test__.getConflictRetryCount()).toBe(1);

    // 第 2 次（conflict-retry #1 → 1s 后）
    await vi.advanceTimersByTimeAsync(1100);
    expect(__test__.getConflictRetryCount()).toBe(2);

    // 第 3 次（conflict-retry #2 → 1s 后）
    await vi.advanceTimersByTimeAsync(1100);
    expect(__test__.getConflictRetryCount()).toBe(3);

    // 第 4 次（conflict-retry #3 → 1s 后 · 达到上限）
    mockedEventBusEmit.mockClear();
    await vi.advanceTimersByTimeAsync(1100);

    // 达到上限后 count 被重置
    expect(__test__.getConflictRetryCount()).toBe(0);
    // 强制 emit SYNC_DONE（即使 pulled=0）
    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', expect.objectContaining({
      trigger: 'conflict-retry',
    }));
    // 不再安排下一次 retry（再等 1s 不应有新调用）
    const callCountBefore = mockedPushDelta.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockedPushDelta).toHaveBeenCalledTimes(callCountBefore);

    warnSpy.mockRestore();
  });

  // T19: conflict-retry 成功解决后重置计数器 + emit SYNC_DONE
  it('T19: conflict-retry resets count when conflict resolves', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 1, conflicts: 1, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    // 第 1 次有冲突
    await syncOnce('mutation');
    expect(__test__.getConflictRetryCount()).toBe(1);

    // 第 2 次（retry）无冲突
    mockedPushDelta.mockResolvedValue({ pushed: 0, conflicts: 0, rejected: 0, failed: 0 });
    mockedEventBusEmit.mockClear();
    await vi.advanceTimersByTimeAsync(1100);

    // 计数器归零
    expect(__test__.getConflictRetryCount()).toBe(0);
    // 因为 pushed=0 且 pulled=0，但 trigger='conflict-retry' 会走"解决"分支发 emit
    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', {
      pulled: 0,
      pushed: 0,
      trigger: 'conflict-retry',
    });
  });

  // T20: 非 conflict-retry 触发重置计数器
  it('T20: non conflict-retry trigger resets conflictRetryCount', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 1, conflicts: 1, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    // 第 1 次 mutation 有冲突
    await syncOnce('mutation');
    expect(__test__.getConflictRetryCount()).toBe(1);

    // 第 2 次非 conflict-retry 触发（如 periodic）· 应重置计数器（新轮次）
    await syncOnce('periodic');
    // 重置后又有冲突 → 应从 1 开始
    expect(__test__.getConflictRetryCount()).toBe(1);
  });

  // T21: syncOnce('hide') trigger 正确透传
  it('T21: syncOnce hide trigger passes through', async () => {
    mockedIsLoggedIn.mockReturnValue(true);
    mockedGetActiveFamilyId.mockResolvedValue('family-123');
    mockedPushDelta.mockResolvedValue({ pushed: 1, conflicts: 0, rejected: 0, failed: 0 });
    mockedSyncPull.mockResolvedValue({
      watermark: 100,
      changes: { entries: [], categories: [], budgets: [], ledgers: [] },
    });

    const result = await syncOnce('hide');
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('hide');
    expect(mockedEventBusEmit).toHaveBeenCalledWith('sync-done', expect.objectContaining({ trigger: 'hide' }));
  });
});
