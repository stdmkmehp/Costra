// services/db.ts · 本地 KV 实体持久化层
// 重构: 移除 dirty 字段 + 添加 wireToEntry 字段映射 + 简化 applyServerChanges

import { getItem, setItem } from './storage';

export interface Entry {
  id?: string;                  // 服务端 UUID v7（push 成功后回写）
  client_ref_id: string;        // 客户端 UUID v4（本地主键 · 必填）
  ledger_id: string;
  amount: number;               // cents · int
  currency: string;             // ISO 4217
  type: 'expense' | 'income';
  category_id: string | null;
  note: string;
  occurred_at: string;           // ISO 8601 UTC
  created_at?: string;
  updated_at?: string;
  version?: number;             // 服务端乐观锁版本
  deleted_at?: string | null;
  created_by?: string | null;
  shared_type?: 'shared' | 'personal' | null;
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
}

export interface Budget {
  id?: string;
  client_ref_id: string;
  ledger_id: string;
  category_id: string;
  amount: number;
  month: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  deleted_at?: string | null;
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
}

type Entity = 'entry' | 'category' | 'budget' | 'ledger';

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

// ─── Wire → Local 字段映射 ───────────────────────────────────────────────────
// 服务端 sync/pull wire 格式使用 server_version/user_id
// 本地 Entry 使用 version/created_by

function wireToEntry(wire: Record<string, unknown>): Entry {
  return {
    id: wire.id as string | undefined,
    client_ref_id: wire.client_ref_id as string,
    ledger_id: wire.ledger_id as string,
    amount: wire.amount as number,
    currency: wire.currency as string,
    type: wire.type as 'expense' | 'income',
    category_id: (wire.category_id as string | null) ?? null,
    note: (wire.note as string) ?? '',
    occurred_at: wire.occurred_at as string,
    created_at: wire.created_at as string | undefined,
    updated_at: wire.updated_at as string | undefined,
    deleted_at: wire.deleted_at as string | null | undefined,
    version: wire.server_version as number | undefined,     // server_version → version
    created_by: wire.user_id as string | null | undefined,  // user_id → created_by
    shared_type: wire.shared_type as 'shared' | 'personal' | null | undefined,
  };
}

// ─── Entry API ────────────────────────────────────────────────────────────────

export async function putEntry(entry: Entry): Promise<void> {
  await putEntity('entry', entry);
  await appendToIndex('entry', entry.client_ref_id);
}

/**
 * 部分更新 entry 字段（保留 storage 中的 version/id 等同步字段）
 * 用于页面编辑场景：页面持有的 entry 对象可能没有最新 version，
 * 直接 putEntry 会覆盖 storage 中已回填的 version。
 */
export async function updateEntryFields(
  clientRefId: string,
  fields: Partial<Omit<Entry, 'client_ref_id'>>
): Promise<Entry | null> {
  const current = await getEntry(clientRefId);
  if (!current) return null;
  // 只 merge 非 undefined 的字段，避免覆盖有效数据
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const updated = { ...current, ...cleaned } as Entry;
  await putEntity('entry', updated);
  return updated;
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
  await putEntry(entry);
  await removeFromIndex('entry', clientRefId);
}

// ─── applyServerChanges ──────────────────────────────────────────────────────
// 覆盖条件：服务端 version > 本地 version（或本地不存在）
// 不再依赖 dirty 字段判断冲突

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
    const serverVer = item.version ?? 0;
    const localVer = local?.version ?? 0;
    if (item.deleted_at) {
      if (!local || localVer < serverVer) {
        await putEntity('ledger', item);
        await removeFromIndex('ledger', item.client_ref_id);
      }
    } else if (!local || serverVer > localVer) {
      await putEntity('ledger', item);
      await appendToIndex('ledger', item.client_ref_id);
    }
  }

  // categories
  for (const raw of changes.categories || []) {
    const item = raw as Category;
    const local = await getEntity<Category>('category', item.client_ref_id);
    const serverVer = item.version ?? 0;
    const localVer = local?.version ?? 0;
    if (item.deleted_at) {
      if (!local || localVer < serverVer) {
        await putEntity('category', item);
        await removeFromIndex('category', item.client_ref_id);
      }
    } else if (!local || serverVer > localVer) {
      await putEntity('category', item);
      await appendToIndex('category', item.client_ref_id);
    }
  }

  // budgets
  for (const raw of changes.budgets || []) {
    const item = raw as Budget;
    const local = await getEntity<Budget>('budget', item.client_ref_id);
    const serverVer = item.version ?? 0;
    const localVer = local?.version ?? 0;
    if (item.deleted_at) {
      if (!local || localVer < serverVer) {
        await putEntity('budget', item);
        await removeFromIndex('budget', item.client_ref_id);
      }
    } else if (!local || serverVer > localVer) {
      await putEntity('budget', item);
      await appendToIndex('budget', item.client_ref_id);
    }
  }

  // entries（使用 wireToEntry 字段映射）
  for (const raw of changes.entries || []) {
    const item = wireToEntry(raw as Record<string, unknown>);
    const local = await getEntity<Entry>('entry', item.client_ref_id);
    const serverVer = item.version ?? 0;
    const localVer = local?.version ?? 0;
    if (item.deleted_at) {
      if (!local || localVer <= serverVer) {
        await putEntity('entry', item);
        await removeFromIndex('entry', item.client_ref_id);
      }
    } else if (!local || serverVer >= localVer) {
      await putEntity('entry', item);
      await appendToIndex('entry', item.client_ref_id);
    }
  }
}

// ─── Watermark ────────────────────────────────────────────────────────────────

export async function getWatermark(familyId: string): Promise<number> {
  const v = await getItem<unknown>(watermarkKey(familyId));
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  if (typeof v === 'string') {
    console.warn('[db] legacy ISO watermark detected, resetting to 0', { familyId });
    await setItem<number>(watermarkKey(familyId), 0);
    return 0;
  }
  return 0;
}

export async function setWatermark(familyId: string, watermark: number): Promise<void> {
  if (!Number.isInteger(watermark) || watermark < 0) {
    console.warn('[db] invalid watermark · ignored', { familyId, watermark });
    return;
  }
  await setItem<number>(watermarkKey(familyId), watermark);
}
