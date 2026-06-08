# D-013 · Review 场景分级（Review Scenario Tiering）

- **状态**：Accepted
- **决策日期**：2026-04-23 21:15
- **决策人**：Human（"方案 B+C 可以的 执行吧"）
- **落地人**：Orchestrator
- **优先级**：🟠 P1 · 规约升级（非铁律，但覆盖 SOP-REVIEW-LOOP §1 约束 3 的默认行为）
- **影响范围**：Orchestrator 调度、Review-Agent-Tech / Review-Agent-Product、Human 终审窗口频次
- **关联决策**：D-011（方案 B 自动循环）、D-012（单卡交付即提交）
- **关联 SOP**：`SOP-REVIEW-LOOP.md` v1.1 → v1.2、`SOP-REVIEW-AUTOLOOP.md`（不改）

---

## 1. 背景与问题观察

### 1.1 问题现场

2026-04-23 21:08 Human 对 Orchestrator 提问："`approve-batch sprint-0-review` 这张卡为什么需要我来审批放行？"

Orchestrator 回看 `SOP-REVIEW-LOOP.md §1` 核心约束 3：

> Review-Agent 的结论**不替代** Human 终审，只是过滤器（通过了还得 Human 点头，没通过大概率 Human 也会打回）

该约束在 SOP v1.0 / v1.1 里是**一刀切**的——任何 Review-Agent PASS 都需 Human 终审。**没有区分 Review 的场景差异**。

### 1.2 本次命中的场景差异

Sprint-0 补审 7 张卡具备非常明确的特征：

| 维度 | 值 | 影响 |
|---|---|---|
| 被审对象已被 Human 准入批复 | ✅（G1/G2/G3/G5 闸门 04-22 通过） | 不构成新的准入决策 |
| Review 性质 | 追溯性质量审计（SOP 建立前产物补走流程） | 不构成放行决策 |
| AI-Review PASS 率 | 7/7 · 平均 29.57/30 · 4 张满分 | 质量通过显著 |
| 残余 P0 / P1 / 红线 | 0 / 0 / 0 | 无阻断项 |
| 对在推 Sprint 的阻塞 | 0 | 无新阻塞 |

此类场景下要求 Human 再过一次手"approve"，**无增量价值 · 有 Human 注意力损耗**。

### 1.3 根因

SOP v1.0 / v1.1 的"一刀切"是为了**防护激进场景**（新产出首次交付、准入决策、闸门材料），但**误伤了温和场景**（补审、回归、质量审计）。**规约粒度偏粗**，不是 Human 必须容忍的负担。

---

## 2. 决策

引入 **Review 场景分级**，把 Review 分为 4 档，分别对应 Human 终审的不同强制程度：

| 档位 | 场景 | Human 终审的必要性 | 处置默认 |
|---|---|---|---|
| **T1 · 准入 Review**（Gate-Entry） | 被审 Agent 新产出首次交付，用于准入/放行/依赖解除 | 🔴 **强必要** | AI-Review PASS 后**必须**进入 Human-Review 窗口 |
| **T2 · Gate 前 Review**（Pre-Gate） | 直接影响 G1/G2/G3/G4/G5 闸门结论的材料审查 | 🔴 **强必要** | AI-Review PASS 后**必须**进入 Human-Review 窗口 + 与闸门结论联动 |
| **T3 · 追溯 Review**（Retrospective） | 对已完工、已通过闸门的卡做质量审计（Sprint-0 补审属于此档） | 🟢 **弱必要** | **AI-Review PASS + 自动关闭条件满足** → 自动关闭，不走 Human 终审 |
| **T4 · 回归 Review**（Regression） | 改 bug / 补 Follow-up 后的校验，无新业务逻辑 | 🟢 **弱必要** | 同 T3，默认自动关闭 |

---

## 3. T3 / T4 自动关闭条件（同时满足）

| # | 条件 | 说明 |
|---|---|---|
| G1 | 最后一轮 verdict ∈ {`PASS`, `PASS-WITH-FOLLOWUP`} | REVISE / REJECT / ESCALATE 一律不自动关闭 |
| G2 | 残余 P0 = 0 且残余 P1 = 0 | 有任一残余 → 仍须 Human 终审 |
| G3 | 未触发红线（硬编码 secret / 目录越权 / Won't-Have / 主体字样） | 任一命中 → 强制 Human 终审 + 写 incident |
| G4 | 对在推 Sprint 无新阻塞 | 若自动关闭会导致下游卡延期 → 仍须 Human 终审 |

**任一条件不满足 → 回退到"Human 终审"路径**（等同于当前 SOP 默认行为）。

---

## 4. 场景识别规则（Orchestrator 调度 MUST）

### 4.1 T1 准入 Review 的识别

命中任一：
- 被审产出**首次**进入 `AI-Review` 列（board.md 泳道流转）
- 被审 Agent 的任务卡**尚未**在 `Done` 列（也就是还在走首次交付）
- 被审内容包含业务逻辑/契约/配置的**新建**（非改动）

### 4.2 T2 Gate 前 Review 的识别

命中任一：
- 卡 tag 含 `gate:G1|G2|G3|G4|G5` 或 `.team/gates/` 目录下有对应引用
- 卡从 `Doing` 直接切向 `Review` 时 Orchestrator 被 PM-Agent 标注为 "G?-material"
- Sprint 计划文档明确将该卡列为闸门材料依据

### 4.3 T3 追溯 Review 的识别

同时命中：
- 被审产出**已在** `Done` 列（已完工）
- 触发 Review 的指令为"补审 / 追审 / sprint-N 里的工作也用 review 走一遍" 类
- 被审卡的闸门状态已为 ✅

### 4.4 T4 回归 Review 的识别

命中任一：
- Review 触发消息显式标注 `regression-review`
- 卡属于 Follow-up 承接（`Refs: *-followup`）
- 对同一张卡的**第二次或以上**完整 Review 闭环（非同一闭环的 Round-N）

### 4.5 多档冲突时的处置

若一张卡同时命中 T1 和 T3（例如 Sprint-0 补审，但 Review 里识别出新的 P0 涉及未完工的 Sprint-1 卡）→ **按最强档处置（T1 > T2 > T3 > T4）**。

---

## 5. Human 复议机制（保留权）

Human 对任何已自动关闭的 Review 仍**保留复议权**：

| Human 指令 | 效果 |
|---|---|
| `reopen-review COSTRA-xxx` | 将已自动关闭的卡重新加入 Human-Review 窗口，等待显式 `approve:*` / `reject:*` |
| `reopen-batch <batch-name>` | 同上，对整批（如 `sprint-0-review`） |
| `require-human-review COSTRA-xxx` | 在 AI-Review 启动前就标记该卡走 T1 路径（强制 Human 终审），覆盖 Orchestrator 自动识别 |

Orchestrator 必须在自动关闭的卡的 `FINAL.md` 末尾明确列出"复议机制"章节，降低 Human 搜索成本。

---

## 6. 默认配置（项目级）

| 配置项 | 默认值 | 可覆盖 |
|---|---|---|
| T1 自动关闭 | ❌ | 不可（铁律） |
| T2 自动关闭 | ❌ | 不可（铁律） |
| T3 自动关闭 | ✅ | 可通过 `require-human-review` 单卡覆盖 |
| T4 自动关闭 | ✅ | 可通过 `require-human-review` 单卡覆盖 |
| 分级识别错误时的 fallback | 按 T1 处理 | — |

---

## 7. Orchestrator 的调度变更

### 7.1 AI-Review 结束后的动作（新增分支）

```text
AI-Review verdict = PASS / PASS-WITH-FOLLOWUP
   │
   ▼
识别场景分级（§4）
   │
   ├─ T1 / T2 ──▶ 推入 Human-Review 列，等 approve/reject（= 当前 SOP 行为）
   │
   └─ T3 / T4 ──▶ 检查 §3 四条件
                    │
                    ├─ 全部满足 ──▶ 自动写 FINAL.md（SKIP-REVIEW-AUTOCLOSED）
                    │               推入 Done，更新 board/STATE，通知 Human（聚合汇报即可）
                    │
                    └─ 任一不满足 ──▶ 回退到 Human-Review 列（等同 T1）
```

### 7.2 汇报格式（Orchestrator MUST）

每次自动关闭后，下一次进度汇报中必须**聚合列出**当日自动关闭的卡清单（不再每张卡单独冒泡打扰 Human）：

```
## 🔒 今日自动关闭（T3/T4）· 共 N 张

| 卡号 | 档位 | AI-Review Verdict | 关闭依据 | 可复议 |
|---|---|---|---|---|
| COSTRA-001 | T3 追溯 | PASS 29/30 | D-013 §3 全数命中 | `reopen-review COSTRA-001` |
| ... | ... | ... | ... | ... |
```

缺失此段 = 违规，记 incident。

---

## 8. 度量（`.team/metrics.json` 新增字段）

```json
{
  "card": "COSTRA-001",
  "review_tier": "T3",
  "human_review_required": false,
  "auto_close_conditions_met": ["G1","G2","G3","G4"],
  "final_verdict": "PASS",
  "auto_closed_at": "2026-04-23T21:15:00+08:00",
  "reopened_by_human": false
}
```

每周聚合观察：
- T3/T4 自动关闭命中率 → 评估是否需要扩展到更多场景
- Human 复议（reopen）率 → 过高 = D-013 识别规则失准，需要调整 §4
- T1/T2 误判率 → 例如把 T3 误识别为 T1，Human 被无效打扰

---

## 9. 与既有 SOP / ADR 的关系

| SOP / ADR | 关系 |
|---|---|
| `SOP-REVIEW-LOOP.md §1 约束 3` | **局部修订**：Review-Agent PASS 后 Human 终审"强制"改为"分档强制/可自动"；v1.1 → v1.2 |
| `SOP-REVIEW-LOOP.md §4.1 正常通过` | **分支补充**：T3/T4 满足 §3 条件时跳过 Human-Review |
| `SOP-REVIEW-LOOP.md §9 触发指令补丁` | **新增指令**：`reopen-review` / `reopen-batch` / `require-human-review` |
| `SOP-REVIEW-AUTOLOOP.md` | **不改**：D-011 豁免的是 Review 闭环内 Revise↔Review，D-013 豁免的是闭环结束后的 Human 终审，两者正交 |
| `SOP-HUMAN-TRIGGER.md` | **不改**：铁律本身不变，D-013 只是在"Review 结束后" 这个环节补充场景分级；其他所有触发点照旧 |
| `SOP-OBSERVE-AND-INTERVENE.md` | **不改**：Human 保留 reopen/require-human-review 最高权 |
| `D-011 方案 B 自动循环` | **互补**：D-011 是 Revise↔Review 的环内自动，D-013 是环结束后的 Human 终审分级；两者叠加使 T3/T4 追溯/回归类 Review 可以端到端无 Human 介入（除启动触发 + 必要时复议） |
| `D-012 单卡交付即提交` | **不冲突**：本 ADR 自身按 D-012 §3.5 元治理类 commit 规则提交 |

---

## 10. 落地动作（本次决策同步完成）

- [x] 创建本文件 `.team/decisions/D-013-review-scenario-tiering.md`
- [x] 更新 `.team/SOP-REVIEW-LOOP.md` v1.1 → v1.2（§1 约束 5 补充 · §4.1 补分支 · §9 触发指令补丁 · §11 关系表）
- [x] 创建 `.team/reviews/SPRINT-0-SKIP-REVIEW.md` 作为 D-013 首次落地案例
- [x] 为 Sprint-0 补审 7 张卡各写 `FINAL.md`（终止原因 = `SKIP-REVIEW-AUTOCLOSED`）
- [x] 更新 `.team/board.md` Sprint-0 补审 7 张从 Human-Review 列迁至 Done · 补审归档段
- [x] 更新 `.team/STATE` 清除 `approve-batch sprint-0-review` 待触发项
- [x] 更新 `.team/daily/2026-04-23.md` 追加 "Sprint-0 补审 skip-review 收口 · D-013 落地" 记录
- [ ] （延后）Orchestrator 后续每次 Review 闭环结束自动按 §7.1 分支处置，并在汇报中列 §7.2 聚合段

---

## 11. 反例（避免误用）

- ❌ 不允许因为 "AI-Review PASS 就行了" 而把 T1 准入 Review 降级到 T3
- ❌ 不允许在 G1~G5 闸门材料上套 T2 → T3 的降级（闸门决策必须 Human）
- ❌ 不允许自行扩展第 5 档（紧急豁免等）——若需扩展，另立 D-0xx
- ❌ 不允许在同一批 Review 中混用 T1 和 T3（例如一批 10 张卡里混着 Sprint-1 新卡 + Sprint-0 补审卡）——必须分批执行，按档分别走流程

---

## 12. 生效

- **立即对 Sprint-0 AI-Review 补审 7 张卡生效**（首次落地，见 `SPRINT-0-SKIP-REVIEW.md`）
- **自动对后续所有符合 T3/T4 特征的 Review 生效**
- **T1/T2 的 Review 行为完全不变**（保留 SOP-REVIEW-LOOP v1.1 原有的 Human 终审流程）

---

## 13. 签字

- **Human**：✅ 2026-04-23 21:08 对话指令"方案 B+C 可以的 执行吧"
- **Orchestrator**：已落盘 · 即刻生效 · 作为 SOP-REVIEW-LOOP 的衍生规约纳入每次 Review 调度

---

## 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 21:15 | Human 指令确认，Orchestrator 成文落盘 |

---

## 后续补丁

- **2026-04-24 19:16 · 方案 A 合并 SOP**：本决议关联的 `SOP-REVIEW-LOOP.md` + `SOP-REVIEW-AUTOLOOP.md` 已合并为 `SOP-REVIEW.md` v2.0。本决议对应 §1 约束 6 / §4.1 场景分级分流 / §9 `reopen-review` 等条款位置不变，只是从"SOP-REVIEW-LOOP"更名为"SOP-REVIEW"。
