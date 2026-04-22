// services/sync.ts · 增量同步（骨架占位）
// 卡号: COSTRA-030 · 后续由 COSTRA-12x 完成真实实现
// 契约来源: docs/api/conflict-strategy.md · docs/db/schema.md §6

import { request } from './request';
import { getItem, setItem } from './storage';

type Entity = 'ledger_entries' | 'accounts' | 'categories' | 'families' | 'family_members';

interface SyncCursor {
  [entity: string]: number;
}

const CURSOR_KEY = '__costra_sync_cursor_v1';
const OUTBOX_KEY = '__costra_outbox_v1';

export interface LocalEntryInput {
  type: 'expense' | 'income';
  amountCents: number;
  categoryId: string | null;
  note: string;
  occurredAt: string; // ISO 8601
}

interface OutboxItem extends LocalEntryInput {
  localId: string;
  createdAt: number;
}

export function getCursor(): SyncCursor {
  return getItem<SyncCursor>(CURSOR_KEY) || {};
}

export function setCursor(entity: Entity, version: number): void {
  const cur = getCursor();
  cur[entity] = version;
  setItem(CURSOR_KEY, cur);
}

export async function pullDelta<T>(entity: Entity): Promise<{ items: T[]; serverVersion: number }> {
  const cur = getCursor()[entity] || 0;
  const resp = await request<{ items: T[]; serverVersion: number }>({
    method: 'GET',
    path: `/sync/${entity}`,
    query: { sinceVersion: cur }
  });
  setCursor(entity, resp.serverVersion);
  return resp;
}

/**
 * 把一笔记账先压入本地 outbox，下一次 pushDelta 批量上行。
 * 骨架阶段只做本地持久化，返回 localId。
 * Refs: COSTRA-030, docs/api/conflict-strategy.md §2 客户端重试
 */
export async function enqueueLocalEntry(entry: LocalEntryInput): Promise<{ localId: string }> {
  const outbox = getItem<OutboxItem[]>(OUTBOX_KEY) || [];
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: OutboxItem = { ...entry, localId, createdAt: Date.now() };
  outbox.push(item);
  setItem(OUTBOX_KEY, outbox);
  return { localId };
}
