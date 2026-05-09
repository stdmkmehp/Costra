# D-020 · D-016 同轮兑现铁律 · 升定稿规约

> **立案时间**：2026-04-24 19:10（v1.0 观察期）→ **2026-05-09（v2.0 定稿规约）**
> **升级依据**：D-019 §2.2 + COSTRA-106 Sprint-1 Retro 议题 B
> **升级决策**：Sprint-1 末 Retro · 路径 A（D-019 拍板）
> **生效日期**：**2026-05-09**（随本决议落盘生效）
> **替代**：D-016 v1.0（2026-04-24 ~ 2026-05-08 "观察期"标签废止）

---

## §1 立案背景

### §1.1 D-016 v1.0 回顾

D-016 于 2026-04-24 19:10 立案（I-005 触发），初始定位为"观察期规约"——

> **立案语义**：D-016 v1.0 立案时表述为"观察期"· 当时仅 1 次实战（COSTRA-101 §6.1.b R4）· 规约可信度待积累。

v1.0 条文核心：

- Orchestrator 声称"自动拉起 Review"后必须同轮兑现
- 严禁跨轮异步承诺（"60 秒内自动拉起 / 后台自动推进"）
- 违反即登记 Incident

### §1.2 12 次实战证据链（2026-04-24 ~ 2026-05-08）

| # | 卡号 | 时间 | 合规？ | 关键证据 |
|---|---|---|---|---|
| 1 | COSTRA-101 §6.1.b R4 | 2026-04-24 19:07~19:10 | ✅ | Orchestrator 同 tool call 循环内连贯完成 Backend Revise + Review-Tech 复审 + FINAL 追加 |
| 2 | COSTRA-118 Round-1 | 2026-04-24 19:30+ | ✅ | Orchestrator 同 tool call 循环内完成：立卡 dispatch + 7 维全量审查 + ~600 行报告 + STATE/board/metrics/follow-ups/messages 五处同步 |
| 3 | COSTRA-118 FINAL | 2026-04-27 09:39 | ✅ | Orchestrator 同 tool call 循环内完成 FINAL + metrics + STATE + board + follow-ups + messages 六处同步 |
| 4 | COSTRA-102 Card-Def | 2026-04-27 09:47 | ✅ | Orchestrator 同 tool call 循环内完成：dispatch + Tech Review + Product Review + STATE/board/metrics/messages 六处同步 |
| 5 | COSTRA-102 R1 | 2026-04-27 10:00 | ✅ | Orchestrator 同 tool call 循环内完成：R1 实装 + typecheck + vitest + Agent 响应 + Review × 2 + STATE/board/metrics/messages/follow-ups |
| 6 | COSTRA-115 | 2026-04-27 10:45 | ✅ | Orchestrator 同 tool call 循环内完成派单 + 10 产物 + 六闸 + Review · 全程 6 分钟 |
| 7 | COSTRA-116 | 2026-04-27 15:15 | ✅ | Orchestrator 同 tool call 循环内完成派单 + 7 文件实装 + 四闸 + Review · 派单→R1 7 分钟 |
| 8 | COSTRA-119 | 2026-04-28 20:28 | ✅ | Orchestrator 同 tool call 循环内完成派单（20:28） + R1（20:31） + Review（20:33） · AI 流水 9 分钟 |
| 9 | COSTRA-120 | 2026-04-28 14:22 | ✅ | Human 13:53 撞坑 → 14:00 立案 → Orchestrator 14:03 派单 → R1 14:xx · 同轮兑现 |
| 10 | COSTRA-121 | 2026-04-28 16:55 | ✅ | Orchestrator 同 tool call 循环内完成：D-017 Step 1~5 + Card-Def + Review-Tech + Review-Product |
| 11 | COSTRA-122 | 2026-04-28 20:14 | ✅ | Human 触发 → Orchestrator 同 tool call 循环内完成：R1 + 五闸 + 静态对账 + Review-Tech R1 + Review-Product R1 |
| 12 | COSTRA-125 Card-Review | 2026-05-03 20:32 | ✅ | Orchestrator 同 tool call 循环内完成：立卡 dispatch + 7 维全量审查 + ~500 行报告 |

**D-016 v1.0 实战统计**（2026-04-24 ~ 2026-05-08 · 14 天）：

- **总次数**：12 次
- **跨轮异步反模式**：**0 次**（I-005 之后无一再犯）
- **违规登记**：0
- **平均兑现速度**：~10 分钟 / 次（含 Review 产出）
- **最高效兑现**：COSTRA-119（AI 流水 9 分钟）

### §1.3 升定稿的必要性

**观察期废止三条件**（D-016 v1.0 立案时预设）：

| 条件 | 状态 |
|---|---|
| 实战次数 ≥ 10 | ✅ **12 次** |
| 0 跨轮异步反模式（I-005 后无一再犯）| ✅ **0 次** |
| 规约条文稳定性（无频繁修订）| ✅ **v1.0 条文未修订** |

**结论**：D-016 满足升定稿全部条件。

**升级必要性**：

1. "观察期"标签暗示规约"可能不稳定"· 影响 Human 对规约的信任度
2. D-019 §4.2 明确"Sprint-2 升定稿规约（议题 #19 子项）"· 已作 Human 决策承诺
3. 12 次实战已充分验证规约有效性 · 无需继续"观察"

---

## §2 定稿规约条文（D-020 正文）

### §2.1 条文（定稿版）

> **D-020 · Orchestrator "自动拉起 Review" 同轮兑现铁律（定稿规约）**
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

### §2.2 跨轮例外白名单（定稿版新增）

| 例外条件 | 触发条件 | 合规路径 |
|---|---|---|
| 物理时间约束 | 单轮 tool call 循环已达 50+ 次调用 | 降级至 §2.1 降级路径 |
| 上下文长度超限 | 上下文长度 > 模型单轮上限（~128K tokens）| 降级至 §2.1 降级路径 |
| Human 显式打断 | Human 发 `pause-review` / `stop` / `reopen-review` | 立即停 · 合规 |

### §2.3 违规处置（定稿版）

| 违规类型 | 处置 |
|---|---|
| 声称"自动拉起"但磁盘无对应 Review 报告 | 登记 I-xxx · 立即补救 · 同轮兑现 |
| STATE `MODE=auto-loop-in-progress` 但 tool call 循环已收尾 | 立即校正 · 不得保持假陈述 |
| board "⏳ 自动循环中" 存续但相关 Review 报告不存在 | 立即校正 · 不得保持假陈述 |
| "Orchestrator 下一轮自动 xxx" 跨轮既定事实表述 | 立即撤回表述 · 走 §2.1 降级路径 |

### §2.4 与 D-011 / D-013 / D-014 / D-018 的关系（定稿版补充）

D-020 是**执行层**铁律，**不替换** D-011 / D-014-a / D-014-b 三条**规约层**例外。

**关系矩阵**：

| 规约 | 定义场景 | D-020 如何约束 |
|---|---|---|
| D-011 方案 B（Review 环内 Revise↔Review 自动推进）| 前置 6 条满足 → 自动推进 | 每一次自动推进**必须同轮兑现** |
| D-014-a（卡定义 Review 首轮自动拉起）| 卡立案后 → Orchestrator 自动拉 Review | 卡定义落盘后**必须同轮**切 Review 角色 |
| D-014-b（产出 Review 首轮自动拉起）| 被审 Agent 交付 → 60s 内自动拉起 | "60s"语义**修订**为"同一 tool call 循环内" |
| D-018 SBAI（装扮/审查 subagent 自动拉起）| SBAI v1.1 Review 拉起 | D-020 同等约束（D-018 §3.5 附录已覆盖）|

**D-020 现已涵盖 D-011 自动循环的执行层**：

- D-011 定义"何时自动推进"· D-020 定义"如何兑现"
- 两者互补不冲突 · D-011 决策 + D-020 执行 = 完整自动化流水
- D-018 SBAI 落地后保持有效（装扮档 Review 拉起同理约束）

---

## §3 生效声明

**自 2026-05-09 起**：

- ✅ D-016 v1.0 "观察期"标签废止 → D-020 "定稿规约"生效
- ✅ D-016 v1.0 全文内容保留（仅升级标签 + 补充跨轮例外白名单）
- ✅ D-019 §4.2 Human 决策承诺兑现（Sprint-2 升定稿）
- ✅ 12 次实战零跨轮异步反模式记录入 metrics.json（sprint_1_summary 段）
- ✅ D-020 自身受 D-020 约束（D-020 同轮兑现 D-020 · 自指合规）

---

## §4 关联文档

- `.team/decisions/D-016-same-turn-review-autoloop.md`（v1.0 · 已归档）
- `.team/decisions/D-011-review-autoloop-plan-b.md`（环内自动推进）
- `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`（D-014-a / D-014-b）
- `.team/decisions/D-018-spawn-based-agent-isolation.md`（D-018 §3.5 附录）
- `.team/decisions/D-019-g4-sprint-1-closure.md`（Human 决策承诺来源）
- `.team/SOP-REVIEW.md §10.5`（执行约束继承 D-020）
- `.team/SOP-CARD-REVIEW.md`（卡定义 Review 继承 D-020）
- Incident I-005（v1.0 触发事件 · 登记于 STATE §Incident）

---

## §5 一句话总结

> **"说了自动拉起，就必须这一轮里真的拉起（定稿版）"** —— 12 次实战零反模式 · "观察期"标签废止 · 同轮兑现强制性升为铁律。
