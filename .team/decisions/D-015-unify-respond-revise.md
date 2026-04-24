# D-015 · 合并 respond-round-N 与 revise-round-N 为统一"回执+修复"动作

- **状态**：Accepted
- **决策日期**：2026-04-24 09:24
- **决策人**：Human（"revise-round-1 和 respond-round-1 合并，不再做区分，功能都是改代码+回执，允许 agent 对某些 issue 有异议，并在回执内提出异议，但如果异议被 review-agent 拒绝后仍然要以 review-agent 的意见为主。"）
- **落地人**：Orchestrator
- **优先级**：🟠 P1 · 规约简化（流程语义统一，消除双触发词歧义）
- **影响范围**：Orchestrator 调度、所有被审 Agent（Backend/MiniApp/PM/Design）、SOP-REVIEW-LOOP、SOP-REVIEW-AUTOLOOP、Human 触发词典
- **关联决策**：D-011（方案 B 环内自动）、D-013（Review 场景分级）、D-014（环首自动拉起）

---

## 1. 背景

在 D-011 方案 B 自动循环上线后，Orchestrator 内部曾区分两个触发动作：

- `run {agent} COSTRA-xxx respond-round-N` — **只回执，不改代码**（Agent 对 Review 意见表态，存疑或反驳）
- `run {agent} COSTRA-xxx revise-round-N` — **改代码+附轻量回执**（Agent 认可后修复并提交）

COSTRA-101 Round 1 交付后，Human 询问两者区别时首次暴露这一分裂。复盘发现：

### 1.1 双触发词的结构性问题

| 问题 | 描述 |
|---|---|
| **P0 · 流程割裂** | Agent "异议表态" 与 "代码修复" 是同一思考过程的两面，强行拆成两个命令字，让"有争议就先别改"成了默认选项，拖慢节奏 |
| **P1 · 决策成本转嫁 Human** | Human 需要在 Round N 前预判"该让 Agent 先表态还是直接改"——这本应由 Agent 自行判断 |
| **P1 · 仲裁链路歧义** | `respond-only` 模式下如果 Orchestrator 后续不明确仲裁，Agent 就会卡在"表态完了但没改"的悬停态 |
| **P2 · 触发词膨胀** | 每多一组平行触发词，Human 记忆负担 × N；D-011/D-013/D-014 已经引入 12+ 触发词，继续膨胀不可持续 |
| **P2 · 和 D-011 语义冲突** | D-011 自动循环前置条件 4 规定"上轮 response 没有对 P0 级意见反驳"，但 `respond-only` 模式天然会产出"未修复的 P0 反驳"，等于把 Agent 推出自动循环，与 D-011 自动化哲学矛盾 |

### 1.2 根因

原设计把"是否接受 Review 意见"这个**态度层**决策，错误地放在了**触发词层**。正确的分层应该是：

- **触发词层**（Human 发）：只管"让 Agent 动工响应 Round N"
- **Agent 产出层**（Agent 写）：在回执 + 修复中自行表达"接受/部分接受/反驳"
- **仲裁层**（Review-Agent + 必要时 Human）：对 Agent 的异议做二次裁决

---

## 2. 决策

### 2.1 合并为单一触发词

**`respond-round-N` 从触发词词典中删除。`revise-round-N` 作为唯一规范词保留，并且语义扩容为"回执 + 修复 + 可表达异议"。**

合并后的完整语义：

```
run {agent} COSTRA-xxx revise-round-N
```

Agent 收到此触发后，**必须在同一轮内完成以下 3 件事**：

1. **读** 最新 Review 报告 `round-N-{tech|product}.md`
2. **逐条表态**（在 `round-N-{agent}-response.md` 中）：
   - ✅ **采纳** — 已改，给出 diff 指针
   - ❌ **反驳** — 提出异议，必须引用文档/ADR/证据作为反驳依据（不接受"我觉得"）
   - ⏸ **部分采纳** — 本轮改一部分，其余延后（须说明延后理由和预计补齐的 Round N+M）
3. **对所有"采纳"和"部分采纳"的条目，当轮落盘代码修复并 commit**（D-012 单卡交付即提交）

**关键：允许 Agent 提出异议，但必须在"异议 + 实际修复"同时发生的前提下。**

### 2.2 异议的仲裁规则（核心补丁）

Agent 在 `round-N-{agent}-response.md` 中对任何条目表态 `❌ 反驳` 时，Orchestrator 按下列链路仲裁：

```
Round N Agent 反驳 ─┐
                    │
                    ▼
            Round N+1 Review-Agent 再审时必看
                    │
                    ├─► Review-Agent 认可反驳 → 该 issue 在 Round N+1 报告中标记为 "withdrawn"（撤回）
                    │
                    └─► Review-Agent 拒绝反驳 → 该 issue 在 Round N+1 报告中明确回复"驳回异议 · 维持原意见"
                            │
                            ▼
                        Agent 在 Round N+1 revise 中 MUST 修复（不得二次反驳）
                            │
                            ▼
                        若 Agent 在 Round N+1 仍对同一 P0 反驳 → 触发 SOP-REVIEW-LOOP §4.3 分歧升级 → 冒泡 Human
```

### 2.3 "最终以 Review-Agent 意见为主" 铁律

Human 指令原文：**"如果异议被 review-agent 拒绝后仍然要以 review-agent 的意见为主。"**

落地为强约束：

- **Agent 对同一 P0 条目的有效反驳次数 = 1 次**（只能在首次被提出的那一轮反驳一次）
- **Review-Agent 在下一轮明确驳回后**，Agent 在再下一轮 revise 中 **MUST** 执行修复
- Agent 在下一轮仍反驳同一 P0 → **自动触发 ESCALATE**（SOP-REVIEW-LOOP §4.3），冒泡 Human
- Review-Agent 的驳回理由必须写在 `round-N+1-{tech|product}.md` 的 "对 Round N 异议的回复" 段，留痕可审计

### 2.4 对 D-011 自动循环的影响

D-011 `SOP-REVIEW-AUTOLOOP.md §4` 前置条件 4 原文：

> **被审 Agent 上一轮 response 没有对 P0 级意见反驳**

**D-015 后修订为**：

> **被审 Agent 上一轮 response 中若对某 P0 意见反驳，Review-Agent 在本轮中已明确驳回该反驳**
> （换言之：首次反驳不中断自动循环；Review-Agent 驳回 + Agent 再次反驳同一 P0 才中断）

这让"允许异议"与"自动循环"共存：Agent 可以反驳，但反驳不自动升级为分歧；分歧必须由 Review-Agent 二次裁决后才冒泡 Human。

---

## 3. 触发词词典变更

### 3.1 废弃

| 指令 | 处理 |
|---|---|
| `run {agent} COSTRA-xxx respond-round-N` | **废弃**。即刻起从词典删除，Orchestrator 收到此指令 → 自动映射为 `revise-round-N` 并向 Human 提示"已按 D-015 合并语义执行修复+回执" |

### 3.2 保留（语义扩容）

| 指令 | 语义（D-015 后） |
|---|---|
| `run {agent} COSTRA-xxx revise-round-N` | 回执 + 修复，可在回执中表达异议。异议遵循 §2.2/2.3 仲裁规则 |

### 3.3 不变

所有其他触发词（`pause-review` / `force-pass` / `skip-review` / `run review-{tech\|product}` / `review-card` / `skip-card-review` / `force-card-pass` 等）**完全不变**。

---

## 4. Agent response 产物模板更新（替换 SOP-REVIEW-LOOP §6）

```markdown
# {Agent} Revision Response · COSTRA-XXX · Round N

## 对 Round-N Review 的回应

### P0-1 {Review 标题}
- **采纳 / 反驳 / 部分采纳**：✅ 采纳 | ❌ 反驳 | ⏸ 部分采纳
- **修改位置**：`apps/api/src/xxx.ts:45-52`（diff 见 commit `abc123`）
- **修改说明**：<简述改动>
- （若反驳）**反驳依据**：引用文档/ADR/证据（不接受"我觉得"）
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

---

## 5. Review-Agent Round N+1 报告追加段

Review-Agent 在 Round N+1 的 `round-N+1-{tech|product}.md` 中 **必须** 追加段：

```markdown
## 对 Round N 异议的裁决

### 对 P0-X 异议（Agent 反驳依据：...）
- **裁决**：✅ 撤回 `withdrawn` | ❌ 驳回 `overruled`
- **理由**：<理由>
- （若驳回）**Agent 在 Round N+1 本轮 response 中 MUST 修复此项**
```

缺失此段 → Orchestrator 视为 Review-Agent 规约违规，记 `.team/incidents/`。

---

## 6. Orchestrator 调度变更

### 6.1 新增 MUST

- **MUST** 在收到 `respond-round-N` 指令时，自动映射为 `revise-round-N` 并向 Human 明确提示"已按 D-015 合并"
- **MUST** 在 `revise-round-N` 执行时，检查 response.md 是否含"反驳"条目 → 若有，在下一轮拉 Review-Agent 时注入"请特别裁决异议"上下文
- **MUST** 在 Review-Agent Round N+1 报告中校验"对 Round N 异议的裁决"段存在性
- **MUST** 在发现 Agent 对同一 P0 二次反驳时 → 立即 ESCALATE，不等轮次到顶

### 6.2 新增 MUST NOT

- **MUST NOT** 再使用"只回执不修"的触发分支（废除）
- **MUST NOT** 在 Agent 首次反驳后直接冒泡 Human（必须先让 Review-Agent 二裁）

---

## 7. 与既有 SOP 的关系

| SOP | 关系 |
|---|---|
| `SOP-REVIEW-LOOP.md` v1.3 → v1.4 | §6 回应格式模板替换为 D-015 §4；§9 触发指令表删除 `respond-round-N` 相关行；§11 关系表追加 D-015 |
| `SOP-REVIEW-AUTOLOOP.md` v1.0 → v1.1 | §4 前置条件 4 改写为 D-015 §2.4 版本 |
| `SOP-HUMAN-TRIGGER.md` | 触发词词典删除 `respond-round-N`（若已登记） |
| `D-011 方案 B 自动循环` | 叠加：D-015 让 Agent 异议不中断自动循环，缓冲层落在 Review-Agent 二裁 |
| `D-012 单卡交付即提交` | 叠加：D-015 §2.1 明确 revise 动作必须当轮 commit |
| `D-013 Review 场景分级` | 正交：不改 Human 终审分档 |
| `D-014 环首自动拉起` | 正交：不改 Review 启动时机 |

---

## 8. 对 COSTRA-101 Round 1 的立即影响

- Backend-Agent 下一次触发 = `run backend COSTRA-101 revise-round-1`（唯一合法形式）
- 若 Backend 对 P1-3（seed 幂等性）有异议 → 在 response.md 中按 §4 模板标注 `❌ 反驳` + 反驳依据 + 当轮**仍然提交**其他 5 条修复
- Review-Tech Round 2 会对 P1-3 异议给出裁决
- 若 Round 2 Review-Tech 驳回反驳 → Backend 在 Round 3 MUST 修复 seed 幂等，不得二次反驳

---

## 9. 落地动作（与本次 commit 同步）

- [x] 创建本决策文件 `.team/decisions/D-015-unify-respond-revise.md`
- [x] 更新 `.team/SOP-REVIEW-LOOP.md` v1.3 → v1.4
- [x] 更新 `.team/SOP-REVIEW-AUTOLOOP.md` v1.0 → v1.1
- [x] 新建 `.team/daily/2026-04-24.md` 记录本变更
- [x] 更新 `.team/STATE.md` / `.team/board.md`（触发指令清单）
- [x] 更新 Memory 90067452（补 D-015 合并语义）

---

## 10. 生效

- **即刻生效**（2026-04-24 09:24 之后的所有 Review 轮次）
- **向前兼容**：已存在的 `round-N-{agent}-response.md`（D-015 前产出）不溯及既往，但下一轮（Round N+1）开始必须按 D-015 §4 新模板写
- **Human 打断最高优先级不变**：`pause-review` / `stop` / `force-pass` 随时可用

---

## 11. 签字

- **Human**：✅ 2026-04-24 09:24 "revise-round-1 和 respond-round-1 合并，不再做区分"
- **Orchestrator**：已落盘 · 即刻生效 · 本 commit 按 D-012 元治理类规则提交

---

## 12. 后续补丁

- **2026-04-24 19:16 · 方案 A 合并 SOP**：本决议涉及的 `SOP-REVIEW-LOOP.md` + `SOP-REVIEW-AUTOLOOP.md` 已合并为 `SOP-REVIEW.md` v2.0 单一文件。本决议 §4（回应格式模板）对应新文件 §6；§3（前置条件 4 修订）对应新文件 §10.3。原两份降为 stub 保留外链兼容。

---

## 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-24 09:24 | Human 指令确立 · Orchestrator 成文落盘 |
