# Tech Review · COSTRA-217 · Round 1

- 被审 Agent：backend
- 本轮产出 commit：未提交（工作区 dirty · 等 Human 明确提交指令）
- 审核时间：2026-06-08T17:30:00+08:00
- 上轮结论：首轮

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：29/35 分
- **阻塞点**：0 个 P0 / 3 个 P1 / 4 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| 契约一致性 | 4/5 | OpenAPI 与代码高度对齐，但 updateWithVersion 缺少 shared_type 对非 expense 的服务层校验 |
| 架构与分层 | 5/5 | 严格遵守 ADR-0002 技术栈，目录权限合规，依赖注入模式良好 |
| 数据与持久化 | 4/5 | migration 设计精巧，0008 幂等性有细微风险，0009 简洁正确，schema.md 同步到位 |
| 离线与同步 | 4/5 | sync/pull 透传 shared_type，sync/push 通过 entryService 间接支持，但 sync/push payload schema 未显式声明 shared_type |
| 安全与合规 | 5/5 | 无 AppID 泄漏、无主体硬编码、无敏感信息日志、跨 family 守门保持完整 |
| 可测与可观测 | 4/5 | 100/100 测全绿，关键路径覆盖良好，但 seed 数量硬断言未在 pg-mem 验证、1 处 console.log 残留 |
| 工程纪律 | 3/5 | 无 debug 临时文件残留，但 design/ 目录存在非本卡变更，变更未 git commit |

## P0 阻塞点

无

## P1 应改

### P1-1 updateWithVersion 缺少 shared_type 对非 expense 的服务层校验

- **证据**：`server/src/services/entryService.ts:241-263`
- **问题**：create 路径已校验 `shared_type != null && type !== 'expense'`，但 updateWithVersion 直接透传 `payload.shared_type` 给 repo，未校验当前 entry 的 type 是否为 expense。DB CHECK 会拦截，但不符合 dispatch §2.B.5 “服务端返回标准错误，不得写入 DB”。
- **修复建议**：在 `updateWithVersion` 中，当 `payload.shared_type !== undefined` 时先查 entry type，非 expense 返回标准错误。

### P1-2 0008 migration 幂等性中断态风险需注释

- **证据**：`server/db/migrations/0008_categories_hierarchy_seed.sql:147-158`
- **问题**：7b~7d 临时重命名策略整体幂等，但若执行在 7b 后、7d 前中断，可能残留 `__migrate__*` 中间态。
- **修复建议**：在 migration 头部注释中标注中断态人工恢复方式。

### P1-3 design/ 目录存在非本卡变更

- **证据**：`git diff design/ui/design_spec.md`、`git diff design/ui/interaction_flow.md`
- **说明**：这些 design/ 修改在本轮开始前已存在，不应由 backend-dev 处理或回退；Orchestrator 需在最终汇报中标记为 pre-existing working tree noise。

## P2 建议

1. 系统分类 seed 数量硬断言未在 pg-mem 验证，需真实 PG 或 SQL 验证脚本。
2. `server/src/routes/sync.ts` 的 sync/push payload schema 未显式声明 `shared_type`。
3. `server/test/sync.test.ts` 有 1 处 `console.log` 残留。
4. 文娱二级分类 sort_order 跳号建议补注释。

## 回执指令

backend-dev 修复 P1-1、P1-2，顺手处理 P2-2/P2-3；P1-3 不回退 design/，标记为既有工作区变更。

## 自我反思

- 审核耗时：约 90 分钟
- 置信度：高
