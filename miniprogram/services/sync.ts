// services/sync.ts · 增量同步（push + pull）
// 修复: COSTRA-228 数据丢失系列 Bug
//   - Bug G: pushDelta 发送前从 storage 刷新 base_version
//   - Bug D: 409 走 ackBatchFailure 保守重试
//   - Bug F: wireOps 只发协议字段（不含 retries 等内部字段）
// migration 0004: 消费 sync pull 的 categories_revision 字段，触发分类强刷

import { request, ApiError } from './request';
import { logger } from '../utils/logger';
import { getWatermark, setWatermark, applyServerChanges, getEntry } from './db';
import { drainBatch, ackResultsBySeq, ackBatchFailure, PushResultItem, SyncOp } from './outbox';
import {
  getCachedSystemCategoriesSignature,
  refreshCategories,
  warmUpMemoryCache,
} from './categoryService';
import { applyLedgerBalanceFromSync } from './ledgerBalanceApi';

export type Entity = 'entry' | 'category' | 'budget';

export interface SyncPullResponse {
  watermark: number;
  has_more?: boolean;
  /**
   * 系统分类签名（migration 0004 配套 · spec §4）。
   * 客户端比对此值与本地缓存签名，不一致则绕过 24h TTL 强刷分类列表，
   * 关闭"分类改动 24h 内客户端不可见"的窗口。
   */
  categories_revision?: string;
  changes: {
    entries?: unknown[];
    categories?: unknown[];
    budgets?: unknown[];
    ledgers?: unknown[];
  };
}

/**
 * 检查 categories_revision 是否变化，若变化则后台强刷分类列表。
 * fire-and-forget · 不阻塞 sync pull 主流程。
 *
 * 双端签名规范见：docs/design/categories-restructure-spec.md §4.2
 */
function maybeRefreshCategoriesByRevision(familyId: string, serverRevision: string | undefined): void {
  if (!serverRevision || !familyId) return;
  const localSig = getCachedSystemCategoriesSignature();
  if (localSig && localSig === serverRevision) return; // 系统分类一致 · 无需刷新
  // 不一致 · 后台拉新分类（绕过 24h TTL · refreshCategories 会写缓存 + warmUp 内存 +
  // 在签名变化时广播 CATEGORIES_LOADED 事件，明细页等据此重渲）
  logger.debug('sync:revision', `categories_revision changed (local="${localSig.slice(0, 16)}…" → server="${serverRevision.slice(0, 16)}…") · forcing refresh`);
  refreshCategories(familyId)
    .then(items => {
      // refreshCategories 内部已 warmUp，但显式补一次确保签名同步
      warmUpMemoryCache(familyId, items);
    })
    .catch(err => {
      logger.warn('sync:revision', 'refreshCategories failed', err);
    });
}

/**
 * 拉增量（家庭维度）
 */
export async function syncPull(
  familyId: string,
  opts?: { limit?: number }
): Promise<SyncPullResponse> {
  const since = await getWatermark(familyId);
  logger.debug('sync:pull', `requesting · family=${familyId} since=${since} limit=${opts?.limit ?? 200}`);

  const resp = await request<SyncPullResponse>({
    method: 'GET',
    path: '/sync/pull',
    query: {
      family_id: familyId,
      since,
      limit: opts?.limit ?? 200
    }
  });

  if (resp && typeof resp.watermark === 'number') {
    const entryCount = resp.changes?.entries?.length || 0;
    const catCount = resp.changes?.categories?.length || 0;
    logger.debug('sync:pull', `received · watermark=${resp.watermark} entries=${entryCount} categories=${catCount} has_more=${resp.has_more}`);
    if (resp.changes) {
      await applyServerChanges(resp.changes);
      // COSTRA-4xx：把 sync-pull 下发的 ledgers[] 增量写入 ledgerBalanceApi 缓存
      if (resp.changes.ledgers && resp.changes.ledgers.length > 0) {
        for (const wire of resp.changes.ledgers) {
          await applyLedgerBalanceFromSync(wire as { id: string; balance_cents?: number; balance_baseline_seq?: number; balance_version?: number });
        }
      }
    }
    await setWatermark(familyId, resp.watermark);
    // migration 0004: 检查分类签名是否变化，触发强刷（fire-and-forget）
    maybeRefreshCategoriesByRevision(familyId, resp.categories_revision);
  } else {
    logger.warn('sync:pull', `⚠️ invalid response · watermark=${resp?.watermark} type=${typeof resp?.watermark}`);
  }

  return resp;
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
    // 不再区分 409（之前无条件清除会导致数据丢失）
    logger.warn('sync:pushDelta', `⚠️ HTTP ${status || 'network'} error · batchKey=${batchKey} msg="${errMsg}" → ackBatchFailure`);
    const failed = await ackBatchFailure(batchKey);
    logger.warn('sync:pushDelta', `failure recovered=${failed} ops back to index`);
    return { pushed: 0, conflicts: 0, rejected: 0, failed };
  }
}
