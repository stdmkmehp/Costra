# qa-planner · history · 2026-06-01-family-first-baseline-v1.1-correction

> 卡号：Family First Baseline Acceptance v1.1 修正（文档修正 · 非 COSTRA 单卡）
> 时间：2026-06-01
> 角色：qa-planner

---

## 1. 任务摘要

对 `qa/current-stage-acceptance-family-first-baseline.md` v1.0 进行 6 项精准修正，消除时间线矛盾、版本号错误、路径错误、环境现状失真、review 状态过时、措辞不实等问题。

## 2. 输入源

- `qa/current-stage-acceptance-family-first-baseline.md` v1.0（待修正文档）
- `server/package.json`（Node engines.node = ≥20.0.0）
- `miniprogram/services/env.ts`（CURRENT_ENV = 'prod'）
- `project.config.json`（根目录 · miniprogramRoot = miniprogram/）
- `.team/reviews/COSTRA-217/round-4-tech.md`（PASS 33/35 · 无 P0/P1）
- `.team/members/miniapp-dev/state.md`（COSTRA-219 95/95 · COSTRA-220 99/99）
- Human 修正指令（6 项）

## 3. 产出

- **`qa/current-stage-acceptance-family-first-baseline.md`** v1.1
  - 修正 1：生成时间 2026-06-18 → 2026-06-01（基于项目状态记录截至 COSTRA-220）
  - 修正 2：Node 版本 ≥18.x → ≥20.0.0（对齐 server/package.json engines.node）
  - 修正 3：微信开发者工具导入路径 → 项目根目录 `/Users/weizhao/Desktop/Costra`（project.config.json 在根目录）
  - 修正 4：env.ts CURRENT_ENV 如实提示当前值为 `'prod'`，本地 dev 需手工改
  - 修正 5：COSTRA-217 Review → R4 PASS 33/35；COSTRA-219 测 95/95；COSTRA-220 测 99/99
  - 修正 6：所有"实测"/"期望"措辞 → "历史记录期望"/"最近交付记录"

## 4. 发现的风险/待验收点

- 无新增风险 · 修正仅消除已有文档失真
- env.ts CURRENT_ENV='prod' 是事实 · 本地测试需手工切换（不改代码）

## 5. 闸门验证

- 文档 v1.1 全量审读 · 6 项修正均已落位 · 无遗漏
