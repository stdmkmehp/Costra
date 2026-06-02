# Card Review · COSTRA-222 · Round 1 · Tech

- **触发**：`card-review:COSTRA-222`
- **卡 Owner**：backend-dev
- **卡类型**：backend feature + OpenAPI schema
- **估点**：5
- **审查时间**：2026-06-02T15:25:00+08:00
- **审查对象**：`.team/dispatch/COSTRA-222-backend-family-summary-api.md`
- **审查角色**：costra-card-reviewer-tech（只读审查，Orchestrator 物理落盘）
- **前置状态**：`COSTRA-221` Human T1 APPROVED CLOSED；commit `1b0dde0 feat(backend): implement family management API`

---

## 1. 总评

| 项 | 结论 |
|---|---|
| **Verdict** | `PASS-WITH-FOLLOWUP` |
| **Score** | `27/30` |
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 4 |
| **INFO** | 0 |
| **是否可 start** | 是，Human 可触发 `start:COSTRA-222` |

结论：`COSTRA-222` dispatch 足以进入实现阶段。它能支撑家庭页公共/个人收支、垫付贡献、分类下钻、left member 展示，并与后续 `COSTRA-224/225` 统计域边界清晰。4 个 P2 均为增强建议，不阻塞 start。

---

## 2. 维度评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| C1 标题与描述 | 5/5 | 标题精准；背景、目标、范围三要素齐全。 |
| C2 DoD 可度量 | 5/6 | 功能/工程 DoD 可验证；`shared_type IS NULL` 兜底策略建议加入 DoD。 |
| C3 依赖识别 | 5/5 | 上游 `COSTRA-221`、`COSTRA-217`；下游 `COSTRA-223/224/225` 清晰。 |
| C4 产出物具体 | 5/5 | path、schema、service/repo/route/test 文件、响应结构、错误码均具体。 |
| C5 风险与边界 | 3/4 | 时区、性能、N+1、索引 FU 有识别；性能阈值可量化。 |
| C6 去重 | 3/3 | 与 `COSTRA-224` 统计域边界清楚，无重复卡。 |
| C7 估点 | 1/2 | 5 点合理但偏紧，聚合 SQL + 响应组装 + 16 测复杂度较高。 |
| C8 红线 | PASS | 无 secret/主体硬编码；不改 miniapp；不引入 `shared_scope`；不混入 stats/预算/订阅消息。 |

**总分：27/30**。

---

## 3. P0 阻塞点

无。

## 4. P1 应改

无。

---

## 5. P2 建议

### P2-1 · `shared_type IS NULL` 的 expense 兜底策略应在 DoD 中显式验收

- **证据**：dispatch §3.B.8 写明 R1 必须二选一，推荐排除聚合并登记 `skipped_unclassified_expense_count`；但 §5 DoD 未显式列出。
- **影响**：实现者可能遗漏该边界。
- **建议**：R1 实装时在功能 DoD / 测试中补充：`shared_type IS NULL` 的 expense 不进入 shared/personal 聚合，返回 `details.skipped_unclassified_expense_count` 或等价可观测字段。

### P2-2 · 缺少查询性能量化边界

- **证据**：dispatch §7 有 `FU-222-SUMMARY-PERF-INDEX`，但无 P95 阈值。
- **影响**：聚合 SQL 随 entries 增长可能退化，缺少启动索引优化的判定线。
- **建议**：补充 R1 目标：单月 entries ≤ 5000 时 summary P95 ≤ 500ms；超过该量级触发 `FU-222-SUMMARY-PERF-INDEX`。

### P2-3 · 测试矩阵缺少混合场景测试

- **证据**：T7/T8/T9/T10 分别覆盖 shared、personal、income、balance，但缺少同月混合场景。
- **影响**：真实家庭月份通常同时包含 shared expense + personal expense + income + transfer。
- **建议**：在 T10 后补 T10.5：同月含 shared expense + personal expense + income + transfer，断言 `totals.expense = shared_expense + personal_expense`、`balance = income - expense`、transfer 不进入聚合。

### P2-4 · `FamilySummaryMember.entry_count` 口径需统一

- **证据**：`FamilySummaryMember.entry_count` 注释为“该成员本月支出 entry 数，不含 income”，而 `totals.entry_count` 注释为 `income+expense+transfer if present`。
- **影响**：同名字段在不同层级语义不一致，前端易误解。
- **建议**：将 member 级字段改名为 `expense_count`，或明确所有 `entry_count` 均只统计 expense；OpenAPI description 必须同步。

---

## 6. 专项审查

### 6.1 家庭页支撑能力

| 设计需求 | dispatch 覆盖 | 结论 |
|---|---|---|
| 家庭总支出/收入/结余 | `totals.expense / income / balance` | ✅ |
| 公共支出与成员个人支出拆解 | `totals.shared_expense / personal_expense` + `segments[]` | ✅ |
| 公共支出的垫付贡献比例 | `shared.paid_contributions[]` | ✅ |
| 成员个人支出列表 | `personal_by_member[]` | ✅ |
| 公共/个人支出下钻分类排行 | `shared.categories[]` + `personal_by_member[].categories[]` | ✅ |
| active/left member 展示 | `members[]` 含 `status` + `left_at` | ✅ |
| 全局占比视窗 | `segments[]` 含 `ratio_bps` | ✅ |

### 6.2 与统计域边界

边界清晰：本卡不做年度、趋势折线、同环比、日均、最大单笔、完整统计页；`dimension=yearly` 明确归 `COSTRA-224`。

### 6.3 时区口径

R1 固定 `Asia/Shanghai` 合理且可测：dispatch 明确 `[start,end)` 月区间，转 UTC 进行 SQL 比较，T15 覆盖月边界。后续用户 timezone 归 `FU-222-USER-TIMEZONE`。

### 6.4 测试矩阵

T1~T16 基本完整；建议补混合场景 T10.5。

---

## 7. 结论与下一步

```text
PASS-WITH-FOLLOWUP 27/30
0 P0 / 0 P1 / 4 P2
```

可进入下一阶段：

1. Human 触发 `start:COSTRA-222`。
2. `costra-backend-dev` 按 dispatch 实装。
3. R1 实装时建议顺手吸收 4 个 P2，尤其 `entry_count` 命名与混合场景测试。
4. 实装完成后自动拉起 `review-tech:COSTRA-222`。
