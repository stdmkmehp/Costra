# Follow-up: 记账同步架构 P2 改进项

> 来源: 2026-06-04 记账同步 Bug 修复与架构评估
> 状态: 待排期

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
