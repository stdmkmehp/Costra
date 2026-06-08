# History · qa-planner · COSTRA-154+150 联合实测手册产出

> **日期**：2026-05-22
> **卡号**：COSTRA-154 + COSTRA-150
> **简要**：双卡联合 staging 实测手册归口产出（D-025 AP-001 Orchestrator 命中修正版）

---

## 1. 任务背景

COSTRA-154 R1+R1.x.1（commit 7e87bad+8eecd4c · review-tech APPROVE 38/40）+ COSTRA-150 R1+R1.x.1（commit ee97a7a+5ac8153 · review-tech APPROVE 38/40）双卡 R1 闭环 · 等 Human 联合 staging 实测。Orchestrator 之前给过手册但有事实错误（healthz 加了 v1 / DB 名错为 costra_dev / families INSERT 缺 owner_id 列）· 由 qa-planner 归口产出严谨版本。

## 2. 执行摘要

- Read 全部必读文件 A~E 共 25+ 份 · 逐条核验命令/路径/SQL
- 发现任务背景事实错误：env.ts mockLogin 实际为 false（非 true）· 已在手册 §1.5.1 显式纠正
- 产出 707 行手册 · 覆盖 §1~§8 共 8 章 · 5 条断言 + 10 条 FAQ + D-025 三项自检
- 关键事实源标注：每条命令/路径/SQL 均标注了源文件+行号

## 3. 关键发现

1. **env.ts:18 mockLogin = false**（任务背景说 true 是错的）· 小程序走真实 wx.login → POST /auth/wx-login 链路
2. **storage envelope 不可绕过**：`wx.setStorageSync` 直接写裸值会导致 `getItem` 解析 `env.d` 为 undefined · 必须构造 envelope `{v:1, t:Date.now(), d:value}`
3. **syncScheduler [未经验测] bootstrap 500ms**：如果 bootstrapPromise > 500ms → launch 触发时 isLoggedIn()=false → 静默 skip · page-show 兜底
4. **healthz 不带 /v1**：app.ts:69 明确注释 healthz 保留根路径

## 4. 产出清单

| 产出 | 路径 | 行数 |
|---|---|---|
| 联合实测手册 | `qa/costra-154-150-joint-smoke.md` | 707 |
| state.md 更新 | `.team/members/qa-planner/state.md` | — |
| history 本文件 | `.team/members/qa-planner/history/2026-05-22-costra-154-150-joint-smoke-script.md` | — |

## 5. 待办 / follow-up 候选

- Human 执行手册 5 条断言 A~E → `approve:COSTRA-154 + COSTRA-150`
- FU-150-FAMILY-CONTEXT-SERVICE：getActiveFamilyId 永远返 null · 需手动注入 family_id · Sprint-3+ 抽 family.ts service
- env.ts mockLogin 硬编码 false · 如需 toggle 需修改源码 · FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE（P3）
