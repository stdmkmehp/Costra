// services/db.ts · 本地 KV 实体持久化层
// 重构: 移除 dirty 字段 + 添加 wireToEntry 字段映射
// L13（sync/pull 分页收敛 · docs/design/sync-pull-pagination-design.md）：
//   - 废除 entry:__index（C6：无生产消费者，唯一线性增长单 key + O(n²) 重写瓶颈）
//   - applyServerEntriesBatch：批量落盘（实体单 key 写 + 月索引批末一次写），唯一 pull 应用路径
//   - 判定 shouldApply：`>` 覆盖 + 相等档 pending 闸门 + sameEntryContent 内容等价比较（§4.4 ③）
//   - reindexEntry / rebuild / 批末 / hydrate 四方写月索引统一走 promise-chain 串行队列（R5 · §4.5）
//   - setWatermarkStrict：epoch reset 专用（写失败抛错 + 读回确认 · §3.7）
//   - epoch 记录读写（sync:epoch:{familyId}）

import { getItem, setItem, setItemStrict, removeItem } from './storage';
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

function watermarkKey(familyId: string): string {
  return `watermark:${familyId}`;
}

/** L13 E1：本地按 family 记录 { [ledgerId]: sync_epoch }（§4.2） */
function epochKey(familyId: string): string {
  return `sync:epoch:${familyId}`;
}

/** 遗留的全局 entry 索引 key（L13 废除；bootstrap 一次性清理，rebuild 键枚举须显式排除） */
export const LEGACY_ENTRY_INDEX_KEY = 'entry:__index';

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

// ─── R5：月索引写串行队列（single-writer per month-index key · §4.5）─────────────
//
// 范围 = 月索引 key（entry:index:{ledgerId}:{month}）。四方写者（mutation / 批量 /
// hydrate / rebuild）对同一 key 的"读-改-写"经此队列串行化，消除 lost update。
// 实体单 key 读写不进队列（交错窗口微秒级，有 outbox + 下轮 pull 双保险）。
//
// 实现纪律（§4.5）：
//   1. 失败隔离：单任务 reject 只传给自己的 awaiter，链继续（不卡死该 key 后续写）；
//   2. 禁止重入：任务内部只能调裸 read/write helper，不得再入队（同 key 自我等待 = 死锁）；
//   3. localReset 登记：跨账号存活的模块级内存态（本 Map）必须显式清；
//   4. 测试：__test__.flushIndexQueue()；
//   5. 批末任务重读为 null 时走裸重建分支（rebuildEntryMonthIndexBare），不得把 delta 当全量写回。

const indexQueueTails = new Map<string, Promise<unknown>>();

function enqueueIndexWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = indexQueueTails.get(key) ?? Promise.resolve();
  // 纪律 1：链尾无论前一个任务成功/失败都继续（catch 吞掉传播，只清理 tail 引用）。
  const run = prev.then(() => task(), () => task());
  // tail 记为 run 的结果态（同样吞错，避免 unhandledRejection 卡链）。
  const tail = run.then(() => undefined, () => undefined).then(() => {
    // 若当前 tail 就是本次 run 派生的，链已空 → 清引用防内存泄漏。
    if (indexQueueTails.get(key) === tail) indexQueueTails.delete(key);
  });
  indexQueueTails.set(key, tail);
  return run;
}

/** 供测试：等待全部月索引写队列排空。 */
async function flushIndexQueue(): Promise<void> {
  // 反复等待直到无未决 tail（任务可能在执行中再入队同 key）。
  for (let i = 0; i < 100; i++) {
    const tails = [...indexQueueTails.values()];
    if (tails.length === 0) return;
    await Promise.allSettled(tails);
  }
  // 超限不能静默返回：那会让"队列卡死/自我等待"在测试里表现为假绿
  // （断言看到的是 flush 前的中间态，却以为已排空）。
  throw new Error(`flushIndexQueue: queue did not drain in 100 rounds · pending keys=${[...indexQueueTails.keys()].join(',')}`);
}

// ─── internal helpers（裸 read/write · 不入队 · 供队列任务内部使用）─────────────

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

/**
 * 扫描全部 entry 实体，一次性按 `{ledgerId}:{month}` 分组产出月索引真值。
 *
 * L13 §4.4 ①：数据源是 wx.getStorageInfo() 键枚举（不再依赖已废除的 entry:__index）。
 * 过滤规则：key.startsWith('entry:') 且余段不含 ':'（排除月索引 entry:index:*）
 *   且 key !== LEGACY_ENTRY_INDEX_KEY（__index 余段本身不含 ':'，原规则排不掉它，
 *   不能把正确性押在"升级清理必然已执行"上）。
 *
 * ⚠️ 会多枚举到软删实体（现状 deleteEntry 已从月索引移除，但键枚举会命中实体本身），
 *   在下方过滤 deleted_at 即可；量级 = 孤儿 key，可接受，且保住离线自愈。
 *
 * ⚠️ 成本纪律（L13 §4.4 收益口径）：本函数是 O(全部本地实体) 的 storage 读，昂贵。
 *   **按月分组而非按月过滤**是刻意的——批末多个月份的 null 重建必须共享同一次扫描，
 *   否则 m 个月 × n 条实体 = O(m·n)（首登 24 个月 / 5,000 条 ≈ 6 万次 getEntry），
 *   与"废除 entry:__index 消除 O(n²)"的目标自相矛盾。
 */
async function scanEntryMonthGroups(): Promise<Map<string, EntryMonthIndexItem[]>> {
  const refs = await enumerateEntryRefs();
  const groups = new Map<string, EntryMonthIndexItem[]>();
  for (const ref of refs) {
    const entry = await getEntry(ref);
    if (!entry || entry.deleted_at) continue;
    if (!entry.ledger_id || !entry.occurred_at) continue;
    const k = monthKey(entry.ledger_id, entryMonthValue(entry));
    const item: EntryMonthIndexItem = { client_ref_id: entry.client_ref_id, occurred_at: entry.occurred_at };
    const arr = groups.get(k);
    if (arr) arr.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** 从分组扫描结果取某月真值（已排序）。 */
function pickMonthFromGroups(
  groups: Map<string, EntryMonthIndexItem[]>,
  ledgerId: string,
  month: string,
): EntryMonthIndexItem[] {
  return sortEntryMonthIndex(groups.get(monthKey(ledgerId, month)) ?? []);
}

/**
 * 从实体库推导某月索引真值 · 只计算不写回（单月入口 · 独立一次扫描）。
 *
 * 拆分"计算/写回"的原因：批末任务的 null 裸重建分支只需真值做 delta 合并（合并后统一
 * 一次写回），若调写回版会多一次同 key 冗余写。
 * 批末多月场景不要调本函数（会重复扫描），改用 scanEntryMonthGroups + pickMonthFromGroups。
 */
async function computeEntryMonthIndexFromEntities(ledgerId: string, month: string): Promise<EntryMonthIndexItem[]> {
  return pickMonthFromGroups(await scanEntryMonthGroups(), ledgerId, month);
}

/**
 * 推导重建并写回（裸实现，不入队）。
 * 公共 rebuild 入口（rebuildEntryMonthIndex）依赖"写回"契约：listMonthEntries 重建后
 * 下次读直接命中，不再重复枚举。
 */
async function rebuildEntryMonthIndexBare(ledgerId: string, month: string): Promise<EntryMonthIndexItem[]> {
  const sorted = await computeEntryMonthIndexFromEntities(ledgerId, month);
  await setItem(entryMonthIndexKey(ledgerId, month), sorted);
  return sorted;
}

/**
 * 枚举全部 entry 实体的 client_ref_id（键枚举 · 排除月索引与遗留全局索引）。
 * storage.ts:98 已有 wx.getStorageInfo() 先例。
 */
async function enumerateEntryRefs(): Promise<string[]> {
  if (typeof wx === 'undefined') return [];
  let keys: string[];
  try {
    const info = await wx.getStorageInfo();
    keys = Array.isArray(info.keys) ? info.keys : [];
  } catch (e) {
    logger.warn('db', 'getStorageInfo failed during entry ref enumeration', e);
    return [];
  }
  const refs: string[] = [];
  for (const key of keys) {
    if (!key.startsWith('entry:')) continue;
    if (key === LEGACY_ENTRY_INDEX_KEY) continue;          // 显式排除遗留全局索引
    const rest = key.slice('entry:'.length);
    if (rest.includes(':')) continue;                       // 排除月索引 entry:index:{ledger}:{month}
    refs.push(rest);
  }
  return refs;
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

// ─── 月索引变更（入队执行 · 单写者化）──────────────────────────────────────────

/**
 * 应用一次 entry 的"读-改-写"到月索引（入队执行）。
 * mutation / hydrate 路径经此维护月索引；批量路径不用它（改用批末合并任务）。
 */
async function reindexEntry(previous: Entry | null | undefined, next: Entry | null | undefined): Promise<void> {
  // 旧月移除
  if (previous?.ledger_id && previous.occurred_at) {
    const pMonth = entryMonthValue(previous);
    const pKey = entryMonthIndexKey(previous.ledger_id, pMonth);
    await enqueueIndexWrite(pKey, async () => {
      const idx = await readEntryMonthIndex(previous.ledger_id, pMonth);
      if (!idx) return;
      const filtered = idx.filter((item) => item.client_ref_id !== previous.client_ref_id);
      await setItem(pKey, filtered);
    });
  }
  // 新月 upsert（软删不入索引）
  if (next && !next.deleted_at) {
    const nMonth = entryMonthValue(next);
    const nKey = entryMonthIndexKey(next.ledger_id, nMonth);
    await enqueueIndexWrite(nKey, async () => {
      const idx = await readEntryMonthIndex(next.ledger_id, nMonth);
      // 索引 key 缺失 → 跳过写入、保持缺失（与旧月移除分支对称）：
      //   若写入会造出"key 存在但只含本条"的子集索引，listMonthEntries 的 if(!idx) 兜底
      //   从此失效 → 该月其他已有实体持久不可见（§4.5 纪律 5 同类故障，扩展到 mutation/
      //   hydrate 入口）。跳过则读路径 rebuild（实体已落盘，枚举必含本条）与批末裸重建
      //   均可正确兜底，写路径保持 O(1)，不在记账主链路引入 O(全量实体) 重建。
      if (!idx) return;
      const merged = sortEntryMonthIndex([
        ...idx.filter((item) => item.client_ref_id !== next.client_ref_id),
        { client_ref_id: next.client_ref_id, occurred_at: next.occurred_at },
      ]);
      await setItem(nKey, merged);
    });
  }
}

/**
 * 月索引缺失兜底重建（公共入口 · 入队薄包装）。
 * §4.5 纪律 2：任务内部调裸 helper rebuildEntryMonthIndexBare（推导式重建，天然幂等），
 *   不再自我入队。批末任务需要"裸重建"时**直接调 bare**，不能调本函数（同 key 自我等待即死锁）。
 */
async function rebuildEntryMonthIndex(ledgerId: string, month: string): Promise<EntryMonthIndexItem[]> {
  const key = entryMonthIndexKey(ledgerId, month);
  return enqueueIndexWrite(key, () => rebuildEntryMonthIndexBare(ledgerId, month));
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
  await reindexEntry(entry, deleted);
}

// ─── applyServerEntriesBatch（L13 §4.4 · 唯一 pull 应用路径）──────────────────

export interface ApplyEntriesBatchResult {
  /** 实际写入（新增/覆盖/软删） */
  applied: number;
  /** 判定未通过（更低 version / 相等且有 pending / 相等且内容等价） */
  skipped: number;
  /** perf 打点：本批触碰的月索引 key 数 */
  monthsTouched: number;
}

/** 参与"语义/展示/筛选"的字段集合，用于内容等价比较（§3.8 / §4.4 ③） */
function sameEntryContent(a: Entry, b: Entry): boolean {
  const norm = (v: unknown): unknown => (v === undefined ? null : v);
  return (
    norm(a.id) === norm(b.id) &&
    norm(a.ledger_id) === norm(b.ledger_id) &&
    norm(a.amount) === norm(b.amount) &&
    norm(a.currency) === norm(b.currency) &&
    norm(a.type) === norm(b.type) &&
    norm(a.category_id) === norm(b.category_id) &&
    norm(a.note) === norm(b.note) &&
    norm(a.occurred_at) === norm(b.occurred_at) &&
    norm(a.created_by) === norm(b.created_by) &&
    norm(a.shared_type) === norm(b.shared_type) &&
    norm(a.source_recurring_id) === norm(b.source_recurring_id) &&
    norm(a.deleted_at) === norm(b.deleted_at)
    // 不比较 created_at / updated_at（展示级、易抖动；否则 epoch 重拉退化为全量覆写）
  );
}

/**
 * 判定服务端 entry 是否应写入本地（§4.4 ③）。
 *   - 本地不存在 → 恒应用
 *   - serverVer > localVer → 覆盖
 *   - serverVer < localVer → 跳过（本地更新，罕见）
 *   - 相等且有 pending op → 跳过（保护本地未上行编辑/软删）
 *   - 相等且无 pending 且内容等价 → 跳过（epoch 全量重拉的老行不重复写）
 *   - 相等且无 pending 但内容漂移 → 应用（拉回服务端 canonical category_id / shared_type）
 */
function shouldApply(local: Entry | null, item: Entry, pendingRefs: Set<string>): boolean {
  if (!local) return true;
  const serverVer = item.version ?? 0;
  const localVer = local.version ?? 0;
  if (serverVer > localVer) return true;
  if (serverVer < localVer) return false;
  if (pendingRefs.has(item.client_ref_id)) return false;
  return !sameEntryContent(local, item);
}

/** 内存累计的月索引 delta：每月一份 add / remove 集合。 */
interface MonthDelta {
  ledgerId: string;
  month: string;
  add: Map<string, EntryMonthIndexItem>;  // client_ref_id → item
  remove: Set<string>;                     // client_ref_id
}

function monthKey(ledgerId: string, month: string): string {
  return `${ledgerId}:${month}`;
}

function ensureMonthDelta(cache: Map<string, MonthDelta>, ledgerId: string, month: string): MonthDelta {
  const k = monthKey(ledgerId, month);
  let d = cache.get(k);
  if (!d) {
    d = { ledgerId, month, add: new Map(), remove: new Set() };
    cache.set(k, d);
  }
  return d;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * 批量落盘服务端 pull 下发的 entries（唯一 pull 应用路径）。
 *
 * 流程（§4.4 ②）：
 *   0. 一次性构建 pendingRefs（禁止逐条 hasPendingEntryOp）
 *   1. 逐条判定 shouldApply → putEntity（实体单 key 写，不进队列）；内存累计月索引 delta
 *   2. 批末逐月把「重读 → 应用 delta → 写回」作为一个任务入 R5 队列
 *   3. 批末任务重读为 null → 裸重建 + delta 合并（§4.5 纪律 5），避免"key 存在但只含子集"
 *
 * @param wires 服务端 wire 格式 entries（含软删行）
 * @param opts.yieldEvery 每处理多少条让出一次逻辑层（默认 200）
 * @param opts.pendingRefs 本地 pending/in-flight entry ref 集合（outbox.listPendingEntryRefs
 *   一次性构建）。⚠️ 生产调用方**必须传入**：缺省退化为空集，相等档 pending 闸门静默失效——
 *   本地未上行编辑/软删可能被同 version 拉取覆盖（软删复活）。db 不能自行 import outbox
 *   构建（outbox 已 import db，循环依赖），故采用调用方注入。
 */
export async function applyServerEntriesBatch(
  wires: unknown[],
  opts?: { yieldEvery?: number; pendingRefs?: Set<string> },
): Promise<ApplyEntriesBatchResult> {
  const yieldEvery = opts?.yieldEvery && opts.yieldEvery > 0 ? opts.yieldEvery : 200;
  if (!opts?.pendingRefs && wires.length > 0) {
    logger.warn('db', 'applyServerEntriesBatch without pendingRefs · pending gate degraded（本地未上行改动可能被同 version 覆盖）');
  }
  const pendingRefs = opts?.pendingRefs ?? new Set<string>();

  const monthCache = new Map<string, MonthDelta>();
  let applied = 0;
  let skipped = 0;
  let processed = 0;

  for (const wire of wires) {
    const item = wireToEntry(wire as Record<string, unknown>);
    const local = await getEntity<Entry>('entry', item.client_ref_id);
    if (!shouldApply(local, item, pendingRefs)) {
      skipped++;
    } else {
      await putEntity('entry', item);
      applied++;
      // 累计月索引 delta（含跨月移动：旧月删 + 新月增）
      if (local && local.ledger_id && local.occurred_at) {
        const oldMonth = entryMonthValue(local);
        const d = ensureMonthDelta(monthCache, local.ledger_id, oldMonth);
        d.remove.add(local.client_ref_id);
        d.add.delete(local.client_ref_id);
      }
      if (!item.deleted_at && item.ledger_id && item.occurred_at) {
        const newMonth = entryMonthValue(item);
        const d = ensureMonthDelta(monthCache, item.ledger_id, newMonth);
        d.add.set(item.client_ref_id, { client_ref_id: item.client_ref_id, occurred_at: item.occurred_at });
        d.remove.delete(item.client_ref_id);
      } else if (item.deleted_at && item.ledger_id && item.occurred_at) {
        // 软删：从新月也移除（旧月已在上面处理；若同月则等价）
        const delMonth = entryMonthValue(item);
        const d = ensureMonthDelta(monthCache, item.ledger_id, delMonth);
        d.remove.add(item.client_ref_id);
        d.add.delete(item.client_ref_id);
      }
    }
    if (++processed % yieldEvery === 0) await yieldToEventLoop();
  }

  // ── 批末逐月入队：重读 → 应用 delta → 排序写回（每月一个任务）──────────────
  //
  // ⚠️ 两条实现纪律，缺一不可：
  //
  // 1) **所有月任务必须在同一个同步块内入队完毕**（先收集 promise，最后一起 await）。
  //    这是下面"共享扫描快照"安全性的前提：批末任务全部先于任何后续 mutation/hydrate/
  //    rebuild 的索引任务入队 ⇒ 对同一 key 必定先执行。于是"快照漏掉的后续新实体"总会
  //    由排在其后的 mutation 任务读到已存在的 key 后 merge 补上（不会命中纪律 6 的
  //    `if (!idx) return` 跳过分支）。若改成逐个 await 入队，中间窗口会让 mutation 任务
  //    插到后续月任务之前执行 → 陈旧快照写出的 key 会持久缺掉那一条。
  //
  // 2) **null 重建走 per-batch 共享懒扫描**：只有真的读到 null 才扫描（常态 key 都在，
  //    零成本），且一次 batch 内至多扫一次，被所有 null 月份复用。逐月各扫一次会退化为
  //    O(月数 × 实体数)（首登 24 个月 / 5,000 条 ≈ 6 万次 getEntry）。
  let sharedScan: Promise<Map<string, EntryMonthIndexItem[]>> | null = null;
  const scanOnce = (): Promise<Map<string, EntryMonthIndexItem[]>> => {
    if (!sharedScan) sharedScan = scanEntryMonthGroups();
    return sharedScan;
  };

  const monthTasks: Array<Promise<void>> = [];
  for (const d of monthCache.values()) {
    const key = entryMonthIndexKey(d.ledgerId, d.month);
    monthTasks.push(enqueueIndexWrite(key, async () => {
      const base = await readEntryMonthIndex(d.ledgerId, d.month);
      if (!base && d.add.size === 0) {
        // 纯 remove 的 delta（如首登拉到本地从未存在过的软删行）遇到 key 缺失：
        // 无事可做。此时既不能写空数组（造出"key 存在但只含子集"，与纪律 5/6 同类故障），
        // 也没必要为"什么都不用改"付一次全量扫描 → 保持 key 缺失，交读路径 rebuild 兜底。
        return;
      }
      // §4.5 纪律 5：重读为 null → 走推导重建（只计算不写回，合并 delta 后统一一次写），
      // 绝不把 delta 当全量写回（否则造出"key 存在但只含子集"，
      // listMonthEntries 的 if(!idx) 兜底从此失效 → 持久缺条）。
      const resolved = base ?? pickMonthFromGroups(await scanOnce(), d.ledgerId, d.month);
      const map = new Map<string, EntryMonthIndexItem>();
      for (const it of resolved) map.set(it.client_ref_id, it);
      for (const ref of d.remove) map.delete(ref);
      for (const [ref, it] of d.add) map.set(ref, it);
      const merged = sortEntryMonthIndex([...map.values()]);
      await setItem(key, merged);
    }));
  }
  // allSettled 而非 all：单月索引写失败不应让整批落盘失败向上抛（实体已落盘，
  // 该月由读路径 rebuild 兜底）；也避免 all 提前 reject 后其余任务变成 unhandledRejection。
  const settled = await Promise.allSettled(monthTasks);
  for (const r of settled) {
    if (r.status === 'rejected') {
      logger.warn('db', 'month index write failed in batch · month will be rebuilt on read', r.reason);
    }
  }

  return { applied, skipped, monthsTouched: monthCache.size };
}

// ─── 遗留 entry:__index 一次性清理（bootstrap 调 · §4.4 ①）──────────────────

/**
 * 清理老版本遗留的 entry:__index（L13 废除该 key）。
 * 在 bootstrap（ensureVersion 之后）检测即 removeItem。
 * ⚠️ 不 bump STORAGE_VERSION：版本迁移会清空全部业务 key（含 outbox 未上行 op），
 *   为删一个死 key 付出数据丢失风险不可接受。
 */
export async function cleanupLegacyEntryIndex(): Promise<void> {
  const legacy = await getItem<unknown>(LEGACY_ENTRY_INDEX_KEY);
  if (legacy != null) {
    await removeItem(LEGACY_ENTRY_INDEX_KEY);
    logger.info('db', 'cleaned up legacy entry:__index key');
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

/**
 * 严格写 watermark（仅 L13 epoch reset 使用 · §3.7 / §4.2）。
 *
 * 与普通 setWatermark 的区别：
 *   - 走 setItemStrict：写屏障开启 / wx.setStorage 失败时**抛错**（不吞）；
 *   - 写入后**读回确认**：读回值 !== 期望值时抛错。
 *
 * 目的：epoch diff 分支必须先把 watermark 清零并确认成功，才能写新 epoch。若清零被吞掉
 *   却仍写 epoch，会落到「epoch 新值 + watermark 旧高值」的真丢数据状态（下轮比对一致、
 *   不再重置，洞内行 change_seq < watermark 永远拉不到）。调用方在本函数抛错时须中止本轮、
 *   不写 epoch，等待下轮 sync 重试（幂等无损）。
 */
export async function setWatermarkStrict(familyId: string, watermark: number): Promise<void> {
  if (!Number.isInteger(watermark) || watermark < 0) {
    throw new Error(`setWatermarkStrict: invalid watermark ${watermark}`);
  }
  await setItemStrict<number>(watermarkKey(familyId), watermark);
  // 读回确认：storage envelope 解包后应等于期望值。
  const readBack = await getItem<unknown>(watermarkKey(familyId));
  if (readBack !== watermark) {
    throw new Error(`setWatermarkStrict: read-back mismatch · expected=${watermark} got=${readBack}`);
  }
}

// ─── L13 E1：epoch 记录读写（§4.2）────────────────────────────────────────────

export type LedgerEpochs = Record<string, number>;

/** 读取本地记录的 { [ledgerId]: sync_epoch }；null = 首登/升级（尚未追踪）。 */
export async function readLedgerEpochs(familyId: string): Promise<LedgerEpochs | null> {
  const v = await getItem<LedgerEpochs>(epochKey(familyId));
  return v && typeof v === 'object' ? v : null;
}

/** 写入本地记录的 epoch（追踪当前值）。 */
export async function writeLedgerEpochs(familyId: string, epochs: LedgerEpochs): Promise<void> {
  await setItem<LedgerEpochs>(epochKey(familyId), epochs);
}

// ─── testing-only ─────────────────────────────────────────────────────────────

export const __test__ = {
  flushIndexQueue,
  rebuildEntryMonthIndexBare,
  sameEntryContent: (a: Entry, b: Entry): boolean => sameEntryContent(a, b),
  resetIndexQueue(): void {
    indexQueueTails.clear();
  },
};
