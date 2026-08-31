# sync/pull 分页收敛改造方案（L13）

> 状态：**v0.1 · 待评估**
> 日期：2026-08-28
> 上游：`docs/follow-up/sync-p2-improvements.md` **L13**、`docs/design/data-import-export-client-analysis.md` §5.1（E0 硬前置卡）
> 事实源：`docs/api/sync-protocol.md` §3.2 / §3.3 / §6.3 / §8

---

## 1. 结论摘要

**问题存在，且比 L13 记录的更严重。**

| # | 结论 | 依据 |
|---|---|---|
| C1 | `has_more` 服务端已正确产出，客户端**零消费**，只进 debug 日志 | `server/src/repositories/entryRepo.ts:377-400` vs `miniprogram/services/sync.ts:88` |
| C2 | 收敛模型是 **⌈N/200⌉ 分钟**（不是"分钟级"这种模糊描述）：服务端每轮最多返 200 条，下一轮只能等 `periodic` 60s | `syncScheduler.ts:35,87` + `routes/sync.ts:85` |
| C3 | 协议**早就要求**客户端 `if has_more: retry pull immediately`（§3.3 + `smoke_sync_05` 断言），属于**协议违约**，不是"待优化" | `docs/api/sync-protocol.md:235,380` |
| C4 | L13 的"静默错误合计"**成立，但触发条件记录偏窄**：`_hydrateRemoteMonthEntries` 已兜底"整月为空"，真正的静默错误窗口是「**月内有数据 + 增量未拉完**」 | `ledger/index.ts:943-955` |
| C5 | **L13 未识别的新风险 R1**：把单轮改成紧密循环后，会显著放大 `change_seq` 的「**已取号未提交**」洞，导入场景下可导致 **5,000 条永久不落客户端**。只做客户端循环是**危险**的 | §3.1 |

因此本方案 = **客户端分页循环（C1/C2/C3）+ 服务端批量写入隔离（S1/S2）** 两侧一起改。只做前半段会把 C5 从"低频隐患"变成"高频数据丢失"。

---

## 2. 问题核查（证据链）

### 2.1 服务端：已正确产出 `has_more`

```ts
// server/src/repositories/entryRepo.ts:382-399
const limitPlusOne = cursor.limit + 1;
const res = await runner.query(`... WHERE l.family_id = $1 AND e.change_seq > $2
   ORDER BY e.change_seq ASC LIMIT $3`, [cursor.familyId, cursor.since, limitPlusOne]);
const rows = res.rows.slice(0, cursor.limit).map(...);
return { rows, hasMore: res.rows.length > cursor.limit };
```

`LIMIT n+1` 探测，判定正确；`syncPullService.syncPull` 原样透传（`syncPullService.ts:174`）。

### 2.2 客户端：零消费

```ts
// miniprogram/services/sync.ts:85-100
logger.debug('sync:pull', `... has_more=${resp.has_more}`);   // ← 唯一的用处
if (resp.changes) { await applyServerChanges(resp.changes); ... }
await setWatermark(familyId, resp.watermark);
```

`syncScheduler.syncOnce` 每轮只调一次 `syncPull(familyId, { limit: 200 })`（`syncScheduler.ts:87`），拉完即返回，无循环、无续拉调度。

### 2.3 收敛模型

单次增量 N 条的收敛时间 = `⌈N/200⌉ × 60s`（只有 `periodic` 是稳定触发源；`page-show` 有 5s debounce、`mutation` 只在本地记账时触发，都不保证）。

| N | 轮数 | 收敛时间 |
|---|---|---|
| 200 | 1 | 60s 内 |
| 2,000 | 10 | ~10 min |
| 5,000（导入上限） | 25 | ~25 min |

### 2.4 对 L13 表述的两处修正

**修正一（严重度）**：L13 说"新设备登录老账号 → 明细页先渲染假合计，数字逐轮爬升"。实际上**当前月是安全的**——`_loadEntries` 在本地整月为空且未确认 remote-empty 时会走 `_hydrateRemoteMonthEntries` 全量拉该月（`ledger/index.ts:943-955`），首屏合计正确。

真正的静默错误窗口是：**该月本地已有数据** → 不触发 hydrate → `listMonthEntries` 的 `complete` 只看"本地索引条数 vs 请求 limit"，与服务端是否已收敛无关 → 结算 `ready-full` 并展示**缺口的月度合计**，全程无提示。

典型路径：新设备 hydrate 完当前月后，sync 逐轮回填历史月份；用户切到上个月 → 本地已有部分数据 → 假合计。导入场景同理（当前月已有手工流水 → 导入的当前月数据不触发 hydrate）。

> 严重度不变（静默错误 > 慢），但修复的**接入点**是"结算态判定"，不是 hydrate。见 §4.6。

**修正二（规模）**：L13 写"5000 条必现 25 轮"，这是基于 limit=200。协议 schema 与服务端均支持 `maximum: 500`，改客户端取值即可降到 10 轮（见 §4.4）。

---

## 3. 风险清单

### 3.1 R1（阻断级 · L13 未识别）：`change_seq` 的"已取号未提交"洞

`entries.change_seq` 走 `nextval('entries_change_seq')`，**在 INSERT 语句执行时取号，在 COMMIT 时才可见**（migration 0016 已改为 `CACHE 1`，解决的是跨连接号段乱序，**不解决**取号/提交的时间差）。

批量写入（导入）按 `data-import-export-client-analysis.md` §7.5 的强制要求在**单个事务**内插入 5,000 条 → 该事务持有连续 5,000 个 seq 但长时间不可见。此时的交错：

```
t0  导入事务 T1 取号 [5001, 10000]，未提交
t1  用户记一笔 T2 取号 10001，COMMIT
t2  客户端 pull → 可见行只有 10001 → watermark = 10001
t3  T1 COMMIT → [5001,10000] 可见，但全部 < watermark
    ⇒ 5,000 条在客户端永久不可达（数据没丢在服务端，永远拉不下来）
```

**为什么循环会放大它**：
- 现状：一轮/60s，命中"T1 未提交窗口"的概率 = 窗口时长/60s。导入事务约数秒 → 命中率 ~10%。
- 改紧密循环后：客户端在导入期间会以 200ms~1s 的节奏反复 pull，且**每轮都会把 watermark 推到可见的最新 seq** → 只要 T1 未提交期间有任何一条其他事务提交的行被拉到，整批导入即被跳过。命中概率趋近 1。

也就是说：**只做客户端循环，等于把"导入后数据 25 分钟才到"升级成"导入后数据永远不到"**。这是本方案必须同时改服务端的原因。

> 该风险今天也存在（低频），不是循环引入的；但循环使其从"边缘"变"必然"，且危害从"慢"变"永久丢失"。

### 3.2 R2（性能）：批量落盘的 O(n²) 存储 IO

`applyServerChanges` 逐条处理（`db.ts:388-404`），每条 entry 触发：

| 调用 | 次数 | 数据量级 |
|---|---|---|
| `getEntity` | 1 | O(1) |
| `putEntity` | 1 | O(1) |
| `appendToIndex` → `readIndex` + `setItem` | 2 | **O(n) 全量 `entry:__index`** |
| `reindexEntry` → 月索引读 + 写 | 4 | **O(该月条数)** |

n=5,000 时 `entry:__index` 约 200KB，每次追加都要整读整写 → 累计 **~2GB 的 JSON 序列化 + 上万次 wx storage IPC**。实测风险：主线程长时间卡死、小程序被系统杀掉。**不做批量化改造，循环方案不可用。**

### 3.3 R3（容量）：本地库上限

每条 entry 一个 key（约 400~600B envelope）。5,000 条 ≈ 2.5MB，微信总量上限 10MB。单次导入安全，**多次导入会累积触顶**。本方案不解决容量，但需在循环触顶时打点告警（§4.4）。

### 3.4 R4（协议）：`limit` 与字段扩展

- `limit` 上限 500 已在 schema 与 OpenAPI 中，客户端改取值即可，**无需改协议**。
- 需要新增两个**可选**响应字段（`deferred` / `retry_after_ms`），向后兼容。

---

## 4. 方案设计

### 4.1 总览

```
[服务端]                                   [客户端]
S1 批量写入持 advisory xact lock    ←约定→   （无感知）
S2 /sync/pull 拿不到 lock → deferred  ──→  C1 分页循环：识别 deferred / has_more / 截断
   （limit 保持 500 上限不动）                C2 批量落盘：applyServerEntriesBatch（消除 O(n²)）
                                            C3 未收敛提示：syncProgress + 结算态收口
```

四条改动分别对应四条设计约束（L13 §约束 1/2/3/5），逐条回应见 §4.7。

---

### 4.2 S1：服务端批量写入隔离（消除 R1）

**核心思路**：让"批量写入 entries"与"增量读取"互斥——批量写入期间，pull **不推进 watermark**，而不是"推进后再补救"。

沿用项目既有范式（`recurringScheduler.ts:74-90` 的 advisory lock），但改用**事务级**锁（COMMIT 即自动释放，无需显式 unlock，也不会因进程崩溃残留）。

**新增模块** `server/src/services/syncBulkWriteGuard.ts`：

```ts
/** advisory lock 命名空间 · 与 'RECU'(recurringScheduler) 等其他服务隔离 */
const NAMESPACE_KEY = 0x53594E43; // 'SYNC'

/** 批量写入侧：在写入 entries 的同一事务内、INSERT 之前调用（阻塞获取） */
export async function acquireBulkWriteGuard(client: Runner, ledgerId: string): Promise<void>;

/** 拉取侧：非阻塞探测，false 表示当前有批量写入在进行 */
export async function tryAcquireReadGuard(client: Runner, ledgerId: string): Promise<boolean>;
```

SQL 形态：

```sql
-- 批量写入侧（事务内，阻塞；同账本单任务约束下不会真阻塞）
SELECT pg_advisory_xact_lock($1, hashtext($2)::bigint);

-- 拉取侧（事务内，非阻塞）
SELECT pg_try_advisory_xact_lock($1, hashtext($2)::bigint) AS locked;
```

**工程约定（必须落到文档与 review 检查项）**：

> 任何**绕过 `entryService`**、在同一事务内批量写入 entries 的路径（导入、运维脚本、数据修复），必须在该事务内、INSERT 之前调用 `acquireBulkWriteGuard`。这是 `invalidateLedgerCache` 之后的**第二条批量写入铁律**。

> 若未来出现"分批提交的批量写入"，改用 **session 级** `pg_advisory_lock` 并在批末显式 unlock（独占 PoolClient），语义不变。

**为什么不用"事务末尾重新取号"**：那只能把 T1 的窗口从"整个事务"压缩到"取号→提交"，窗口仍在，且需要 5,000 行二次 UPDATE。不彻底。

**为什么不用 `ledgers.sync_epoch` + 客户端全量重拉**：那是"产生洞之后补救"，需要新 migration + 协议字段 + 客户端重置 watermark；S1 是"不产生洞"，改动更小、失败模式更安全。列为备选 B（§8）。

**死锁分析**：批量写入事务持 `job` 行锁 + advisory lock；pull 事务只持 advisory lock，不持其他锁。无循环等待。同账本导入单任务 → 无同 key 竞争。

---

### 4.3 S2：服务端协议扩展（`deferred`）

`syncPullService.syncPull` 改为在**单个只读事务**内执行 guard 探测 + 查询：

```ts
export interface SyncPullResult {
  watermark: number;
  has_more: boolean;
  /**
   * true = 检测到该账本正在批量写入，本批未读取任何增量、watermark 未推进。
   * 客户端应等待 retry_after_ms 后重试，并视为"数据未收敛"。
   * 与 has_more 互斥（deferred 时 has_more 恒 false）。
   */
  deferred?: boolean;
  /** deferred=true 时给出建议重试间隔（毫秒） */
  retry_after_ms?: number;
  categories_revision: string;
  changes: { entries: unknown[]; categories: unknown[]; budgets: unknown[]; ledgers: unknown[] };
}
```

执行流程：

```
BEGIN
  locked = pg_try_advisory_xact_lock(...)
  IF NOT locked:
      ledgers = listLedgersForFamily()        // 仍下发 ledgers：资产渲染依赖它，不能因 defer 断供
      COMMIT
      return { watermark: since, has_more: false, deferred: true, retry_after_ms: 1000,
               categories_revision, changes: { entries: [], categories: [], budgets: [], ledgers } }
  rows/hasMore = findEntriesByFamilySince(...)
  categories_revision = computeSystemCategoriesRevision()
  ledgers = listLedgersForFamily()
COMMIT
```

要点：
- **deferred 时 watermark 严格不变**（协议 §6.3 单调铁律）→ 中断可续、不回退。
- **deferred 时仍下发 ledgers**：记忆中"资产依赖 sync-pull 的 ledgers[] 增量"，断供会让资产停在旧值。
- `categories_revision` 每轮照常返回（签名计算不依赖 guard）。
- 测试环境（pg-mem）无 advisory lock → 沿用 `recurringScheduler.ts:75` 的既有处理：`isTestEnv()` 时 `tryAcquireReadGuard` 直接返回 `true`。

同步更新 `server/api/openapi.yaml` 的 `SyncPullResponse`（新增两个 optional 字段，`required` 不变）。

---

### 4.4 C1：客户端 `syncPull` 分页循环

`miniprogram/services/sync.ts` 改造：

```ts
export interface SyncPullOutcome {
  watermark: number;
  /** 本次累计落库的 entry 条数（跨所有分页） */
  pulled: number;
  /** 实际发出的请求轮数 */
  pages: number;
  /** 因达到 MAX_PULL_PAGES 或放弃 deferred 重试而仍有剩余 */
  hasMore: boolean;
  /** 最终仍被批量写入挡住 */
  deferred: boolean;
}

const PULL_LIMIT = 500;          // 协议上限 · 5,000 条 → 10 轮
const MAX_PULL_PAGES = 40;       // 20,000 条/次 · 超出即截断并安排续拉
const MAX_DEFER_RETRIES = 3;     // deferred 退避重试次数

export async function syncPull(
  familyId: string,
  opts?: { limit?: number; maxPages?: number; yieldBetweenPages?: boolean },
): Promise<SyncPullOutcome>
```

循环骨架：

```
since = await getWatermark(familyId)
loop:
  resp = GET /sync/pull { family_id, since, limit }
  if (resp.deferred):
      markCatchingUp(familyId, 'deferred')
      if (++deferRetries <= MAX_DEFER_RETRIES) { await sleep(resp.retry_after_ms ?? 1000); continue }
      break with deferred = true
  if (watermark 非法) break
  await applyServerEntriesBatch(resp.changes.entries)     // C2
  await applyLedgerBalanceFromSync(...) for ledgers
  await setWatermark(familyId, resp.watermark)            // 每轮落盘 · 中断可续
  since = resp.watermark; pulled += n
  maybeRefreshCategoriesByRevision(...)                   // 首轮即可，签名与分页无关
  if (!resp.has_more) { clearCatchingUp(familyId, 'has-more'); break }
  markCatchingUp(familyId, 'has-more')
  if (++pages >= maxPages) break with hasMore = true      // 截断
  await yieldToEventLoop()                                // 批间让出主线程
  if (logout 屏障已开) break                               // storage 写屏障会自动吞掉写入，主动退出更省
finally:
  clearCatchingUp(familyId, 'deferred') unless deferred
```

要点回应 L13 约束：

| 约束 | 处理 |
|---|---|
| watermark 逐轮推进并落盘 | 每轮 `setWatermark`；中断后 `since` 从上次落盘值续，不回退到 0 |
| 迭代上限 + 批间让出 | `MAX_PULL_PAGES=40`；每轮间 `await yieldToEventLoop()`（`setTimeout(0)` 宏任务，允许渲染帧插入） |
| 不要每轮 emit `SYNC_DONE` | 循环封闭在 `syncPull` 内，`syncOnce` 只在返回后广播一次 → 明细页不逐轮跳动 |
| 服务端 limit 与客户端取值 | 客户端 200 → **500**（协议/schema 已支持，服务端上限不动）；响应体 ~200KB/轮，可接受 |

**截断后续**：`syncOnce` 在 `pullResult.hasMore === true` 时安排一次续拉，不依赖 60s：

```ts
if (pullResult.hasMore) {
  setTimeout(() => void syncOnce('pull-continue'), 300);   // 新增 TriggerSource
}
```

`syncScheduler.ts` 需同步：`TriggerSource` 联合类型加 `'pull-continue'`，`eventBus.ts` 的 `SyncDonePayload.trigger` 联合类型同步加。

**互斥交互**：长循环期间 `isRunning === true`，其他触发走既有 `pendingRetrigger` 路径（结束后 100ms 重触发一次 `syncOnce('mutation')`）。语义保持：合并触发，不并发。截断场景由上面的续拉定时器兜底，`pendingRetrigger` 与它最多各触发一次，mutex 保证不并发。

---

### 4.5 C2：客户端批量落盘（消除 R2）

`miniprogram/services/db.ts` 新增，**不改动** `applyServerChanges`（单条路径保留给 push 回填等场景）：

```ts
export interface ApplyEntriesBatchResult {
  /** 实际写入的条数 */
  applied: number;
  /** 因本地版本不低于服务端而跳过的条数 */
  skipped: number;
  /** 触及的月索引数量（用于 perf 打点） */
  monthsTouched: number;
}

export async function applyServerEntriesBatch(
  wires: unknown[],
  opts?: { yieldEvery?: number },   // 默认 200 · 每 N 条让出一次事件循环
): Promise<ApplyEntriesBatchResult>;
```

内部流程（关键是把"每条 O(n)"降成"每批 O(n)"）：

```
1. index      = await readIndex('entry');   indexSet = new Set(index)      // 只读一次
2. monthCache = new Map<monthKey, EntryMonthIndexItem[]>()                  // 懒加载，每月只读一次
3. pendingDeletes = new Set<string>()                                       // 需要从 index 移除的 ref
4. for (wire of wires):
     item = wireToEntry(wire)
     local = await getEntity('entry', item.client_ref_id)                   // 单 key 读，必需
     if (跳过条件与 applyServerChanges 完全一致: deleted 分支 / version 比较) { skipped++; continue }
     await putEntity('entry', item)                                         // 单 key 写，必需
     if (deleted) { pendingDeletes.add(ref); monthCache 中移除 }
     else         { indexSet 中新增;          monthCache 中 upsert }
     applied++
     每 yieldEvery 条 → await yieldToEventLoop()
5. await setItem(indexKey('entry'), [...indexSet 过滤 pendingDeletes])      // 全批一次写回
6. for (const [key, items] of monthCache) await setItem(key, sortEntryMonthIndex(items))
```

收益（n=5,000）：

| | 现状 | 批量化后 |
|---|---|---|
| storage 调用次数 | ~8n ≈ 40,000 | ~2n + 月数 + 1 ≈ 10,0xx |
| 涉及 O(n) 数组的读写 | ~6n ≈ 30,000 次 × 200KB | n/批次无关 · 常量次 |
| 主线程让出 | 无 | 每 200 条一次 |

**语义必须与 `applyServerChanges` 完全一致**（版本比较方向、软删分支、`removeFromIndex`/`reindexEntry` 的净效果），否则会出现"循环拉与单条拉结果不同"的诡异差异。实现上应把判定抽成 `shouldApplyEntry(local, item)` 供两条路径共用。

---

### 4.6 C3：客户端"未收敛"提示（消除静默错误）

**新模块** `miniprogram/services/syncProgress.ts`（进程内状态，不落 storage）：

```ts
export type CatchUpReason = 'has-more' | 'deferred';

export function markCatchingUp(familyId: string, reason: CatchUpReason): void;
export function clearCatchingUp(familyId: string, reason: CatchUpReason): void;
/** 页面结算态判定用：服务端明确告知"还有更多"或"被批量写入挡住" */
export function isSyncCatchingUp(familyId: string): boolean;
export const __test__: { reset(): void };
```

**为什么不用 `pullInFlight` 作为信号**：60s 一次的 periodic 心跳会让它每轮短暂为 true，页面结算态会闪烁。只用两个**明确信号**（`has_more` / `deferred`），心跳（空响应）不触发。上一轮结论 `has_more=false` 在飞行期间仍然成立，可以正常结算。

**ledger 页改造**：新增统一的结算收口，替换 4 处散落的 `ready-full` 判定：

```ts
_settleLedgerDataState(monthValue: string, count: number): void {
  if (isSyncCatchingUp(this._familyId)) {
    this.setData({ totalExpense: '同步中', totalBalance: '数据持续更新中…' });
    this._setLedgerLoadingState('ready-partial', '正在同步全部数据…');
    return;
  }
  this._setLedgerLoadingState(count > 0 ? 'ready-full' : 'empty-confirmed');
}
```

替换点（`miniprogram/pages/ledger/index.ts`）：

| 行 | 方法 | 说明 |
|---|---|---|
| 972-981 | `_loadEntries` | 冷加载结算 |
| 1168 | `_loadFullMonthEntries` | 本地全量读结算 |
| 1185 | `_reloadCurrentMonthSilently` | 热刷新结算 |
| 1235 | `_refreshIfChanged` | SYNC_DONE 后结算 |
| 1077 | `_hydrateRemoteMonthEntries` | **不改**：该路径已从服务端拉全该月，数据完整，即使 catchingUp 也应结算 ready-full |

收敛完成后，`syncOnce` 广播一次 `SYNC_DONE` → `_refreshIfChanged` → 此时 `isSyncCatchingUp=false` → 结算 `ready-full` 并显示正确合计。无需新增事件订阅。

**不需要改统计页 / 协作页**：两者都走服务端实时聚合（`statisticsApi` / `familyApi`），不受本地未收敛影响。

**不需要持久化**：页面 `onLoad` 时若本地数据本就落后，服务端下一轮 pull 会给出 `has_more=true` 并置位，随后 SYNC_DONE 触发重结算。

---

### 4.7 与既有机制的交互（逐条确认）

| 既有机制 | 交互 | 结论 |
|---|---|---|
| `SYNC_DONE` 广播条件（`pushed>0 \|\| pulled>0`） | 循环封闭在 `syncPull` 内，`pulled` 累计 | 仍只广播一次 ✓ |
| `pendingRetrigger`（L6） | 长循环期间 `isRunning=true` → 外部触发合并 | 结束后 100ms 重触发 ✓ |
| conflict-retry（1s × 3） | 与续拉定时器独立；两者都走 `syncOnce` mutex | 不并发 ✓ |
| `_hydrateRemoteMonthEntries` | 与 pull 并发时都写月索引，按 `client_ref_id` 去重 | 幂等，无冲突 ✓ |
| `applyLedgerBalanceFromSync` | 每轮都下发 ledgers（含 deferred 轮） | 资产不断供 ✓ |
| storage 写屏障（logout） | `setItem` 出口已兜底 | 循环额外主动检查屏障提前退出，省无效请求 |
| `localReset.ts` 登记 | 新增 `syncProgress` 模块级 `Map` 状态 | **需登记**（小程序约定：新增模块级缓存必须在 `localReset.ts` 登记） |

---

## 5. 改动清单

### 服务端

| 文件 | 改动 |
|---|---|
| `server/src/services/syncBulkWriteGuard.ts` | **新增** · `acquireBulkWriteGuard` / `tryAcquireReadGuard` |
| `server/src/services/syncPullService.ts` | 包事务 + guard 探测 + `deferred` / `retry_after_ms` 字段；deferred 时仍下发 ledgers |
| `server/src/repositories/entryRepo.ts` | `findEntriesByFamilySince` 支持传入 `Runner`（已支持 `client?`，确认透传即可） |
| `server/api/openapi.yaml` | `SyncPullResponse` 新增两个 optional 字段 |
| `docs/api/sync-protocol.md` | §3.2/§3.3 补 `deferred` 语义与客户端重试要求 |

### 小程序

| 文件 | 改动 |
|---|---|
| `miniprogram/services/sync.ts` | `syncPull` 分页循环 + `SyncPullOutcome` 返回；limit 500 |
| `miniprogram/services/db.ts` | 新增 `applyServerEntriesBatch`；抽出 `shouldApplyEntry` 供两条路径共用 |
| `miniprogram/services/syncProgress.ts` | **新增** · catching-up 状态 |
| `miniprogram/services/syncScheduler.ts` | 适配新返回值（`pulled`）；新增 `'pull-continue'` 触发源与续拉调度 |
| `miniprogram/services/eventBus.ts` | `SyncDonePayload.trigger` 加 `'pull-continue'` |
| `miniprogram/pages/ledger/index.ts` | 新增 `_settleLedgerDataState`，替换 4 处结算点 |
| `miniprogram/services/localReset.ts` | 登记 `syncProgress` 重置 |
| `miniprogram/utils/deferredLoading.ts` 或 `sync.ts` | 一个 `yieldToEventLoop()`（若无可复用实现则新增） |

### 测试

| 文件 | 用例 |
|---|---|
| `server/test/sync-pull.test.ts` | T9/T16 扩展；新增：deferred 语义（mock guard 失败）→ watermark 不变 + ledgers 仍下发 + `retry_after_ms` |
| `miniprogram/services/sync.spec.ts`（新增或扩展） | 分页循环：3 页后 has_more=false → pulled 累计 / pages=3 / watermark 单调；截断 → hasMore=true；deferred 退避 3 次后放弃 |
| `miniprogram/services/db.spec.ts` | `applyServerEntriesBatch` 与 `applyServerChanges` 结果等价（同输入 → 同本地状态）；软删分支；版本比较方向 |
| `miniprogram/services/syncScheduler.spec.ts` | mock 返回值结构适配；新增 `pull-continue` 调度用例 |
| `qa/` 冒烟 | `smoke_sync_05`（协议 §8 已定义：pull 返回 `has_more=true` → 客户端立即二次 pull + watermark 单调推进） |

---

## 6. 验收口径

对齐 L13 原定标准，并补 R1 相关项：

1. 新设备登录 5,000 条流水的账号，首拉到完整收敛 **≤ 60s**（前台持续在线）。
2. 收敛期间明细页**不显示 `ready-full` 的伪精确合计**（走 `ready-partial` + "正在同步全部数据…"）。
3. 中断（杀小程序 / 断网）后恢复**不从头重拉**，从上次落盘 watermark 续。
4. **R1 验收（新增）**：导入任务执行期间客户端持续触发 pull，导入 COMMIT 后 **5,000 条全部可达**（watermark 未被推过）。
5. 不回归既有用例：`db.spec.ts` watermark 单调性、`syncScheduler` 的 mutex 与 conflict-retry、服务端 T7~T16。

---

## 7. 备选方案与取舍

| 项 | 备选 | 取舍 |
|---|---|---|
| R1 解法 | **A（advisory lock 隔离 · 推荐）** | 不产生洞；无 migration；沿用既有范式；失败模式是"延迟"而非"丢失" |
| | B（`ledgers.sync_epoch` + 客户端重置 watermark 全量重拉） | 需要新 migration + 协议字段 + 客户端清状态；是"补救"，洞已产生；多一条状态需与 logout/localReset 联动。**不推荐**，但可作为 A 的兜底叠加（若担心批量写入路径漏遵守约定） |
| | C（导入事务末尾重新 `nextval` 覆盖 change_seq） | 5,000 行二次 UPDATE；窗口只缩小不消除；**不推荐** |
| | D（导入分批提交，缩短事务） | 破坏 §7.5 强制的"数据 + 成功状态同一事务"幂等性；**不推荐** |
| 未收敛提示 | 持久化 `sync:catchup:{familyId}` 到 storage | 需与 logout / localReset / 写屏障联动，复杂度显著上升；进程内状态 + SYNC_DONE 重结算已足够。**不推荐** |
| 落盘优化 | 改造 `applyServerChanges` 本身为批量感知 | 会改变单条路径的调用语义（push 回填等）；新增独立批量 API 更干净。**推荐后者** |

---

## 8. 待决策项（请评估）

1. **S1 的 lock 粒度**：按 `ledger_id`（当前 1:1 家庭-账本，等价 family 维度）还是按 `family_id`？倾向 `ledger_id`——锁语义更贴近"写入对象"，未来 1:N 时不会误伤同家庭其他账本。
2. **`MAX_PULL_PAGES = 40`（20,000 条/次）是否合适**：导入上限 5,000 条只需 10 轮；40 是为老账号首登留的余量。加大则单次 sync 占用更久，减小则截断续拉更频繁。
3. **`retry_after_ms` 默认 1000ms / 最多退避 3 次**：导入事务预计数秒，3 次退避大概率覆盖；覆盖不到则由 `periodic` 60s 兜底。是否加大到 5 次？
4. **R3 容量是否同期处理**：本次只加告警打点，不做容量治理。若计划支持多次累计导入，需另开课题（本地库分片 / 只保留 N 个月本地明细）。
5. **是否同步回填 `docs/follow-up/sync-p2-improvements.md` L13**：评估通过后再把本方案链接回填并标为"已排期"，L13 正文保持"只录问题"的定位。
