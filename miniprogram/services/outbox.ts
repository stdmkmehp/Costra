// services/outbox.ts · outbox 重放队列
// 修复: COSTRA-228 数据丢失系列 Bug（G/F/D/E + op 合并）
//
// 设计要点：
//   1. enqueue 时做 op 合并（create+update → merge into create · update+update → merge payload）
//   2. drainBatch 取 op 时不冻结 base_version（由 pushDelta 发送前从 storage 刷新）
//   3. rejected/conflict/failure 后重新生成 idempotency_key（防止 409）
//   4. ackResultsBySeq 按数组下标匹配 results（不再用 client_ref_id Map）
//   5. 409 走 ackBatchFailure 保守重试（不再无条件清除）
//   6. index = 待 drain 的 seq 列表 · drained = 已 drain 未 ack 的 seq

import { getItem, setItem, removeItem } from './storage';
import { logger } from '../utils/logger';
import { eventBus, EventNames } from './eventBus';
import { getEntry, putEntry } from './db';

export type SyncOp = {
  op: 'create' | 'update' | 'delete';
  entity: 'entry' | 'category' | 'budget';
  client_ref_id: string;
  base_version: number | null;
  payload: Record<string, unknown>;
  enqueued_at: number;
  seq: number;
  retries: number;
  next_retry_at: number;
  idempotency_key: string;
  ack_batch_key?: string;
};

/** push 结果单条 */
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

// ─── seq 生成器 ──────────────────────────────────────────────────────────────

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

function newIdemKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── retry 上限 ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const DEAD_LETTER_KEY = 'outbox:__dead_letter';

/**
 * 退避延迟策略：retries 越多，等待越久，让持续失败的 op 不阻塞后续正常 op 的 drain。
 * 范围: 3s ~ 20s · 线性步进 = (20000 - 3000) / (MAX_RETRIES - 1) ≈ 4250ms
 * 公式: 3000 + (retries - 1) * step，封顶 20000ms
 *   retries=1 → 3s · retries=2 → 7.25s · retries=3 → 11.5s · retries=4 → 15.75s · retries=5 → 20s
 * drainBatch 中 `if (op.next_retry_at > now) continue;` 会跳过未到时的 op，
 * 从而让同批次中时间到的其他 op 正常发送，解决"一条记账一直失败阻塞所有同步"的问题。
 */
const BACKOFF_MIN_MS = 3000;
const BACKOFF_MAX_MS = 20_000;
const BACKOFF_STEP_MS = (BACKOFF_MAX_MS - BACKOFF_MIN_MS) / Math.max(MAX_RETRIES - 1, 1);

export function computeRetryBackoff(retries: number): number {
  return Math.min(BACKOFF_MIN_MS + (retries - 1) * BACKOFF_STEP_MS, BACKOFF_MAX_MS);
}

async function readDeadLetter(): Promise<SyncOp[]> {
  return (await getItem<SyncOp[]>(DEAD_LETTER_KEY)) || [];
}

async function moveToDeadLetter(op: SyncOp, seq: number): Promise<void> {
  logger.error('outbox:dead-letter', `✗ op=${op.op} ref=${op.client_ref_id} base_version=${op.base_version} retries=${op.retries} seq=${seq} → DATA LOSS RISK`, op.payload);
  const dl = await readDeadLetter();
  dl.push(op);
  await setItem(DEAD_LETTER_KEY, dl);
  await removeItem(opKey(seq));
}

// ─── op 合并：查找 index 中同 client_ref_id 的 pending op ─────────────────────

async function findPendingOp(clientRefId: string): Promise<SyncOp | null> {
  const idx = await readIndex();
  for (const seq of idx) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op && op.client_ref_id === clientRefId) {
      return op;
    }
  }
  return null;
}

async function findInFlightOp(clientRefId: string): Promise<SyncOp | null> {
  const seqs = [...await readIndex(), ...await readDrained()];
  for (const seq of seqs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op && op.entity === 'entry' && op.client_ref_id === clientRefId) {
      return op;
    }
  }
  return null;
}

// ─── 导出 API ─────────────────────────────────────────────────────────────────

/** 查询 entry 是否存在待同步 / 已 drain 未 ack 的本地变更。用于远端补水 merge guard。 */
export async function hasPendingEntryOp(clientRefId: string): Promise<boolean> {
  return !!(await findInFlightOp(clientRefId));
}

/**
 * 一次性读出所有存在 pending / in-flight（待 drain + 已 drain 未 ack）op 的 entry client_ref_id 集合。
 *
 * 供 sync pull 批量落盘（L13 §4.4 ③）的相等档判定使用：`serverVer === localVer` 时，
 * 若本地该 ref 有未上行的编辑 / 软删则跳过覆盖（保护本地改动），否则按内容等价比较决定是否覆盖。
 *
 * ⚠️ 性能纪律（§4.4 实现纪律）：批开始**一次性**构建成 Set，禁止逐条调 `hasPendingEntryOp`——
 *   后者内部是 O(index) 遍历，逐条调会把批量落盘退化成 O(n×pending) 次 storage 读。
 *   本函数只遍历 index + drained 各一遍（O(pending)，pending 常态 <10）。
 *
 * ⚠️ **有意不含 `outbox:__dead_letter`**（L13 §4.4 ③ 决策 29 · 不是遗漏，勿"顺手对齐"）：
 *   注意与 `pendingCount()` 口径不同——后者含 dead-letter，因为它服务的是 logout 前的
 *   "有未上行数据"风险提示，宁可多报。而本函数服务的是"是否阻止服务端同 version 覆盖"，
 *   两者结论必须分开取：
 *     - dead-letter 是**终态**：无自动重试、无重投入口、只有 logout / storage 版本迁移会清。
 *       算作 pending 就等于**永久**跳过相等档 → 该行与服务端长期分叉且无收敛机制，
 *       §3.6 的 canonical 字段自愈（category_id 降级 / shared_type 填充）对它永久失效。
 *     - 且这种"保护"是半截的：服务端那行 version 一旦 +1，`serverVer > localVer` 分支
 *       照样覆盖 ⇒ 换来的只是把覆盖时刻推迟到不确定的将来，不是真的保住用户改动。
 *   ⇒ 本模型以服务端为唯一真源：改动没送达 = 没发生，让 pull 覆盖并收敛。
 *   用户改动被静默吞掉的根因是 **dead-letter 本身没有可见性与重投能力**，属独立课题
 *   （见 docs/follow-up/sync-p2-improvements.md L14），不在此处打补丁掩盖。
 */
export async function listPendingEntryRefs(): Promise<Set<string>> {
  const seqs = [...await readIndex(), ...await readDrained()];
  const refs = new Set<string>();
  for (const seq of seqs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op && op.entity === 'entry') refs.add(op.client_ref_id);
  }
  return refs;
}


/**
 * 入队操作，支持 op 合并：
 *   - create + update → merge payload into create
 *   - create + delete → remove create (noop)
 *   - update + update → merge payload, keep first base_version
 *   - update + delete → replace with delete, keep first base_version
 */
export async function enqueue(
  op: Omit<SyncOp, 'seq' | 'enqueued_at' | 'retries' | 'next_retry_at' | 'idempotency_key' | 'ack_batch_key'>
): Promise<void> {
  // ─── op 合并检查 ────────────────────────────────────────────────────────
  if (op.op === 'update' || op.op === 'delete') {
    const pending = await findPendingOp(op.client_ref_id);
    if (pending) {
      if (pending.op === 'create' && op.op === 'update') {
        // create + update → merge update payload into create payload
        Object.assign(pending.payload, op.payload);
        pending.idempotency_key = newIdemKey(); // 合并后换新 key
        await setItem(opKey(pending.seq), pending);
        logger.debug('outbox:enqueue', `MERGED update into pending create · ref=${op.client_ref_id} seq=${pending.seq}`);
        eventBus.emit(EventNames.OUTBOX_ENQUEUED);
        return;
      }
      if (pending.op === 'create' && op.op === 'delete') {
        // create + delete → 两者抵消，删除 create op
        await removeItem(opKey(pending.seq));
        const idx = await readIndex();
        await writeIndex(idx.filter(s => s !== pending.seq));
        logger.debug('outbox:enqueue', `CANCELLED create+delete · ref=${op.client_ref_id} seq=${pending.seq} removed`);
        // 不 emit：抵消操作不需要触发同步
        return;
      }
      if (pending.op === 'update' && op.op === 'update') {
        // update + update → merge payload, keep first base_version
        Object.assign(pending.payload, op.payload);
        pending.idempotency_key = newIdemKey();
        await setItem(opKey(pending.seq), pending);
        logger.debug('outbox:enqueue', `MERGED update into pending update · ref=${op.client_ref_id} seq=${pending.seq}`);
        eventBus.emit(EventNames.OUTBOX_ENQUEUED);
        return;
      }
      if (pending.op === 'update' && op.op === 'delete') {
        // update + delete → replace with delete, keep base_version
        pending.op = 'delete';
        pending.payload = {};
        pending.idempotency_key = newIdemKey();
        await setItem(opKey(pending.seq), pending);
        logger.debug('outbox:enqueue', `REPLACED update with delete · ref=${op.client_ref_id} seq=${pending.seq}`);
        eventBus.emit(EventNames.OUTBOX_ENQUEUED);
        return;
      }
    }
  }

  // ─── 正常入队 ────────────────────────────────────────────────────────────
  const now = Date.now();
  const seq = newSeq();
  const idempotencyKey = newIdemKey();

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

  logger.info('outbox:enqueue', `op=${op.op} entity=${op.entity} ref=${op.client_ref_id} base_version=${op.base_version} seq=${seq} idem=${idempotencyKey} index_size=${uniqueSeqs.length}`, op.payload);
  eventBus.emit(EventNames.OUTBOX_ENQUEUED);
}

/**
 * 取出一批可重放的 op（drain）
 */
export async function drainBatch(
  maxBatch = 200
): Promise<{ batch: SyncOp[]; batchKey: string } | null> {
  const idx = await readIndex();
  const drained = await readDrained();
  const batch: SyncOp[] = [];
  const drainedList: number[] = [];

  const now = Date.now();
  let pendingDrained = [...drained];
  let currentIdx = [...idx];

  // ─── 防御性 recover 分支：drained 残留 = 异常中断遗留 ──────────────────
  if (drained.length > 0) {
    logger.warn('outbox:drainBatch', `⚠️ RECOVER · drained residue: count=${drained.length} seqs=[${drained.join(',')}]`);
    for (const seq of drained) {
      const op = await getItem<SyncOp>(opKey(seq));
      if (!op) {
        pendingDrained = pendingDrained.filter(s => s !== seq);
        continue;
      }
      logger.debug('outbox:drainBatch', `recover · seq=${seq} op=${op.op} ref=${op.client_ref_id} retries=${op.retries}`);
      pendingDrained = pendingDrained.filter(s => s !== seq);
      currentIdx = currentIdx.filter(s => s !== seq);
      op.next_retry_at = now + 1;
      batch.push({ ...op });
    }
    if (pendingDrained.length !== drained.length) {
      await writeDrained(pendingDrained);
    }
  }

  // ─── 主循环：从 index 取可发送的 ops ──────────────────────────────────
  for (const seq of currentIdx) {
    if (batch.length >= maxBatch) break;
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) {
      drainedList.push(seq);
      continue;
    }
    if (op.next_retry_at > now) continue;
    batch.push({ ...op });
    drainedList.push(seq);
  }

  if (batch.length === 0) return null;

  // 生成新的 batchKey（每次 drain 都用新 key，避免幂等键复用）
  const batchKey = newIdemKey();
  for (const op of batch) {
    op.ack_batch_key = batchKey;
    await setItem(opKey(op.seq), op);
  }

  const prevDrained = await readDrained();
  await writeDrained([...prevDrained, ...drainedList]);
  const remaining = currentIdx.filter(s => !drainedList.includes(s));
  await writeIndex(remaining);

  logger.debug('outbox:drainBatch', `drained · batchKey=${batchKey} count=${batch.length} ops=[${batch.map(o => `${o.op}:${o.client_ref_id}:v${o.base_version}`).join(', ')}]`);
  return { batch, batchKey };
}

/**
 * 消费 push 结果（按数组下标匹配，不再用 client_ref_id Map）
 * @param batchKey 批次 key
 * @param seqResultPairs 按下标配对的 (seq, result) 数组
 */
export async function ackResultsBySeq(
  batchKey: string,
  seqResultPairs: Array<{ seq: number; result: PushResultItem }>
): Promise<void> {
  logger.debug('outbox:ackResults', `batchKey=${batchKey} pairs=${seqResultPairs.length} statuses=[${seqResultPairs.map(p => `${p.result.status}`).join(',')}]`);

  // 清理本 batch 的 drained 记录
  const allDrained = await readDrained();
  const thisBatchSeqs = new Set(seqResultPairs.map(p => p.seq));
  const otherDrained = allDrained.filter(s => !thisBatchSeqs.has(s));

  for (const { seq, result } of seqResultPairs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) continue;

    if (result.status === 'ok') {
      logger.info('outbox:ackResults', `✓ OK · seq=${seq} op=${op.op} ref=${op.client_ref_id} server_id=${result.server_id} server_version=${result.server_version} → removed`);
      // 立即回写 server_id/version 到本地 entry（不等 pull 回填）
      if (result.server_id || result.server_version != null) {
        const entry = await getEntry(op.client_ref_id);
        if (entry) {
          if (result.server_id) entry.id = result.server_id;
          if (result.server_version != null) entry.version = result.server_version;
          await putEntry(entry);
          logger.info('outbox:ackResults', `✓ version written · ref=${op.client_ref_id} version=${entry.version}`);
        } else {
          logger.warn('outbox:ackResults', `⚠️ entry not found for version write · ref=${op.client_ref_id}`);
        }
      }
      await removeItem(opKey(seq));
    } else if (result.status === 'conflict') {
      // conflict → 重入 index 重试（下次 pushDelta 会从 storage 刷新 base_version）
      op.retries++;
      op.next_retry_at = Date.now() + computeRetryBackoff(op.retries);
      op.idempotency_key = newIdemKey(); // 换新 key 防 409
      await setItem(opKey(seq), op);
      const newIdx = await readIndex();
      if (!newIdx.includes(seq)) newIdx.push(seq);
      await writeIndex(newIdx);
      logger.warn('outbox:ackResults', `⚠️ CONFLICT · seq=${seq} op=${op.op} ref=${op.client_ref_id} base_version=${op.base_version} server_version=${result.server_version} retries=${op.retries} next_retry_in=${computeRetryBackoff(op.retries)}ms → re-index`);
    } else {
      // rejected
      const code = result.error?.code;
      if (code === 'NOT_FOUND' || code === 'PERMISSION_DENIED') {
        logger.warn('outbox:ackResults', `✗ REJECTED(${code}) · seq=${seq} op=${op.op} ref=${op.client_ref_id} → permanently removed`);
        await removeItem(opKey(seq));
      } else {
        // 可重试的 rejected（如 INVALID_ARGUMENT: base_version null → 下次刷新后可恢复）
        op.retries++;
        op.next_retry_at = Date.now() + computeRetryBackoff(op.retries);
        op.idempotency_key = newIdemKey(); // 换新 key 防 409
        await setItem(opKey(seq), op);
        const newIdx = await readIndex();
        if (!newIdx.includes(seq)) newIdx.push(seq);
        await writeIndex(newIdx);
        logger.warn('outbox:ackResults', `⚠️ REJECTED(${code}) · seq=${seq} op=${op.op} ref=${op.client_ref_id} base_version=${op.base_version} msg="${result.error?.message}" retries=${op.retries} next_retry_in=${computeRetryBackoff(op.retries)}ms → re-index`);
      }
    }
  }

  await writeDrained(otherDrained);
  logger.debug('outbox:ackResults', `done · remaining_drained=${otherDrained.length}`);
}

/**
 * 标记本批次整体失败 → 复原到 index 待重试
 */
export async function ackBatchFailure(batchKey: string): Promise<number> {
  const allDrained = await readDrained();
  const thisBatchSeqs: number[] = [];
  const otherDrained: number[] = [];

  for (const seq of allDrained) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op && op.ack_batch_key === batchKey) {
      thisBatchSeqs.push(seq);
    } else {
      otherDrained.push(seq);
    }
  }

  logger.warn('outbox:ackBatchFailure', `batchKey=${batchKey} thisBatch=${thisBatchSeqs.length} otherDrained=${otherDrained.length}`);
  await writeDrained(otherDrained);

  if (thisBatchSeqs.length === 0) return 0;

  const newIdx = await readIndex();
  const now = Date.now();
  let recovered = 0;
  for (const seq of thisBatchSeqs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) continue;
    op.retries++;
    if (op.retries >= MAX_RETRIES) {
      await moveToDeadLetter(op, seq);
      continue;
    }
    op.next_retry_at = now + computeRetryBackoff(op.retries);
    op.idempotency_key = newIdemKey(); // 换新 key 防 409
    await setItem(opKey(seq), op);
    if (!newIdx.includes(seq)) newIdx.push(seq);
    recovered++;
    logger.warn('outbox:ackBatchFailure', `↻ RECOVER · seq=${seq} op=${op.op} ref=${op.client_ref_id} retries=${op.retries} next_retry_in=${computeRetryBackoff(op.retries)}ms → re-index`);
  }
  await writeIndex(newIdx);
  return recovered;
}

// ─── 辅助 API ─────────────────────────────────────────────────────────────────

export async function size(): Promise<number> {
  const idx = await readIndex();
  return idx.length;
}

/** 获取 dead-letter 中的条目数（供 UI 展示告警） */
export async function deadLetterSize(): Promise<number> {
  const dl = await readDeadLetter();
  return dl.length;
}

/**
 * 未上行 op 计数（待 drain + 已 drain 未 ack + dead-letter）。
 * 供 logout 前风险提示：只读三个索引数组长度，不加载 op 本体。
 */
export async function pendingCount(): Promise<number> {
  const [idx, drained, dl] = await Promise.all([readIndex(), readDrained(), readDeadLetter()]);
  return idx.length + drained.length + dl.length;
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
  await removeItem('conflict:__queue');
}
