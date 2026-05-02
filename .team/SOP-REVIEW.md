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
4. **审查 subagent 无写权** · 只给意见（v2.1 · D-018 · 通过 prompt §H 硬性声明 + Orchestrator 事后比对 final message 与磁盘产物是否一致 保证 · 详见 `.team/agents/COMMON-CONTRACT.md §0-Bis`）
5. **🆕 执行层 SBAI 化**（D-018 · 2026-05-02 生效 · 替代"Orchestrator 切角色扮演"模型）：所有 Review / Revise 动作通过 `task(subagent_name="code-explorer", prompt=...)` spawn **全新上下文**完成。被审角色 + 审查角色统一走同步 subagent 路径。详见 `.team/decisions/D-018-spawn-based-agent-isolation.md §3`
6. **Review 场景分级**（D-013 · 2026-04-23 21:15 生效）：Review 按**准入 T1 / Gate 前 T2 / 追溯 T3 / 回归 T4** 分档。**T1/T2 仍需 Human 终审**（约束 3 原文适用）；**T3/T4 在 AI-Review PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞 四条件同时满足时自动关闭**，不走 Human 终审，Human 保留 `reopen-review` 复议权。详见 `.team/decisions/D-013-review-scenario-tiering.md`
7. **卡定义 Review + 产出 Review 首轮自动拉起**（D-014 · 保留 · 执行层改 SBAI · 2026-05-02）：
   - (a) 所有 D-014 立案后新建的卡**必须**经过一次卡定义 Review（技术向 → card-reviewer-tech / 产品向 → card-reviewer-product），详见 `SOP-CARD-REVIEW.md`
   - (b) 被审装扮 subagent 交付后，Orchestrator 在**同一对话轮内** spawn 对应 review 审查 subagent（若本轮预算不足则明说"下轮需你触发 `run review-{tech|product} COSTRA-xxx round-N`"）
   - (c) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级
   - 详见 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`
8. **respond/revise 触发词合并**（D-015 · 2026-04-24 09:24 生效 · 保留不变）：`respond-round-N` 已**废弃**，`revise-round-N` 统一承担"回执+修复+可表达异议"三合一语义。Agent 允许对 Review 意见反驳，但必须当轮同时落盘采纳项的代码修复；异议由 review 审查 subagent 在下一轮二次裁决，驳回后 Agent 必须修复，不得二次反驳（否则 ESCALATE）。详见 `.team/decisions/D-015-unify-respond-revise.md`
9. **🆕 Human 每轮显式触发**（D-018 §7 铁律回归原教旨）：除 D-011 Review 闭环内 `Revise↔Review` 相互拉起可在 Orchestrator **同一对话轮内**连续 spawn 外，**跨轮**任何 Agent 动作都需 Human 显式触发（废除"下一轮自动"类承诺）。同轮连续 spawn 不违反此铁律（本质是一次 Human 触发里的多步兑现）
10. **🆕 并行 Orchestrator 支持**（D-018 §4）：多个 CodeBuddy 会话可同时作为 Orchestrator 操作 Costra · 不使用 `task` 团队模式 · 冲突处理见 `.team/decisions/D-018-spawn-based-agent-isolation.md §4.2`

---

## 2. 角色分工矩阵

| 被审装扮 subagent | 审查 subagent 类型 | 审核范围 |
|---|---|---|
| backend-dev（旧 Backend-Agent） | **review-tech-{card}-r{N}** | `server/`、`api/`、`docs/api/`、`docs/db/` |
| miniapp-dev（旧 MiniApp-Agent） | **review-tech-{card}-r{N}** | `miniprogram/` |
| pm-writer（旧 PM-Agent） | **review-product-{card}-r{N}** | `docs/`（除 `api/db/` 外）、`.team/backlog.json`、`.team/risks.md`、`.team/cards/`、订阅文案、隐私清单、Sprint 计划、Retro |
| design-maker（旧 Design-Agent） | **review-product-{card}-r{N}** | `design/`、`docs/design/` |
| devops-ops（旧 DevOps-Agent） | **不走审查 subagent** | Human 直审（涉及生产/密钥/域名，风险太高） |
| qa-planner（旧 QA-Agent） | **不走审查 subagent** | Human 直审（测试策略本身就是质量标准，不能由另一个 AI 批） |

**例外规则**：
- 跨域产出（例如 PM 写了技术味很重的 `id-strategy.md`，或 Backend 写了产品味很重的发布公告）→ Orchestrator 按**主产出属性**决定归属，**不允许同时 spawn 两个审查 subagent**
- 决策类文档（`.team/decisions/D-xxx.md`、ADR）→ **不走审查 subagent**，直接 Human 决策

---

## 3. 基础流程（7 步）

> **环首自动拉起**（D-014 · 2026-04-23 22:26 · 执行层 SBAI 化 2026-05-02）：Step 2 不再需要 Human 逐轮触发 · 被审装扮 subagent 交付后 Orchestrator 在**同一对话轮内** spawn 对应 review 审查 subagent。Human 打断指令（`pause-review` / `skip-review` / `stop`）最高优先级。

```
[Step 1] 被审装扮 subagent 产出
   ↓
[Step 2] Orchestrator 识别归属 → spawn 对应 review-{tech|product}-{card}-r{N} 审查 subagent（同一对话轮内 · D-018 §3.1）
   ↓
[Step 3] 审查 subagent 读 Context Injection Contract（§7.3）约束内的全部材料后审 → final message 返回完整 round-N-{tech|product}.md 全文
   ↓
[Step 3-bis] Orchestrator 原样落盘审查 subagent 的 final message 到 `.team/reviews/COSTRA-xxx/round-N-{tech|product}.md`（不得裁剪/改写 · 违反即 `I-evidence-tampered`）
   ↓
[Step 4] Orchestrator 解析 verdict
   ├─ PASS / PASS-WITH-FOLLOWUP → 进入 Human-Review 终审（T1/T2）或自动关闭（T3/T4 · D-013）
   ├─ REVISE → 走 §10 自动循环前置判断，满足 → 同一对话轮内 spawn 被审装扮 subagent 做第 N+1 轮修复
   ├─ REJECT → 直接打回被审装扮 subagent 重做（round 重置为 1，需要 Orchestrator 记录 incident）
   └─ ESCALATE → 停，冒泡给 Human
   ↓
[Step 5] 被审装扮 subagent 修复 → 产出 `round-N-{role}-response.md`（即 revise-round-N.md · 说明改了啥）
   ↓
[Step 6] 回 Step 2，round + 1（同一对话轮内继续 · 或跨轮等 Human 触发）
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

### 7.3 拉起时的 Context 注入模板（SBAI Context Injection Contract · D-018 §3.3 · 2026-05-02）

每次 spawn 审查 subagent · prompt **必须**包含以下 §A~§H 八段（完整模板见 `.team/decisions/D-018-spawn-based-agent-isolation.md §3.3 (C)`）：

- **§A 角色规则**：inline `.team/agents/07-review-agent-tech.md` 或 `08-review-agent-product.md` 全文
- **§B 公共契约**：inline `.team/agents/COMMON-CONTRACT.md` §0 / §4 / §8bis / §8ter 关键段
- **§C 卡主 state.md**：审查场景可略（审查角色本身无 state.md · 但若审 revise 则 inline 被审角色的 `.team/members/{role}/state.md`）
- **§D 最近相关 history**：同上（Orchestrator 筛选 1-3 份相关的 history/*.md inline）
- **§E 项目全景**：Sprint 当前状态 / STATE MODE / 最近决策摘要 / 关联卡状态
- **§F 本次任务**：
  - 卡号 + 卡类型 + 本轮是第 N/5 轮
  - 被审 diff 片段（相对上一 PASS commit 或 main）
  - 被审回应 `round-N-{role}-response.md` 全文 inline（若 N≥2）
  - 上一轮 `round-(N-1)-{tech|product}.md` 的 **P0/P1 原文全量**（若 N≥2 · MUST 不得摘要）
- **§G 强制阅读清单**（按卡类型）：
  - 技术向：`docs/charter.md §7` / `engineering-guidelines.md` / `api/openapi.yaml`（若涉及 API）/ `docs/db/schema.md`（若涉及 DB）/ 本 SOP §4 停止条件 / 相关 ADR / 被审角色的 `.team/agents/{0x-role}.md` 职责
  - 产品向：`docs/charter.md` 全文 / `engineering-guidelines.md` / 对应 PRD / `design/flows/` 相关 / `backlog.json` / `risks.md` / 相关 ADR
- **§H 硬约束**：
  - 你无写权（禁止调用 write_to_file / replace_in_file / execute_command / delete_file · 防御层 1 · COMMON-CONTRACT §0-Bis）
  - 产出通过 final message 返回完整 markdown · 由 Orchestrator 原样落盘
  - 信息不足自首：判某 checklist 项证据不足时，在"自我反思"段明说"信息不足：xxx"并判置信度"低" · 不得瞎猜打高分
  - 禁止引用"记忆中"的东西 · 只有本 prompt + 磁盘内容
  - 审完 Orchestrator 会视需要 shutdown · 不得保留状态 · 不建立跨卡记忆

### 7.3.1 违规判定

- Spawn prompt 缺 §A/§B/§F/§G 任一段 → `I-context-injection-violation`
- §F 审查场景用 Orchestrator 转述替代 diff 原文 → `I-evidence-tampered`
- N≥2 时未 inline 上轮 P0/P1 原文 → `I-context-broken-chain`
- 审查 subagent 本轮绕过 §H 硬约束直接写盘 → Orchestrator 发现后记 `I-oneshot-write-violation` + **不采信**本轮产物 · 要求 Human 裁决（重审 or 接受）
- 同一卡同轮多次 spawn 不同 prompt 的审查 subagent（双盲逃避）→ 升级 **ESCALATE** · 记 `I-double-blind-evasion`

### 7.4 Orchestrator 的**禁止事项**

- ❌ **禁止自己产出审查意见**（必须 spawn 独立 subagent · 核心 SBAI 约束 · D-018 §3.1）
- ❌ 禁止跳过审查 subagent 直接推到 Human（除非 §6.2 例外）
- ❌ 禁止在 spawn 审查 subagent 之前自己先写 review 意见（会污染独立性）
- ❌ 禁止在 round=5 还没停（硬性卡死）
- ❌ 禁止合并两个审查 subagent 的报告（保持独立）
- ❌ 禁止将被审角色的 prompt 和审查角色的 prompt 放在同一 spawn 中
- ❌ 禁止 spawn 审查 subagent 后修改它的 final message 再落盘
- ❌ 禁止跨轮承诺（"下一轮自动拉起"类表述）· 同一对话轮 spawn 不算跨轮
- ❌ 禁止同一卡同轮 spawn 多个不同 prompt 的审查 subagent（双盲逃避 · 升级 ESCALATE）

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

## 10. Revise↔Review 自动循环细则（D-011 + D-015 · 执行层 SBAI · D-018）

> **本章来源**：原 `SOP-REVIEW-AUTOLOOP.md` v1.2 完整内容，合并入本 SOP。
> **本章范围**：只管 Review 闭环内 **Revise↔Review 相互拉起**的自动推进；卡定义 Review 首轮自动拉起由 `SOP-CARD-REVIEW.md` 定义（执行层同受 D-018 §3.1 同步 subagent 约束）。
> **v2.1 变更**（2026-05-02）：删除原 §10.5"D-016 同轮兑现铁律"整块 · SBAI v1.0 下同步 subagent 天然同对话轮兑现 · 无需单独立铁律。

### 10.1 一句话规则

**审查 subagent 给出 `REVISE` 后，Orchestrator 在同一对话轮内 spawn 被审装扮 subagent 做 revise-round-{N+1}；被审装扮 subagent 交完修复说明后，Orchestrator 同一对话轮内 spawn 新一轮审查 subagent 复审——无需 Human 逐轮触发，直到 PASS / 轮次到顶 / 分歧 / 红线 / Human 叫停。SBAI 同步 subagent 天然在同对话轮兑现（D-018 §3.1）；本轮预算不足则明说下轮需 Human 触发，不得做"跨轮自动"承诺。**

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
                                 被审装扮 subagent 产 response.md
                                         │
                                         ▼
                                 同一对话轮内 spawn review 审查 subagent 跑 round N+1（D-018 §3.1）
```

### 10.5 Orchestrator 的自动推进动作清单

每次 verdict=REVISE 时（前置 §10.3 满足），Orchestrator 必须依次做：

1. **读** 最新 `round-N-{tech|product}.md`，提取 P0/P1/P2
2. **判** 前置 §10.3，任一不满足 → 停并冒泡，**不**执行 3-7
3. **更新看板**：`AI-Review 迭代中` 行从 `round N/5` 改为 `round N+1/5 · 自动推进中`
4. **写消息** 到 `.team/messages/YYYY-MM-DD.jsonl`：`agent_handoff` 事件，注明"同对话轮内 spawn {role}-dev 装扮 subagent 做 revise-round-{N+1}"
5. **spawn 装扮 subagent** 执行 backend-dev / miniapp-dev / pm-writer / design-maker 做 revise-round-{N+1}（按 Review 报告逐条改 · Context Injection Contract §A~§H · 装扮 subagent 产出 response.md + 更新 state.md + 新增 history/*.md）
6. **产出** `round-{N+1}-{role}-response.md`（必须说明每条 P0 采纳 or 反驳）
7. **同一对话轮内 spawn review 审查 subagent** 跑 round {N+1}（D-018 §3.1 · 本质是一次 Human 触发里的多步兑现 · 跨轮则需 Human 再触发）

**关键约束**：
- 每一个以上步骤都**必须留痕**（看板 / 消息 / 文件），Human 回看能完整重放
- Orchestrator 不得跳过 response.md 直接跑下一轮 Review
- Orchestrator 不得合并两个 round 的报告
- 第 7 步**同一对话轮内兑现**（SBAI 同步 subagent 天然如此）· 若本轮预算不足 → 明说"下轮需你触发 `run review-{tech|product} COSTRA-xxx round-{N+1}`"· 不得做"跨轮自动"承诺

### 10.6 自动循环中的汇报格式（MUST）

每次 Orchestrator 在自动循环内完成任何一步动作后，进度汇报必须包含：

```
## ⏳ Review 自动循环中（共 N 张）

| 卡号 | 当前 round | 上一 verdict | 下一步 | 可立即打断指令 |
|---|---|---|---|---|
| COSTRA-100 | 2/5 · 自动推进中 | Round-1 REVISE（3 P0） | 本轮 review-tech 审查 subagent 同对话轮已产出 Round-2 verdict=PASS（见 §10.5） | `pause-review COSTRA-100` / `stop` |
```

"下一步"字段**必须**写同一对话轮已兑现的结果 or 明说"Review 需你触发"（D-018 §3.1），**不得**写"60 秒后自动跑"。

缺失此段 = 违规，记 incident。

### 10.7 Human 打断窗口

- Human 在任何对话轮中发送 §9 列出的打断指令 → Orchestrator **本轮立即停**
- 即使 Orchestrator 当前轮"计划"自动推进，只要 Human 在**同一对话回合**里表达了异议（对某 P0 反对、问某 P0 凭据、要求先做别的卡）→ **立即暂停，先响应 Human**

### 10.8 优先级

| 冲突场景 | 胜出 |
|---|---|
| Human 的 `pause-review` vs 自动推进 | Human 胜 |
| 红线触发 vs 自动推进 | 红线胜（立即停） |
| §4.2 5 轮上限 vs 自动推进 | 5 轮上限胜 |
| `SOP-HUMAN-TRIGGER` 铁律 vs 自动推进 | **在 Review 闭环内自动推进胜**（D-011 豁免 · 执行层受 D-018 §3.1 约束 · 同对话轮内连续 spawn 即兑现）；**其他场景铁律胜** |
| Context Injection Contract（§7.3）vs spawn 体积焦虑 | **Contract 胜**（宁可 prompt 长 · 宁可跨轮让 Human 再触发 · 不可缺 §A~§G 任一段） |

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
| `SOP-HUMAN-TRIGGER` | **局部豁免**（D-011 · D-014）。Review 闭环内 Revise↔Review 相互拉起（D-011）、Review 首轮启动 + 卡定义 Review 首轮启动（D-014）无需 Human 逐轮触发（本质是一次 Human 触发里的多步同对话轮兑现 · D-018 §3.1） · 其他场景铁律照旧 |
| `SOP-CARD-REVIEW` | **D-014 配套**。规定卡创建后的卡定义 Review 完整流程、checklist、产物模板、触发指令。其执行层受 D-018 §3.1 同步 subagent 约束 |
| `SOP-OBSERVE-AND-INTERVENE` | 本 SOP 是前者的加强版 filter。观察干预仍然是 Human 最高权 |
| `engineering-guidelines` | 审查 subagent 的 checklist 直接引用此文件作为打分依据 |
| `COMMON-CONTRACT` | v1.2 已对齐 SBAI：§0 权限矩阵改执行体二分法 / §0-Bis 工具白名单 / §8ter SBAI 执行层约定 |
| `D-011 方案 B` | **本 SOP §10 Review 闭环自动推进的概念依据 · 执行层由 D-018 §3.1 同步 subagent 替代**（2026-04-23 19:45 · 2026-05-02 执行层升级） |
| `D-013 Review 场景分级` | **本 SOP §1 约束 6 / §4.1 / §9 的直接依据**（2026-04-23 21:15） |
| `D-014 卡定义 Review + 自动拉起` | **本 SOP §1 约束 7 / §3 流程 / §7 调度 / §9 触发指令的直接依据**（2026-04-23 22:26 · 执行层 2026-05-02 升级为 SBAI） |
| `D-015 respond/revise 合并` | **本 SOP §6 回应格式 / §9 触发指令 / §10.3 前置 4 的直接依据**（2026-04-24 09:24） |
| `D-018 Spawn-Based Agent Isolation` | **本 SOP §1 约束 5/9/10 · §3 流程 · §7.3 Context Injection Contract · §7.4 禁止事项 · §10 执行层的直接依据**（2026-05-02 生效 · v1.0） |

---

## 13. 版本与变更

### 13.1 合并后版本线（SOP-REVIEW.md）

| 版本 | 日期 | 变更 |
|---|---|---|
| v2.0 | 2026-04-24 19:16 | **合并原 `SOP-REVIEW-LOOP.md` v1.4 + `SOP-REVIEW-AUTOLOOP.md` v1.2 为单一 SOP**（方案 A · Human 批准）。内容对齐 D-011/D-013/D-014/D-015/D-016 全部现行条款。原两份 SOP 降级为 stub 保留外链兼容 |
| **v2.1** | **2026-05-02** | **SBAI v1.0 对齐**（D-018 · Human approve）：§1 约束 5/9/10 重写为 SBAI 执行层 · §2 分工矩阵术语对齐（Backend-Agent → backend-dev 装扮 subagent 等）· §3 流程 Step 2/3 SBAI 化 + 新增 Step 3-bis 原样落盘 · §7.3 Context 注入模板升级为 D-018 §A~§H 八段 Context Injection Contract · §7.4 禁止事项扩展至 9 条（含"禁自己产出审查意见"核心约束）· §10.5 整块删除（D-016 同轮兑现已废弃 · SBAI 同步 subagent 天然同对话轮兑现）· §10.5~§10.8 重编号 · §10.8 优先级表删除 D-016 相关行 · §12 关系矩阵更新（删 D-016 条 · 加 D-018 条）· §13 加 v2.1 条目 |

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
