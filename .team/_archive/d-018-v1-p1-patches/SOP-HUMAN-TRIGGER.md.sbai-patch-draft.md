# SOP-HUMAN-TRIGGER.md · SBAI v1.0 对齐补丁（patch-draft）

> 生成时间：2026-05-02 19:12
> 依据：D-018 v1.0-draft
> 目标源文件：`.team/SOP-HUMAN-TRIGGER.md`（HEAD · v1.4 · 130 行）
> 合入方式：Human approve 后 Orchestrator 按补丁逐条 replace_in_file

---

## 补丁 1 · §1 背景澄清（加执行体二分法）

### 位置：Line 10~18

### 做法
在"Costra 项目的'多 Agent 协作'不是后台常驻进程"段落后追加一行：

> **🆕 执行体二分法**（D-018 v1.0 · 2026-05-02 生效）：Costra 项目共两类执行体——
> - **Orchestrator**（主对话上下文 · Human 所在会话）：纯编排 · 可多实例（并行 Orchestrator 支持）
> - **装扮型 subagent**（`task(subagent_name="code-explorer", prompt=...)`）：装扮成具体角色（backend-dev / miniapp-dev / pm-writer / design-maker / devops-ops / qa-planner / review-tech-* / review-product-* / card-reviewer-*）执行任务 · 一次性 · 每次全新上下文
>
> Human 触发的本质：通过 Orchestrator 调用 `task` spawn 装扮型 subagent。SOP-HUMAN-TRIGGER 铁律对 Orchestrator 的"派单"动作本身不构成触发（是派单的"决定"需 Human 触发 · 执行层 spawn 由 Orchestrator 代劳）。

---

## 补丁 2 · §3 触发指令词典（增 SBAI 行 · 删 team 相关行）

### 位置：Line 67~105

### 做法

**保留所有现行指令**（`run COSTRA-xxx` / `run <agent>` / `stop` / `approve:*` / `reject:*` / `run review-tech` / `pause-review` / `skip-review` / `force-pass` / `review-card` / `skip-card-review` / `force-card-pass` / `verify` / `skip-verify`）· 只修语义说明：

- "Orchestrator 行为"列里的"切换到对应 Owner Agent" → "spawn 对应 Owner 角色的装扮型 subagent"
- "拉 Review-Agent-Tech 对该卡跑一轮" → "spawn `review-tech-costra-xxx-r{N+1}` 审查 subagent"
- 类似对齐

**不新增 SBAI 专用运维指令**（如 `list-oneshot` / `shutdown-oneshot` / `list-members` / `restart-member`）· 因为同步 subagent 无持久化 · 这些指令无意义

**新增一条**（v2.0 末尾）：
| 用户说 | Orchestrator 行为 |
|---|---|
| 🆕 `orch-status` | 报告当前 Orchestrator 会话状态（若启用 orch_id）· 列出本会话近期产出 / 相关卡 |

---

## 补丁 3 · §3 铁律豁免声明（更新）

### 位置：Line 95~105（豁免声明块）

### 做法

保留现有"例外 1（D-011）/ 例外 2（D-014-a）/ 例外 3（D-014-b）"三条。新增一行作为统一说明：

> **🆕 2026-05-02 D-018 执行层对齐**：以上 3 条例外的**执行层**全部改为"Orchestrator 在同一对话轮内 spawn 装扮型 subagent"。所谓"自动拉起"本质是 Orchestrator 在响应 Human 单次触发时的**多步兑现**——不构成跨轮异步操作。跨轮动作**一律**由 Human 下一次消息触发。

---

## 补丁 4 · §5 违规追溯（补 SBAI 相关 incident）

### 位置：Line 114~130

### 做法

保留所有现有条目。新增一段：

> **🆕 SBAI 相关 incident 类型**（D-018 v1.0）：
> - `I-context-injection-violation` · spawn prompt 缺 §A/§B/§F/§G 任一段
> - `I-evidence-tampered` · Orchestrator 落盘时修改了审查 subagent 的 final message
> - `I-oneshot-write-violation` · 审查 subagent 绕过 §H 硬约束自己写盘（不可物理阻止 · Orchestrator 事后比对 final message 与磁盘产物发现 · 不采信本轮产物 · Human 裁决）
> - `I-double-blind-evasion` · 同一卡同轮多次 spawn 不同 prompt 的审查 subagent（升级 ESCALATE）

---

## 补丁 5 · 新增 §6 并行 Orchestrator

### 位置：文件末尾（Line 130 后新增）

### 做法

```markdown
---

## 6. 并行 Orchestrator 支持（D-018 §4 · 2026-05-02）

### 6.1 概念
Costra 支持多个 CodeBuddy 会话同时作为 Orchestrator · 每个会话独立上下文 / 独立 spawn subagent / 独立与 Human 对话。共享面仅磁盘（`.team/`）。

### 6.2 Human 分派
不强制业务域划分 · 建议 Human 明确每个会话的职责范围（如会话 A 跟 COSTRA-126 · 会话 B 跟 D-017 bug）· 避免重复劳动。

### 6.3 冲突处置
- 两个 Orchestrator 同时写同一文件（如 state.md / backlog.json）：后手 **MUST rebase**（`git log -1 --format=%H <file>` 核对）
- 两个 Orchestrator 同时立新卡：Human 通过指令明确分派 · 另一会话等
- 两个 Orchestrator 视角不一致：以 backlog.json 为 SSOT

### 6.4 推荐工作流
- 每个会话开工时 `ls .team/` 扫一遍 · 了解最新磁盘状态
- 大改动前 `git status` 看看是否有他会话未提交的修改
- 产出 MUST 落盘 + commit · 避免"只在我脑子里"的状态
```

---

## 补丁 6 · 版本变更

### 位置：文件末尾

### 做法
- 追加 v1.5 条目：`2026-05-02 | SBAI v1.0 对齐（D-018）· §1 加执行体二分法 · §3 指令语义升级 · §3 豁免声明加 D-018 对齐说明 · §5 补 4 类 SBAI incident · 新增 §6 并行 Orchestrator`

---

## 体量估计

源 130 行 → 合入后 ~200 行（主要是 §6 新节 ~40 行 + §5 补 incident ~10 行 + §1 加 10 行说明）。

---

**本 patch 待 Human 过稿。**
