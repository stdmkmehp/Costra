// services/outbox.spec.ts · outbox 重放队列单测
// 重写: 适配新 API（ackResultsBySeq 按下标匹配 · 移除 ackBatchAsAlreadyProcessed · op 合并）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueue,
  drainBatch,
  ackResultsBySeq,
  ackBatchFailure,
  size,
  pendingCount,
  listPendingEntryRefs,
  __peek,
  __clear,
  PushResultItem,
  computeRetryBackoff,
} from './outbox';
import { setItem } from './storage';

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

describe('services/outbox', () => {
  beforeEach(() => {
    mockStore = new Map<string, unknown>();
    vi.stubGlobal('wx', mockWx());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ─── 基础功能 ──────────────────────────────────────────────────────────

  it('enqueue → __peek 长度 + idempotency_key 持久化', async () => {
    await enqueue({
      op: 'create', entity: 'entry', client_ref_id: 'ref-1', base_version: null,
      payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' },
    });
    const peeked = await __peek();
    expect(peeked).toHaveLength(1);
    expect(peeked[0].client_ref_id).toBe('ref-1');
    expect(peeked[0].idempotency_key).toBeTruthy();
    expect(peeked[0].retries).toBe(0);
  });

  it('drainBatch 截断 + ack 后取剩余', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue({ op: 'create', entity: 'entry', client_ref_id: `batch-${i}`, base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    }
    const result = await drainBatch(2);
    expect(result).not.toBeNull();
    expect(result!.batch).toHaveLength(2);

    // ack 成功
    const pairs = result!.batch.map(op => ({
      seq: op.seq,
      result: { client_ref_id: op.client_ref_id, status: 'ok' as const, server_id: `srv-${op.client_ref_id}`, server_version: 1 },
    }));
    await ackResultsBySeq(result!.batchKey, pairs);

    // 取剩余 3 条
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch).toHaveLength(3);
  });

  it('pendingCount 覆盖 index + drained + dead-letter 三处（logout 风险提示数据源）', async () => {
    expect(await pendingCount()).toBe(0);

    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'p-1', base_version: null, payload: {} });
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'p-2', base_version: null, payload: {} });
    expect(await pendingCount()).toBe(2);

    // drain 一条 → index 1 + drained 1，未上行总数不变
    const drained = await drainBatch(1);
    expect(drained).not.toBeNull();
    expect(await pendingCount()).toBe(2);

    // ack 成功一条 → 剩 1
    await ackResultsBySeq(drained!.batchKey, [{
      seq: drained!.batch[0].seq,
      result: { client_ref_id: drained!.batch[0].client_ref_id, status: 'ok', server_id: 'srv-x', server_version: 1 },
    }]);
    expect(await pendingCount()).toBe(1);

    // dead-letter 中的条目同样计入（已确认有丢失风险，退出前必须提示）
    await setItem('outbox:__dead_letter', [{ op: 'create' }]);
    expect(await pendingCount()).toBe(2);
  });

  it('ackResultsBySeq ok → 物理删 op', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ack-ok', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    await ackResultsBySeq(result!.batchKey, [{
      seq: result!.batch[0].seq,
      result: { client_ref_id: 'ack-ok', status: 'ok', server_id: 'srv-1', server_version: 1 },
    }]);
    expect(await __peek()).toHaveLength(0);
  });

  it('ackResultsBySeq conflict → 重入 index + retries 递增 + 换新 idem key', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ack-conflict', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();
    const originalIdem = result!.batch[0].idempotency_key;

    await ackResultsBySeq(result!.batchKey, [{
      seq: result!.batch[0].seq,
      result: { client_ref_id: 'ack-conflict', status: 'conflict', server_version: 5 },
    }]);

    // 退避延迟后才能 drain（retries=1 → 3s）
    vi.advanceTimersByTime(3100);
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch[0].retries).toBe(1);
    // 换新 idem key（防 409）
    expect(result2!.batch[0].idempotency_key).not.toBe(originalIdem);
  });

  it('ackResultsBySeq rejected NOT_FOUND → 物理删（不重试）', async () => {
    await enqueue({ op: 'delete', entity: 'entry', client_ref_id: 'ack-rejected', base_version: 1, payload: {} });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    await ackResultsBySeq(result!.batchKey, [{
      seq: result!.batch[0].seq,
      result: { client_ref_id: 'ack-rejected', status: 'rejected', error: { code: 'NOT_FOUND' } },
    }]);
    expect(await __peek()).toHaveLength(0);
  });

  it('ackResultsBySeq rejected INVALID_ARGUMENT → 重入 index 待重试', async () => {
    await enqueue({ op: 'update', entity: 'entry', client_ref_id: 'ack-retry', base_version: null, payload: { note: 'x' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();

    await ackResultsBySeq(result!.batchKey, [{
      seq: result!.batch[0].seq,
      result: { client_ref_id: 'ack-retry', status: 'rejected', error: { code: 'INVALID_ARGUMENT', message: 'update requires base_version' } },
    }]);

    // 退避延迟后才能 drain（retries=1 → 3s）
    vi.advanceTimersByTime(3100);
    // 仍在 index 等重试
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch[0].retries).toBe(1);
  });

  it('size() 返回队列长度', async () => {
    expect(await size()).toBe(0);
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'sz-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await size()).toBe(1);
    await __clear();
    expect(await size()).toBe(0);
  });

  // ─── ackBatchFailure 测试 ──────────────────────────────────────────────

  it('ackBatchFailure 复原 + retries 递增 + 换新 idem key', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'net-fail-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();
    const originalIdem = result!.batch[0].idempotency_key;

    const recovered = await ackBatchFailure(result!.batchKey);
    expect(recovered).toBe(1);

    // 退避延迟后才能 drain（retries=1 → 3s）
    vi.advanceTimersByTime(3100);
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch[0].retries).toBe(1);
    expect(result2!.batch[0].idempotency_key).not.toBe(originalIdem);
  });

  it('连续失败 + 最终成功（不死锁）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'persist-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    for (let i = 0; i < 3; i++) {
      // 前进足够时间让退避到期（最大 20s）
      vi.advanceTimersByTime(21_000);
      const r = await drainBatch(200);
      expect(r).not.toBeNull();
      expect(r!.batch[0].retries).toBe(i);
      await ackBatchFailure(r!.batchKey);
    }

    vi.advanceTimersByTime(21_000);
    const r4 = await drainBatch(200);
    expect(r4).not.toBeNull();
    expect(r4!.batch[0].retries).toBe(3);

    await ackResultsBySeq(r4!.batchKey, [{
      seq: r4!.batch[0].seq,
      result: { client_ref_id: 'persist-1', status: 'ok', server_id: 'srv-final', server_version: 1 },
    }]);
    expect(await __peek()).toHaveLength(0);
  });

  it('防御性 recover：drained 孤儿能被取回', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'orphan-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await drainBatch(200); // 不 ack → drained 残留

    const r2 = await drainBatch(200);
    expect(r2).not.toBeNull();
    expect(r2!.batch).toHaveLength(1);
    expect(r2!.batch[0].client_ref_id).toBe('orphan-1');
  });

  it('max_retries 超限 → dead-letter', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'max-retry', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    for (let i = 0; i < 5; i++) {
      // 前进足够时间让退避到期（最大 20s）
      vi.advanceTimersByTime(21_000);
      const r = await drainBatch(200);
      expect(r).not.toBeNull();
      await ackBatchFailure(r!.batchKey);
    }

    expect(await size()).toBe(0);
    expect(await drainBatch(200)).toBeNull();
  });

  // ─── Op 合并测试 ──────────────────────────────────────────────────────────

  it('op 合并: create + update → merge into create', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'merge-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: 'original', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await enqueue({ op: 'update', entity: 'entry', client_ref_id: 'merge-1', base_version: null, payload: { note: 'updated' } });

    expect(await size()).toBe(1); // 仍然只有 1 条 op
    const peeked = await __peek();
    expect(peeked[0].op).toBe('create');
    expect(peeked[0].payload.note).toBe('updated'); // payload 已合并
    expect(peeked[0].payload.amount).toBe(100); // 原字段保留
  });

  it('op 合并: create + delete → 抵消', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'cancel-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await enqueue({ op: 'delete', entity: 'entry', client_ref_id: 'cancel-1', base_version: null, payload: {} });

    expect(await size()).toBe(0); // 完全抵消
  });

  it('op 合并: update + update → merge payload', async () => {
    await enqueue({ op: 'update', entity: 'entry', client_ref_id: 'uu-1', base_version: 3, payload: { note: 'first' } });
    await enqueue({ op: 'update', entity: 'entry', client_ref_id: 'uu-1', base_version: 3, payload: { amount: 500 } });

    expect(await size()).toBe(1);
    const peeked = await __peek();
    expect(peeked[0].op).toBe('update');
    expect(peeked[0].payload.note).toBe('first');
    expect(peeked[0].payload.amount).toBe(500);
    expect(peeked[0].base_version).toBe(3); // 保留第一个的 base_version
  });

  it('op 合并: update + delete → replace with delete', async () => {
    await enqueue({ op: 'update', entity: 'entry', client_ref_id: 'ud-1', base_version: 2, payload: { note: 'soon deleted' } });
    await enqueue({ op: 'delete', entity: 'entry', client_ref_id: 'ud-1', base_version: 2, payload: {} });

    expect(await size()).toBe(1);
    const peeked = await __peek();
    expect(peeked[0].op).toBe('delete');
    expect(peeked[0].base_version).toBe(2);
  });

  // ─── drainBatch batchKey 每次生成新 key ─────────────────────────────────

  it('drainBatch 每次生成新 batchKey（防 409）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'key-test', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    const r1 = await drainBatch(200);
    expect(r1).not.toBeNull();
    const key1 = r1!.batchKey;

    // 失败复原
    await ackBatchFailure(r1!.batchKey);

    // 退避延迟后才能 drain（retries=1 → 3s）
    vi.advanceTimersByTime(3100);
    const r2 = await drainBatch(200);
    expect(r2).not.toBeNull();
    const key2 = r2!.batchKey;

    // 两次的 batchKey 不同
    expect(key1).not.toBe(key2);
  });

  // ─── 退避隔离测试 ──────────────────────────────────────────────────────────

  it('退避延迟让失败 op 不阻塞后续新 op', async () => {
    // 入队两条 op
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'fail-op', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'good-op', base_version: null, payload: { ledger_id: 'l1', amount: 200, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // 第一次 drain 拉出两条
    const r1 = await drainBatch(200);
    expect(r1).not.toBeNull();
    expect(r1!.batch).toHaveLength(2);

    // fail-op conflict, good-op ok
    await ackResultsBySeq(r1!.batchKey, [
      { seq: r1!.batch[0].seq, result: { client_ref_id: 'fail-op', status: 'conflict', server_version: 5 } },
      { seq: r1!.batch[1].seq, result: { client_ref_id: 'good-op', status: 'ok', server_id: 'srv-good', server_version: 1 } },
    ]);

    // 入队新 op
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'new-op', base_version: null, payload: { ledger_id: 'l1', amount: 300, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // 不前进时间 → drain 只拉出 new-op（fail-op 退避中被跳过）
    const r2 = await drainBatch(200);
    expect(r2).not.toBeNull();
    expect(r2!.batch).toHaveLength(1);
    expect(r2!.batch[0].client_ref_id).toBe('new-op');
  });

  it('computeRetryBackoff 公式验证', () => {
    // MAX_RETRIES=5 · 范围 3s~20s · step=(20000-3000)/4=4250ms
    expect(computeRetryBackoff(1)).toBe(3000);   // 最低 3s
    expect(computeRetryBackoff(2)).toBe(7250);   // 3000 + 4250
    expect(computeRetryBackoff(3)).toBe(11500);  // 3000 + 8500
    expect(computeRetryBackoff(5)).toBe(20000);  // 封顶 20s
    expect(computeRetryBackoff(100)).toBe(20000); // 超出仍是封顶
  });

  // ─── listPendingEntryRefs（L13 §4.4）──────────────────────────────────────

  it('listPendingEntryRefs 覆盖 index + drained 两态', async () => {
    // 两条 index 中的 entry op
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ref-idx-1', base_version: null, payload: { ledger_id: 'l1', amount: 1, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'ref-idx-2', base_version: null, payload: { ledger_id: 'l1', amount: 1, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // drain 一条 → 进入 drained（未 ack）
    const drained = await drainBatch(1);
    expect(drained).not.toBeNull();
    const drainedRef = drained!.batch[0].client_ref_id;

    const refs = await listPendingEntryRefs();
    // index 剩余 1 + drained 1 = 两个 ref 都在
    expect(refs.has('ref-idx-1')).toBe(true);
    expect(refs.has('ref-idx-2')).toBe(true);
    expect(refs.has(drainedRef)).toBe(true);
    expect(refs.size).toBe(2);
  });

  it('listPendingEntryRefs 空队列返回空 Set', async () => {
    const refs = await listPendingEntryRefs();
    expect(refs.size).toBe(0);
  });
});
