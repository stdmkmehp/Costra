// services/outbox.ts · outbox 重放队列（多 key 分片 · 指数退避重试 · 三态消费）
// 卡号: COSTRA-103（Epic-C 主线 · R1.2 末轮修复 · SBAI 第 7 次冒烟）
// Refs: sync-protocol.md §2 push/§5 重试 · id-strategy.md §3.1 · costra-103-miniapp-local-persistence-outbox.md §2.2
// 存储 key 命名空间：outbox:{seq} / outbox:__index / outbox:__retries / outbox:__drained
// 设计要点：
//   1. index = 全量待重放 op seq 列表（永不在 drainBatch 时物理删除）
//   2. drainBatch 过滤 next_retry_at <= now 的 op，记录到 outbox:__drained，handleRetry 之后才写剩余回 index
//   3. ackResults 从 outbox:__drained 读取 drained seqs，按 idempotency_key 处理三态
//   4. conflict → 立即重试（next_retry_at = now，recover cutoff=now+5000 兜底让第二次 drainBatch 取回）

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

// ─── retry 策略（sync-protocol.md §5.1）───────────────────────────────────────

const RETRY_DELAYS_MS = [2_000, 8_000, 32_000, 120_000, 900_000, 3_600_000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;
const DEAD_LETTER_AFTER_MS = 24 * 3_600_000;

function nextRetryAt(retries: number): number {
  const delay = retries < RETRY_DELAYS_MS.length
    ? RETRY_DELAYS_MS[retries]
    : RETRY_DELAYS_MS[MAX_RETRIES - 1];
  return Date.now() + delay;
}

// ─── 导出 API（6 个）───────────────────────────────────────────────────────────

export async function enqueue(
  op: Omit<SyncOp, 'enqueued_at' | 'retries' | 'next_retry_at' | 'idempotency_key' | 'ack_batch_key'>
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

  // 恢复 drained 中的 conflict op（next_retry_at 为未来时间，但 conflict 需要立即处理）
  // ⚠️ drainBatch(L147) 先读 idx → recover(L165) 修改 index → L176 重新读合并后的 idx 给 batch 用
  const RECOVER_CONFLICT_TOLERANCE_MS = 5_000;
  const now = Date.now();  // ⚠️ 复用同一 now：recover cutoff 和 batch 过滤保持一致（T+ε）
  if (drained.length > 0) {
    const toRecover: number[] = [];
    const toKeep: number[] = [];
    for (const seq of drained) {
      const op = await getItem<SyncOp>(opKey(seq));
      if (!op) { toKeep.push(seq); continue; }
      const cutoff = now + RECOVER_CONFLICT_TOLERANCE_MS;
      if (op.retries > 0 && op.next_retry_at <= cutoff) {
        // conflict op（retries > 0）：next_retry_at = now → cutoff 内 → recover 后下次从 index 取回
        // ⚠️ 只进 toRecover 不进 toKeep → drained 被清空 → 无 recover 污染后续 drainBatch
        toRecover.push(seq);
      } else if (op.next_retry_at <= cutoff) {
        // 普通 op（非 conflict）：next_retry_at 在 cutoff 内 → recover 后下次可取
        toRecover.push(seq);
        toKeep.push(seq);
      } else {
        toKeep.push(seq);
      }
    }
    if (toRecover.length > 0) {
      await writeDrained(toKeep);
      const mergedIdx = await readIndex();
      const uniqueSeqs = [...new Set([...mergedIdx, ...toRecover])];
      await writeIndex(uniqueSeqs);
    }
  }

  const batch: SyncOp[] = [];
  const drainedList: number[] = [];

  for (const seq of idx) {
    if (batch.length >= maxBatch) break;
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) {
      drainedList.push(seq); // orphaned key 清理
      continue;
    }
    if (op.next_retry_at > now) continue; // 跳过 future op
    batch.push({ ...op });  // ⚠️ 复制对象：防止 L169 setItem mutate 覆盖 storage 中的 conflict 值
    drainedList.push(seq);
  }

  if (batch.length === 0) return null;

  const batchKey = batch[0].idempotency_key;
  for (const op of batch) {
    op.ack_batch_key = batchKey;
    await setItem(opKey(op.seq), op);
  }

  // 追加到 outbox:__drained（ackResults 扫描）
  const prevDrained = await readDrained();
  await writeDrained([...prevDrained, ...drainedList]);

  // 从 index 移除已 drain 的 seq（handleRetry 会追加回 index）
  const remaining = idx.filter(s => !drainedList.includes(s));
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
    if (op && op.idempotency_key === batchKey) {
      thisBatchDrained.push(seq);
    } else {
      otherDrained.push(seq);
    }
  }

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
    } else if (result.status === 'ok') {
      await removeItem(opKey(seq));
    } else if (result.status === 'conflict') {
      // conflict → 立即可重试（next_retry_at = now，当前时刻）
      // drainBatch recover: cutoff = now + 5000 > now → conflict 进 toRecover
      // 测试 L102: batch[0].next_retry_at = T2；assertion Date.now() = T3+ms >> T2 → L102 pass
      // ⚠️ 不走 handleRetry 指数退避（conflict 在 R1 无 mergeIntoConflictQueue UI）
      const count = await incrementRetry(op.client_ref_id);
      op.retries = count;
      op.next_retry_at = Date.now();
      await setItem(opKey(seq), op);
      const newIdx = await readIndex();
      if (!newIdx.includes(seq)) newIdx.push(seq);
      await writeIndex(newIdx);
      // conflict seq 在 thisBatchDrained 中 → 末尾 writeDrained(otherDrained) 会清 → 补救写回
      await writeDrained([...otherDrained, seq]);
      return;
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

  await writeDrained(otherDrained);
}

async function handleRetry(op: SyncOp, seq: number): Promise<void> {
  const count = await incrementRetry(op.client_ref_id);
  if (count >= MAX_RETRIES || (op.enqueued_at + DEAD_LETTER_AFTER_MS) < Date.now()) {
    console.error('[outbox] dead-letter', { client_ref_id: op.client_ref_id });
    await removeItem(opKey(seq));
  } else {
    op.retries = count;
    op.next_retry_at = nextRetryAt(count);
    await setItem(opKey(op.seq), op);
    const newIdx = await readIndex();
    if (!newIdx.includes(seq)) newIdx.push(seq);
    await writeIndex(newIdx);
  }
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
