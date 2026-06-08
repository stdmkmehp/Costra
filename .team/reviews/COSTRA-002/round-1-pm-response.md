# COSTRA-002 · Round-1 → Round-2 · PM-Agent Response

- **Card**: COSTRA-002 · PRD
- **Reviewer**: Review-Agent-Product（Round-1 · REVISE · 50/60 = 25/30）
- **Revising Agent**: PM-Agent
- **Round**: 2
- **Date**: 2026-04-23
- **Target file**: `docs/PRD.md` → v0.2

## 0 · 逐条回应

| # | 级别 | Reviewer 指出 | 回应 | 位置 |
|---|---|---|---|---|
| P1-1 | P1 | API 路径与 OpenAPI 漂移（缺 `/v1`，`/auth/wechat/login` vs OpenAPI `/auth/wx-login`） | **接受并修复**。§4 开头加"路径 SoT 规则"段落；COSTRA-101 关键流程 1 改为 `POST /v1/auth/wx-login`；其他 Story AC 原本不显式写路径（Reviewer 误读 `/sync/pull` 出处，实际在 OpenAPI 而非 PRD）—— 故全局仅改 1 处 | PRD §4 前言 / COSTRA-101 |
| P1-2 | P1 | Epic-F Story（401/402）AC 过浅 | **接受并修复**。COSTRA-401 增 AC-3/4/5（空态/跨期/Top N 8 个截断）；COSTRA-402 增 AC-3/4/5（空态 10 条阈值/自然年切分/时区显示） | PRD §4 Epic-F |
| P1-3 | P1 | COSTRA-203/301/302 AC 缺 7 天时效 | **接受并修复**。COSTRA-203 增 AC-5（7 天窗口）+ AC-6（失败降级到小程序红点）；COSTRA-301 增 AC-3（过期 audit）+ AC-4（双保险幂等）；COSTRA-302 增 AC-3（降级同 203）+ AC-4（重新授权引导） | PRD §4 Epic-D/E |
| P2-1 | P2 | Won't-Have 未回灌 D-008 | **接受并修复**。§2.1 追加 | PRD §2.1 |
| P2-2 | P2 | Persona C 点名少 | **部分接受**。COSTRA-203 加 Persona 归属标注；其他 Story 归 Sprint-1 每 Story 模板化再补 | PRD §4 Epic-D |
| P2-3 | P2 | 估点规则缺声明 | **接受并修复**。文首元数据补"估点规则：斐波那契 1/2/3/5/8/13；2 人天 ≈ 3 SP" | PRD 文首 |

**结论**：3/3 P1 + 3/3 P2 闭合。无 P0、无 ESCALATE。

## 1 · 版本升级

PRD.md → **v0.2**（文首补变更摘要与新依据项 `api/openapi.yaml` v0.1）。

## 2 · 关键权衡

- **P1-1** Reviewer 说 "PRD 里 COSTRA-121 AC 写 `/sync/pull`" —— 实测 PRD 现有 AC 并不显式写路径（见 `grep` 结果），Reviewer 可能在脑内把 OpenAPI 的内容串给 PRD 了。但 **PRD 与 OpenAPI 的 SoT 分工必须写清**，否则 Sprint-1 开发仍会反复问。所以本轮以"显式声明路径 SoT 规则 + 修正已出现的 1 处 `/auth/wechat/login`"为手段闭合。

- **P1-3** 订阅消息"7 天时效"的实施绑定 `SubscribeMessageJob` schema（COSTRA-020 Round-2 新增）与 `subscribe_tokens.status` 四态（COSTRA-021 Round-2 新增）。三卡 Round-2 在同一天联动完成。

## 3 · 请求 Re-Review

请 Review-Agent-Product 按 60 分制重新打分；重点复核：
1. §4 "路径 SoT 规则"段的表述是否把 PRD 与 OpenAPI 的分工讲清楚
2. Epic-F 5 个边界 AC 是否足够 Sprint-5 锁工作量
3. Epic-D/E 的 7 天时效 AC 与 OpenAPI `SubscribeMessageJob` 是否 1:1

—— PM-Agent · 2026-04-23
