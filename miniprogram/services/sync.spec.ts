// services/sync.spec.ts · syncPull 分页循环 + E1 epoch 前置比对/重置（L13）
// Refs: docs/design/sync-pull-pagination-design.md §4.2 / §4.3 / §5
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── 可编程响应队列 + 内存 db 状态 ───────────────────────────────────────────

interface PullResp {
  watermark: number;
  has_more?: boolean;
  categories_revision?: string;
  changes: { entries?: unknown[]; ledgers?: unknown[] };
}

let respQueue: PullResp[];
let requestCalls: Array<{ since: number; limit: number }>;

let memWatermark: number;
let memEpochs: Record<string, number> | null;
let strictShouldFail: boolean;
let barrierOpen: boolean;
let revisionRefreshed: string[];
/** 记录 setWatermarkStrict / writeLedgerEpochs 调用顺序（epoch 写序断言用） */
let callOrder: string[];
/** 记录资产缓存覆盖写（含 epoch 重置轮 · §4.3/§4.7 资产不断供） */
let balanceWrites: string[];

vi.mock('./request', () => ({
  request: vi.fn(async (opts: { query?: { since: number; limit: number } }) => {
    requestCalls.push({ since: opts.query!.since, limit: opts.query!.limit });
    const r = respQueue.shift();
    if (!r) throw new Error('respQueue empty');
    return r;
  }),
  ApiError: class extends Error {},
}));

vi.mock('./db', () => ({
  getWatermark: vi.fn(async () => memWatermark),
  setWatermark: vi.fn(async (_f: string, w: number) => { memWatermark = w; }),
  setWatermarkStrict: vi.fn(async (_f: string, w: number) => {
    if (strictShouldFail) throw new Error('strict fail');
    callOrder.push('strict');
    memWatermark = w;
  }),
  applyServerEntriesBatch: vi.fn(async (wires: unknown[]) => ({
    applied: wires.length, skipped: 0, monthsTouched: 1,
  })),
  readLedgerEpochs: vi.fn(async () => memEpochs),
  writeLedgerEpochs: vi.fn(async (_f: string, e: Record<string, number>) => { callOrder.push('epochs'); memEpochs = e; }),
  getEntry: vi.fn(async () => null),
}));

vi.mock('./outbox', () => ({
  drainBatch: vi.fn(async () => null),
  ackResultsBySeq: vi.fn(),
  ackBatchFailure: vi.fn(),
  listPendingEntryRefs: vi.fn(async () => new Set<string>()),
}));

vi.mock('./categoryService', () => ({
  getCachedSystemCategoriesSignature: vi.fn(() => 'local-sig'),
  refreshCategories: vi.fn(async () => { revisionRefreshed.push('refreshed'); return []; }),
  warmUpMemoryCache: vi.fn(),
}));

vi.mock('./ledgerBalanceApi', () => ({
  applyLedgerBalanceFromSync: vi.fn(async (wire: { id: string }) => { balanceWrites.push(wire.id); }),
}));

vi.mock('./storage', () => ({
  __isWriteBlocked: vi.fn(() => barrierOpen),
}));

import { syncPull } from './sync';

function ledger(id: string, epoch: number) {
  return { id, sync_epoch: epoch, balance_cents: 0, balance_baseline_seq: 0, balance_version: 1 };
}

beforeEach(() => {
  respQueue = [];
  requestCalls = [];
  memWatermark = 0;
  memEpochs = null;
  strictShouldFail = false;
  barrierOpen = false;
  revisionRefreshed = [];
  callOrder = [];
  balanceWrites = [];
});

describe('syncPull · 分页循环（L13 §4.3）', () => {
  it('3 页追平：pulled=applied 累计 · pages=3 · watermark 单调', async () => {
    memEpochs = { l1: 0 };
    respQueue = [
      { watermark: 500, has_more: true, changes: { entries: new Array(500).fill(0).map((_, i) => ({ client_ref_id: `a${i}` })), ledgers: [ledger('l1', 0)] } },
      { watermark: 1000, has_more: true, changes: { entries: new Array(500).fill(0).map((_, i) => ({ client_ref_id: `b${i}` })), ledgers: [ledger('l1', 0)] } },
      { watermark: 1200, has_more: false, categories_revision: 'local-sig', changes: { entries: new Array(200).fill(0).map((_, i) => ({ client_ref_id: `c${i}` })), ledgers: [ledger('l1', 0)] } },
    ];
    const out = await syncPull('fam');
    expect(out.pages).toBe(3);
    expect(out.pulled).toBe(1200);
    expect(out.hasMore).toBe(false);
    expect(out.watermark).toBe(1200);
    expect(requestCalls.map(c => c.since)).toEqual([0, 500, 1000]);
    expect(requestCalls[0].limit).toBe(500);
  });

  it('截断：达到 MAX_PULL_PAGES → hasMore=true', async () => {
    memEpochs = { l1: 0 };
    // 40 轮全部 has_more=true
    for (let i = 0; i < 41; i++) {
      respQueue.push({ watermark: (i + 1) * 10, has_more: true, changes: { entries: [{ client_ref_id: `x${i}` }], ledgers: [ledger('l1', 0)] } });
    }
    const out = await syncPull('fam');
    expect(out.hasMore).toBe(true);
    expect(out.pages).toBe(40);
  });

  it('epoch 差异 → 本轮不应用 + watermark 清零 + 全量重拉', async () => {
    memWatermark = 800;
    memEpochs = { l1: 3 };
    respQueue = [
      // 第 1 轮：epoch 从 3→4（导入），触发重置，entries 不应用
      { watermark: 900, has_more: false, changes: { entries: [{ client_ref_id: 'ignored' }], ledgers: [ledger('l1', 4)] } },
      // 重拉：since=0，收敛
      { watermark: 950, has_more: false, categories_revision: 'local-sig', changes: { entries: [{ client_ref_id: 're1' }], ledgers: [ledger('l1', 4)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(true);
    expect(requestCalls.map(c => c.since)).toEqual([800, 0]); // 第二轮 since 清零
    expect(memEpochs).toEqual({ l1: 4 });
    expect(out.pulled).toBe(1); // 只算重拉那轮的 applied
  });

  it('epoch 差异但 strict 清零失败 → 不写 epoch、本轮中止', async () => {
    memWatermark = 800;
    memEpochs = { l1: 3 };
    strictShouldFail = true;
    respQueue = [
      { watermark: 900, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 4)] } },
    ];
    const out = await syncPull('fam');
    expect(memEpochs).toEqual({ l1: 3 }); // epoch 未被改写
    expect(out.pulled).toBe(0);
    expect(requestCalls).toHaveLength(1); // 中止，不重拉
  });

  it('epoch key 集合缺失（本地有 l2 响应没有）→ 触发重置', async () => {
    memWatermark = 500;
    memEpochs = { l1: 0, l2: 0 };
    respQueue = [
      { watermark: 600, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 0)] } }, // 缺 l2
      { watermark: 610, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [ledger('l1', 0)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(true);
  });

  it('服务端不返回 sync_epoch（灰度）→ 归一化 0 → 不重置', async () => {
    memEpochs = { l1: 0 };
    respQueue = [
      { watermark: 100, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [{ id: 'l1', balance_cents: 0, balance_baseline_seq: 0, balance_version: 1 }] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(false);
    expect(requestCalls).toHaveLength(1);
  });

  it('epoch 一致 → 零重置动作', async () => {
    memEpochs = { l1: 7 };
    respQueue = [
      { watermark: 100, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [ledger('l1', 7)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(false);
  });

  it('localEpochs=null（首登/升级）→ 采信写入不重置', async () => {
    memEpochs = null;
    respQueue = [
      { watermark: 100, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [ledger('l1', 9)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(false);
    expect(memEpochs).toEqual({ l1: 9 });
  });

  it('watermark 回退（< since）→ 中止循环', async () => {
    memWatermark = 500;
    memEpochs = { l1: 0 };
    respQueue = [
      { watermark: 400, has_more: false, changes: { entries: [{ client_ref_id: 'x' }], ledgers: [ledger('l1', 0)] } },
    ];
    const out = await syncPull('fam');
    expect(out.pulled).toBe(0); // 未应用
    expect(memWatermark).toBe(500); // 未推进
  });

  it('has_more=true 但 watermark 无进展 → 中止循环', async () => {
    memWatermark = 300;
    memEpochs = { l1: 0 };
    respQueue = [
      { watermark: 300, has_more: true, changes: { entries: [{ client_ref_id: 'x' }], ledgers: [ledger('l1', 0)] } },
    ];
    const out = await syncPull('fam');
    expect(out.pulled).toBe(0);
    expect(out.hasMore).toBe(false);
    expect(requestCalls).toHaveLength(1);
  });

  it('categories_revision 仅在收敛轮消费（has_more 轮跳过）', async () => {
    memEpochs = { l1: 0 };
    respQueue = [
      { watermark: 100, has_more: true, categories_revision: 'server-diff-A', changes: { entries: [], ledgers: [ledger('l1', 0)] } },
      { watermark: 200, has_more: false, categories_revision: 'server-diff-B', changes: { entries: [], ledgers: [ledger('l1', 0)] } },
    ];
    await syncPull('fam');
    // 只有收敛轮的 revision 会触发 refresh（且与 local-sig 不同）
    expect(revisionRefreshed).toEqual(['refreshed']);
  });

  it('写屏障开启 → has_more 轮之间主动退出', async () => {
    memEpochs = { l1: 0 };
    barrierOpen = true;
    respQueue = [
      { watermark: 100, has_more: true, changes: { entries: [], ledgers: [ledger('l1', 0)] } },
    ];
    const out = await syncPull('fam');
    expect(requestCalls).toHaveLength(1); // 第一轮后检测到屏障退出
    expect(out.hasMore).toBe(false);
  });

  it('epoch 差异 → strict 清零先于写 epoch（写序断言 · §4.2 决策 17）', async () => {
    memWatermark = 800;
    memEpochs = { l1: 3 };
    respQueue = [
      { watermark: 900, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 4)] } },
      { watermark: 950, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [ledger('l1', 4)] } },
    ];
    await syncPull('fam');
    // 反序（先 epochs 后 strict）会落到「epoch 新 + watermark 旧高值」的真丢数据状态
    expect(callOrder).toEqual(['strict', 'epochs']);
  });

  it('重拉爬升中二次 epoch 差异 → 再次清零重拉', async () => {
    memEpochs = { l1: 3 };
    respQueue = [
      // 第 1 轮：epoch 3→4 → 重置
      { watermark: 900, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 4)] } },
      // 第 2 轮（重拉爬升中）：epoch 4→5 → 再次重置
      { watermark: 950, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 5)] } },
      // 第 3 轮：一致 → 正常应用收敛
      { watermark: 990, has_more: false, categories_revision: 'local-sig', changes: { entries: [{ client_ref_id: 'x' }], ledgers: [ledger('l1', 5)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(true);
    expect(requestCalls.map(c => c.since)).toEqual([0, 0, 0]); // 两次清零，三次从 0 拉
    expect(memEpochs).toEqual({ l1: 5 });
    expect(out.pulled).toBe(1); // 只算收敛轮应用
  });

  it('epoch 连续差异达 MAX_PULL_PAGES → 截断（防持续批量写入期间紧密循环）', async () => {
    memEpochs = { l1: 0 };
    // 服务端每轮 epoch 都 +1（持续批量写入），本地追踪后下轮仍 diff
    for (let i = 0; i < 41; i++) {
      respQueue.push({ watermark: 100, has_more: false, changes: { entries: [], ledgers: [ledger('l1', i + 1)] } });
    }
    const out = await syncPull('fam');
    expect(out.hasMore).toBe(true); // 截断 → 由 pull-continue 续拉兜底
    expect(out.epochReset).toBe(true);
    expect(requestCalls).toHaveLength(40); // 重置轮计入 pages 预算
    // 资产不断供：40 个重置轮每轮都覆盖写（§4.3/§4.7）——
    // 若资产写排在 epoch 判定之后，这里会是 0，持续批量写入期间资产整轮不更新。
    expect(balanceWrites).toHaveLength(40);
  });

  it('资产写发生在 epoch 判定之前 → 单个重置轮也覆盖写（§4.3 资产不断供）', async () => {
    memWatermark = 800;
    memEpochs = { l1: 3 };
    respQueue = [
      { watermark: 900, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 4)] } }, // 重置轮
      { watermark: 950, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [ledger('l1', 4)] } },
    ];
    await syncPull('fam');
    expect(balanceWrites).toEqual(['l1', 'l1']); // 重置轮 + 收敛轮各一次
  });

  it('响应无 ledgers（服务端账本自愈窗口）→ 不比对不写 epoch、不触发重拉', async () => {
    memWatermark = 500;
    memEpochs = { l1: 7 };
    respQueue = [
      // ledgers 为空：不是"账本消失"，只是本轮没下发 → 不得判 key 集合 diff
      { watermark: 600, has_more: false, categories_revision: 'local-sig', changes: { entries: [], ledgers: [] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(false);
    expect(memEpochs).toEqual({ l1: 7 });   // 本地 epoch 未被 {} 覆盖
    expect(requestCalls).toHaveLength(1);   // 未重拉
    expect(out.watermark).toBe(600);        // 正常推进
  });

  it('watermark 回退的响应不触发 epoch 重置（校验前置于 epoch 环节）', async () => {
    memWatermark = 500;
    memEpochs = { l1: 3 };
    respQueue = [
      // 既 watermark 回退、又带 epoch 差异：非法响应不应驱动任何本地状态变更
      { watermark: 400, has_more: false, changes: { entries: [], ledgers: [ledger('l1', 9)] } },
    ];
    const out = await syncPull('fam');
    expect(out.epochReset).toBe(false);
    expect(memEpochs).toEqual({ l1: 3 });   // epoch 未被改写
    expect(memWatermark).toBe(500);         // watermark 未被清零
    expect(callOrder).toEqual([]);          // strict 清零未发生
  });
});
