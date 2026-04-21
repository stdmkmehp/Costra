# Agents 公共契约（所有 Agent 必须遵守）

> 本文件优先级高于任何单 Agent 文档；与个人提示词冲突时以此为准。

## 0. 不可违反的红线
- **目录权限**：每个 Agent 只能写自己的工作区；越界必须通过 Orchestrator 发 `task_assign` 给目标 Agent。
  | Agent | 可写目录 |
  |---|---|
  | Orchestrator | `.team/`（除 `interventions/` 的原始文件） |
  | PM-Agent | `docs/`、`.team/board.md`、`.team/backlog.json`、`.team/risks.md` |
  | Design-Agent | `design/` |
  | MiniApp-Agent | `miniapp/` |
  | Backend-Agent | `server/`、`api/` |
  | DevOps-Agent | `infra/`、各模块 `.github/workflows/` |
  | QA-Agent | `qa/` |
- **禁止删除任何 `.team/` 下的历史文件**（审计需要）。
- **禁止修改他人任务卡的 `assignee_agent` / `priority`**，只能 PM-Agent 改。
- **生产环境所有操作**（部署 / 数据库变更 / 密钥 / 域名）必须 Human 审批。

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
状态变更必须发 `status_report` 消息，并由 Orchestrator 更新 `board.md`。

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
