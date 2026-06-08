# Card Review · Tech · COSTRA-227 · Round 1

- **卡 Owner**：miniapp-dev
- **审核时间**：2026-06-03T16:41+08:00
- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：25/30

## P1 已修 (inline)

| ID | 问题 | 修订方式 |
|---|---|---|
| P1-1 | overlay 当前无 properties 块 · dispatch 的 props 注入方案物理不可用 | 改用 `selectComponent.openEditMode(entry)` 方法调用 |
| P1-2 | `_show()` 全量重置覆盖预填状态 | 编辑模式绕过 `SHOW_EXPENSE_OVERLAY` 事件 |
| P1-3 | ledger/index.ts 无 overlayVisible/editEntry/editMode data 字段 | 改用 selectComponent 调用，无需页面 data 字段 |

## P2 已修 (inline)

| ID | 问题 | 修订方式 |
|---|---|---|
| P2-1 | EventNames 扩展 as const 对象不允许外部赋值 | 明确修改源文件 |
| P2-2 | 无变更判等逻辑未定义 | §5.2 补充字段比较规则 |
| P2-3 | 测试覆盖偏窄 | DoD 增加 update op enqueue 测试 |
| P2-4 | 日期时区边界 | §5.2 明确本地时区解析 |
