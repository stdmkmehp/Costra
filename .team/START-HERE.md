# Costra 启动手册（How to run the team）

本手册告诉你：**如何把 `.team/agents/` 下的 7 份提示词真正运行起来**。

## 方式 A：CodeBuddy Team Mode（推荐 · 真并行）

1. 在主会话里让主控 Agent 执行：
   ```
   team_create(team_name="costra-dev", description="Costra 多 Agent 研发团队")
   ```
2. 依次 spawn 6 个成员 + Orchestrator：
   ```
   task(subagent_name="<内置通用 agent>", name="orchestrator", team_name="costra-dev",
        prompt="你的系统提示词 = .team/agents/00-orchestrator.md 全文 + .team/agents/COMMON-CONTRACT.md 全文",
        mode="default")  # default：关键动作弹审批
   ```
   其余五个 Agent 类似，注意：
   | Agent | 建议 mode |
   |---|---|
   | Orchestrator | default（关键决策弹审批） |
   | PM-Agent | plan（方案必须你批） |
   | Design-Agent | plan |
   | QA-Agent | plan |
   | iOS-Agent | acceptEdits |
   | Backend-Agent | acceptEdits |
   | DevOps-Agent | **default（最危险，每步必审）** |
3. Orchestrator 会自动读 `.team/board.md` 开始分派任务。

## 方式 B：串行模拟（最简单，低并发）

不用 team_create，而是让单个主 Agent **按角色切换**执行 SOP：
1. 先扮演 PM-Agent → 输出 PRD
2. 切到 Design-Agent → 输出设计稿
3. 切到 Backend-Agent → 输出契约与代码
4. 切到 iOS-Agent → 输出客户端代码
5. 切到 DevOps-Agent → 输出 CI/CD
6. 切到 QA-Agent → 输出测试与回归

可以借助 `persona-switch` skill，但仍然要严格遵守 `COMMON-CONTRACT.md`。

## 方式 C：混合（稳妥）

- PM / Design / QA 这类文档型角色 → 串行由主 Agent 扮演
- iOS / Backend / DevOps 这类重代码角色 → 用 Team Mode 并行

## 首个 Sprint 启动仪式

1. 确认 `.team/STATE = RUNNING`
2. Human 写一份业务目标到 `docs/charter.md`（项目章程）
3. 喂给 Orchestrator：
   > "开始 Sprint-0：读 docs/charter.md 和 .team/backlog.json，调度 PM-Agent 完成 COSTRA-001~COSTRA-003；全部通过 G1 闸门后停下等我确认。"
4. 打开浏览器访问 `.team/dashboard.html`，观察看板与消息流。
