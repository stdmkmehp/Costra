// services/db.ts · 本地 KV 实体持久化层
// 重构: 移除 dirty 字段 + 添加 wireToEntry 字段映射 + 简化 applyServerChanges

import { getItem, setItem } from './storage';
import { logger } from '../utils/logger';
import { shanghaiMonthValueFromIso } from '../utils/shanghaiDate';

export interface Entry {
  id?: string;                  // 服务端 UUID v7（push 成功后回写）
  client_ref_id: string;        // 客户端 UUID v4（本地主键 · 必填）
  ledger_id: string;
  amount: number;               // cents · int
  currency: string;             // ISO 4217
  type: 'expense' | 'income' | 'transfer';
  category_id: string | null;
  note: string;
  occurred_at: string;           // ISO 8601 UTC
  created_at?: string;
  updated_at?: string;
  version?: number;             // 服务端乐观锁版本
  deleted_at?: string | null;
  created_by?: string | null;
  shared_type?: 'shared' | 'personal' | null;
  /** 服务端定时规则来源；手工流水为 null */
  source_recurring_id?: string | null;
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

function entryMonthIndexKey(ledgerId: string, month: string): string {
  return `entry:index:${ledgerId}:${month}`;
}

function entryMonthValue(entry: Entry): string {
  return shanghaiMonthValueFromIso(entry.occurred_at);
}

interface EntryMonthIndexItem {
  client_ref_id: string;
  occurred_at: string;
}

export interface MonthEntriesResult {
  entries: Entry[];
  source: 'month-index' | 'rebuilt-month-index';
  totalIndexed: number;
  complete: boolean;
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

async function readEntryMonthIndex(ledgerId: string, month: string): Promise<EntryMonthIndexItem[] | null> {
  return await getItem<EntryMonthIndexItem[]>(entryMonthIndexKey(ledgerId, month));
}

function sortEntryMonthIndex(items: EntryMonthIndexItem[]): EntryMonthIndexItem[] {
  return items.slice().sort((a, b) => {
    const byTime = b.occurred_at.localeCompare(a.occurred_at);
    if (byTime !== 0) return byTime;
    return b.client_ref_id.localeCompare(a.client_ref_id);
  });
}

async function removeFromEntryMonthIndex(entry: Entry | null | undefined): Promise<void> {
  if (!entry?.ledger_id || !entry.occurred_at) return;
  const month = entryMonthValue(entry);
  const idx = await readEntryMonthIndex(entry.ledger_id, month);
  if (!idx) return;
  const next = idx.filter((item) => item.client_ref_id !== entry.client_ref_id);
  await setItem(entryMonthIndexKey(entry.ledger_id, month), next);
}

async function upsertEntryMonthIndex(entry: Entry): Promise<void> {
  if (entry.deleted_at) return;
  const month = entryMonthValue(entry);
  const idx = await readEntryMonthIndex(entry.ledger_id, month) || [];
  const next = sortEntryMonthIndex([
    ...idx.filter((item) => item.client_ref_id !== entry.client_ref_id),
    { client_ref_id: entry.client_ref_id, occurred_at: entry.occurred_at },
  ]);
  await setItem(entryMonthIndexKey(entry.ledger_id, month), next);
}

async function reindexEntry(previous: Entry | null | undefined, next: Entry | null | undefined): Promise<void> {
  if (previous) await removeFromEntryMonthIndex(previous);
  if (next && !next.deleted_at) await upsertEntryMonthIndex(next);
}

async function rebuildEntryMonthIndex(ledgerId: string, month: string): Promise<EntryMonthIndexItem[]> {
  const ids = await readIndex('entry');
  const next: EntryMonthIndexItem[] = [];
  for (const id of ids) {
    const entry = await getEntry(id);
    if (!entry || entry.deleted_at) continue;
    if (entry.ledger_id !== ledgerId) continue;
    if (entryMonthValue(entry) !== month) continue;
    next.push({ client_ref_id: entry.client_ref_id, occurred_at: entry.occurred_at });
  }
  const sorted = sortEntryMonthIndex(next);
  await setItem(entryMonthIndexKey(ledgerId, month), sorted);
  return sorted;
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
    type: wire.type as 'expense' | 'income' | 'transfer',
    category_id: (wire.category_id as string | null) ?? null,
    note: (wire.note as string) ?? '',
    occurred_at: wire.occurred_at as string,
    created_at: wire.created_at as string | undefined,
    updated_at: wire.updated_at as string | undefined,
    deleted_at: wire.deleted_at as string | null | undefined,
    version: wire.server_version as number | undefined,     // server_version → version
    created_by: wire.user_id as string | null | undefined,  // user_id → created_by
    shared_type: wire.shared_type as 'shared' | 'personal' | null | undefined,
    source_recurring_id: wire.source_recurring_id as string | null | undefined,
  };
}

// ─── Entry API ────────────────────────────────────────────────────────────────

export async function putEntry(entry: Entry): Promise<void> {
  const previous = await getEntry(entry.client_ref_id);
  await putEntity('entry', entry);
  await appendToIndex('entry', entry.client_ref_id);
  await reindexEntry(previous, entry);
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
  await reindexEntry(current, updated);
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

export async function listMonthEntries(opts: {
  ledger_id: string;
  month: string;
  limit?: number;
}): Promise<MonthEntriesResult> {
  let idx = await readEntryMonthIndex(opts.ledger_id, opts.month);
  let source: MonthEntriesResult['source'] = 'month-index';
  if (!idx) {
    idx = await rebuildEntryMonthIndex(opts.ledger_id, opts.month);
    source = 'rebuilt-month-index';
  }

  const entries: Entry[] = [];
  const max = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  for (const item of idx) {
    if (entries.length >= max) break;
    const entry = await getEntry(item.client_ref_id);
    if (!entry || entry.deleted_at) continue;
    if (entry.ledger_id !== opts.ledger_id) continue;
    if (entryMonthValue(entry) !== opts.month) continue;
    entries.push(entry);
  }

  return {
    entries,
    source,
    totalIndexed: idx.length,
    complete: entries.length >= idx.length || !opts.limit,
  };
}

export async function deleteEntry(clientRefId: string): Promise<void> {
  const entry = await getEntry(clientRefId);
  if (!entry) return;
  const deletedAt = new Date().toISOString();
  const deleted: Entry = {
    ...entry,
    deleted_at: deletedAt,
    updated_at: deletedAt,
  };
  await putEntity('entry', deleted);
  await removeFromIndex('entry', clientRefId);
  await reindexEntry(entry, deleted);
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
        await reindexEntry(local, item);
      }
    } else if (!local || serverVer >= localVer) {
      await putEntity('entry', item);
      await appendToIndex('entry', item.client_ref_id);
      await reindexEntry(local, item);
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
    logger.warn('db', 'legacy ISO watermark detected, resetting to 0', { familyId });
    await setItem<number>(watermarkKey(familyId), 0);
    return 0;
  }
  return 0;
}

export async function setWatermark(familyId: string, watermark: number): Promise<void> {
  if (!Number.isInteger(watermark) || watermark < 0) {
    logger.warn('db', 'invalid watermark · ignored', { familyId, watermark });
    return;
  }
  await setItem<number>(watermarkKey(familyId), watermark);
}
