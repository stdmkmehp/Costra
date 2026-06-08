# SOP-REVIEW.md · SBAI v1.0 对齐补丁（v2.1-patch-draft）

> 生成时间：2026-05-02 19:12
> 生成人：Orchestrator
> 依据：`.team/decisions/D-018-spawn-based-agent-isolation.md` v1.0-draft
> 目标源文件：`.team/SOP-REVIEW.md`（当前 HEAD 版本 · v2.0 · 607 行）
> 合入方式：待 Human approve 本 patch 后 · Orchestrator 按下方 diff 逐条合入源文件（不会大改结构 · 只做局部术语 + 机制替换）

---

## 补丁总则

**本补丁原则**：
- 只改"机制实现层"术语（"切角色"→"spawn 装扮型 subagent"）
- 删除 D-016 "同轮兑现铁律"相关章节（§10.5 整块 · 已被 D-018 废弃）
- 删除 D-011 "自动循环"的"默认启用"表述（回归 Human 每轮显式触发）
- **保留**：§3 7 步流程主干 / §4 停止条件 / §5 产物目录 / §6 回应格式 / §8 Human 介入 / §11 度量
- **保留**：D-011 / D-013 / D-014 / D-015 作为概念保留（场景分级 / 卡定义 Review / respond-revise 合并语义）· 只换执行层

---

## 补丁 1 · §1 背景与核心约束（核心约束 4~9 条重写）

### 位置：`.team/SOP-REVIEW.md` §1 · 约束 4~9（即 Line 35~44）

### Before（当前 v2.0）

```
4. Review-Agent **不写代码/文档**，只给意见
5. **默认启用自动循环**（D-011 · 2026-04-23 生效 · 详见 §10）：Review 闭环内的 `Revise↔Review` 相互拉起无需 Human 逐轮触发，但前置条件 6 条 + 同轮兑现铁律 + 打断指令见 §10
6. **Review 场景分级**（D-013 · 2026-04-23 21:15 生效）...
7. **卡定义 Review + 产出 Review 环首自动拉起**（D-014 · 2026-04-23 22:26 生效）...
8. **respond/revise 触发词合并**（D-015 · 2026-04-24 09:24 生效）...
9. **同轮兑现铁律**（D-016 · 2026-04-24 19:10 生效）...
```

### After（SBAI v1.0）

```
4. **审查 subagent 无写权** · 只给意见（v2.1 · D-018 · 通过 prompt §H 硬性声明 + Orchestrator 事后比对 final message 与磁盘产物是否一致 保证）
5. **🆕 执行层 SBAI 化**（D-018 · 2026-05-02 生效 · 替代"Orchestrator 切角色扮演"模型）：所有 Review / Revise 动作通过 `task(subagent_name="code-explorer", prompt=...)` spawn **全新上下文**完成。被审角色 + 审查角色统一走同步 subagent 路径。详见 D-018 §3
6. **Review 场景分级**（D-013 · 保留）：T1 准入 / T2 Gate 前 / T3 追溯 / T4 回归 · T3/T4 满足 D-013 §3 四条件时自动关闭（不走 Human 终审）
7. **卡定义 Review + 产出 Review 首轮自动拉起**（D-014 · 保留 · 执行层改 SBAI）：
   - (a) 新建卡必须经一次卡定义 Review（详见 `SOP-CARD-REVIEW.md`）
   - (b) 被审 subagent 交付后，Orchestrator 在**同一对话轮内** spawn review 审查 subagent（若本轮预算不足则明说"下轮需你触发 `run review-{tech|product} COSTRA-xxx round-N`"）
   - (c) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级
8. **respond/revise 触发词合并**（D-015 · 保留不变）：`respond-round-N` 废弃 · `revise-round-N` 统一"回执+修复+可表达异议"三合一语义
9. **🆕 Human 每轮显式触发**（D-018 §7 铁律回归原教旨）：除 D-011 Review 闭环内 `Revise↔Review` 相互拉起可在 Orchestrator **同一对话轮内**连续 spawn 外，**跨轮**任何 Agent 动作都需 Human 显式触发（废除"下一轮自动"类承诺）。同轮连续 spawn 不违反此铁律（本质是一次 Human 触发里的多步兑现）
10. **🆕 并行 Orchestrator 支持**（D-018 §4）：多个 CodeBuddy 会话可同时作为 Orchestrator 操作 Costra · 不使用 `task` 团队模式 · 冲突处理见 D-018 §4.2
```

### 变化要点
- 删除"默认启用自动循环"的"默认"——D-011 改为"Review 闭环内可同轮连续 spawn"，跨轮一律 Human 触发
- 删除 D-016 引用（D-018 废弃了同轮兑现铁律本身 · 因为在 SBAI 下 spawn 是同步的 · 同轮自然兑现 · 无需单独立铁律）
- 新增约束 10 并行 Orchestrator

---

## 补丁 2 · §2 角色分工矩阵（术语对齐）

### 位置：`.team/SOP-REVIEW.md` §2 · 第一个表格 Line 50~57

### 做法
- 表头左列：`被审 Agent` → `被审角色（装扮型 subagent）`
- 表头中列：`Review 归属` → `审查 subagent 类型`
- 表格内容行：
  - `Backend-Agent` → `backend-dev（装扮 subagent）`
  - `MiniApp-Agent` → `miniapp-dev（装扮 subagent）`
  - `PM-Agent` → `pm-writer（装扮 subagent）`
  - `Design-Agent` → `design-maker（装扮 subagent）`
  - `Review-Tech` → `review-tech-{card}-r{N}（审查 subagent · 一次性）`
  - `Review-Product` → `review-product-{card}-r{N}（审查 subagent · 一次性）`
  - `DevOps-Agent` / `QA-Agent`：保持"Human 直审"

---

## 补丁 3 · §3 基础流程（Step 措辞 SBAI 化）

### 位置：`.team/SOP-REVIEW.md` §3 · Line 65~89

### 做法
- 引言中"被审 Agent 交付后 Orchestrator 自动拉起首轮 Review" → "被审 subagent 交付后 Orchestrator 在**同一对话轮内** spawn 首轮 review 审查 subagent"
- Step 2：`Orchestrator 识别归属 → 拉起对应 Review-Agent` → `Orchestrator 识别归属 → spawn 对应 review-{tech|product}-{card}-r{N} 审查 subagent`
- Step 3：`Review-Agent 按规约审` → `审查 subagent 读 Context Injection Contract 约束内的全部材料后审`
- 末尾加一句：`Step 3 后 Orchestrator MUST 把审查 subagent 的 final message 原样落盘到 .team/reviews/COSTRA-xxx/round-N-{tech|product}.md（不得裁剪/改写）`

---

## 补丁 4 · §7.3 拉起时的 Context 注入模板（**整段替换**）

### 位置：`.team/SOP-REVIEW.md` §7.3 · Line 231~245

### Before（v2.0 · 极简版）
```
## Review Task
- card: COSTRA-101
- target_agent: backend
- round: 2/5
- files_changed: ...
- last_commit: abc123
- last_review: .team/reviews/COSTRA-101/round-1-tech.md
- last_revision_note: .team/reviews/COSTRA-101/round-1-backend-response.md
- 强制阅读清单: [charter.md, api/openapi.yaml, docs/api/*, engineering-guidelines.md]
```

### After（SBAI Context Injection Contract · BCE + 强制阅读 + 硬约束）

见 D-018 v1.0 §3.3 (C) Spawn Prompt 模板 · 完整 §A~§H 八段：
- §A 角色规则（inline `07-review-agent-tech.md` 或 `08-review-agent-product.md` 全文）
- §B 公共契约（inline `COMMON-CONTRACT.md` 关键段）
- §C 卡主 state.md（审查场景可略 · 因审查角色无 state）
- §D 最近相关 history（同上 · 审查场景可略）
- §E 项目全景（Sprint / STATE / 最近决策）
- §F 本次任务（卡号 + 本轮是第 N/5 轮 + diff 片段 + 上轮 P0/P1 inline（若 N≥2））
- §G 强制阅读清单（按卡类型列 · 技术向 / 产品向）
- §H 硬约束（无写权 · final message 返回 · 禁幻觉 · 信息不足自首）

### 违规判定

- Spawn prompt 缺 §A/§B/§F/§G 任一段 → `I-context-injection-violation`
- N≥2 时未 inline 上轮 P0/P1 原文 → `I-context-broken-chain`
- 审查 subagent 本轮绕过 §H 硬约束直接写盘 → Orchestrator 发现后记 `I-oneshot-write-violation` + **不采信**本轮产物 · 要求 Human 裁决（重审 or 接受）

---

## 补丁 5 · §7.4 Orchestrator 禁止事项（SBAI 新增 5 条）

### 位置：`.team/SOP-REVIEW.md` §7.4 · Line 247~255

### 保留 6 条原禁令 + 删 1 条 + 新增 5 条

**删除**：
- ❌ ~~`禁止跨轮异步承诺（"下一轮自动拉起 / 60 秒后台拉起"等表述 · D-016 铁律）`~~ → D-018 废除 D-016 · 但这条语义在 SBAI 下通过"同一对话轮内 spawn 即可兑现"自然成立 · 移到新增条文里

**新增**：
- ❌ 禁止自己产出审查意见（必须 spawn 独立 subagent）· **核心 SBAI 约束**
- ❌ 禁止将被审角色的 prompt 和审查角色的 prompt 放在同一 spawn 中
- ❌ 禁止 spawn 审查 subagent 后自己修改它的 final message 再落盘
- ❌ 禁止跨轮承诺（"下一轮自动拉起"类表述）· 同一对话轮 spawn 不算跨轮
- ❌ 禁止同一卡同轮 spawn 多个不同 prompt 的审查 subagent（双盲逃避 · 升级 ESCALATE）

---

## 补丁 6 · §10 Revise↔Review 自动循环细则（**大改 · 删 §10.5**）

### 位置：`.team/SOP-REVIEW.md` §10 · Line 304~496

### 做法

- **§10.1 一句话规则**：改写为 "Review-Agent 给 REVISE 后，Orchestrator 可在**同一对话轮内**连续 spawn 被审 subagent 修复 + 审查 subagent 复审（同步 subagent 天然如此），跨轮仍需 Human 触发。所有产出通过 final message 落盘，无需'承诺'"
- **§10.2 启动条件**：保留（无改动）
- **§10.3 前置条件 C1~C6**：保留（无改动）
- **§10.4 状态机**：保留（无改动）· 但文字里"同轮兑现 §10.5" → "同轮 spawn D-018"
- **§10.5 整块删除**：D-016 同轮兑现铁律 + 10.5.1~10.5.5 全删 · 因为 SBAI 同步 subagent 本来就是同轮的 · 无需单独立铁律
- **§10.6 动作清单**：保留 · 但"切角色执行 Backend-Fix" → "spawn backend-dev 装扮 subagent 做 revise-round-N+1"；"同轮切 Review-Agent" → "同一对话轮内 spawn review 审查 subagent"
- **§10.7 汇报格式**：保留
- **§10.8 Human 打断**：保留
- **§10.9 优先级表**：删除 "D-016 同轮兑现 vs D-011 自动推进声明" 条 + "时间 / tool 上限物理约束 vs D-016 同轮兑现" 条（D-016 废弃）· 保留其他

---

## 补丁 7 · §12 SOP 关系矩阵（更新）

### 位置：Line 562~575

### 做法
- 保留表格结构
- `D-011 方案 B` 行：改 `本 SOP §10.1~§10.4 / §10.6~§10.9 的直接依据` → `本 SOP §10 Review 闭环自动推进的概念依据 · 执行层由 D-018 替代`
- **删除** `D-016 同轮兑现铁律` 行
- **新增** 一行：`D-018 Spawn-Based Agent Isolation` → `本 SOP §1 约束 5/9/10 · §3 流程 · §7.3 Context Injection Contract · §7.4 禁止事项 · §10 执行层的直接依据（2026-05-02 生效）`

---

## 补丁 8 · §13 版本变更（新增 v2.1 条目）

### 位置：Line 579~607

### 做法
- §13.1 新增 v2.1 条目：`2026-05-02 | SBAI v1.0 对齐 · 删除 D-016 同轮兑现（被 D-018 废弃）· §7.3 Context 注入模板升级为 D-018 Context Injection Contract（BCE 三段 + 强制阅读 + Spawn Prompt 模板 §A~§H）· §1 约束 5/9/10 重写为 SBAI 执行层 · §7.4 新增 5 条 SBAI 禁止事项 · §10.5 整块删除 · §12 关系矩阵更新`

---

## 体量估计

按此补丁合入后 · `SOP-REVIEW.md` 预计从 **607 行 → 550 行**（净减 ~57 行 · 主要是 §10.5 整块删除换小段 · §7.3 升级多 ~30 行但整体平衡）。

## 未解决的问题（Human 审这份补丁时可考虑）

- Q1 · §10.5 整块删除是否过激？要不要保留一段"历史注记 · D-016 已被 D-018 废弃"的 stub？
- Q2 · §7.3 的完整模板要不要直接 inline 到 SOP-REVIEW · 还是引用 D-018 §3.3 (C)？前者方便查 / 后者避免冗余
- Q3 · §2 分工矩阵里 "Backend-Agent" 等旧名是否保留 · 或全部改成 "装扮型 subagent 角色名"？本 patch 选的是改（更对齐 SBAI）· 但这会造成与 COMMON-CONTRACT patch 的术语联动

---

**本 patch 待 Human 过稿。过稿后 Orchestrator 按 §1~§8 逐条在源文件执行 replace_in_file · 不动保留段落。**
