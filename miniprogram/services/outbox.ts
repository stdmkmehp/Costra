// services/outbox.ts · outbox 重放队列（多 key 分片 · 指数退避重试 · 三态消费）
// 卡号: COSTRA-103（Epic-C 主线 · R1.2 末轮修复 · SBAI 第 7 次冒烟）
// R1.x.2 修复（2026-05-22 BUG-COSTRA-150-D）: 新增 ackBatchFailure · 修正 drained 语义
// Refs: sync-protocol.md §2 push/§5 重试 · id-strategy.md §3.1 · costra-103-miniapp-local-persistence-outbox.md §2.2
// 存储 key 命名空间：outbox:{seq} / outbox:__index / outbox:__retries / outbox:__drained
//
// 状态机契约（R1.x.2 修订）：
//   - index：待 drain 的 seq 列表
//   - drained：已 drain 但未 ack 的 seq（pushDelta 一次完整调用后必为空）
//   - 三种结束路径必须清空 drained 中本批次 seq：
//     a) ackResults（服务端响应三态：ok/conflict/rejected）
//     b) ackBatchFailure（网络/异常失败 · 整批复原到 index）
//     c) drainBatch recover 分支（防御性兜底 · 处理异常中断遗留的孤儿）
//
// 设计要点：
//   1. index = 全量待重放 op seq 列表（drainBatch 时移除 · ackBatchFailure/conflict 时复原）
//   2. drainBatch 过滤 next_retry_at <= now 的 op，记录到 outbox:__drained
//   3. ackResults 从 outbox:__drained 读取 drained seqs，按 idempotency_key 处理三态
//   4. ackBatchFailure（新增）：网络失败时复原本批次到 index · retries 递增
//   5. conflict → 立即重试（next_retry_at = now+1，recover cutoff=now+5000 兜底让第二次 drainBatch 取回）

import { getItem, setItem, removeItem } from './storage';

export type SyncOp = {
  op: 'create' | 'update' | 'delete';
  entity: 'entry' | 'category' | 'budget';
  client_ref_id: string;
  base_version: number | null;
  payload: Record<string, unknown>;
  enqueued_at: number;          // 原始 ms（用于 sync-protocol 协议）
  /** 存储键 seq（微秒级唯一，防 Date.now() 同值碰撞）；drainBatch/ackResults 用此键寻址 */
  seq: number;
  retries: number;
  next_retry_at: number;
  idempotency_key: string;
  /** drainBatch 批次键；ackResults 按此字段定位本次批次的 op */
  ack_batch_key?: string;
};

/** push 结果单条（sync-protocol.md §2.3 results[]） */
export interface PushResultItem {
  client_ref_id: string;
  status: 'ok' | 'conflict' | 'rejected';
  server_id?: string | null;
  server_version?: number | null;
  error?: {
    code: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

// ─── key helpers ──────────────────────────────────────────────────────────────

function opKey(seq: number): string {
  return `outbox:${seq}`;
}

const INDEX_KEY = 'outbox:__index';
const RETRIES_KEY = 'outbox:__retries';
const DRAINED_KEY = 'outbox:__drained';

// ─── internal helpers ───────────────────────────────────────────────────────────

async function readIndex(): Promise<number[]> {
  return (await getItem<number[]>(INDEX_KEY)) || [];
}

async function writeIndex(seqs: number[]): Promise<void> {
  await setItem(INDEX_KEY, [...new Set(seqs)]);
}

async function readDrained(): Promise<number[]> {
  return (await getItem<number[]>(DRAINED_KEY)) || [];
}

async function writeDrained(seqs: number[]): Promise<void> {
  await setItem(DRAINED_KEY, seqs);
}

async function readRetries(): Promise<Record<string, number>> {
  return (await getItem<Record<string, number>>(RETRIES_KEY)) || {};
}

async function incrementRetry(clientRefId: string): Promise<number> {
  const retries = await readRetries();
  retries[clientRefId] = (retries[clientRefId] || 0) + 1;
  await setItem(RETRIES_KEY, retries);
  return retries[clientRefId];
}

// ─── seq 生成器（防 Date.now() 同值碰撞）───────────────────────────────────────

let _seqCounter = 0;
let _lastSeqTime = 0;

function newSeq(): number {
  const now = Date.now();
  if (now === _lastSeqTime) {
    _seqCounter++;
  } else {
    _seqCounter = 0;
    _lastSeqTime = now;
  }
  return now * 1000 + _seqCounter;
}

// ─── retry 计数（指数退避在 Sprint-3 合并 UI 时恢复）─────────────────────────

// ─── 导出 API（6 个）───────────────────────────────────────────────────────────

export async function enqueue(
  op: Omit<SyncOp, 'seq' | 'enqueued_at' | 'retries' | 'next_retry_at' | 'idempotency_key' | 'ack_batch_key'>
): Promise<void> {
  const now = Date.now();
  const seq = newSeq();
  const idempotencyKey = `idem-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const fullOp: SyncOp = {
    ...op,
    enqueued_at: now,
    seq,
    retries: 0,
    next_retry_at: now,
    idempotency_key: idempotencyKey,
  };

  await setItem(opKey(seq), fullOp);
  const idx = await readIndex();
  const uniqueSeqs = [...new Set([...idx, seq])];
  await writeIndex(uniqueSeqs);
}

/**
 * 取出一批可重放的 op（drain · 原子操作）
 * 设计：
 *   - drainBatch 过滤 next_retry_at <= now 的 op
 *   - 写 ack_batch_key 到每条 op
 *   - 把这些 seq 从 index 移除，记录到 outbox:__drained
 *   - 当 idx 为空但 drained 有待重试 op（conflict 场景）时，从 drained 恢复
 * @param maxBatch 批次上限 · 默认 200
 */
export async function drainBatch(
  maxBatch = 200
): Promise<{ batch: SyncOp[]; batchKey: string } | null> {
  const idx = await readIndex();
  const drained = await readDrained();
  const batch: SyncOp[] = [];
  const drainedList: number[] = [];

  const now = Date.now();
  let pendingDrained = [...drained]; // 可变 drained 列表（recover 后删 recovered seq）
  let currentIdx = [...idx];         // 可变 index（recover 后删 recovered seq 避免重复 append）

  // ─── 防御性 recover 分支 ─────────────────────────────────────────────────────
  // 不变量（R1.x.2 修订）：pushDelta 一次完整调用结束后 · drained 应清空
  //   - 成功路径走 ackResults · 失败路径走 ackBatchFailure · 都会清 drained
  //   - drained 残留 = 异常中断 / storage 损坏 / 上一版本遗留的孤儿
  //   - 此分支无差别 recover 所有 drained 中的 op（不再区分 retries > 0）
  //   - 修复 BUG-COSTRA-150-D：旧实装只 recover retries > 0 · 导致首次失败的 retries=0 op 死锁
  if (drained.length > 0) {
    for (const seq of drained) {
      const op = await getItem<SyncOp>(opKey(seq));
      if (!op) {
        pendingDrained = pendingDrained.filter(s => s !== seq);
        continue;
      }
      // 防止本轮主循环（L162-172）通过 currentIdx 重复取此 op
      pendingDrained = pendingDrained.filter(s => s !== seq);
      currentIdx = currentIdx.filter(s => s !== seq);
      // next_retry_at 推到 now+1 · 防止重复入队竞态（L169 过滤 next_retry_at > now）
      op.next_retry_at = now + 1;
      batch.push({ ...op });
    }
    if (pendingDrained.length !== drained.length) {
      await writeDrained(pendingDrained);
    }
  }

  for (const seq of currentIdx) {
    if (batch.length >= maxBatch) break;
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) {
      drainedList.push(seq); // orphaned key 清理
      continue;
    }
    if (op.next_retry_at > now) continue; // 跳过 future op
    batch.push({ ...op });  // ⚠️ 复制对象：防止 L190 setItem mutate 覆盖 storage 中的 conflict 值
    drainedList.push(seq);
  }

  if (batch.length === 0) return null;

  const batchKey = batch[0].idempotency_key;
  for (const op of batch) {
    op.ack_batch_key = batchKey;
    await setItem(opKey(op.seq), op);
  }

  // 写 drained：普通 drain 项追加（供 ackResults 扫描三态）
  const prevDrained = await readDrained();
  await writeDrained([...prevDrained, ...drainedList]);
  const remaining = currentIdx.filter(s => !drainedList.includes(s));
  await writeIndex(remaining);

  return { batch, batchKey };
}

/**
 * 消费 push 结果（三态处理 · sync-protocol.md §2.4）
 * 设计：从 outbox:__drained 读 drained seqs，按 idempotency_key 处理三态。
 * @param batchKey 批次 idempotency_key
 * @param results push 返回的 results 数组
 */
export async function ackResults(
  batchKey: string,
  results: PushResultItem[]
): Promise<void> {
  const resultMap = new Map<string, PushResultItem>();
  for (const r of results) {
    resultMap.set(r.client_ref_id, r);
  }

  const allDrained = await readDrained();
  const thisBatchDrained: number[] = [];
  const otherDrained: number[] = [];

  for (const seq of allDrained) {
    const op = await getItem<SyncOp>(opKey(seq));
    // R1.x.2 修复：必须用 ack_batch_key（drainBatch 时写入 = batch[0].idempotency_key）
    //   而非 op.idempotency_key（每个 op 独有 · 仅与 batch[0] 匹配 · 漏掉同批次其他 op）
    if (op && op.ack_batch_key === batchKey) {
      thisBatchDrained.push(seq);
    } else {
      otherDrained.push(seq);
    }
  }

  const conflictDrained: number[] = []; // 累积所有 conflict seq

  for (const seq of thisBatchDrained) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) continue;

    const result = resultMap.get(op.client_ref_id);

    if (!result) {
      // 网络级失败 → 立即重试
      const count = await incrementRetry(op.client_ref_id);
      op.retries = count;
      op.next_retry_at = Date.now();
      await setItem(opKey(seq), op);
      const newIdx = await readIndex();
      if (!newIdx.includes(seq)) newIdx.push(seq);
      await writeIndex(newIdx);
      conflictDrained.push(seq); // 网络失败也进 drained（供 drainBatch recover）
    } else if (result.status === 'ok') {
      await removeItem(opKey(seq));
    } else if (result.status === 'conflict') {
      // conflict → 立即可重试（recover 清 drained 后，conflict seq 靠 index 被下次 drainBatch 取出）
      // ⚠️ next_retry_at 不改：保留 enqueue 时 set 的旧值（past = 通过 next_retry_at > now 过滤）
      // ⚠️ 不走 handleRetry 指数退避（conflict 在 R1 无 mergeIntoConflictQueue UI）
      const count = await incrementRetry(op.client_ref_id);
      op.retries = count;
      await setItem(opKey(seq), op);
      const newIdx = await readIndex();
      if (!newIdx.includes(seq)) newIdx.push(seq);
      await writeIndex(newIdx);
      conflictDrained.push(seq); // 累积 conflict seq 到 drained（供 drainBatch recover）
    } else {
      const code = result.error?.code;
      if (code === 'NOT_FOUND' || code === 'PERMISSION_DENIED') {
        await removeItem(opKey(seq));
      } else {
        const count = await incrementRetry(op.client_ref_id);
        op.retries = count;
        op.next_retry_at = Date.now();
        await setItem(opKey(seq), op);
        const newIdx = await readIndex();
        if (!newIdx.includes(seq)) newIdx.push(seq);
        await writeIndex(newIdx);
      }
    }
  }

// 写 drained：otherDrained（非本批）+ conflictDrained
  await writeDrained([...otherDrained, ...conflictDrained]);
}

/**
 * 标记本批次整体失败（POST /sync/push 网络/超时/HTTP 异常 · 没有 results 可消费）
 *
 * 设计（R1.x.2 修复 BUG-COSTRA-150-D）：
 *   - 与 ackResults 互斥：服务端有响应（含部分 conflict/rejected）→ ackResults · 完全无响应 → ackBatchFailure
 *   - 从 drained 取出本批次所有 seq · retries 递增 · 复原到 index · next_retry_at = now（立即可重试）
 *   - 不走指数退避（R1 决定 · 与 ackResults conflict 路径保持一致）
 *
 * 不变量保证：调用结束后 · 本批次 seq 必从 drained 中清除（消除 BUG-COSTRA-150-D 死锁）
 *
 * @param batchKey 批次 idempotency_key
 * @returns 复原的 op 数（用于上层 telemetry）
 */
export async function ackBatchFailure(batchKey: string): Promise<number> {
  const allDrained = await readDrained();
  const thisBatchSeqs: number[] = [];
  const otherDrained: number[] = [];

  for (const seq of allDrained) {
    const op = await getItem<SyncOp>(opKey(seq));
    // 用 ack_batch_key（drainBatch 时写入）而非 idempotency_key（仅 batch[0] 匹配）
    if (op && op.ack_batch_key === batchKey) {
      thisBatchSeqs.push(seq);
    } else {
      otherDrained.push(seq);
    }
  }

  // 先清 drained · 保证不变量（即使后续步骤异常 · drained 也已干净）
  await writeDrained(otherDrained);

  if (thisBatchSeqs.length === 0) return 0;

  const newIdx = await readIndex();
  const now = Date.now();
  for (const seq of thisBatchSeqs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) continue;
    op.retries = await incrementRetry(op.client_ref_id);
    op.next_retry_at = now; // 立即可重试
    await setItem(opKey(seq), op);
    if (!newIdx.includes(seq)) newIdx.push(seq);
  }
  await writeIndex(newIdx);

  return thisBatchSeqs.length;
}

export async function size(): Promise<number> {
  const idx = await readIndex();
  return idx.length;
}

export async function __peek(): Promise<SyncOp[]> {
  const idx = await readIndex();
  const ops: SyncOp[] = [];
  for (const seq of idx) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op) ops.push(op);
  }
  return ops;
}

export async function __clear(): Promise<void> {
  const allSeqs = new Set<number>();
  for (const s of await readIndex()) allSeqs.add(s);
  for (const s of await readDrained()) allSeqs.add(s);
  for (const seq of allSeqs) {
    await removeItem(opKey(seq));
  }
  await writeIndex([]);
  await writeDrained([]);
  await setItem(RETRIES_KEY, {});
  await removeItem('conflict:__queue');
}
