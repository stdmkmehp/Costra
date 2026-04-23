# D-011 · Review 闭环自动推进策略（方案 B · 默认）

- 日期：2026-04-23 19:45
- 决策人：Human
- 记录人：Orchestrator
- 适用范围：**所有走 AI-Review 的卡**（Backend / MiniApp 产出 → Review-Tech；PM / Design 产出 → Review-Product）
- 与既有 SOP 关系：对 `SOP-HUMAN-TRIGGER`（铁律）在 **Review 闭环这一局部环节**做**定向豁免**；其他所有流程（被审 Agent 的**首次**产出 / 跨卡并行 / approve / 决策）**铁律照旧，需 Human 触发**

---

## 1. 决策

采用**方案 B · 半自动**：**Review 闭环内部**在满足明确前置条件时**自动推进 Revise ↔ Review 循环**，无需 Human 每轮敲指令；Human 保留**随时叫停 / 强制通过 / 强制升级**的最高权。

> **注意**：本决议**只豁免"Review 闭环内 Revise↔Review 的相互拉起"这一件事**。其他任何 Agent 动作（包括被审 Agent 的**首次**产出、Human-Review 的 approve、其余卡的 `开干`）**仍然需要 Human 主动触发**，Memory 90067452 的铁律对这些环节继续有效。

---

## 2. 自动推进的前置条件（同时满足才自动跑）

| # | 条件 | 说明 |
|---|---|---|
| C1 | 该卡已进入 Review 闭环 | 即已有至少一份 `.team/reviews/COSTRA-xxx/round-1-*.md` |
| C2 | 最近一份 Review 的 verdict ∈ {`REVISE`} | `PASS` / `PASS-WITH-FOLLOWUP` / `REJECT` / `ESCALATE` **不自动** |
| C3 | 当前 round < 5 | 达 5 必停，进 ROUND-LIMIT 升级 |
| C4 | 上一轮被审 Agent 未在 response 中明确对 ≥1 个 P0 "反驳" | 有反驳 → 自动进入 ESCALATE（停，等 Human） |
| C5 | Human 未在当前轮对该卡下达 `pause-review` / `skip-review` / `force-pass` | 任何一条都立即退出自动循环 |
| C6 | 未触发红线（硬编码 secret / 目录越权 / Won't-Have / 主体字样） | 红线一律冒泡，不走自动 |

**任一条件不满足 → 自动循环终止 → 冒泡给 Human 决定。**

---

## 3. 自动推进的断点（每次暂停 30 秒等 Human 打断）

为避免 Human 完全失去观察窗口，**每切换一次角色** Orchestrator **必须**：

1. 在进度汇报中醒目列出"⏳ 自动循环进行中：COSTRA-xxx · round N → N+1 · 下一步 {action}"
2. 明确给出**可立即打断的指令**：`pause-review COSTRA-xxx` / `stop`
3. 若 Human 在当前对话轮**显式**发送任何 review 相关指令（见 §4）→ 立即按 Human 意图执行，取消本轮自动动作

> **Orchestrator 不能真正睡 30 秒**（没有常驻进程）——本约定的实际含义是：**任何一次 Human 对话回合，Orchestrator 都必须把"是否继续自动推进"的选择权显式交还 Human 一次**；Human 若不发异议（继续用"继续""go"或完全不提 review 相关指令），则视为默许继续。

---

## 4. Human 的打断指令（优先级最高，可覆盖自动）

| Human 说 | 效果 |
|---|---|
| `pause-review COSTRA-xxx` | 立即停该卡自动循环，冒泡 |
| `stop` | 立即停**当前轮**一切自动动作 |
| `force-pass COSTRA-xxx` | 跳过剩余轮次，直接标 AI-Review 通过，进 Human-Review |
| `skip-review COSTRA-xxx` | 直接跳过 Review-Agent，不再迭代 |
| `run backend-fix COSTRA-xxx` / `run review-tech COSTRA-xxx` | 手动触发单步，当前轮的自动动作让位给手动 |
| 其它任何 review 相关反馈（比如对具体 P0 的异议） | Orchestrator **必须**暂停自动，先响应 Human 的实质反馈 |

---

## 5. 终止与冒泡矩阵

| 结局 | 触发条件 | Orchestrator 动作 |
|---|---|---|
| **自然通过** | verdict = `PASS` 或 `PASS-WITH-FOLLOWUP` | 写 `FINAL.md` · 移入 Human-Review · 告知 Human approve 指令 |
| **轮次到顶** | round == 5 且未通过 | 写 `FINAL.md`（ROUND-LIMIT）· 冒泡 · 附 5 轮摘要 + 残余 P0 |
| **分歧升级** | verdict = `ESCALATE` 或 Agent 反驳 P0 | 写 `FINAL.md`（ESCALATE）· 冒泡 · 附反驳依据 |
| **红线触发** | verdict = `REJECT` + 红线命中 | 立即停 · 写 incident · 冒泡 |
| **Human 叫停** | `pause-review` / `stop` | 停在当前 round · 等 Human |

---

## 6. 度量（进 `.team/metrics.json`）

在原度量字段基础上新增：

```json
{
  "autoloop_enabled": true,
  "autoloop_rounds_run": 3,
  "autoloop_interrupted_by_human": false,
  "autoloop_interrupt_reason": null
}
```

每周聚合观察：**自动循环的平均收敛轮次**、**Human 打断率**、**ESCALATE 率**——用于决定是否要回退到方案 C。

---

## 7. 生效范围与回退条件

### 7.1 生效
- **立即对 COSTRA-100 生效**（首个试点）
- **自动对后续所有走 AI-Review 的卡生效**（Human 已确认"后续都按方案 B"）

### 7.2 触发回退的信号（任一发生，Orchestrator 必须提醒 Human 是否回退到方案 C）
- Human 在同一张卡**连续 2 轮使用** `pause-review` / `stop` / `force-pass`
- Review-Agent **连续 3 张卡** ROUND-LIMIT 未收敛
- 自动循环产生**已记录的方向漂移**事故（写入 `.team/incidents/`）

回退由 Human 拍板，Orchestrator 不自行决定。

---

## 8. 铁律更新摘要

Memory 90067452（SOP-HUMAN-TRIGGER 铁律）被本决议**局部修订**：

> **新增例外**：Review 闭环内的 `Revise ↔ Review` 相互拉起无需 Human 逐轮触发，受 §2 前置条件与 §4 打断指令双重约束。
>
> **其他所有 Agent 触发点仍遵守铁律不变**——特别是：
> - 被审 Agent 的**首次**产出（`开干 COSTRA-xxx`）仍需 Human 触发
> - Human-Review 的 approve / reject 仍需 Human
> - 非 Review 闭环的跨卡编排 / 切 sprint / 发布决策仍需 Human

---

## 9. 签字

- Human：✅（2026-04-23 19:43 对话指令确认：选 B，对 COSTRA-100 试一次，且后续都按方案 B，其他流程不变）
- Orchestrator：已落盘 · 即刻生效
