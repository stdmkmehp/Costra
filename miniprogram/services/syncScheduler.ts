// services/syncScheduler.ts · 客户端同步调度器
// 触发源: launch / network-recover / page-show / periodic / mutation
// 修复: Bug A（新增 mutation 触发源，enqueue 后 2s debounce 即时同步）

import { syncPull, pushDelta } from './sync';
import { isLoggedIn } from './auth';
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';
import { eventBus, EventNames } from './eventBus';
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

export function startScheduler(): void {
  setTimeout(() => syncOnce('launch'), 500);

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
