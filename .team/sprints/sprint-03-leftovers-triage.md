# Costra · Sprint-3 Leftovers Triage

> 触发：`triage:sprint3-leftovers`  
> 时间：2026-06-02 13:44  
> 执行者：Orchestrator  
> 范围：只做 Sprint-3 遗留卡与 follow-up 处置；不写业务代码、不启动开发。  
> 前置事实：Human 已确认 `qa/costra-154-150-joint-smoke.md`、`qa/phase-3-prod-realdevice-test.md`、`qa/current-stage-acceptance-family-first-baseline.md` 三份手册全部 PASS。  
> 流程约束：后续任何业务开发仍必须 dispatch → card-review → Human 触发 → spawn 对应 Agent → review → Human 终审。

---

## 0. Triage 结论摘要

Sprint-3 不再继续堆功能，定位为：**验收后收口 + Sprint-4 准备**。

本轮 triage 结论：

| 项 | 决策 | 下一步 |
|---|---|---|
| `COSTRA-151` conflict 合并 UI | **Defer** 到 Family First 闭环后 | Sprint 5+ / conflict 真实出现后重审 dispatch |
| `COSTRA-155` 全量自动化 + CI | **Split / Re-dispatch** | Sprint 4 guardrail，先拆“基线回归网”和“Family E2E” |
| `COSTRA-159` outbox fake timers | **Optional** Sprint 4 稳定性小卡 | 若近期 outbox flaky 复现或 CI 化前启动 |
| `COSTRA-161` whitelist-check 规则 E | **Promote** Sprint 4 guardrail | 建议在 `COSTRA-221` 前或同批审卡，避免 `/families/*` 契约漂移 |
| `COSTRA-162` dev mockLogin runtime toggle | **Defer P3** | 不抢 Family First，后续 dev-experience 批处理 |
| `COSTRA-163` ICP 强等值校验 | **Move** Sprint 4 guardrail | 与 `COSTRA-161` devops 小批处理 |
| `COSTRA-114` dev server bootstrap | **Close superseded** | 已被 prod compose / deploy-all / 09 gates 取代 |
| `FU-220-SYNC-USER-ID-CREATED-BY` | **Promote P1 guardrail** | Sprint 4 sync 协议适配 / `applyServerChanges` 字段映射修复 |

---

## 1. 当前可关闭/已闭合事实

以下不再作为 Sprint-3 遗留阻塞：

| 项 | 状态 | 证据 |
|---|---|---|
| `COSTRA-154` / `FU-104-SYNC-PULL` | closed | Human 联合实测 PASS；Phase-3 prod 真机 PASS |
| `COSTRA-150` / `FU-103-CLIENT-SYNC-SCHEDULER` | closed | Human 联合实测 PASS；Phase-3 prod 真机 PASS |
| `COSTRA-164/165` / `FU-150-FAMILY-CONTEXT-SERVICE` | closed | `qa/current-stage-acceptance-family-first-baseline.md` 已确认 PASS |
| `COSTRA-217` | closed | `.team/reviews/COSTRA-217/FINAL.md` · T3 `AUTO-CLOSED` |
| `COSTRA-218` | closed | `.team/reviews/COSTRA-218/round-1-tech.md` · T3 `AUTO-CLOSED` |
| `COSTRA-219` | closed | `.team/reviews/COSTRA-219/round-1-tech.md` · T3 `AUTO-CLOSED` |
| `COSTRA-220` | closed with follow-up | `.team/reviews/COSTRA-220/round-1-tech.md` · T3 `AUTO-CLOSED-WITH-FOLLOWUP` |

---

## 2. 卡片逐项处置

### 2.1 `COSTRA-151` · conflict 合并 UI

- **原状态**：Sprint-3 中后段候选，依赖 `154+150+152+153` 全 CLOSED。
- **当前判断**：不建议 Sprint-3 / Sprint-4 立即启动。
- **原因**：
  1. Family First 当前主线是 `COSTRA-221/222/223`，conflict UI 依赖多人协作真实场景；
  2. 先做 conflict UI 会与家庭成员、账本切换、成员权限 UI 口径重叠，返工概率高；
  3. 当前 MVP 单人记账 + sync 已验收，conflict 可继续作为 P2 后置。
- **决策**：`Deferred` → Sprint 5+ / Family UI 闭环后重审。
- **保留派单**：`.team/dispatch/COSTRA-151-conflict-merge-ui.md` 保留，但启动前必须重审设计与家庭 API 依赖。
- **关联 FU**：`FU-103-CONFLICT-MERGE-UI` → `deferred-family-after-223`。

### 2.2 `COSTRA-155` · 全量自动化 + CI

- **原状态**：15 条用例自动化 + CI；依赖 `154/150/152/153`。
- **当前判断**：原 dispatch 过大，且 miniprogram-automator 在 CI 上依赖微信开发者工具端口，不能直接按原案一次性启动。
- **决策**：`Planned-Split` / `Needs-Redispatch`。
- **拆分建议**：
  1. `COSTRA-155A`（候选，不立即立卡）：当前 Family First baseline 逻辑回归网，CI 只跑非 UI 部分；
  2. `COSTRA-155B`（候选，不立即立卡）：Family E2E 手动/半自动化，等 `221/222/223` 后补；
  3. `COSTRA-155C`（候选，不立即立卡）：是否引入带微信 IDE 的自托管 runner，放到 Sprint-6/发布前决策。
- **本轮处置**：不启动原 `COSTRA-155`；Sprint-4 guardrail 阶段先 `revise-dispatch:COSTRA-155`。
- **关联 FU**：`FU-105-AUTOMATION-FULL-COVERAGE` → `scoped-sprint-4-guardrail`。

### 2.3 `COSTRA-159` · outbox fake timers 重构

- **原状态**：1 点稳定性小卡。
- **当前判断**：低成本，但不阻塞 Family First；当前完整测试已多次 99/99 通过，flaky 未成为当前主阻塞。
- **决策**：`Planned-Optional` → Sprint-4 稳定性批。
- **启动条件**：
  - outbox 相关测试再次出现 flaky；或
  - `COSTRA-155` / CI guardrail 开始前需要先降噪。
- **关联 FU**：`FU-156-OUTBOX-FLAKY` → `scoped-sprint-4-optional`。

### 2.4 `COSTRA-161` · whitelist-check 规则 E

- **原状态**：OpenAPI paths vs fastify register 静态对账。
- **当前判断**：应提升为 Sprint-4 guardrail。
- **原因**：
  1. `COSTRA-221` 即将实装 `/families/*`；
  2. 项目已有 AP-003 契约-实装漂移历史；
  3. `COSTRA-220` 新增 P1 `FU-220-SYNC-USER-ID-CREATED-BY` 也属于契约/字段映射治理问题。
- **决策**：`Planned-Guardrail` / Sprint-4 P1。
- **注意**：启动前需重审 dispatch：当前 OpenAPI 中若存在合法 `x-deferred` 路径，规则 E 应允许显式 deferred，不可误伤未启动的 `221/222`。
- **关联 FU**：`FU-DEVOPS-OPENAPI-IMPL-COVERAGE`、`FU-154-X-DEFERRED-CI-CHECK` → `scoped-sprint-4-guardrail`。

### 2.5 `COSTRA-162` · dev mockLogin runtime toggle

- **原状态**：1 点 dev convenience 小卡。
- **当前判断**：Phase-3 prod 真机链路已通过，当前不再是主阻塞。
- **决策**：`Deferred-P3`。
- **后续时机**：dev-experience 批处理或频繁切 mock/prod 时再启动。
- **关联 FU**：`FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE` → `deferred-p3`。

### 2.6 `COSTRA-163` · ICP 强等值校验

- **原状态**：1 点 devops guardrail。
- **当前判断**：适合 Sprint-4 guardrail，与 `COSTRA-161` 同文件/同范式批处理。
- **决策**：`Planned-Guardrail` / Sprint-4 P2。
- **启动方式**：建议与 `COSTRA-161` 组合审卡，但仍保持单卡边界与单卡提交。
- **关联 FU**：`FU-DEVOPS-ICP-CROSS-SSOT-CHECK` → `scoped-sprint-4-guardrail`。

### 2.7 `COSTRA-114` · dev server bootstrap 手册

- **原状态**：Sprint-1/2 遗留 Backlog。
- **当前判断**：应关闭为 superseded。
- **原因**：
  1. 项目已经完成 prod compose 路线：`infra/prod-bootstrap-compose.md`、`infra/scripts/deploy-all.sh`、`infra/scripts/09-verify-gates.sh`；
  2. 生产服务器 `49.235.216.20` 已跑通 docker compose + HTTPS + 5/5 gate；
  3. 旧卡目标是 dev server bootstrap 手册，已被更完整的 prod bootstrap 体系取代。
- **决策**：`Closed-Superseded`。
- **不删除派单**：`.team/dispatch/COSTRA-114-devops-dev-server-bootstrap.md` 作为历史能力边界证据保留。

### 2.8 `FU-220-SYNC-USER-ID-CREATED-BY`

- **来源**：`.team/reviews/COSTRA-220/round-1-tech.md` P1。
- **问题**：sync wire `user_id` 与本地 Entry `created_by` 不对齐，`applyServerChanges` 未做字段映射，导致 sync pull 条目的“仅看自己”筛选失效。
- **决策**：`Planned-Guardrail` / Sprint-4 P1。
- **建议归属**：backend-dev + miniapp-dev，小修但需协议口径拍板。
- **候选修复方案**：
  1. 服务端 sync pull wire 输出 `created_by`，与 OpenAPI Entry schema 对齐；
  2. 客户端 `applyServerChanges` 兼容映射 `created_by = raw.created_by ?? raw.user_id ?? null`；
  3. 增补 sync pull 后成员筛选回归用例。
- **启动建议**：在 `COSTRA-221` 前或同一 Sprint-4 guardrail 批处理；不应混入 `COSTRA-221` 业务 API 实装。

---

## 3. Sprint-3 出口条件

Sprint-3 现在只剩两个编排动作：

1. `plan-dispatch:COSTRA-221`
2. `card-review:COSTRA-221`

完成后即可进入 Sprint-4 开发入场。Sprint-3 不再启动以下内容：

- 不启动 `COSTRA-151`；
- 不直接启动原版 `COSTRA-155`；
- 不启动 `COSTRA-223`；
- 不写家庭页 UI；
- 不直接修改 `/families/*` 后端代码；
- 不抢做统计页 / 预算 / 订阅消息。

---

## 4. Sprint-4 推荐入场顺序

| 顺序 | 动作 | 说明 |
|---:|---|---|
| 1 | `plan-dispatch:COSTRA-221` | 家庭管理 API 正式派单 |
| 2 | `card-review:COSTRA-221` | 审清权限、成员、邀请、OpenAPI 漂移、测试矩阵 |
| 3 | `revise-dispatch:COSTRA-161` | 明确 x-deferred / `/families/*` 对账策略 |
| 4 | `plan-dispatch:FU-220-SYNC-USER-ID-CREATED-BY` 或并入 sync guardrail 批 | 修复 `user_id` / `created_by` 字段映射 |
| 5 | `start:COSTRA-221` | 仅在 card-review PASS 且 Human 明确触发后启动 backend-dev |
| 6 | `start:COSTRA-222` | 221 口径稳定后启动家庭财务聚合 API |

---

## 5. 状态写回清单

本次 triage 应写回：

- `.team/backlog.json`
- `.team/board.md`
- `.team/STATE`
- `.team/HANDOFF.md`
- `.team/follow-ups/README.md`
- 本文件：`.team/sprints/sprint-03-leftovers-triage.md`

不提交 commit，等 Human 后续确认是否把状态批次统一提交。
