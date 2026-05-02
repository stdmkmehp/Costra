# .team/members/ · SBAI v1.0 磁盘状态目录

> 立案依据：`.team/decisions/D-018-spawn-based-agent-isolation.md` v1.0 §3.4
> 生效时间：2026-05-02

---

## 1. 目的

SBAI v1.0 下 · 所有被审角色是"装扮型 subagent"（同步 · 一次性 · 无 session 持久化）。为了让每次装扮都能承接前轮状态 · 把"角色持久状态"全部落盘到磁盘。

每个角色一个目录：

```
.team/members/
  ├── backend-dev/
  │   ├── state.md
  │   └── history/
  │       ├── 2026-05-02-COSTRA-104-entries-crud.md
  │       └── ...
  ├── miniapp-dev/
  ├── pm-writer/
  ├── design-maker/
  ├── devops-ops/
  └── qa-planner/
```

---

## 2. `state.md` schema（7 段）

### §1 角色身份

引用 `.team/agents/0x-{role}-agent.md`（挂接 · 不重复）。可加"最近一次装扮时的 agent 文件版本/hash"记录，以便发现角色定义漂移。

### §2 当前关注（active tasks）

WIP 卡号清单 · 每条附状态（`Doing` / `待 Review` / `Blocked`）。

### §3 交付历史索引

指向 `history/*.md` 的链接 · 最近 5-10 条 · 每条附一句话摘要。

### §4 最近决策影响

哪些 `.team/decisions/ADR-*.md` / `D-*.md` 与我相关。列表 + 一句话 why-relevant。

### §5 工作区 + 权限

从 `COMMON-CONTRACT §0` 抽取本角色可写目录清单 · 便于装扮时快速核对。

### §6 遗留问题 / FU / 债务

当前角色负责的未结事项 · 指向 `.team/follow-ups/README.md` 等。

### §7 最近更新时间戳

每次被装扮完成时 subagent 必须更新这一段（ISO 8601）。

---

## 3. `history/YYYY-MM-DD-COSTRA-xxx-brief.md` 模板

```markdown
# {role} · {date} · COSTRA-xxx · {brief-title}

- subagent_spawn_ts: 2026-05-02T19:30:00+08:00
- subagent_finish_ts: 2026-05-02T19:42:00+08:00
- orchestrator_context: 会话标识（可选）
- task_type: feature | fix | refactor | docs | review-response | card-review-response

## §1 任务描述

（Orchestrator 派单的原文摘要）

## §2 产出

- 新增文件：xxx
- 修改文件：xxx
- commit：<hash>

## §3 关键决策

- 走的是方案 A / B / ... 理由 ...

## §4 遗留

- FU-xxx（若有）
- 未完成的分支（若有）

## §5 Subagent 最后的 state.md diff

（对 state.md 做了哪些改动）
```

---

## 4. 装扮时的 prompt 组装（Orchestrator MUST）

spawn 时 · prompt §C 段 inline 该角色的 `state.md` 全文 · §D 段 inline 最近相关的 1-3 份 `history/*.md`（Orchestrator 按相关性筛选）。

任务结束时 · 装扮 subagent MUST：
1. 更新 `state.md`（§2 active tasks 增/减 · §3 交付历史索引补一条 · §7 时间戳）
2. 新建 `history/YYYY-MM-DD-COSTRA-xxx-brief.md`（完整工作日志）
3. final message 里报告"state.md 已更新 / history 已落盘"

---

## 5. 并行 Orchestrator 下的冲突处理

- 两个 Orchestrator 同时 spawn 同一角色做不同任务：state.md 最后会被两次改 · 后手 MUST 先 rebase（`git log -1 --format=%H state.md` 核对）
- `history/*.md` 命名含 card-id · 天然不冲突

详见 `SOP-HUMAN-TRIGGER.md §6`。

---

## 6. 初始化说明

当前（2026-05-02）6 个角色目录 + state.md 骨架已随本 README 一同初始化。每个 state.md 初始内容极简（§1 引用 agent 文件 · §7 创建时间戳 · 其他段空 placeholder）· 首次装扮时由 subagent 填充。

---

## 7. Subagent frontmatter 踩坑（P2' 实证）

创建 `.codebuddy/agents/costra-*.md` 时 · frontmatter 必须严格遵守：

- **`tools` 字段用逗号分隔字符串** · **不可用 JSON/YAML 数组**
  - ✅ 正确：`tools: Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, WebFetch`
  - ❌ 错误：`tools: ["Read", "Write", "Edit"]`（CodeBuddy 解析失败 · subagent 拿到空工具集 · 只能输出文本描述 · 无法实际调用）
- **`permissionMode`** 被审角色用 `acceptEdits` · 审查角色用 `default`（审查物理无写工具 · 该字段无实际效果 · 为格式统一保留）
- **`model`** 用 `inherit`（继承 parent 模型 · 避免写死）
- **路径约定**：`.codebuddy/agents/` 子路径需配 `.codebuddy-plugin/plugin.json` 显式声明 `"agents": ["./.codebuddy/agents"]`（实证有效 · Q11 通过）

实证来源：2026-05-02 20:16 第 1 次 spawn 因用 JSON 数组格式失败 · 20:20 改逗号分隔后 18 次工具调用全成功。

---

## 8. 版本

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-05-02 | 立案随 D-018 v1.0 |
| v1.1 | 2026-05-02 | 随 D-018 v1.1 · 新增 §7 frontmatter 踩坑记录（P2' 实证 · tools 字段必须逗号分隔 · 非 JSON 数组）|
