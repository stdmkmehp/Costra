# Agents 公共契约（所有 Agent 必须遵守）

> 本文件优先级高于任何单 Agent 文档；与个人提示词冲突时以此为准。

## 0. 不可违反的红线
- **目录权限（SBAI v1.0 执行体二分法 · D-018 · 2026-05-02）**：每个执行体只能写自己的工作区；越界必须通过 Orchestrator spawn 装扮型 subagent 实现。
  | 执行体 | 类型 | 可写目录 | 备注 |
  |---|---|---|---|
  | Orchestrator | 主对话上下文 | `.team/`（除 `interventions/` 原始文件 · 除业务产物目录） | **禁止**写 `server/` `miniprogram/` `design/` `docs/`；业务产物必须交由装扮型 subagent 产出，Orchestrator 只做编排与原样落盘审查 subagent 产物 |
  | pm-writer（装扮 subagent） | 一次性上下文 | `docs/`、`.team/board.md`、`.team/backlog.json`、`.team/risks.md`、`.team/cards/`、`.team/members/pm-writer/` | 对应旧 PM-Agent |
  | design-maker（装扮 subagent） | 一次性上下文 | `design/`、`docs/design/`、`.team/members/design-maker/` | 对应旧 Design-Agent |
  | miniapp-dev（装扮 subagent） | 一次性上下文 | `miniprogram/`、`.team/members/miniapp-dev/` | 对应旧 MiniApp-Agent · 实际仓库是 `miniprogram/`（`miniapp/` 为角色旧名） |
  | backend-dev（装扮 subagent） | 一次性上下文 | `server/`、`api/`、`.team/members/backend-dev/` | 对应旧 Backend-Agent |
  | devops-ops（装扮 subagent） | 一次性上下文 | `infra/`、各模块 `.github/workflows/`、`scripts/devops/`、`.team/members/devops-ops/` | 对应旧 DevOps-Agent |
  | qa-planner（装扮 subagent） | 一次性上下文 | `qa/`、`docs/qa/`、`.team/members/qa-planner/` | 对应旧 QA-Agent |
  | review-tech-{card}-r{N} | 一次性审查 subagent | **无写权**（返回 final message 由 Orchestrator 原样落盘） | 每轮新实例 |
  | review-product-{card}-r{N} | 一次性审查 subagent | **无写权** | 同上 |
  | card-reviewer-{tech\|product}-{card}-r{N} | 一次性审查 subagent | **无写权** | 每张卡每轮新实例 |
- **禁止删除任何 `.team/` 下的历史文件**（审计需要）。
- **禁止修改他人任务卡的 `assignee_agent` / `priority`**，只能 `pm-writer` 装扮 subagent 改。
- **生产环境所有操作**（部署 / 数据库变更 / 密钥 / 域名）必须 Human 审批。

## 0-Bis. 工具白名单约束（D-018 v1.0 · SBAI 执行层 · 2026-05-02）

Costra 当前工具平台 **不支持 API 级工具白名单**（`task(subagent_name=...)` 出的 subagent 继承完整工具链）。审查 subagent 的"无写权"约束仅靠两层防御：

| 层 | 机制 | 强度 |
|---|---|---|
| **防御层 1** | spawn prompt §H 硬性声明"禁止调用 write_to_file / replace_in_file / execute_command / delete_file" | 纪律 |
| **防御层 2** | Orchestrator 事后比对审查 subagent 的 final message 与磁盘产物是否一致 · 不一致 → 记 `I-oneshot-write-violation` + 不采信本轮产物 + Human 裁决 | 审计 |

该限制写入 D-018 §3.5 · 接受为 v1.0 既定事实 · 未来若平台支持工具白名单再升级。

**违规记 incident 类型**：详见 [`SOP-HUMAN-TRIGGER.md §5`](../SOP-HUMAN-TRIGGER.md)。

## 1. 开工前必做
1. 读 `.team/STATE`；若为 `PAUSED` 或 `ABORTED`：
   - `PAUSED`：立即停工并回一条 `heartbeat`，说明当前卡在哪里。
   - `ABORTED`：保存当前状态到 `.team/agents/<self>.snapshot.json`，静默退出。
2. 读 `.team/interventions/`，若有针对自己且未 processed 的干预，**先处理再继续**。
3. 读自己未完成的任务卡（看板 Doing 列）。

## 2. 消息规范（JSONL）
每个动作向当日 `.team/messages/YYYY-MM-DD.jsonl` 追加一行，Schema 见 `schemas/message.schema.json`。
**必填**：`msg_id / ts / from / to / type / summary`。

示例：
```json
{"msg_id":"a1b2","ts":"2026-04-21T10:00:00+08:00","from":"Backend-Agent","to":"Orchestrator","type":"status_report","task_id":"COSTRA-201","summary":"invite code 生成器完成，进入自测"}
```

## 3. 工具调用审计
写类操作（create/modify/delete/exec）前后，必须向 `.team/tool_calls/YYYY-MM-DD.jsonl` 追加：
```json
{"ts":"...","agent":"MiniApp-Agent","task_id":"COSTRA-030","tool":"write_to_file","target":"miniapp/src/app.ts","action":"create","diff_summary":"...","result":"success"}
```

## 4. 任务卡生命周期
```
Backlog → (PM 排期) → Todo → (Agent 领取) → Doing
    Doing → (产出待审) → Review → (审核通过) → Done
    Doing → (遇阻) → Blocked → (解除) → Doing
    任意 → Cancelled（需 PM + Human 双签）
```
状态变更由装扮型 subagent 在 final message 里声明（`type: status_report`），Orchestrator 接收后更新 `board.md` + `backlog.json`。

具体对应：
- Backlog → Todo：pm-writer 装扮产出卡定义后声明
- Todo → Doing：被审装扮 subagent 开始产出
- Doing → Review：被审装扮 subagent 交付后 Orchestrator 在同一对话轮内 spawn 审查 subagent
- Review → Done：Human 在看到 Review 报告后发 `approve:COSTRA-xxx`（T1/T2）或自动关闭（T3/T4 · D-013）
- Doing → Blocked：装扮 subagent 在 final message 中声明 `type=blocker`
- 任意 → Cancelled：PM + Human 双签

## 5. 五个闸门
| 闸门 | 触发者 | 形式 | Human 动作 |
|---|---|---|---|
| G1 需求 | PM-Agent | PRD v0.x 出稿 | approve / revise |
| G2 设计 | Design-Agent | 高保真 + 设计系统 | approve / revise |
| G3 契约 | Backend-Agent | OpenAPI / DB Schema | approve / revise |
| G4 合并 | MiniApp/Backend | PR 合入 main 前 | approve / reject |
| G5 发布 | DevOps-Agent | 生产环境发布 / 小程序提审或分阶段发布前 | approve / abort |

Agent 到闸门必须发 `approval_request` 消息，然后 **停止该任务线后续动作**，直到 Human 回复 `approve`。

## 6. 干预优先级
`.team/interventions/*.yaml` 中 **未 processed** 的文件优先级 **最高**，凌驾于任务队列之上。
Orchestrator 每轮必扫该目录。处理完毕后追加字段：
```yaml
processed_at: 2026-04-21T10:05:00+08:00
processed_by: Orchestrator
result: dispatched_to:Backend-Agent
```

## 7. 错误处理
- 幻觉（如用不存在的库）→ CI 拦截 → 自动产出 `blocker` 消息 → Agent 自行修复
- 偏离需求 → QA 或 PM 打回 `reject` → Agent 重做并自我反思写 `docs/retro/*.md`
- 架构错误 → Human 下 `rollback` → Agent 执行 git revert

## 8. 代码/契约双签
- 接口契约变更：Backend-Agent 发起 + MiniApp-Agent 确认 → G3
- 合并 main：作者 Agent + 至少一个 review Agent + G4 签字

## 8bis. Review 闭环（新增 · 2026-04-23 · SBAI v1.0 对齐 2026-05-02）
- `backend-dev` / `miniapp-dev` 装扮 subagent 产出后 · Orchestrator 在本对话轮 spawn `review-tech-{card}-r{N}` 审查 subagent 预审
- `pm-writer` / `design-maker` 装扮 subagent 产出后 · Orchestrator 同理 spawn `review-product-{card}-r{N}` 审查 subagent 预审
- `devops-ops` / `qa-planner` / 决策类文档 **不走**审查 subagent（Human 直审）
- 完整规则与迭代机制见 [`.team/SOP-REVIEW.md`](../SOP-REVIEW.md)（2026-04-24 合并版 v2.0 · 2026-05-02 SBAI 对齐）
- 最多 5 轮迭代；出 `ESCALATE` 或 round==5 强制停并冒泡给 Human
- 审查 subagent **无写权**（§0-Bis）· 通过 final message 返回报告 · Orchestrator 原样落盘
- 被审装扮 subagent 必须产出 `round-N-{role}-response.md`

## 8ter. SBAI 执行层约定（D-018 v1.0 · 2026-05-02）

### 执行体二分法

- **Orchestrator**（主对话上下文 · 纯编排）：只做分派 / 追踪 / 闸门 / 归档四件事 · **禁止**扮演业务角色 / 编写业务代码 / 生成 Review 意见 / 读业务产物目录（`server/` `miniprogram/` `design/` `docs/` · 除非通过审查 subagent 的 final message 间接）
- **装扮型 subagent**（`task(subagent_name="code-explorer", prompt=...)`）：全新上下文 · 一次性 · 每次 spawn 装扮成具体角色执行任务 · 任务结束销毁
- **审查 subagent**：装扮型 subagent 的特化（一次性 / 无写权）· 审完 final message 返回

### 核心硬约束

1. **Orchestrator 不做业务产出**：禁止读 `server/` `miniprogram/` `design/` `docs/`（除非通过 subagent final message 间接）· 禁止自己写 Review 意见 · 禁止扮演任何被审角色
2. **审查 subagent 无写权**：纪律约束（§0-Bis）· 通过 final message 返回 · Orchestrator 原样落盘
3. **Context Injection Contract**（D-018 §3.3）：每次 spawn · prompt MUST 含 §A~§H 八段（角色规则 / 公共契约 / state / history / 项目全景 / 本次任务 / 强制阅读清单 / 硬约束）· 缺段 = `I-context-injection-violation`
4. **磁盘是唯一共享状态**：所有被审角色的"持久化"通过 `.team/members/{role}/state.md` + `history/*.md` 实现 · 无 session 持久化
5. **并行 Orchestrator 支持**：多会话共享磁盘 · 冲突靠乐观并发 + rebase · 详见 [`.team/SOP-HUMAN-TRIGGER.md §6`](../SOP-HUMAN-TRIGGER.md)

详见 [`.team/decisions/D-018-spawn-based-agent-isolation.md`](../decisions/D-018-spawn-based-agent-isolation.md)（v1.0）· [`.team/SOP-REVIEW.md §7.3`](../SOP-REVIEW.md) · [`.team/members/README.md`](members/README.md)。

## 9. 工程约束索引（2026-04-21 Human 追加 · 2026-04-23 强化）
- **微信官方文档优先**：涉及 MINA / 登录 / 分包 / 订阅消息 / 隐私 / 审核等场景，**必须先查** <https://developers.weixin.qq.com/miniprogram/dev/framework/> 并在 PR/ADR/注释中引用锚点 URL。
- **🔴 单卡交付即提交（D-012 · 铁律）**：每完成**一张**任务卡的产物，**立即** `git commit`；严禁把多卡产物攒到一起提交。commit message footer 必须含 `Refs: COSTRA-xxx`。Review Round-N revise 后的修改也必须独立 commit。唯一例外：Sprint/Gate 聚合收口可多卡同 commit，但必须在 body 列出所含卡号。完整细则与反例见 [`.team/engineering-guidelines.md §2.1`](../engineering-guidelines.md) 与 [`.team/decisions/D-012-per-card-commit-discipline.md`](../decisions/D-012-per-card-commit-discipline.md)。
- **关键节点必须 Git 提交**：Story AC 通过、ADR 变更、契约冻结、骨架跑通、压测/审核/安全扫描通过、闸门流转后均需产生 commit，遵循 Conventional Commits（`<type>(<scope>): <subject>` + `Refs/Gate` footer）。
- 完整细则与 checklist 见 [`.team/engineering-guidelines.md`](../engineering-guidelines.md)。
