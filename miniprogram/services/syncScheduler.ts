// services/syncScheduler.ts · 客户端同步调度器（4 触发源 + mutex + debounce）
// 卡号: COSTRA-150（Sprint-3 头部第 2 张 · R1 实装）
// 复用: sync.ts 已封装 pushDelta() + syncPull(familyId, opts?) · 调度器只做调度逻辑
// 触发源: launch / network-recover / page-show / periodic
// 协议事实源: docs/api/sync-protocol.md §3 pull + §6.3 watermark 单调性 + §7 family_id 鉴权
// R1 卡审 P0-1 修订: 直接复用 sync.ts 封装 · 不重写 request/db 调用
// R1 卡审 P0-3 修订: entry 页不接入（非 tabBar）· 仅 home/mine
// Refs: .team/dispatch/COSTRA-150-client-sync-scheduler.md §2.1 A 项

import { syncPull, pushDelta } from './sync';
import { isLoggedIn } from './auth';
import { getItem } from './storage';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type TriggerSource = 'launch' | 'network-recover' | 'page-show' | 'periodic';

export interface SyncResult {
  pushed: number;      // 本次成功推送的 op 数
  conflicts: number;   // 本次冲突的 op 数（已重新入 index 待重试）
  rejected: number;    // 本次被拒绝的 op 数（NOT_FOUND/PERMISSION_DENIED 已删除）
  failed: number;      // 本次网络/异常失败的 op 数（已复原 index 待重试）
  pulled: number;      // 本次拉取的 entries 数
  watermark: number;   // 推进后的 watermark · BIGINT change_seq（v1.2 升级 · 2026-05-22）
  trigger: TriggerSource;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const FAMILY_ID_KEY = '__costra_family_id_v1';
const SHOW_DEBOUNCE_MS = 5000;
const PERIODIC_INTERVAL_MS = 60_000;

// ─── module-level state ──────────────────────────────────────────────────────

let isRunning = false;
let lastShowTriggerAt = 0;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * 取当前 active family_id · MVP 阶段从 storage 读
 * ⚠️ miniprogram 全局当前无 active_family_id 概念（auth.user 仅含 user_id）
 * R1 卡审 P0-1 修订 · 留 FU-150-FAMILY-CONTEXT-SERVICE Sprint-3+ 抽 family.ts service
 */
async function getActiveFamilyId(): Promise<string | null> {
  const familyId = await getItem<string>(FAMILY_ID_KEY);
  return familyId || null;
}

// ─── 核心：syncOnce ──────────────────────────────────────────────────────────

/**
 * 执行一次同步（push + pull）· mutex 保护 · 并发调用返回 null
 * 401 由 request.ts L105-119 自动续签 retry · 此处 catch 是最终失败兜底
 */
export async function syncOnce(trigger: TriggerSource): Promise<SyncResult | null> {
  if (isRunning) {
    console.log(`[sync] skip · already running (trigger=${trigger})`);
    return null;
  }

  isRunning = true;
  try {
    // 1. 鉴权检查（同步 API · request.ts 内置 401→refresh→retry · 此处只兜底已退登场景）
    if (!isLoggedIn()) {
      console.log(`[sync] skip · not logged in (trigger=${trigger})`);
      return null;
    }

    // 2. family_id 检查
    const familyId = await getActiveFamilyId();
    if (!familyId) {
      console.log(`[sync] skip · no active family (trigger=${trigger})`);
      return null;
    }

    // 3. push delta（sync.ts L83: drainBatch + POST /sync/push + ackResults / ackBatchFailure）
    const pushResult = await pushDelta();

    // 4. syncPull（sync.ts L43: getWatermark + GET /sync/pull + applyServerChanges + setWatermark）
    const pullResult = await syncPull(familyId, { limit: 200 });

    const pulled = pullResult.changes?.entries?.length || 0;
    console.log(
      `[sync] ok · pushed=${pushResult.pushed} conflicts=${pushResult.conflicts} rejected=${pushResult.rejected} failed=${pushResult.failed} pulled=${pulled} watermark=${pullResult.watermark} (trigger=${trigger})`
    );
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
    // 401 已由 request.ts L105-119 自动续签 retry · 此处 catch 是最终失败兜底
    console.warn(`[sync] fail · ${e?.code || 'unknown'} ${e?.message || e} (trigger=${trigger})`);
    return null;
  } finally {
    isRunning = false;
  }
}

// ─── 调度器启动/停止 ──────────────────────────────────────────────────────────

/**
 * 启动调度器（app.onLaunch 调一次 · 周期 timer + 网络监听）
 *
 * [未经验测]（D-022 C8-3 · R1 Review P1-2 修订 · 2026-05-20 13:15）：
 *   startScheduler 在 App.onLaunch 同步段调用 · 但 bootstrapPromise 是异步 IIFE
 *   未 await 完成时被调用 · setTimeout 500ms 是"假设 bootstrap 500ms 内完成"的
 *   隐性假设。微信开发者工具与真机行为可能有差异 · 由 §3.5 runtime 实测断言 B
 *   （Human 联合 154 staging 实测）兜底验证。
 *
 *   若 bootstrap > 500ms：syncOnce('launch') 在 isLoggedIn()=false 时静默跳过 ·
 *   下次 page-show 触发或 60s periodic 触发兜底（不致命 · 仅首次冷启不触发同步）。
 */
export function startScheduler(): void {
  // 1. 启动触发（500ms 后 · 让 onLaunch 链路先跑完 · 见函数注释 [未经验测] 段）
  setTimeout(() => syncOnce('launch'), 500);

  // 2. 网络恢复触发
  wx.onNetworkStatusChange((res: { isConnected: boolean }) => {
    if (res.isConnected) {
      console.log('[sync] network recover · trigger sync');
      syncOnce('network-recover');
    }
  });

  // 3. 周期触发（60s · 仅前台 · onHide 时停 · onShow 时启）
  if (!periodicTimer) {
    periodicTimer = setInterval(() => syncOnce('periodic'), PERIODIC_INTERVAL_MS);
  }
}

/** 停止调度器（app.onHide 调 · 清除周期 timer） */
export function stopScheduler(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

// ─── page-show debounce ──────────────────────────────────────────────────────

/** 页面 onShow 触发（home/mine · debounce 5s） */
export function triggerOnPageShow(pageName: string): void {
  const now = Date.now();
  if (now - lastShowTriggerAt < SHOW_DEBOUNCE_MS) {
    console.log(`[sync] skip page-show · debounced (page=${pageName})`);
    return;
  }
  lastShowTriggerAt = now;
  syncOnce('page-show');
}

// ─── testing-only 重置 ───────────────────────────────────────────────────────

/** 仅供单测重置 module-level state · 生产代码不应调用 */
export const __test__ = {
  reset(): void {
    isRunning = false;
    lastShowTriggerAt = 0;
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
  },
  getIsRunning(): boolean {
    return isRunning;
  },
};
