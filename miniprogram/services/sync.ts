// services/sync.ts · 增量同步（push + pull）
// 修复: COSTRA-228 数据丢失系列 Bug
//   - Bug G: pushDelta 发送前从 storage 刷新 base_version
//   - Bug D: 409 走 ackBatchFailure 保守重试
//   - Bug F: wireOps 只发协议字段（不含 retries 等内部字段）
// migration 0004: 消费 sync pull 的 categories_revision 字段，触发分类强刷
//
// L13（sync/pull 分页收敛 · docs/design/sync-pull-pagination-design.md）：
//   - syncPull 由"单轮"改为"分页循环"（C1 · limit 500 · 截断续拉 · epoch 前置比对）
//   - E1 epoch：批量写入检测 + 全量重拉（§4.2）
//   - 批量落盘走 applyServerEntriesBatch（C2 · 废除 entry:__index）
//   - maybeRefreshCategoriesByRevision 仅收敛轮消费（§4.3）
//
// logout 竞态：跨越 logout 边界的 in-flight response 不再由本文件拦截。
//   已由 storage.ts 的写屏障（blockWrites/unblockWrites）在 setItem 出口统一兜底。

import { request, ApiError } from './request';
import { logger } from '../utils/logger';
import {
  getWatermark,
  setWatermark,
  setWatermarkStrict,
  applyServerEntriesBatch,
  readLedgerEpochs,
  writeLedgerEpochs,
  getEntry,
  type LedgerEpochs,
} from './db';
import {
  drainBatch,
  ackResultsBySeq,
  ackBatchFailure,
  listPendingEntryRefs,
  PushResultItem,
  SyncOp,
} from './outbox';
import {
  getCachedSystemCategoriesSignature,
  refreshCategories,
  warmUpMemoryCache,
} from './categoryService';
import { applyLedgerBalanceFromSync } from './ledgerBalanceApi';
import { __isWriteBlocked } from './storage';

export type Entity = 'entry' | 'category' | 'budget';

export interface SyncPullResponse {
  watermark: number;
  has_more?: boolean;
  categories_revision?: string;
  changes: {
    entries?: unknown[];
    categories?: unknown[];
    budgets?: unknown[];
    ledgers?: unknown[];
  };
}

/**
 * syncPull 分页循环结果（L13 §4.3）
 */
export interface SyncPullOutcome {
  /** 最终落盘的 watermark */
  watermark: number;
  /** 本次实际新增/更新的 entry 条数（C2 applied 汇总，非拉回条数） */
  pulled: number;
  /** 实际发出的请求轮数（含 epoch 重置轮） */
  pages: number;
  /** 达到 MAX_PULL_PAGES 截断，仍有剩余（已安排续拉） */
  hasMore: boolean;
  /** 本次是否发生了 epoch 重置（全量重拉） */
  epochReset: boolean;
}

// ─── L13 常量 ─────────────────────────────────────────────────────────────────

const PULL_LIMIT = 500;          // 协议上限 · 5,000 条 → 10 轮
const MAX_PULL_PAGES = 40;       // 20,000 条/次 · 超出截断并 300ms 续拉

/** 让出逻辑层（setData 派发、用户事件回调）· 小程序逻辑层与渲染层分线程 */
async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * 从响应 ledgers[] 提取 { [ledgerId]: sync_epoch }。
 * 缺失值归一化为 0（§4.2）：服务端列 DEFAULT 0；灰度期旧服务端不返回 sync_epoch，
 *   `?? 0` 后与服务端上线后返回的 0 天然一致，避免升级风暴的第二个入口。
 */
function extractEpochs(ledgers: unknown[] | undefined): LedgerEpochs {
  const out: LedgerEpochs = {};
  for (const raw of ledgers || []) {
    const l = raw as { id?: string; sync_epoch?: number };
    if (l && typeof l.id === 'string') {
      out[l.id] = typeof l.sync_epoch === 'number' ? l.sync_epoch : 0;
    }
  }
  return out;
}

/**
 * epoch 比对：key 集合不同或任一值不同 → diff（§4.2 比对语义）。
 * 本地有 ledgerId 而响应缺失（账本软删/重建导致 id 变更）也视为 diff → 全量重拉（防御性兜底）。
 *
 * ⚠️ 前置条件：调用方必须先排除"本轮一个 ledger 都没下发"的情况（见 syncPull）。
 *   "服务端本轮没返回 ledgers" ≠ "账本消失"，交给本函数会误判 diff 并触发无意义重拉。
 */
function anyEpochDiff(local: LedgerEpochs, server: LedgerEpochs): boolean {
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  for (const k of keys) {
    if ((local[k] ?? -1) !== (server[k] ?? -1)) return true;
  }
  return false;
}

/**
 * 检查 categories_revision 是否变化，若变化则后台强刷分类列表。
 * fire-and-forget · 不阻塞 sync pull 主流程。仅在收敛轮（has_more=false）调用（L13 §4.3）。
 *
 * 双端签名规范见：docs/design/categories-restructure-spec.md §4.2
 */
function maybeRefreshCategoriesByRevision(familyId: string, serverRevision: string | undefined): void {
  if (!serverRevision || !familyId) return;
  const localSig = getCachedSystemCategoriesSignature();
  if (localSig && localSig === serverRevision) return; // 系统分类一致 · 无需刷新
  logger.debug('sync:revision', `categories_revision changed (local="${localSig.slice(0, 16)}…" → server="${serverRevision.slice(0, 16)}…") · forcing refresh`);
  refreshCategories(familyId)
    .then(items => {
      warmUpMemoryCache(familyId, items);
    })
    .catch(err => {
      logger.warn('sync:revision', 'refreshCategories failed', err);
    });
}

/**
 * 拉增量（家庭维度）· L13 分页循环 + epoch 前置比对/重置。
 *
 * 循环封闭在本函数内：不逐轮 emit SYNC_DONE，由 syncOnce 收敛后广播一次（§4.3）。
 */
export async function syncPull(familyId: string): Promise<SyncPullOutcome> {
  let since = await getWatermark(familyId);
  let applied = 0;
  let pages = 0;
  let truncated = false;
  let epochReset = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    logger.debug('sync:pull', `requesting · family=${familyId} since=${since} limit=${PULL_LIMIT} page=${pages}`);
    const resp = await request<SyncPullResponse>({
      method: 'GET',
      path: '/sync/pull',
      query: { family_id: familyId, since, limit: PULL_LIMIT },
    });

    if (!resp || typeof resp.watermark !== 'number') {
      logger.warn('sync:pull', `⚠️ invalid response · watermark=${resp?.watermark} type=${typeof resp?.watermark}`);
      break;
    }

    const serverLedgers = resp.changes?.ledgers;

    // ── watermark 合法性前置校验（§4.3）─────────────────────────────────────
    //   放在 epoch 环节之前：非法/回退的响应不应驱动任何本地状态变更（含 epoch 重置）。
    if (!Number.isInteger(resp.watermark) || resp.watermark < since) {
      logger.warn('sync:pull', `invalid watermark regression · watermark=${resp.watermark} since=${since} · abort loop`);
      break; // 不应用 entries，等待下轮 sync
    }
    if (resp.has_more && resp.watermark === since) {
      logger.error('sync:pull', 'has_more without watermark progress · abort loop');
      break; // 防服务端异常导致紧密死循环
    }

    // ── 资产不断供：每轮 ledgers 覆盖写缓存（§4.3/§4.7）─────────────────────
    //   必须在 epoch 判定**之前**：epoch 重置轮会 continue，放在其后会导致持续批量写入
    //   期间（epoch 连轮变化直到截断）资产整轮不更新。balance 是服务端权威值、与
    //   watermark 无关，任何一轮下发都可安全覆盖写。
    for (const wire of serverLedgers || []) {
      await applyLedgerBalanceFromSync(wire as { id: string; balance_cents?: number; balance_baseline_seq?: number; balance_version?: number });
    }

    // ── E1 epoch 前置比对（§4.2）──────────────────────────────────────────
    const serverEpochs = extractEpochs(serverLedgers);
    const localEpochs = await readLedgerEpochs(familyId);
    if (Object.keys(serverEpochs).length === 0) {
      // 本轮未下发任何 ledger（服务端 findFirstByFamilyId 返回 null 的自愈窗口等）。
      //   "没下发" ≠ "账本消失"：若按 key 集合语义判 diff，会先清零重拉一次、把 {} 记为
      //   本地 epoch，账本自愈后再判一次 diff 再重拉。两次全量重拉纯属自伤。
      //   ⇒ 视为"本轮无 epoch 信息"：既不比对也不写入，等下轮带 ledger 的响应再追踪。
      logger.debug('sync:pull', 'no ledgers in response · skip epoch compare this round');
    } else if (localEpochs === null) {
      // 首登/升级：采信当前值写入，不触发重置（避免升级风暴）
      await writeLedgerEpochs(familyId, serverEpochs);
    } else if (anyEpochDiff(localEpochs, serverEpochs)) {
      // "上次同步后发生过批量写入" → 清零 watermark 全量重拉。
      // ⚠️ 写序不变量（§4.2）：必须先 setWatermarkStrict(0) 并确认成功，才能写 epoch。
      //   反序或清零失败仍写 epoch，会落到「epoch 新 + watermark 旧高值」的真丢数据状态。
      try {
        await setWatermarkStrict(familyId, 0);
      } catch (err) {
        logger.warn('sync:pull', 'epoch reset: strict watermark clear failed · abort this round, keep old epoch', err);
        break; // 本轮中止、不写 epoch；下轮 sync 仍判 diff 并重试，幂等无损
      }
      await writeLedgerEpochs(familyId, serverEpochs);
      since = 0;
      epochReset = true;
      logger.info('sync:pull', 'epoch diff detected · watermark cleared → full re-pull');
      // 重置轮同样计入请求预算并受截断约束 + 让出：持续批量写入期间（epoch 连续变化）
      // 不计数会让循环脱离 MAX_PULL_PAGES 保护，退化为紧密请求循环；截断后由
      // pull-continue 续拉兜底，幂等无损。
      pages++;
      if (pages >= MAX_PULL_PAGES) {
        truncated = true;
        break;
      }
      await yieldToEventLoop();
      continue; // 本轮 entries 不应用，直接从 0 重拉
    }

    // ── 应用 entries（C2 批量落盘）────────────────────────────────────────
    const wires = resp.changes?.entries || [];
    if (wires.length > 0) {
      const pendingRefs = await listPendingEntryRefs();
      const result = await applyServerEntriesBatch(wires, { pendingRefs });
      applied += result.applied;
    }

    // ── watermark 逐轮落盘（中断可续）──────────────────────────────────────
    await setWatermark(familyId, resp.watermark);
    since = resp.watermark;
    pages++;

    if (!resp.has_more) {
      // 仅收敛轮消费 categories_revision（§4.3）
      maybeRefreshCategoriesByRevision(familyId, resp.categories_revision);
      break;
    }

    if (pages >= MAX_PULL_PAGES) {
      truncated = true;
      break;
    }

    await yieldToEventLoop(); // 让出逻辑层

    if (__isWriteBlocked()) {
      // logout 写屏障已开：storage 会吞写入，主动退出省请求
      logger.debug('sync:pull', 'write barrier open · abort loop');
      break;
    }
  }

  return {
    watermark: since,
    pulled: applied,
    pages,
    hasMore: truncated,
    epochReset,
  };
}

/**
 * 从 storage 刷新 op 的 base_version（发送前调用）
 * 解决: enqueue 时 version 为 null，但发送时 syncPull 可能已回填了 version
 */
async function refreshBaseVersion(op: SyncOp): Promise<number | null> {
  if (op.op === 'create') return null; // create 不需要 base_version
  const entry = await getEntry(op.client_ref_id);
  const version = entry?.version ?? op.base_version;
  logger.debug('sync:refreshBaseVersion', `ref=${op.client_ref_id} entry_found=${!!entry} entry_version=${entry?.version} op_base_version=${op.base_version} → result=${version}`);
  return version;
}

/**
 * 构造只含协议字段的 wire ops（不发送 retries/seq/idem_key 等内部字段）
 * 同时从 storage 刷新 base_version
 */
async function buildWireOps(ops: SyncOp[]): Promise<Array<{
  op: string;
  entity: string;
  client_ref_id: string;
  base_version: number | null;
  payload: Record<string, unknown>;
}>> {
  const wireOps = [];
  for (const syncOp of ops) {
    const baseVersion = await refreshBaseVersion(syncOp);
    wireOps.push({
      op: syncOp.op,
      entity: syncOp.entity,
      client_ref_id: syncOp.client_ref_id,
      base_version: baseVersion,
      payload: { ...syncOp.payload },
    });
  }
  return wireOps;
}

/**
 * 推本地变更（outbox 重放）
 */
export async function pushDelta(): Promise<{
  pushed: number;
  conflicts: number;
  rejected: number;
  failed: number;
}> {
  const batch = await drainBatch(200);
  if (!batch) return { pushed: 0, conflicts: 0, rejected: 0, failed: 0 };

  const { batch: ops, batchKey } = batch;

  // 发送前从 storage 刷新 base_version + 只发协议字段
  const wireOps = await buildWireOps(ops);

  logger.info('sync:pushDelta', `sending · batchKey=${batchKey} ops_count=${ops.length}`);
  for (let i = 0; i < wireOps.length; i++) {
    const w = wireOps[i];
    const o = ops[i];
    logger.info('sync:pushDelta', `  → ${w.op} entity=${w.entity} ref=${w.client_ref_id} base_version=${w.base_version} retries=${o.retries} seq=${o.seq}`, w.payload);
  }

  try {
    const resp = await request<{ results: PushResultItem[] }>({
      method: 'POST',
      path: '/sync/push',
      body: { ops: wireOps },
      idempotencyKey: batchKey,
    });

    const results = resp?.results || [];

    // 按数组下标配对 (seq, result)
    const seqResultPairs = ops.map((op, i) => ({
      seq: op.seq,
      result: results[i] || { client_ref_id: op.client_ref_id, status: 'rejected' as const, error: { code: 'NO_RESULT', message: 'missing result from server' } },
    }));

    await ackResultsBySeq(batchKey, seqResultPairs);

    let pushed = 0, conflicts = 0, rejected = 0;
    for (const r of results) {
      if (r.status === 'ok') pushed++;
      else if (r.status === 'conflict') conflicts++;
      else rejected++;
    }
    logger.info('sync:pushDelta', `done · pushed=${pushed} conflicts=${conflicts} rejected=${rejected}`);
    return { pushed, conflicts, rejected, failed: 0 };
  } catch (err: unknown) {
    const status = (err as ApiError)?.status;
    const errMsg = (err as ApiError)?.message || 'unknown';

    // 409 或其他错误：都走 ackBatchFailure 保守重试
    logger.warn('sync:pushDelta', `⚠️ HTTP ${status || 'network'} error · batchKey=${batchKey} msg="${errMsg}" → ackBatchFailure`);
    const failed = await ackBatchFailure(batchKey);
    logger.warn('sync:pushDelta', `failure recovered=${failed} ops back to index`);
    return { pushed: 0, conflicts: 0, rejected: 0, failed };
  }
}
