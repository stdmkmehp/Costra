# `.team/reviews/` — Review 闭环产物目录

> 由 Orchestrator 自动维护；Review-Agent-Tech / Review-Agent-Product 在此目录下产出报告。

## 结构约定

每张进入 Review 闭环的卡片对应一个子目录：

```
.team/reviews/COSTRA-XXX/
├── round-1-tech.md              # Review-Tech 第 1 轮报告（Backend/MiniApp 产出）
├── round-1-product.md           # Review-Product 第 1 轮报告（PM/Design 产出）
│                                # 同一张卡只可能存在其中一种
├── round-1-{agent}-response.md  # 被审 Agent 的修复说明（agent ∈ backend/miniapp/pm/design）
├── round-2-tech.md              # ...第 2 轮
├── round-2-{agent}-response.md
├── ...
├── round-5-...                  # 最多 5 轮（SOP-REVIEW-LOOP §4.2）
└── FINAL.md                     # 闭环最终结论（Orchestrator 写）
```

## 规则速查

| 想知道 | 去读 |
|---|---|
| Tech Review 如何打分 | `.team/agents/07-review-agent-tech.md` §3 |
| Product Review 如何打分 | `.team/agents/08-review-agent-product.md` §3 |
| 什么时候停迭代 | `.team/SOP-REVIEW-LOOP.md` §4 |
| 触发指令有哪些 | `.team/SOP-HUMAN-TRIGGER.md` §3 或 `SOP-REVIEW-LOOP.md` §9 |
| 哪些卡**不走** AI-Review | `.team/SOP-REVIEW-LOOP.md` §2 |

## Verdict 图例

| Verdict | 含义 | 下一步 |
|---|---|---|
| ✅ PASS | 全绿，可进 Human-Review | Orchestrator 推到 Human-Review 列 |
| 🟢 PASS-WITH-FOLLOWUP | 通过但有 P1 未修 | 推 Human-Review + 登记 P1 进下 Sprint backlog |
| 🟡 REVISE | 有 P0 但可修 | 拉被审 Agent 做下一轮（round + 1） |
| 🔴 REJECT | 红线违规或 P0 过多 | 打回重做（round 重置），记 incident |
| ⚠️ ESCALATE | 分歧/低置信度 | 停迭代，冒泡 Human |

## 目录权限

- 只有 `Review-Agent-Tech` 可以写 `round-N-tech.md`
- 只有 `Review-Agent-Product` 可以写 `round-N-product.md`
- 只有对应被审 Agent 可以写 `round-N-{agent}-response.md`
- 只有 `Orchestrator` 可以写 `FINAL.md`
- 任何人（含 Human）不得删除已存在的报告（审计需要）

## 度量

每次闭环结束，Orchestrator 在 `.team/metrics.json` 追加记录（字段见 `SOP-REVIEW-LOOP.md` §10），每周五汇总到 `.team/weekly/review-metrics.md`。
