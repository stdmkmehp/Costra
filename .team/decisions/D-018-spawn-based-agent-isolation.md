# D-018 · Spawn-Based Agent Isolation（SBAI · v1.1）

- 日期：2026-05-02 19:04（v1.0 初稿）· 2026-05-02 19:57（v1.1 补丁）
- 提案人：Orchestrator
- 审批人：Human
- 立案状态：
  - v1.0：✅ Human approve @ 2026-05-02 19:05（SOP 族 P1 合入 + 6 份 state.md 骨架落地）
  - **v1.1**：✅ **Human approve @ 2026-05-02 20:02**（P2 冒烟驱动的假设证伪补丁 · 同轮拍板 Q11 路径策略 = 先试 `.codebuddy/agents/` 子路径 · 不通过再退回 `./agents/`）
- Human 核心指令（2026-05-01 21:27）：
  > "切换角色进行自审是一件很危险的事情，不仅仅如此，切换角色执行任务而不是新起一个 agent 都是很危险的。你需要把拉起相应 agent 的流程都优化为真正拉起一个新上下文的 agent。并行 Orchestrator 很重要。"
- **Human 批注 #3**（2026-05-02 19:53 · Q-Decisions 4 问 + 2026-05-02 20:02 · v1.1 approve + Q11 路径）：
  > "是你的推荐 A + i + x + β 进行"（Q-A~Q-D 拍板）· "A + i + β"（Q11 路径选 i · approve v1.1 · P1' 下轮 commit 后开工）
  → 落地为 v1.1 补丁 · 采用 CodeBuddy 插件机制 + `tools` 白名单物理隔离 + `costra-` 前缀命名 + `acceptEdits` permissionMode + 标准 2-4 个 description 触发示例 + `.codebuddy/agents/` 子路径（Q11 (i)）
- 替代范围：D-011 / D-014 / D-016 的**执行层**（"Orchestrator 切角色扮演"模型整体废弃）
- 不动：D-013（Review 场景分级逻辑）/ D-015（respond/revise 合并语义）/ `SOP-HUMAN-TRIGGER`（Human 唯一触发源铁律）

---

## 1. 背景与动机

### 1.1 现行"切角色扮演"模型的结构病

D-016 §10.5 要求 Orchestrator 在**同一 tool call 循环内连续切换角色**完成被审 Agent 产出 + Review-Agent 审核。此模型有 4 个物理层风险无法通过"纪律 + 落盘取证"消除：

| # | 风险 | 机制 | 靠纪律为何挡不住 |
|---|---|---|---|
| R1 | **自审污染** | Review-Agent 产出时，脑内仍挂着刚才写代码的设计理由与自我辩护 | 落盘 → 重读文件无法清空短期工作记忆 |
| R2 | **指令漂移** | 被审 Agent 的 system prompt（"你是 Backend"）和 Review 角色 prompt（"你是审查者"）在同一上下文反复覆盖，后者被前者残余污染 | 无 · D-016 只约束"必须切"，不约束"切干净" |
| R3 | **证据裁剪** | 切到 Review 时，Orchestrator 脑内已知道哪些代码是自己刚写的，容易下意识放水 | 文档追责事后做 · 事前无硬隔离 |
| R4 | **跨卡记忆泄漏** | 上一卡 Review 的结论、上一卡的隐性偏好带到下一卡审查 | 无 |

### 1.2 并行 Orchestrator 需求

Human 需要同时开多个 CodeBuddy 会话（Mac / iPad / 多窗口）各自独立操作 Costra 项目。任何假设"Orchestrator 单例"的实现方案**不可接受**。

---

## 2. 技术现实勘查

Costra 工程内可用的 spawn 机制：

### 2.1 `task` 工具 · 同步 subagent（本决议采用）

- 调用形态：`task(subagent_name="costra-{role}", prompt=..., ...)`
- 上下文：**全新、空白**，仅注入本次 prompt 和该 subagent 的系统定义（见 §3.6）
- 生命周期：**一次性**，执行完返回 final message，**不保留历史**
- 并发：可在同一条消息里并行多个 `task`
- **关键特性**：无 `leadAgentId` 单例限制 · 天然支持多 Orchestrator 并行调用
- **工具权限**（v1.1 补丁 · 2026-05-02 19:53 文档校验证据）：每个 subagent 的工具访问由 `.codebuddy/agents/*.md` frontmatter `tools` 字段**显式声明** · 省略 = 全工具访问 · 列表 = 硬白名单物理强制
  - 被审装扮 subagent（需修改业务代码/文档）：`tools: ["Read", "Write", "Edit", "MultiEdit", "Bash", "Grep", "Glob", "LS", "TodoWrite", "WebFetch"]`
  - 审查 subagent（无写权 · 只读评审）：`tools: ["Read", "Grep", "Glob", "LS", "WebFetch"]` · **物理上无法调** Write/Edit/Bash/delete_file/execute_command
- **注**：v1.0 §2.1 原断言"无 API 级工具白名单"已于 2026-05-02 19:46 被 CodeBuddy 官方 plugin-dev/agent-development SKILL 证伪 · 本节已修订

### 2.2 `task` 工具 · 团队模式（本决议**不采用**）

- 调用形态：`task(name="review-tech-worker", team_name="costra-review", ...)`
- 不采用理由：
  - 基于 `leadAgentId` 单例假设 · **不支持并行 Orchestrator**
  - 无 API 级工具白名单 · 无法强制 oneshot 无写权
  - 异步 inbox 机制在多 Orchestrator 下路由不明（`send_message(recipient="main")` 歧义）

结论：**SBAI 采用同步 subagent + 磁盘状态协作**，不引入 team framework。

---

## 3. 决议（SBAI v1.1）

### 3.1 核心原则

1. **真·独立上下文**：所有 Agent 动作（被审 Agent 产出 / Review 审核 / 卡定义审核）都通过 `task(subagent_name="costra-{role}", prompt=...)` spawn 新上下文完成 · **Orchestrator 永不扮演业务角色**
2. **磁盘承载状态**：Agent"持久化"通过 `.team/members/{role}/state.md` + `.team/members/{role}/history/*.md` 实现 · 不依赖任何 session 级持久化机制
3. **Context Injection Contract 硬约束**：每次 spawn 时 prompt 必须包含完整背景 / 内容 / 方案（§3.3 BCE 三段）+ 强制阅读清单 · 缺段 = 违规
4. **🆕 工具白名单物理隔离**（v1.1 补丁）：审查 subagent 的"无写权"通过 `.codebuddy/agents/*.md` frontmatter `tools` 字段**物理强制**（`tools: ["Read", "Grep", "Glob", "LS", "WebFetch"]` · 不含任何写类工具）· 非纪律约束 · 不可绕过

### 3.2 执行体分类

v1.1 采用**执行体二分法**（沿用 v1.0）· 调用机制升级为具名 subagent：

| 执行体 | 类型 | 职责 | subagent_name（示例）| 工具白名单 | 生命周期 |
|---|---|---|---|---|---|
| **Orchestrator** | 主对话上下文（Human 所在会话）| 纯编排 · 分派任务 · 归档产物 · 不写业务代码 · 不生成 Review 意见 | — | Orchestrator 本身完整 | 随会话 · 可多实例（并行）|
| **装扮型 subagent · 被审** | `task(subagent_name="costra-{role}", ...)` | 装扮成具体角色执行任务：`costra-backend-dev` / `costra-miniapp-dev` / `costra-pm-writer` / `costra-design-maker` / `costra-devops-ops` / `costra-qa-planner` | `costra-{role}` | `["Read", "Write", "Edit", "MultiEdit", "Bash", "Grep", "Glob", "LS", "TodoWrite", "WebFetch"]` | 一次性 · 任务结束即销毁上下文 |
| **装扮型 subagent · 审查** | `task(subagent_name="costra-review-*", ...)` | 审查被审交付物：`costra-review-tech` / `costra-review-product` / `costra-card-reviewer-tech` / `costra-card-reviewer-product` | `costra-review-{tech\|product}` / `costra-card-reviewer-{tech\|product}` | **`["Read", "Grep", "Glob", "LS", "WebFetch"]`**（物理无写权）| 一次性 · 每轮新实例 |

**关键**：v1.1 **没有持久 team member 概念**。所谓"backend-dev 是持久的"是**磁盘层面持久**（state.md 累积历史）· 每次 spawn 都是一个全新的 `costra-backend-dev` subagent 读 state.md 装扮成它。

### 3.3 Context Injection Contract（硬约束）

每次 spawn subagent 时，prompt **必须**包含以下三段完整内容 · 缺段即违规（`I-context-injection-violation`）：

#### (A) 必注入三层（BCE）

> **v1.1 补丁**（2026-05-02）：§A"角色规则"段**不再需要每次 inline**——角色规则已在 `.codebuddy/agents/costra-{role}.md` 的 frontmatter 后 markdown 正文（即 subagent 的 system prompt）中固化 · Orchestrator 每次 spawn 只需 inline §B~§H 的动态部分 · 减少 prompt 膨胀。

**B · Background（背景）**：
- 卡号 + 卡标题 + 所属 Sprint + 卡类型（feature / fix / refactor / infra / docs）
- 业务目标一句话
- 相关历史决策引用：`ADR-*.md` / `D-*.md`（只列与本任务相关的 · 不全量）
- 关联卡（依赖 / 被依赖）：`COSTRA-xxx` 及其状态
- 架构定位：本任务产出落在 `docs/charter.md §7` 工作区矩阵的哪一格

**C · Content（内容 · 本轮产出本体或审查对象）**：
- 对**被审 subagent（装扮业务角色）**：本次任务描述 · 产出目标 · 涉及文件范围
- 对**审查 subagent（装扮 Review）**：
  - 被审交付清单（diff / 产物 md 路径）
  - `git diff` 片段（相对上一个 PASS commit 或 main）
  - 被审方回应（`round-N-{role}-response.md` 全文 inline · 若 N≥2）

**E · Expected Approach（方案与约束）**：
- 原方案引用：PRD / 设计稿 / `api/openapi.yaml` / `docs/db/schema.md` 对应段落（路径 + 行号）
- 约束清单：`.team/engineering-guidelines.md` 适用条款 + 工作区矩阵（越权红线）+ 硬编码红线（D-008 主体字样 / AppID / secret）
- 验收标准：卡 DoD / 验收清单
- 若 N≥2（审查场景）：上一轮 `round-(N-1)-{tech|product}.md` 的 **P0/P1 原文全量**（不得摘要）

#### (B) 强制阅读清单（READ-LIST · 在 prompt 内明写）

**被审 subagent 必读（最小集）**：
1. ~~`.team/agents/{role}.md`（角色定义）~~ → **v1.1 已挪到 `.codebuddy/agents/costra-{role}.md` system prompt 固化 · 不用再读**
2. `.team/agents/COMMON-CONTRACT.md`（公共契约）
3. `.team/members/{role}/state.md`（自己的持久状态）
4. 本任务相关的 ADR / D-*.md
5. 相关业务产物（如 openapi.yaml / schema.md）

**审查 subagent 必读（最小集）**：
1. ~~对应 review 角色规则：`.team/agents/{07-review-agent-tech|08-review-agent-product}.md`~~ → **v1.1 已挪到 `.codebuddy/agents/costra-review-{tech|product}.md` system prompt 固化**
2. `docs/charter.md` / `.team/engineering-guidelines.md` / `COMMON-CONTRACT.md`
3. 被审卡的 backlog / 历史决策
4. 被审交付本体（response md + diff）

#### (C) Spawn Prompt 模板（MUST 格式 · v1.1 简化）

```
# §B 公共契约补充（§A 已在 system prompt 中 · 跳过）
[.team/agents/COMMON-CONTRACT.md §0/§0-Bis/§4/§8bis/§8ter 关键段 inline]

# §C 你的持久状态（仅被审角色 · 审查角色跳过）
[.team/members/{role}/state.md 全文 inline]

# §D 最近相关 history（仅被审角色 · Orchestrator 筛选）
[最近 1-3 份 history/*.md inline · 按相关性]

# §E 项目全景
- Sprint + STATE MODE 快照
- 最近决策摘要
- 本任务相关卡号 + 状态

# §F 本次任务
- 卡号 / 目标 / 产出路径 / 验收 DoD
- 对审查任务：C/D/E 三段背景 + 被审产物路径 + 上轮 P0/P1 inline（若 N≥2）

# §G 强制阅读清单
1~N. [按场景列出绝对路径]

# §H 硬约束
- 产出落盘走自己的工作区（见 COMMON-CONTRACT §0 权限矩阵）
- 对被审角色：任务结束 MUST 更新 .team/members/{role}/state.md + 新增 history/YYYY-MM-DD-COSTRA-xxx-brief.md
- 对审查角色：**工具白名单物理无写权**（frontmatter `tools` 不含 Write/Edit/Bash）· 报告通过 final message 返回给 Orchestrator 原样落盘
- 产出 final message 摘要给 Orchestrator
```

#### (D) 违规判定

以下情况记 `.team/incidents/` incident：
- Spawn prompt 缺 §B/§F/§G 任一段 → `I-context-injection-violation`（v1.1：§A 已固化在 system prompt · 不再列入缺段判定）
- §F 审查场景用 Orchestrator 转述替代 diff 原文 → `I-evidence-tampered`
- N≥2 时未 inline 上一轮 P0/P1 原文 → `I-context-broken-chain`
- 同一卡同轮 spawn 多次不同 prompt 的审查实例（比较哪个 verdict 更好看）→ `I-double-blind-evasion`（升级 ESCALATE）
- ~~`I-oneshot-write-violation`（审查 subagent 绕过 §H 硬约束自写磁盘）~~ → **v1.1 已删除**：frontmatter `tools` 白名单物理强制 · 审查 subagent 根本无 Write/Edit/Bash 工具可调 · 该违规类型物理不可发生

### 3.4 磁盘状态承载：`.team/members/`

取消所有 session 级持久化。Agent 状态全部落盘：

```
.team/members/
  ├── backend-dev/
  │   ├── state.md              # 角色身份 / 当前任务 / 历史索引 / 技术栈 / 工作区约束
  │   └── history/
  │       └── YYYY-MM-DD-COSTRA-xxx-brief.md   # 每次完整工作日志
  ├── miniapp-dev/
  │   ├── state.md
  │   └── history/
  ├── pm-writer/
  │   ├── state.md
  │   └── history/
  ├── design-maker/
  │   ├── state.md
  │   └── history/
  ├── devops-ops/
  │   ├── state.md
  │   └── history/
  └── qa-planner/
      ├── state.md
      └── history/
```

**state.md schema（建议 · P1 细化）**：
- §1 角色身份（从对应 `0x-*-agent.md` 挂接）
- §2 当前关注（active tasks / WIP 卡号）
- §3 交付历史索引（指向 history/*.md 条目）
- §4 最近决策影响（哪些 ADR / D-*.md 与我相关）
- §5 工作区 + 权限（COMMON-CONTRACT §0 的子集）
- §6 遗留问题 · FU · 债务
- §7 最近更新时间戳（每次被装扮完成后由 subagent 自己更新）

每次 spawn 装扮某角色时，Orchestrator 读 state.md inline 到 prompt §C · **v1.1**：装扮 subagent 的 frontmatter `tools` 白名单已含 `Write` / `Edit` / `MultiEdit` · **subagent 自主**在任务结束时更新 state.md 并新增 history/*.md · 下次装扮时读到新状态 · 实现跨轮持久化。

> **v1.0 → v1.1 修正**：v1.0 假设被审装扮 subagent 工具继承不明 · 导致 2026-05-02 19:34 P2 冒烟首战时装扮 subagent 实际只有只读工具 · 无法自主写 state.md。v1.1 通过 `.codebuddy/agents/costra-{role}.md` frontmatter 显式授权 Write/Edit/MultiEdit · 彻底解决此漏洞。

### 3.5 审查（Review）subagent 的一次性硬约束

审查角色（`costra-review-tech` / `costra-review-product` / `costra-card-reviewer-{tech\|product}`）每次 spawn 都是**全新 subagent** · 审完即销毁 · **永不复用**。

关键性质：
- 无 state.md（审查不累积个人状态）
- 无 history/（审查产物直接落盘到 `.team/reviews/COSTRA-xxx/round-N-{tech|product}.md`）
- **🆕 工具白名单物理无写权**（v1.1 补丁）：
  - `.codebuddy/agents/costra-review-*.md` frontmatter `tools: ["Read", "Grep", "Glob", "LS", "WebFetch"]`
  - 物理上无 `Write` / `Edit` / `MultiEdit` / `Bash` / `delete_file` / `execute_command` 等写类工具可调
  - 报告通过 final message 返回 · Orchestrator 原样落盘（不可修改）
  - v1.0 "依赖 prompt §H 纪律 + 事后比对"的弱约束已**物理层升级** · 与 `I-oneshot-write-violation` 类型一并作废

这彻底消灭 R1（自审）和 R4（跨卡记忆泄漏）· R2（指令漂移）因全新上下文不存在 · R3（证据裁剪）因审查者**物理不写代码**而消失。

### 3.6 Subagent 注册与调用机制（v1.1 新增）

#### 3.6.1 载体：Costra 项目根作为 CodeBuddy 插件

Human 2026-05-02 19:53 裁决（Q-A 选 a1 · 详见 `.team/decisions/D-018-Q-Decisions-2026-05-02.md` §2.1）：Costra 项目根直接做成 CodeBuddy 插件。

**落盘结构**（跟随 git）：

```
Costra/
├── .codebuddy-plugin/
│   └── plugin.json              # 插件清单（name=costra-agents / version / description / agents[]）
├── .codebuddy/
│   └── agents/                  # subagent 定义目录（约定路径 · CodeBuddy 自动发现）
│       ├── costra-backend-dev.md
│       ├── costra-miniapp-dev.md
│       ├── costra-pm-writer.md
│       ├── costra-design-maker.md
│       ├── costra-devops-ops.md
│       ├── costra-qa-planner.md
│       ├── costra-review-tech.md
│       ├── costra-review-product.md
│       ├── costra-card-reviewer-tech.md
│       └── costra-card-reviewer-product.md
└── ... (其他项目文件)
```

> **路径说明**：CodeBuddy 插件的 `agents/` 目录按官方指南应在插件根目录（`<plugin-root>/agents/`）· 但 Costra 采用"项目根作为插件"模式 · 为避免污染项目根目录 · 把 agents 放在 `.codebuddy/agents/` 子路径下 · 通过 plugin.json 的 `agents` 字段显式指定路径（`"agents": ["./.codebuddy/agents"]`）· P1' 阶段验证该路径能被 CodeBuddy 识别 · 若不识别则退回到 `./agents/` 根目录方案。

#### 3.6.2 Subagent 定义文件 schema（frontmatter）

每个 `costra-*.md` 的 frontmatter 按以下 schema（v1.1 定稿 · Human 2026-05-02 19:53 Q-B/C/D 决策）：

```yaml
---
name: costra-{role}                  # 必填 · 全局唯一 · kebab-case · 3-50 字符
description: |                       # 必填 · 2-4 个 <example> 块（Q-D 标准姿态）
  Use this agent when the Costra Orchestrator explicitly invokes it ...
  <example>...</example>
  <example>...</example>
tools: ["Read", "Write", ...]        # 按角色 · 被审 vs 审查 · 参考 §3.2 表
model: inherit                       # 继承 parent 模型
color: blue                          # UI 标识色（随意）
permissionMode: acceptEdits          # Q-C 决策 · 文件编辑自动批 · Bash 仍要 Human 批（审查角色此字段无意义但为格式统一保留填 default）
---

You are the Costra "{role}" persona executor ...
（system prompt 正文 · 约 2-5 KB · 固化角色规则 + 工作区约束 + 硬约束）
```

#### 3.6.3 调用与热加载

- **调用**：`task(subagent_name="costra-{role}", prompt=<§B~§H 动态段>)`
- **加载**：CodeBuddy 启动时自动扫描 · 或运行 `/reload-plugins` 热加载（不用重启 IDE）
- **验证**：`/agents` 命令可查看已注册的 subagent 列表 · 确认 `costra-*` 全部在列

#### 3.6.4 v1.0 → v1.1 迁移影响

| v1.0 行为 | v1.1 行为 |
|---|---|
| `task(subagent_name="code-explorer", prompt=装扮 xxx)` | `task(subagent_name="costra-xxx", prompt=§B~§H 动态段)` |
| 每次 spawn inline §A 角色规则（数 KB 膨胀）| §A 固化在 subagent system prompt · 不再 inline |
| 装扮 subagent 工具继承不明 | 显式 `tools` 白名单声明 · 确定性强 |
| 审查 subagent 靠纪律无写权 | 审查 subagent 物理无 Write 工具可调 |
| 实战 2026-05-02 P2 冒烟暴露缺陷 | P2' 重跑（§5 迁移计划 P2'）预期完全解决 |

---

## 4. 并行 Orchestrator 支持

### 4.1 并行能力

- 多个 CodeBuddy 会话可**同时**作为 Orchestrator 操作 Costra 项目
- 每个会话独立上下文 · 独立 spawn subagent · 独立与 Human 对话
- 共享面：**磁盘**（`.team/` 全部产物）
- **禁用面**：不使用 `task` 团队模式 / 不创建 `.codebuddy/teams/*` / 不依赖 `leadAgentId`

### 4.2 并发冲突处理（工程细节 · P1 细化）

| 冲突场景 | 处置 |
|---|---|
| 两个 Orchestrator 同时更新同一个 member 的 state.md | **乐观并发 · rebase**：更新前 `git log -1 --format=%H state.md` 核对 · 如 hash 变了则先合并（手工或工具辅助）再写 |
| 两个 Orchestrator 同时立新卡（COSTRA 号冲突） | Human 通过指令明确哪个会话立卡 · 另一会话等 |
| 两个 Orchestrator 的视角不一致（同卡 Sprint 归属不同） | `backlog.json` 是 SSOT · 谁先改算谁的 · 另一个 rebase |
| 两个 Orchestrator 同时触发同一 role 的 spawn（极少） | 两次 spawn 都是独立新上下文 · 无跨上下文污染 · 但可能重复劳动 · Human 分派职责范围避免 |

### 4.3 Human 如何分派多 Orchestrator

不强制业务域划分 · 但建议 Human 明确每个会话的职责范围（如 A 跟 COSTRA-126 · B 跟 D-017 bug）· 避免两个会话做同一件事。

### 4.4 Orchestrator 识别（建议 · 初版可略）

- 每个 Orchestrator 会话可生成唯一 `orch_id`（如 `orch-2026-05-02-mac-1`）
- 落盘到 `.team/orchestrators/{orch_id}.md`（新目录 · 含启动时间 / 关注业务域 / 最近心跳）
- 初版若实战无冲突可不要求 · P2 冒烟验证

---

## 5. 迁移计划

| 阶段 | 动作 | 产物 | 状态 |
|---|---|---|---|
| **P0** | 本决议草案落盘 · Human 过稿 | D-018 v1.0 | ✅ Human approve @ 2026-05-02 19:05 |
| **P1** | SOP 族补丁：SOP-REVIEW / SOP-CARD-REVIEW / SOP-HUMAN-TRIGGER / COMMON-CONTRACT / 00-orchestrator · 对齐 SBAI v1.0（删 team 模式 · 新增 `.team/members/` 约定 · 新增并行 Orchestrator 章节）；新增 `.team/members/{role}/state.md` 骨架（6 份） | SOP 补丁已合入 + 6 state.md 骨架 | ✅ 2026-05-02 19:28 完成 |
| **P2** | 单会话冒烟：spawn 一次装扮型 subagent · 验证 state.md 机制 | `getGlobalStorage too early` 诊断（实际暴露 v1.0 假设证伪）| ✅ 2026-05-02 19:34 完成 + 发现 v1.0 §2.1 / §3.2 / §6 Q3 假设错误 |
| **P0-v1.1** | 补丁草案落盘 · Human 过稿 | D-018 v1.1 + `D-018-Q-Decisions-2026-05-02.md` 前置决策记录 | ✅ **Human approve @ 2026-05-02 20:02** |
| **🆕 P1'** | Subagent 定义落盘：Costra 根目录加 `.codebuddy-plugin/plugin.json` + `.codebuddy/agents/costra-*.md` × 10 · `/reload-plugins` 加载 · `/agents` 验证注册 | 10 个 subagent 定义 + plugin.json | ⏸ 等 P0-v1.1 approve |
| **🆕 P2'** | P2 冒烟重跑：用 `costra-miniapp-dev` 重跑 `getGlobalStorage too early` 诊断 · 验证工具白名单 + state.md 自写 + history 自写 · 拿完整 L1~L4 + 方案 A/B/C + Q1~Qn 报告 | 完整诊断报告 + miniapp-dev state.md 自动更新 + `history/2026-05-02-getglobalstorage-too-early-diagnose.md` | ⏸ 等 P1' |
| **🆕 P2''** | 审查 subagent 冒烟：随便一个小卡走 `costra-review-tech` 审查 · 验证物理无写权（`ls .team/reviews/` 应由 Orchestrator 落盘 · subagent 无法自写）| 冒烟报告 | ⏸ 等 P2' |
| **P3** | 并行冒烟：Human 开 2 会话 · 并行派不同任务给不同 role · 验证无冲突 | 并行冒烟报告 | ⏸ 等 P2'' |
| **P4** | 灰度 · 新卡一律走 SBAI v1.1 · 老卡跑完为止 | — | — |
| **P5** | 全量 · "切角色扮演"字样从 SOP 中彻底清除 · 同时清除 v1.0 残留的 `code-explorer` spawn 写法 | — | — |

---

## 6. 待澄清的问题（Open Items）

| # | 问题 | 说明 | 计划 |
|---|---|---|---|
| Q1 | state.md 的 schema 细节 | 7 段建议是否合理？字段是否完整？ | P1 已细化（`.team/members/README.md` §2）· P2' 后再回顾 |
| Q2 | history/*.md 命名规范 | 任务很长时单个 subagent 多次更新 history 该如何命名？ | P1 已细化（`.team/members/README.md` §3）· P2' 实战再看 |
| ~~Q3~~ | ~~装扮型 subagent 权限隔离~~ | ~~同步 subagent 继承完整工具 · 无 API 级白名单~~ | ✅ **v1.1 已解决**：`.codebuddy/agents/*.md` frontmatter `tools` 字段物理白名单 · 非纪律约束 |
| Q4 | Orchestrator 角色卡自己需要 state.md 吗 | Orchestrator 多实例时共享 state 容易冲突 | 暂不需要（Orchestrator 每次会话独立 · Human 驱动）|
| Q5 | Review 结果 PASS 跨轮如何承接 | 无 β-3 pending 机制后 · 跨轮 Review 何时发生完全由 Human 每次显式触发 · 这是否回到"SOP-HUMAN-TRIGGER 铁律原教旨"？ | 是 · v1.0 主张回归铁律原教旨 · Human 每轮都得明确触发下一动作 |
| Q6 | 跨 Orchestrator 的 state.md 合并策略 | 乐观并发 · rebase · 但 state.md 是自由 md · 没有结构化合并工具 · 冲突时如何处置 | P3 并行冒烟验证 |
| ~~Q10~~ | ~~装扮 subagent 工具继承问题~~ | 原以为"继承完整工具" · P2 冒烟发现实际只读 | ✅ **v1.1 已解决**：frontmatter `tools` 显式声明 · 不再依赖继承推测 |
| **🆕 Q11** | `.codebuddy/agents/` 子路径能否被 CodeBuddy 自动发现 | 官方文档约定 `agents/` 在插件根目录 · Costra 选了 `.codebuddy/agents/` 子路径以避免污染项目根 · 是否被识别需 P1' 实测 | P1' 验证 · 若不识别则退回 `./agents/` |
| **🆕 Q12** | `permissionMode` 完整取值列表 | 官方 agent-development SKILL 未给完整取值 · 现有样例见 `default` / 推测含 `acceptEdits` / `bypassPermissions` / `plan` | P1' 落盘时先用 `acceptEdits` · 验证不通过再试其他值 |
| **🆕 Q13** | Subagent 定义文件是否可在 git 提交时跟随仓库变更热生效 | Human 两人会话（Mac + iPad）pull 仓库后 · 新的 `costra-*.md` 需不需要手工 `/reload-plugins` | P3 并行冒烟验证 |

---

## 7. 铁律更新

在 SBAI v1.1 生效后 · Costra 核心铁律为：

1. **Human 是唯一触发源**（SOP-HUMAN-TRIGGER · 不变）
2. **Orchestrator 不扮演业务角色**（§3.2）
3. **所有 Agent 动作通过 spawn 新上下文完成**（§3.1）
4. **Context Injection Contract · BCE 三段 + 强制阅读清单**（§3.3）
5. **审查 subagent 一次性 · 永不复用**（§3.5）
6. **磁盘是唯一共享状态 · 无 session 持久化**（§3.4 / §4）
7. **🆕 审查 subagent 工具白名单物理无写权**（v1.1 · §3.1 / §3.5）· 由 `.codebuddy/agents/costra-review-*.md` frontmatter `tools: ["Read", "Grep", "Glob", "LS", "WebFetch"]` 硬约束 · 非纪律

---

## 8. 签字

- Human：
  - v1.0：✅ approve @ 2026-05-02 19:05
  - **v1.1**：✅ **approve @ 2026-05-02 20:02**（同轮 Q11 路径决策）
- Orchestrator：
  - v1.0：🟢 合入（P1 已完成 / P2 冒烟暴露假设证伪驱动 v1.1）
  - v1.1：🟢 合入 · 进入 P1'（下轮按 β 路径 · 先 commit 本轮再开工）

---

## 9. 版本

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0-draft | 2026-05-02 19:04 | 初稿 · 基于 Human 2026-05-01 21:27"新起 agent"+ 2026-05-02 15:19"并行 Orchestrator 优先"两条核心需求 · 采用同步 subagent + 磁盘 state.md 协作方案 · 废弃所有 session 级持久化机制 |
| v1.0 | 2026-05-02 19:05 | Human approve · SOP 族 P1 合入（SOP-REVIEW v2.1 / SOP-CARD-REVIEW v1.1 / SOP-HUMAN-TRIGGER v1.5 / COMMON-CONTRACT v1.2 / 00-orchestrator v1.1）+ 6 份 `.team/members/*/state.md` 骨架落地 |
| v1.0-P2-smoke | 2026-05-02 19:34 | P2 冒烟首战 · spawn `code-explorer` 装扮 miniapp-dev 诊断 `getGlobalStorage too early` · 业务产出：独立核查确认"100% 非业务 · 微信 SDK 内部 Bug" · 规约产出：**v1.0 §2.1 / §3.2 / §6 Q3 Q10 关键假设被证伪**（"装扮 subagent 继承完整工具链 · 无 API 级白名单"错 · 实际 `code-explorer` subagent 仅只读工具 · 无法自主写 state.md / history · subagent 诚实自首）· 触发 v1.1 补丁 |
| **v1.1** | **2026-05-02 20:02** | **Human approve** · P2 冒烟驱动的假设证伪补丁（本条与上方 v1.1-draft 合并 · approve 时一并升级）· Q11 `.codebuddy/agents/` 子路径方案固化 · 进入 P1' 阶段（下轮先 commit 本轮规约 + FU 第 3 次观察 · 再开工 10 个 subagent 定义文件）|
| v1.1-draft | 2026-05-02 19:57 | （见 v1.1 条目 · draft 已 approve 升级）|
