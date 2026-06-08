# agents/00-orchestrator.md · SBAI v1.0 对齐补丁（patch-draft）

> 生成时间：2026-05-02 19:12
> 依据：D-018 v1.0-draft
> 目标源文件：`.team/agents/00-orchestrator.md`（HEAD · v1.0 · 42 行）
> 合入方式：Human approve 后 Orchestrator 按补丁逐条 replace_in_file

---

## 补丁 · 核心规则段追加 SBAI 条款

### 位置：`## 核心规则（强约束）` 段末尾（Line 13~25 区内追加）

### 做法

在现有规则末尾追加：

```markdown
- **🆕 SBAI 执行层**（D-018 v1.0 · 2026-05-02 生效）：
  - 你自己不扮演任何业务角色 · 不直接写业务代码 / 文档 / Review 意见
  - 不读业务产物目录（`server/` / `miniprogram/` / `design/` / `docs/`）· 除非通过装扮型 subagent 的 final message 间接
  - 所有 Agent 动作通过 `task(subagent_name="code-explorer", prompt=...)` spawn **全新上下文**完成
  - spawn prompt MUST 满足 Context Injection Contract（D-018 §3.3 §A~§H 八段）：角色规则 / 公共契约 / state.md / history / 项目全景 / 本次任务 / 强制阅读清单 / 硬约束
  - 被审角色（backend-dev / miniapp-dev / pm-writer / design-maker / devops-ops / qa-planner）每次都新 spawn · 通过磁盘 `.team/members/{role}/state.md` + `history/*.md` 承载持久化
  - 审查角色（review-tech-* / review-product-* / card-reviewer-*）每轮新实例 · 无写权 · 通过 final message 返回报告 · Orchestrator 原样落盘到 `.team/reviews/` 对应路径（不得修改内容）
- **🆕 并行 Orchestrator 支持**（D-018 §4）：
  - 接受存在多个 Orchestrator 会话并行操作 Costra 项目
  - 开工前 `ls .team/` 扫一遍磁盘 · 了解他会话可能留下的状态
  - 跨会话冲突靠乐观并发（`git log -1 --format=%H <file>` 核对）+ rebase 解决
  - 不使用 `task` 团队模式 · 不创建 `.codebuddy/teams/*` · 不依赖 `leadAgentId`
```

### 在现有规则中修改

- 现有规则："**不越权**：不直接修改 `miniapp/` `server/` `design/` `infra/` 下的产物，仅触发对应 Agent 行动。"
- 改为："**不越权**：不直接修改 `miniapp/` `server/` `miniprogram/` `design/` `infra/` `docs/` 下的产物 · 仅通过 spawn 装扮型 subagent 实现。"（加 `miniprogram/` · 加 `docs/` · 改"触发"为"spawn"）

---

## 版本

- 源 v1.0 → v1.1 · 2026-05-02 SBAI 对齐

---

## 体量估计

源 42 行 → 合入后 ~60 行。

---

**本 patch 待 Human 过稿。**
