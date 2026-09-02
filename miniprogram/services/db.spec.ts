// services/db.spec.ts · 本地 KV 实体持久化层（db.ts）单测
// 卡号: COSTRA-103（Epic-C 主线）· L13（sync/pull 分页收敛）
// Refs: docs/design/sync-pull-pagination-design.md §4.4 / §4.5
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  putEntry,
  getEntry,
  listMonthEntries,
  deleteEntry,
  updateEntryFields,
  applyServerEntriesBatch,
  getWatermark,
  setWatermark,
  setWatermarkStrict,
  readLedgerEpochs,
  writeLedgerEpochs,
  cleanupLegacyEntryIndex,
  LEGACY_ENTRY_INDEX_KEY,
  __test__,
  type Entry,
} from './db';
import { setItem } from './storage';

// 共享 mock storage（模拟 wx.storage Promise 形态）
let mockStore: Map<string, unknown>;
// 注入型故障开关：模拟 setStorage 失败（用于 setWatermarkStrict 路径）
let failSetStorageKeys: Set<string>;
// 计数：实体键枚举次数（用于断言批末共享扫描，L13 §4.4 收益口径）
let storageInfoCalls: number;

function mockWx() {
  return {
    getStorage: <T>({ key }: { key: string }): Promise<{ data: T }> => {
      if (mockStore.has(key)) return Promise.resolve({ data: mockStore.get(key) as T });
      return Promise.reject({ errMsg: 'getStorage:fail data not found' });
    },
    setStorage: <T>({ key, data }: { key: string; data: T }): Promise<void> => {
      if (failSetStorageKeys.has(key)) return Promise.reject({ errMsg: 'setStorage:fail' });
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
    getStorageInfo(): Promise<{ keys: string[] }> {
      storageInfoCalls++;
      return Promise.resolve({ keys: [...mockStore.keys()] });
    },
  };
}

/** 构造一个最小 entry。 */
function mkEntry(overrides: Partial<Entry> & { client_ref_id: string }): Entry {
  return {
    ledger_id: 'l1',
    amount: 100,
    currency: 'CNY',
    type: 'expense',
    category_id: null,
    note: '',
    occurred_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

/** 构造一个服务端 wire（sync/pull 格式：server_version / user_id）。 */
function mkWire(overrides: Record<string, unknown> & { client_ref_id: string }): Record<string, unknown> {
  return {
    ledger_id: 'l1',
    amount: 100,
    currency: 'CNY',
    type: 'expense',
    category_id: null,
    note: '',
    occurred_at: '2026-06-10T00:00:00.000Z',
    server_version: 1,
    user_id: 'u1',
    ...overrides,
  };
}

describe('services/db · 模拟 wx.storage（mock 环境）', () => {
  beforeEach(() => {
    mockStore = new Map<string, unknown>();
    failSetStorageKeys = new Set<string>();
    storageInfoCalls = 0;
    __test__.resetIndexQueue();
    vi.stubGlobal('wx', mockWx());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── 基础往返 ────────────────────────────────────────────────────────────

  it('putEntry → getEntry 往返（client_ref_id 主键）', async () => {
    await putEntry(mkEntry({ client_ref_id: 'test-ref-1', amount: 100, note: 'test' }));
    const got = await getEntry('test-ref-1');
    expect(got).not.toBeNull();
    expect(got?.client_ref_id).toBe('test-ref-1');
    expect(got?.amount).toBe(100);
  });

  it('getEntry 不存在的 key 返回 null', async () => {
    const got = await getEntry('never-exist');
    expect(got).toBeNull();
  });

  it('deleteEntry 软删（listMonthEntries 不返回）', async () => {
    await putEntry(mkEntry({ client_ref_id: 'del-1', amount: 300 }));
    await deleteEntry('del-1');
    await __test__.flushIndexQueue();
    const got = await getEntry('del-1');
    expect(got).not.toBeNull();
    expect(got?.deleted_at).toBeTruthy();
    const list = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    expect(list.entries.some(e => e.client_ref_id === 'del-1')).toBe(false);
  });

  // ─── watermark ───────────────────────────────────────────────────────────

  it('watermark 读写单调（BIGINT change_seq）', async () => {
    await setWatermark('fam-1', 100);
    expect(await getWatermark('fam-1')).toBe(100);
    await setWatermark('fam-1', 200);
    expect(await getWatermark('fam-1')).toBe(200);
  });

  it('getWatermark 不存在的 family 返回 0', async () => {
    expect(await getWatermark('never-exist-family')).toBe(0);
  });

  it('getWatermark legacy ISO 字符串自动重置为 0', async () => {
    await setItem('watermark:legacy-fam', '2026-05-22T07:53:04.621137Z' as never);
    expect(await getWatermark('legacy-fam')).toBe(0);
    expect(await getWatermark('legacy-fam')).toBe(0);
  });

  it('setWatermark 防御负数 / 非整数 · 静默忽略', async () => {
    await setWatermark('fam-defense', 50);
    await setWatermark('fam-defense', -1 as never);
    expect(await getWatermark('fam-defense')).toBe(50);
    await setWatermark('fam-defense', 1.5 as never);
    expect(await getWatermark('fam-defense')).toBe(50);
  });

  // ─── setWatermarkStrict（L13 §3.7）────────────────────────────────────────

  it('setWatermarkStrict 正常写入 + 读回确认', async () => {
    await setWatermark('fam-s', 999);
    await setWatermarkStrict('fam-s', 0);
    expect(await getWatermark('fam-s')).toBe(0);
  });

  it('setWatermarkStrict 写失败 → 抛错（不吞）', async () => {
    failSetStorageKeys.add('watermark:fam-fail');
    await expect(setWatermarkStrict('fam-fail', 0)).rejects.toThrow();
  });

  // ─── epoch 记录读写（L13 §4.2）────────────────────────────────────────────

  it('readLedgerEpochs 首次为 null · 写入后可读回', async () => {
    expect(await readLedgerEpochs('fam-e')).toBeNull();
    await writeLedgerEpochs('fam-e', { l1: 3, l2: 5 });
    expect(await readLedgerEpochs('fam-e')).toEqual({ l1: 3, l2: 5 });
  });

  // ─── 月索引 ────────────────────────────────────────────────────────────────

  it('listMonthEntries 使用月索引按时间倒序读取最近 N 条', async () => {
    await putEntry(mkEntry({ client_ref_id: 'm1', occurred_at: '2026-06-01T00:00:00.000Z' }));
    await putEntry(mkEntry({ client_ref_id: 'm2', occurred_at: '2026-06-03T00:00:00.000Z' }));
    await putEntry(mkEntry({ client_ref_id: 'm3', occurred_at: '2026-06-02T00:00:00.000Z' }));
    await putEntry(mkEntry({ client_ref_id: 'other', occurred_at: '2026-07-01T00:00:00.000Z' }));
    await __test__.flushIndexQueue();

    // §4.5 纪律 6（方案 B）：mutation upsert 在索引缺失时跳过写入，
    // 首次读触发懒重建建索引，第二次读起走 month-index。
    await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    const recent = await listMonthEntries({ ledger_id: 'l1', month: '2026-06', limit: 2 });
    expect(recent.source).toBe('month-index');
    expect(recent.complete).toBe(false);
    expect(recent.totalIndexed).toBe(3);
    expect(recent.entries.map(e => e.client_ref_id)).toEqual(['m2', 'm3']);
  });

  it('listMonthEntries 按 Asia/Shanghai 自然月归属月初边界流水', async () => {
    await putEntry(mkEntry({ client_ref_id: 'sh-1', occurred_at: '2026-05-31T16:30:00.000Z' }));
    await __test__.flushIndexQueue();
    const may = await listMonthEntries({ ledger_id: 'l1', month: '2026-05' });
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    expect(may.entries.map(e => e.client_ref_id)).not.toContain('sh-1');
    expect(june.entries.map(e => e.client_ref_id)).toContain('sh-1');
  });

  it('updateEntryFields 修改 occurred_at 时迁移月索引', async () => {
    await putEntry(mkEntry({ client_ref_id: 'move-1', occurred_at: '2026-06-15T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    await updateEntryFields('move-1', { occurred_at: '2026-07-01T00:00:00.000Z' });
    await __test__.flushIndexQueue();
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    const july = await listMonthEntries({ ledger_id: 'l1', month: '2026-07' });
    expect(june.entries.map(e => e.client_ref_id)).not.toContain('move-1');
    expect(july.entries.map(e => e.client_ref_id)).toContain('move-1');
  });

  it('listMonthEntries 在月索引缺失时懒重建（键枚举）', async () => {
    await putEntry(mkEntry({ client_ref_id: 'legacy-indexed', occurred_at: '2026-06-20T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    await wx.removeStorage({ key: 'entry:index:l1:2026-06' });
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    expect(june.source).toBe('rebuilt-month-index');
    expect(june.complete).toBe(true);
    expect(june.entries.map(e => e.client_ref_id)).toEqual(['legacy-indexed']);
  });

  it('rebuild 键枚举排除 entry:index:* 与 entry:__index', async () => {
    await putEntry(mkEntry({ client_ref_id: 'ref-a', occurred_at: '2026-06-10T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    // 注入遗留全局索引（不含 ':' 余段），rebuild 不应把它当作 entry
    await setItem(LEGACY_ENTRY_INDEX_KEY, ['garbage-ref']);
    const rebuilt = await __test__.rebuildEntryMonthIndexBare('l1', '2026-06');
    expect(rebuilt.map(i => i.client_ref_id)).toEqual(['ref-a']);
  });

  // ─── applyServerEntriesBatch：判定四档（§4.4 ③）────────────────────────────

  it('批量落盘：本地不存在 → 写入 + 维护月索引', async () => {
    const res = await applyServerEntriesBatch([
      mkWire({ client_ref_id: 'server-ref-1', occurred_at: '2026-06-22T00:00:00.000Z', server_version: 1, shared_type: 'shared', source_recurring_id: 'rule-1' }),
    ]);
    await __test__.flushIndexQueue();
    expect(res.applied).toBe(1);
    expect(res.skipped).toBe(0);
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    expect(june.entries.map(e => e.client_ref_id)).toEqual(['server-ref-1']);
    expect(june.entries[0].shared_type).toBe('shared');
    expect(june.entries[0].source_recurring_id).toBe('rule-1');
  });

  it('判定：serverVer > localVer → 覆盖', async () => {
    await putEntry(mkEntry({ client_ref_id: 'r', version: 1, note: 'old' }));
    const res = await applyServerEntriesBatch([mkWire({ client_ref_id: 'r', server_version: 2, note: 'new' })]);
    expect(res.applied).toBe(1);
    expect((await getEntry('r'))?.note).toBe('new');
  });

  it('判定：serverVer < localVer → skip', async () => {
    await putEntry(mkEntry({ client_ref_id: 'r', version: 5, note: 'local-newer' }));
    const res = await applyServerEntriesBatch([mkWire({ client_ref_id: 'r', server_version: 3, note: 'stale' })]);
    expect(res.skipped).toBe(1);
    expect((await getEntry('r'))?.note).toBe('local-newer');
  });

  it('判定：相等 + 无 pending + 内容漂移 → 覆盖并拉回 canonical category_id / shared_type', async () => {
    // 本地 version=2，但 category_id/shared_type 是未规范化的旧值
    await putEntry(mkEntry({ client_ref_id: 'r', version: 2, category_id: null, shared_type: null }));
    const res = await applyServerEntriesBatch([
      mkWire({ client_ref_id: 'r', server_version: 2, category_id: 'cat-x', shared_type: 'shared' }),
    ]);
    expect(res.applied).toBe(1);
    const got = await getEntry('r');
    expect(got?.category_id).toBe('cat-x');
    expect(got?.shared_type).toBe('shared');
  });

  it('判定：相等 + 无 pending + 内容等价 → skip（epoch 全量重拉老行不重复写）', async () => {
    // local 与 wire 的业务字段完全一致（含 created_by / category_id / shared_type）
    await putEntry(mkEntry({ client_ref_id: 'r', version: 2, category_id: 'cat-x', shared_type: 'shared', note: 'same', created_by: 'u1' }));
    const res = await applyServerEntriesBatch([
      mkWire({ client_ref_id: 'r', server_version: 2, category_id: 'cat-x', shared_type: 'shared', note: 'same', user_id: 'u1' }),
    ]);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it('判定：相等 + 有 pending → skip 且本地软删不被复活', async () => {
    // 本地软删（deleteEntry 不推进 version），服务端仍是同 version 的未删行
    await putEntry(mkEntry({ client_ref_id: 'r', version: 2 }));
    await deleteEntry('r');
    await __test__.flushIndexQueue();
    const res = await applyServerEntriesBatch(
      [mkWire({ client_ref_id: 'r', server_version: 2, deleted_at: null })],
      { pendingRefs: new Set(['r']) },
    );
    expect(res.skipped).toBe(1);
    expect((await getEntry('r'))?.deleted_at).toBeTruthy(); // 未被复活
  });

  it('sameEntryContent 归一化 null/undefined 且排除 created_at/updated_at', async () => {
    const a = mkEntry({ client_ref_id: 'r', category_id: null, created_at: '2026-01-01T00:00:00Z' });
    const b = mkEntry({ client_ref_id: 'r', category_id: undefined as never, updated_at: '2099-01-01T00:00:00Z' });
    expect(__test__.sameEntryContent(a, b)).toBe(true);
    const c = mkEntry({ client_ref_id: 'r', category_id: 'diff' });
    expect(__test__.sameEntryContent(a, c)).toBe(false);
  });

  it('批量落盘：跨月移动的月索引 delta（旧月删 + 新月增）', async () => {
    await putEntry(mkEntry({ client_ref_id: 'r', version: 1, occurred_at: '2026-06-15T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    await applyServerEntriesBatch([mkWire({ client_ref_id: 'r', server_version: 2, occurred_at: '2026-07-05T00:00:00.000Z' })]);
    await __test__.flushIndexQueue();
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    const july = await listMonthEntries({ ledger_id: 'l1', month: '2026-07' });
    expect(june.entries.map(e => e.client_ref_id)).not.toContain('r');
    expect(july.entries.map(e => e.client_ref_id)).toContain('r');
  });

  it('批末重读为 null → 裸重建 + delta 合并，全月不缺条（§4.5 纪律 5）', async () => {
    // 该月本地已有实体（通过直写实体绕过月索引建立），但月索引 key 从未建立
    await putEntry(mkEntry({ client_ref_id: 'existing', version: 1, occurred_at: '2026-08-10T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    // 删掉月索引 key，模拟"key 从未建立/被清"
    await wx.removeStorage({ key: 'entry:index:l1:2026-08' });
    // 批量落盘一条新行到同月：批末任务重读为 null → 应裸重建（含 existing）再合并 new
    await applyServerEntriesBatch([mkWire({ client_ref_id: 'new', server_version: 1, occurred_at: '2026-08-20T00:00:00.000Z' })]);
    await __test__.flushIndexQueue();
    const aug = await listMonthEntries({ ledger_id: 'l1', month: '2026-08' });
    const refs = aug.entries.map(e => e.client_ref_id).sort();
    expect(refs).toEqual(['existing', 'new']); // 两条都在，不缺条
  });

  it('批末多月 null 重建共享同一次实体扫描（不按月各扫一次）', async () => {
    // 本地已有 3 个月的实体，且三个月的月索引 key 都不存在（模拟首登/清缓存）
    await putEntry(mkEntry({ client_ref_id: 'e-06', version: 1, occurred_at: '2026-06-10T00:00:00.000Z' }));
    await putEntry(mkEntry({ client_ref_id: 'e-07', version: 1, occurred_at: '2026-07-10T00:00:00.000Z' }));
    await putEntry(mkEntry({ client_ref_id: 'e-08', version: 1, occurred_at: '2026-08-10T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    for (const m of ['2026-06', '2026-07', '2026-08']) {
      await wx.removeStorage({ key: `entry:index:l1:${m}` });
    }

    // 一批落盘覆盖 3 个月 → 3 个批末任务都会读到 null 并需要推导重建
    storageInfoCalls = 0;
    await applyServerEntriesBatch([
      mkWire({ client_ref_id: 's-06', server_version: 1, occurred_at: '2026-06-20T00:00:00.000Z' }),
      mkWire({ client_ref_id: 's-07', server_version: 1, occurred_at: '2026-07-20T00:00:00.000Z' }),
      mkWire({ client_ref_id: 's-08', server_version: 1, occurred_at: '2026-08-20T00:00:00.000Z' }),
    ]);
    await __test__.flushIndexQueue();

    // 关键断言：整批只扫描一次（旧实现是每月一次 → O(月数 × 实体数)）
    expect(storageInfoCalls).toBe(1);

    // 正确性不打折：三个月各自都含"已有实体 + 本批新行"
    for (const [m, refs] of [
      ['2026-06', ['e-06', 's-06']],
      ['2026-07', ['e-07', 's-07']],
      ['2026-08', ['e-08', 's-08']],
    ] as const) {
      const list = await listMonthEntries({ ledger_id: 'l1', month: m });
      expect(list.entries.map(e => e.client_ref_id).sort()).toEqual([...refs].sort());
    }
  });

  it('批末纯 remove 的 delta 遇 key 缺失 → 不写空索引、不触发扫描', async () => {
    // 本地已有该月实体，但月索引 key 不存在
    await putEntry(mkEntry({ client_ref_id: 'kept', version: 1, occurred_at: '2026-06-10T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    await wx.removeStorage({ key: 'entry:index:l1:2026-06' });

    // 服务端下发一条"本地从未存在过"的软删行 → delta 只有 remove
    storageInfoCalls = 0;
    await applyServerEntriesBatch([
      mkWire({ client_ref_id: 'never-seen', server_version: 1, occurred_at: '2026-06-15T00:00:00.000Z', deleted_at: '2026-06-16T00:00:00.000Z' }),
    ]);
    await __test__.flushIndexQueue();

    // 无事可做：不写 key（避免"key 存在但只含子集"），也不为此付一次全量扫描
    expect(mockStore.has('entry:index:l1:2026-06')).toBe(false);
    expect(storageInfoCalls).toBe(0);
    // 读路径 rebuild 兜底：已有实体仍可见，软删行不出现
    const june = await listMonthEntries({ ledger_id: 'l1', month: '2026-06' });
    expect(june.entries.map(e => e.client_ref_id)).toEqual(['kept']);
  });

  // ─── R5 交错（§4.5）─────────────────────────────────────────────────────────

  it('R5 交错：批量落盘进行中并发 mutation，同月索引两侧都不丢', async () => {
    // 同月既有本地行，批量写入 server 行的同时并发 putEntry 一条新行
    await putEntry(mkEntry({ client_ref_id: 'pre', version: 1, occurred_at: '2026-09-01T00:00:00.000Z' }));
    await __test__.flushIndexQueue();

    const batchP = applyServerEntriesBatch([
      mkWire({ client_ref_id: 'srv', server_version: 1, occurred_at: '2026-09-10T00:00:00.000Z' }),
    ]);
    const mutP = putEntry(mkEntry({ client_ref_id: 'usr', occurred_at: '2026-09-15T00:00:00.000Z' }));
    await Promise.all([batchP, mutP]);
    await __test__.flushIndexQueue();

    const sep = await listMonthEntries({ ledger_id: 'l1', month: '2026-09' });
    const refs = sep.entries.map(e => e.client_ref_id).sort();
    expect(refs).toEqual(['pre', 'srv', 'usr']); // 三条都在
  });

  it('R5 交错：批量落盘进行中并发 rebuild（月索引缺失触发），同月索引两侧都不丢', async () => {
    await putEntry(mkEntry({ client_ref_id: 'pre', version: 1, occurred_at: '2026-09-01T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    // 删掉月索引 key：批末任务重读将拿到 null（走裸重建），并发读触发 rebuild 入队
    await wx.removeStorage({ key: 'entry:index:l1:2026-09' });

    const batchP = applyServerEntriesBatch([
      mkWire({ client_ref_id: 'srv', server_version: 1, occurred_at: '2026-09-10T00:00:00.000Z' }),
    ]);
    // 并发触发 rebuild（listMonthEntries 读 null → rebuildEntryMonthIndex 入队）
    const readP = listMonthEntries({ ledger_id: 'l1', month: '2026-09' });
    await Promise.all([batchP, readP]);
    await __test__.flushIndexQueue();

    const sep = await listMonthEntries({ ledger_id: 'l1', month: '2026-09' });
    expect(sep.entries.map(e => e.client_ref_id).sort()).toEqual(['pre', 'srv']);
  });

  it('mutation upsert：月索引缺失时不写子集索引，读路径 rebuild 兜底全量可见', async () => {
    // 该月本地已有实体（直写实体绕过月索引建立），但月索引 key 从未建立
    await putEntry(mkEntry({ client_ref_id: 'existing', version: 1, occurred_at: '2026-08-10T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    // 删掉月索引 key，模拟"key 从未建立/被清"
    await wx.removeStorage({ key: 'entry:index:l1:2026-08' });
    // mutation 新增同月一条：upsert 读到 null → 跳过写入（不造"key 存在但只含子集"）
    await putEntry(mkEntry({ client_ref_id: 'new', occurred_at: '2026-08-20T00:00:00.000Z' }));
    await __test__.flushIndexQueue();
    // key 仍保持缺失（而非子集索引）
    expect(mockStore.has('entry:index:l1:2026-08')).toBe(false);
    // 读路径 rebuild 兜底：全月两条都可见
    const aug = await listMonthEntries({ ledger_id: 'l1', month: '2026-08' });
    expect(aug.entries.map(e => e.client_ref_id).sort()).toEqual(['existing', 'new']);
  });

  // ─── 遗留 entry:__index 清理 ─────────────────────────────────────────────────

  it('cleanupLegacyEntryIndex 存在即删，不存在 noop', async () => {
    await setItem(LEGACY_ENTRY_INDEX_KEY, ['a', 'b']);
    await cleanupLegacyEntryIndex();
    expect(mockStore.has(LEGACY_ENTRY_INDEX_KEY)).toBe(false);
    // 再次调用不报错
    await cleanupLegacyEntryIndex();
  });
});
