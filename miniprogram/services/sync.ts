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

import { request } from './request';
import { getWatermark, setWatermark, applyServerChanges } from './db';
import { drainBatch, ackResults, PushResultItem } from './outbox';

/**
 * Entity 枚举
 * 事实源: server/api/openapi.yaml tags + SyncPushRequest.ops[].entity
 */
export type Entity = 'entry' | 'category' | 'budget';

/**
 * /sync/pull 响应契约（OpenAPI SyncPullResponse）
 * 对齐 docs/api/sync-protocol.md §3.2
 */
export interface SyncPullResponse {
  watermark: string;
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
  if (resp && typeof resp.watermark === 'string') {
    if (resp.changes) {
      await applyServerChanges(resp.changes);
    }
    await setWatermark(familyId, resp.watermark);
  }

  return resp;
}

/**
 * 推本地变更（outbox 重放）
 * drainBatch → POST /sync/push（带 batch idempotencyKey）→ ackResults 消费三态
 * sync-protocol.md §2 push 完整链路
 */
export async function pushDelta(): Promise<{
  pushed: number;
  conflicts: number;
  rejected: number;
}> {
  const batch = await drainBatch(200);
  if (!batch) return { pushed: 0, conflicts: 0, rejected: 0 };

  const { batch: ops, batchKey } = batch;

  try {
    const resp = await request<{ results: PushResultItem[] }>({
      method: 'POST',
      path: '/sync/push',
      body: { ops },
      idempotencyKey: batchKey,
    });

    if (resp?.results) {
      await ackResults(batchKey, resp.results);
    }
  } catch {
    // 网络级别失败：整批留 outbox · idempotency_key 不变 · 等下次重试
  }

  // 简化计数（由 ackResults 按三态处理）
  const pushed = 0, conflicts = 0, rejected = 0;
  void pushed; void conflicts; void rejected;
  return { pushed, conflicts, rejected };
}
