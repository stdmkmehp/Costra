# 观察 & 干预 SOP（你每天 30 分钟怎么用）

## 一、观察：三层视图

### L1 战略层（每周看 1 次）
- `docs/weekly/W-x.md` 周报
- `.team/metrics.json` 指标趋势
- `.team/risks.md` 风险板

### L2 战术层（每日看 1 次，5 分钟）
- `.team/board.md` Kanban
- `.team/daily/YYYY-MM-DD.md` 站会纪要
- 浏览器打开 `.team/dashboard.html` 看一眼

### L3 执行层（按需钻取）
- `.team/messages/YYYY-MM-DD.jsonl` 消息流（`Get-Content -Wait` 实时跟随）
- `.team/tool_calls/YYYY-MM-DD.jsonl` 工具调用审计
- 各 Agent 产出物（`docs/` `design/` `api/` `ios/` `server/` `infra/` `qa/`）

## 二、干预：五种力度

| 力度 | 场景 | 怎么做 |
|---|---|---|
| ① 批准/驳回（闸门） | Agent 发来 `approval_request` | 在 dashboard 或消息里直接回复 `approve` / `reject` + 理由 |
| ② 微调（revise） | 方向对，细节错 | 写一份 intervention yaml（command: revise） |
| ③ 重做（reject） | 方案不符合需求 | intervention yaml（command: reject）+ 附 ADR 或新的 must_do |
| ④ 换人（reassign） | 当前 Agent 显然不合适 | intervention yaml（command: reassign，new_assignee: 目标 Agent） |
| ⑤ 紧急制动（pause / abort / rollback） | 跑偏 / 灾难 | 修改 `.team/STATE` 为 PAUSED，或 yaml 下 rollback 到指定 git tag |

### 干预指令标准流程

1. 复制 `.team/interventions/EXAMPLE.yaml` → 改名 `YYYYMMDD-HHmm-<slug>.yaml`
2. 填字段（符合 `schemas/intervention.schema.json`）
3. 保存即生效 —— Orchestrator 下一轮扫描会优先处理

### 紧急制动三件套

```powershell
# 全局暂停
Set-Content .team/STATE "PAUSED"

# 单 Agent 停工（在主会话里）
send_message(type="shutdown_request", recipient="Backend-Agent", content="stop all work")

# 代码回滚（在相应子仓）
cd server; git revert <bad_sha>
```

## 三、日常节奏

```
🌅 早（5 分钟）
   ├─ 打开 dashboard.html
   ├─ 看 .team/daily/昨日.md 和 board.md
   └─ 处理 approval_request（按 [approve/reject] 回复）

🏃 工作时（按需）
   ├─ 偶尔 tail messages.jsonl
   └─ 发现偏差 → 写 intervention yaml

🌙 晚（10 分钟）
   ├─ 看 metrics.json 趋势
   ├─ 更新 risks.md（如有新风险）
   └─ 给明天写一条"需特别关注"备注

📅 周五
   ├─ 审批 PM 周报
   └─ 调整下周优先级（改 backlog.json）
```

## 四、冲突仲裁

- 跨 Agent 技术分歧 → Orchestrator 召集三方（以 `api/openapi.yaml` 为事实源）
- 无法达成一致 → 升级给 Human → 产出 ADR 固化决策
- 质量红线 → QA-Agent 一票否决（写入 `qa/reports/` 留痕）

## 五、审计与回溯

任何时刻你都可以重建事件时间线：
```
.team/messages/*.jsonl   ← 谁何时对谁说了什么
.team/tool_calls/*.jsonl ← 谁何时改了哪个文件
git log --all            ← 代码层面的真相
.team/interventions/*    ← 人工干预历史
.team/decisions/ADR-*    ← 决策沉淀
```
