# sync/pull 分页收敛改造方案（L13）

> 状态：**v0.9 · 已施工**（v0.9 仅状态注记：`server/scripts/import-entries.mts` 已于 2026-09-02 删除，R9 / 决策 27 以"移除"方式关闭；此后代码库无任何批量写入路径，`sync_epoch` 在导入功能上线前恒 0）
> 日期：2026-08-28（v0.1）→ 2026-08-31（v0.2）→ 2026-08-31（v0.3：E1 epoch 替换 S1/S2）→ 2026-08-31（v0.4：代码核查轮合入——**C2 升级为废除 `entry:__index`**（容量专题 P2 提前合并，O(n²) 结构性消除）；R5 补 `rebuildEntryMonthIndex` 入队与实现纪律；`applyServerChanges` 删除；批量判定收紧为严格 `serverVer > localVer`；epoch 比对补 key 集合语义；§5 函数名修正）→ 2026-09-01（**v0.5：二轮代码复核，修 3 个正确性缺口 + 3 个成本/灰度问题**——① 决策 14 立论被推翻，判定改 `>` + pending 闸门（§4.4 ③）；② epoch 写序不变量：先清 watermark 后写 epoch（§4.2）；③ 批末月索引任务补 null 裸重建分支（§4.5）；④ `has_more` 轮跳过 `categories_revision` 计算（§4.3）；⑤ epoch 归一化 `?? 0` 防服务端上线风暴（§4.2）；⑥ rebuild 键枚举显式排除 `entry:__index`（§4.4 ①）；另修 §5 清单 7 处与 §6 口径 5）→ 2026-09-01（**v0.6：三轮代码复核合入**——① epoch 清零改 strict 写并读回确认，消除 `setItem` 吞失败造成的「epoch 新 + watermark 旧」残留（§3.7/§4.2）；② 相等档补内容等价比较，统一“canonical 字段自愈”与“老行 skipped”口径（§3.8/§4.4 ③）；③ 现存 `import-entries.mts` 直写 entries 纳入批量写入审计/改造范围（§3.9/§5）；④ 补 `pull-continue` timer 清理与 watermark 无进展保护）→ 2026-09-02（**v0.7：施工轮代码复核合入**——① 纪律 5 同类故障的第三个入口收口：mutation/hydrate 的月索引 upsert 读到 null 跳过写入、保持 key 缺失（§4.5 纪律 6）；② epoch 重置轮计入 pages 预算 + 截断 + 轮间让出，防持续批量写入期间紧密循环（§4.3）；③ 批末 null 分支复用"只计算"helper，消同 key 冗余双写（§4.5）；④ `pendingRefs` 明确为调用方注入（循环依赖约束）+ 缺省 warn 兜底（§4.4 ③））→ 2026-09-02（**v0.8：第四轮（施工后）代码复核合入，修 1 个性能反例 + 3 个一致性缺口 + 1 项显式取舍**——① **批末 null 重建改 per-batch 共享懒扫描**，消除"每月各扫一次"造成的 O(月数×实体数)（§3.10 / §4.4 ④）；② remove-only delta 遇 key 缺失直接跳过，不写空索引也不付扫描（§4.4 ④）；③ **`changes.ledgers` 为空时不比对不写 epoch**——"本轮没下发" ≠ "账本消失"（§3.11 / §4.2）；④ **资产写前移到 epoch 判定之前**，兑现"含 epoch 轮"的资产不断供口径（§4.3）；⑤ watermark 合法性校验前移至 epoch 环节之前；⑥ dead-letter **有意不计入** pending 闸门 + 配套 follow-up L14（§3.12 / 决策 29）；另：`flushIndexQueue` 超限抛错、纪律 6 的读路径代价入账（§4.5）、冒烟用例落地 `qa/cases/sync-pagination-smoke.md`）
> 上游：`docs/follow-up/sync-p2-improvements.md` **L13**、`docs/design/data-import-export-client-analysis.md` §5.1（E0 硬前置卡）
> 事实源：`docs/api/sync-protocol.md` §3.2 / §3.3 / §6.3 / §8

---

## 1. 结论摘要

| # | 结论 | 依据 |
|---|---|---|
| C1 | `has_more` 服务端已正确产出，客户端**零消费**，只进 debug 日志 | `server/src/repositories/entryRepo.ts:377-400` vs `miniprogram/services/sync.ts:88` |
| C2 | 收敛模型是 **⌈N/200⌉ 分钟**（稳态运行期只有 `periodic` 60s 是稳定触发源；启动期有 launch/page-show 连发，会显著更快） | `syncScheduler.ts:35,87` |
| C3 | 协议**早就要求**客户端 `if has_more: retry pull immediately`（§3.3 + `smoke_sync_05`），属于**协议违约** | `docs/api/sync-protocol.md:235,380` |
| C4 | "静默错误合计"成立，但触发条件是「**月内有数据 + 增量未拉完**」（整月为空有 `_hydrateRemoteMonthEntries` 兜底） | `ledger/index.ts:943-955`、`db.ts:306` |
| C5 | **R1：把单轮改成紧密循环后，会显著放大 `change_seq` 的「已取号未提交」洞**，导入场景下可导致整批永久拉不到。只做客户端循环是危险的 | §3.1 |
| C6 | **`entry:__index` 无生产消费者**：读者仅 `rebuildEntryMonthIndex` 兜底与 `listEntries`（仅 db.spec.ts 调用）；它却是唯一线性增长单 key + O(n²) 重写瓶颈 | `db.ts:166,261` + 全库搜索 |
| C7 | **客户端 `version` 是 push ack 回填的，内容未回写** ⇒ "同 version 即同内容"在客户端**不成立**（服务端写入时会改 `category_id` / `shared_type`）。v0.4 决策 14 的立论作废，判定需补 pending 闸门 | `outbox.ts:322-328` vs `entryService.ts:249-311,358-374` |
| C8 | **`categories_revision` 是每轮 pull 的固定服务端成本**（全表扫系统分类 + JS 排序 + 拼串），分页循环会把它 ×10~40 | `syncPullService.ts:98-138,165` |
| C9 | **epoch 重置的两次本地写不是原子操作，且 `setItem` 会吞写失败**；只做顺序约束仍会留下「epoch 新 + watermark 旧高值」的真丢数据状态，清零必须 strict 写/读回确认 | `storage.ts:144-157`、`db.ts:422-427`、§3.7 |
| C10 | 「相等且无 pending → 应用」与「全量重拉老行 skipped」在 v0.5 文案中冲突；相等档需再做**内容等价比较**，只在 canonical 字段漂移时写入 | §3.6、§3.8、§4.4 ③ |
| C11 | ~~代码库已存在绕 `entryService` 的 `server/scripts/import-entries.mts` 单事务直写 entries~~ **该脚本已于 2026-09-02 删除**（v0.9 注记）；删除前已实装同事务 `sync_epoch + 1` | §3.9 |

定稿方案 = **E1（epoch 版本戳）+ C1（分页循环）+ C2（批量落盘 · 废除 `entry:__index`）+ R5（月索引写串行队列）**。
核心取舍：对 R1 不做"预防"（锁/协议字段/退避），改做"**必然发现 + 幂等重拉**"，失败模式集合里不存在"丢数据"这一项；对 R2 不做"摊销"（批末一次写全局索引），改做"**废除无消费者的单 key 数组**"，O(n²) 结构性消失。

**贯穿性原则**：本方案把"单轮"变成"循环"、把"逐条落盘"变成"批量落盘"，因此**任何原本按"一轮一次""一条一次"计价的既有成本与既有语义，都必须重新核算**——C8（per-request 成本被乘）、R6（逐条判定语义在批量重拉下被放大）、§3.5 第二入口（逐条写索引变批末覆盖）、R7（两次 storage 写在循环/屏障下不再只是顺序问题）都是这条原则的实例。

---

## 2. 问题核查（证据链）

### 2.1 服务端：已正确产出 `has_more`

```ts
// server/src/repositories/entryRepo.ts:382-399
const limitPlusOne = cursor.limit + 1;
const res = await runner.query(`... WHERE l.family_id = $1 AND e.change_seq > $2
   ORDER BY e.change_seq ASC LIMIT $3`, [cursor.familyId, cursor.since, limitPlusOne]);
return { rows, hasMore: res.rows.length > cursor.limit };
```

`LIMIT n+1` 探测判定正确；`syncPullService.syncPull` 原样透传。

### 2.2 客户端：零消费

```ts
// miniprogram/services/sync.ts:85-100
logger.debug('sync:pull', `... has_more=${resp.has_more}`);   // ← 唯一的用处
if (resp.changes) { await applyServerChanges(resp.changes); ... }
await setWatermark(familyId, resp.watermark);
```

`syncScheduler.syncOnce` 每轮只调一次 `syncPull(familyId, { limit: 200 })`，无循环、无续拉调度。

### 2.3 收敛模型

稳态运行期：单次增量 N 条 ≈ `⌈N/200⌉ × 60s`（`page-show` 有 5s debounce、`mutation` 只在本地记账时触发，都不保证）。启动期存在连发链（launch sync → page-show 被 mutex 挡走 pendingRetrigger → 100ms 内第 2 轮 → periodic/tab 切换补第 3 轮），自然首登收敛远快于悲观模型；**主要危害锚点是导入场景**（稳态 25 轮 ≈ 25 分钟，且当前月已有手工流水 → hydrate 不触发 → 当前月合计静默错误）。

### 2.4 静默错误的精确窗口

`_loadEntries` 在"本地整月为空且未确认 remote-empty"时走 `_hydrateRemoteMonthEntries` 全量拉该月——整月为空是安全的。真正的静默错误窗口：**该月本地已有数据** → 不触发 hydrate → `complete` 只看"本地索引条数 vs 请求 limit" → 结算 `ready-full` 并展示缺口的月度合计，全程无提示。

---

## 3. 风险清单

### 3.1 R1（阻断级）：`change_seq` 的"已取号未提交"洞

`entries.change_seq` 走 `nextval('entries_change_seq')`，**INSERT 语句执行时取号，COMMIT 时才可见**（migration 0016 的 `CACHE 1` 解决跨连接号段乱序，**不解决**取号/提交的时间差）。

洞的三要素（缺一不可）：

```
t0  T1(批量写入)取号 [5001, 10000],未提交   ← ① 足够长的未提交窗口(导入 commit 事务 2~10s)
t1  T2(同 family)取号 10001,先 COMMIT       ← ② 同 family 并发写,取号 > T1 区间尾
t2  客户端 pull 拉到 10001 → watermark=10001 ← ③ 窗口内发生一次 pull
t3  T1 COMMIT → [5001,10000] 全部 < watermark ⇒ 永久拉不到
```

关键事实（已核实）：
- watermark 推进用的是**本批次 family 过滤后末行的 change_seq**（`syncPullService.ts:160-162`），**其他 family 的写入不会推进本 family 的 watermark** —— 要素②必须是同 family 的写事务（增/改/删都算，UPDATE/软删同样显式 `nextval`，`entryRepo.ts:221,248`）。
- 号源（`entries_change_seq`）是全库全局序列，但 watermark 是**每客户端 × 每 family 各存一份**（`watermark:{familyId}`）；全局共享只造成无害的"跳号"（别人的号段、rollback 空号、recurring_rules 取号被 family 过滤），**空洞 ≠ 遗漏**。
- 循环会放大要素①③：现状 60s 一轮命中率低；紧密循环下只要窗口内同 family 有一笔提交，watermark 必被推过 T1 区间 —— **"慢"升级成"永久丢失"**。
- 多成员并发记账的**毫秒级残余洞**（取号先于提交）是 change_seq 模型的固有残余，本方案不覆盖（见 §7 B4/B5），维持独立课题。

### 3.2 R2（性能）：批量落盘的 O(n²) 存储 IO —— 根因是数据结构

现状 `applyServerChanges` 逐条处理（`db.ts:388-404`），每条 entry 触发 `appendToIndex`（**全量读写 `entry:__index`**，~200KB @ n=5,000）+ `reindexEntry`（月索引读+写）。

根因不只是"逐条"：微信 storage 无局部更新，**`entry:__index` 是单 key 存全量 id 数组**，每次 append = 读出→push→全量写回 ⇒ 每条 O(n)，n 条 O(n²)。月索引按月分片（单 key 10KB 级）无此问题。

量级修正（v0.5）：`appendToIndex` 有 `includes` 短路（`db.ts:116`），**已存在的 id 只读不写** ⇒ O(n²) 的写侧只发生在**首次落盘 n 条新行**（首登、导入后重拉的新增部分），epoch 全量重拉命中老行时退化为"n 次全量读"。首次落盘 n=5,000 的量级是 **~1GB 级 JSON 序列化 + 万次量级 storage IPC**（此前"~2GB"高估约一倍），主线程卡秒级到几十秒；结论方向不变。

两条出路：**摊销**（批末一次写全局索引，O(n²)→O(n)）或**废除**（C6：该索引无生产消费者）。§4.4 选择废除。

### 3.3 R3（容量）：本地库上限 —— 部分合并，其余移出（2026-08-31 修订）

每条 entry 占 3 份存储 ≈ 550-800B（实体）+ 39B（`entry:__index`）+ 90B（月索引）。5,000 条 ≈ 3.6MB；~12,000 条触顶；`entry:__index` ~26,000 条先爆单 key 1MB。

**v0.4 决策**：废除 `entry:__index`（兼具容量收益：省 39B/条、移除唯一线性增长单 key 的 1MB 天花板）**提前合并进本次**——理由是 C2/R5 本就重写全部索引写路径，此刻删除成本最低，延后等于同层二次返工。容量专题其余项（监控打点、软删孤儿 key 物理清理、窗口化归档）**仍整体移出**，另立专题。

### 3.4 R4（协议）：`limit` 与字段扩展

- `limit` 上限 500 已在 schema（`routes/sync.ts:85`）与 OpenAPI 中，客户端改取值即可，**无需改协议**。
- `sync_epoch` 随 `ledgers[]` 下发（该数组本来就每轮全量下发，`syncPullService.ts:170`），是 `Ledger` schema 新增一个 optional 整数字段，向后兼容。

### 3.5 R5（数据正确性）：批量落盘与 mutation 的索引写交错

C2 把月索引的写收敛为"批末一次 `setItem` 覆盖"。若用户/定时任务在批量任务执行期间记账（`putEntry` / `deleteEntry` / `updateEntryFields`），其"读-改-写"与批末覆盖交错 → **lost update：用户刚记的账从索引丢失、列表不可见**（实体仍在，下轮 sync 复活，但期间缺条）。hydrate 路径（`_putRemoteEntryIfSafe` → `putEntry`）写月索引同理。

**v0.4 核查补充：`rebuildEntryMonthIndex` 是第三个写方，且不在原队列清单里。** 月索引 key 缺失时它从实体库重建全量真值后直接 `setItem`（`db.ts:176`）；若与 C2 批末"重读（读到 null/旧值）→ 应用 delta → 写回"任务交错，批末的子集会覆盖 rebuild 的全量结果 → 非批量行月索引丢失，且 key 已存在 rebuild 不再触发 → **该月持久缺条**。rebuild 写回必须同入队（其内容执行时从实体推导，天然幂等）。

**v0.5 核查补充：同一个"持久缺条"故障还有第二个入口 —— 批末任务重读到 `null`。** 与并发交错无关，单线程下也必现：批末任务"重读月索引"若拿到 `null`（该月 key 从未建立 / 老版本升级 / 该月首次被批量落盘但本地已有该月实体），把内存 delta 当全量写回后，**key 从此存在但只含本批子集** → `listMonthEntries` 的 `if (!idx)` 兜底不再触发（`db.ts:286`）→ 该月持久缺条。且任务内**不能**调 `rebuildEntryMonthIndex`（它自身入队，同 key 自我等待 = 死锁，违反 §4.5 纪律 2）⇒ 必须在任务内提供**裸**的推导式重建路径（§4.5 纪律 5）。

### 3.6 R6（数据正确性 · v0.5 新增）：服务端写入时会规范化字段，客户端 version 不能代表内容

v0.4 决策 14 以"version 服务端单调、每次更新必 +1 ⇒ **同 version 即同内容**"为依据，把判定收紧为严格 `serverVer > localVer`。该立论在服务端成立，**在客户端不成立**：

- 本地 `version` 是 push ack 路径回填的，`outbox.ts:322-328` **只写 `id` 与 `version`，不回写服务端返回的内容**；
- 而服务端在写入时会改字段：① `resolveCategoryId` 对旧 / 已删 / 已合并的 `category_id` 做**静默降级**（`category_redirects` → 兜底默认子分类，`entryService.ts:249-311`）；② `shared_type` 为 `null` 时按 family kind 填充（`entryService.ts:358-374`）。

⇒ 本地存在「`version` 与服务端相同、但 `category_id` / `shared_type` 是未规范化的旧值」的行。现状 `serverVer >= localVer` 覆盖恰好把 canonical 值拉回来；改成严格 `>` 后这些行永久 `skipped`：明细页分类图标/名称走 fallback、"公"角标不显示、按"公共/个人"筛选漏条。

更关键的是**护栏消失**：今后任何"服务端写入时补/改字段"的能力（导入的字段映射、后端补算字段）都会在客户端静默失效，且无任何报错。

同时注意反向的既有缺陷：本地 `deleteEntry` **不推进 version**（`db.ts:310-322`），故"本地软删 + 服务端未删"时两边 version 相同 —— 现状 `>=` 会把本地软删**覆盖复活**。这说明"相等"这一档既不能一律覆盖、也不能一律跳过，**必须按"本地是否有 pending op"分流**（§4.4 ③）。

### 3.7 R7（数据正确性 · v0.6 新增）：epoch 重置的两次本地写不是原子操作

`storage.setItem()` 在写屏障开启或 `wx.setStorage` 失败时只记录日志、向上返回成功（`storage.ts:144-157`）；`setWatermark()` 也只是透传该 Promise（`db.ts:422-427`）。因此 §4.2 的"先清零、后写 epoch"只能约束正常成功路径，不能排除：

1. `setWatermark(familyId, 0)` 实际失败但被吞；
2. `writeLedgerEpochs(familyId, serverEpochs)` 成功；
3. 本地落成「epoch 新值 + watermark 旧高值」；
4. 下轮 epoch 比对一致、不再重置，而洞内行 `change_seq < watermark` → **永久拉不到**。

修法：epoch diff 分支使用 **`setWatermarkStrict()`（写失败抛错 + 读回确认）**，确认 watermark 已是 `0` 后才写 epoch；确认失败则本轮中止、不写 epoch，等待下轮 sync 重试。普通分页推进不全局改成 strict，避免把稳态同步的瞬时 storage 抖动升级为失败。

负面影响已评估：只在 epoch 变化的低频路径多一次 storage 读写；失败模式从"可能永久漏拉"降级为"本轮延迟收敛 / 下轮重试 / 偶发重复全量重拉"，不引入丢数据。

### 3.8 R8（性能/语义一致性 · v0.6 新增）：相等档"应用"与"老行 skipped"必须同时成立

v0.5 的相等档语义要求「无 pending 时应用，以拉回 canonical `category_id` / `shared_type`」，但收益重算又要求「epoch 全量重拉时老行全部 skipped」。二者只有通过**内容等价比较**同时成立：

- `serverVer === localVer` 且**有 pending** → skip，保护本地未上行编辑/软删；
- `serverVer === localVer` 且**无 pending 且内容等价** → skip，避免全量重拉重写老行；
- `serverVer === localVer` 且**无 pending 但内容漂移** → apply，拉回服务端 canonical 字段。

内容等价比较只看会改变本地实体语义/展示/筛选的字段（`id`、`ledger_id`、`amount`、`currency`、`type`、`category_id`、`note`、`occurred_at`、`created_by`、`shared_type`、`source_recurring_id`、`deleted_at`，`null/undefined` 归一化）；排除 `created_at` / `updated_at` 这类展示级或易抖动字段，否则全量重拉会退化为全量覆写。

### 3.9 R9（上线边界 · v0.6 新增）：现存 CLI 导入脚本已是绕过 `entryService` 的批量写路径

> **v0.9 注记 · 已关闭**：`server/scripts/import-entries.mts` 已于 2026-09-02 删除（连同 `export-entries.mts`），本风险以"移除"方式关闭。删除前该脚本已按本节要求实装同事务 `sync_epoch + 1` 并带头注释。此后代码库无任何批量写入路径，`sync_epoch` 在导入功能上线前恒 0。以下为原始分析留档。

`server/scripts/import-entries.mts:589-643` 在单事务中直接 `INSERT` / `UPDATE entries`，并显式 `nextval('entries_change_seq')`。虽然它不是生产 HTTP 产品入口，但只要仍可用于 staging/prod 运维导入，就属于 E1 约定的批量写入路径：

- 必须同事务按受影响账本执行 `UPDATE ledgers SET sync_epoch = sync_epoch + 1`；
- 必须重新审计是否维护 `ledgers.balance_cents`（当前脚本直写 entries，不走 `entryService` 的资产累加）；
- 必须处理 `client_ref_id` 下发问题（小程序本地 entry 以 `client_ref_id` 为主键；脚本插入当前未写该列）。

若决定不再使用该脚本，应在施工时显式标记废弃或移除；否则"当前无批量写入路径"只能表述为"无生产产品入口"，不能作为跳过该脚本改造的依据。

### 3.10 R10（性能反例 · v0.8 新增）：批末 null 重建按月各扫一次 → O(月数 × 实体数)

v0.5 给批末月任务补的"null 裸重建"分支（§4.5 纪律 5）在 v0.7 施工后表现为：**每个** `base === null` 的月份各调一次 `computeEntryMonthIndexFromEntities`，而该函数第一步就是 `enumerateEntryRefs()` + 对**全部**实体逐条 `getEntry`。

首登场景（本地零实体 ⇒ 所有月索引 key 皆 null）：

| 批次 | 覆盖月份 | 扫描次数 | 单次规模 |
|---|---|---|---|
| 第 1 批 500 条 | 3 个月 | 3 | ~500 |
| … | 每出现一个新月份再扫一次 | 累加 | 随已落盘条数递增 |
| 合计 5,000 条 / 24 个月 | — | ~24 | 平均 ~2,500 |

⇒ 约 **6 万次 `getEntry`**。这与 §4.4 收益口径写的"~n 次单 key 读 + 月数次写"直接矛盾，并威胁 §6 验收口径 1（5,000 条 ≤60s）——**等于把废除 `entry:__index` 消掉的 O(n²) 又以 O(m·n) 的形式请了回来**。

修复见 §4.4 ④（per-batch 共享懒扫描）。

### 3.11 R11（一致性缺口 · v0.8 新增）：`changes.ledgers` 为空被判成 key 集合 diff

服务端 `listLedgersForFamily` 在 `findFirstByFamilyId` 返回 `null` 时返回 `[]`（这是服务端注释自己承认的"数据异常 · service 层自愈补建"窗口，**不是账本软删**）。此时客户端 `serverEpochs = {}`：

1. `anyEpochDiff({l1: 3}, {})` → 本地有 key 而响应缺失 → 判 diff → **清零 watermark 全量重拉**，并把 `{}` 写为本地 epoch；
2. 账本自愈后下轮返回 `{l1: 3}` → 与本地 `{}` 再判 diff → **再一次全量重拉**。

两次无意义全量重拉 + 两次 watermark 清零，纯自伤。§4.2 原先只论证了"账本软删/重建"这一条 key 集合语义的来源，**漏掉了"服务端本轮没下发 ledger"这条非软删入口**。

### 3.12 R12（显式取舍 · v0.8 新增）：dead-letter 不计入相等档 pending 闸门

`listPendingEntryRefs` 只读 `outbox:__index` + `outbox:__drained`，**不含 `outbox:__dead_letter`**。后果与决策见**决策 29**，上游问题另立 follow-up **L14**。此处只记录该行为是**有意选择**，不是遗漏——`outbox.ts` 中有配套注释，改动前必须先读。

---

## 4. 方案设计

### 4.1 总览

```
[服务端]                                   [客户端]
E1 ledgers.sync_epoch 一列           ←下发→  C1 分页循环(limit 500 · 截断续拉 · epoch 前置比对)
   批量写入约定:同事务 epoch+1               C2 批量落盘 applyServerEntriesBatch(实体+月索引 · 废除 entry:__index)
   (无锁 · 无 deferred · 无新端点)           R5 月索引写串行队列(mutation/hydrate/批量/rebuild 单写者化)
```

### 4.2 E1：epoch 版本戳（消 R1 · 核心）

**机制**：`ledgers` 加 `sync_epoch BIGINT NOT NULL DEFAULT 0`；任何**绕过 `entryService` 的批量写入路径**（导入、运维脚本、数据修复）在同一事务内执行：

```sql
UPDATE ledgers SET sync_epoch = sync_epoch + 1 WHERE id = $1;
```

`sync_epoch` 随每次 pull 响应的 `ledgers[]` 透传。客户端本地按 family 记录 `{ [ledgerId]: epoch }`，**比对不一致 = "上次同步之后发生过批量写入" → 本轮 entries 不应用、watermark 清零 → 进入 C1 循环从 0 全量重拉**。

**正确性论证（必然发现）**：
1. `epoch+1` 与批量 INSERT **同一事务**，COMMIT 原子可见 —— 不存在"数据到了标记没到"的窗口；
2. epoch 是**持久列而非事件**：客户端离线、漏看响应、多次导入跳变（5→8）都不错过，下次任何一轮 pull 必带当前值；
3. 全量重拉一次覆盖任意多个历史洞 —— 无需逐次消费（这是它优于 floor 变体的点：不需要 ack 协议）；
4. 重拉走 C2 幂等合并，**内容等价**的老行（`serverVer === localVer`、无 pending op、字段无漂移）全部 `skipped`（判定见 §4.4 ③），无重复写副作用；canonical 字段漂移的老行会被定点覆盖修复。

**比对语义（含 key 集合，v0.4 补）**：`anyDiff(localEpochs, serverEpochs)` = **key 集合不同**或任一值不同。本地有 ledgerId 而响应缺失（账本软删/重建导致 id 变更）视为 diff → 重置——账本重建后旧 id 消失新 id 出现，本应触发全量重拉。1:1 语义下无生产软删路径，此分支属防御性兜底。

**⚠️ 前置例外：`changes.ledgers` 为空 ⇒ 跳过整个 epoch 环节（v0.8 · 修 R11）。** "服务端本轮一个 ledger 都没下发" **不等于**"账本消失"——`listLedgersForFamily` 在 `findFirstByFamilyId` 返回 `null` 的自愈窗口就会返回 `[]`。若把它交给上面的 key 集合语义，会先清零重拉一次并把 `{}` 记为本地 epoch，账本自愈后再判一次 diff 再重拉（详见 §3.11）。因此：**`Object.keys(serverEpochs).length === 0` 时既不比对也不写入**，等下一轮带 ledger 的响应再追踪。这不削弱 R1 覆盖——导入必然发生在某个存在的账本上，其后任意一轮带 ledger 的响应都会带出新 epoch。

**客户端流程（每轮响应前置，伪代码）**：

```ts
// extract 必须把缺失值归一化为 0（服务端列 DEFAULT 0 · 灰度期旧服务端不返回该字段）
const serverEpochs = extract(resp.changes.ledgers);        // { [ledgerId]: sync_epoch ?? 0 }
const localEpochs  = await readLedgerEpochs(familyId);     // null = 首登/升级

if (Object.keys(serverEpochs).length === 0) {
  // 本轮未下发任何 ledger:"没下发" ≠ "账本消失" —— 不比对也不写入(§3.11)
} else if (localEpochs === null) {
  await writeLedgerEpochs(familyId, serverEpochs);         // 采信追踪,不触发重置(避免升级风暴)
} else if (anyDiff(localEpochs, serverEpochs)) {           // 含 key 集合比对
  await setWatermarkStrict(familyId, 0);                   // ⚠️ 强写 + 读回确认; 失败则中止,不写 epoch
  await writeLedgerEpochs(familyId, serverEpochs);         // 再追踪新值
  since = 0;
  continue;                                                // 本轮 entries 不应用,直接重拉
}
// 一致:正常应用 entries / 推进 watermark / has_more 判定
```

要点：
- **写序与强写不变量（v0.6 · 必须遵守）：`setWatermarkStrict(familyId, 0)` 必须先于 `writeLedgerEpochs`，且清零必须确认成功。** 两次 storage 写之间存在崩溃 / 被 logout 写屏障吞掉的窗口；若反序（先写 epoch），或清零失败仍写 epoch，落地状态都会是「**epoch 已记新值 + watermark 仍是导入前的高值**」→ 下一轮比对一致、不再重置，而洞里的行 `change_seq < watermark`，普通增量**永远拉不到**（这是本方案唯一能造成真丢数据的写序）。按本序且 strict 确认后，中间崩溃/写失败 = `watermark=0 + epoch 旧值` 或本轮中止不写 epoch → 下轮仍判 diff → 再清零，幂等无损。
- **epoch 缺失必须归一化为 0（v0.5）**：灰度顺序必然是"客户端先上线、服务端后上线"（客户端消费能力必须先于服务端行为）。客户端上线而服务端未上线时 `sync_epoch` 为 `undefined`，被 `localEpochs === null` 分支采信写入；服务端随后上线返回 `0`，若不归一化则 `undefined !== 0` → `anyDiff` → **全体用户一次全量重拉**，正是本节想避免的升级风暴的第二个入口。服务端列 `DEFAULT 0`，`?? 0` 后两侧天然一致。
- **写 localEpochs 无需等收敛**：重置后的 watermark 爬升过程就是普通 `change_seq` 增量拉取，中断（崩溃/断网）后由既有 sync 机制自然续传，不丢任何行。epoch 记录的唯一职责是"检测下一次批量事件"，因此差异出现时立即写、每轮响应都追踪即可。
- **localEpochs 为 null 且 watermark > 0（旧版本升级）**：采信当前值写入，不触发重置 —— 避免全体老用户升级当天全量重拉打爆服务端；升级前恰好有洞的概率极低，属可接受残余（可由 §7 B5 对账兜底）。
- **localEpochs 为 null 且 watermark = 0（首登）**：同上，正常全量拉后自然完成追踪。
- 重拉爬升期间再次发生批量写入：下轮响应比对又不一致 → 再次清零，逻辑自洽；导入是低频管理操作，不会抖动。

**失败模式审计（穷举，除约定失守外全部"多重拉不丢"）**：

| 失败 | 后果 |
|---|---|
| 批量路径忘记 +1 | 退化回现状（洞无人知）——与 lock 方案忘记 acquire 同级；靠"批量写入第二条铁律"（§5 文档项）+ review 检查项兜底 |
| 清零后、写 epoch 前崩溃 | watermark=0 + epoch 旧值 → 下轮仍判 diff → 再清零，幂等 |
| 写 epoch 后（爬升中）崩溃 | 已追踪；watermark 中间值由普通增量续拉收敛 |
| **反序实现**（先写 epoch 后清零）中途崩溃 | **真丢数据**（epoch 新 + watermark 旧高值 → 不再重置且增量拉不到）—— 由上述写序不变量禁止 |
| 清零写失败但被吞，随后写 epoch 成功 | **真丢数据**（同上）—— 由 `setWatermarkStrict` 写失败抛错 + 读回确认禁止 |
| strict 清零成功、写 epoch 前崩溃/失败 | watermark=0 + epoch 旧值 → 下轮仍判 diff → 再清零，幂等 |
| strict 清零失败 | 本轮中止、不写 epoch；下轮 sync 重试，最坏重复全量重拉 |
| 重拉期间再次导入 | 下轮比对再清零，幂等 |
| 多成员各自设备 | 各自记录、各自重拉，互不影响 |

**边界**：epoch 只在批量写入路径 +1，日常单笔记账不加（每笔都加会退化成 change_seq 本身 → 无限重拉）。**多成员并发记账的毫秒级残余洞不在覆盖范围**，维持独立课题（§7 B4/B5）。

**附带收益**：全量重拉内建一次"对账"——离线期间被其他成员改/删的行、历史任何原因造成的本地缺失（含毫秒级残余洞丢的行），version 差异全部自愈。普通增量 pull 做不到（那些行 `change_seq` 已低于 watermark）。

### 4.3 C1：客户端 `syncPull` 分页循环

```ts
export interface SyncPullOutcome {
  watermark: number;
  /** 本次实际新增/更新的 entry 条数(C2 applied 汇总,非拉回条数) */
  pulled: number;
  /** 实际发出的请求轮数 */
  pages: number;
  /** 达到 MAX_PULL_PAGES 截断,仍有剩余(已安排续拉) */
  hasMore: boolean;
  /** 本次是否发生了 epoch 重置(全量重拉) */
  epochReset: boolean;
}

const PULL_LIMIT = 500;          // 协议上限 · 5,000 条 → 10 轮
const MAX_PULL_PAGES = 40;       // 20,000 条/次 · 超出截断并 300ms 续拉
```

循环骨架：

```
since = await getWatermark(familyId)
loop:
  resp = GET /sync/pull { family_id, since, limit: PULL_LIMIT }

  // ① watermark 合法性(v0.8 前移):非法响应不驱动任何本地状态变更(含 epoch 重置)
  if (!Number.isInteger(resp.watermark) || resp.watermark < since) {
    logger.warn('sync:pull', 'invalid watermark regression · abort loop')
    break                                                        // 不应用 entries,等待下轮 sync
  }
  if (resp.has_more && resp.watermark === since) {
    logger.error('sync:pull', 'has_more without watermark progress · abort loop')
    break                                                        // 防服务端异常导致紧密死循环
  }

  // ② 资产不断供(v0.8 前移):必须早于 epoch 判定,否则重置轮 continue 会跳过它
  await applyLedgerBalanceFromSync(...) for ledgers                 // 每轮覆盖写

  // ③ E1 epoch 前置比对(§4.2,含空 ledgers 例外 + key 集合 + ?? 0 归一化)· 差异则清零重进
  //   (重置轮计入 pages 预算 · 达 MAX_PULL_PAGES 截断走 pull-continue + 轮间让出,
  //    防持续批量写入期间 epoch 连续变化导致循环脱离截断保护、退化为紧密请求)

  applied += await applyServerEntriesBatch(resp.changes.entries)   // C2 · 返回 applied
  await setWatermark(familyId, resp.watermark)                      // 每轮落盘 · 中断可续
  since = resp.watermark
  if (!resp.has_more) {
    maybeRefreshCategoriesByRevision(...)   // 仅收敛轮消费(见下"每轮固定成本")
    break
  }
  if (++pages >= MAX_PULL_PAGES) { truncated = true; break }
  await yieldToEventLoop()            // setTimeout(0) 宏任务,让出逻辑层
  if (logout 写屏障已开) break         // storage 屏障会吞写入,主动退出省请求
```

**每轮固定成本（v0.5 修正）**：`syncPull` 每次响应，服务端都会跑一次 `computeSystemCategoriesRevision()` —— 全表扫 `categories WHERE family_id IS NULL` + JS 排序 + map/join（`syncPullService.ts:98-138`）。现状 60s 一轮无感，改成紧密循环后这项成本被 **×10~40**。因此：

- **服务端**：`has_more === true` 时不计算 `categories_revision`（字段本就是 optional，向后兼容）；仅收敛轮（`has_more=false`）返回。
- **客户端**：`maybeRefreshCategoriesByRevision` 移入收敛分支调用；截断轮不调（续拉的收敛轮会补）。
- `changes.ledgers` 是单行 `findFirstByFamilyId`，成本可忽略，且要供 epoch 比对与资产不断供，**保持每轮下发**。
- **资产写必须排在 epoch 判定之前（v0.8 · 修 E）**：epoch 差异轮以 `continue` 结束，若资产写在其后，则"持续批量写入期间 epoch 连轮变化直到截断"的场景下，整整 40 轮资产**一次都不更新**，与本节承诺的"资产不断供（含 epoch 轮）"自相矛盾。`balance_cents` 是服务端权威值、与 watermark 无关，任何一轮下发都可安全覆盖写，前移无副作用。
- **watermark 合法性校验也前移到 epoch 判定之前（v0.8）**：否则一个 watermark 回退的非法响应仍能触发一次 epoch 重置 + 清零重拉。重拉本身幂等无害，但"非法响应不应驱动任何本地状态变更"是更干净的边界。
- `yieldToEventLoop()` 让出的是**逻辑层**（setData 派发、用户事件回调）；小程序逻辑层与渲染层分线程，不存在"让出渲染帧"一说。

注意：循环**不再调用 `applyServerChanges`**（v0.4 起该函数删除，见 §4.4）。`changes.ledgers` 只用于两件事：epoch 提取 + `applyLedgerBalanceFromSync` 余额缓存覆盖写。本地 `ledger` 实体全库无读者（已核实），不再写入。

逐条回应 L13 设计约束：

| 约束 | 处理 |
|---|---|
| watermark 逐轮推进并落盘 | 每轮 `setWatermark`；中断后从上次落盘值续，不回退到 0（epoch 重置是唯一的主动清零，属设计行为） |
| 迭代上限 + 批间让出 | `MAX_PULL_PAGES=40` + 每轮 `yieldToEventLoop()` |
| 不要每轮 emit `SYNC_DONE` | 循环封闭在 `syncPull` 内，`syncOnce` 返回后广播一次；`pulled` 用 **applied 汇总**（epoch 重拉时语义才不失真） |
| mutex/pendingRetrigger 交互 | 长循环持 `isRunning`，外部触发合并为结束后 100ms 一次重触发；截断由续拉定时器兜底，二者不并发 |
| watermark 进度保护 | `watermark < since` 判非法并中止本轮；`has_more=true` 但 `watermark === since` 判无进展并中止，防服务端异常造成紧密死循环 |
| 服务端 limit 与客户端取值 | 客户端 200 → **500**（协议/schema 已支持，服务端上限不动）；响应体 ~200KB/轮 |

**截断后续**：`syncOnce` 在 `pullResult.hasMore === true` 时 `setTimeout(() => void syncOnce('pull-continue'), 300)`；`TriggerSource` 与 `SyncDonePayload.trigger` 联合类型同步加 `'pull-continue'`。续拉 timer 必须保存在模块级变量，并纳入 `stopScheduler()` 与 `__test__.reset()` 清理，避免 logout 后或测试间残留触发。

### 4.4 C2：客户端批量落盘 + 废除 `entry:__index`（消 R2 · v0.4 升级 · 判定语义 v0.6 修订）

**事实核查（v0.4 全库搜索结论）**：
- `entry:__index` 读者仅两处：`rebuildEntryMonthIndex`（月索引缺失兜底，`db.ts:166`）与 `listEntries`（`db.ts:261`，**无生产调用方**，仅 db.spec.ts 使用）。它却是唯一线性增长单 key + O(n²) 重写瓶颈（§3.2）。
- `applyServerChanges` 唯一生产调用方是 sync pull（**push 回填不经过它**——`outbox.ts` ack 路径直接 `getEntry`/改写/写回 version）；其 ledgers 分支写的本地 `ledger` 实体全库无读者；categories/budgets 分支在 MVP 下恒空（分类由 categoryService 24h 缓存 + revision 强刷管理，预算由 budgetApi SWR 管理）。

因此 C2 不做"全局索引摊销写"，而是**顺势废除 + 月索引批量化**：

**① 废除 `entry:__index`**
- `putEntry`/`deleteEntry` 不再 append/remove 全局索引；`applyServerChanges` 整体删除（无生产调用方）；`listEntries` 删除。
- `rebuildEntryMonthIndex` 数据源改为 **`wx.getStorageInfo()` 键枚举**（`storage.ts:98` 已有先例）。过滤规则（v0.5 修正）：`key.startsWith('entry:')` **且** 余段不含 `:`（排除月索引 `entry:index:*`）**且 `key !== 'entry:__index'`** —— `__index` 的余段本身不含 `:`，原规则排不掉它，不能把正确性押在"升级清理必然已执行"上（清理失败 / rebuild 先于清理触发都会漏）。命中后逐个 `getEntry` 过滤 ledger+month。
- 成本与现状基本持平（原来也是全量读实体，仅少读一次索引），**但会多读到软删实体**：现状 `deleteEntry` 会 `removeFromIndex`，`entry:__index` 里没有软删条目，而键枚举会枚举到（数量级 = R3 提到的孤儿 key）。仍可接受，且保住**离线自愈**（优于"月索引缺失即服务端回源"：断网冷启动不会显示空）。
- **升级一次性清理**：老版本遗留的 `entry:__index` key 在 bootstrap（`ensureVersion` 之后）检测即 `removeItem`。**不做 `STORAGE_VERSION` bump**——版本迁移会清空全部业务 key 含 outbox 未上行 op，为删一个死 key 付出数据丢失风险不可接受。

**② 批量落盘 `applyServerEntriesBatch`**（新增，唯一的 pull 应用路径）：

```ts
export interface ApplyEntriesBatchResult {
  applied: number;        // 实际写入(新增/覆盖/软删)
  skipped: number;        // 判定未通过(见 ③)
  monthsTouched: number;  // perf 打点
}
export async function applyServerEntriesBatch(
  wires: unknown[], opts?: { yieldEvery?: number },   // 默认 200 条让出一次
): Promise<ApplyEntriesBatchResult>;
```

内部流程：

```
0. pendingRefs = await listPendingEntryRefs()            // 批开始一次性读 outbox index → Set
1. monthCache = Map<monthKey, items[]>()                 // 懒加载,每月只读一次
2. for (wire of wires):
     item = wireToEntry(wire)
     local = await getEntity('entry', item.client_ref_id) // 单 key 读,必需,不进队列
     if (!shouldApply(local, item, pendingRefs)) { skipped++; continue }
     await putEntity('entry', item)                       // 单 key 写,必需,不进队列
     内存累计 monthCache delta(含跨月移动:旧月删 + 新月增)  // 不落盘
     每 yieldEvery 条 → await yieldToEventLoop()
3. 逐月 R5 队列 enqueue:重读月索引 → 应用 delta → 排序写回   // 每月一次
```

**③ 判定语义（v0.6 修订 · 推翻 v0.4 决策 14 的立论，并补内容等价比较）**：

```ts
function shouldApply(local, item, pendingRefs): boolean {
  if (!local) return true;                       // 本地不存在 → 恒应用
  const serverVer = item.version ?? 0;
  const localVer  = local.version ?? 0;
  if (serverVer > localVer) return true;         // 服务端更新 → 覆盖
  if (serverVer < localVer) return false;        // 本地更新(罕见) → 跳过
  if (pendingRefs.has(item.client_ref_id)) return false; // 相等且有 pending → 保护本地未上行改动
  return !sameEntryContent(local, item);         // 相等且无 pending → 仅内容漂移时覆盖
}
```

依据见 §3.6 R6 与 §3.8 R8：客户端 `version` 由 push ack 回填、**内容未回写**，故"同 version 即同内容"不成立；服务端的 `category_id` 降级与 `shared_type` 填充需要靠相等档拉回本地。同时本地 `deleteEntry` 不推进 version，若"相等一律覆盖"又会把本地软删复活。最终语义必须是 **pending 闸门 + 内容等价比较**：

- 相等 **且有 pending op** → 跳过（保护本地未上行的编辑 / 软删；push 成功后 server version+1，下轮以 `>` 自然覆盖）；
- 相等 **且无 pending op、内容等价** → 跳过（epoch 全量重拉的老行不发生重复写）；
- 相等 **且无 pending op、内容漂移** → 应用（拉回 canonical `category_id` / `shared_type` 等服务端规范化字段；此时本地无未上行改动，覆盖不会丢东西）。

`sameEntryContent(local, item)` 比较语义/展示/筛选字段：`id`、`ledger_id`、`amount`、`currency`、`type`、`category_id`、`note`、`occurred_at`、`created_by`、`shared_type`、`source_recurring_id`、`deleted_at`；`null/undefined` 先归一化。**不比较** `created_at` / `updated_at`（展示级、容易因精度或回填路径抖动），否则 epoch 重拉会退化为全量覆写。

注意与 hydrate 路径的差异：`_putRemoteEntryIfSafe` 当前把 pending 闸门放在 version 比较之前（`ledger/index.ts:999-1024`），即 pending 恒 skip；而 C2 对 `serverVer > localVer` 仍应用。二者在"无 pending"分支一致，但**不是完全同一套优先级**。本次不强制改 hydrate；若后续把 hydrate 迁到 `applyServerEntriesBatch`，必须先显式决定"高 version 与 pending 冲突"的统一策略，并复用同一个 `sameEntryContent` 判定。

**实现纪律**：`pendingRefs` 必须在批开始**一次性**构建（读 `outbox:__index` + 逐 op 取 `client_ref_id`，O(pending) 且 pending 常态 <10）。**禁止逐条调 `hasPendingEntryOp`** —— 它内部是 O(index) 遍历，逐条调会把批量落盘退化成 O(n×pending) 次 storage 读。工程实现上 `pendingRefs` 由**调用方注入**（db.ts 不能 import outbox.ts——后者已 import db.ts，循环依赖；微信运行时不支持动态 import）；缺省退化为空集时相等档 pending 闸门**静默失效**（本地未上行编辑/软删会被同 version 覆盖复活），属调用契约，实现需 warn 兜底。

**`pendingRefs` 的口径边界（v0.8 · 决策 29）**：`listPendingEntryRefs` **有意不含 `outbox:__dead_letter`**，与含 dead-letter 的 `pendingCount()` 口径**刻意不同**（后者服务 logout 风险提示，宁可多报；前者服务"是否阻止服务端同 version 覆盖"）。理由与后果见决策 29 与 §3.12，上游问题见 follow-up L14。**修改前必读 `outbox.ts` 中的配套注释**，避免被当作"口径不一致"顺手对齐。

**④ 批末月索引写：共享扫描 + remove-only 短路（v0.8 · 修 R10）**

批末每个月一个 R5 队列任务，任务内 `base === null` 时需要"该月全量真值"。两条纪律：

- **per-batch 共享懒扫描**：整批至多扫描一次实体库（`scanEntryMonthGroups()` 一次产出**按 `{ledgerId}:{month}` 分组**的真值 Map），所有 null 月份复用；且**懒触发**——常态下月索引 key 都在，一次都不扫。逐月各扫一次即 §3.10 的 O(月数 × 实体数) 反例。
  - **安全性前提（必须遵守）**：批末所有月任务必须在**同一个同步块内入队完毕**（先收集 promise、最后统一 await），不得逐个 await 入队。这样批末任务必然先于任何后续 mutation/hydrate/rebuild 的同 key 任务执行 ⇒ 快照漏掉的"扫描之后新落盘的实体"总会由排在其后的 mutation 任务读到**已存在**的 key 后 merge 补上（不会命中纪律 6 的 `if (!idx) return` 跳过分支）。若逐个 await 入队，中间窗口会让 mutation 任务插到后续月任务之前执行 → 陈旧快照写出的 key 会**持久缺掉那一条**。
  - 批末统一 await 用 `allSettled`：单月索引写失败不应让整批落盘向上抛（实体已落盘，该月由读路径 rebuild 兜底），也避免 `all` 提前 reject 后其余任务变成 unhandledRejection。
- **remove-only 短路**：`base === null` 且 delta 的 add 为空（如首登拉到本地从未存在过的软删行）→ **直接返回**。既不能写空数组（同样造出"key 存在但只含子集"），也没必要为"什么都不用改"付一次全量扫描。

保留的收益（v0.4 决策 14 的两个真收益仍成立）：
- epoch 全量重拉 5,000 条时，无 pending 且内容等价的老行全部 `skipped`（pending 常态个位数）→ §4.2 论证 4 成立；
- pending 中的本地编辑不再被拉取瞬时覆盖回旧值（回退感消除）；
- 无 pending 但字段未 canonical 的老行被定点覆盖修复（v0.5 正确性目标保留）。

收益重算（n=5,000 全量重拉）：storage 调用 ~8n → **~n 次单 key 读 + 内容比较 CPU + 漂移行写 + 月数次写 + 1 次 outbox index 读**；无漂移时实体写与月索引写趋近 0。数组全量重写 ~6n 次 → **0**（全局索引消失；月索引每批每月一次，单 key 10KB 级）；主线程每 200 条让出。稳态增量（老行少）：~n 读 + applied 写 + 月数。

> ⚠️ 上述口径**成立的前提是 ④ 的共享扫描**。若批末 null 重建按月各扫一次，实际成本是「月数 × 全部实体」次 `getEntry`（首登 24 个月 / 5,000 条 ≈ 6 万次），口径失真且直接威胁 §6 验收口径 1。任何改动碰到批末逻辑，都要重新核这一条。

### 4.5 R5：月索引写串行队列（消 R5）

`db.ts` 内部实现 **promise-chain 单写者队列**，**范围 = 月索引 key**（`entry:index:{ledgerId}:{month}`）。`entry:__index` 已废除；ledger/category/budget 索引量小（个位~数十行）且无批量写场景，不入队。实体单 key 读写不进队列（交错窗口微秒级，有 outbox + 下轮 pull 双保险，接受）：

```ts
// 每个月索引 key 一条链;任务 = async () => { 重读 → 应用 delta → 写回 }
function enqueueIndexWrite<T>(key: string, task: () => Promise<T>): Promise<T>;
```

入队方（四类写方全覆盖）：
- **mutation 路径**：`reindexEntry`（remove/upsert 月索引）内部改为入队执行"读-改-写"；
- **批量路径**（C2）：循环内只做内存 delta，批末逐月把「重读-应用-写回」作为**一个**任务入队；
- **hydrate 路径**：`_putRemoteEntryIfSafe` 走 `putEntry` → `reindexEntry`，天然随 mutation 路径入队；
- **rebuild 路径**（v0.4 补）：`rebuildEntryMonthIndex` 的写回入队，任务内容 = **执行时**从实体重算 → 排序写回（推导式重建，天然幂等）。

效果：任意两个写方对同一月索引的"读-改-写"被串行化——要么先（被对方重读看到）、要么后（叠加在对方结果上），两种交错都不丢。

**实现纪律（违反即引入比 lost update 更严重的故障）**：
1. **失败隔离**：单个任务 reject 必须 catch 住、错误只传给该任务自己的 awaiter、链继续——否则一个失败任务卡死该 key 后续所有索引写；
2. **禁止重入**：任务内部只能调裸 read/write helper，不得再调用入队 API（同 key 自我等待 = 死锁）；
3. **localReset 登记**：**只登记队列的模块级内存状态**（v0.5 修正）。epoch 记录存 storage（`sync:epoch:{familyId}`），logout 走 `clearAllForReset` 全量清空 storage，**无需**在 `localReset.ts` 逐 key 登记；只有跨账号存活的 JS 模块单例（队列 Map / 尾 Promise）必须显式清。
4. **测试**：暴露 `__test__.flushIndexQueue()`，时序敏感用例先 flush 再断言。**flush 轮次超限必须抛错，不得静默返回**（v0.8）——静默返回会让"队列卡死/自我等待"表现为假绿：断言看到的是 flush 前的中间态，却以为已排空；
5. **批末任务必须自带 null 裸重建分支**（v0.5 补 · 对应 §3.5 第二个入口）：任务重读月索引拿到 `null` 时，**不得**把内存 delta 当全量写回（会造出"key 存在但只含子集"的月索引，`listMonthEntries` 的 `if (!idx)` 兜底从此失效 → 该月持久缺条）。此时须在任务内走**裸**的推导式重建（键枚举该月实体，即 `rebuildEntryMonthIndex` 的内部实现，**不能调那个已入队的公共函数**——同 key 自我等待即死锁，见纪律 2），再把 delta 合并上去。⇒ 实现上应把"推导重建"拆成不入队的内部 helper，公共 `rebuildEntryMonthIndex` 只是"入队 + 调该 helper"的薄包装，批末任务直接复用 helper；helper 进一步拆"计算/写回"两层（`computeEntryMonthIndexFromEntities` / `rebuildEntryMonthIndexBare`），批末任务用只计算层、合并 delta 后统一一次写回，避免同 key 冗余双写。
6. **mutation/hydrate 的 upsert 读到 null 时跳过写入、保持 key 缺失**（v0.7 补 · 纪律 5 同类故障的第三个入口）：`reindexEntry` 新月 upsert 分支若把单条写进缺失的 key，同样造出"key 存在但只含子集"（该写法自老版本即存在）。修复**不**在写路径做 O(全量实体) 重建（记账主链路成本不可控），而是与旧月移除分支（`if (!idx) return`）对称——跳过写入，由读路径 `listMonthEntries` 的 `if (!idx)` rebuild 兜底（实体已落盘，枚举必含本条）与批末裸重建共同收敛；写路径保持 O(1)。

   **⚠️ 取舍必须入账（v0.8 补）：本纪律把成本从写路径转移到了读路径首屏，不是纯收益。** 该分支同时覆盖了"真正的新月份"——那种情况下 key 缺失是因为该月本来就没有任何本地实体，写单条其实完全正确（子集 == 全量）。跳过之后：
   - 每个新月的**第一笔记账不建索引** → 明细页首次读该月触发 `rebuildEntryMonthIndex` → 一次 **O(全部本地实体)** 键枚举，落在**首屏路径**上；
   - 老用户 5,000 条本地库 + 每月 1 号第一笔 ⇒ 每月付一次 ~5,000 次 `getEntry`；
   - `db.spec.ts` 中"先读一次建索引、第二次读起才走 month-index"的用例注释，就是这个回归的显式征兆。

   之所以仍选它：写路径在记账主链路上，成本不可控且用户可感；读路径 rebuild 每月至多一次、可被后续读命中摊销。**但必须有观测**——建议 `ledger.entries.done` 打点带 `source`（`month-index` / `rebuilt-month-index`），若 `rebuilt` 命中率异常升高，说明该取舍在真实数据下不成立，需改为"新月且该月无任何本地实体时允许写单条"（需要一次廉价的存在性判定，非全量枚举）。否则这笔债会以"明细页偶发首屏慢"的形式回来。

**负面影响评估**：mutation 索引写排在批末任务之后的等待 ≈ 一次月索引读写（10KB 级，毫秒级）；实体写不进队列，记账响应与 outbox 入队不受影响。服务端/协议/OpenAPI 零改动。

### 4.6 分页/重拉期间并发读写的兼容性（汇总）

| 层 | 场景 | 结论 |
|---|---|---|
| 协议层（change_seq 单调） | 他端/本端新增、修改、删除 | 安全：更大 seq 落在后续轮次窗口；软删行带 `deleted_at` 下发本地软删；version 判定幂等（含 pending 闸门 §4.4 ③）；循环结束瞬间产生的行由截断续拉/下轮 sync 兜底 |
| 协议层 | 批量写入（导入级） | R1 洞 → E1 epoch 检测 + 全量重拉（§4.2） |
| 落盘层 | 实体单 key 写交错 | 现状同级：窗口微秒级，outbox + pull 双保险 |
| 落盘层 | 批量/mutation/hydrate/rebuild 四方写月索引 | R5 串行队列（§4.5，rebuild 已入队） |
| 落盘层 | 批末任务重读月索引为 `null` | §4.5 纪律 5 裸重建分支（否则该月持久缺条）；多月共享一次扫描，remove-only 直接短路（§4.4 ④） |
| 落盘层 | 共享扫描快照 vs 扫描后新落盘的实体 | 批末月任务同步块内一次性入队 ⇒ 必先于后续 mutation 同 key 任务执行 ⇒ 后者读到已存在的 key 后 merge 补上（§4.4 ④） |
| 落盘层 | epoch 清零写失败/被屏障吞掉 | `setWatermarkStrict` 写失败抛错 + 读回确认；失败则不写 epoch、本轮中止（§3.7/§4.2） |
| 落盘层 | 本地 pending 编辑 / 软删 与 同 version 拉取 | §4.4 ③ pending 闸门 + 内容等价比较（相等且有 pending → skip；相等且无 pending 且字段漂移 → 覆盖；内容等价 → skip） |
| 调度层 | `has_more=true` 但 watermark 不推进 | 判定服务端无进展异常并中止循环，等待下轮 sync，避免紧密死循环（§4.3） |
| UI 层 | 循环/重拉过程 | 循环封闭零广播，收敛后一次 `SYNC_DONE` + 既有签名 diff 防跳动；用户感知 = "新流水静默出现"，与其他成员记账 pull 同一链路 |

### 4.7 与既有机制的交互（逐条确认）

| 既有机制 | 交互 | 结论 |
|---|---|---|
| `SYNC_DONE` 广播条件（`pushed>0 \|\| pulled>0`） | `pulled` 改为 applied 累计；循环内不广播 | 收敛后一次 ✓ |
| `pendingRetrigger`（L6） | 长循环持 `isRunning` → 外部触发合并 | 结束后 100ms 重触发 ✓ |
| conflict-retry（1s × 3） | 与续拉定时器独立，均走 `syncOnce` mutex | 不并发 ✓ |
| `_hydrateRemoteMonthEntries` | 经 `putEntry` → `reindexEntry` 入队；无 pending 分支与 `_putRemoteEntryIfSafe` 的 version 闸门一致，但 hydrate 当前是 pending 恒 skip，与 C2 的高 version 覆盖策略存在优先级差异（§4.4 ③） | 本次不强制统一；迁移前需显式决策 ⚠️ |
| `outbox` pending op | 批开始一次性读成 `pendingRefs` Set，供相等档分流；**禁止逐条 `hasPendingEntryOp`** | §4.4 ③ ✓ |
| `applyLedgerBalanceFromSync` | 每轮 ledgers 照常下发；**调用点必须排在 epoch 判定之前**，否则重置轮 `continue` 会跳过（v0.8 修） | 资产不断供（含 epoch 轮）✓ |
| `changes.ledgers` 为空（服务端账本自愈窗口） | 跳过整个 epoch 环节：不比对、不写入 | 避免两次无意义全量重拉（§3.11）✓ |
| `categories_revision` / `maybeRefreshCategoriesByRevision` | 仅收敛轮计算与消费，`has_more` 轮跳过 | 循环不放大 per-request 成本 ✓（§4.3） |
| storage 写屏障（logout） | 普通 `setItem` 出口兜底；epoch 重置分支必须用 `setWatermarkStrict` 识别屏障/写失败并中止，避免「epoch 新 + watermark 旧」 | v0.6 修正 ✓ |
| `localReset.ts` 登记 | **仅 R5 队列的模块级内存状态**；epoch 存 storage 由 `clearAllForReset` 全量清 | v0.5 修正 ✓ |
| `pull-continue` timer | 模块级 timer 需纳入 `stopScheduler()` / `__test__.reset()` 清理 | v0.6 补充 ✓ |
| 升级兼容（旧版本有 watermark、无 epoch 记录） | 采信当前 epoch 写入，不触发重置 | 避免升级风暴 ✓ |
| 灰度兼容（客户端先上线、服务端未返回 `sync_epoch`） | `extract` 归一化 `?? 0`，与服务端 `DEFAULT 0` 对齐 | 避免服务端上线日风暴 ✓（§4.2） |
| 升级遗留 `entry:__index` key | bootstrap 一次性 `removeItem`（不 bump STORAGE_VERSION，保护 outbox）；rebuild 过滤规则**另行显式排除**，不依赖清理已执行 | §4.4 ① ✓ |
| `applyServerChanges` 删除后的空白 | ledger 实体无读者；categories/budgets 各有管理通道且 MVP 恒空 | 无功能损失 ✓ |
| 协议 §3.4 实体消费顺序约束 | 客户端删除 `applyServerChanges` 后不再有"多实体顺序消费"实现；MVP 下 categories/budgets 恒空、ledger 实体不落盘，约束事实上无适用对象 | 需在协议文档注明现状，非功能缺失 ✓ |

---

## 5. 改动清单

### 服务端

| 文件 | 改动 |
|---|---|
| `server/db/migrations/0019_ledgers_sync_epoch.sql`（新增） | `ALTER TABLE ledgers ADD COLUMN sync_epoch BIGINT NOT NULL DEFAULT 0`；同步 `server/test/setup.ts`（现有最大编号 0018） |
| `server/src/repositories/ledgerRepo.ts` | `SELECT_COLUMNS` + `LedgerEntity` + `rowToEntity` 加 `sync_epoch` |
| `server/src/services/syncPullService.ts` | `LedgerWire` + `ledgerToWire` 输出 `sync_epoch`（`listLedgersForFamily` 是本文件私有 helper，透传随之完成）；**`has_more === true` 时跳过 `computeSystemCategoriesRevision()`**（§4.3） |
| `server/api/openapi.yaml` | `Ledger` schema 新增 `sync_epoch`（optional integer）；`SyncPullResponse.categories_revision` 标注"`has_more=true` 时可能缺省" |
| `docs/api/sync-protocol.md` | §3.2/§3.3 补 `sync_epoch` 语义与客户端重置义务（含 key 集合语义 + `?? 0` 归一化）；补 `categories_revision` 仅收敛轮返回；§3.4 注明 MVP 下实体顺序约束无适用对象 |
| `docs/design/data-import-export-client-analysis.md` | §7.5 加**批量写入第二条铁律**：任何绕过 `entryService` 的批量写入路径，同事务 `UPDATE ledgers SET sync_epoch = sync_epoch + 1`；并写明"导入上线前置 = 客户端 epoch 消费版本已达目标覆盖率"（§8 决策 16） |
| ~~`server/scripts/import-entries.mts`~~ | **已按②执行（2026-09-02 删除）**：原选项为 ① 保留可用 → 入库事务同事务 `sync_epoch + 1` 并补齐/审计 `ledgers.balance_cents` 与 `client_ref_id`；② 不再使用 → 显式移除，避免成为绕过 E1 的运维入口（§3.9） |

### 小程序

| 文件 | 改动 |
|---|---|
| `miniprogram/services/sync.ts` | `syncPull` 分页循环 + epoch 前置比对/重置（key 集合语义 + `?? 0` 归一化 + **`setWatermarkStrict(0)` 确认成功后写 epoch**）+ `SyncPullOutcome`（pulled=applied）；limit 500；watermark 回退/无进展保护；改调 `applyServerEntriesBatch`；删除 `applyServerChanges` 调用；`maybeRefreshCategoriesByRevision` 移入收敛分支 |
| `miniprogram/services/storage.ts` | 新增窄用途 `setItemStrict()`（或等价 critical-write helper）：写屏障开启 / `wx.setStorage` 失败时抛错，不吞错；仅供 epoch reset 使用，普通 `setItem` 语义不变 |
| `miniprogram/services/db.ts` | 新增 `applyServerEntriesBatch`（**`>` + 相等档 pending 闸门 + `sameEntryContent` 内容等价比较**，§4.4 ③）；新增 `setWatermarkStrict()`（基于 `setItemStrict` 写入后读回确认，仅用于 epoch reset）；**废除 `entry:__index`**（`putEntry`/`deleteEntry` 去维护、删 `listEntries`、删 `applyServerChanges`）；`rebuildEntryMonthIndex` 改 `wx.getStorageInfo()` 键枚举（`entry:` 前缀 + 余段无 `:` + **显式排除 `entry:__index`**），并拆出**不入队的内部重建 helper** 供批末任务复用；R5 月索引写串行队列（四方写者入队 + 失败隔离 + 禁重入 + **批末 null 裸重建分支** + `__test__.flushIndexQueue()`，flush 超限抛错）；epoch 记录读写（scoped key `sync:epoch:{familyId}`）；**批末 per-batch 共享懒扫描（`scanEntryMonthGroups` 按 `{ledger}:{month}` 分组）+ 月任务同步块内一次性入队 + remove-only 短路**（§4.4 ④） |
| `miniprogram/services/outbox.ts` | 新增 `listPendingEntryRefs(): Promise<Set<string>>`（一次性读 index + drained，供 C2 相等档判定；避免逐条 `hasPendingEntryOp` 的 O(n×pending)）；**注释写明"有意不含 dead-letter"及与 `pendingCount()` 口径分歧的理由**（决策 29） |
| `miniprogram/app.ts`（或 bootstrap 处） | `ensureVersion` 之后一次性清理遗留 `entry:__index`（`getItem` 非空即 `removeItem`） |
| `miniprogram/services/syncScheduler.ts` | 适配新返回值；新增 `'pull-continue'` 触发源与截断续拉调度；续拉 timer 纳入 `stopScheduler()` / `__test__.reset()` 清理 |
| `miniprogram/services/eventBus.ts` | `SyncDonePayload.trigger` 加 `'pull-continue'` |
| `miniprogram/services/localReset.ts` | 登记 R5 队列的模块级内存状态（**epoch 存 storage，无需登记**） |
| `miniprogram/utils/`（或 sync.ts 内） | `yieldToEventLoop()` 新增（现有代码无可复用实现，已核实） |

### 测试

| 文件 | 用例 |
|---|---|
| `server/test/sync-pull.test.ts` | T9/T16 扩展；`ledgers[]` 含 `sync_epoch`；**`has_more=true` 时 `categories_revision` 缺省 / `has_more=false` 时存在**；migration 同步 setup.ts 回归 |
| `miniprogram/services/sync.spec.ts`（**新建**，当前无此文件） | 分页循环：3 页追平（pulled=applied 累计 / pages=3 / watermark 单调）；截断 → hasMore=true；epoch 差异 → 本轮不应用 + watermark 清零重拉；**strict 清零先于写 epoch 的写序断言**；**strict 清零失败 → 不写 epoch、本轮中止**；**epoch key 集合缺失 → 同样触发重置**；**服务端不返回 `sync_epoch`（灰度）→ 归一化 0 → 不重置**；epoch 一致 → 零动作；localEpochs=null → 采信不重置；重拉爬升中二次差异 → 再清零；watermark 回退 / `has_more=true` 但无进展 → 中止循环；`categories_revision` 仅在收敛轮消费；**`changes.ledgers` 为空 → 不比对不写 epoch、不重拉**；**watermark 回退的响应不触发 epoch 重置**（校验前置）；**epoch 重置轮仍写资产缓存**（单轮 + 40 轮截断场景各一条） |
| `miniprogram/services/db.spec.ts` | **批末多月 null 重建只扫描一次**（断言 `getStorageInfo` 调用数 = 1，防 O(月数×实体数) 回归）；**remove-only delta 遇 key 缺失 → 不写 key、不触发扫描**；删除 `listEntries`/`applyServerChanges` 用例并迁移至 `applyServerEntriesBatch`；**判定四档**（更高 → 覆盖 / 更低 → skip / **相等且无 pending 且内容漂移 → 覆盖并拉回 canonical `category_id`+`shared_type`** / **相等且无 pending 且内容等价 → skip** / **相等且有 pending → skip 且本地软删不被复活**）；`sameEntryContent` 的 `null/undefined` 归一化与展示字段排除；`setWatermarkStrict` 写失败/读回失败路径；跨月移动的月索引 delta；**批末重读为 null → 裸重建 + delta 合并，全月不缺条**；rebuild 键枚举正确性（排除 `entry:index:*` 与 `entry:__index`）；**R5 交错 ×3：批量进行中并发 mutation / hydrate / rebuild，月索引两侧都不丢**（先 `flushIndexQueue()` 再断言） |
| `miniprogram/services/outbox.spec.ts` | `listPendingEntryRefs` 覆盖 index + drained 两态 |
| `miniprogram/services/syncScheduler.spec.ts` | 新返回值结构适配；`pull-continue` 调度；`stopScheduler()` / `__test__.reset()` 清理续拉 timer |
| `qa/cases/sync-pagination-smoke.md`（**新建 · v0.8 落地**） | SP-001 = 协议 §8 `smoke_sync_05`（has_more=true → 立即二次 pull + watermark 单调推进）；SP-002 中断续拉；SP-003 导入触发 epoch 全量重拉；SP-004 重拉期间并发记账两侧不丢；SP-005 稳态零成本 + 灰度兼容 |

---

## 6. 验收口径

1. 新设备登录 5,000 条流水的账号，首拉到完整收敛 **≤ 60s**（前台持续在线）。
2. 中断（杀小程序 / 断网）后恢复**不从头重拉**，从上次落盘 watermark 续。
3. **R1 验收**：导入任务执行期间客户端持续触发 pull；导入 COMMIT 后 epoch 变化触发全量重拉，**5,000 条全部可达**，明细页无逐轮跳动，新增流水静默出现在对应月份；重拉中无 pending 且内容等价的老行 `skipped`，无批量覆写；内容漂移行被定点覆盖。
4. **R5 验收**：批量落盘/全量重拉期间用户记账、改账、删账，以及月索引缺失触发 rebuild 与批量写并发，月索引两侧都不丢条；**批末重读为 null 的月份不出现"key 存在但只含子集"**。
5. **R6/R8 验收**：本地存在「version 与服务端相同、但 `category_id` 未降级 / `shared_type` 为 null」的行时，一次 pull 后本地字段被拉回 canonical 值（分类图标与"公"角标正确）；本地有 pending 编辑 / pending 软删的行**不被同 version 的拉取覆盖**；同 version 且内容完全等价的行不触发实体重写。
6. **R7 验收**：模拟 epoch diff 后 `setWatermarkStrict(0)` 写失败或读回不为 0 时，本轮不写 epoch、不应用 entries、不产生「epoch 新 + watermark 旧」状态；下轮 sync 仍能重新判 diff 并重拉。
7. **稳态零成本**：无批量写入时 epoch 比对一致，不触发任何重拉；服务端 epoch 不引入额外查询，且 `has_more=true` 的轮次**不计算** `categories_revision`（循环不放大既有 per-request 成本）；客户端每轮仅多一次 epoch 记录读，每批仅多一次 outbox index 读；epoch reset 之外的普通 watermark 推进不增加 strict 读写成本。
8. **废除验收**：升级后遗留 `entry:__index` 被一次性清理且不再增长；全库不存在对该 key 的写路径；月索引缺失时 rebuild 从键枚举正确重建（断网可用），且**在清理尚未执行时也能正确排除该 key**。
9. **灰度验收**：客户端新版 + 服务端旧版（不返回 `sync_epoch`）→ 不触发任何重拉；服务端随后上线返回 `0` → 仍不触发重拉。
10. **循环保护验收**：`watermark < since` 或 `has_more=true` 但 watermark 无进展时，本轮中止且不进入紧密死循环；**且该非法响应不触发 epoch 重置**（校验前置于 epoch 环节）；`pull-continue` timer 在 `stopScheduler()` / logout / 测试 reset 后不残留触发。
11. **批末扫描成本验收（v0.8）**：一次 `applyServerEntriesBatch` 内，无论涉及多少个月索引缺失的月份，实体键枚举**至多发生一次**；所有月索引 key 均存在时**一次都不发生**；remove-only 且 key 缺失的月份不写 key、不触发扫描。
12. **资产不断供验收（v0.8）**：epoch 重置轮同样写入资产缓存；构造"epoch 连续差异至截断"的 40 轮场景，资产覆盖写发生 40 次而非 0 次。
13. **空 ledgers 验收（v0.8）**：`changes.ledgers` 为 `[]` 的响应不触发 epoch 重置、不覆盖本地 epoch 记录、watermark 正常推进。
14. 不回归既有用例：`db.spec.ts` watermark 单调性、`syncScheduler` mutex 与 conflict-retry、服务端 T7~T16。

---

## 7. 备选方案与取舍

| # | 备选 | 取舍 |
|---|---|---|
| B1 | advisory xact lock + `deferred` 协议字段（v0.2 S1/S2 原推荐） | "预防"路线：批量写入与 pull 互斥，洞不产生。机制最重（新锁范式 + 事务改造 + 2 协议字段 + 客户端退避），失败模式与 E1 同级（忘记约定 → 洞）。**被 E1 替代** |
| B2 | floor 洞底回退（记录 `last_import_seq_min`，客户端只回退到洞底） | 省一半重拉量，但需 ack 协议让服务端知道客户端消费点（否则连续两次导入覆盖 floor 漏报），复杂度回升。**被 E1 替代** |
| B3 | 导入分批提交（500 条 × 10 小事务，批级幂等 + 断点续传） | 源头化整为零：窗口 2~10s→~200ms/批，R1 降级为"日常级残余"（**非 100% 消除**）；性能综合最优（稳态零 + 只拉增量 + 导入期锁阻塞最小）。代价是**产品语义变"部分导入 + 失败续传"**，且要推翻导入方案 §7.5 单事务幂等。属导入方案自身的决策项，留该方案评估；若采用，本方案 E1 可退役 |
| B4 | per-family 稠密序列（`ledgers` 行计数器同事务取号） | 唯一**根治**（取号=提交顺序，R1 与毫秒级残余全消，客户端零改动）。代价：历史数据重排 migration + 三条写路径改应用层取号 + 加锁顺序不变量重排与死锁分析（pg-mem 测不了锁）。工程量与风险当下不成比例；未来若要治毫秒级残余再启动 |
| B5 | count 对账（pull 带 family active 总数，客户端比对修正 outbox 口径，不符则全量重拉） | 唯一覆盖**一切**丢失源（含毫秒级残余、未知 bug）。E1 全量重拉已内建对账效果，暂不叠加；如需"最终防线"可按低频（launch / 每小时）叠加，成本近零 |
| B6 | 导入期间禁止该 family 写流水 | UI 禁用管不住其他成员设备与 recurring scheduler；服务端拒绝需写路径每次多查（sync/push ×200 乘数）且检查-写入竞态仍需互斥 → 回到 B1，复杂度不降反升。**否决** |
| B7 | 事务末尾重新取号覆盖 change_seq / `ledgers.sync_epoch`+重置（v0.2 备选 C/B） | C：窗口只缩小不消除 + 5,000 行二次 UPDATE，否决。sync_epoch 即 E1——v0.2 以"补救非预防"否之，v0.3 在"机制简单性 + 失败模式安全"的重新权衡下扶正 |
| B8 | C2 摊销变体（保留 `entry:__index`，批末一次全量重写）（v0.3 原设计） | 省一次结构调整，O(n²)→O(n)；但留线性增长单 key（~26k 条爆 1MB）与无消费者死重，且废除是 C6 事实核查下的必然方向。**被废除式 C2 替代（v0.4）** |
| B9 | 严格 `serverVer > localVer`（无 pending 闸门）（v0.4 决策 14） | 立论"同 version 即同内容"在客户端不成立（C7 / §3.6）：会永久丢失服务端规范化的 `category_id` / `shared_type`，并使"服务端写入时补字段"这类能力的客户端护栏消失。**被 §4.4 ③ 的"`>` + pending 闸门 + 内容等价比较"替代（v0.6）**，且新写法同时修掉现状 `>=` 把本地软删复活的既有缺陷 |
| B10 | 每条判定调 `hasPendingEntryOp` | 语义等价于 §4.4 ③，但该函数内部是 O(index) 遍历 ⇒ 批量下退化为 O(n×pending) 次 storage 读，与 C2 消除 O(n²) 的目标冲突。**改为批开始一次性构建 `pendingRefs` Set** |
| B11 | 全局把 `storage.setItem` 改成失败即 throw | 能顺带消除 R7，但 blast radius 过大：预算/资产/公告/统计等缓存路径都依赖"写失败不阻断业务"。**改为仅 epoch reset 使用 `setWatermarkStrict`**，普通 watermark 推进维持宽松语义 |
| B12 | 相等且无 pending → 一律应用（v0.5 中间态） | 正确性能满足 canonical 字段自愈，但 epoch 全量重拉会重写全部老行，无法兑现 C2 性能收益。**被 §4.4 ③ 的内容等价比较替代** |
| B13 | 把 `outbox:__dead_letter` 纳入 `listPendingEntryRefs`（v0.8 评估） | 能挡住"本地软删被复活"，但保护是半截的（`serverVer > localVer` 照样覆盖），代价是该行永久跳过相等档、canonical 自愈永久失效、与服务端长期分叉且无收敛机制。**否决**——根因是 dead-letter 无可见性/无重投，在 pending 闸门打补丁属掩盖问题 ⇒ 决策 29 + follow-up L14 |
| B14 | 批末 null 重建按月各自扫描（v0.7 实现） | 语义正确但成本为 O(月数 × 实体数)（首登 ≈6 万次 `getEntry`），把废除 `entry:__index` 消掉的 O(n²) 以另一形式请回。**被 per-batch 共享懒扫描替代（§4.4 ④）**；共享快照的正确性由"月任务同步块内一次性入队"保证 |

---

## 8. 决策记录（1-15：2026-08-31 · 16-23：2026-09-01 v0.5 复核轮 · 24-27：2026-09-01 v0.6 三轮复核 · 28：2026-09-02 v0.7 施工轮 · 29：2026-09-02 v0.8 施工后复核）

1. **R1 解法选定 E1 epoch**，替代 v0.2 的 advisory lock + deferred（B1 退役）；锁粒度问题随之作废。
2. **epoch 只在批量写入路径 +1，日常单笔记账不加**（每笔加会退化成 change_seq → 无限重拉）；毫秒级残余洞维持独立课题。
3. **C3 未收敛提示移除**（不做 `syncProgress` / `ready-partial` 结算改造）：C1 把收敛压到秒级后窗口极小，不值得加机制。
4. **R3 容量治理部分合并**：废除 `entry:__index` 随本次落地（见 11）；容量监控打点、软删孤儿清理、窗口化归档仍移出，另立容量专题。
5. `MAX_PULL_PAGES = 40`（20,000 条/次，截断后 300ms `pull-continue` 续拉）；`PULL_LIMIT = 500`。
6. **`SYNC_DONE.pulled` 用 C2 `applied` 汇总**（非拉回条数），epoch 重拉时语义不失真。
7. **epoch 记录写回不等收敛**：差异即写、每轮追踪；重置后的爬升即普通增量，中断天然续传。
8. **升级场景采信**（localEpochs=null 且 watermark>0 → 写入当前值不重置），避免老用户升级风暴。
9. R5 队列**只包月索引 key**，实体单 key 读写不进队列（v0.4 随全局索引废除收窄）。
10. 本方案通过后回填 `docs/follow-up/sync-p2-improvements.md` L13 标"已排期"，L13 正文保持"只录问题"定位。
11. **废除 `entry:__index` 合并进本次**（容量专题 P2 提前）：C6 核查确认无生产消费者（读者仅 rebuild 兜底 + 无调用方 `listEntries`），C2/R5 本就重写全部索引写路径，此刻删除成本最低；rebuild 数据源改 `wx.getStorageInfo()` 键枚举（保离线自愈）；升级一次性 `removeItem` 清理，**不 bump STORAGE_VERSION**（bump 会清掉 outbox 未上行 op）。
12. **R5 队列补 `rebuildEntryMonthIndex` 写回入队**（v0.4 核查发现的 lost-update 缺口：rebuild 全量真值可能被批末子集覆盖且不再重触发）；实现纪律=失败隔离/禁重入/localReset/测试 flush（纪律在 v0.5 扩充为 5 条，见 19、21）。
13. **`applyServerChanges` 删除**（非"保留给 push 回填"——已核实 push 回填在 outbox ack 路径直接写 entry）：唯一生产调用方 sync pull 被 C2 取代；本地 `ledger` 实体全库无读者；categories/budgets 各有管理通道且 MVP 恒空。
14. ~~**批量判定收紧为严格 `serverVer > localVer`**：version 服务端单调 ⇒ 同 version 即同内容~~ —— **v0.5 推翻**，理由见 16（B9 留档）。
15. **epoch 比对含 key 集合语义**：本地有 ledgerId 而响应缺失（账本软删/重建）视为 diff → 重置（防御性兜底，1:1 语义下无生产软删路径）。
16. **判定改为 `serverVer > localVer` + 相等档 pending 闸门 + 内容等价比较**（替代决策 14，v0.6 补强）：客户端 `version` 由 push ack 回填、**内容未回写**（`outbox.ts:322-328`），而服务端写入时会做 `category_id` 降级与 `shared_type` 填充（`entryService.ts:249-311,358-374`）⇒ "同 version 即同内容"不成立，严格 `>` 会永久丢失 canonical 字段并使这类护栏消失；而"相等一律覆盖"又会复活本地软删（`deleteEntry` 不推进 version），并让 epoch 重拉退化为全量覆写。相等档最终语义：`pending → skip`；`无 pending + 内容等价 → skip`；`无 pending + 内容漂移 → apply`。hydrate 的 `_putRemoteEntryIfSafe` 仅在无 pending 分支同向；其 pending 恒 skip 的优先级差异保留到后续统一决策。
17. **epoch 写序与强写不变量：先 `setWatermarkStrict(0)`，确认成功后写 `writeLedgerEpochs`**。反序、或清零失败仍写 epoch，都会落到「epoch 新值 + watermark 旧高值」→ 不再重置且洞内行 `change_seq < watermark` → **真丢数据**。这是本方案唯一能造成丢数据的实现细节，必须写进代码注释；普通分页推进不全局改 strict，避免扩大稳态失败面。
18. **epoch 提取归一化 `?? 0`**：灰度必然是客户端先上线；不归一化则服务端上线 `sync_epoch` 当天 `undefined !== 0` → 全体一次全量重拉（升级风暴的第二个入口）。
19. **批末月索引任务必须自带 null 裸重建分支**：重读为 null 时把 delta 当全量写回会造出"key 存在但只含子集"的月索引，使 `listMonthEntries` 的 `if (!idx)` 兜底永久失效 → 该月持久缺条（与 12 同类故障、不同入口，单线程下也必现）。因纪律 2 禁止重入，须把推导重建拆为**不入队的内部 helper** 供任务复用。
20. **`has_more=true` 的轮次跳过 `computeSystemCategoriesRevision()`**：分页循环把这项既有 per-request 成本 ×10~40。`changes.ledgers` 保持每轮下发（单行查询 + 供 epoch 与资产不断供）。原 §6 口径 5"服务端每轮无额外查询"只算了 epoch，漏算循环乘数，已修正。
21. **rebuild 键枚举显式排除 `entry:__index`**：原过滤规则（`entry:` 前缀 + 余段无 `:`）排不掉它（`__index` 不含 `:`），不能把正确性押在"升级清理必然已执行"上。同时明确键枚举会多读软删实体（量级 = R3 孤儿 key）。
22. **`localReset` 只登记 R5 队列的内存状态**：epoch 存 storage，logout 走 `clearAllForReset` 全量清空，无需逐 key 登记（原清单会写出多余代码）。
23. **E1 的上线依赖需写进导入方案**：当前代码库无任何批量写入路径（`import-entries.mts` 已于 2026-09-02 删除，见 27）⇒ 本次落地后 `sync_epoch` 恒为 0、客户端 epoch 逻辑零生产覆盖。预埋是必要且正确的（客户端消费能力必须先于服务端行为），但**导入功能上线的前置条件 = 客户端 epoch 消费版本已达目标覆盖率**，否则导入上线时旧版本客户端仍会踩 R1 洞。
24. **`setWatermarkStrict` 只在 epoch reset 使用**：strict 写 = 写失败抛错 + 读回确认；其负面影响是低频路径多一次 storage IO、失败时本轮中止/下轮重试/偶发重复全量重拉。该代价用来消除"永久漏拉"，收益大于成本；不扩散到普通分页推进。
25. **`sameEntryContent` 是 C2 性能口径成立的前提**：相等且无 pending 时不能一律应用；必须比较业务字段并排除 `created_at` / `updated_at`，只在内容漂移时写入，才能同时满足 canonical 自愈与老行 skipped。
26. **分页循环必须有 watermark 进度保护**：`watermark < since` 或 `has_more=true` 且 `watermark === since` 都中止本轮；`pull-continue` timer 纳入 `stopScheduler()` / `__test__.reset()` 清理，防 logout/测试残留。
27. ~~**`server/scripts/import-entries.mts` 不得成为 E1 旁路**~~ **已关闭（2026-09-02）**：脚本已删除（连同 `export-entries.mts`）；删除前已实装同事务 `sync_epoch + 1` 并审计过资产余额与 `client_ref_id`。
28. **纪律 5 扩展至 mutation/hydrate 入口 + epoch 重置轮计入 pages 预算**（v0.7 施工轮复核）：`reindexEntry` upsert 读到 null 跳过写入、保持 key 缺失（对称 remove 分支，读路径 rebuild 兜底；不在写路径做 O(n) 重建）；epoch diff 轮 `pages++` 并受 `MAX_PULL_PAGES` 截断 + 轮间让出（防持续批量写入期间紧密循环）；`pendingRefs` 采用调用方注入（db→outbox 循环依赖约束）+ 缺省 warn 兜底；推导重建 helper 拆"计算/写回"两层，批末 null 分支用只计算层消同 key 双写。
   - **v0.8 补记取舍**：纪律 6 同时覆盖了"真正的新月份"（该月本无任何本地实体，写单条本就正确），代价是每个新月的首笔记账不建索引 ⇒ 明细页首次读该月付一次 O(全部本地实体) 键枚举。**这是把成本从写路径转移到读路径首屏，不是纯收益**，需按 §4.5 纪律 6 的打点建议观测 `rebuilt-month-index` 命中率。

29. **dead-letter 不计入 `listPendingEntryRefs`**（v0.8 · 显式取舍，非遗漏）：

    `outbox:__dead_letter` 中的 op 不进相等档 pending 闸门。直接后果是——dead 的 `delete` op 对应的行（本地软删**不推进 version**）会在下一次 pull 的"相等档 + `deleted_at` 内容漂移"判定下被覆盖，即**本地软删被复活**；dead 的 `update` op 同理被回退成服务端旧值。

    **为什么不纳入**：
    - dead-letter 是**终态**（无自动重试、无重投入口、只有 logout / storage 版本迁移会清）⇒ 纳入即**永久**跳过相等档，该行与服务端长期分叉且**无收敛机制**，§3.6/§3.8 要求的 canonical 字段自愈对它永久失效；
    - 而且这种保护是**半截的**：`pendingRefs` 只作用于相等档，服务端那行 `version` 一旦 +1，`serverVer > localVer` 分支照样覆盖 ⇒ 换来的只是把覆盖时刻从"确定的下一次 pull"推迟到"不确定的将来"，并非真的保住用户改动；
    - 本模型以**服务端为唯一真源**：改动没送达 = 没发生，让 pull 覆盖并收敛，行为可预测。

    **口径分歧是有意的**：`pendingCount()` **含** dead-letter（服务 logout 前的"有未上行数据"风险提示，宁可多报）；`listPendingEntryRefs` **不含**（服务"是否阻止服务端同 version 覆盖"）。两者问的不是同一个问题，结论必须分开取。`outbox.ts` 中有配套注释，防止后人"顺手对齐"。

    **真正的根因另案处理**：用户改动被静默吞掉，根因是 **dead-letter 本身没有可见性与重投能力**（只有一行 `logger.error`）。在 pending 闸门上打补丁属于掩盖问题，方向错误 ⇒ 立 follow-up **L14**（可见性 + 手动重投 + 明确的"放弃并告知"语义 + `create` 幽灵行处置）。
