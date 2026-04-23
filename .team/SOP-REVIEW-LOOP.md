# SOP · Review 迭代闭环（强制）

> 登记时间：2026-04-23
> 登记人：Human（直接指令）+ Orchestrator 成文
> 适用范围：Orchestrator、Review-Agent-Tech、Review-Agent-Product、所有被审 Agent（Backend / MiniApp / PM / Design）
> 优先级：**P0 · 铁律** · 与 SOP-OBSERVE-AND-INTERVENE、SOP-HUMAN-TRIGGER 并列，不冲突

---

## 1. 背景与目标

Human 一个人盯所有 Agent 产出太吃力。引入两位 Review-Agent 做**机器预审**：
- **Review-Agent-Tech**：审 Backend / MiniApp（见 `.team/agents/07-review-agent-tech.md`）
- **Review-Agent-Product**：审 PM / Design（见 `.team/agents/08-review-agent-product.md`）

**核心约束**：
1. Review 与 Revise 的迭代**最多 5 轮**，超出必停
2. 迭代过程中若出现**不可调和分歧**，立即停下交给 Human 决定
3. Review-Agent 的结论**不替代**Human 终审，只是过滤器（通过了还得 Human 点头，没通过大概率 Human 也会打回）
4. Review-Agent **不写代码/文档**，只给意见
5. **🆕 默认启用自动循环**（D-011 / SOP-REVIEW-AUTOLOOP · 2026-04-23 生效）：Review 闭环内的 `Revise↔Review` 相互拉起无需 Human 逐轮触发，但前置条件 6 条 + 打断指令见 `SOP-REVIEW-AUTOLOOP.md §2/§4`

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

## 3. 完整流程（7 步）

```
[Step 1] 被审 Agent 产出
   ↓
[Step 2] Orchestrator 识别归属 → 拉起对应 Review-Agent
   ↓
[Step 3] Review-Agent 按规约审 → 产出 round-N-{tech|product}.md
   ↓
[Step 4] Orchestrator 解析 verdict
   ├─ PASS / PASS-WITH-FOLLOWUP → 进入 Review（Human 终审）
   ├─ REVISE → 拉起被审 Agent 做第 N+1 轮修复（回 Step 1，round+1）
   ├─ REJECT → 直接打回被审 Agent 重做（round 重置为 1，需要 Orchestrator 记录 incident）
   └─ ESCALATE → 停，冒泡给 Human
   ↓
[Step 5] 被审 Agent 修复 → 产出 `round-N-{agent}-response.md`（说明改了啥）
   ↓
[Step 6] 回 Step 2，round + 1
   ↓
[Step 7] 达到"停止条件"（见 §4）
```

---

## 4. 停止条件（硬性约束）

**满足以下任一 → 立即停**：

### 4.1 正常通过
- Review-Agent 给 `PASS` 或 `PASS-WITH-FOLLOWUP`
- Orchestrator 把卡推到 Review 列，等 Human 终审（approve / reject）

### 4.2 轮次上限
- **round == 5** 时仍未 PASS → 无论当前 verdict 是啥（除非是 PASS-WITH-FOLLOWUP），**强制停**
- Orchestrator 发 `approval_request` 给 Human，附：
  - 5 轮完整 review 报告链接
  - 5 轮修复说明
  - 当前残余 P0 清单
  - 一句话建议（"建议 Human 接管决策" / "建议拆卡"）

### 4.3 分歧升级
- Review-Agent 出 `ESCALATE` verdict → **停**
- 被审 Agent 对同一 P0 在两轮内都明确拒绝修复并给出反驳 → **停**（自动触发 ESCALATE）
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
├── round-1-backend-response.md      # 第 1 轮 Backend 修复说明
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

## 6. 被审 Agent 的回应格式

每轮 revise 完成后，被审 Agent 必须产出 `.team/reviews/COSTRA-XXX/round-N-{agent}-response.md`：

```markdown
# {Agent} Revision Response · COSTRA-XXX · Round N

## 对 Round-N Review 的回应

### P0-1 {Review 标题}
- **采纳 / 反驳**：✅ 采纳 | ❌ 反驳 | ⏸ 部分采纳
- **修改位置**：`server/src/auth/login.ts:45-52`（diff 见 commit `abc123`）
- **修改说明**：移除 `console.log(session_key)`，替换为脱敏日志
- （若反驳）**反驳依据**：引用文档/ADR/证据，不接受"我觉得"
- （若部分采纳）**延后理由**：...

### P0-2 ...
...

## 本轮新增产出
- 文件 A / 文件 B ...

## 本轮自测
- 单测 / 集成测试结果
- 手工冒烟结果

## 求再审
请 Review-{Tech|Product} 进入 Round N+1。
```

---

## 7. Orchestrator 的调度规则

### 7.1 何时拉 Review-Agent（MUST）

| 触发条件 | 动作 |
|---|---|
| 被审 Agent 发 `status_report` 且 `task_id` 进入 Review 列 | 识别归属 → 拉对应 Review-Agent |
| 被审 Agent 发 `revision_completed` 消息（round >= 2） | 拉同一个 Review-Agent 做 Round N+1 |

### 7.2 何时 **不**拉（MUST NOT）

- 卡属于 DevOps / QA → 直接 Human 终审
- 卡属于决策类（D-xxx / ADR-*）→ 直接 Human 决策
- Human 显式说过 `skip-review COSTRA-XXX`（记 daily 里）

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

---

## 8. Human 介入窗口

Review 闭环不改变 SOP-HUMAN-TRIGGER 的铁律。Human 侧只关心 3 个时机：

| 时机 | Human 要做什么 |
|---|---|
| Review-Agent 给 PASS/PASS-WITH-FOLLOWUP | 走原有"approve:COSTRA-XXX" 或 "reject:..." 流程 |
| ESCALATE / ROUND-LIMIT / RED-LINE | 冒泡到 Human，看 `FINAL.md` 做决策 |
| Human 主动暂停 | 发 `pause-review COSTRA-XXX`，Orchestrator 停调度 |

**Orchestrator 必须在进度汇报中醒目标注**正在 Review 闭环中的卡（避免 Human 误以为"卡死了"）：

```
## 🔍 Review 迭代中（共 N 张）

| 卡号 | 被审 Agent | Review-Agent | 当前轮次 | 最近 verdict | 下一动作 |
|---|---|---|---|---|---|
| COSTRA-101 | Backend | review-tech | 2/5 | REVISE（2 P0） | 等 Backend 修复（需你说 `run backend-fix COSTRA-101`） |
```

---

## 9. 触发指令补丁（合入 SOP-HUMAN-TRIGGER §3）

| 用户说 | Orchestrator 行为 |
|---|---|
| `run review-tech COSTRA-xxx` | 强制拉 Review-Tech 对该卡跑一轮 |
| `run review-product COSTRA-xxx` | 强制拉 Review-Product 对该卡跑一轮 |
| `run {agent}-fix COSTRA-xxx` | 拉被审 Agent 按最新 Review 报告做 revise |
| `pause-review COSTRA-xxx` | 立即停止该卡的 Review 迭代，冒泡给 Human |
| `skip-review COSTRA-xxx` | 跳过 Review 闭环直推 Human 终审（慎用，记 daily） |
| `force-pass COSTRA-xxx` | Human 强制通过（覆盖 Review-Agent 的 REJECT） |

---

## 10. 度量指标（进 `.team/metrics.json`）

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
  "human_final_decision": "approve"
}
```

每周五 Orchestrator 聚合一次（`.team/weekly/review-metrics.md`）：
- Review-Agent 拦截了多少个 P0（避免流到 Human）
- 平均迭代轮次
- ESCALATE 率（过高 → 说明 Review-Agent 规约偏宽或偏严，需要调参）
- Round-limit 命中率（过高 → 说明被审 Agent 素质不行或任务粒度太大）

---

## 11. 与现有 SOP 的关系

| SOP | 关系 |
|---|---|
| `SOP-HUMAN-TRIGGER` | **局部豁免**（D-011 · 2026-04-23）。Review 闭环内的 Revise↔Review 相互拉起无需 Human 逐轮触发；其他场景铁律照旧（被审 Agent 首次产出、approve、跨卡编排仍需 Human 触发） |
| `SOP-REVIEW-AUTOLOOP` | **本 SOP 的执行细则**。前置条件、断点、状态机、度量详见 `.team/SOP-REVIEW-AUTOLOOP.md` |
| `SOP-OBSERVE-AND-INTERVENE` | 本 SOP 是前者的加强版 filter。观察干预仍然是 Human 最高权 |
| `engineering-guidelines` | Review-Agent 的 checklist 直接引用此文件作为打分依据 |
| `COMMON-CONTRACT` | 需要补丁：增加 Review-Agent-Tech / Review-Agent-Product 两条目录权限记录 |

---

## 12. 版本与变更

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 19:20 | Human 指令确立，Orchestrator 成文 |
| v1.1 | 2026-04-23 19:45 | D-011 引入方案 B 自动循环，新增 §1 约束 5 + §11 关系表更新 |

**本 SOP 由 Human 于 2026-04-23 指令确立，Orchestrator 即刻生效，无需再次评审。**
