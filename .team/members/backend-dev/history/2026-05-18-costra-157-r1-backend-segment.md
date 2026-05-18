# backend-dev · 2026-05-18 · COSTRA-157 · R1 backend segment

- subagent_spawn_ts: 2026-05-18T18:05:00+08:00
- subagent_finish_ts: 2026-05-18T18:08:00+08:00
- task_type: feature

## §1 任务描述

COSTRA-157 dispatch §2.1 A 项 + §2.2 F 项 server 段实装。单卡双装扮档第 1 段（backend-dev）· 第 2 段 miniapp-dev 接手 B/C/D/E 后统一 commit（Q4-A 决策）。

A 项：将 `authService.ts:121` 硬编码 `'微信用户'` 抽取到 `server/src/config/defaults.ts` 常量 `defaultNickname`（与 server/src/config/{env,icp,subject,ttl}.ts 范式一致）。

F 项 server 段：新增 `server/test/defaults.test.ts`（1 测 · 断言 defaultNickname === '微信用户' · 防漂移 · Card-Review P1-2 采纳）。

## §2 产出

- 新增文件：`server/src/config/defaults.ts`（18 行 · 含 JSDoc + 常量导出）
- 修改文件：`server/src/services/authService.ts`（+1 import / -1 hardcoded / +1 常量引用 · 净 +1 行）
- 新增文件：`server/test/defaults.test.ts`（22 行 · 含 JSDoc + 1 测）
- 未 commit（等 miniapp-dev 统一 commit）

## §3 关键决策

- defaults.ts 定位为"编译期常量"（非运行时配置）· 不走 env 覆盖（Q2-A 决策）
- import 路径使用 `.js` 后缀（ESM 风格 · 与 authService.ts 现有 import 一致）
- import 按"字母序"排在 ttl import 之前（`defaults` < `ttl`）
- 仅写 1 条测（值断言）· authService.wxLogin mock 测因 mock 复杂度而省略 · auth.test.ts T1 已隐式覆盖首登 nickname === '微信用户'

## §4 交接（给 miniapp-dev 第 2 段）

- ✅ `server/src/config/defaults.ts` 已建 · `authService.ts` 已改 · **miniapp-dev 不要重复改 server/**
- ⚠️ miniapp-dev 需新建 `miniprogram/config/defaults.ts`（同值 `'微信用户'`）· B/C/D/E 四项改动
- ⚠️ 统一 commit 时 commit message 按 dispatch §6 模板 · footer `Refs: COSTRA-157`
- ⚠️ G7 闸门（grep 双端对账）需 miniapp 端 defaults.ts 建好后才能跑通

## §5 风险 / 已知未知

- 无新增风险 · 已知边界见 dispatch §2.1 E 项 hasProfile 判定逻辑（P1-1 · MVP 接受）
