# BUG: 复制流水时资产间歇性不更新 · 根因分析与修复方案

> **状态**：已分析完根因，待落地修复
> **创建日期**：2026-08-10
> **承接**：下一个对话直接按本文 §5 落地

---

## 1. 现象

用户在明细页（`miniprogram/pages/ledger/`）长按流水 → "复制流水"后，头部资产数值有时不会随之更新；多复制几次，有的复制能触发更新，有的不能。表现为**间歇性、非确定性**的"资产停滞"。

### 1.1 用户触发路径

1. 用户在明细页长按一条流水 → 弹出上下文菜单 → 点"复制流水"
2. `_copyEntry`（`miniprogram/pages/ledger/index.ts` 第 2089-2173 行）执行：
   - `putEntry(newEntry)` 本地落库新流水
   - `enqueue({ op: 'create', entity: 'entry', ... })` 入队 outbox
   - `eventBus.emit(EventNames.ENTRY_SAVED)` 刷新列表（只刷流水列表，不刷资产）
3. outbox 入队触发 `OUTBOX_ENQUEUED` → `syncOnce('mutation')` → `pushDelta()` + `syncPull()`
4. 服务端 `createEntry` 事务内：`insertEntry` + `applyBalanceDelta` 累加资产
5. sync-pull 下发 `ledgers[]` → 客户端 `applyLedgerBalanceFromSync` 写缓存
6. `SYNC_DONE` 事件 → 明细页 `_renderAssetFromCache` 从缓存渲染资产

### 1.2 已排除的非根因

| 嫌疑点 | 排除理由 |
|---|---|
| `client_ref_id` 碰撞导致 create 被去重 | `newClientRefId` 是标准 UUID v4，碰撞概率忽略 |
| `batchKey` 幂等键复用导致请求被缓存 | `drainBatch` 每次 `newIdemKey()`，且 `ackBatchFailure` 重试时换新 key |
| 服务端 `ledgers[]` 下发受 cursor/limit 影响 | `listLedgersForFamily` 无视 `since`，每次无条件全量下发该 family 第一行 active ledger |
| 客户端 `applyLedgerBalanceFromSync` 漏写缓存 | 无任何 version/skip 条件，无条件 `MEMORY_CACHE.set + setItem` |
| 客户端 `SYNC_DONE` 不广播 | `syncOnce` 在 `pushed > 0 \|\| pulled > 0` 时广播；create op 推上去后 `pushed > 0` 必然成立 |
| `ENTRY_SAVED` 抵消（之前修过的 create+delete bug） | 本次只复制不删除，outbox 中只有一条 create，不会抵消 |

---

## 2. 根因：`entries_change_seq` 用了 `CACHE 100`，序列跨连接不单调

### 2.1 关键代码

```sql
-- server/db/migrations/0001_init.sql L51-52
CREATE SEQUENCE IF NOT EXISTS entries_change_seq
  AS BIGINT START WITH 1 INCREMENT BY 1 CACHE 100 NO CYCLE;
```

```typescript
// server/src/db/pool.ts L34-41
const cfg: PoolConfig = {
  connectionString: appEnv().databaseUrl,
  max: 10,                          // ← 连接池最多 10 个连接
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};
```

### 2.2 PG 官方语义

PostgreSQL 文档原文：

> Although multiple sessions are guaranteed to allocate **distinct** sequence values, the values might be **generated out of sequence** when all the sessions are considered... with a cache setting greater than one you should only assume that the nextval values are all distinct, **not that they are generated purely sequentially**.

也就是说 `CACHE 100` 下：
- 每个后端连接（session）首次 `nextval` 时**预取一整块 100 个值**到本地内存
- 不同连接拿到的块互不重叠，但**提交顺序不保证 seq 顺序**
- 例：连接 C1 预留 1001–1100，连接 C2 预留 1101–1200
  - 请求落在 C2 上先插了一条 → `change_seq = 1101`
  - 之后请求落回 C1 → 拿到 `1002` —— **时间更晚，seq 更小**

### 2.3 为什么只在 rebase 之后暴露

```sql
-- server/src/repositories/ledgerRepo.ts L195-200 · applyBalanceDelta
UPDATE ledgers
   SET balance_cents   = balance_cents + $2,
       balance_version = balance_version + 1
 WHERE id = $1
   AND $3 > balance_baseline_seq   -- ← 幂等谓词
```

```sql
-- server/src/repositories/ledgerRepo.ts L279-282 · rebaseBalance
balance_baseline_seq = COALESCE(
  (SELECT MAX(change_seq) FROM entries WHERE ledger_id = $1),
  0
)
```

**两种状态对比**：

| 状态 | `balance_baseline_seq` | 行为 |
|---|---|---|
| **未 rebase 过** | `0` | `$3 > 0` 恒成立 → 谓词形同虚设 → create 总是叠加 → 问题被掩盖 |
| **rebase 之后** | `MAX(change_seq)`（大概率来自"高块"连接，如 1101） | 落在"低块"连接 C1 上的 create 拿到 `1002` → `1002 > 1101` 为假 → **balance 静默不变** |

`idleTimeoutMillis: 30_000` 让空闲 30s 的连接被回收，重连时重新预取一块（通常更高）→ "等一会儿再试就好了"的玄学感。连续快速复制时还在同一批低块连接上 → "多复制几次有的能更新"对应偶尔落在高块连接上。

### 2.4 被违反的全局不变量

代码中多处写有"PG SEQUENCE 严格单调递增"的假设，**全是错的**：

- `server/src/repositories/entryRepo.ts` L36：
  ```typescript
  /**
   * 同步引擎一致性水位（BUG-COSTRA-154 v1.2 升级 · 2026-05-22）
   * - PG SEQUENCE entries_change_seq 严格单调递增 · 不依赖时钟
   */
  changeSeq: number;
  ```
- `server/db/migrations/0012_ledger_asset.sql` L33-35 注释：
  ```sql
  COMMENT ON COLUMN ledgers.balance_baseline_seq IS
  '资产累加基线（entries.change_seq）。...
   全库共用一个 entries_change_seq SEQUENCE，不同账本 seq 交错，但单账本内部严格单调。';
  --                                                                                      ^^^^ 错误
  ```

---

## 3. 连带影响

### 3.1 方案 B 的前提同样不成立

上一轮已经落地的"方案 B"（见 `server/src/services/entryService.ts` L470-484 update 路径、L529-538 softDelete 路径）注释写"newSeq 一定 > balance_baseline_seq"，在 `CACHE 100` 下同样不成立 —— rebase 后删/改旧流水依然会间歇性失效，只是概率低一些（rebase 后再立刻改同一条流水的概率较低）。

### 3.2 sync-pull watermark 可能永久丢数据（更严重）

```sql
-- server/src/repositories/entryRepo.ts L382-392 · findEntriesByFamilySince
SELECT e.id, e.ledger_id, ... , e.change_seq ...
  FROM entries e
  JOIN ledgers l ON l.id = e.ledger_id
 WHERE l.family_id = $1
   AND e.change_seq > $2          -- ← since = 客户端 watermark
 ORDER BY e.change_seq ASC
 LIMIT $3
```

客户端把每批最大 seq 存为 watermark（`sync.ts` L94 `setWatermark`）。**一条后提交但 seq 更小的流水会被永久跳过**：
- 服务端在 C2 插了 `1101`，客户端拉到 watermark=1101
- 之后服务端在 C1 插了 `1002`（时间更晚）
- 客户端再次 pull 时 `WHERE change_seq > 1101` → `1002` 永远拉不到

本机因为有本地副本看不出来；**换设备 / 重装 / 协作方就是真丢数据**。

### 3.3 影响范围估计

- 量级上，单用户每次 create 分配一个 seq，`CACHE 100` 的窗口可长达数十分钟（要等当前连接的 100 个值用完才换块）
- rebase 频率：用户修改资产时触发一次
- 触发条件：rebase 之后、且后续 create 落在 seq 块低于 baseline 的连接上
- 实际发生概率：取决于连接池使用模式，但一旦发生即静默无错

---

## 4. 修复方案

### 4.1 方案 ①：修复全局不变量（新 migration）

```sql
-- server/db/migrations/00XX_entries_change_seq_cache_1.sql
ALTER SEQUENCE entries_change_seq CACHE 1;
```

PG 文档：`cache = 1` 时才可以假设 nextval 顺序生成。这个序列的语义就是"全局单调水位"，`CACHE 100` 是纯粹的配置错误。本项目量级下，每次 nextval 多一次轻量锁，开销可忽略。

### 4.2 方案 ②：把资产正确性从"序列顺序"假设上彻底解耦 —— 删掉 baseline 谓词

落地方案 B 之后，`balance_baseline_seq` 谓词已经**没有任何剩余作用**，只剩制造本 bug：

- **create 路径**：`insertEntry` + `applyBalanceDelta` 在同一事务，重放被 `uq_entries_ledger_client_ref` 唯一约束整体回滚 → **天然恰好一次**
- **update / softDelete 路径**：同事务 + entry 级乐观锁 `version = baseVersion`，第二次必然 miss 并在调用 balance 更新**之前**就 `return null` → **天然恰好一次**

幂等性由"同事务 + 唯一约束/乐观锁"提供，与 seq 大小**完全无关**。谓词是冗余的死逻辑，且有害（只会静默吞掉合法更新，永远不会救回什么）。

#### 4.2.1 具体改动

**`server/src/repositories/ledgerRepo.ts`**

```typescript
// applyBalanceDelta（L182-203）：去掉 WHERE 中的 baseline 谓词
export async function applyBalanceDelta(
  input: { ledgerId: string; delta: number; newSeq: number },
  client?: Runner,
): Promise<boolean> {
  if (input.delta === 0) return false;
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET balance_cents   = balance_cents + $2,
            balance_version = balance_version + 1
      WHERE id = $1`,
    [input.ledgerId, input.delta],
  );
  return (res.rowCount ?? 0) > 0;
}
```

```typescript
// applyBalanceSwap（L222-253）：去掉两个 CASE WHEN 谓词，改为无条件加减
export async function applyBalanceSwap(
  input: {
    ledgerId: string;
    oldDelta: number;
    newDelta: number;
    oldSeq: number;   // 保留入参以兼容现有调用方，但 SQL 不再使用
    newSeq: number;
  },
  client?: Runner,
): Promise<boolean> {
  if (input.oldDelta === 0 && input.newDelta === 0) return false;
  const runner = client ?? exec();
  const oldRefund = -input.oldDelta;
  const res = await runner.query(
    `UPDATE ledgers
        SET balance_cents   = balance_cents + $2 + $3,
            balance_version = balance_version + 1
      WHERE id = $1`,
    [input.ledgerId, oldRefund, input.newDelta],
  );
  return (res.rowCount ?? 0) > 0;
}
```

```typescript
// rebaseBalance（L267-291）：只保留"设绝对值"，仍推进 baseline 用于审计
// 不改 SQL，只是注释明确：baseline 推进仅为审计/兼容，不再用于资产谓词
```

**`server/src/services/entryService.ts`**

- L470-484 update 路径：恢复 `oldSeq` 入参（不再需要传 `newSeq` 作为 oldSeq 兜底）
- L529-538 softDelete 路径：`applyBalanceDelta` 的 `newSeq` 入参可传任意值（SQL 不再用它判断），保留 `result.changeSeq` 不影响
- 删除"newSeq 一定 > balance_baseline_seq"的错误注释，改为说明"幂等由同事务 + 乐观锁保障"

**`server/src/repositories/entryRepo.ts`**

- L34-41 `changeSeq` 字段注释：删除"严格单调递增"的表述，改为"严格 distinct，不保证跨连接时间顺序；CACHE 1 下单调"

**`server/db/migrations/0012_ledger_asset.sql` 注释**

- L33-35 `balance_baseline_seq` COMMENT：改为"审计字段，记录 rebase 时的 MAX(change_seq)；不再用于资产累加谓词"

**`balance_baseline_seq` 列降级**：保留为审计列（wire 协议先保留兼容，避免客户端老版本解析失败），后续可单独 migration 下线。

### 4.3 方案 ③：sync watermark 残余风险（独立课题，本次不混改）

`CACHE 1` 只消除了"块乱序"这个大窗口（可长达数十分钟），"先取号后提交"的毫秒级并发窗口仍在：
- 事务 A 先 `nextval` 拿到 seq=100，事务 B 后 `nextval` 拿到 seq=101
- 事务 B 先 COMMIT，事务 A 后 COMMIT
- 客户端拉到 watermark=101 后，再拉 `> 101` → 永远拉不到 seq=100 那条

这是独立的设计课题（安全水位回退 / 基于快照的游标 `xmin`），**不建议和本次混改**。`CACHE 1` 已经把窗口从"数十分钟"压到"毫秒级"，残余风险等级显著降低，可单独立项跟进。

---

## 5. 落地步骤

### 5.1 代码改动清单

1. **新建 migration** `server/db/migrations/00XX_entries_change_seq_cache_1.sql`：
   ```sql
   ALTER SEQUENCE entries_change_seq CACHE 1;
   ```

2. **`server/src/repositories/ledgerRepo.ts`**：
   - `applyBalanceDelta`：删除 `AND $3 > balance_baseline_seq` 谓词
   - `applyBalanceSwap`：改为无条件加减，删除两个 `CASE WHEN ... > baseline`
   - `rebaseBalance`：SQL 不变，更新注释说明 baseline 仅审计用

3. **`server/src/services/entryService.ts`**：
   - update 路径（L475-484）：恢复 `oldSeq`，删除"newSeq 一定 > baseline"的错误注释
   - softDelete 路径（L535-538）：保留 `result.changeSeq`，更新注释说明幂等由同事务 + 乐观锁保障

4. **`server/src/repositories/entryRepo.ts`** L34-41：修正 `changeSeq` 字段注释

5. **`server/db/migrations/0012_ledger_asset.sql`** L33-35：修正 `balance_baseline_seq` 的 COMMENT

### 5.2 测试改动清单

**`server/test/balance-and-budget.test.ts`**：

- B7（rebase 后 update 旧流水）：结果保持 9700（方案 B 行为不变，因为谓词被删后 oldDelta 仍回退、newDelta 仍叠加）
- B8（rebase 后 softDelete 旧流水）：结果保持 10500（同理）
- **新增 B9**：验证 `CACHE 1` 下序列跨连接单调（需要多连接并发测试，可能需要 pg-mem 特殊处理或跳过）
- **新增 B10**：验证 baseline 谓词删除后，create/update/softDelete 的事务级幂等性仍由唯一约束/乐观锁保障
- 检查是否有测试断言 `balance_baseline_seq` 参与资产计算的旧行为，如有则更新

### 5.3 验证步骤

1. 跑 `cd server && npx vitest run` 确保 487+ 测试全过
2. 跑 migration：`psql ... -f server/db/migrations/00XX_entries_change_seq_cache_1.sql`
3. 验证序列：`SELECT last_value, cache_size FROM pg_sequences WHERE sequencename = 'entries_change_seq';` 应为 `cache_size = 1`
4. 复现场景验证：rebase → 连续复制多条流水 → 每条都应触发资产更新
5. 协作端验证：两台设备并发记账，确认 sync-pull 不丢数据

### 5.4 回归风险

- **低**：方案 ② 是"删冗余谓词"，幂等性本就由同事务 + 唯一约束/乐观锁提供
- **中**：方案 ① 改序列 CACHE 影响所有 `nextval` 调用，但本项目量级下性能影响可忽略
- **注意**：migration `ALTER SEQUENCE ... CACHE 1` 会立即生效，但已预取的旧块不会回滚；建议在低峰期执行

---

## 6. 相关文件索引

### 6.1 服务端

| 文件 | 关键位置 | 作用 |
|---|---|---|
| `server/db/migrations/0001_init.sql` | L51-52 | 序列定义（`CACHE 100` 的根因） |
| `server/db/migrations/0012_ledger_asset.sql` | L25-38 | 资产字段 + baseline 注释 |
| `server/src/db/pool.ts` | L34-41 | 连接池配置（`max: 10`） |
| `server/src/repositories/ledgerRepo.ts` | L182-203 | `applyBalanceDelta`（含 baseline 谓词） |
| `server/src/repositories/ledgerRepo.ts` | L222-253 | `applyBalanceSwap`（含双 CASE WHEN 谓词） |
| `server/src/repositories/ledgerRepo.ts` | L267-291 | `rebaseBalance`（推进 baseline） |
| `server/src/repositories/entryRepo.ts` | L34-41 | `changeSeq` 字段错误注释 |
| `server/src/repositories/entryRepo.ts` | L141-160 | `insertEntry`（`DEFAULT nextval`） |
| `server/src/repositories/entryRepo.ts` | L220 | `updateEntryByVersion`（`SET change_seq = nextval`） |
| `server/src/repositories/entryRepo.ts` | L241-255 | `softDeleteEntry`（`SET change_seq = nextval`） |
| `server/src/services/entryService.ts` | L354-394 | `createEntry`（调用 `applyBalanceDelta`） |
| `server/src/services/entryService.ts` | L396-494 | `updateWithVersion`（调用 `applyBalanceSwap`） |
| `server/src/services/entryService.ts` | L496-548 | `softDelete`（调用 `applyBalanceDelta`） |
| `server/src/services/syncPullService.ts` | L160-220 | `syncPull`（下发 `ledgers[]` 全量） |
| `server/src/repositories/entryRepo.ts` | L375-395 | `findEntriesByFamilySince`（sync-pull watermark 查询） |
| `server/test/balance-and-budget.test.ts` | B7/B8 测试 | rebase + update/softDelete 测试 |

### 6.2 客户端

| 文件 | 关键位置 | 作用 |
|---|---|---|
| `miniprogram/pages/ledger/index.ts` | L2089-2173 | `_copyEntry`（复制流水入口） |
| `miniprogram/pages/ledger/index.ts` | L509-523 | `SYNC_DONE` 订阅 → `_renderAssetFromCache` |
| `miniprogram/pages/ledger/index.ts` | L2720-2748 | `_renderAssetFromCache` / `_renderAsset` |
| `miniprogram/services/ledgerBalanceApi.ts` | L142-159 | `applyLedgerBalanceFromSync`（写缓存） |
| `miniprogram/services/sync.ts` | L85-92 | sync-pull 后写 ledger 缓存 |
| `miniprogram/services/sync.ts` | L144-202 | `pushDelta`（推送 outbox） |
| `miniprogram/services/syncScheduler.ts` | L50-188 | `syncOnce`（含 `SYNC_DONE` 广播条件） |
| `miniprogram/services/outbox.ts` | L163-231 | `enqueue`（含 op 合并逻辑） |

### 6.3 历史背景

- **BUG-COSTRA-154 v1.2 升级**（2026-05-22）：sync watermark 从字符串微秒 ISO 改为 BIGINT `change_seq`，前提假设"PG SEQUENCE 严格单调递增"——此假设在 `CACHE 100` 下错误
- **COSTRA-4xx 资产功能**（migration 0012）：新增 `balance_baseline_seq` 列，谓词设计意图是"防 rebase 后旧流水重复叠加"，但实际成了本 bug 的元凶
- **方案 B**（2026-08-10 上一轮落地）：把 `softDelete`/`update` 的旧贡献回退从 `oldSeq` 改为 `newSeq`，前提"newSeq 一定 > baseline"在 `CACHE 100` 下同样错误

---

## 7. 给下一个对话的交接说明

1. **直接从 §5 落地**，不需要重新分析根因
2. **先跑 §5.3 验证步骤的第 3 步**（`SELECT cache_size FROM pg_sequences`）确认当前生产/测试环境的 `CACHE` 值，坐实根因
3. **改动顺序**：先 migration → 再改 `ledgerRepo.ts` SQL → 再改 `entryService.ts` 注释和入参 → 再改 `entryRepo.ts` 注释 → 最后更新测试
4. **跑测试**：`cd server && npx vitest run`，确保全过
5. **更新工作记忆**：落地后更新 `/Users/weizhao/Desktop/Costra/.codebuddy/memory/2026-08-10.md` 中本条目的状态为"已修复"
