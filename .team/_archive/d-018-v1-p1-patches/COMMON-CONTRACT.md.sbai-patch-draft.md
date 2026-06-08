# agents/COMMON-CONTRACT.md · SBAI v1.0 对齐补丁（patch-draft）

> 生成时间：2026-05-02 19:12
> 依据：D-018 v1.0-draft
> 目标源文件：`.team/agents/COMMON-CONTRACT.md`（HEAD · v1.1 · 94 行）
> 合入方式：Human approve 后 Orchestrator 按补丁逐条 replace_in_file

---

## 补丁 1 · §0 权限矩阵（重写为执行体二分法）

### 位置：Line 5~21

### Before（v1.1 · Agent 类型）

```
| Agent | 可写目录 |
|---|---|
| Orchestrator | .team/（除 interventions/ 的原始文件） |
| PM-Agent | docs/、.team/board.md、... |
| Design-Agent | design/ |
| MiniApp-Agent | miniapp/ |
| Backend-Agent | server/、api/ |
| DevOps-Agent | infra/、... |
| QA-Agent | qa/ |
| Review-Agent-Tech | .team/reviews/（仅 round-N-tech.md） |
| Review-Agent-Product | .team/reviews/（仅 round-N-product.md） |
```

### After（SBAI v1.0 · 执行体二分法）

```
| 执行体 | 类型 | 可写目录 | 备注 |
|---|---|---|---|
| Orchestrator | 主对话上下文 | .team/（除 interventions/ 原始文件 · 除业务产物目录） | **禁止**写 server/ miniprogram/ design/ docs/；业务产物必须交由装扮型 subagent 产出，Orchestrator 只做编排与原样落盘审查 subagent 产物 |
| pm-writer（装扮 subagent） | 一次性上下文 | docs/、.team/board.md、.team/backlog.json、.team/risks.md、.team/cards/（新增 · 卡定义详述 md）、.team/members/pm-writer/ | 对应旧 PM-Agent |
| design-maker（装扮 subagent） | 一次性上下文 | design/、docs/design/、.team/members/design-maker/ | 对应旧 Design-Agent |
| miniapp-dev（装扮 subagent） | 一次性上下文 | miniprogram/、.team/members/miniapp-dev/ | 对应旧 MiniApp-Agent · 注意实际仓库是 miniprogram/（miniapp/ 为角色旧名） |
| backend-dev（装扮 subagent） | 一次性上下文 | server/、api/、.team/members/backend-dev/ | 对应旧 Backend-Agent |
| devops-ops（装扮 subagent） | 一次性上下文 | infra/、各模块 .github/workflows/、.team/members/devops-ops/、scripts/devops/（新增） | 对应旧 DevOps-Agent |
| qa-planner（装扮 subagent） | 一次性上下文 | qa/、docs/qa/、.team/members/qa-planner/ | 对应旧 QA-Agent |
| review-tech-{card}-r{N} | 一次性审查 subagent | **无写权**（返回 final message 由 Orchestrator 原样落盘） | 每轮新实例 |
| review-product-{card}-r{N} | 一次性审查 subagent | **无写权** | 同上 |
| card-reviewer-{tech\|product}-{card}-r{N} | 一次性审查 subagent | **无写权** | 每张卡每轮新实例 |
```

**关键变化**：
- 所有 "{role}-Agent" 旧名保留在"备注"列作为历史映射
- 所有被审角色新增 `.team/members/{role}/` 写权（存 state.md + history/）
- `pm-writer` 新增 `.team/cards/` 写权（卡定义详述 md · D-018 §3.4）
- `devops-ops` 新增 `scripts/devops/` 写权（补 v1.1 灰色地带）
- `miniapp-dev` 工作区 `miniapp/` → `miniprogram/`（对齐实际仓库）
- 审查 subagent **无写权** · 纯 final message 机制

---

## 补丁 2 · 新增 §0-Bis 工具白名单说明

### 位置：§0 后 · §1 前

### 做法

```markdown
## 0-Bis. 工具白名单约束（D-018 v1.0 · SBAI 执行层）

Costra 当前工具平台 **不支持 API 级工具白名单**（`task(subagent_name=...)` 出的 subagent 继承完整工具链）。审查 subagent 的"无写权"约束仅靠两层防御：

| 层 | 机制 | 强度 |
|---|---|---|
| **防御层 1** | spawn prompt §H 硬性声明"禁止调用 write_to_file / replace_in_file / execute_command / delete_file" | 纪律 |
| **防御层 2** | Orchestrator 事后比对审查 subagent 的 final message 与磁盘产物是否一致 · 不一致 → 记 `I-oneshot-write-violation` + 不采信本轮产物 + Human 裁决 | 审计 |

该限制写入 D-018 §3.5 · 接受为 v1.0 既定事实 · 未来若平台支持工具白名单再升级。

**违规记 incident 类型**：详见 SOP-HUMAN-TRIGGER §5。
```

---

## 补丁 3 · §4 任务卡生命周期（改发起方）

### 位置：Line 44~52

### 做法

现状："状态变更必须发 `status_report` 消息"——SBAI 下没有 message 机制（消失了 team framework）。

改写：

```markdown
状态变更由装扮型 subagent 在 final message 里声明（`type: status_report`），Orchestrator 接收后更新 `board.md` + `backlog.json`。

具体对应：
- Backlog → Todo：pm-writer 首次（`card_ready`）
- Todo → Doing：被审 subagent 开始装扮产出
- Doing → Review：被审 subagent 交付后 Orchestrator spawn review 审查 subagent
- Review → Done：Human 在看到 Review 报告后发 `approve:COSTRA-xxx`（T1/T2）或自动关闭（T3/T4 · D-013）
- Doing → Blocked：装扮 subagent 在 final message 中声明 `type=blocker`
- 任意 → Cancelled：PM + Human 双签
```

---

## 补丁 4 · §8bis Review 闭环（对齐 SBAI 术语）

### 位置：Line 82~88

### 做法

- `Backend / MiniApp 产出进 Review 列前，必须先走 Review-Agent-Tech 预审` → `backend-dev / miniapp-dev 的装扮 subagent 产出后 · Orchestrator 在本对话轮 spawn review-tech-{card}-r{N} 审查 subagent 预审`
- `PM / Design 产出进 Review 列前，必须先走 Review-Agent-Product 预审` → 同理 product
- `DevOps / QA / 决策类文档不走 Review-Agent（Human 直审）` → `不走审查 subagent（Human 直审）`
- `完整规则与迭代机制见 SOP-REVIEW.md` → 保留
- `Review-Agent 不写代码/文档，只出报告` → `审查 subagent 无写权 · 通过 final message 返回报告 · Orchestrator 原样落盘`
- `被审 Agent 必须回 round-N-{agent}-response.md` → `被审 subagent 装扮实例必须产出 round-N-{agent}-response.md`

---

## 补丁 5 · 新增 §8ter SBAI 执行层约定

### 位置：§8bis 后

### 做法

```markdown
## 8ter. SBAI 执行层约定（D-018 v1.0 · 2026-05-02）

### 执行体二分法

- **Orchestrator**（主对话上下文 · 纯编排）：只做分派 / 追踪 / 闸门 / 归档四件事 · **禁止**扮演业务角色 / 编写业务代码 / 生成 Review 意见 / 读业务产物目录（server/ miniprogram/ design/ docs/ · 除非通过审查 subagent 的 final message 间接）
- **装扮型 subagent**（`task(subagent_name="code-explorer", prompt=...)`）：全新上下文 · 一次性 · 每次 spawn 装扮成具体角色执行任务 · 任务结束销毁
- **审查 subagent**：装扮型 subagent 的特化（一次性 / 无写权）· 审完 final message 返回

### 核心硬约束

1. **Orchestrator 不做业务产出**：禁止读 server/ miniprogram/ design/ docs/（除非通过 subagent final message 间接）· 禁止自己写 Review 意见 · 禁止扮演任何被审角色
2. **审查 subagent 无写权**：纪律约束（§0-Bis）· 通过 final message 返回 · Orchestrator 原样落盘
3. **Context Injection Contract**（D-018 §3.3）：每次 spawn · prompt MUST 含 §A~§H 八段（角色规则 / 公共契约 / state / history / 项目全景 / 本次任务 / 强制阅读清单 / 硬约束）· 缺段 = `I-context-injection-violation`
4. **磁盘是唯一共享状态**：所有被审角色的"持久化"通过 `.team/members/{role}/state.md` + `history/*.md` 实现 · 无 session 持久化
5. **并行 Orchestrator 支持**：多会话共享磁盘 · 冲突靠乐观并发 + rebase · 详见 SOP-HUMAN-TRIGGER §6

详见 `.team/decisions/D-018-spawn-based-agent-isolation.md`（v1.0）· `SOP-REVIEW.md §7.3` · `.team/members/README.md`。
```

---

## 补丁 6 · 版本变更

### 做法

在文件末尾加 v1.2 条目（或在当前最末记录补一行）：
- `2026-05-02 | v1.2 · SBAI v1.0 对齐（D-018）· §0 权限矩阵重写为执行体二分法 · 新增 §0-Bis 工具白名单说明 · §4 发起方改为 subagent final message · §8bis 术语对齐 · 新增 §8ter SBAI 执行层约定（核心硬约束 5 条）`

---

## 体量估计

源 94 行 → 合入后 ~180 行（主要是 §0 权限矩阵行数翻倍 + §0-Bis 新增 + §8ter 新增）。

---

**本 patch 待 Human 过稿。**
