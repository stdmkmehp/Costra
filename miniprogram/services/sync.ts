// services/sync.ts · 增量同步（骨架 → 契约对齐版）
// 卡号: COSTRA-102（重写）· 原骨架: COSTRA-030
// 契约事实源: server/api/openapi.yaml /sync/pull · docs/api/sync-protocol.md §3
// 承接 COSTRA-118 路径 A: E.P0-6（/sync/pull 端点契约对齐）/ E.P0-7（Entity 枚举对齐 OpenAPI tags）
// 后续承接卡: COSTRA-103（outbox payload snake_case + 批量 push）/ COSTRA-104（真实推送）

import { request } from './request';
import { getItem, setItem } from './storage';

/**
 * Entity 枚举
 * 事实源: server/api/openapi.yaml tags + SyncPushRequest.ops[].entity
 * P0-7: 骨架期幻觉 `ledger_entries/accounts/families/family_members` 已废弃
 */
export type Entity = 'entry' | 'category' | 'budget';

/**
 * 客户端本地水位线
 * 与 dispatch §D2.5 对齐：骨架期按单 entity 版本号记录；真实契约是按 updated_at ISO 水位（sync-protocol.md §3.2）
 * 本卡只做接口签名对齐与响应契约对齐；真实 watermark 推进由 COSTRA-103 做
 */
export interface SyncCursor {
  /** family_id 维度的上次水位（ISO 字符串；首次 '1970-01-01T00:00:00.000Z'） */
  watermark: string;
}

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

const CURSOR_KEY = '__costra_sync_cursor_v1';
const OUTBOX_KEY = '__costra_outbox_v1';

const EPOCH_ZERO = '1970-01-01T00:00:00.000Z';

export interface LocalEntryInput {
  type: 'expense' | 'income';
  amountCents: number;
  categoryId: string | null;
  note: string;
  occurredAt: string; // ISO 8601 UTC
}

interface OutboxItem extends LocalEntryInput {
  localId: string;
  createdAt: number;
}

export function getCursor(): SyncCursor {
  return getItem<SyncCursor>(CURSOR_KEY) || { watermark: EPOCH_ZERO };
}

export function setCursor(cur: SyncCursor): void {
  setItem(CURSOR_KEY, cur);
}

/**
 * 拉增量（家庭维度 · 契约对齐 · 骨架签名）
 *
 * 契约事实源：
 * - server/api/openapi.yaml /sync/pull: **GET** + query params { family_id, since, limit }
 * - docs/api/sync-protocol.md §3.1 同步确认 GET 语义
 *
 * 注：dispatch §D2.5 文本写的是 "POST /sync/pull body"（基于 round-1-tech.md 早期表述），
 * 与上述两处事实源不一致；Agent 按事实源实装并在响应报告 INFO 登记，派生 FU-102-SYNC-PULL-DRIFT。
 *
 * 本卡仅保证签名正确；真实数据处理（应用 changes 到本地 DB、更新 watermark 持久化语义）
 * 留给 COSTRA-103 本地持久化卡承接。
 */
export async function syncPull(familyId: string, opts?: { limit?: number }): Promise<SyncPullResponse> {
  const cur = getCursor();
  const resp = await request<SyncPullResponse>({
    method: 'GET',
    path: '/sync/pull',
    query: {
      family_id: familyId,
      since: cur.watermark,
      limit: opts?.limit ?? 200
    }
  });
  // 本卡只对水位做"拉后推进"最小语义 · 真实冲突合并与去重在 COSTRA-103
  if (resp && typeof resp.watermark === 'string') {
    setCursor({ watermark: resp.watermark });
  }
  return resp;
}

/**
 * 把一笔记账先压入本地 outbox，下一次 pushDelta 批量上行。
 * 本卡不改 outbox payload 结构（E.P1-3 属 COSTRA-103 范围）
 * Refs: COSTRA-030, docs/api/sync-protocol.md §2 push
 */
export async function enqueueLocalEntry(entry: LocalEntryInput): Promise<{ localId: string }> {
  const outbox = getItem<OutboxItem[]>(OUTBOX_KEY) || [];
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: OutboxItem = { ...entry, localId, createdAt: Date.now() };
  outbox.push(item);
  setItem(OUTBOX_KEY, outbox);
  return { localId };
}

/** 仅供单测与 Human 本地验证脚本读取队列长度 · 生产页面不应消费 */
export function __peekOutbox(): OutboxItem[] {
  return getItem<OutboxItem[]>(OUTBOX_KEY) || [];
}
