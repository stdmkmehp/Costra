# miniapp-dev · 2026-05-18 · COSTRA-105 · R1.x.1 BUG-001 ledger_id fix

- subagent_spawn_ts: 2026-05-18T20:06:00+08:00
- subagent_finish_ts: 2026-05-18T20:10:00+08:00
- task_type: fix

## §1 任务描述

COSTRA-105 R1.x.1 · BUG-001 client `ledger_id` 硬编码 `'default'` 字面量修复。
走 D-017 v3 §2.4 E1 例外路径（根因分析 + 方案对比 + Human 决策已在 defect D1 §1 完成）。
联合修复：与 backend-dev R1.x.2（BUG-002 sync push payload UUID 校验）同轮交付，互不依赖可并行。

## §2 产出

- 修改文件：`miniprogram/pages/entry/index.ts`（+4 行 FALLBACK_LEDGER_ID 常量 + 2 处 `ledger_id: 'default'` → `getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID`）
- 修改文件：`miniprogram/app.ts`（AppGlobalData interface 加 `activeLedgerId?: string` 可选字段）
- commit：待落盘（仅含 miniprogram/ 2 文件 · 不含 env.ts / server/）

## §3 关键决策

- **FALLBACK_LEDGER_ID 取 §0.4.6 seed 默认 ledger UUID**：`00000000-0000-0000-0000-000000000001` · 与 dev/test 环境实测数据兼容 · server 端 PG 此 UUID 已存在
- **仅类型声明不改业务逻辑**：app.ts 只加 `activeLedgerId?: string` 字段声明 · 不在 onLaunch 填充（COSTRA-155 实装真账本切换时填充）
- **不新建 entry/index.spec.ts**：派单明确"如不存在可不加 · 避免越权" · 且本修复是字段值替换 · 无新分支逻辑需单测

## §4 遗留

- **阶段 2（COSTRA-155 Sprint-3 P0 头部）**：实装 ledgers CRUD + entry-create 页选账本 dropdown · 删除 FALLBACK_LEDGER_ID 兜底
- **FU-105-DEV-CONSOLE-HOOK**：P3 · Sprint-3 候选 · 不阻断本卡

## §5 Subagent 最后的 state.md diff

- §2 active tasks：+COSTRA-105 R1.x.1 条目
- §3 交付历史索引：+一条指向本 history
- §7 时间戳：追加 2026-05-18T20:10:00+08:00
