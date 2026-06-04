// services/syncScheduler.ts · 客户端同步调度器
// 触发源: launch / network-recover / page-show / periodic / mutation
// 修复: Bug A（新增 mutation 触发源，enqueue 后 2s debounce 即时同步）
// 增强: SYNC_DONE 事件广播 · 拉取/推送任一非零时广播，订阅页面（ledger/family/statistics）即时刷新
// 增强: startScheduler 接受 ready: Promise<void> · launch sync 在 bootstrap 完成后立即触发（取代固定 500ms 延迟）

import { syncPull, pushDelta } from './sync';
import { isLoggedIn } from './auth';
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';
import { eventBus, EventNames, type SyncDonePayload } from './eventBus';
import { deadLetterSize } from './outbox';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type TriggerSource = 'launch' | 'network-recover' | 'page-show' | 'periodic' | 'mutation';

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
const MUTATION_DEBOUNCE_MS = 2000;

// ─── module-level state ──────────────────────────────────────────────────────

let isRunning = false;
let pendingRetrigger = false; // L6 修复：mutex skip 时标记，释放后重触发
let lastShowTriggerAt = 0;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;

// ─── 核心：syncOnce ──────────────────────────────────────────────────────────

export async function syncOnce(trigger: TriggerSource): Promise<SyncResult | null> {
  if (isRunning) {
    console.log(`[sync] skip · already running (trigger=${trigger}) → pending retrigger`);
    pendingRetrigger = true;
    return null;
  }

  isRunning = true;
  const t0 = Date.now();
  console.log(`[sync] ▶ start · trigger=${trigger}`);
  try {
    if (!isLoggedIn()) {
      console.log(`[sync] skip · not logged in (trigger=${trigger})`);
      return null;
    }

    const familyId = await familyContextGetActiveFamilyId();
    if (!familyId) {
      console.log(`[sync] skip · no active family (trigger=${trigger})`);
      return null;
    }

    // push 先于 pull（push 可能创建 entry，pull 可以拉回 server_id/version）
    const pushResult = await pushDelta();
    const pullResult = await syncPull(familyId, { limit: 200 });

    const pulled = pullResult.changes?.entries?.length || 0;
    const elapsed = Date.now() - t0;
    console.log(
      `[sync] ✓ ok · pushed=${pushResult.pushed} conflicts=${pushResult.conflicts} rejected=${pushResult.rejected} failed=${pushResult.failed} pulled=${pulled} watermark=${pullResult.watermark} (trigger=${trigger}) [${elapsed}ms]`
    );

    // L7: dead-letter 告警（有条目无法同步时醒目提示）
    const dlSize = await deadLetterSize();
    if (dlSize > 0) {
      console.error(`[sync] ⚠️ DEAD_LETTER: ${dlSize} ops permanently failed · data may be lost · check outbox:__dead_letter`);
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
    console.warn(`[sync] ✗ fail · ${e?.code || 'unknown'} ${e?.message || e} (trigger=${trigger}) [${elapsed}ms]`);
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
      console.log('[sync] network recover · trigger sync');
      syncOnce('network-recover');
    }
  });

  if (!periodicTimer) {
    periodicTimer = setInterval(() => syncOnce('periodic'), PERIODIC_INTERVAL_MS);
  }

  // 订阅 outbox 入队事件 → mutation debounce 触发同步
  eventBus.on(EventNames.OUTBOX_ENQUEUED, () => {
    triggerOnMutation();
  });
}

export function stopScheduler(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (mutationTimer) {
    clearTimeout(mutationTimer);
    mutationTimer = null;
  }
}

// ─── page-show debounce ──────────────────────────────────────────────────────

export function triggerOnPageShow(pageName: string): void {
  const now = Date.now();
  if (now - lastShowTriggerAt < SHOW_DEBOUNCE_MS) {
    console.log(`[sync] skip page-show · debounced (page=${pageName})`);
    return;
  }
  lastShowTriggerAt = now;
  syncOnce('page-show');
}

// ─── mutation trigger（Bug A 修复）─────────────────────────────────────────────

/** 数据变更后触发（debounce 2s 合并连续操作） */
export function triggerOnMutation(): void {
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    syncOnce('mutation');
  }, MUTATION_DEBOUNCE_MS);
}

// ─── testing-only 重置 ───────────────────────────────────────────────────────

export const __test__ = {
  reset(): void {
    isRunning = false;
    pendingRetrigger = false;
    lastShowTriggerAt = 0;
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
  },
  getIsRunning(): boolean {
    return isRunning;
  },
};
