// services/outbox.spec.ts · outbox 重放队列单测
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// R1.x.2 补强（2026-05-22 BUG-COSTRA-150-D）: 加 ackBatchFailure 端到端 + 多轮失败死锁防御测试
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueue,
  drainBatch,
  ackResults,
  ackBatchFailure,
  ackBatchAsAlreadyProcessed,
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

    // R1.x.2 修订（BUG-150-D）：drained 语义统一 · 第一次 drainBatch 后必须先 ack 才能继续
    //   旧实装：第一次取走 2 个后 · 这 2 个停在 drained · 第二次只取剩余 3 个 → 但 drained 永远死锁（隐性 BUG）
    //   新实装：drained 中残留的 2 个会被防御性 recover 取回 → 第二次取到 5 个（前 2 个 + 后 3 个）
    //   正确路径：第一次取走 2 个 → ack（成功/失败）清 drained → 第二次取剩余 3 个
    const okResults: PushResultItem[] = result!.batch.map(op => ({
      client_ref_id: op.client_ref_id, status: 'ok' as const, server_id: `srv-${op.client_ref_id}`, server_version: 1
    }));
    await ackResults(result!.batchKey, okResults);

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

  // ─── BUG-COSTRA-150-D 回归测试（2026-05-22 R1.x.2 修复）─────────────────────
  // 历史 BUG：sync.ts catch 静默吞错 + drainBatch recover 仅捞 retries>0 → 网络失败的 op 永久死锁
  // 修复方案：新增 ackBatchFailure · drained 语义统一 · 任何失败路径都必须清 drained

  it('BUG-150-D · ackBatchFailure 复原本批次 · 下次 drainBatch 必能取回（retries 递增）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'net-fail-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const result = await drainBatch(200);
    expect(result).not.toBeNull();
    expect(result!.batch).toHaveLength(1);

    // 模拟网络失败：调 ackBatchFailure（替代旧实装的 catch 静默吞错）
    const recovered = await ackBatchFailure(result!.batchKey);
    expect(recovered).toBe(1);

    // 不变量：drained 必须为空（否则下次 drainBatch 会形成死锁）
    // 通过下次 drainBatch 间接验证（drained 残留会被防御性 recover 分支捞起 · 但不应触发该分支）

    // 下次 drainBatch 必能取回 · retries=1
    const result2 = await drainBatch(200);
    expect(result2).not.toBeNull();
    expect(result2!.batch).toHaveLength(1);
    expect(result2!.batch[0].client_ref_id).toBe('net-fail-1');
    expect(result2!.batch[0].retries).toBe(1);
  });

  it('BUG-150-D · 连续 3 次网络失败 + 1 次成功 · op 最终能上传（不死锁）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'persist-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // 连续 3 次网络失败
    for (let i = 0; i < 3; i++) {
      const r = await drainBatch(200);
      expect(r).not.toBeNull();
      expect(r!.batch).toHaveLength(1);
      expect(r!.batch[0].client_ref_id).toBe('persist-1');
      expect(r!.batch[0].retries).toBe(i);
      await ackBatchFailure(r!.batchKey);
    }

    // 第 4 次成功 · retries 累积 3 次
    const r4 = await drainBatch(200);
    expect(r4).not.toBeNull();
    expect(r4!.batch).toHaveLength(1);
    expect(r4!.batch[0].retries).toBe(3);

    const okResults: PushResultItem[] = [{ client_ref_id: 'persist-1', status: 'ok', server_id: 'srv-final', server_version: 1 }];
    await ackResults(r4!.batchKey, okResults);

    // 物理删除 · index/drained 都干净
    expect(await __peek()).toHaveLength(0);
    expect(await size()).toBe(0);
  });

  it('BUG-150-D · ackBatchFailure 仅清本批次 · 不影响其他批次（idempotency_key 隔离）', async () => {
    // 准备：enqueue A · drainBatch（取 A · drained=[A]）· ackBatchFailure A
    // 验证：A 复原到 index · drained 为空 · 后续 enqueue B 与 A 互不干扰
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'iso-A', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const rA = await drainBatch(200);
    expect(rA).not.toBeNull();
    expect(rA!.batch).toHaveLength(1);
    expect(rA!.batch[0].client_ref_id).toBe('iso-A');

    const recoveredA = await ackBatchFailure(rA!.batchKey);
    expect(recoveredA).toBe(1);
    // 不变量：drained 已清 · A 在 index 等重试 · retries=1

    // 再 enqueue B · 然后 drainBatch · 应同时取到 A（重试）和 B（新增）· batch 干净
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'iso-B', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const rAB = await drainBatch(200);
    expect(rAB).not.toBeNull();
    expect(rAB!.batch).toHaveLength(2);

    const refIds = rAB!.batch.map(o => o.client_ref_id).sort();
    expect(refIds).toEqual(['iso-A', 'iso-B']);

    // ackResults 仅 A ok · B 网络失败 → 应能正确隔离
    const partialResults: PushResultItem[] = [
      { client_ref_id: 'iso-A', status: 'ok', server_id: 'srv-A', server_version: 1 }
      // 注意：B 不在 results 中 → ackResults 视为"网络级失败"路径（L227-236）· 重新入 index
    ];
    await ackResults(rAB!.batchKey, partialResults);

    // A 物理删除 · B 仍在 index（被 ackResults 的"results 缺失 → 网络失败"分支推回）
    const peeked = await __peek();
    expect(peeked).toHaveLength(1);
    expect(peeked[0].client_ref_id).toBe('iso-B');
  });

  it('BUG-150-D · 防御性 recover：retries=0 的 drained 孤儿也能被取回（修复前死锁场景）', async () => {
    // 模拟旧 BUG 留下的 drained 孤儿：retries=0 + 在 drained 中
    // 实操：enqueue → drainBatch → 不调 ack* → 直接再 drainBatch
    // 修复前：retries=0 → recover 跳过 → 永远死锁
    // 修复后：无差别 recover · 下次 drainBatch 取回
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'orphan-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    const r1 = await drainBatch(200);
    expect(r1).not.toBeNull();
    // ⚠️ 故意不调 ackResults / ackBatchFailure · 模拟异常中断后 drained 残留 retries=0 op

    // 下次 drainBatch 必须能从防御性 recover 分支取回（修复前此处会 return null · 死锁）
    const r2 = await drainBatch(200);
    expect(r2).not.toBeNull();
    expect(r2!.batch).toHaveLength(1);
    expect(r2!.batch[0].client_ref_id).toBe('orphan-1');
  });

  // ─── COSTRA-228 修复测试 ──────────────────────────────────────────────────────
  // 409 幂等键冲突 → ackBatchAsAlreadyProcessed 清除 outbox 条目
  // max_retries 超限 → 移入 dead-letter 不再重试

  it('COSTRA-228 · ackBatchAsAlreadyProcessed 物理删除本批次所有 op（模拟 409 场景）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: '409-op-1', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: '409-op-2', base_version: null, payload: { ledger_id: 'l1', amount: 200, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await size()).toBe(2);

    const result = await drainBatch(200);
    expect(result).not.toBeNull();
    expect(result!.batch).toHaveLength(2);

    // 模拟 409：调用 ackBatchAsAlreadyProcessed
    const cleared = await ackBatchAsAlreadyProcessed(result!.batchKey);
    expect(cleared).toBe(2);

    // 验证：outbox 完全清空 · 条目不再重试
    expect(await __peek()).toHaveLength(0);
    expect(await size()).toBe(0);

    // 验证：后续 drainBatch 返回 null（无剩余待推送）
    const next = await drainBatch(200);
    expect(next).toBeNull();
  });

  it('COSTRA-228 · ackBatchAsAlreadyProcessed 仅清本批次 · 不影响其他批次', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: '409-iso-A', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // drain A
    const rA = await drainBatch(200);
    expect(rA).not.toBeNull();

    // ack A as already processed
    await ackBatchAsAlreadyProcessed(rA!.batchKey);
    expect(await __peek()).toHaveLength(0);

    // 再 enqueue B
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: '409-iso-B', base_version: null, payload: { ledger_id: 'l1', amount: 200, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });
    expect(await size()).toBe(1);

    // B 仍可正常 drain
    const rB = await drainBatch(200);
    expect(rB).not.toBeNull();
    expect(rB!.batch).toHaveLength(1);
    expect(rB!.batch[0].client_ref_id).toBe('409-iso-B');
  });

  it('COSTRA-228 · max_retries 超限 → 移入 dead-letter · outbox 不再积压', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'max-retry-op', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // 模拟 50 次连续网络失败（达到 MAX_RETRIES）
    for (let i = 0; i < 50; i++) {
      const r = await drainBatch(200);
      expect(r).not.toBeNull();
      await ackBatchFailure(r!.batchKey);
    }

    // 第 50 次 ackBatchFailure 后 op 应被移入 dead-letter · outbox 为空
    expect(await size()).toBe(0);
    expect(await __peek()).toHaveLength(0);

    // drainBatch 返回 null · 不再重试
    const next = await drainBatch(200);
    expect(next).toBeNull();

    // dead-letter 中应有该条目（storage 使用 Envelope 包裹：{ v, t, d }）
    const envelope = mockStore.get('outbox:__dead_letter') as { d: unknown[] };
    expect(envelope).toBeDefined();
    expect(envelope.d).toHaveLength(1);
    expect((envelope.d[0] as { client_ref_id: string }).client_ref_id).toBe('max-retry-op');
  });

  it('COSTRA-228 · max_retries 之前 op 正常重试（49 次失败 + 第 50 次成功）', async () => {
    await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'almost-dead', base_version: null, payload: { ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' } });

    // 49 次连续失败（retries 会到 49，第 50 次 ackBatchFailure 才会超限）
    for (let i = 0; i < 49; i++) {
      const r = await drainBatch(200);
      expect(r).not.toBeNull();
      await ackBatchFailure(r!.batchKey);
    }

    // 第 50 次 drain 成功推送
    const r50 = await drainBatch(200);
    expect(r50).not.toBeNull();
    expect(r50!.batch[0].retries).toBe(49);

    const okResults: PushResultItem[] = [{ client_ref_id: 'almost-dead', status: 'ok', server_id: 'srv-final', server_version: 1 }];
    await ackResults(r50!.batchKey, okResults);

    // 物理删除成功
    expect(await __peek()).toHaveLength(0);
    expect(await size()).toBe(0);
  });
});
