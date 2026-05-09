// services/outbox.spec.ts · outbox 重放队列单测
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueue,
  drainBatch,
  ackResults,
  size,
  __peek,
  __clear,
  PushResultItem,
} from './outbox';

let mockStore: Map<string, unknown>;

function mockWx() {
  return {
    getStorage: <T>({ key }: { key: string }): Promise<{ data: T }> => {
      if (mockStore.has(key)) return Promise.resolve({ data: mockStore.get(key) as T });
      return Promise.reject({ errMsg: 'getStorage:fail data not found' });
    },
    setStorage: <T>({ key, data }: { key: string; data: T }): Promise<void> => {
      mockStore.set(key, data);
      return Promise.resolve();
    },
    removeStorage: ({ key }: { key: string }): Promise<void> => {
      mockStore.delete(key);
      return Promise.resolve();
    },
    clearStorage(): Promise<void> {
      mockStore.clear();
      return Promise.resolve();
    },
  };
}

describe('services/outbox · 模拟 wx.storage（mock 环境）', () => {
  beforeEach(() => {
    mockStore = new Map<string, unknown>();
    vi.stubGlobal('wx', mockWx());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enqueue → __peek 长度 + idempotency_key 持久化', async () => {
    await enqueue({
      op: 'create',
      entity: 'entry',
      client_ref_id: 'op-ref-1',
      base_version: null,
      payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: 'test', occurred_at: '2026-05-09T00:00:00.000Z' },
    });
    const peeked = await __peek();
    expect(peeked).toHaveLength(1);
    expect(peeked[0].client_ref_id).toBe('op-ref-1');
    expect(peeked[0].idempotency_key).toBeTruthy();
    expect(peeked[0].retries).toBe(0);
  });

  it('drainBatch(2) 截断后第二次仍可取剩余（next_retry_at 边界）', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue({ op: 'create', entity: 'entry', client_ref_id: `batch-${i}`, base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    }
    const result = await drainBatch(2);
    expect(result).not.toBeNull();
    expect(result!.batch).toHaveLength(2);

    // 第二次 drainBatch：剩余 3 条（next_retry_at 已到 = Date.now()）
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch).toHaveLength(3);
  });

  it('ackResults ok → 物理删 op key（__peek 为空）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ack-ok', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await __peek()).toHaveLength(1);

    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    const results: PushResultItem[] = [{ client_ref_id: 'ack-ok', status: 'ok', server_id: 'srv-1', server_version: 1 }];
    await ackResults(result!.batchKey, results);

    expect(await __peek()).toHaveLength(0);
  });

  it('ackResults conflict → 重新入 index + retries 递增（drainBatch 可再次取出）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ack-conflict', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    const results: PushResultItem[] = [{ client_ref_id: 'ack-conflict', status: 'conflict', server_id: 'srv-2', server_version: 5, error: { code: 'VERSION_CONFLICT' } }];
    await ackResults(result!.batchKey, results);

    // conflict 项重新入 index → 可被第二次 drainBatch 取出
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch).toHaveLength(1);
    expect(result2!.batch[0].retries).toBe(1);
    expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true);
  });

  it('ackResults rejected NOT_FOUND → 物理删（不重试）', async () => {
    await enqueue({ op: 'delete', entity: 'entry', client_ref_id: 'ack-rejected', base_version: 1, payload: { id: 'srv-del-1' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    const results: PushResultItem[] = [{ client_ref_id: 'ack-rejected', status: 'rejected', error: { code: 'NOT_FOUND' } }];
    await ackResults(result!.batchKey, results);
    expect(await __peek()).toHaveLength(0);
  });

  it('size() 返回队列长度', async () => {
    expect(await size()).toBe(0);
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'sz-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await size()).toBe(1);
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'sz-2', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await size()).toBe(2);
    await __clear();
    expect(await size()).toBe(0);
  });
});
