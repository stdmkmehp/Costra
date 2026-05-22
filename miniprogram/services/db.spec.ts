// services/db.spec.ts · 本地 KV 实体持久化层（db.ts）单测
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// Refs: storage.spec.ts 8 测格式范本 · costra-103-miniapp-local-persistence-outbox.md §2.6
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  putEntry,
  getEntry,
  listEntries,
  deleteEntry,
  getWatermark,
  setWatermark,
} from './db';
import { setItem } from './storage';

// 共享 mock storage（模拟 wx.storage Promise 形态）
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

describe('services/db · 模拟 wx.storage（mock 环境）', () => {
  beforeEach(() => {
    mockStore = new Map<string, unknown>();
    vi.stubGlobal('wx', mockWx());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('putEntry → getEntry 往返（client_ref_id 主键）', async () => {
    const entry = { client_ref_id: 'test-ref-1', ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense' as const, category_id: null, note: 'test', occurred_at: '2026-05-09T00:00:00.000Z' };
    await putEntry(entry);
    const got = await getEntry('test-ref-1');
    expect(got).not.toBeNull();
    expect(got?.client_ref_id).toBe('test-ref-1');
    expect(got?.amount).toBe(100);
    expect(got?.dirty).toBe(true);
  });

  it('getEntry 不存在的 key 返回 null', async () => {
    const got = await getEntry('never-exist');
    expect(got).toBeNull();
  });

  it('listEntries 无过滤返回所有（不含软删）', async () => {
    await putEntry({ client_ref_id: 'e1', ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' });
    await putEntry({ client_ref_id: 'e2', ledger_id: 'l2', amount: 200, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:01:00.000Z' });
    const results = await listEntries();
    expect(results).toHaveLength(2);
    expect(results.map(e => e.client_ref_id)).toContain('e1');
    expect(results.map(e => e.client_ref_id)).toContain('e2');
  });

  it('deleteEntry 软删（listEntries 不返回）', async () => {
    await putEntry({ client_ref_id: 'del-1', ledger_id: 'l1', amount: 300, currency: 'CNY', type: 'expense', category_id: null, note: '', occurred_at: '2026-05-09T00:00:00.000Z' });
    await deleteEntry('del-1');
    const got = await getEntry('del-1');
    expect(got).not.toBeNull();
    expect(got?.deleted_at).toBeTruthy();
    const list = await listEntries();
    expect(list.some(e => e.client_ref_id === 'del-1')).toBe(false);
  });

  it('watermark 读写单调（v1.2 升级 · BIGINT change_seq）', async () => {
    await setWatermark('fam-1', 100);
    const w1 = await getWatermark('fam-1');
    expect(w1).toBe(100);
    await setWatermark('fam-1', 200);
    const w2 = await getWatermark('fam-1');
    expect(w2).toBe(200);
    expect(w2).toBeGreaterThan(w1);
  });

  it('getWatermark 不存在的 family 返回 0（v1.2 升级 · 不再 EPOCH ISO）', async () => {
    const w = await getWatermark('never-exist-family');
    expect(w).toBe(0);
  });

  it('getWatermark legacy ISO 字符串自动重置为 0（v1.2 兼容）', async () => {
    // 模拟旧 v1.0/v1.1 残留 ISO 字符串 watermark
    await setItem('watermark:legacy-fam', '2026-05-22T07:53:04.621137Z' as never);
    const w = await getWatermark('legacy-fam');
    expect(w).toBe(0);
    // 自动清除 · 下次读为 0（已被 setWatermark 覆盖）
    const w2 = await getWatermark('legacy-fam');
    expect(w2).toBe(0);
  });

  it('setWatermark 防御负数 / 非整数 · 静默忽略', async () => {
    await setWatermark('fam-defense', 50);
    await setWatermark('fam-defense', -1 as never);  // 负数
    expect(await getWatermark('fam-defense')).toBe(50);  // 不被覆盖
    await setWatermark('fam-defense', 1.5 as never);  // 浮点
    expect(await getWatermark('fam-defense')).toBe(50);  // 不被覆盖
  });

  it('putEntry 重复 client_ref_id（幂等覆盖）', async () => {
    await putEntry({ client_ref_id: 'dup-1', ledger_id: 'l1', amount: 100, currency: 'CNY', type: 'expense', category_id: null, note: 'v1', occurred_at: '2026-05-09T00:00:00.000Z' });
    await putEntry({ client_ref_id: 'dup-1', ledger_id: 'l1', amount: 200, currency: 'CNY', type: 'expense', category_id: null, note: 'v2', occurred_at: '2026-05-09T00:01:00.000Z' });
    const got = await getEntry('dup-1');
    expect(got?.amount).toBe(200);
    expect(got?.note).toBe('v2');
  });
});
