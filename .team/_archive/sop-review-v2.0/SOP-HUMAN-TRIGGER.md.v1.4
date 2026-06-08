# SOP · Human 触发协议（强制）

> 登记时间：2026-04-23 17:33
> 登记人：Human（直接指令）
> 适用范围：Orchestrator 及其下所有 Agent 角色
> 优先级：**P0 · 铁律** · 覆盖 SOP-OBSERVE-AND-INTERVENE 中任何冲突条款

---

## 1. 背景澄清（对齐认知）

Costra 项目的"多 Agent 协作"**不是**后台常驻进程：

- 没有任何 Agent 在用户未对话时自动执行
- 所有"Agent 交付"本质上是 Orchestrator 在收到用户消息后、以对应角色身份执行一轮产出
- 看板上的 `Doing` 状态只代表"已分配 + 随时可执行"，**不代表"正在跑"**
- 截止时间（deadline）是**目标**，不是**已排进队列的定时任务**

---

## 2. 铁律（MUST）

### 2.1 进度汇报必须显式列出"待触发清单"

当用户出现以下意图之一时：

- 询问项目进度（"进度如何""怎么样了""到哪了"）
- 询问下一步（"接下来做什么""还要我做什么"）
- 询问是否需要推动（"需要我推动吗""有什么要推进的"）
- 询问某 Agent 状态（"Backend 在干嘛""PM 有动吗"）

**Orchestrator 必须**在回复**开头**（不是底部、不是附录）给出：

```
## ⚠️ 等你触发的 Agent 任务（共 N 张）

| 优先级 | 卡号 | Agent | 触发指令（可直接复制） | 预计耗时 | 阻塞谁 |
|---|---|---|---|---|---|
| 🔴 P0 | COSTRA-xxx | Backend | 开干 COSTRA-xxx | 30min | COSTRA-yyy/zzz |
| ...
```

### 2.2 禁止把计划表述成既定事实

- ❌ 禁止："今晚 18:00 Backend-Agent 交付 COSTRA-100"
- ❌ 禁止："明早 DevOps 会完成..."
- ❌ 禁止："正在推进中" / "进行中"（除非真的刚在本轮执行）
- ✅ 允许："COSTRA-100 **待你触发**，触发后 30 分钟可交付"
- ✅ 允许："看板状态 Doing = 待执行；你发 `开干 COSTRA-100` 即启动"

### 2.3 Deadline 窗口过半仍未触发 → 红色预警

若看板某卡 deadline 剩余时间 < 50% 且未被触发执行，Orchestrator **必须**在进度汇报中以 🔴 标注"**未启动**，将滑期"，并给出：

- 触发指令
- 不触发的滑期后果（影响哪些下游卡）
- 是否要顺延 deadline 的建议

### 2.4 汇报末尾必须复述一次触发入口

每次进度汇报的**最后一段**必须出现类似：

> **一句话触发**：回复 `开干 COSTRA-100` 我立刻以 Backend-Agent 身份执行；回复 `全跑` 我按依赖顺序批量执行今日所有可启动卡。

---

## 3. 触发指令词典（标准化）

| 用户说 | Orchestrator 行为 |
|---|---|
| `开干 COSTRA-xxx` / `run COSTRA-xxx` | 切换到对应 Owner Agent，执行该卡交付 |
| `开干 <Agent 名>` / `run backend` | 执行该 Agent 当前 Doing 列中所有卡 |
| `全跑` / `run all` | 按依赖拓扑顺序执行所有可启动的 Doing 卡 |
| `next` / `下一步` | 执行依赖链上最关键的一张卡 |
| `stop` / `停` | 立刻停止当前执行，不继续下一张 |
| `approve:COSTRA-xxx` | 标记该卡 Review 通过，推到 Done |
| `reject:COSTRA-xxx 原因` | 打回 Doing，附修改意见 |
| `run review-tech COSTRA-xxx` | 拉 Review-Agent-Tech 对该卡跑一轮预审 |
| `run review-product COSTRA-xxx` | 拉 Review-Agent-Product 对该卡跑一轮预审 |
| `run <agent>-fix COSTRA-xxx` | ⚠️ 保留但不推荐；等价于 `revise-round-<当前 round>`（仅 Review 迭代中） |
| 🆕 `run <agent> COSTRA-xxx revise-round-N` | （D-015 · 2026-04-24 09:24）拉被审 Agent 做**回执 + 修复**第 N 轮（可含异议；异议按 `SOP-REVIEW.md §6.1` 仲裁链路处理） |
| ~~`run <agent> COSTRA-xxx respond-round-N`~~ | ❌ **D-015 已废弃**（2026-04-24 09:24）· 收到时自动映射为 `revise-round-N` 并提示 Human |
| `pause-review COSTRA-xxx` | 立即停止该卡的 Review 迭代，冒泡给 Human |
| `skip-review COSTRA-xxx` | 跳过 Review 闭环直推 Human 终审（慎用，记 daily） |
| `force-pass COSTRA-xxx` | Human 强制通过（覆盖 Review-Agent 的 REJECT） |
| 🆕 `review-card COSTRA-xxx` | （D-014）对某卡强制做一次**卡定义 Review**（历史卡补审用） |
| 🆕 `skip-card-review COSTRA-xxx` | （D-014）跳过卡定义 Review，直接进 Todo（需原因，记 daily） |
| 🆕 `force-card-pass COSTRA-xxx` | （D-014）Human 强制通过卡定义 Review（覆盖 Review-Agent） |
| 🆕 `verify <agent> COSTRA-xxx` | **分段交付配套触发词**（COSTRA-101 引入 · 2026-04-23 22:45）· 对分段交付（§a 设计 + §b 实跑）的 §b 段执行实跑验证：Orchestrator 以被审 Agent 身份执行 `npm install` / `tsc --noEmit` / `vitest run` / `curl /healthz` 等运行时断言，输出实跑日志。**使用前置**：§a 段 Review 链全绿 + Human 对设计满意 |
| 🆕 `skip-verify COSTRA-xxx` | 跳过分段交付的 §b 段实跑验证，直接认可（不推荐，会留运行时盲点，需 Human 原因记 daily） |

> Review 闭环完整规则见 [`.team/SOP-REVIEW.md`](./SOP-REVIEW.md)（2026-04-24 合并版 v2.0 · 原 `SOP-REVIEW-LOOP.md` + `SOP-REVIEW-AUTOLOOP.md` 已合并入此，两份 stub 保留仅作外链兼容）。
> **🆕 Review 闭环自动循环规则见 [`.team/SOP-REVIEW.md §10`](./SOP-REVIEW.md)**（D-011 · 2026-04-23 生效 · D-016 同轮兑现 · 2026-04-24 19:10）。
> **🆕 卡定义 Review 完整规则见 [`.team/SOP-CARD-REVIEW.md`](./SOP-CARD-REVIEW.md)**（D-014 · 2026-04-23 22:26 生效）。
>
> **铁律局部豁免声明**：
> - **例外 1（D-011 · 2026-04-23 19:45）**：Review 闭环内的 `Revise↔Review` 相互拉起**无需 Human 逐轮触发**（详见 D-011 §1）。
> - **🆕 例外 2（D-014-a · 2026-04-23 22:26）**：**新卡创建后的卡定义 Review 首轮启动**由 Orchestrator 自动拉起（技术向 → Review-Tech / 产品向 → Review-Product），**无需 Human 触发**。详见 `SOP-CARD-REVIEW.md`。
> - **🆕 例外 3（D-014-b · 2026-04-23 22:26）**：**被审 Agent 交付后的产出 Review 首轮启动**由 Orchestrator 自动拉起，**无需 Human 触发**。
>
> 其他任何 Agent 触发点（**被审 Agent 首次开干**、Human-Review approve、跨卡编排、发布决策、红线处置）**仍然需要 Human 触发，铁律不变**。
> Human 打断指令（`pause-review` / `skip-review` / `skip-card-review` / `force-pass` / `force-card-pass` / `stop`）**最高优先级**，可随时打断上述 3 条自动例外。

---

## 4. 例外与禁用场景

- **不适用**：纯事实查询（"当前 Sprint 是第几个""G3 什么时候通过的"）——直接回答，不必强塞触发清单
- **不适用**：决策类对话（"主体要不要用公司""域名选哪个"）——决议流程照走 D-xxx
- **强制适用**：任何进度/状态/健康度/风险类询问

---

## 5. 违规追溯

若 Orchestrator 违反本 SOP（例如再次把"今晚 Agent 会交付"写成既定事实而未列触发清单），Human 有权：

1. 直接指出并要求立刻重发合规汇报
2. 记入 `.team/incidents/` 作为流程缺陷追踪

---

**本 SOP 由 Human 于 2026-04-23 17:32 指令确立，Orchestrator 即刻生效。**

**修订**：
- 2026-04-23 19:45 · D-011 局部豁免 Review 闭环内的 Revise↔Review 自动推进（其他环节铁律不变）。
- 2026-04-23 22:26 · **D-014 追加两条豁免**：(a) 新卡卡定义 Review 首轮自动拉起；(b) 被审 Agent 交付后产出 Review 首轮自动拉起。其他所有触发点铁律不变。Human 打断指令（`pause-review` / `skip-card-review` / `stop` 等）最高优先级。
- 2026-04-24 09:24 · **D-015 触发词词典简化**：`respond-round-N` 废弃；`revise-round-N` 统一承担"回执+修复+可表达异议"三合一语义；异议仲裁链路由 Review-Agent 在 Round N+1 二次裁决，驳回后 Agent MUST 修复不得二次反驳。详见 `SOP-REVIEW.md §6.1` + `D-015`。
- 2026-04-24 11:50 · **P2-2 补丁（COSTRA-101 Round 1 Revise）**：§3 词典新增 `verify <agent> COSTRA-xxx` / `skip-verify COSTRA-xxx` 分段交付配套触发词，并显式落盘 `revise-round-N` / 废弃 `respond-round-N`（D-015 原仅在 SOP-REVIEW 登记，本 SOP 为主权入口需同步）。
- 2026-04-24 19:16 · **方案 A 合并 SOP**：`SOP-REVIEW-LOOP.md` + `SOP-REVIEW-AUTOLOOP.md` 合并为 `SOP-REVIEW.md` v2.0（单点 Review 规约入口）。本文件所有对旧两份的引用均改为指向 `SOP-REVIEW.md`，旧两份降为 stub 保留外链兼容。
