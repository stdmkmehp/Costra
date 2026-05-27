// services/syncScheduler.spec.ts · 同步调度器单测
// 卡号: COSTRA-150（Sprint-3 头部第 2 张 · R1 实装）
// COSTRA-165: T2 重构 · mock family.ts service 而非 storage.getItem
// Refs: .team/dispatch/COSTRA-150-client-sync-scheduler.md §2.1 E 项
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncOnce, startScheduler, stopScheduler, triggerOnPageShow, __test__ } from './syncScheduler';

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

import { pushDelta } from './sync';
import { syncPull } from './sync';
import { isLoggedIn } from './auth';
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';

const mockedPushDelta = vi.mocked(pushDelta);
const mockedSyncPull = vi.mocked(syncPull);
const mockedIsLoggedIn = vi.mocked(isLoggedIn);
const mockedGetActiveFamilyId = vi.mocked(familyContextGetActiveFamilyId);

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
      expect.stringContaining('[sync] fail')
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

    startScheduler();

    // 验证 wx.onNetworkStatusChange 被注册
    expect(onNetworkCb).toHaveBeenCalledTimes(1);

    // launch 触发（500ms 后）
    await vi.advanceTimersByTimeAsync(600);
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
});
