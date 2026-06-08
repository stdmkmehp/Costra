# Tech Review · COSTRA-224 · Round 1

- 被审 Agent：backend
- 本轮产出 commit：d209447
- 审核时间：2026-06-06T00:15:00+08:00
- 上轮结论：首轮

## 总评

- **Verdict**：`PASS`
- **总分**：31/35 分
- **阻塞点**：0 个 P0 / 0 个 P1 / 4 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| 契约一致性 | 5/5 | OpenAPI 先行，3 endpoint + 9 schema 与 service 层响应结构完全对齐 |
| 架构与分层 | 4/5 | 三层分明（route→service→repo），但 service 729 行偏胖，且 drillDownL3 复用全量聚合查询获取单分类总额可优化 |
| 数据与持久化 | 5/5 | migration 0014 幂等、partial index、pg-mem 双写同步到位 |
| 离线与同步 | N/A | Backend 产出 |
| 安全与合规 | 5/5 | 无 session_key/openid/AppID 泄漏、无主体硬编码、无 console.log |
| 可测与可观测 | 5/5 | 14 test cases 覆盖全路径，涵盖边界/口径/权限/已退出成员/分页 |
| 工程纪律 | 4/5 | Conventional Commits + Refs 齐全；statisticsService.ts 729 行 > 500 行 -1 分 |

## P0 阻塞点（必改）

无。

## P1 应改

无。

## P2 建议

### P2-1 statisticsService.ts 行数偏高（729 行 > 500）

- **证据**：`server/src/services/statisticsService.ts`（全文 729 行）
- **问题**：超 500 行工程纪律红线（-1 分），虽未到 1000 行 Reject 级别
- **依据**：system prompt §3.7 "单文件 > 500 行 = -1 分"
- **修复建议**：将辅助函数（`parseMonthRange / parseYearRange / getShanghaiDay / getShanghaiMonth / getDaysInMonth / calcBps / foldL2ToL1 / buildL1RankItems`）抽取到 `server/src/services/statistics/helpers.ts`，主文件仅保留 3 个 API 入口

### P2-2 drillDownL3 复用全量 getCategoryAggregates 获取单分类总额

- **证据**：`server/src/services/statisticsService.ts:714`
- **问题**：`getCategoryAggregates` 按全 ledger + 时间范围聚合所有 category_id 的 expense，仅用 `.find()` 取其中一个。当分类数多时有冗余 IO/计算。
- **依据**：tech spec §3.3 "drill-down level=3 P95 ≤ 200ms"（当前 5000 条目级够用，但未来增长存在风险）
- **修复建议**：新增 `statsRepo.getSingleCategoryTotal(ledgerId, rangeStart, rangeEnd, categoryId)` 单分类 SUM 查询，替换全量查询

### P2-3 技术设计文档提到 `user_id` 可选参数（成员维度筛选）但 OpenAPI/实装均未定义

- **证据**：`docs/design/statistics-page-tech-spec.md:95` "user_id: UUID (optional · 成员维度筛选 · R1 不传或为空表示「全部」)"
- **问题**：tech spec 定义了 `user_id` 参数，OpenAPI 和实装均未包含。虽然 tech spec 明确标注"R1 不传"属延后范围，但文档与 OpenAPI 存在微小不一致（OpenAPI 是第一权威）
- **依据**：§3.1 契约一致性——OpenAPI 为事实源
- **修复建议**：在 tech spec 对应行加注"（R1 不在 OpenAPI 定义 · 预留 R2 扩展）"使意图更明确；或后续卡补 OpenAPI query parameter（带 `deprecated: false` 标记）

### P2-4 年度 avg_monthly_expense 使用"最大有数据月份"作为分母

- **证据**：`server/src/services/statisticsService.ts:476-492`
- **问题**：`maxMonthWithData` 取的是"有 entry 的最大月份索引"作为分母，如果只有 1 月和 8 月有 entry（中间月空），分母为 8 而非 2。这与 tech spec §3.1.2 "月均 = expense / 当年已过月份数" 语义可能有歧义
- **依据**：`docs/design/statistics-page-tech-spec.md:188` "avg_monthly_expense: 月均 = expense / 当年已过月份数"
- **修复建议**：确认产品意图——当前实装"已过月份数=有 entry 的最大月份 index"是合理的（对于查看当前年份，比如 6月查看 2026年，分母为 6 而非 12），无需立即修改，但建议在注释中明确该口径与产品的约定

## 与上轮的差异（N ≥ 2 才写）

N/A（首轮）

## 给被审 Agent 的回执指令

Orchestrator 拉起 backend-dev 时，请附上本文件全文，并要求其：
1. P0 = 0，无阻塞修复
2. P2 建议记入后续 Sprint backlog（P2-1 建议在下一轮重构卡中处理）
3. 本轮 PASS，可继续推进后续卡

## 自我反思

- 本次审核耗时估计：12 分钟
- 置信度：高
- 理由：typecheck 0 error / vitest 164/164 全绿 / whitelist+appjson+tooling 全绿 / 代码与 OpenAPI 逐字段核对一致 / 安全扫描无泄漏 / 口径与 familySummary 对齐 / commit 格式规范 / 文件均在 backend 工作区内
