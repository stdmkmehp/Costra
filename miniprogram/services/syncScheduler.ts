// services/syncScheduler.ts · 客户端同步调度器
// 触发源: launch / network-recover / page-show / periodic / mutation / hide / conflict-retry
// 修复: Bug A（新增 mutation 触发源，enqueue 后 2s debounce 即时同步）
// 增强: SYNC_DONE 事件广播 · 拉取/推送任一非零时广播，订阅页面（ledger/family/statistics）即时刷新
// 增强: startScheduler 接受 ready: Promise<void> · launch sync 在 bootstrap 完成后立即触发（取代固定 500ms 延迟）
// 增强: onHide 时主动触发 syncOnce('hide')，确保离开前数据上行
// 增强: conflict-retry 机制 · conflicts/rejected > 0 时 3s 后自动重试（最多 3 次后停止 + 强制 UI 刷新）

import { syncPull, pushDelta } from './sync';
import { isLoggedIn } from './auth';
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';
import { eventBus, EventNames, type SyncDonePayload } from './eventBus';
import { deadLetterSize } from './outbox';
import { replayMutationQueue } from './recurringLocal';
import { markPerf, markPerfError } from './perf';
import { logger } from '../utils/logger';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type TriggerSource = 'launch' | 'network-recover' | 'page-show' | 'periodic' | 'mutation' | 'hide' | 'conflict-retry' | 'ledger-switch';

export interface SyncResult {
  pushed: number;
  conflicts: number;
  rejected: number;
  failed: number;
  pulled: number;
  watermark: number;
  trigger: TriggerSource;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const SHOW_DEBOUNCE_MS = 5000;
const PERIODIC_INTERVAL_MS = 60_000;
const CONFLICT_RETRY_DELAY_MS = 1000;
const MAX_CONFLICT_RETRIES = 3;

// ─── module-level state ──────────────────────────────────────────────────────

let isRunning = false;
let pendingRetrigger = false; // L6 修复：mutex skip 时标记，释放后重触发
let lastShowTriggerAt = 0;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let conflictRetryTimer: ReturnType<typeof setTimeout> | null = null;
let conflictRetryCount = 0;

// ─── 核心：syncOnce ──────────────────────────────────────────────────────────

export async function syncOnce(trigger: TriggerSource): Promise<SyncResult | null> {
  if (isRunning) {
    logger.debug('sync', `skip · already running (trigger=${trigger}) → pending retrigger`);
    pendingRetrigger = true;
    return null;
  }

  isRunning = true;
  const t0 = Date.now();
  markPerf(`sync.${trigger}.start`);
  logger.debug('sync', `▶ start · trigger=${trigger}`);
  try {
    if (!isLoggedIn()) {
      markPerf(`sync.${trigger}.done`, { skipped: 'not-logged-in' });
      logger.debug('sync', `skip · not logged in (trigger=${trigger})`);
      return null;
    }

    // 定时规则跟用户而非当前账本；先于 active-family 判断独立重放。
    // 即使本地尚未恢复 active family，网络恢复/周期/页面触发也不能饿死 recurring queue。
    try {
      await replayMutationQueue();
    } catch (replayErr) {
      logger.warn('sync', 'recurring queue replay error', replayErr);
    }

    const familyId = await familyContextGetActiveFamilyId();
    if (!familyId) {
      markPerf(`sync.${trigger}.done`, { skipped: 'no-family' });
      logger.debug('sync', `skip · no active family (trigger=${trigger})`);
      return null;
    }

    // push 先于 pull（push 可能创建 entry，pull 可以拉回 server_id/version）
    const pushResult = await pushDelta();
    const pullResult = await syncPull(familyId, { limit: 200 });

    const pulled = pullResult.changes?.entries?.length || 0;
    const elapsed = Date.now() - t0;
    markPerf(`sync.${trigger}.done`, {
      elapsed,
      pushed: pushResult.pushed,
      pulled,
      conflicts: pushResult.conflicts,
      rejected: pushResult.rejected,
      failed: pushResult.failed,
    });
    logger.debug(
      'sync',
      `✓ ok · pushed=${pushResult.pushed} conflicts=${pushResult.conflicts} rejected=${pushResult.rejected} failed=${pushResult.failed} pulled=${pulled} watermark=${pullResult.watermark} (trigger=${trigger}) [${elapsed}ms]`
    );

    // L7: dead-letter 告警（有条目无法同步时醒目提示）
    const dlSize = await deadLetterSize();
    if (dlSize > 0) {
      logger.error('sync', `⚠️ DEAD_LETTER: ${dlSize} ops permanently failed · data may be lost · check outbox:__dead_letter`);
    }

    // 仅在有数据变化时广播 SYNC_DONE，避免空 sync（最常见的 periodic 心跳）触发无意义的 UI 刷新
    if (pushResult.pushed > 0 || pulled > 0) {
      const payload: SyncDonePayload = {
        pulled,
        pushed: pushResult.pushed,
        trigger,
      };
      eventBus.emit(EventNames.SYNC_DONE, payload);
    }

    // ── conflict-retry 机制 ────────────────────────────────────────────────────
    // 当 push 返回 conflicts/rejected 时，说明服务端已有更新版本：
    //   - 3s 后自动重试（让 outbox reconcile 有机会生效），合并最终一致
    //   - 最多重试 MAX_CONFLICT_RETRIES 次后停止，强制 emit SYNC_DONE 让 UI 刷新到当前可达的最终态
    //   - 若本次为非 conflict-retry 触发（用户操作 / periodic 等）则重置计数器
    if (trigger !== 'conflict-retry') {
      conflictRetryCount = 0;
    }
    if (pushResult.conflicts > 0 || pushResult.rejected > 0) {
      if (conflictRetryCount < MAX_CONFLICT_RETRIES) {
        conflictRetryCount++;
        logger.warn('sync', `conflict-retry scheduled · attempt=${conflictRetryCount}/${MAX_CONFLICT_RETRIES} · in ${CONFLICT_RETRY_DELAY_MS}ms`);
        if (conflictRetryTimer) clearTimeout(conflictRetryTimer);
        conflictRetryTimer = setTimeout(() => {
          conflictRetryTimer = null;
          void syncOnce('conflict-retry');
        }, CONFLICT_RETRY_DELAY_MS);
      } else {
        // 达到最大重试次数 · 停止重试 + 强制广播让 UI 刷新到当前最终态
        logger.warn('sync', `conflict-retry exhausted (${MAX_CONFLICT_RETRIES} attempts) · giving up · forcing UI refresh`);
        conflictRetryCount = 0;
        if (conflictRetryTimer) {
          clearTimeout(conflictRetryTimer);
          conflictRetryTimer = null;
        }
        // 无论 pushed/pulled 是否 > 0，强制广播 · 让各页面刷新到 reconcile 后的数据状态
        const forcePayload: SyncDonePayload = {
          pulled,
          pushed: pushResult.pushed,
          trigger,
        };
        eventBus.emit(EventNames.SYNC_DONE, forcePayload);
      }
    } else if (trigger === 'conflict-retry') {
      // conflict-retry 触发但本次已无冲突 → 冲突已解决，重置计数器 + 确保 UI 刷新
      logger.debug('sync', 'conflict-retry resolved · conflicts cleared');
      conflictRetryCount = 0;
      // 如果上面的 SYNC_DONE 已经 emit（pushed>0 || pulled>0），则无需重复；否则补一次
      if (pushResult.pushed === 0 && pulled === 0) {
        const resolvedPayload: SyncDonePayload = {
          pulled: 0,
          pushed: 0,
          trigger,
        };
        eventBus.emit(EventNames.SYNC_DONE, resolvedPayload);
      }
    }

    return {
      pushed: pushResult.pushed,
      conflicts: pushResult.conflicts,
      rejected: pushResult.rejected,
      failed: pushResult.failed,
      pulled,
      watermark: pullResult.watermark,
      trigger,
    };
  } catch (e: any) {
    const elapsed = Date.now() - t0;
    markPerfError(`sync.${trigger}.failed`, e, { elapsed });
    logger.warn('sync', `✗ fail · ${e?.code || 'unknown'} ${e?.message || e} (trigger=${trigger}) [${elapsed}ms]`);
    return null;
  } finally {
    isRunning = false;
    // L6 修复：如果运行期间有其他触发被跳过，释放后立即重触发
    if (pendingRetrigger) {
      pendingRetrigger = false;
      setTimeout(() => syncOnce('mutation'), 100);
    }
  }
}

// ─── 调度器启动/停止 ──────────────────────────────────────────────────────────

/**
 * 启动同步调度器
 *
 * @param ready 可选的 bootstrap 就绪 Promise（来自 app.ts 的 bootstrapPromise，包含 ensureVersion + initAuth）。
 *   - 若传入：等待 ready 完成后立即触发 launch sync，消除时序竞争且加速首屏数据到达。
 *   - 若不传：兜底立即触发 launch sync（兼容单测 / 未传 ready 的调用方）。
 *     此时 syncOnce 会因 isLoggedIn() 检查在未登录时优雅跳过，依赖 periodic / page-show / OUTBOX_ENQUEUED 兜底。
 */
export function startScheduler(ready?: Promise<void>): void {
  const launchSync = (): void => {
    void syncOnce('launch');
  };
  if (ready) {
    // 等 bootstrap 完成（authBootstrap 完成、登录态可信）后再发首次同步；任何异常也兜底触发一次
    ready.then(launchSync, launchSync);
  } else {
    launchSync();
  }

  wx.onNetworkStatusChange((res: { isConnected: boolean }) => {
    if (res.isConnected) {
      logger.debug('sync', 'network recover · trigger sync');
      syncOnce('network-recover');
    }
  });

  if (!periodicTimer) {
    periodicTimer = setInterval(() => syncOnce('periodic'), PERIODIC_INTERVAL_MS);
  }

  // 订阅 outbox 入队事件 → 立即触发同步（mutex 保证不并发）
  eventBus.on(EventNames.OUTBOX_ENQUEUED, () => {
    triggerOnMutation();
  });
}

export function stopScheduler(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (conflictRetryTimer) {
    clearTimeout(conflictRetryTimer);
    conflictRetryTimer = null;
  }
}

// ─── page-show debounce ──────────────────────────────────────────────────────

export function triggerOnPageShow(pageName: string): void {
  const now = Date.now();
  if (now - lastShowTriggerAt < SHOW_DEBOUNCE_MS) {
    logger.debug('sync', `skip page-show · debounced (page=${pageName})`);
    return;
  }
  lastShowTriggerAt = now;
  syncOnce('page-show');
}

// ─── mutation trigger（Bug A 修复）─────────────────────────────────────────────

/**
 * 数据变更后立即触发同步。
 * 不做 debounce：用户新增/编辑记账后期望立刻在明细页/协作页看到结果，
 * 2s 延迟体感差。syncOnce 内部 mutex 保证不会并发请求，
 * 连续操作时走 pendingRetrigger 路径（第一次完成后自动重触发一次）即可合并。
 */
export function triggerOnMutation(): void {
  void syncOnce('mutation');
}

// ─── testing-only 重置 ───────────────────────────────────────────────────────

export const __test__ = {
  reset(): void {
    isRunning = false;
    pendingRetrigger = false;
    lastShowTriggerAt = 0;
    conflictRetryCount = 0;
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (conflictRetryTimer) {
      clearTimeout(conflictRetryTimer);
      conflictRetryTimer = null;
    }
  },
  getIsRunning(): boolean {
    return isRunning;
  },
  getConflictRetryCount(): number {
    return conflictRetryCount;
  },
};
