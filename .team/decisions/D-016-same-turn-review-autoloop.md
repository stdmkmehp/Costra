# D-016 · Orchestrator "自动拉起 Review" 同轮兑现铁律

> **立案时间**：2026-04-24 19:10
> **立案人**：Human（原文复述即批准）+ Orchestrator 成文
> **触发事件**：I-005（2026-04-24 17:59 声称 → 18:52 用户质疑 → 19:02 补救）
> **优先级**：**P0 · 铁律补丁** · 作为 D-011 / D-014-a / D-014-b 共同前置约束
> **生效范围**：所有涉及 Orchestrator 自动拉起 Review 的场景（D-011 环内 Revise↔Review · D-014-a 卡定义 Review 首轮自动拉起 · D-014-b 产出 Review 首轮自动拉起）

---

## 1. 背景 · I-005 复盘

### 1.1 事件时间线

| 时间 | 事件 |
|---|---|
| 2026-04-24 17:59 | Backend-Agent 完成 COSTRA-101 §6.1.b Round 3 Revise 三绿灯交付 |
| 17:59 末 | Orchestrator 在汇报段落声称："接下来 60s 内 D-014-b 自动拉起 Review-Tech R3 终裁" |
| 17:59 末 | **Orchestrator 本轮对话收尾**（给用户写总结 + todo 标 in_progress 即停） |
| 17:59~18:52 | 账面（STATE `MODE=auto-loop-in-progress` / board "⏳ D-014-b 自动拉起 Review-Tech R3 终裁中"）保持假陈述 · **磁盘上 `round-3-tech.md` 不存在** |
| 18:52 | Human 发："Review-Tech Round 3 真的被自动拉起来了吗" |
| 18:55~19:02 | Orchestrator 在同一轮对话内补救：切 Review-Tech 角色产出 `round-3-tech.md` + 校正 STATE/board/metrics/FINAL + 登记 I-005 |

### 1.2 根因

Orchestrator 把"**同轮连续切角色产出**"错当"**跨轮后台异步**"。物理事实：

- Orchestrator 无守护进程 / 无 cron / 无消息队列 / 无定时器
- 一次对话轮 = 一次 Human 消息触发的 tool call 循环
- 单轮 tool call 循环**收尾 = Orchestrator 下班**，必须 Human 重新触发下一轮
- "60 秒内自动拉起"这种描述暗含"跨轮后台唤起"语义 · **物理上做不到**

### 1.3 为什么是严重违规

1. 违反既有记忆铁律："禁用'今晚 18:00 Backend-Agent 将交付...'这种既定事实表述"
2. 让用户接收到与实际执行不符的信息 · 账面/磁盘漂移
3. D-011/D-014-a/D-014-b 三条自动化规约的"自动拉起"语义被事实性架空

---

## 2. 铁律条文（D-016 正文）

### 2.1 条文

> **D-016 · Orchestrator 自动拉起 Review 同轮兑现铁律**
>
> Orchestrator 在任何 Agent 产出（Revise / 首次交付 / 卡定义）后，**若声明**要自动拉起 Review（依据 D-011 环内 / D-014-a 卡定义首轮 / D-014-b 产出首轮三条例外之一），**必须**在**同一轮 tool call 循环内**连续切换到 Review-Agent 角色产出 Review 报告，并在同轮末给出**合并汇报**（Agent 交付段 + Review 审查段）。
>
> **严禁**本轮收尾后声称"下一轮自动执行 / 60 秒内自动拉起 / 后台自动推进"等跨轮异步表述。跨轮 = Human 必须重新触发 = 违反 `SOP-HUMAN-TRIGGER` Agent 触发铁律。
>
> 若本轮因时间 / tool 调用次数上限 / 上下文长度等客观限制**无法**完成 Review 同轮产出，**必须**：
> 1. 明说"本轮只完成 {Agent} 产出，Review 需你触发 `run review-{tech|product} COSTRA-xxx round-N`"
> 2. STATE `MODE` 设 `awaiting-human`（不得设 `auto-loop-in-progress` 等假陈述）
> 3. board "AI-Review 自动循环中" 段不得写"⏳ 自动拉起中" · 必须写"等 Human 触发 Review"
> 4. 不得承诺"跨轮自动"

### 2.2 正确执行姿态（示范）

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

### 2.3 错误执行姿态（禁止）

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

---

## 3. 与既有规约的关系

### 3.1 作用对象

D-016 是**执行层**铁律，**不替换** D-011 / D-014-a / D-014-b 三条**规约层**例外。三者是"要不要自动拉起"的决策，D-016 是"声称自动拉起后必须如何兑现"的实施约束。

| 规约 | 定义场景 | D-016 如何约束 |
|---|---|---|
| D-011 方案 B（Review 环内 Revise↔Review 自动推进） | 前置 6 条满足 → 自动推进 Revise↔Review | 每一次自动推进（无论 Revise→Review 还是 Review→Revise）**必须同轮兑现** |
| D-014-a（卡定义 Review 首轮自动拉起） | 卡立案后 → Orchestrator 自动拉 Review-Tech/Product | 卡定义落盘后**必须同轮**切 Review 角色产出首轮 Review |
| D-014-b（产出 Review 首轮自动拉起） | 被审 Agent 交付 → 60 秒内自动拉起 Review 首轮 | "60 秒"语义**修订**为"同一 tool call 循环内"·**不得**跨轮理解 |

### 3.2 优先级

| 冲突场景 | 胜出 |
|---|---|
| D-016 同轮兑现 vs D-011/D-014 自动拉起声明 | **D-016 胜**（不能同轮兑现 → 不得声称自动拉起 → 改走 Human 触发） |
| Human 打断指令（`pause-review` 等）vs D-016 同轮兑现 | Human 胜（本轮立即停） |
| 红线触发 vs D-016 同轮兑现 | 红线胜（本轮立即停 · 写 incident） |
| 时间 / tool 上限物理约束 vs D-016 同轮兑现 | 物理约束胜 · 必须走 §2.1 降级路径（明说 Review 需 Human 触发） |

---

## 4. 违规判定与处置

### 4.1 违规事实

出现以下任一情况即判违规（记 incident）：

- 汇报中出现"自动拉起中 / 60 秒内拉起 / 后台推进中"字样但磁盘无对应 Review 报告
- STATE `MODE=auto-loop-in-progress` 但 tool call 循环已收尾
- board "⏳ 自动循环中"段存续但相关 Review 报告不存在
- 任何"Orchestrator 下一轮自动 xxx"的跨轮既定事实表述

### 4.2 处置流程

1. Orchestrator 自检发现 or Human 质疑发现 → 立即在当轮补救
2. 补救优先级最高：**同轮兑现声称的动作**（如 I-005 补救产出 round-3-tech.md）
3. 同步校正 STATE / board / metrics 假陈述
4. 登记 Incident（I-xxx 编号）
5. 若是 D-016 立案后再犯 → 升级为 **ESCALATE** · Human 介入审查 Orchestrator 是否需要规约再强化

---

## 5. 度量

每次自动拉起动作，Orchestrator 必须在 metrics 记录：

```json
{
  "card": "COSTRA-xxx",
  "round": N,
  "auto_kickoff_claim": true,      // 是否声称自动拉起
  "auto_kickoff_delivered": true,  // 是否同轮兑现
  "auto_kickoff_type": "D-011|D-014-a|D-014-b",
  "d016_compliant": true           // 是否符合 D-016（claim && delivered）或（!claim）
}
```

若 `auto_kickoff_claim=true && auto_kickoff_delivered=false` → **自动登记 I-xxx incident**。

---

## 6. 版本与生效

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-24 19:10 | 立案 · I-005 触发 · Human 原文复述批准 · 即刻生效 |

**即刻生效**。自本文落盘起，所有 Orchestrator 自动拉起 Review 的动作受 D-016 约束。

---

## 7. 关联文档

- `.team/SOP-REVIEW.md §10.5`（2026-04-24 19:16 合并版 v2.0 · 原 `SOP-REVIEW-AUTOLOOP.md` v1.2 §11 条款已并入此处 · 旧文件保留为 stub）
- `.team/SOP-CARD-REVIEW.md`（D-014-a 执行约束继承 D-016）
- `.team/decisions/D-011-review-autoloop-plan-b.md`（环内自动推进）
- `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`（D-014-a / D-014-b 原规约）
- `.team/decisions/D-015-unify-respond-revise.md`（异议仲裁）
- Incident I-005（本 D-016 的触发事件 · 登记于 STATE §Incident）

---

## 8. 一句话总结

> **"说了自动拉起，就必须这一轮里真的拉起"** —— 不能拉就别说，说了就别赖。
