# SOP · Review 闭环（统一版 · 强制）

> 登记时间：2026-04-24 19:16
> 登记人：Human（方案 A 批准 · 2026-04-24 19:16）+ Orchestrator 成文
> 适用范围：Orchestrator、Review-Agent-Tech、Review-Agent-Product、所有被审 Agent（Backend / MiniApp / PM / Design）
> 优先级：**P0 · 铁律** · 与 `SOP-OBSERVE-AND-INTERVENE`、`SOP-HUMAN-TRIGGER`、`SOP-CARD-REVIEW` 并列，不冲突
> **文件历史**：本文件合并原 `SOP-REVIEW-LOOP.md` v1.4 + `SOP-REVIEW-AUTOLOOP.md` v1.2 而来（方案 A · 2026-04-24）。原两份已降级为 stub，保留外链兼容。

---

## 0. 导读

本 SOP 覆盖 Review **产出闭环**的全部执行细节，自顶向下分为两层：

| 层 | 章节 | 回答的问题 |
|---|---|---|
| **基础闭环** | §1~§9 | "Review 整体怎么跑、何时停、谁产出什么" |
| **自动推进细则** | §10 | "Revise↔Review 自动循环的前置/动作/兑现约束（D-011 + D-015 + D-016）" |
| **附录** | §11~§13 | 度量、关系矩阵、版本史 |

> **卡定义 Review**（D-014-a）不在本 SOP 内，见 `SOP-CARD-REVIEW.md`。本 SOP 只管**产出 Review**（被审 Agent 交付后的闭环）。

---

## 1. 背景与核心约束

Human 一个人盯所有 Agent 产出太吃力。引入两位 Review-Agent 做**机器预审**：
- **Review-Agent-Tech**：审 Backend / MiniApp（见 `.team/agents/07-review-agent-tech.md`）
- **Review-Agent-Product**：审 PM / Design（见 `.team/agents/08-review-agent-product.md`）

**核心约束**：
1. Review 与 Revise 的迭代**最多 5 轮**，超出必停
2. 迭代过程中若出现**不可调和分歧**，立即停下交给 Human 决定
3. Review-Agent 的结论**不替代** Human 终审，只是过滤器（通过了还得 Human 点头，没通过大概率 Human 也会打回）——**例外见约束 6（D-013）**
4. Review-Agent **不写代码/文档**，只给意见
5. **默认启用自动循环**（D-011 · 2026-04-23 生效 · 详见 §10）：Review 闭环内的 `Revise↔Review` 相互拉起无需 Human 逐轮触发，但前置条件 6 条 + 同轮兑现铁律 + 打断指令见 §10
6. **Review 场景分级**（D-013 · 2026-04-23 21:15 生效）：Review 按**准入 T1 / Gate 前 T2 / 追溯 T3 / 回归 T4** 分档。**T1/T2 仍需 Human 终审**（约束 3 原文适用）；**T3/T4 在 AI-Review PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞 四条件同时满足时自动关闭**，不走 Human 终审，Human 保留 `reopen-review` 复议权。详见 `.team/decisions/D-013-review-scenario-tiering.md`
7. **卡定义 Review + 产出 Review 环首自动拉起**（D-014 · 2026-04-23 22:26 生效）：
   - (a) 所有 D-014 立案后新建的卡**必须**经过一次卡定义 Review（技术向 → Review-Tech / 产品向 → Review-Product），详见 `SOP-CARD-REVIEW.md`
   - (b) **被审 Agent 交付后的产出 Review 首轮自动拉起**，无需 Human 触发（但 Agent 首次开干仍需 Human 触发，铁律不变）
   - (c) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级
   - 详见 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`
8. **respond/revise 触发词合并**（D-015 · 2026-04-24 09:24 生效）：`respond-round-N` 已**废弃**，`revise-round-N` 统一承担"回执+修复+可表达异议"三合一语义。Agent 允许对 Review 意见反驳，但必须当轮同时落盘采纳项的代码修复；异议由 Review-Agent 在下一轮二次裁决，驳回后 Agent 必须修复，不得二次反驳（否则 ESCALATE）。详见 `.team/decisions/D-015-unify-respond-revise.md`
9. **同轮兑现铁律**（D-016 · 2026-04-24 19:10 生效）：Orchestrator 在声明"自动拉起 Review"后必须在**同一 tool call 循环内**连续切 Review-Agent 角色产出 Review 报告，严禁跨轮异步承诺。详见 §10.5 与 `.team/decisions/D-016-same-turn-review-autoloop.md`

---

## 2. 角色分工矩阵

| 被审 Agent | Review 归属 | 审核范围 |
|---|---|---|
| Backend-Agent | **Review-Tech** | `server/`、`api/`、`docs/api/`、`docs/db/` |
| MiniApp-Agent | **Review-Tech** | `miniprogram/`、`miniapp/` |
| PM-Agent | **Review-Product** | `docs/`（除 `api/db/` 外）、`.team/backlog.json`、`.team/risks.md`、订阅文案、隐私清单、Sprint 计划、Retro |
| Design-Agent | **Review-Product** | `design/`、`docs/design/` |
| DevOps-Agent | **不走 Review-Agent** | Human 直审（涉及生产/密钥/域名，风险太高） |
| QA-Agent | **不走 Review-Agent** | Human 直审（测试策略本身就是质量标准，不能由另一个 AI 批） |

**例外规则**：
- 跨域产出（例如 PM 写了技术味很重的 `id-strategy.md`，或 Backend 写了产品味很重的发布公告）→ Orchestrator 按**主产出属性**决定归属，**不允许同时派两个 Review-Agent**
- 决策类文档（`.team/decisions/D-xxx.md`、ADR）→ **不走 Review-Agent**，直接 Human 决策

---

## 3. 基础流程（7 步）

> **环首自动拉起**（D-014 · 2026-04-23 22:26）：Step 2 "Orchestrator 识别归属 → 拉起对应 Review-Agent" 不再需要 Human 触发，被审 Agent 交付后 Orchestrator 自动拉起首轮 Review。Human 打断指令（`pause-review` / `skip-review` / `stop`）最高优先级。
>
> **同轮兑现**（D-016 · 2026-04-24 19:10）：Step 2 的"自动拉起"必须与 Step 1 在**同一 tool call 循环内**完成（见 §10.5）。

```
[Step 1] 被审 Agent 产出
   ↓
[Step 2] Orchestrator 识别归属 → 拉起对应 Review-Agent（D-014 自动，同轮兑现）
   ↓
[Step 3] Review-Agent 按规约审 → 产出 round-N-{tech|product}.md
   ↓
[Step 4] Orchestrator 解析 verdict
   ├─ PASS / PASS-WITH-FOLLOWUP → 进入 Human-Review 终审（T1/T2）或自动关闭（T3/T4 · D-013）
   ├─ REVISE → 走 §10 自动循环前置判断，满足 → 拉被审 Agent 做第 N+1 轮修复（同轮兑现）
   ├─ REJECT → 直接打回被审 Agent 重做（round 重置为 1，需要 Orchestrator 记录 incident）
   └─ ESCALATE → 停，冒泡给 Human
   ↓
[Step 5] 被审 Agent 修复 → 产出 `round-N-{agent}-response.md`（即 revise-round-N.md · 说明改了啥）
   ↓
[Step 6] 回 Step 2，round + 1（同轮兑现约束继续生效）
   ↓
[Step 7] 达到"停止条件"（见 §4）
```

---

## 4. 停止条件（硬性约束）

**满足以下任一 → 立即停**：

### 4.1 正常通过
- Review-Agent 给 `PASS` 或 `PASS-WITH-FOLLOWUP`
- Orchestrator **按 D-013 场景分级分流**：
  - **T1 准入 / T2 Gate 前 Review** → 推入 Human-Review 列，等 Human 终审（`approve:*` / `reject:*`）
  - **T3 追溯 / T4 回归 Review** → 检查 D-013 §3 四条件（AI-PASS + 0 残余 P0/P1 + 0 红线 + 0 新阻塞），全数命中则**自动关闭 SKIP-REVIEW-AUTOCLOSED**，写 `FINAL.md` + 聚合汇报 Human；任一不满足则回退到 T1 路径
- 场景识别规则详见 `.team/decisions/D-013-review-scenario-tiering.md §4`

### 4.2 轮次上限
- **round == 5** 时仍未 PASS → 无论当前 verdict 是啥（除非是 PASS-WITH-FOLLOWUP），**强制停**
- Orchestrator 发 `approval_request` 给 Human，附：
  - 5 轮完整 review 报告链接
  - 5 轮修复说明
  - 当前残余 P0 清单
  - 一句话建议（"建议 Human 接管决策" / "建议拆卡"）

### 4.3 分歧升级
- Review-Agent 出 `ESCALATE` verdict → **停**
- 被审 Agent 对同一 P0 在两轮内都明确拒绝修复并给出反驳 → **停**（自动触发 ESCALATE · 详见 §6.1 / §10.3 D-015）
- Human 任何时刻手动输入 `pause-review COSTRA-XXX` → **停**

### 4.4 红线触发
- Review-Agent 判定 `REJECT` 且涉及红线（硬编码 secret / 目录越权 / Won't-Have / 主体字样）→ **直接停并冒泡**，不走第 2 轮
- 被审 Agent 两轮内重复触发同一条红线 → 记 `.team/incidents/` + 冒泡

---

## 5. Round-N 产物目录结构

每张卡在 Review 过程中的全部产物集中在一个目录：

```
.team/reviews/COSTRA-101/
├── round-1-tech.md                  # 第 1 轮 Review-Tech 报告
├── round-1-backend-response.md      # 第 1 轮 Backend 修复说明（= revise-round-1.md）
├── round-2-tech.md                  # 第 2 轮 Review-Tech 报告
├── round-2-backend-response.md      # 第 2 轮 Backend 修复说明
├── ...
└── FINAL.md                         # 最终结论（由 Orchestrator 在停止时写）
```

**`FINAL.md` 内容**：
```markdown
# COSTRA-101 Review 闭环 · 最终结论

- 终止时间：...
- 终止原因：PASS | PASS-WITH-FOLLOWUP | ESCALATE-TO-HUMAN | ROUND-LIMIT | RED-LINE
- 总轮次：N
- 最后一轮 verdict：...
- 残余 P0 / P1：{清单 + 去向}
- Human 决策（Human 填）：approve | reject | 拆卡 | ...
```

---

## 6. 被审 Agent 的回应格式（D-015 · v1.4）

> **重要变更（D-015 · 2026-04-24 09:24）**：`respond-round-N` 触发词已废弃，`revise-round-N` 统一承担"回执 + 修复 + 可表达异议"三合一语义。Agent 允许对 Review 意见反驳，但必须**当轮同时落盘采纳项的代码修复**；若异议被 Review-Agent 下一轮驳回，再下一轮必须修复（不得二次反驳，否则 ESCALATE）。详见 `.team/decisions/D-015-unify-respond-revise.md`。

每轮 revise 完成后，被审 Agent 必须产出 `.team/reviews/COSTRA-XXX/round-N-{agent}-response.md`（或等价命名 `revise-round-N.md`）：

```markdown
# {Agent} Revision Response · COSTRA-XXX · Round N

## 对 Round-N Review 的回应

### P0-1 {Review 标题}
- **采纳 / 反驳 / 部分采纳**：✅ 采纳 | ❌ 反驳 | ⏸ 部分采纳
- **修改位置**：`apps/api/src/xxx.ts:45-52`（diff 见 commit `abc123`）
- **修改说明**：<简述改动>
- （若反驳）**反驳依据**：引用文档/ADR/证据，不接受"我觉得"
- （若反驳）**请求 Review-Agent 在 Round N+1 裁决**
- （若部分采纳）**本轮已改**：...；**延后到 Round N+M**：...

### P0-2 ...

## 本轮新增产出
- 文件 A / 文件 B ...

## 本轮自测
- 单测 / 集成测试 / 手工冒烟 结果

## 本轮 commit
- `<hash>` — <描述>（D-012 合规）

## 求再审
请 Review-{Tech|Product} 进入 Round N+1。
（若本轮有异议条目）请特别裁决以下异议：P0-X / P1-Y
```

### 6.1 异议仲裁链路（D-015 §2.2）

```
Round N Agent 反驳 ─▶ Round N+1 Review-Agent 裁决
                       │
                       ├─ withdrawn（撤回）→ 该 issue 关闭
                       └─ overruled（驳回）→ Agent 在 Round N+1 本轮 response 中 MUST 修复
                                              │
                                              ▼
                                       若 Agent 仍反驳同一 P0 → ESCALATE（§4.3）
```

### 6.2 Review-Agent Round N+1 报告追加段（D-015 §5）

```markdown
## 对 Round N 异议的裁决

### 对 P0-X 异议（Agent 反驳依据：...）
- **裁决**：✅ 撤回 `withdrawn` | ❌ 驳回 `overruled`
- **理由**：<理由>
- （若驳回）**Agent 在 Round N+1 本轮 response 中 MUST 修复此项**
```

缺失此段 → Orchestrator 视为 Review-Agent 规约违规，记 `.team/incidents/`。

---

## 7. Orchestrator 的调度规则

### 7.1 何时拉 Review-Agent（MUST）

| 触发条件 | 动作 | 自动/手动 |
|---|---|---|
| 被审 Agent 发 `status_report` 且 `task_id` 进入 Review 列 | 识别归属 → 拉对应 Review-Agent | **D-014 自动 · D-016 同轮兑现** |
| 被审 Agent 发 `revision_completed` 消息（round >= 2） | 拉同一个 Review-Agent 做 Round N+1 | **D-011 自动 · D-016 同轮兑现**（§10） |
| 新卡落盘到 `backlog.json` 或 `board.md` Todo | 按 Owner 分流 → 拉 Review-Agent 做**卡定义 Review** | **D-014 自动 · D-016 同轮兑现** · 详见 `SOP-CARD-REVIEW.md` |
| Human 发 `review-card COSTRA-xxx` | 对某卡强制做一次卡定义 Review | 手动（历史卡补审） |

### 7.2 何时 **不**拉（MUST NOT）

- 卡属于 DevOps / QA → 直接 Human 终审（卡定义 Review 也豁免 · 除非卡主标注 `no-card-review: false`）
- 卡属于决策类（D-xxx / ADR-*）→ 直接 Human 决策
- Human 显式说过 `skip-review COSTRA-XXX` / `skip-card-review COSTRA-XXX`（记 daily 里）
- 历史卡（D-014 立案 2026-04-23 22:26 前创建）→ 卡定义 Review 豁免；需要时走 `review-card COSTRA-XXX` 手动触发

### 7.3 拉起时的 Context 注入模板

```
## Review Task
- card: COSTRA-101
- target_agent: backend
- round: 2/5
- files_changed:
  - server/src/auth/login.ts  (+52 -8)
  - api/openapi.yaml  (+12 -0)
- last_commit: abc123
- last_review: .team/reviews/COSTRA-101/round-1-tech.md
- last_revision_note: .team/reviews/COSTRA-101/round-1-backend-response.md
- 强制阅读清单: [charter.md, api/openapi.yaml, docs/api/*, engineering-guidelines.md]
```

### 7.4 Orchestrator 的**禁止事项**

- ❌ 禁止自己扮演 Review-Agent（角色隔离，否则退化为自审）
- ❌ 禁止跳过 Review-Agent 直接推到 Human（除非 §6.2 例外）
- ❌ 禁止在拉 Review 之前自己先写 review 意见（会污染独立性）
- ❌ 禁止在 round=5 还没停（硬性卡死）
- ❌ 禁止合并两个 Review-Agent 的报告（保持独立）
- ❌ **禁止跨轮异步承诺**（"下一轮自动拉起 / 60 秒后台拉起"等表述 · D-016 铁律 · 见 §10.5）

---

## 8. Human 介入窗口

Review 闭环不改变 SOP-HUMAN-TRIGGER 的铁律。Human 侧只关心 3 个时机：

| 时机 | Human 要做什么 |
|---|---|
| Review-Agent 给 PASS/PASS-WITH-FOLLOWUP（T1/T2） | 走原有 `approve:COSTRA-XXX` 或 `reject:...` 流程 |
| Review-Agent 给 PASS/PASS-WITH-FOLLOWUP（T3/T4 且四条件满足） | 自动关闭 · Human 只需事后聚合汇报查验；异常走 `reopen-review` |
| ESCALATE / ROUND-LIMIT / RED-LINE | 冒泡到 Human，看 `FINAL.md` 做决策 |
| Human 主动暂停 | 发 `pause-review COSTRA-XXX`，Orchestrator 停调度 |

**Orchestrator 必须在进度汇报中醒目标注**正在 Review 闭环中的卡（避免 Human 误以为"卡死了"）：

```
## 🔍 Review 迭代中（共 N 张）

| 卡号 | 被审 Agent | Review-Agent | 当前轮次 | 最近 verdict | 下一动作 |
|---|---|---|---|---|---|
| COSTRA-101 | Backend | review-tech | 2/5 | REVISE（2 P0） | 等 Backend 修复（需你说 `run backend COSTRA-101 revise-round-2`） |
```

若当前处于 §10 自动循环中，必须改用 §10.6 的"⏳ Review 自动循环中"汇报段。

---

## 9. 触发指令（合入 SOP-HUMAN-TRIGGER §3）

| 用户说 | Orchestrator 行为 |
|---|---|
| `run review-tech COSTRA-xxx` | 强制拉 Review-Tech 对该卡跑一轮 |
| `run review-product COSTRA-xxx` | 强制拉 Review-Product 对该卡跑一轮 |
| `run {agent} COSTRA-xxx revise-round-N` | **D-015 统一触发词** · 拉被审 Agent 做回执+修复（可含异议，异议按 §6.1 仲裁） |
| ~~`run {agent} COSTRA-xxx respond-round-N`~~ | ❌ **D-015 已废弃** · 收到时自动映射为 `revise-round-N` 并提示 Human |
| ~~`run {agent}-fix COSTRA-xxx`~~ | ⚠️ 保留但不推荐，等价于 `revise-round-<当前 round>` |
| `pause-review COSTRA-xxx` | 立即停止该卡的 Review 迭代，冒泡给 Human |
| `skip-review COSTRA-xxx` | 跳过 Review 闭环直推 Human 终审（慎用，记 daily） |
| `force-pass COSTRA-xxx` | Human 强制通过（覆盖 Review-Agent 的 REJECT） |
| `reopen-review COSTRA-xxx` | 对已自动关闭（D-013 T3/T4）的卡重新打开 Human-Review 终审窗口 |
| `reopen-batch <batch-name>` | 对整批（如 `sprint-0-review`）重新打开 Human 终审 |
| `require-human-review COSTRA-xxx` | 在 AI-Review 启动前就标记该卡走 T1 路径，强制 Human 终审 |
| `review-card COSTRA-xxx` | （D-014）对某卡强制做一次**卡定义 Review**（历史卡补审或已 skip 的卡） |
| `skip-card-review COSTRA-xxx` | （D-014）跳过卡定义 Review，直接进 Todo（需 Human 提供原因，记 daily） |
| `force-card-pass COSTRA-xxx` | （D-014）Human 强制通过卡定义 Review（覆盖 Review-Agent） |

---

## 10. Revise↔Review 自动循环细则（D-011 + D-015 + D-016）

> **本章来源**：原 `SOP-REVIEW-AUTOLOOP.md` v1.2 完整内容，合并入本 SOP。
> **本章范围**：只管 Review 闭环内 **Revise↔Review 相互拉起**的自动推进；卡定义 Review 首轮自动拉起由 `SOP-CARD-REVIEW.md` 定义（执行层同受 §10.5 D-016 约束）。

### 10.1 一句话规则

**Review-Agent 给出 `REVISE` 后，Orchestrator 直接拉起被审 Agent 改；被审 Agent 交完修复说明后，Orchestrator 直接拉起 Review-Agent 复审——无需 Human 逐轮触发，直到 PASS / 轮次到顶 / 分歧 / 红线 / Human 叫停。所有切换必须同一 tool call 循环内兑现（§10.5）。**

### 10.2 启动条件（何时进入自动循环）

下列之一即进入：

- Human 首次发 `run review-tech COSTRA-xxx` 或 `run review-product COSTRA-xxx`
- 被审 Agent 首次产出后，Orchestrator 按 §3 Step 2 自动拉起 Review-Agent（仍然**是 Human 触发 Agent 产出**这一步进来的）

**⚠️ 不会**仅仅因为卡进了 Doing 就自动启动。**被审 Agent 的首次产出永远需要 Human 触发 `开干 COSTRA-xxx`。**

### 10.3 前置条件（D-011 §2 镜像 · D-015 修订条款 4）

自动推进**必须**同时满足：

1. 有至少一轮 Review 报告
2. 最近 verdict == `REVISE`
3. round < 5
4. **D-015**：被审 Agent 上一轮 response 中**若**对某 P0 意见反驳，则 **Review-Agent 必须在本轮中已明确驳回该反驳并要求 Agent 在本轮修复**（首次反驳**不中断**自动循环；Review-Agent 二次驳回 + Agent 本轮仍拒绝修复同一 P0 → 中断并 ESCALATE）
5. Human 未下达 `pause-review` / `skip-review` / `force-pass`
6. 未触发红线

任一不满足 → 自动循环终止 → 冒泡给 Human。

#### 10.3.1 D-015 异议仲裁示例

| 轮次 | Agent 动作 | Review-Agent 动作 | 自动循环状态 |
|---|---|---|---|
| Round 1 | ❌ 反驳 P0-X（首次） | 下轮将裁决 | ✅ 继续 |
| Round 2 | 其余 P0/P1 已修 | ❌ 驳回反驳（overruled），要求 Round 2 response 中 Agent 修复 P0-X | ✅ 继续 |
| Round 2 | 若 Agent 未修复 P0-X 并再次反驳 | 自动触发 ESCALATE | ❌ 中断，冒泡 Human |
| Round 2 | 若 Agent 按裁决修复 P0-X | 正常审 | ✅ 继续 |

### 10.4 状态机

```
                       ┌───────────────────────────────────────────────┐
                       │  Human 触发 run review-{tech|product}        │
                       │        或                                    │
                       │  被审 Agent 首次产出（需 Human 触发）         │
                       └──────────────┬────────────────────────────────┘
                                      ▼
                     ┌─────────── Review-Agent 跑 round N ─────────┐
                     │                                             │
                     ▼                                             │
              解析 verdict                                          │
           ┌──────┼──────┬──────────┬──────────┬──────────┐       │
           ▼      ▼      ▼          ▼          ▼          ▼       │
         PASS / PASS-WITH-FOLLOWUP     REVISE      REJECT + 红线  ESCALATE    ROUND-LIMIT(=5)
           │                             │              │             │             │
      写 FINAL.md                  检查前置 §10.3         │             │             │
      进 Human-Review / 自动关闭   C1~C6                  │             │             │
                                         │              │             │             │
                             全部满足 ──▶│              │             │             │
                                         ▼              ▼             ▼             ▼
                                   自动拉被审        写 incident    写 FINAL    写 FINAL
                                   Agent 改 round N+1  冒泡          冒泡         冒泡
                                   （同轮兑现 §10.5）
                                         │
                                         ▼
                                 被审 Agent 产 response.md
                                         │
                                         ▼
                                 同轮拉起 Review-Agent 跑 round N+1（§10.5）
```

### 10.5 🔒 同轮兑现铁律（D-016 · v1.2 · 2026-04-24 19:10）

#### 10.5.1 条文

> Orchestrator 在任何 Agent 产出（Revise / 首次交付 / 卡定义）后，**若声明**要自动拉起 Review（依据 D-011 环内 / D-014-a 卡定义首轮 / D-014-b 产出首轮三条例外之一），**必须**在**同一轮 tool call 循环内**连续切换到 Review-Agent 角色产出 Review 报告，并在同轮末给出**合并汇报**（Agent 交付段 + Review 审查段）。
>
> **严禁**本轮收尾后声称"下一轮自动执行 / 60 秒内自动拉起 / 后台自动推进"等跨轮异步表述。跨轮 = Human 必须重新触发 = 违反 `SOP-HUMAN-TRIGGER` Agent 触发铁律。
>
> 若本轮因时间 / tool 调用次数上限 / 上下文长度等客观限制**无法**完成 Review 同轮产出，**必须**：
> 1. 明说"本轮只完成 {Agent} 产出，Review 需你触发 `run review-{tech|product} COSTRA-xxx round-N`"
> 2. STATE `MODE` 设 `awaiting-human`（不得设 `auto-loop-in-progress` 等假陈述）
> 3. board "AI-Review 自动循环中" 段不得写"⏳ 自动拉起中" · 必须写"等 Human 触发 Review"
> 4. 不得承诺"跨轮自动"

#### 10.5.2 正确执行姿态（示范）

```
[用户发] run backend COSTRA-101 revise-round-3
↓
[同一 tool call 循环内]
  Step 1: Backend 改代码 + 跑三绿灯
  Step 2: 落盘 revise-round-3.md
  Step 3: 🚫 不收尾 · 直接继续 →
  Step 4: 切 Review-Tech 角色 · 读 revise-round-3.md + 代码改动
  Step 5: 落盘 round-3-tech.md（verdict=PASS/REVISE/REJECT/ESCALATE）
  Step 6: 同步 STATE / board / metrics / FINAL
  Step 7: 再收尾 · 给用户 **合并汇报**（Revise 交付段 + R3 Review 审查段）
[对话轮结束]
```

#### 10.5.3 错误执行姿态（禁止）

```
[用户发] run backend COSTRA-101 revise-round-3
↓
[同一 tool call 循环内]
  Step 1~3: Backend 改代码 + 落盘 revise-round-3.md
  Step 4: ❌ 给用户总结 + 声称"60 秒内自动拉起 Review-Tech"
  Step 5: ❌ STATE MODE=auto-loop-in-progress（假陈述）
  Step 6: ❌ board 写"⏳ 自动拉起中"（假陈述）
  [对话轮结束]
↓
[Orchestrator 下班 · 无守护进程 · 账面与磁盘漂移]
↓
[Human 下轮质疑] "真的自动拉起来了吗？"
↓
[I-005 登记]
```

#### 10.5.4 违规判定与处置

出现以下任一情况即判违规（记 incident）：

- 汇报中出现"自动拉起中 / 60 秒内拉起 / 后台推进中"字样但磁盘无对应 Review 报告
- STATE `MODE=auto-loop-in-progress` 但 tool call 循环已收尾
- board "⏳ 自动循环中"段存续但相关 Review 报告不存在
- 任何"Orchestrator 下一轮自动 xxx"的跨轮既定事实表述

处置流程：

1. Orchestrator 自检发现 or Human 质疑发现 → 立即在当轮补救
2. 补救优先级最高：**同轮兑现声称的动作**（如 I-005 补救产出 round-3-tech.md）
3. 同步校正 STATE / board / metrics 假陈述
4. 登记 Incident（I-xxx 编号）
5. 若是 D-016 立案后再犯 → 升级为 **ESCALATE** · Human 介入审查 Orchestrator 是否需要规约再强化

#### 10.5.5 完整条文

详见 `.team/decisions/D-016-same-turn-review-autoloop.md`（立案 2026-04-24 19:10 · I-005 触发）。

### 10.6 Orchestrator 的自动推进动作清单

每次 verdict=REVISE 时（前置 §10.3 满足），Orchestrator 必须依次做：

1. **读** 最新 `round-N-{tech|product}.md`，提取 P0/P1/P2
2. **判** 前置 §10.3，任一不满足 → 停并冒泡，**不**执行 3-7
3. **更新看板**：`AI-Review 迭代中` 行从 `round N/5` 改为 `round N+1/5 · 自动推进中`
4. **写消息** 到 `.team/messages/YYYY-MM-DD.jsonl`：`agent_handoff` 事件，注明"自动拉起 backend-fix"
5. **切角色** 执行 Backend-Fix / MiniApp-Fix / PM-Fix / Design-Fix，按 Review 报告逐条改
6. **产出** `round-N-{agent}-response.md`（必须说明每条 P0 采纳 or 反驳）
7. **同轮切 Review-Agent** 跑 round N+1（§10.5 · 不得跨轮 · 回到 §10.4 状态机顶部）

**关键约束**：
- 每一个以上步骤都**必须留痕**（看板 / 消息 / 文件），Human 回看能完整重放
- Orchestrator 不得跳过 response.md 直接跑下一轮 Review
- Orchestrator 不得合并两个 round 的报告
- 第 7 步**不得**跨轮承诺 · 若本轮物理限制无法同轮完成 → 改走 §10.5 条文第 2 段降级路径

### 10.7 自动循环中的汇报格式（MUST）

每次 Orchestrator 在自动循环内完成任何一步动作后，进度汇报必须包含：

```
## ⏳ Review 自动循环中（共 N 张）

| 卡号 | 当前 round | 上一 verdict | 下一步 | 可立即打断指令 |
|---|---|---|---|---|
| COSTRA-100 | 2/5 · 自动推进中 | Round-1 REVISE（3 P0） | 本轮 Review-Tech 同轮已产出 Round-2 verdict=PASS（见 §10.5） | `pause-review COSTRA-100` / `stop` |
```

"下一步"字段**必须**写同轮已兑现的结果 or 明说"Review 需你触发"（D-016 §10.5），**不得**写"60 秒后自动跑"。

缺失此段 = 违规，等同破铁律，记 incident。

### 10.8 Human 打断窗口

- Human 在任何对话轮中发送 §9 列出的打断指令 → Orchestrator **本轮立即停**
- 即使 Orchestrator 当前轮"计划"自动推进，只要 Human 在**同一对话回合**里表达了异议（对某 P0 反对、问某 P0 凭据、要求先做别的卡）→ **立即暂停，先响应 Human**

### 10.9 优先级

| 冲突场景 | 胜出 |
|---|---|
| Human 的 `pause-review` vs 自动推进 | Human 胜 |
| 红线触发 vs 自动推进 | 红线胜（立即停） |
| §4.2 5 轮上限 vs 自动推进 | 5 轮上限胜 |
| D-016 同轮兑现 vs D-011 自动推进声明 | **D-016 胜**（不能同轮兑现 → 不得声称自动拉起 → 改走 Human 触发） |
| `SOP-HUMAN-TRIGGER` 铁律 vs 自动推进 | **在 Review 闭环内自动推进胜**（D-011 豁免 · 但仍受 D-016 约束）；**其他场景铁律胜** |
| 时间 / tool 上限物理约束 vs D-016 同轮兑现 | 物理约束胜 · 必须走 §10.5 条文第 2 段降级路径 |

---

## 11. 度量

### 11.1 每张卡的 Review 度量（进 `.team/metrics.json`）

每次 Review 闭环结束，Orchestrator 记录：

```json
{
  "card": "COSTRA-101",
  "review_type": "tech",
  "total_rounds": 2,
  "terminal_verdict": "PASS",
  "p0_caught_in_review": 5,
  "p0_escaped_to_human": 0,
  "escalated": false,
  "time_cost_minutes": 45,
  "human_final_decision": "approve",

  "autoloop_enabled": true,
  "autoloop_rounds_run": 3,
  "autoloop_interrupted_by_human": false,
  "autoloop_interrupt_reason": null
}
```

### 11.2 每次自动拉起的 D-016 合规度量

```json
{
  "card": "COSTRA-xxx",
  "round": N,
  "auto_kickoff_claim": true,
  "auto_kickoff_delivered": true,
  "auto_kickoff_type": "D-011|D-014-a|D-014-b",
  "d016_compliant": true
}
```

若 `auto_kickoff_claim=true && auto_kickoff_delivered=false` → **自动登记 I-xxx incident**。

### 11.3 每周聚合（`.team/weekly/review-metrics.md`）

每周五 Orchestrator 聚合：

- Review-Agent 拦截了多少个 P0（避免流到 Human）
- 平均迭代轮次
- ESCALATE 率（过高 → 说明 Review-Agent 规约偏宽或偏严，需要调参）
- Round-limit 命中率（过高 → 说明被审 Agent 素质不行或任务粒度太大）
- **自动循环的平均收敛轮次**、**Human 打断率**
- **D-016 违规次数**（应恒为 0；非 0 即需 ESCALATE）

### 11.4 回退信号

出现以下信号 → Orchestrator 必须提醒 Human 是否回退到方案 C（纯手动）：

- Human 在同一张卡**连续 2 轮使用** `pause-review` / `stop` / `force-pass`
- Review-Agent **连续 3 张卡** ROUND-LIMIT 未收敛
- 自动循环产生**已记录的方向漂移**事故（写入 `.team/incidents/`）

回退由 Human 拍板，Orchestrator 不自行决定。

---

## 12. 与现有 SOP / 决议的关系

| SOP / Decision | 关系 |
|---|---|
| `SOP-HUMAN-TRIGGER` | **局部豁免**（D-011 · D-014）。Review 闭环内 Revise↔Review 相互拉起（D-011）、Review 首轮启动 + 卡定义 Review 首轮启动（D-014）无需 Human 逐轮触发，其他场景铁律照旧 |
| `SOP-CARD-REVIEW` | **D-014 配套**。规定卡创建后的卡定义 Review 完整流程、checklist、产物模板、触发指令。其执行层同受本 SOP §10.5（D-016）约束 |
| `SOP-OBSERVE-AND-INTERVENE` | 本 SOP 是前者的加强版 filter。观察干预仍然是 Human 最高权 |
| `engineering-guidelines` | Review-Agent 的 checklist 直接引用此文件作为打分依据 |
| `COMMON-CONTRACT` | 需要补丁：增加 Review-Agent-Tech / Review-Agent-Product 两条目录权限记录 |
| `D-011 方案 B` | **本 SOP §10.1~§10.4 / §10.6~§10.9 的直接依据**（2026-04-23 19:45） |
| `D-013 Review 场景分级` | **本 SOP §1 约束 6 / §4.1 / §9 的直接依据**（2026-04-23 21:15） |
| `D-014 卡定义 Review + 自动拉起` | **本 SOP §1 约束 7 / §3 流程 / §7 调度 / §9 触发指令的直接依据**（2026-04-23 22:26） |
| `D-015 respond/revise 合并` | **本 SOP §6 回应格式 / §9 触发指令 / §10.3 前置 4 的直接依据**（2026-04-24 09:24） |
| `D-016 同轮兑现铁律` | **本 SOP §10.5 的直接依据**（2026-04-24 19:10 · I-005 触发立案） |

---

## 13. 版本与变更

### 13.1 合并后版本线（SOP-REVIEW.md）

| 版本 | 日期 | 变更 |
|---|---|---|
| v2.0 | 2026-04-24 19:16 | **合并原 `SOP-REVIEW-LOOP.md` v1.4 + `SOP-REVIEW-AUTOLOOP.md` v1.2 为单一 SOP**（方案 A · Human 批准）。内容对齐 D-011/D-013/D-014/D-015/D-016 全部现行条款。原两份 SOP 降级为 stub 保留外链兼容 |

### 13.2 合并前版本线（原 SOP-REVIEW-LOOP.md · 已归档）

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 19:20 | Human 指令确立，Orchestrator 成文 |
| v1.1 | 2026-04-23 19:45 | D-011 引入方案 B 自动循环，新增 §1 约束 5 + §11 关系表更新 |
| v1.2 | 2026-04-23 21:15 | D-013 Review 场景分级：§1 新增约束 6 / §4.1 改写为分档分流 / §9 新增 `reopen-review` 等 3 条指令 / §11 关系表加 D-013 |
| v1.3 | 2026-04-23 22:26 | D-014 卡定义 Review + Review 环首自动拉起：§1 新增约束 7 / §3 流程引言 / §7.1 自动拉起 + 卡定义 Review 触发规则 / §7.2 补历史卡豁免 / §9 新增 `review-card` / `skip-card-review` / `force-card-pass` / §11 关系表新增 SOP-CARD-REVIEW + D-014 |
| v1.4 | 2026-04-24 09:24 | D-015 合并 respond/revise：§6 回应格式升级为"采纳/反驳/部分采纳"三态+异议仲裁链路 + §6.1/§6.2 新增 · §9 废除 `respond-round-N` 并统一 `revise-round-N` 语义 · §11 关系表加 D-015 |

### 13.3 合并前版本线（原 SOP-REVIEW-AUTOLOOP.md · 已归档）

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 19:45 | Human D-011 确认，Orchestrator 成文，即刻生效 |
| v1.1 | 2026-04-24 09:24 | D-015：§4 前置条件 4 改写（首次反驳不中断，Review-Agent 二裁驳回后 Agent 仍反驳才 ESCALATE）+ §4.1 新增异议仲裁示例表 |
| v1.2 | 2026-04-24 19:10 | **D-016 同轮兑现铁律**：§11 新增。所有"自动拉起"必须同一 tool call 循环内完成切角色产出，不得跨轮。I-005 触发立案 |

---

**本 SOP 由 Human 于 2026-04-23 指令确立（方案 B · D-011）、2026-04-24 19:16 批准合并（方案 A），Orchestrator 即刻生效，无需再次评审。**
