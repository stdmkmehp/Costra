# COSTRA-222 R1 实装 · Family Summary API

> 日期：2026-06-02 · 卡号：COSTRA-222 · 角色：backend-dev

---

## §1 任务摘要

Human 触发 `start:COSTRA-222` 后，完成家庭财务聚合 API R1 实装，提供家庭页公共/个人收支、垫付贡献、分类排行、left member 展示等后端聚合能力。

## §2 交付范围

- 新增 `GET /v1/families/{family_id}/summary?month=YYYY-MM&top_n=N`。
- 新增 `server/src/repositories/familySummaryRepo.ts`。
- 新增 `server/src/services/familySummaryService.ts`。
- 扩展 `server/src/routes/families.ts` 注册 summary route。
- 扩展 `server/api/openapi.yaml`，新增 `FamilySummary` 及相关子 schema。
- 新增 `server/test/family-summary.test.ts`，覆盖 17 条用例。

## §3 核心口径

- 固定时区：`Asia/Shanghai`，按 `[month_start, next_month_start)` 转 UTC 查询。
- 金额：全程 integer cents。
- `expense = shared_expense + personal_expense`，仅统计 `shared_type in ('shared','personal')` 的 expense。
- `income` 只进入 `totals.income` 和 `balance`。
- `transfer` 不进入 expense/income/balance。
- `shared_type IS NULL` 的 expense 不进入聚合，计入 `skipped_unclassified_expense_count`。
- `paid_contribution` 按 shared expense 的 `created_by` 聚合。
- member 级计数命名为 `expense_count`，避免与 totals.entry_count 口径混淆。
- left member 仍展示历史贡献，状态为 `left`。
- category rank 支持 parent category 信息、top_n、零值排除、amount DESC 排序。

## §4 吸收 card-review P2

| P2 | 处理 |
|---|---|
| `shared_type IS NULL` DoD | 已实现 `skipped_unclassified_expense_count` 并新增 T16 覆盖 |
| 性能边界 | repo/service 注释明确 R1 目标：单月 entries ≤ 5000 时 P95 ≤ 500ms，超出触发 `FU-222-SUMMARY-PERF-INDEX` |
| 混合月场景 | 新增 T10.5 覆盖 shared + personal + income + transfer |
| member entry_count 口径 | 改为 `expense_count`，OpenAPI/service/test 同步 |

## §5 pg-mem 兼容修复

首轮测试中 pg-mem 不支持 `HAVING SUM(...) > 0`，且对部分 UUID LEFT JOIN 聚合行为不稳定。最终实现改为：

1. 先按 `entries.category_id` 聚合；
2. 再批量查询 categories 与 parent categories；
3. 在 service/repo 层组装排序和 top_n。

该实现仍避免 N+1：每次 category rank 最多 3 次查询。

## §6 验证结果

- `cd server && npm run typecheck` ✅
- `cd server && npm test -- --run test/family-summary.test.ts` ✅ 17/17
- `cd server && npm test -- --run` ✅ 141/141

## §7 下一步

建议进入 `review-tech:COSTRA-222`。
