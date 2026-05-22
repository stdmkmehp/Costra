// services/db.ts · 本地 KV 实体持久化层（基于 storage.ts async KV 抽象）
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// Refs: sync-protocol.md §2.1/§3.3 · id-strategy.md §2.5 · costra-103-miniapp-local-persistence-outbox.md §2.1
// 存储 key 命名空间：entry:{client_ref_id} / entry:__index / category:{client_ref_id} / ... / watermark:{family_id}

import { getItem, setItem } from './storage';

export interface Entry {
  id?: string;                  // 服务端 UUID v7（push 成功后回写）
  client_ref_id: string;        // 客户端 UUID v4（本地主键 · 必填）
  ledger_id: string;            // family ledger
  amount: number;               // cents · int
  currency: string;             // ISO 4217
  type: 'expense' | 'income';
  category_id: string | null;
  note: string;
  occurred_at: string;           // ISO 8601 UTC
  created_at?: string;
  updated_at?: string;
  version?: number;             // 服务端乐观锁版本
  deleted_at?: string | null;   // 软删
  dirty?: boolean;              // 本地标记 · 未 push
}

export interface Category {
  id?: string;
  client_ref_id: string;
  ledger_id: string;
  name: string;
  icon: string;
  color: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  deleted_at?: string | null;
  dirty?: boolean;
}

export interface Budget {
  id?: string;
  client_ref_id: string;
  ledger_id: string;
  category_id: string;
  amount: number;               // cents
  month: string;               // 'YYYY-MM'
  created_at?: string;
  updated_at?: string;
  version?: number;
  deleted_at?: string | null;
  dirty?: boolean;
}

export interface Ledger {
  id?: string;
  client_ref_id: string;
  family_id: string;
  name: string;
  currency: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  deleted_at?: string | null;
  dirty?: boolean;
}

type Entity = 'entry' | 'category' | 'budget' | 'ledger';

// storage.ts getItem 返回 Envelope<实际类型>.d
// 这里用 EntityEnvelope 声明，与 storage.ts Envelope 对齐
interface EntityEnvelope<T> {
  v: number;
  t: number;
  d: T;
}

// ─── key helpers ──────────────────────────────────────────────────────────────

function entityKey(entity: Entity, clientRefId: string): string {
  return `${entity}:${clientRefId}`;
}

function indexKey(entity: Entity): string {
  return `${entity}:__index`;
}

function watermarkKey(familyId: string): string {
  return `watermark:${familyId}`;
}

// ─── internal helpers ─────────────────────────────────────────────────────────

async function readIndex(entity: Entity): Promise<string[]> {
  return (await getItem<string[]>(indexKey(entity))) || [];
}

async function appendToIndex(entity: Entity, clientRefId: string): Promise<void> {
  const idx = await readIndex(entity);
  if (!idx.includes(clientRefId)) {
    idx.push(clientRefId);
    await setItem(indexKey(entity), idx);
  }
}

async function removeFromIndex(entity: Entity, clientRefId: string): Promise<void> {
  const idx = await readIndex(entity);
  const next = idx.filter(id => id !== clientRefId);
  await setItem(indexKey(entity), next);
}

async function getEntity<T extends { client_ref_id: string }>(
  entity: Entity,
  clientRefId: string
): Promise<T | null> {
  const env = await getItem<EntityEnvelope<T>>(entityKey(entity, clientRefId));
  if (!env || !env.d) return null;
  return env.d;
}

async function putEntity<T extends { client_ref_id: string }>(
  entity: Entity,
  item: T
): Promise<void> {
  const env: EntityEnvelope<T> = { v: 1, t: Date.now(), d: item };
  await setItem(entityKey(entity, item.client_ref_id), env);
}

// ─── Entry API（8 个）─────────────────────────────────────────────────────────

export async function putEntry(entry: Entry): Promise<void> {
  entry.dirty = entry.dirty ?? true;
  await putEntity('entry', entry);
  await appendToIndex('entry', entry.client_ref_id);
}

export async function getEntry(clientRefId: string): Promise<Entry | null> {
  return getEntity<Entry>('entry', clientRefId);
}

export async function listEntries(filter?: {
  ledger_id?: string;
  since?: string;
}): Promise<Entry[]> {
  const ids = await readIndex('entry');
  const results: Entry[] = [];
  for (const id of ids) {
    const entry = await getEntry(id);
    if (!entry) continue;
    if (filter?.ledger_id && entry.ledger_id !== filter.ledger_id) continue;
    if (filter?.since && entry.occurred_at < filter.since) continue;
    if (entry.deleted_at) continue;
    results.push(entry);
  }
  results.sort((a, b) => {
    const ta = a.occurred_at ? a.occurred_at : '';
    const tb = b.occurred_at ? b.occurred_at : '';
    return tb.localeCompare(ta);
  });
  return results;
}

export async function deleteEntry(clientRefId: string): Promise<void> {
  const entry = await getEntry(clientRefId);
  if (!entry) return;
  entry.deleted_at = new Date().toISOString();
  entry.updated_at = entry.deleted_at;
  entry.dirty = true;
  await putEntry(entry);
  await removeFromIndex('entry', clientRefId);
}

export async function applyServerChanges(
  changes: {
    entries?: unknown[];
    categories?: unknown[];
    budgets?: unknown[];
    ledgers?: unknown[];
  }
): Promise<void> {
  // ledgers
  for (const raw of changes.ledgers || []) {
    const item = raw as Ledger;
    const local = await getEntity<Ledger>('ledger', item.client_ref_id);
    if (item.deleted_at) {
      if (!local || (local.version ?? 0) < (item.version ?? 0)) {
        await putEntity('ledger', { ...item, dirty: false });
        await removeFromIndex('ledger', item.client_ref_id);
      }
    } else if (!local || (item.version ?? 0) > (local.version ?? 0)) {
      if (local?.dirty) {
        await mergeIntoConflictQueue('ledger', local, item);
      } else {
        await putEntity('ledger', { ...item, dirty: false });
        await appendToIndex('ledger', item.client_ref_id);
      }
    }
  }

  // categories
  for (const raw of changes.categories || []) {
    const item = raw as Category;
    const local = await getEntity<Category>('category', item.client_ref_id);
    if (item.deleted_at) {
      if (!local || (local.version ?? 0) < (item.version ?? 0)) {
        await putEntity('category', { ...item, dirty: false });
        await removeFromIndex('category', item.client_ref_id);
      }
    } else if (!local || (item.version ?? 0) > (local.version ?? 0)) {
      if (local?.dirty) {
        await mergeIntoConflictQueue('category', local, item);
      } else {
        await putEntity('category', { ...item, dirty: false });
        await appendToIndex('category', item.client_ref_id);
      }
    }
  }

  // budgets
  for (const raw of changes.budgets || []) {
    const item = raw as Budget;
    const local = await getEntity<Budget>('budget', item.client_ref_id);
    if (item.deleted_at) {
      if (!local || (local.version ?? 0) < (item.version ?? 0)) {
        await putEntity('budget', { ...item, dirty: false });
        await removeFromIndex('budget', item.client_ref_id);
      }
    } else if (!local || (item.version ?? 0) > (local.version ?? 0)) {
      if (local?.dirty) {
        await mergeIntoConflictQueue('budget', local, item);
      } else {
        await putEntity('budget', { ...item, dirty: false });
        await appendToIndex('budget', item.client_ref_id);
      }
    }
  }

  // entries
  for (const raw of changes.entries || []) {
    const item = raw as Entry;
    const local = await getEntity<Entry>('entry', item.client_ref_id);
    if (item.deleted_at) {
      if (!local || (local.version ?? 0) < (item.version ?? 0)) {
        await putEntity('entry', { ...item, dirty: false });
        await removeFromIndex('entry', item.client_ref_id);
      }
    } else if (!local || (item.version ?? 0) > (local.version ?? 0)) {
      if (local?.dirty) {
        await mergeIntoConflictQueue('entry', local, item);
      } else {
        await putEntity('entry', { ...item, dirty: false });
        await appendToIndex('entry', item.client_ref_id);
      }
    }
  }
}

async function mergeIntoConflictQueue(
  entity: Entity,
  local: { client_ref_id: string; version?: number },
  server: { client_ref_id: string; version?: number }
): Promise<void> {
  console.warn('[db] conflict detected', { entity, local_ref_id: local.client_ref_id, server_version: server.version });
  const queue = (await getItem<{ entity: Entity; local: unknown; server: unknown }[]>('conflict:__queue')) || [];
  queue.push({ entity, local, server });
  await setItem('conflict:__queue', queue);
}

export async function getWatermark(familyId: string): Promise<number> {
  // BUG-COSTRA-154 v1.2 升级（2026-05-22）：
  //   watermark 类型从 string（ISO 微秒）→ number（BIGINT change_seq）
  //   兼容旧值：检测到 storage 残留 ISO 字符串自动重置为 0
  //     → 触发一次性全量 pull · 之后正常增量
  //     → 避免 server schema 校验失败（pullQuerySchema since: integer minimum=0）
  const v = await getItem<unknown>(watermarkKey(familyId));
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  if (typeof v === 'string') {
    // 旧 v1.0/v1.1 ISO 字符串 watermark · 一次性清除 + 全量重拉
    console.warn('[db] legacy ISO watermark detected, resetting to 0 (full re-sync)', { familyId, legacy: v });
    await setItem<number>(watermarkKey(familyId), 0);
    return 0;
  }
  return 0;
}

export async function setWatermark(familyId: string, watermark: number): Promise<void> {
  // 防御性校验：watermark 必须是非负整数（v1.2 协议契约）
  if (!Number.isInteger(watermark) || watermark < 0) {
    console.warn('[db] invalid watermark · ignored', { familyId, watermark });
    return;
  }
  await setItem<number>(watermarkKey(familyId), watermark);
}
