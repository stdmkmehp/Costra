// services/recurringLocal.spec.ts · recurringLocal 单测
// 卡号占位：COSTRA-5xx（T3）
// Refs: COSTRA-5xx

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./storage', () => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('./eventBus', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  EventNames: {
    SYNC_DONE: 'SYNC_DONE',
    OUTBOX_ENQUEUED: 'OUTBOX_ENQUEUED',
    RECURRING_SYNC_DONE: 'RECURRING_SYNC_DONE',
  },
}));

vi.mock('./request', () => ({
  request: vi.fn(),
  uuidV4: () => 'mock-uuid-' + Math.random().toString(36).slice(2, 8),
}));

vi.mock('./recurringApi', () => ({
  listRecurringRules: vi.fn().mockResolvedValue([]),
  createRecurringRule: vi.fn().mockResolvedValue({}),
  updateRecurringRule: vi.fn().mockResolvedValue({}),
  pauseRecurringRule: vi.fn().mockResolvedValue({}),
  resumeRecurringRule: vi.fn().mockResolvedValue({}),
  copyRecurringRule: vi.fn().mockResolvedValue({}),
  deleteRecurringRule: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./auth', () => ({
  getCurrentUserId: vi.fn(() => 'user-test'),
}));

import { getItem, setItem } from './storage';
import {
  getCachedRules,
  fetchAndCacheRules,
  enqueueMutation,
  replayMutationQueue,
  generateIdempotencyKey,
  __test__,
} from './recurringLocal';
import { createRecurringRule, pauseRecurringRule, updateRecurringRule } from './recurringApi';

describe('recurringLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void __test__.clearQueue();
  });

  describe('cache', () => {
    it('getCachedRules returns null when no cache', async () => {
      (getItem as any).mockResolvedValue(null);
      const result = await getCachedRules();
      expect(result).toBeNull();
    });

    it('fetchAndCacheRules calls API and writes cache', async () => {
      const { listRecurringRules } = await import('./recurringApi');
      (listRecurringRules as any).mockResolvedValue([{ id: '1' }]);
      const result = await fetchAndCacheRules();
      expect(result).toEqual([{ id: '1' }]);
      expect(setItem).toHaveBeenCalled();
    });
  });

  describe('mutation queue', () => {
    it('enqueueMutation increases queue size with idempotencyKey', async () => {
      (getItem as any).mockResolvedValue([]);
      const key = generateIdempotencyKey();
      await enqueueMutation({ kind: 'pause', id: 'rule-1', idempotencyKey: key, enqueuedAt: Date.now() });
      expect(setItem).toHaveBeenCalled();
      const call = (setItem as any).mock.calls[0];
      expect(call[0]).toBe('recurring:mutation_queue:user-test');
      const ops = call[1];
      expect(ops[0].idempotencyKey).toBe(key);
    });

    it('replayMutationQueue replays pause op with idempotencyKey', async () => {
      const key = 'idem-key-123';
      const ops = [{ kind: 'pause' as const, id: 'rule-1', idempotencyKey: key, enqueuedAt: Date.now() }];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      (pauseRecurringRule as any).mockResolvedValue({});

      const replayed = await replayMutationQueue();
      expect(replayed).toBe(1);
      expect(pauseRecurringRule).toHaveBeenCalledWith('rule-1', { idempotencyKey: key });
    });

    it('replayMutationQueue keeps op on network error', async () => {
      const key = 'idem-key-net';
      const ops = [{
        kind: 'create' as const,
        payload: { ledger_id: 'l1', type: 'expense' as const, amount: 100, period: 'weekly' as const, execute_bucket: 'morning' as const, timezone: 'Asia/Shanghai', start_date: '2026-01-01' },
        idempotencyKey: key,
        enqueuedAt: Date.now(),
      }];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      const netErr = new Error('network') as any;
      netErr.code = 'CLIENT_NETWORK_ERROR';
      (createRecurringRule as any).mockRejectedValue(netErr);

      const replayed = await replayMutationQueue();
      expect(replayed).toBe(0);
      expect(setItem).toHaveBeenCalled();
    });

    it('replayMutationQueue discards on 404', async () => {
      const ops = [{ kind: 'pause' as const, id: 'rule-gone', idempotencyKey: 'idem-404', enqueuedAt: Date.now() }];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      const err = new Error('not found') as any;
      err.code = 'NOT_FOUND';
      err.status = 404;
      (pauseRecurringRule as any).mockRejectedValue(err);

      const replayed = await replayMutationQueue();
      expect(replayed).toBe(1); // discarded counts as processed
    });

    it('replayMutationQueue discards on 409 VERSION_CONFLICT and invalidates cache', async () => {
      const ops = [{
        kind: 'update' as const,
        id: 'rule-conflict',
        payload: { version: 1 } as any,
        idempotencyKey: 'idem-409',
        enqueuedAt: Date.now(),
      }];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      const err = new Error('conflict') as any;
      err.code = 'VERSION_CONFLICT';
      err.status = 409;
      (updateRecurringRule as any).mockRejectedValue(err);

      const replayed = await replayMutationQueue();
      expect(replayed).toBe(1);
      // removeItem should be called for cache invalidation
      const { removeItem } = await import('./storage');
      expect(removeItem).toHaveBeenCalledWith('recurring:list:user-test');
    });

    it('replayMutationQueue keeps op on transient 503 failure', async () => {
      const ops = [{
        kind: 'pause' as const,
        id: 'rule-retry',
        idempotencyKey: 'idem-503',
        enqueuedAt: Date.now(),
      }];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      const err = new Error('unavailable') as any;
      err.code = 'UNAVAILABLE';
      err.status = 503;
      (pauseRecurringRule as any).mockRejectedValue(err);

      expect(await replayMutationQueue()).toBe(0);
      const queueWrite = (setItem as any).mock.calls.find((call: any[]) => call[0] === 'recurring:mutation_queue:user-test');
      expect(queueWrite?.[1]).toEqual(ops);
    });

    it('replayMutationQueue propagates the latest version to a following update', async () => {
      const ops = [
        { kind: 'pause' as const, id: 'rule-chain', idempotencyKey: 'idem-pause', enqueuedAt: 1 },
        {
          kind: 'update' as const,
          id: 'rule-chain',
          payload: { version: 1, amount: 200 },
          idempotencyKey: 'idem-update',
          enqueuedAt: 2,
        },
      ];
      (getItem as any).mockImplementation((k: string) => {
        if (k === 'recurring:mutation_queue:user-test') return Promise.resolve(ops);
        return Promise.resolve(null);
      });
      (pauseRecurringRule as any).mockResolvedValue({ id: 'rule-chain', version: 2 });
      (updateRecurringRule as any).mockResolvedValue({ id: 'rule-chain', version: 3 });

      expect(await replayMutationQueue()).toBe(2);
      expect(updateRecurringRule).toHaveBeenCalledWith(
        'rule-chain',
        { version: 2, amount: 200 },
        { idempotencyKey: 'idem-update' },
      );
    });

    it('generateIdempotencyKey returns unique values', () => {
      const k1 = generateIdempotencyKey();
    const k2 = generateIdempotencyKey();
      expect(k1).not.toBe(k2);
expect(typeof k1).toBe('string');
      expect(k1.length).toBeGreaterThan(0);
});
  });

  describe('per-user scoping', () => {
    it('enqueueMutation returns silently when there is no logged-in user', async () => {
   const auth = await import('./auth');
      (auth.getCurrentUserId as any).mockReturnValueOnce(null);
 await enqueueMutation({ kind: 'pause', id: 'rule-x', idempotencyKey: 'k', enqueuedAt: Date.now() });
      // 不应写入 storage
  expect(setItem).not.toHaveBeenCalled();
    });

    it('getCachedRules discards cached payload when userId does not match', async () => {
      (getItem as any).mockResolvedValue({
        items: [{ id: 'other' }],
   fetchedAt: Date.now(),
      userId: 'other-user',
      });
      const result = await getCachedRules();
      expect(result).toBeNull();
    });
  });
});
