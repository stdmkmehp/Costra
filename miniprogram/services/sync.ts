// services/sync.ts · 增量同步（重构版 · 迁出 outbox/cursor 到 db.ts/outbox.ts）
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// 原骨架: COSTRA-102/125 · COSTRA-118 P1-3 已兑现
// 契约事实源: server/api/openapi.yaml /sync/pull · docs/api/sync-protocol.md §2/§3
// 迁出清单（dispatch §2.4）：
//   - enqueueLocalEntry → 迁移到 outbox.ts
//   - OUTBOX_KEY / __peekOutbox → 迁移到 outbox.ts
//   - getCursor/setCursor → 迁移到 db.ts getWatermark/setWatermark
//   - syncPull 内部接入 db.ts.applyServerChanges
// Refs: costra-103-miniapp-local-persistence-outbox.md §2.4

import { request, ApiError } from './request';
import { getWatermark, setWatermark, applyServerChanges } from './db';
import { drainBatch, ackResults, ackBatchFailure, ackBatchAsAlreadyProcessed, PushResultItem } from './outbox';

/**
 * Entity 枚举
 * 事实源: server/api/openapi.yaml tags + SyncPushRequest.ops[].entity
 */
export type Entity = 'entry' | 'category' | 'budget';

/**
 * /sync/pull 响应契约（OpenAPI SyncPullResponse）
 * 对齐 docs/api/sync-protocol.md §3.2
 *
 * BUG-COSTRA-154 v1.2 升级（2026-05-22）：
 *   watermark 类型从 string（ISO 微秒）→ number（BIGINT change_seq）
 *   PG SEQUENCE 严格单调 · 不依赖时钟 · 完全消除同微秒并发漏拉风险
 */
export interface SyncPullResponse {
  watermark: number;
  has_more?: boolean;
  changes: {
    entries?: unknown[];
    categories?: unknown[];
    budgets?: unknown[];
    ledgers?: unknown[];
  };
}

/**
 * 拉增量（家庭维度）
 * 契约事实源：
 * - server/api/openapi.yaml /sync/pull: GET + query params { family_id, since, limit }
 * - docs/api/sync-protocol.md §3.1
 *
 * v1.2：since 改 number · 不再 ISO 字符串
 */
export async function syncPull(
  familyId: string,
  opts?: { limit?: number }
): Promise<SyncPullResponse> {
  const since = await getWatermark(familyId);
  const resp = await request<SyncPullResponse>({
    method: 'GET',
    path: '/sync/pull',
    query: {
      family_id: familyId,
      since,
      limit: opts?.limit ?? 200
    }
  });

  // sync-protocol.md §3.3：按实体顺序消费 changes · 客户端不得自行推进 watermark
  // v1.2：watermark 是 number · typeof === 'number' 防御
  if (resp && typeof resp.watermark === 'number') {
    if (resp.changes) {
      await applyServerChanges(resp.changes);
    }
    await setWatermark(familyId, resp.watermark);
  }

  return resp;
}

/**
 * 推本地变更（outbox 重放）
 *
 * 调用契约：
 * - drainBatch 把 op 从 index 移到 drained · 等待 pushDelta 处理
 * - 服务端正常响应（含部分 conflict/rejected）→ ackResults 按三态消费 drained
 * - 网络/超时/HTTP 异常（无 results 可消费）→ ackBatchFailure 把 drained 复原到 index
 *
 * 状态机不变量（D-025 AP-002 修订）：
 *   pushDelta 一次完整调用结束后 · 本批次的所有 seq 必从 drained 中清除
 *   （否则下次 drainBatch 会形成死锁 · 见 BUG-COSTRA-150-D）
 *
 * sync-protocol.md §2 push 完整链路
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

  try {
    const resp = await request<{ results: PushResultItem[] }>({
      method: 'POST',
      path: '/sync/push',
      body: { ops },
      idempotencyKey: batchKey,
    });

    // 服务端正常响应 · ackResults 消费三态（即使 results 为空数组也要调 · 清 drained）
    const results = resp?.results || [];
    await ackResults(batchKey, results);

    let pushed = 0, conflicts = 0, rejected = 0;
    for (const r of results) {
      if (r.status === 'ok') pushed++;
      else if (r.status === 'conflict') conflicts++;
      else rejected++;
    }
    return { pushed, conflicts, rejected, failed: 0 };
  } catch (err: unknown) {
    // COSTRA-228: 区分 409 幂等键冲突与其他错误
    const status = (err as ApiError)?.status;

    if (status === 409) {
      // 幂等键冲突：服务端已处理过该批次 → 清除 outbox 条目
      // 后续通过 syncPull 回填 server_id/version
      const cleared = await ackBatchAsAlreadyProcessed(batchKey);
      return { pushed: cleared, conflicts: 0, rejected: 0, failed: 0 };
    }

    // 网络/超时/其他 HTTP 错误 · 无 results 可消费 · 必须复原 drained 否则永久死锁
    // 历史 BUG-COSTRA-150-D（COSTRA-103 R1 引入）· R1.x.2 修复
    const failed = await ackBatchFailure(batchKey);
    return { pushed: 0, conflicts: 0, rejected: 0, failed };
  }
}
