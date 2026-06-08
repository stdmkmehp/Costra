# FU-SUMMARY-PERF · 后端 family summary 聚合查询性能

**Status**: Open（观察中 · P3 · 当前用户量级无压力）
**Owner**: Backend
**Created**: 2026-06-04
**Source**: 2026-06-04 sync-refresh 机制改造期间识别

---

## 现状

`GET /v1/families/{id}/summary?month=YYYY-MM&top_n=N` 由 `server/src/services/familySummaryService.ts` 实现，
目前直接对 PostgreSQL 做实时聚合查询，**无任何后端缓存层**。

单次请求会并发执行 4 条聚合 SQL（`familySummaryRepo`）：

| 查询 | 用途 |
|---|---|
| `getTotals` | 月总收支 / 共享支出 / 个人支出 / entry_count |
| `getMemberAggregates` | 每位成员的个人支出 + 垫付贡献 |
| `getCategoryRanks` | 公共支出分类 top N |
| `getPersonalCategoryRanksByMember`（批量） | 各成员个人支出分类 top N |

加上 `familyMemberRepo.listMembersWithUsers` 共 5 次 DB round-trip（已并发）。

**已建索引**：`idx_entries_ledger_occurred`（ledger_id + occurred_at）、`idx_entries_shared_type`。

**前端缓解**：`miniprogram/services/familyApi.ts` 中已有 SWR 内存缓存（5 分钟 TTL，20 条上限）。

---

## 风险触发条件（任一满足即应启动优化）

1. **数据规模**：单月单家庭 entries > 5000 条（聚合 SQL 单次耗时观测 > 500ms）
2. **并发压力**：summary 接口 P95 RT > 800ms 或 QPS > 50
3. **业务变化**：年度统计上线（year-window 范围比月扩大 12×）
4. **Sprint 改造**：sync-refresh 机制上线后，每次 push/pull 都会触发 family 页 invalidateCache + 重拉 summary，
   理论上同一用户的请求量上升（粗略 ×2~3），需在 Sprint 结束后观察实际曲线

---

## 候选方案（评估而非承诺）

### 方案 A · Redis 缓存 + 主动失效（推荐起点）

- 缓存 key：`fsummary:{family_id}:{month}:{top_n}`，TTL 60s
- 失效时机：family 内任一 entry 发生 mutation（POST/PATCH/DELETE entries）时清除该 family 当前月与上一月（跨月条目）的缓存
- 收益：命中时几乎零 SQL 开销；不命中时退化为现状
- 成本：引入 Redis（基础设施 + 运维）；需保证失效时机覆盖所有 mutation 路径（含 sync push）

### 方案 B · PostgreSQL 物化视图

- 物化视图按 (family_id, month) 预聚合 totals / member_aggregates
- 通过 trigger 或定时 `REFRESH MATERIALIZED VIEW CONCURRENTLY` 维护
- 收益：免引入 Redis；查询稳定性高
- 成本：物化视图实时性较差（trigger 路径维护成本大；定时刷新有滞后）；CONCURRENTLY 需要唯一索引

### 方案 C · 预聚合表（应用层维护）

- 新增表 `family_monthly_summary`（family_id, month, totals JSON, member_aggregates JSON, updated_at）
- mutation 路径同步更新该表（事务保证一致性）
- 收益：查询 O(1)；可扩展为前端展示直接 ORM 映射
- 成本：所有 entry mutation 路径都需联动更新；冲突合并复杂；初次回填脚本

### 方案 D · 分页 + 渐进式加载

- summary 拆分为 totals + segments + categories 多接口
- 客户端先渲染 totals（最快），再异步加载 categories 等 detail
- 收益：感知性能；不改后端聚合开销
- 成本：前端改造大；不是真正的"性能优化"

---

## 决策建议

- **当前阶段**（用户量 < 50）：保持现状，仅监控
- **触发条件命中后**：优先方案 A（Redis），与现有 `auth/session` 等基础设施复用难度低
- **若 Redis 引入受阻**：退到方案 C（预聚合表），方案 B 物化视图作为后备

---

## 验证待办

- [ ] 在 metrics 中加入 summary 接口 P50/P95/P99 RT 监控
- [ ] CI 加入慢查询日志开关（pg_stat_statements）便于回归比对
- [ ] sync-refresh 上线后 1 周回归 summary QPS 实际倍数

---

## Refs

- 关联代码：`server/src/services/familySummaryService.ts` · `server/src/repositories/familySummaryRepo.ts`
- 关联前端：`miniprogram/services/familyApi.ts`（SWR 缓存层 · 5min TTL）
- 引入背景：sync-refresh 机制（`.team/HANDOFF-2026-06-04-sync-refresh.md`）会增加 family 页重拉 summary 的频次，使本 follow-up 风险触发概率上升
