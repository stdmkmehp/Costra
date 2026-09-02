# Follow-up: 记账同步架构 P2 改进项

> 来源: 2026-06-04 记账同步 Bug 修复与架构评估
> 状态: 待排期
>
> ⚠️ L13 的**严重度高于本清单其余项**（会产生静默错误数据），且是导入/导出功能的硬前置，建议单独提优先级排期。

## L9: outbox 存储效率优化

**问题**: outbox 用 wx.storage 存储，单条 op 一个 key。每次 `findPendingOp` 遍历 index 逐条 `getItem`，O(n) IO。

**建议**: 可改为一个大 key 存完整 ops 数组（trade-off：原子性 vs 性能）。当前规模（<10 条 pending）可接受，家庭多设备高频场景下可能需要优化。

## L10: ledgers/categories/budgets 的 wireToEntry 映射

**问题**: 目前只有 entries 做了 `wireToEntry` 字段映射。后续 pull 实现 categories/budgets 时，也会有 `server_version` vs `version` 的映射问题。

**建议**: 实现 FU-154-CATEGORIES-PULL 时需统一加映射函数（wireToCategory、wireToBudget）。

## L11: 幂等键 TTL 清理 cron

**问题**: 幂等键表有 `expires_at` 但依赖外部 cron（`FU-104-IDEMPOTENCY-CRON`）清理。如果 cron 没配，表会无限膨胀。

**建议**: 确认 cron 已部署，或在应用启动时执行一次 `DELETE FROM idempotency_keys WHERE expires_at < now()`。

## L12: pushDelta 单轮 batch 限制

**问题**: 一次 `syncOnce` 只做一轮 `pushDelta`（maxBatch=200）。如果 outbox 有 >200 条，剩余要等下次 syncOnce。

**建议**: 在 pushDelta 中循环直到 drainBatch 返回 null，或在 syncOnce 中循环 push。当前单用户记账频率不会触发，家庭多人同时大量记账时可能积压。

## L13: sync pull 的 `has_more` 无人消费（大批量增量收敛极慢 + 月度合计静默错误）

> 来源: 2026-08-27 客户端导入/导出方案二轮评审发现（`docs/design/data-import-export-client-analysis.md` §5.1，该方案将其列为 **E0 硬前置卡**）
> 状态: **已施工** · 方案定稿见 `docs/design/sync-pull-pagination-design.md` v0.8（E1 epoch 版本戳 + C1 分页循环 + C2 批量落盘·废除 `entry:__index` + R5 月索引写串行队列）。2026-09-01 落地：服务端 migration 0019 `ledgers.sync_epoch` + syncPullService 透传/`has_more` 轮跳过 `categories_revision`；小程序 `applyServerEntriesBatch`（判定 `>` + pending 闸门 + `sameEntryContent`）+ 废除全局索引 + R5 串行队列 + `setWatermarkStrict` + epoch 前置比对/重置 + `pull-continue` 续拉；导入脚本同事务 `sync_epoch + 1`。2026-09-02 第四轮复核修复（v0.8）：批末 null 重建改 per-batch 共享扫描（消 O(月数×实体数)）、remove-only delta 跳过写入、`ledgers` 为空不比对 epoch、资产写前移至 epoch 判定之前、watermark 校验前移、`flushIndexQueue` 超限抛错；冒烟用例落地 `qa/cases/sync-pagination-smoke.md`（含协议 §8 `smoke_sync_05` = SP-001）。本节保持"只录问题"定位。

**问题**: 服务端 `/sync/pull` 早已正确返回 `has_more`（`entryRepo.findEntriesByFamilySince` 多取一行判定），但客户端 `syncPull` 只把它打进 debug 日志，**没有任何循环消费**：

```ts
// miniprogram/services/sync.ts —— has_more 只进日志
logger.debug('sync:pull', `received · watermark=${resp.watermark} ... has_more=${resp.has_more}`);
```

单轮 limit = 200（`syncScheduler.ts`；协议 schema 已支持 `maximum: 500`）。任何单次超过 200 条的增量，都要靠 `periodic`（60s）一轮一轮补：**N 条增量 ≈ ⌈N/200⌉ 分钟收敛**。

**为什么不只是"慢一点"，而是"错数据"**: 明细页 `listMonthEntries` 的 `complete` 判定是"本地索引条数 vs 请求 limit"，**与"服务端还有没有"无关**。大批量增量未拉完时，页面会停在 `ready-full` 并显示**不含未拉取记录的月度合计**，且全程无任何"数据不完整"提示。静默错误比慢严重得多。

**复现/影响场景（两个，均无需导入功能即可触发）**:

1. **既有场景 · 今天就存在**：新设备 / 清缓存后登录一个有几千条流水的老账号 → 明细页先渲染出"完整"的假合计，之后数十分钟内数字逐轮爬升。
2. **放大场景 · 导入功能上线后**：服务端导入一次写入最多 5,000 条（见导入方案 §9.1），必现 25 轮 pull ≈ 25 分钟。因此本项是导入/导出方案的**硬前置**，不动工则不能发布导入。

**与 L12 的关系**: L12 是 push 侧单轮上限，L13 是 pull 侧同类问题，但 L13 有"静默错误合计"这一 L12 没有的危害，且复现门槛低得多，优先级应显著更高。

**设计约束（正式方案时必须逐条回应，避免引入新问题）**:

- watermark 必须**逐轮推进并落盘**（中途失败可续，不回退到 0 重拉）；
- 循环需有**迭代次数上限**与批间让出，防止单次 sync 长时间占用网络与主线程；
- 循环期间**不要每轮都 emit `SYNC_DONE`**（明细页会逐轮重渲、列表跳动），应在拉完后统一广播一次；
- 与 `syncOnce` 的 `isRunning` mutex / `pendingRetrigger` 的交互需明确（长循环期间跳过的新触发如何合并）；
- `applyServerChanges` 内 `appendToIndex` 是"读全量数组→`includes`→重写整 key"，大批量下拉会与循环叠加成 O(n²) 存储 IO，方案需评估是否顺带改造或接受（注意微信 storage 单 key 1MB / 总量 10MB 上限）;
- 服务端 `GET /sync/pull` 的 `limit` 上限（500）与客户端取值需一并确认。

**验收口径（方案落地后的判定标准）**:

- 新设备登录 5,000 条流水的账号，从首拉到数据完整收敛 ≤ 60s（前台持续在线时）；
- 收敛期间明细页不得显示"完整合计"状态的伪精确数字（要么有"同步中"提示，要么不结算为 `ready-full`）；
- 中断（杀小程序 / 断网）后恢复不从头重拉；
- 不回归既有用例：`db.spec.ts` watermark 单调性、`syncScheduler` 的 mutex 与 conflict-retry 行为。

## L14: outbox dead-letter 是静默黑洞（本地改动被吞且无可见性 / 无重投）

> 来源: 2026-09-02 L13 第四轮复核。判定 dead-letter **不计入** `listPendingEntryRefs` 的相等档闸门时，暴露出的上游问题（L13 决策 29）。

**问题**: `ackBatchFailure` 连续失败 `MAX_RETRIES=5` 次后，op 被 `moveToDeadLetter` 移入 `outbox:__dead_letter`。这是**终态**：

- 没有自动重试（dead-letter 不参与 `drainBatch`）；
- 没有手动重投入口，没有任何 UI；
- 唯一"清理"方式是 logout（`clearAllForReset`）或 storage 版本迁移——即**连同用户数据一起丢弃**；
- 可见性只有 `syncScheduler.ts` 的一行 `logger.error('⚠️ DEAD_LETTER … data may be lost')`，用户完全看不到。

**由此产生的可观察后果**（L13 复核确认，属**已知取舍**而非缺陷）:

- dead 的 `delete` op：本地软删不推进 `version` ⇒ 下一次 pull 在"相等档 + 内容漂移（`deleted_at`）"判定下覆盖本地 ⇒ **用户删掉的流水自己回来了**，无提示；
- dead 的 `update` op：同理，本地编辑被回退成服务端旧值；
- dead 的 `create` op：服务端根本没有该行，pull 永不下发 ⇒ 本地变成**永久幽灵行**，任何设备都看不到它，且不会再尝试上行。

**为什么不在 L13 里顺手修**: 把 dead-letter 塞进 `pendingRefs` 只能得到**半截保护**——服务端那行 `version` 一旦 +1，`serverVer > localVer` 分支照样覆盖；换来的只是把覆盖时刻推迟到不确定的将来，同时让 §3.6 的 canonical 字段自愈对这些行永久失效，并让该行与服务端长期分叉且无收敛机制。属于"为掩盖问题写硬逻辑"，方向错误。

**正确方向（待方案）**:

1. **可见性**：dead-letter 非空时给用户明确入口（"有 N 条改动未能同步"），而不是只打日志；
2. **重投**：提供手动重试通道（重置 `retries` + 换 `idempotency_key` 回 index），网络长期恢复后应能自愈；
3. **放弃语义**：若确认放弃，应显式告知"该条已回退为服务端版本"，而不是让它在某次 pull 后静默变回去；
4. 顺带明确 `create` 幽灵行的处置（重投 / 提示删除）。

**关联**: L13 §4.4 ③ 决策 29；`miniprogram/services/outbox.ts` 的 `listPendingEntryRefs` 有配套注释说明"有意不含 dead-letter"，改动前请先读该注释。
