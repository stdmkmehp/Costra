// services/recurringLocal.ts · 定时记账本地缓存 + mutation queue
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx
//
// 设计要点：
//   1. 列表缓存 SWR：storage key `recurring:list:${userId}` · TTL 2min
//   2. 网络失败时暂存 mutation 到 recurring 专用 queue（不入 entry outbox）
//   3. replay 由 syncScheduler.syncOnce 直接调用（每次 syncOnce 结束后 replay）
//   4. /sync/push 不支持 recurring · 独立 queue 保持干净抽象
//   5. 每个 mutation 持久化 idempotencyKey · 重试复用同一 key 避免重复创建
// 6. 所有 storage key 按 userId 隔离 · 换号登录不串数据

import { getItem, setItem, removeItem } from './storage';
import { logger } from '../utils/logger';
import { eventBus, EventNames } from './eventBus';
import type { ApiError } from './request';
import type { RecurringRule } from './recurringApi';
import {
  listRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  pauseRecurringRule,
  resumeRecurringRule,
  copyRecurringRule,
  deleteRecurringRule,
  type CreateRecurringPayload,
  type UpdateRecurringPayload,
} from './recurringApi';
import { uuidV4 } from './request';
import { getCurrentUserId } from './auth';

// ─── Storage key 命名 ────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'recurring:list:';
const QUEUE_KEY_PREFIX = 'recurring:mutation_queue:';
/** 一次性清理旧版本使用的全局 key，避免用户升级后残留脏数据。 */
const LEGACY_CACHE_KEY = 'recurring:list';
const LEGACY_QUEUE_KEY = 'recurring:mutation_queue';

let legacySweepDone = false;

async function sweepLegacyKeys(): Promise<void> {
  if (legacySweepDone) return;
  legacySweepDone = true;
  try {
    await removeItem(LEGACY_CACHE_KEY);
    await removeItem(LEGACY_QUEUE_KEY);
  } catch {
    /* 清理失败无碍，下轮再来 */
  }
}

function cacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

function queueKey(userId: string): string {
  return `${QUEUE_KEY_PREFIX}${userId}`;
}

/**
 * 返回当前用户 id · 未登录时返回 null。
 * cache/queue 的所有 storage 访问都必须走此函数拿到 scope。
 */
function scopedUserId(): string | null {
  return getCurrentUserId();
}

// ─── 缓存层 ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

interface CachedList {
  items: RecurringRule[];
  fetchedAt: number;
  /** 校验缓存归属，防止 storage 层错位读取。 */
  userId: string;
}

/** 从缓存获取列表（可能过期）· 未登录或 userId 不匹配时返 null */
export async function getCachedRules(): Promise<RecurringRule[] | null> {
  await sweepLegacyKeys();
  const userId = scopedUserId();
  if (!userId) return null;
  const cached = await getItem<CachedList>(cacheKey(userId));
  if (!cached) return null;
  if (cached.userId && cached.userId !== userId) return null;
  return cached.items;
}

/** 缓存是否新鲜 */
export async function isCacheFresh(): Promise<boolean> {
  const userId = scopedUserId();
  if (!userId) return false;
  const cached = await getItem<CachedList>(cacheKey(userId));
  if (!cached) return false;
  if (cached.userId && cached.userId !== userId) return false;
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

/** 从网络拉取并写入缓存 */
export async function fetchAndCacheRules(): Promise<RecurringRule[]> {
  await sweepLegacyKeys();
  const items = await listRecurringRules('all');
  const userId = scopedUserId();
  if (userId) {
    await setItem(cacheKey(userId), {
      items,
   fetchedAt: Date.now(),
      userId,
    } as CachedList);
  }
  return items;
}

/** 覆盖缓存列表（用于离线操作后的乐观展示） */
export async function setCachedRules(items: RecurringRule[]): Promise<void> {
  const userId = scopedUserId();
  if (!userId) return;
  await setItem(cacheKey(userId), {
    items,
 fetchedAt: Date.now(),
    userId,
  } as CachedList);
}

/** 失效缓存（操作后调用） */
export async function invalidateCache(): Promise<void> {
  const userId = scopedUserId();
  if (!userId) return;
  await removeItem(cacheKey(userId));
}

/**
 * 清理当前用户的 recurring cache + mutation queue。
 * 登出前调用，避免下一位登录用户共享上一位的暂存 mutation。
 */
export async function clearForCurrentUser(): Promise<void> {
  const userId = scopedUserId();
  if (!userId) return;
  try {
await removeItem(cacheKey(userId));
    await removeItem(queueKey(userId));
  } catch (err) {
    logger.warn('recurringLocal', 'clearForCurrentUser failed', err);
  }
}

// ─── Mutation Queue（recurring 专用 · 不入 entry outbox）────────────────────

export type MutationOp =
  | { kind: 'create'; payload: CreateRecurringPayload; idempotencyKey: string; enqueuedAt: number }
  | { kind: 'update'; id: string; payload: UpdateRecurringPayload; idempotencyKey: string; enqueuedAt: number }
  | { kind: 'pause'; id: string; idempotencyKey: string; enqueuedAt: number }
| { kind: 'resume'; id: string; idempotencyKey: string; enqueuedAt: number }
  | { kind: 'copy'; id: string; idempotencyKey: string; enqueuedAt: number }
  | { kind: 'delete'; id: string; version: number; idempotencyKey: string; enqueuedAt: number };

async function readQueue(userId: string): Promise<MutationOp[]> {
  return (await getItem<MutationOp[]>(queueKey(userId))) || [];
}

async function writeQueue(userId: string, ops: MutationOp[]): Promise<void> {
  if (ops.length === 0) {
  await removeItem(queueKey(userId));
  } else {
    await setItem(queueKey(userId), ops);
  }
}

/** 入队一个 mutation（网络失败时调用） · 自动分配 idempotencyKey（若 caller 未提供） */
export async function enqueueMutation(op: MutationOp): Promise<void> {
  const userId = scopedUserId();
  if (!userId) {
    logger.warn('recurringLocal', 'enqueueMutation skipped · no active user');
    return;
  }
  await sweepLegacyKeys();
  const queue = await readQueue(userId);
  queue.push(op);
  await writeQueue(userId, queue);
  logger.info('recurringLocal', `mutation enqueued · kind=${op.kind} queue_size=${queue.length}`);
}

/** 生成持久化幂等 key（caller 在入队前生成 · 后续重试复用） */
export function generateIdempotencyKey(): string {
  return uuidV4();
}

/** 获取队列大小 */
export async function mutationQueueSize(): Promise<number> {
  const userId = scopedUserId();
  if (!userId) return 0;
  const queue = await readQueue(userId);
  return queue.length;
}

/** 瞬时错误必须保留队列，避免 5xx / 限流被误判成业务拒绝后丢数据。 */
function isRetryableError(error: ApiError): boolean {
  return error.code === 'CLIENT_NETWORK_ERROR'
    || error.code === 'UNAVAILABLE'
    || error.code === 'TIMEOUT'
    || error.code === 'INTERNAL'
    || error.code === 'RATE_LIMITED'
 || error.status === 0
    || error.status === 429
    || error.status >= 500;
}

/**
 * 重放 mutation queue · 由 syncOnce 直接调用。
 * 同一规则的连续 update/pause/resume/delete 会串行传播最新 version，避免前序操作
 * 已使版本递增后，后续 delete/update 仍携带旧 version。
 *
 * 未登录时直接返回 0，避免误重放上一位用户遗留的队列。
 */
export async function replayMutationQueue(): Promise<number> {
  await sweepLegacyKeys();
  const userId = scopedUserId();
  if (!userId) return 0;
  const queue = await readQueue(userId);
  if (queue.length === 0) return 0;

  let processed = 0;
  const remaining: MutationOp[] = [];
  const latestVersions = new Map<string, number>();

  for (const op of queue) {
    try {
      let result: RecurringRule | undefined;
      switch (op.kind) {
        case 'create':
          result = await createRecurringRule(op.payload, { idempotencyKey: op.idempotencyKey });
  break;
  case 'update': {
          const version = latestVersions.get(op.id) ?? op.payload.version;
          result = await updateRecurringRule(
 op.id,
          { ...op.payload, version },
            { idempotencyKey: op.idempotencyKey },
        );
        break;
   }
      case 'pause':
          result = await pauseRecurringRule(op.id, { idempotencyKey: op.idempotencyKey });
          break;
        case 'resume':
          result = await resumeRecurringRule(op.id, { idempotencyKey: op.idempotencyKey });
     break;
     case 'copy':
          result = await copyRecurringRule(op.id, { idempotencyKey: op.idempotencyKey });
          break;
        case 'delete':
          await deleteRecurringRule(
            op.id,
            latestVersions.get(op.id) ?? op.version,
 { idempotencyKey: op.idempotencyKey },
          );
        break;
      }
      // copy 返回的是新规则，不会改变源规则 version，不能污染源 id 的版本链。
      if (result && 'id' in op && op.kind !== 'copy') {
        latestVersions.set(op.id, result.version);
   }
      processed++;
  } catch (unknownError) {
      const error = unknownError as ApiError;
   if (isRetryableError(error)) {
        remaining.push(op);
        continue;
    }

      // 终态 4xx 不再盲重试；刷新列表让用户看到服务端最终状态。
    logger.warn(
        'recurringLocal',
        `mutation replay rejected · kind=${op.kind} id=${'id' in op ? op.id : 'new'} code=${error.code} status=${error.status}`,
      );
      processed++;
    }
  }

  await writeQueue(userId, remaining);
  if (processed > 0) {
    await invalidateCache();
    eventBus.emit(EventNames.RECURRING_SYNC_DONE, { processed, remaining: remaining.length });
    logger.info('recurringLocal', `mutation queue replayed · processed=${processed} remaining=${remaining.length}`);
  }
  return processed;
}

// ─── testing-only ────────────────────────────────────────────────────────────

export const __test__ = {
  async clearQueue(userId?: string): Promise<void> {
    const uid = userId ?? scopedUserId();
    if (!uid) return;
    await writeQueue(uid, []);
  },
  async peekQueue(userId?: string): Promise<MutationOp[]> {
    const uid = userId ?? scopedUserId();
if (!uid) return [];
    return readQueue(uid);
  },
};
