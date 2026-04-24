# SOP · Review 自动闭环（方案 B · 默认启用）

> 登记时间：2026-04-23 19:45
> 登记人：Human（D-011 确认）+ Orchestrator 成文
> 适用范围：所有走 AI-Review 的卡（受 `SOP-REVIEW-LOOP.md` 管辖的卡）
> 优先级：**P0 · 铁律局部例外** · 与 `SOP-REVIEW-LOOP` 合并阅读 · 覆盖 `SOP-HUMAN-TRIGGER` 铁律在 Review 闭环内的 Revise↔Review 环节

---

## 1. 一句话规则

**Review-Agent 给出 `REVISE` 后，Orchestrator 直接拉起被审 Agent 改；被审 Agent 交完修复说明后，Orchestrator 直接拉起 Review-Agent 复审——无需 Human 逐轮触发，直到 PASS / 轮次到顶 / 分歧 / 红线 / Human 叫停。**

---

## 2. 启动条件（何时进入自动循环）

下列之一即进入：

- Human 首次发 `run review-tech COSTRA-xxx` 或 `run review-product COSTRA-xxx`
- 被审 Agent 首次产出后，Orchestrator 按 `SOP-REVIEW-LOOP §3 Step 2` 自动拉起 Review-Agent（仍然**是 Human 触发 Agent 产出**这一步进来的）

**⚠️ 不会**仅仅因为卡进了 Doing 就自动启动。**被审 Agent 的首次产出永远需要 Human 触发 `开干 COSTRA-xxx`。**

---

## 3. 状态机

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
      写 FINAL.md                  检查前置条件          │             │             │
      进 Human-Review              C1~C6（D-011 §2）    │             │             │
                                         │              │             │             │
                             全部满足 ──▶│              │             │             │
                                         ▼              ▼             ▼             ▼
                                   自动拉被审        写 incident    写 FINAL    写 FINAL
                                   Agent 改 round N+1  冒泡          冒泡         冒泡
                                         │
                                         ▼
                                 被审 Agent 产 response.md
                                         │
                                         ▼
                                 回到"Review-Agent 跑 round N"（N ← N+1）
```

---

## 4. 前置条件（D-011 §2 镜像 · 🆕 D-015 修订条款 4）

自动推进**必须**同时满足：

1. 有至少一轮 Review 报告
2. 最近 verdict == `REVISE`
3. round < 5
4. 🆕 **D-015**：被审 Agent 上一轮 response 中**若**对某 P0 意见反驳，则 **Review-Agent 必须在本轮中已明确驳回该反驳并要求 Agent 在本轮修复**（首次反驳**不中断**自动循环；Review-Agent 二次驳回 + Agent 本轮仍拒绝修复同一 P0 → 中断并 ESCALATE）
5. Human 未下达 `pause-review` / `skip-review` / `force-pass`
6. 未触发红线

任一不满足 → 自动循环终止 → 冒泡给 Human。

### 4.1 🆕 D-015 异议仲裁示例

| 轮次 | Agent 动作 | Review-Agent 动作 | 自动循环状态 |
|---|---|---|---|
| Round 1 | ❌ 反驳 P0-X（首次） | 下轮将裁决 | ✅ 继续 |
| Round 2 | 其余 P0/P1 已修 | ❌ 驳回反驳（overruled），要求 Round 2 response 中 Agent 修复 P0-X | ✅ 继续 |
| Round 2 | 若 Agent 未修复 P0-X 并再次反驳 | 自动触发 ESCALATE | ❌ 中断，冒泡 Human |
| Round 2 | 若 Agent 按裁决修复 P0-X | 正常审 | ✅ 继续 |


---

## 5. Orchestrator 的自动推进动作清单

每次 verdict=REVISE 时（前置满足），Orchestrator 必须依次做：

1. **读** 最新 `round-N-{tech|product}.md`，提取 P0/P1/P2
2. **判** 前置 §4，任一不满足 → 停并冒泡，**不**执行 3-7
3. **更新看板**：`AI-Review 迭代中` 行从 `round N/5` 改为 `round N+1/5 · 自动推进中`
4. **写消息** 到 `.team/messages/YYYY-MM-DD.jsonl`：`agent_handoff` 事件，注明"自动拉起 backend-fix"
5. **切角色** 执行 Backend-Fix / MiniApp-Fix / PM-Fix / Design-Fix，按 Review 报告逐条改
6. **产出** `round-N-{agent}-response.md`（必须说明每条 P0 采纳 or 反驳）
7. **自动拉** Review-Agent 跑 round N+1（回到 §3 状态机顶部）

**关键约束**：
- 每一个以上步骤都**必须留痕**（看板 / 消息 / 文件），Human 回看能完整重放
- Orchestrator 不得跳过 response.md 直接跑下一轮 Review
- Orchestrator 不得合并两个 round 的报告

---

## 6. Human 打断窗口

- Human 在任何对话轮中发送 §4 列出的打断指令 → Orchestrator **本轮立即停**
- 即使 Orchestrator 当前轮"计划"自动推进，只要 Human 在**同一对话回合**里表达了异议（对某 P0 反对、问某 P0 凭据、要求先做别的卡）→ **立即暂停，先响应 Human**

---

## 7. 汇报格式（Orchestrator MUST）

每次 Orchestrator 在自动循环内完成任何一步动作后，进度汇报必须包含：

```
## ⏳ Review 自动循环中（共 1 张）

| 卡号 | 当前 round | 上一 verdict | 下一步 | 可立即打断指令 |
|---|---|---|---|---|
| COSTRA-100 | 2/5 · 自动推进中 | Round-1 REVISE（3 P0） | Backend 改完后自动跑 Round-2 Review-Tech | `pause-review COSTRA-100` / `stop` |
```

缺失此段 = 违规，等同破铁律，记 incident。

---

## 8. 与其他 SOP 的优先级

| 冲突场景 | 胜出 SOP |
|---|---|
| Human 的 `pause-review` vs 自动推进 | Human 胜 |
| 红线触发 vs 自动推进 | 红线胜（立即停） |
| `SOP-REVIEW-LOOP` 5 轮上限 vs 自动推进 | 5 轮上限胜 |
| `SOP-HUMAN-TRIGGER` 铁律 vs 自动推进 | **在 Review 闭环内自动推进胜**（D-011 豁免）；**其他场景铁律胜** |

---

## 9. 度量 & 回退

见 D-011 §6、§7。Orchestrator 每张卡闭环结束写度量；出现回退信号主动提醒 Human。

---

## 10. 版本

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 | Human D-011 确认，Orchestrator 成文，即刻生效 |
| v1.1 | 2026-04-24 09:24 | D-015：§4 前置条件 4 改写（首次反驳不中断，Review-Agent 二裁驳回后 Agent 仍反驳才 ESCALATE）+ §4.1 新增异议仲裁示例表 |
